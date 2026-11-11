"""
Dispatch engine.

Online riders live in a Redis GEO set (`sw:riders:geo`) plus a per-rider hash with heartbeat, vehicle and
active job count. A job is offered round by round: rank eligible riders near the store, offer to one
(sequential) or N (batch, first to accept wins), expire after `offerTimeoutSeconds`, then try the next
riders; the radius grows when nobody is in range. After `maxRounds` the job becomes NO_RIDER, admins are
alerted and the customer is told (with the option to keep searching). Every state change is validated by
delivery.state and mirrored onto the order.
"""
from __future__ import annotations

import logging
import time
from datetime import timedelta
from typing import Any

from django.contrib.gis.geos import Point
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core import settings_service
from core.exceptions import ApiError
from core.integrations import google_maps
from notifications.realtime import broadcast

from .. import state
from ..fees import rider_earning
from ..models import DeliveryJob, DeliveryOffer, Rider, RiderLocationPing

logger = logging.getLogger("smartwear.dispatch")
GEO_KEY = "sw:riders:geo"
RIDER_KEY = "sw:rider:{id}"
PING_SAMPLE_SECONDS = 15
PING_SAMPLE_METERS = 40
NEARBY_SECONDS = 180


def _r():
    return settings_service.redis_client()


def _cfg():
    return settings_service.get("delivery.dispatch")


# ================================================================ presence
def active_job_count(rider: Rider) -> int:
    return DeliveryJob.objects.filter(rider=rider, status__in=state.RIDER_HOLDS).count()


def go_online(rider: Rider, lat: float, lng: float) -> Rider:
    if rider.status != "ACTIVE":
        raise ApiError.forbidden("Your rider account isn't approved yet. SmartWear will contact you." if rider.status == "PENDING" else "Your rider account is suspended. Contact support.")
    vehicle = rider.vehicles.filter(is_primary=True).first()
    if vehicle is None:
        raise ApiError.bad_request("Add your vehicle details before going online")
    now = timezone.now()
    rider.presence = "ASSIGNED" if active_job_count(rider) else "IDLE"
    rider.online_since = now
    _store_location(rider, lat, lng, None, now, persist=True)
    rider.save(update_fields=["presence", "online_since"])
    broadcast("dispatch", {"type": "rider.presence", "riderId": str(rider.id), "presence": rider.presence, "location": {"lat": lat, "lng": lng}})
    # Pick up anything waiting nearby straight away.
    from ..tasks import dispatch_waiting_jobs

    transaction.on_commit(lambda: dispatch_waiting_jobs.delay())
    return rider


def go_offline(rider: Rider) -> Rider:
    if active_job_count(rider):
        raise ApiError.conflict("active_job", "Finish your current delivery before going offline")
    try:
        _r().zrem(GEO_KEY, str(rider.id))
        _r().delete(RIDER_KEY.format(id=rider.id))
    except Exception:  # noqa: BLE001
        pass
    rider.presence = "OFFLINE"
    rider.online_since = None
    rider.save(update_fields=["presence", "online_since"])
    DeliveryOffer.objects.filter(rider=rider, status="PENDING").update(status="WITHDRAWN", responded_at=timezone.now())
    broadcast("dispatch", {"type": "rider.presence", "riderId": str(rider.id), "presence": "OFFLINE"})
    return rider


def _store_location(rider: Rider, lat: float, lng: float, heading: float | None, at, *, persist: bool) -> None:
    v = rider.vehicles.filter(is_primary=True).first()
    try:
        pipe = _r().pipeline()
        pipe.geoadd(GEO_KEY, (lng, lat, str(rider.id)))
        pipe.hset(RIDER_KEY.format(id=rider.id), mapping={"lastSeen": int(time.time()), "vehicle": v.type if v else "MOTORBIKE", "rating": rider.rating_avg})
        pipe.expire(RIDER_KEY.format(id=rider.id), 3600)
        pipe.execute()
    except Exception as e:  # noqa: BLE001
        logger.warning("geo update failed: %s", e)
    rider.last_location = Point(lng, lat, srid=4326)
    rider.last_heading = heading
    rider.last_seen_at = at
    if persist:
        Rider.objects.filter(pk=rider.pk).update(last_location=rider.last_location, last_heading=heading, last_seen_at=at)


def update_location(rider: Rider, *, lat: float, lng: float, heading: float | None = None, speed: float | None = None, accuracy: float | None = None, battery: float | None = None, recorded_at=None) -> dict[str, Any]:
    if rider.presence == "OFFLINE":
        raise ApiError.conflict("offline", "Go online to share your location")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ApiError.bad_request("Invalid coordinates")
    now = timezone.now()
    at = recorded_at or now
    prev, prev_at = rider.last_location, rider.last_seen_at
    _store_location(rider, lat, lng, heading, at, persist=True)
    jobs = list(DeliveryJob.objects.filter(rider=rider, status__in=state.RIDER_HOLDS).select_related("order"))
    moved = google_maps.haversine_m((prev.y, prev.x), (lat, lng)) if prev else 1e9
    if not prev_at or (at - prev_at).total_seconds() >= PING_SAMPLE_SECONDS or moved >= PING_SAMPLE_METERS:
        RiderLocationPing.objects.create(rider=rider, job=jobs[0] if jobs else None, location=Point(lng, lat, srid=4326), heading=heading, speed_mps=speed, accuracy_m=accuracy, battery=battery, recorded_at=at)
    payload = {"type": "rider.location", "riderId": str(rider.id), "lat": lat, "lng": lng, "heading": heading, "speed": speed, "at": at.isoformat()}
    broadcast("dispatch", payload)
    for job in jobs:
        _refresh_eta(job, lat, lng)
        broadcast(f"order.{job.order_id}", payload | {"etaSeconds": job.eta_seconds, "routeLeg": job.route_leg})
    # Battery-adaptive cadence hint for the app (seconds between updates, metres between updates)
    cadence = (3, 10) if jobs else (10, 30)
    if battery is not None and battery < 0.2:
        cadence = (cadence[0] * 2, cadence[1] * 2)
    return {"ok": True, "nextIntervalSeconds": cadence[0], "distanceFilterMeters": cadence[1], "activeJobs": [str(j.id) for j in jobs]}


def _refresh_eta(job: DeliveryJob, lat: float, lng: float) -> None:
    to_store = job.status in ("ACCEPTED", "AT_STORE")
    target = job.pickup if to_store else job.dropoff
    leg = "to_store" if to_store else "to_client"
    now = timezone.now()
    straight = google_maps.haversine_m((lat, lng), (target.y, target.x))
    stale = not job.eta_updated_at or (now - job.eta_updated_at).total_seconds() > 45 or job.route_leg != leg
    if stale:
        rt = google_maps.route((lat, lng), (target.y, target.x))
        job.eta_seconds, job.route_polyline = rt["durationSeconds"], rt["polyline"]
    else:
        # Between Routes calls, scale the last ETA by remaining straight-line distance.
        job.eta_seconds = max(30, int(straight * google_maps.DETOUR_FACTOR / 6.5)) if not job.eta_seconds else min(job.eta_seconds, max(30, int(straight * google_maps.DETOUR_FACTOR / 6.0)))
    job.route_leg = leg
    job.eta_updated_at = now if stale else job.eta_updated_at
    fields = ["eta_seconds", "route_polyline", "route_leg", "eta_updated_at"]
    if leg == "to_client" and job.status == "EN_ROUTE" and job.eta_seconds <= NEARBY_SECONDS and not job.nearby_notified_at:
        from notifications.service import notify

        job.nearby_notified_at = now
        fields.append("nearby_notified_at")
        notify(job.order.user, "order.nearby", {"minutes": max(1, round(job.eta_seconds / 60))}, data={"orderId": str(job.order_id)})
    job.save(update_fields=fields)


def online_candidates(lat: float, lng: float, radius_m: int) -> list[tuple[str, float]]:
    try:
        rows = _r().geosearch(GEO_KEY, longitude=lng, latitude=lat, radius=radius_m, unit="m", sort="ASC", withdist=True, count=50)
    except Exception as e:  # noqa: BLE001
        logger.warning("geosearch failed: %s", e)
        return []
    return [(m, float(d)) for m, d in rows]


def rank(job: DeliveryJob, found: list[tuple[str, float]]) -> list[tuple[Rider, float]]:
    cfg = _cfg()
    now = time.time()
    ids = [rid for rid, _ in found]
    riders = {str(r.id): r for r in Rider.objects.filter(id__in=ids, status="ACTIVE").exclude(presence="OFFLINE").prefetch_related("vehicles")}
    declined = set(DeliveryOffer.objects.filter(job=job, status__in=["DECLINED", "EXPIRED", "WITHDRAWN"]).values_list("rider_id", flat=True))
    pending = set(DeliveryOffer.objects.filter(status="PENDING", expires_at__gt=timezone.now()).values_list("rider_id", flat=True))
    out = []
    for rid, dist in found:
        r = riders.get(rid)
        if r is None or r.id in declined or r.id in pending:
            continue
        try:
            meta = _r().hgetall(RIDER_KEY.format(id=rid))
        except Exception:  # noqa: BLE001
            meta = {}
        last = int(meta.get("lastSeen") or 0)
        if now - last > cfg.heartbeatTtlSeconds:
            continue
        v = next((x for x in r.vehicles.all() if x.is_primary), None)
        if v is None or v.type not in cfg.eligibleVehicleTypes:
            continue
        if active_job_count(r) >= cfg.maxConcurrentJobsPerRider:
            continue
        w = cfg.weights
        score = dist / 1000 * w.distance + (5 - min(5, max(0, r.rating_avg))) * w.rating + (now - last) / 10 * w.recency
        out.append((r, dist, score))
    out.sort(key=lambda x: (x[2], x[1]))
    return [(r, d) for r, d, _ in out]


# ================================================================ jobs
@transaction.atomic
def create_job(order) -> DeliveryJob:
    existing = DeliveryJob.objects.filter(order=order).first()
    if existing:
        return existing
    pricing = settings_service.get("delivery.pricing")
    dist = order.distance_m or int(google_maps.haversine_m((order.store.location.y, order.store.location.x), (order.destination.y, order.destination.x)) * google_maps.DETOUR_FACTOR)
    job = DeliveryJob.objects.create(order=order, store=order.store, pickup=order.store.location, dropoff=order.destination, distance_m=dist, earning=rider_earning(pricing, dist, order.delivery_fee), currency=order.currency, status="SEARCHING", searching_since=timezone.now())
    if order.status == "CONFIRMED":
        from commerce.services.orders import transition

        transition(order, "PREPARING", actor="system", notify_customer=False)
    broadcast("dispatch", {"type": "job.created", "jobId": str(job.id), "orderId": str(order.id), "number": order.number})
    if _cfg().mode in ("auto", "hybrid"):
        from ..tasks import run_dispatch_round

        transaction.on_commit(lambda: run_dispatch_round.delay(str(job.id)))
    return job


def run_round(job_id: str) -> dict[str, Any]:
    cfg = _cfg()
    with transaction.atomic():
        job = DeliveryJob.objects.select_for_update(of=("self",)).select_related("order", "store").filter(id=job_id).first()
        if job is None or job.status not in ("SEARCHING",):
            return {"skipped": True, "status": job.status if job else None}
        if cfg.mode == "manual":
            return {"skipped": True, "reason": "manual"}
        radius = min(cfg.maxRadiusMeters, cfg.initialRadiusMeters + job.round * cfg.radiusStepMeters)
        found = online_candidates(job.pickup.y, job.pickup.x, radius)
        ranked = rank(job, found)
        if not ranked:
            job.round += 1
            if job.round >= cfg.maxRounds:
                return _no_rider(job)
            job.save(update_fields=["round"])
            from ..tasks import run_dispatch_round

            transaction.on_commit(lambda: run_dispatch_round.apply_async((str(job.id),), countdown=8))
            broadcast(f"order.{job.order_id}", {"type": "job.searching", "radiusMeters": min(cfg.maxRadiusMeters, cfg.initialRadiusMeters + job.round * cfg.radiusStepMeters)})
            return {"offered": 0, "round": job.round, "radius": radius}
        take = ranked[: (cfg.batchSize if cfg.strategy == "batch" else 1)]
        expires = timezone.now() + timedelta(seconds=cfg.offerTimeoutSeconds)
        offers = []
        for rider, dist in take:
            offers.append(DeliveryOffer.objects.create(job=job, rider=rider, round=job.round, distance_to_store_m=int(dist), earning=job.earning, expires_at=expires))
        state.assert_delivery(job.status, "OFFERED", "system")
        job.status = "OFFERED"
        job.offered_rider_ids = list({*job.offered_rider_ids, *[str(o.rider_id) for o in offers]})
        job.save(update_fields=["status", "offered_rider_ids"])
        transaction.on_commit(lambda: _announce_offers(job, offers))
        from ..tasks import expire_offers

        transaction.on_commit(lambda: expire_offers.apply_async((str(job.id), [o.id for o in offers]), countdown=cfg.offerTimeoutSeconds + 1))
    return {"offered": len(offers), "round": job.round, "radius": radius}


def _announce_offers(job: DeliveryJob, offers: list[DeliveryOffer]) -> None:
    from notifications.service import notify

    for o in offers:
        payload = {"type": "job.offer", "offer": offer_out(o)}
        broadcast(f"rider.{o.rider_id}", payload)
        notify(o.rider.user, "rider.new_job", {"storeName": job.store.name, "distance": f"{job.distance_m / 1000:.1f} km", "earning": f"{job.currency} {job.earning:,}"}, data={"offerId": o.id, "jobId": str(job.id)}, inbox=False)


def _no_rider(job: DeliveryJob) -> dict[str, Any]:
    from notifications.service import notify

    state.assert_delivery(job.status, "NO_RIDER", "system")
    job.status = "NO_RIDER"
    job.no_rider_alerted_at = timezone.now()
    job.save(update_fields=["status", "round", "no_rider_alerted_at"])
    payload = {"type": "job.no_rider", "jobId": str(job.id), "orderId": str(job.order_id), "number": job.order.number}
    transaction.on_commit(lambda: (broadcast("dispatch", payload | {"alert": True}), broadcast(f"order.{job.order_id}", payload)))
    notify(job.order.user, "order.no_rider", {"orderNumber": job.order.number}, data={"orderId": str(job.order_id)})
    _alert_dispatchers(f"No rider for {job.order.number}", f"{job.store.name} → {job.order.destination_area or job.order.destination_label}")
    return {"offered": 0, "noRider": True}


def _alert_dispatchers(title: str, body: str) -> None:
    from accounts.models import AdminUser
    from notifications.push import send_to_admin

    for a in AdminUser.objects.filter(is_active=True, role__key__in=["SUPER_ADMIN", "MANAGER", "DISPATCHER"]):
        try:
            send_to_admin(a, title, body, {"kind": "dispatch_alert"})
        except Exception:  # noqa: BLE001
            pass


def expire(job_id: str, offer_ids: list[int]) -> None:
    with transaction.atomic():
        job = DeliveryJob.objects.select_for_update().filter(id=job_id).first()
        n = DeliveryOffer.objects.filter(id__in=offer_ids, status="PENDING").update(status="EXPIRED", responded_at=timezone.now())
        for o in DeliveryOffer.objects.filter(id__in=offer_ids, status="EXPIRED"):
            broadcast(f"rider.{o.rider_id}", {"type": "job.offer_expired", "offerId": o.id})
        if job and job.status == "OFFERED" and not DeliveryOffer.objects.filter(job=job, status="PENDING").exists():
            job.status = "SEARCHING"
            job.save(update_fields=["status"])
            from ..tasks import run_dispatch_round

            transaction.on_commit(lambda: run_dispatch_round.delay(str(job.id)))
    logger.info("expired %s offers for %s", n, job_id)


@transaction.atomic
def accept(rider: Rider, offer_id: int) -> DeliveryJob:
    offer = DeliveryOffer.objects.select_for_update().filter(id=offer_id, rider=rider).first()
    if offer is None:
        raise ApiError.not_found("Offer")
    job = DeliveryJob.objects.select_for_update(of=("self",)).select_related("order").get(id=offer.job_id)
    if offer.status != "PENDING" or offer.expires_at < timezone.now():
        raise ApiError.conflict("offer_gone", "This request has expired")
    if job.status not in ("OFFERED", "SEARCHING") or job.rider_id:
        offer.status = "WITHDRAWN"
        offer.save(update_fields=["status"])
        raise ApiError.conflict("offer_taken", "Another rider accepted this delivery")
    if rider.status != "ACTIVE" or rider.presence == "OFFLINE":
        raise ApiError.forbidden("Go online to accept deliveries")
    if active_job_count(rider) >= _cfg().maxConcurrentJobsPerRider:
        raise ApiError.conflict("busy", "Finish your current delivery first")
    now = timezone.now()
    offer.status, offer.responded_at = "ACCEPTED", now
    offer.save(update_fields=["status", "responded_at"])
    others = list(DeliveryOffer.objects.filter(job=job, status="PENDING").exclude(id=offer.id))
    DeliveryOffer.objects.filter(id__in=[o.id for o in others]).update(status="WITHDRAWN", responded_at=now)
    _assign(job, rider, actor="rider", actor_id=str(rider.user_id))
    for o in others:
        transaction.on_commit(lambda o=o: broadcast(f"rider.{o.rider_id}", {"type": "job.offer_taken", "offerId": o.id}))
    return job


def _assign(job: DeliveryJob, rider: Rider, *, actor: str, actor_id: str = "") -> None:
    from commerce.services.orders import transition

    state.assert_delivery(job.status, "ACCEPTED", actor)
    job.status, job.rider, job.accepted_at = "ACCEPTED", rider, timezone.now()
    job.route_leg, job.eta_updated_at = "", None
    job.save(update_fields=["status", "rider", "accepted_at", "route_leg", "eta_updated_at"])
    Rider.objects.filter(pk=rider.pk).update(presence="ASSIGNED")
    order = job.order
    if order.status in ("PREPARING", "READY_FOR_PICKUP"):
        transition(order, "ASSIGNED", actor="system" if actor == "rider" else "admin", actor_id=actor_id)
    if rider.last_location:
        _refresh_eta(job, rider.last_location.y, rider.last_location.x)
    payload = {"type": "job.assigned", "jobId": str(job.id), "orderId": str(order.id), "riderId": str(rider.id)}
    transaction.on_commit(lambda: (broadcast("dispatch", payload), broadcast(f"order.{order.id}", payload), broadcast(f"rider.{rider.id}", payload | {"job": job_out(job, for_rider=True)})))


@transaction.atomic
def decline(rider: Rider, offer_id: int, reason: str = "") -> None:
    offer = DeliveryOffer.objects.select_for_update().filter(id=offer_id, rider=rider, status="PENDING").first()
    if offer is None:
        return
    offer.status, offer.responded_at, offer.decline_reason = "DECLINED", timezone.now(), reason[:60]
    offer.save(update_fields=["status", "responded_at", "decline_reason"])
    job = DeliveryJob.objects.select_for_update().get(id=offer.job_id)
    if job.status == "OFFERED" and not DeliveryOffer.objects.filter(job=job, status="PENDING").exists():
        job.status = "SEARCHING"
        job.save(update_fields=["status"])
        from ..tasks import run_dispatch_round

        transaction.on_commit(lambda: run_dispatch_round.delay(str(job.id)))


RIDER_STEPS = {"AT_STORE": "at_store_at", "PICKED_UP": "picked_up_at", "EN_ROUTE": "en_route_at", "ARRIVED": "arrived_at", "COMPLETED": "completed_at"}


@transaction.atomic
def advance(job: DeliveryJob, to: str, *, actor: str, actor_id: str = "", pin: str | None = None, photo_id=None, lat: float | None = None, lng: float | None = None) -> DeliveryJob:
    from commerce.services.orders import reveal_pin, transition

    job = DeliveryJob.objects.select_for_update(of=("self",)).select_related("order", "rider__user").get(pk=job.pk)
    state.assert_delivery(job.status, to, actor)
    order = job.order
    if to == "COMPLETED" and actor == "rider" and settings_service.get("delivery.dispatch").deliveryPinEnabled:
        expected = reveal_pin(order)
        if job.pin_attempts >= 5:
            raise ApiError("Too many wrong PINs. Call the customer or support.", status_code=429, code="pin_locked")
        if not pin or pin.strip() != expected:
            job.pin_attempts += 1
            job.save(update_fields=["pin_attempts"])
            raise ApiError("That PIN doesn't match. Ask the customer to check their app.", status_code=400, code="pin_invalid", details={"attemptsRemaining": max(0, 5 - job.pin_attempts)})
    if to == "ARRIVED" and lat is not None and lng is not None:
        dist = google_maps.haversine_m((lat, lng), (job.dropoff.y, job.dropoff.x))
        if dist > 600:
            raise ApiError.conflict("too_far", f"You're {dist / 1000:.1f} km from the drop-off. Get closer before marking arrived.")
    field = RIDER_STEPS.get(to)
    if field:
        setattr(job, field, timezone.now())
    if to == "PICKED_UP" and photo_id:
        job.pickup_photo_id = photo_id
    if to == "COMPLETED" and photo_id:
        job.proof_photo_id = photo_id
    job.status = to
    job.save()
    order_to = state.DELIVERY_TO_ORDER.get(to)
    if order_to and order.status != order_to:
        if to == "PICKED_UP" and order.status in ("PREPARING", "READY_FOR_PICKUP"):
            transition(order, "ASSIGNED", actor="system", notify_customer=False)
        transition(order, order_to, actor="rider" if actor == "rider" else ("system" if to == "EN_ROUTE" else "admin"), actor_id=actor_id)
    if to in ("PICKED_UP", "EN_ROUTE"):
        Rider.objects.filter(pk=job.rider_id).update(presence="EN_ROUTE")
    if to == "COMPLETED":
        from django.db.models import F

        Rider.objects.filter(pk=job.rider_id).update(deliveries_count=F("deliveries_count") + 1, presence="IDLE" if active_job_count(job.rider) == 0 else "ASSIGNED")
    payload = {"type": "job.status", "jobId": str(job.id), "orderId": str(order.id), "status": to}
    transaction.on_commit(lambda: (broadcast("dispatch", payload), broadcast(f"order.{order.id}", payload), broadcast(f"rider.{job.rider_id}", payload)))
    return job


@transaction.atomic
def rider_release(job: DeliveryJob, rider: Rider, reason: str) -> DeliveryJob:
    """Rider cancels before pickup → automatic re-dispatch."""
    from commerce.services.orders import add_event, transition

    job = DeliveryJob.objects.select_for_update(of=("self",)).select_related("order").get(pk=job.pk)
    if job.rider_id != rider.id or job.status not in ("ACCEPTED", "AT_STORE"):
        raise ApiError.conflict("cannot_release", "You can only hand back a delivery before pickup")
    state.assert_delivery(job.status, "SEARCHING", "rider")
    DeliveryOffer.objects.filter(job=job, rider=rider, status="ACCEPTED").update(status="DECLINED", decline_reason=f"released: {reason}"[:60])
    job.status, job.rider, job.accepted_at, job.at_store_at, job.searching_since, job.round = "SEARCHING", None, None, None, timezone.now(), 0
    job.route_polyline, job.eta_seconds, job.route_leg = "", None, ""
    job.save()
    Rider.objects.filter(pk=rider.pk).update(presence="IDLE")
    if job.order.status == "ASSIGNED":
        transition(job.order, "PREPARING", actor="system", notify_customer=False)
    add_event(job.order, "rider_released", actor="rider", actor_id=str(rider.user_id), data={"reason": reason})
    from ..tasks import run_dispatch_round

    transaction.on_commit(lambda: (broadcast(f"order.{job.order_id}", {"type": "job.searching", "reason": "rider_released"}), run_dispatch_round.delay(str(job.id))))
    return job


@transaction.atomic
def manual_assign(job: DeliveryJob, rider: Rider, *, admin) -> DeliveryJob:
    job = DeliveryJob.objects.select_for_update(of=("self",)).select_related("order").get(pk=job.pk)
    if rider.status != "ACTIVE":
        raise ApiError.bad_request("That rider isn't active")
    if job.rider_id and job.status in state.RIDER_HOLDS:
        if job.status not in ("ACCEPTED", "AT_STORE"):
            raise ApiError.conflict("picked_up", "The order is already picked up — reassigning isn't possible")
        old = job.rider
        job.status = "SEARCHING"
        job.rider = None
        job.save(update_fields=["status", "rider"])
        Rider.objects.filter(pk=old.pk).update(presence="IDLE")
        broadcast(f"rider.{old.id}", {"type": "job.reassigned", "jobId": str(job.id)})
        if job.order.status == "ASSIGNED":
            from commerce.services.orders import transition

            transition(job.order, "PREPARING", actor="system", notify_customer=False)
    DeliveryOffer.objects.filter(job=job, status="PENDING").update(status="WITHDRAWN", responded_at=timezone.now())
    if job.status in ("OFFERED",):
        job.status = "SEARCHING"
    job.manual_assigned_by = admin
    job.save(update_fields=["status", "manual_assigned_by"])
    DeliveryOffer.objects.create(job=job, rider=rider, status="ACCEPTED", round=job.round, earning=job.earning, expires_at=timezone.now(), responded_at=timezone.now())
    _assign(job, rider, actor="admin", actor_id=str(admin.id))
    return job


def cancel_job(job: DeliveryJob, *, actor: str, reason: str) -> None:
    if job.status in ("COMPLETED", "CANCELLED"):
        return
    state.assert_delivery(job.status, "CANCELLED", actor if actor in ("admin", "system") else "system")
    DeliveryOffer.objects.filter(job=job, status="PENDING").update(status="WITHDRAWN", responded_at=timezone.now())
    rider_id = job.rider_id
    job.status, job.cancelled_at, job.cancel_reason = "CANCELLED", timezone.now(), reason[:240]
    job.save(update_fields=["status", "cancelled_at", "cancel_reason"])
    if rider_id:
        r = Rider.objects.get(pk=rider_id)
        Rider.objects.filter(pk=rider_id).update(presence="IDLE" if active_job_count(r) == 0 else "ASSIGNED")
        transaction.on_commit(lambda: broadcast(f"rider.{rider_id}", {"type": "job.cancelled", "jobId": str(job.id), "reason": reason}))


@transaction.atomic
def keep_searching(job: DeliveryJob, actor: str = "customer") -> DeliveryJob:
    job = DeliveryJob.objects.select_for_update().get(pk=job.pk)
    state.assert_delivery(job.status, "SEARCHING", actor)
    job.status, job.round, job.searching_since, job.no_rider_alerted_at = "SEARCHING", 0, timezone.now(), None
    DeliveryOffer.objects.filter(job=job, status__in=["EXPIRED", "DECLINED"]).delete()  # everyone gets a fresh chance
    job.save()
    from ..tasks import run_dispatch_round

    transaction.on_commit(lambda: run_dispatch_round.delay(str(job.id)))
    return job


def watchdog() -> dict[str, int]:
    """Every 30s: retry waiting jobs, alert on stuck searches, drop stale riders from the GEO set."""
    cfg = _cfg()
    now = timezone.now()
    alerted = 0
    for job in DeliveryJob.objects.filter(status__in=["SEARCHING", "OFFERED"], searching_since__lt=now - timedelta(minutes=cfg.noRiderAlertMinutes), no_rider_alerted_at__isnull=True).select_related("order", "store"):
        DeliveryJob.objects.filter(pk=job.pk).update(no_rider_alerted_at=now)
        broadcast("dispatch", {"type": "job.stuck", "jobId": str(job.id), "orderId": str(job.order_id), "number": job.order.number, "alert": True})
        _alert_dispatchers(f"{job.order.number} waiting for a rider", f"Searching for {cfg.noRiderAlertMinutes}+ minutes from {job.store.name}")
        alerted += 1
    for job in DeliveryJob.objects.filter(status="OFFERED"):
        if not DeliveryOffer.objects.filter(job=job, status="PENDING", expires_at__gt=now - timedelta(seconds=5)).exists():
            expire(str(job.id), list(DeliveryOffer.objects.filter(job=job, status="PENDING").values_list("id", flat=True)))
    stale = 0
    try:
        members = _r().zrange(GEO_KEY, 0, -1)
        for rid in members:
            last = int(_r().hget(RIDER_KEY.format(id=rid), "lastSeen") or 0)
            if time.time() - last > max(cfg.heartbeatTtlSeconds * 4, 300):
                _r().zrem(GEO_KEY, rid)
                Rider.objects.filter(id=rid, presence="IDLE").update(presence="OFFLINE", online_since=None)
                stale += 1
    except Exception:  # noqa: BLE001
        pass
    if cfg.mode != "manual":
        for job in DeliveryJob.objects.filter(status="SEARCHING").values_list("id", flat=True)[:50]:
            run_round(str(job))
    return {"alerted": alerted, "staleRiders": stale}


# ================================================================ output
def offer_out(o: DeliveryOffer) -> dict[str, Any]:
    j = o.job
    order = j.order
    return {
        "id": o.id, "jobId": str(j.id), "expiresAt": o.expires_at.isoformat(), "timeoutSeconds": max(0, int((o.expires_at - timezone.now()).total_seconds())),
        "earning": o.earning, "currency": j.currency, "distanceToStoreMeters": o.distance_to_store_m, "tripDistanceMeters": j.distance_m,
        "store": {"name": j.store.name, "address": j.store.address, "location": {"lat": j.pickup.y, "lng": j.pickup.x}},
        # Drop-off is approximate (~300m grid) until accepted — protects the customer's exact location.
        "dropoffArea": {"label": order.destination_area or "Customer area", "approx": {"lat": round(j.dropoff.y, 3), "lng": round(j.dropoff.x, 3)}},
        "items": order.items.count(),
    }


def job_out(j: DeliveryJob, *, for_rider: bool = False) -> dict[str, Any]:
    order = j.order
    show_exact = j.status in state.RIDER_HOLDS
    out = {
        "id": str(j.id), "status": j.status, "orderId": str(order.id), "orderNumber": order.number, "earning": j.earning, "currency": j.currency, "distanceMeters": j.distance_m,
        "store": {"id": str(j.store_id), "name": j.store.name, "address": j.store.address, "phone": j.store.phone or None, "location": {"lat": j.pickup.y, "lng": j.pickup.x}},
        "dropoff": {"location": {"lat": j.dropoff.y, "lng": j.dropoff.x}, "label": order.destination_label, "area": order.destination_area, "landmark": order.landmark_note or None} if show_exact or not for_rider else None,
        "customer": {"firstName": (order.contact_name or "Customer").split(" ")[0], "phone": order.contact_phone} if show_exact else None,
        "payment": {"method": order.payment_method, "collect": order.total if order.payment_method == "CASH_ON_DELIVERY" and order.payment_status != "PAID" else 0},
        "items": [{"title": i.title, "options": i.options_label, "qty": i.qty} for i in order.items.all()],
        "route": j.route_polyline or None, "routeLeg": j.route_leg or None, "etaSeconds": j.eta_seconds, "pinRequired": settings_service.get("delivery.dispatch").deliveryPinEnabled,
        "nextStep": {"ACCEPTED": "AT_STORE", "AT_STORE": "PICKED_UP", "PICKED_UP": "EN_ROUTE", "EN_ROUTE": "ARRIVED", "ARRIVED": "COMPLETED"}.get(j.status),
        "timeline": {k: getattr(j, f"{k}_at").isoformat() if getattr(j, f"{k}_at") else None for k in ("accepted", "at_store", "picked_up", "en_route", "arrived", "completed")},
        "navigationUrl": f"https://www.google.com/maps/dir/?api=1&destination={(j.pickup if j.status in ('ACCEPTED', 'AT_STORE') else j.dropoff).y},{(j.pickup if j.status in ('ACCEPTED', 'AT_STORE') else j.dropoff).x}&travelmode=driving" if show_exact else None,
    }
    return out
