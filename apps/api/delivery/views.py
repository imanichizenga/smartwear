from __future__ import annotations

from datetime import timedelta

from django.contrib.gis.geos import Point, Polygon
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import AdminPerm, IsRider
from accounts.phone import normalize_phone
from core import settings_service
from core.audit import audit
from core.crypto import decrypt_secret, encrypt_secret
from core.exceptions import ApiError
from core.media_urls import media_out
from core.pagination import keyset, page_params
from inventory.models import InventoryLevel, StockMovement, StockTransfer, Store

from . import state
from .models import DeliveryJob, DeliveryOffer, DeliveryZone, Rider, RiderDocument, RiderLocationPing, RiderPayout, Vehicle
from .services import dispatch, payouts


def _rider(request) -> Rider:
    return Rider.objects.select_related("user", "photo").prefetch_related("vehicles").get(user=request.user.user)


def _f(v, name: str) -> float:
    try:
        return float(v)
    except (TypeError, ValueError) as e:
        raise ApiError.bad_request(f"{name} is required") from e


def rider_self_out(r: Rider) -> dict:
    today = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    done = DeliveryJob.objects.filter(rider=r, status="COMPLETED", completed_at__gte=today)
    v = next((x for x in r.vehicles.all() if x.is_primary), None)
    return {
        "id": str(r.id), "status": r.status, "presence": r.presence, "name": r.user.name, "phone": r.user.phone, "photo": media_out(r.photo) if r.photo_id else None,
        "rating": round(r.rating_avg, 2), "ratingCount": r.rating_count, "deliveries": r.deliveries_count,
        "vehicle": {"type": v.type, "plate": v.plate, "color": v.color, "make": v.make} if v else None,
        "today": {"earnings": done.aggregate(s=Sum("earning"))["s"] or 0, "deliveries": done.count(), "onlineMinutes": int((timezone.now() - r.online_since).total_seconds() // 60) if r.online_since else 0},
        "homeStore": {"id": str(r.home_store_id), "name": r.home_store.name} if r.home_store_id else None,
        "currency": settings_service.get("delivery.pricing").currency, "offerTimeoutSeconds": settings_service.get("delivery.dispatch").offerTimeoutSeconds,
    }


# ================================================================ rider app
class RiderMeView(APIView):
    permission_classes = [IsRider]

    def get(self, request):
        r = _rider(request)
        stores = [{"id": str(s.id), "name": s.name, "location": {"lat": s.location.y, "lng": s.location.x}} for s in Store.objects.filter(is_active=True)]
        active = DeliveryJob.objects.filter(rider=r, status__in=state.RIDER_HOLDS).select_related("order", "store").prefetch_related("order__items").first()
        pending = DeliveryOffer.objects.filter(rider=r, status="PENDING", expires_at__gt=timezone.now()).select_related("job__order", "job__store").first()
        return Response({"rider": rider_self_out(r), "stores": stores, "activeJob": dispatch.job_out(active, for_rider=True) if active else None, "pendingOffer": dispatch.offer_out(pending) if pending else None})


class RiderPresenceView(APIView):
    permission_classes = [IsRider]

    def post(self, request):
        r = _rider(request)
        if request.data.get("online"):
            dispatch.go_online(r, _f(request.data.get("lat"), "lat"), _f(request.data.get("lng"), "lng"))
        else:
            dispatch.go_offline(r)
        return Response(rider_self_out(_rider(request)))


class RiderLocationView(APIView):
    """Batched background updates: {points: [{lat,lng,heading,speed,accuracy,battery,at}]} — the last point wins."""

    permission_classes = [IsRider]

    def post(self, request):
        r = _rider(request)
        pts = request.data.get("points") or [request.data]
        res = None
        for p in pts[-20:]:
            at = parse_datetime(p["at"]) if p.get("at") else None
            if at and at > timezone.now() + timedelta(seconds=30):
                at = None
            res = dispatch.update_location(r, lat=_f(p.get("lat"), "lat"), lng=_f(p.get("lng"), "lng"), heading=p.get("heading"), speed=p.get("speed"), accuracy=p.get("accuracy"), battery=p.get("battery"), recorded_at=at)
        return Response(res or {"ok": True})


class RiderOfferView(APIView):
    permission_classes = [IsRider]

    def post(self, request, offer_id: int, action: str):
        r = _rider(request)
        if action == "accept":
            job = dispatch.accept(r, offer_id)
            return Response({"job": dispatch.job_out(DeliveryJob.objects.select_related("order", "store").get(id=job.id), for_rider=True)})
        if action == "decline":
            dispatch.decline(r, offer_id, request.data.get("reason") or "")
            return Response({"ok": True})
        raise ApiError.not_found("Action")


class RiderJobView(APIView):
    permission_classes = [IsRider]

    def _job(self, request, jid) -> DeliveryJob:
        j = DeliveryJob.objects.select_related("order", "store", "rider").prefetch_related("order__items").filter(id=jid, rider__user=request.user.user).first()
        if j is None:
            raise ApiError.not_found("Delivery")
        return j

    def get(self, request, jid):
        return Response(dispatch.job_out(self._job(request, jid), for_rider=True))

    def post(self, request, jid):
        """{step: AT_STORE|PICKED_UP|EN_ROUTE|ARRIVED|COMPLETED, pin?, photoMediaId?, lat?, lng?, scan?} or {release: reason}"""
        job = self._job(request, jid)
        r = _rider(request)
        d = request.data or {}
        if d.get("release"):
            dispatch.rider_release(job, r, d["release"])
            return Response({"ok": True, "released": True})
        step = d.get("step")
        if step not in dispatch.RIDER_STEPS:
            raise ApiError.bad_request("Unknown step")
        if step == "PICKED_UP" and d.get("scan") and d["scan"] != f"SWPICK:{job.order_id}":
            raise ApiError.bad_request("That QR code belongs to a different order")
        photo = d.get("photoMediaId")
        if photo:
            from media.models import Media

            if not Media.objects.filter(id=photo, owner_user=request.user.user).exists():
                raise ApiError.bad_request("Upload the photo first")
        if step == "EN_ROUTE" and job.status == "AT_STORE":
            dispatch.advance(job, "PICKED_UP", actor="rider", actor_id=str(r.user_id), photo_id=photo)
            job.refresh_from_db()
        job = dispatch.advance(job, step, actor="rider", actor_id=str(r.user_id), pin=d.get("pin"), photo_id=photo, lat=d.get("lat"), lng=d.get("lng"))
        if step == "PICKED_UP" and d.get("startDelivery", True):
            job = dispatch.advance(job, "EN_ROUTE", actor="rider", actor_id=str(r.user_id))
        return Response(dispatch.job_out(DeliveryJob.objects.select_related("order", "store").get(id=job.id), for_rider=True))


class RiderHistoryView(APIView):
    permission_classes = [IsRider]

    def get(self, request):
        r = _rider(request)
        cursor, limit = page_params(request, 20, 50)
        qs = DeliveryJob.objects.filter(rider=r, status__in=["COMPLETED", "CANCELLED"]).select_related("order", "store")
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        week = timezone.now() - timedelta(days=7)
        days = list(DeliveryJob.objects.filter(rider=r, status="COMPLETED", completed_at__gte=week).annotate(d=TruncDate("completed_at")).values("d").annotate(e=Sum("earning"), n=Count("id")).order_by("d"))
        return Response({
            "items": [{"id": str(j.id), "orderNumber": j.order.number, "status": j.status, "store": j.store.name, "area": j.order.destination_area or None, "earning": j.earning if j.status == "COMPLETED" else 0, "distanceMeters": j.distance_m, "completedAt": j.completed_at.isoformat() if j.completed_at else None, "rating": getattr(getattr(j, "rating", None), "rating", None)} for j in rows],
            "nextCursor": nxt, "week": [{"date": str(x["d"]), "earnings": x["e"], "deliveries": x["n"]} for x in days],
            "totals": DeliveryJob.objects.filter(rider=r, status="COMPLETED").aggregate(earnings=Sum("earning"), deliveries=Count("id")),
            "balance": payouts.owed(r),
            "payouts": [payouts.payout_out(p) for p in r.payouts.select_related("rider__user", "created_by")[:10]],
        })


class RiderDocumentsView(APIView):
    permission_classes = [IsRider]

    def get(self, request):
        r = _rider(request)
        return Response({"items": [{"id": d.id, "kind": d.kind, "number": d.number[-4:] if d.number else None, "expiresAt": d.expires_at.isoformat() if d.expires_at else None, "verified": d.verified_at is not None, "media": media_out(d.media)} for d in r.documents.select_related("media")]})


# ================================================================ admin: rider payouts
class AdminPayoutsView(APIView):
    """GET: what every rider is owed + recent payouts. POST: pay a rider (Snippe or recorded manually)."""

    def get_permissions(self):
        return [AdminPerm("riders.view")()] if self.request.method == "GET" else [AdminPerm("payouts.manage")()]

    def get(self, request):
        qs = RiderPayout.objects.select_related("rider__user", "created_by")
        if rid := request.query_params.get("riderId"):
            qs = qs.filter(rider_id=rid)
        if st := request.query_params.get("status"):
            qs = qs.filter(status=st.upper())
        cfg = settings_service.get("payments")
        return Response({
            "balances": payouts.balances(),
            "items": [payouts.payout_out(p) for p in qs[:100]],
            "config": {"provider": cfg.riderPayoutsProvider, "snippeReady": bool(cfg.snippeApiKey) and cfg.riderPayoutsProvider == "snippe", "minimum": cfg.riderPayoutMinimum, "currency": "TZS"},
        })

    def post(self, request):
        d = request.data or {}
        r = Rider.objects.select_related("user").filter(id=d.get("riderId")).first()
        if r is None:
            raise ApiError.not_found("Rider")
        amount = d.get("amount")
        p = payouts.create(r, amount=int(amount) if amount not in (None, "") else None, method=str(d.get("method") or "snippe"), admin=request.user.admin, note=str(d.get("note") or ""), request=request)
        return Response(payouts.payout_out(p), status=201)


class AdminPayoutSyncView(APIView):
    permission_classes = [AdminPerm("payouts.manage")]

    def post(self, request, pid):
        p = RiderPayout.objects.select_related("rider__user", "created_by").filter(id=pid).first()
        if p is None:
            raise ApiError.not_found("Payout")
        if p.method != "snippe":
            raise ApiError.bad_request("Only Snippe payouts can be re-checked")
        return Response(payouts.payout_out(payouts.sync(p)))


class AdminPayoutFeeView(APIView):
    permission_classes = [AdminPerm("riders.view")]

    def get(self, request):
        from commerce.services import snippe

        try:
            amount = int(request.query_params.get("amount") or 0)
        except ValueError as e:
            raise ApiError.bad_request("amount must be a number") from e
        if amount <= 0 or not snippe.payouts_configured():
            return Response({"amount": amount, "fee": None, "total": None})
        d = snippe.payout_fee(amount)
        return Response({"amount": amount, "fee": d.get("fee_amount"), "total": d.get("total_amount")})


# ================================================================ admin: riders
def rider_admin_out(r: Rider, *, full: bool = False) -> dict:
    v = next((x for x in r.vehicles.all() if x.is_primary), None)
    docs = list(r.documents.all())
    soon = timezone.localdate() + timedelta(days=30)
    out = {
        "id": str(r.id), "userId": str(r.user_id), "name": r.user.name, "phone": r.user.phone, "status": r.status, "presence": r.presence, "photo": media_out(r.photo) if r.photo_id else None,
        "rating": round(r.rating_avg, 2), "ratingCount": r.rating_count, "deliveries": r.deliveries_count, "vehicle": {"type": v.type, "plate": v.plate, "color": v.color, "make": v.make} if v else None,
        "zone": {"id": str(r.zone_id), "name": r.zone.name} if r.zone_id else None, "homeStore": {"id": str(r.home_store_id), "name": r.home_store.name} if r.home_store_id else None,
        "location": {"lat": r.last_location.y, "lng": r.last_location.x, "heading": r.last_heading, "at": r.last_seen_at.isoformat() if r.last_seen_at else None} if r.last_location else None,
        "documentAlerts": [{"kind": d.kind, "expiresAt": d.expires_at.isoformat(), "expired": d.expires_at < timezone.localdate()} for d in docs if d.expires_at and d.expires_at <= soon],
        "invitedAt": r.invited_at.isoformat() if r.invited_at else None, "approvedAt": r.approved_at.isoformat() if r.approved_at else None, "signedIn": r.user.phone_verified_at is not None,
    }
    if full:
        key = settings_service.key_ring()
        out.update({
            "nationalIdLast4": r.national_id_last4 or None, "licenceNumber": r.licence_number or None, "payoutMethod": r.payout_method or None,
            "payout": _decrypt_json(r.payout_details, key), "notes": r.notes, "suspendedReason": r.suspended_reason or None,
            "documents": [{"id": d.id, "kind": d.kind, "number": d.number, "expiresAt": d.expires_at.isoformat() if d.expires_at else None, "verified": d.verified_at is not None, "media": media_out(d.media)} for d in docs],
            "earnings": DeliveryJob.objects.filter(rider=r, status="COMPLETED").aggregate(total=Sum("earning"), n=Count("id")),
            "balance": payouts.owed(r),
            "recentJobs": [{"id": str(j.id), "orderNumber": j.order.number, "status": j.status, "completedAt": j.completed_at.isoformat() if j.completed_at else None, "earning": j.earning} for j in DeliveryJob.objects.filter(rider=r).select_related("order").order_by("-created_at")[:15]],
        })
    return out


def _decrypt_json(v: str, ring) -> dict | None:
    if not v:
        return None
    import json

    try:
        d = json.loads(decrypt_secret(v, ring))
    except Exception:  # noqa: BLE001
        return None
    if d.get("account"):
        d["account"] = "•••" + str(d["account"])[-4:]
    return d


class AdminRidersView(APIView):
    def get_permissions(self):
        return [AdminPerm("riders.view")()] if self.request.method == "GET" else [AdminPerm("riders.manage")()]

    def get(self, request):
        q = request.query_params
        qs = Rider.objects.select_related("user", "photo", "zone", "home_store").prefetch_related("vehicles", "documents")
        if q.get("status"):
            qs = qs.filter(status=q["status"])
        if q.get("presence"):
            qs = qs.filter(presence__in=q["presence"].split(","))
        if q.get("q"):
            qs = qs.filter(Q(user__name__icontains=q["q"]) | Q(user__phone__icontains=q["q"]) | Q(vehicles__plate__icontains=q["q"])).distinct()
        rows = list(qs.order_by("-created_at")[:500])
        return Response({"items": [rider_admin_out(r) for r in rows], "counts": dict(Rider.objects.values("status").annotate(n=Count("id")).values_list("status", "n"))})

    @transaction.atomic
    def post(self, request):
        """Registration wizard in one submit: identity, documents, vehicle, assignment, payout → SMS invite."""
        d = request.data or {}
        phone = normalize_phone(d.get("phone") or "")
        name = (d.get("name") or "").strip()
        if not name:
            raise ApiError.bad_request("Name is required", details={"field": "name", "step": 1})
        user = User.objects.filter(phone=phone, deleted_at__isnull=True).first()
        if user and hasattr(user, "rider"):
            raise ApiError.conflict("rider_exists", "A rider with this phone already exists", details={"field": "phone", "step": 1})
        user = user or User.objects.create(phone=phone, name=name)
        if not user.name:
            user.name = name
            user.save(update_fields=["name"])
        nid = "".join(ch for ch in (d.get("nationalId") or "") if ch.isalnum())
        if nid and len(nid) != 20:
            raise ApiError.bad_request("NIDA numbers have 20 digits", details={"field": "nationalId", "step": 2})
        vt = (d.get("vehicle") or {}).get("type")
        if vt not in dict(Vehicle._meta.get_field("type").choices):
            raise ApiError.bad_request("Choose the vehicle type", details={"field": "vehicle.type", "step": 3})
        if vt in ("MOTORBIKE", "CAR") and not (d.get("vehicle") or {}).get("plate"):
            raise ApiError.bad_request("Plate number is required for motorbikes and cars", details={"field": "vehicle.plate", "step": 3})
        ring = settings_service.key_ring()
        import json

        r = Rider.objects.create(
            user=user, status="ACTIVE" if d.get("approve", True) else "PENDING", photo_id=d.get("photoMediaId"), national_id=encrypt_secret(nid, ring) if nid else "", national_id_last4=nid[-4:] if nid else "",
            licence_number=(d.get("licenceNumber") or "")[:40], zone_id=d.get("zoneId"), home_store_id=d.get("homeStoreId"), payout_method=(d.get("payout") or {}).get("method", "")[:20],
            payout_details=encrypt_secret(json.dumps(d["payout"]), ring) if d.get("payout") else "", notes=(d.get("notes") or "")[:2000],
            approved_at=timezone.now() if d.get("approve", True) else None, approved_by=request.user.admin if d.get("approve", True) else None,
        )
        v = d["vehicle"]
        Vehicle.objects.create(rider=r, type=vt, plate=(v.get("plate") or "").upper()[:16], color=(v.get("color") or "")[:24], make=(v.get("make") or "")[:40], is_primary=True)
        for doc in d.get("documents") or []:
            RiderDocument.objects.create(rider=r, kind=doc["kind"], media_id=doc["mediaId"], number=(doc.get("number") or "")[:60], expires_at=doc.get("expiresAt") or None, verified_at=timezone.now(), verified_by=request.user.admin)
        audit("rider.register", "rider", r.id, request=request, after={"phone": phone, "name": name, "vehicle": vt})
        invite = _send_invite(r) if d.get("sendInvite", True) else {"sent": False}
        return Response({**rider_admin_out(Rider.objects.select_related("user").prefetch_related("vehicles", "documents").get(id=r.id), full=True), "invite": invite}, status=201)


def _send_invite(r: Rider) -> dict:
    from core.integrations.beem import BeemClient, render_template

    cfg = settings_service.get("sms.beem")
    link = settings_service.get("branding").appDownloadLink or settings_service.get("branding").playStoreUrl or "the SmartWear app"
    text = render_template(cfg.riderInviteTemplate, name=r.user.name.split(" ")[0], appLink=link)
    client = BeemClient(cfg)
    if not client.configured:
        return {"sent": False, "reason": "SMS (Beem) is not configured — share the app link manually", "message": text}
    try:
        res = client.send_sms([r.user.phone], text)
    except ApiError as e:
        return {"sent": False, "reason": e.message, "message": text}
    if res.ok:
        Rider.objects.filter(pk=r.pk).update(invited_at=timezone.now())
    return {"sent": res.ok, "reason": None if res.ok else res.message, "requestId": res.request_id}


class AdminRiderView(APIView):
    def get_permissions(self):
        return [AdminPerm("riders.view")()] if self.request.method == "GET" else [AdminPerm("riders.manage")()]

    def _get(self, rid) -> Rider:
        r = Rider.objects.select_related("user", "photo", "zone", "home_store").prefetch_related("vehicles", "documents__media").filter(id=rid).first()
        if r is None:
            raise ApiError.not_found("Rider")
        return r

    def get(self, request, rid):
        return Response(rider_admin_out(self._get(rid), full=True))

    def patch(self, request, rid):
        r = self._get(rid)
        d = request.data or {}
        before = {"status": r.status}
        if "status" in d:
            if d["status"] not in dict(Rider.STATUSES):
                raise ApiError.bad_request("Unknown status")
            if d["status"] in ("SUSPENDED", "OFFBOARDED"):
                if dispatch.active_job_count(r):
                    raise ApiError.conflict("active_job", "Reassign their current delivery first")
                r.suspended_reason = (d.get("reason") or "")[:240]
                if r.presence != "OFFLINE":
                    dispatch.go_offline(r)
                from accounts.tokens import revoke_all

                revoke_all(r.user, "rider_suspended")
            if d["status"] == "ACTIVE" and not r.approved_at:
                r.approved_at, r.approved_by = timezone.now(), request.user.admin
            r.status = d["status"]
        for k, f in (("zoneId", "zone_id"), ("homeStoreId", "home_store_id"), ("photoMediaId", "photo_id"), ("notes", "notes"), ("licenceNumber", "licence_number")):
            if k in d:
                setattr(r, f, d[k])
        if "name" in d:
            r.user.name = (d["name"] or r.user.name)[:120]
            r.user.save(update_fields=["name"])
        if "vehicle" in d:
            v = d["vehicle"]
            Vehicle.objects.filter(rider=r, is_primary=True).update(is_primary=False)
            Vehicle.objects.create(rider=r, type=v["type"], plate=(v.get("plate") or "").upper()[:16], color=(v.get("color") or "")[:24], make=(v.get("make") or "")[:40], is_primary=True)
        r.save()
        audit("rider.update", "rider", r.id, request=request, before=before, after={"status": r.status})
        return Response(rider_admin_out(self._get(rid), full=True))


class AdminRiderInviteView(APIView):
    permission_classes = [AdminPerm("riders.manage")]

    def post(self, request, rid):
        r = Rider.objects.select_related("user").filter(id=rid).first()
        if r is None:
            raise ApiError.not_found("Rider")
        return Response(_send_invite(r))


class AdminRiderRouteView(APIView):
    """Route replay: location breadcrumbs for one job or a time window."""

    permission_classes = [AdminPerm("riders.view")]

    def get(self, request, rid):
        q = request.query_params
        qs = RiderLocationPing.objects.filter(rider_id=rid)
        if q.get("jobId"):
            qs = qs.filter(job_id=q["jobId"])
        else:
            start = parse_datetime(q.get("from") or "") or timezone.now() - timedelta(hours=8)
            end = parse_datetime(q.get("to") or "") or timezone.now()
            qs = qs.filter(recorded_at__gte=start, recorded_at__lte=end)
        pts = list(qs.order_by("recorded_at").values_list("location", "heading", "speed_mps", "recorded_at")[:5000])
        return Response({"points": [{"lat": p.y, "lng": p.x, "heading": h, "speed": s, "at": t.isoformat()} for p, h, s, t in pts]})


# ================================================================ admin: dispatch control room
class AdminDispatchView(APIView):
    permission_classes = [AdminPerm("dispatch.view")]

    def get(self, request):
        from commerce.services.orders import sla

        stores = [{"id": str(s.id), "name": s.name, "code": s.code, "location": {"lat": s.location.y, "lng": s.location.x}, "kind": s.kind} for s in Store.objects.filter(is_active=True)]
        riders = [rider_admin_out(r) for r in Rider.objects.filter(status="ACTIVE").exclude(presence="OFFLINE").select_related("user", "photo", "zone", "home_store").prefetch_related("vehicles", "documents")]
        jobs = DeliveryJob.objects.filter(status__in=state.DELIVERY_ACTIVE + ["NO_RIDER"]).select_related("order__user", "order__store", "store", "rider__user").prefetch_related("order__items", "order__payments")
        active = []
        for j in jobs:
            o = j.order
            active.append({
                "jobId": str(j.id), "orderId": str(o.id), "number": o.number, "status": j.status, "orderStatus": o.status, "placedAt": o.placed_at.isoformat(), "store": {"id": str(j.store_id), "name": j.store.name},
                "dropoff": {"lat": j.dropoff.y, "lng": j.dropoff.x, "area": o.destination_area or o.destination_label}, "rider": {"id": str(j.rider_id), "name": j.rider.user.name} if j.rider_id else None,
                "etaSeconds": j.eta_seconds, "route": j.route_polyline or None, "searchingSince": j.searching_since.isoformat() if j.searching_since else None, "ready": o.ready_at is not None,
                "sla": sla(o), "total": o.total, "items": o.items.count(), "pendingOffers": j.offers.filter(status="PENDING").count(),
            })
        cfg = settings_service.get("delivery.dispatch")
        return Response({"mode": cfg.mode, "stores": stores, "riders": riders, "jobs": active, "zones": [zone_out(z) for z in DeliveryZone.objects.filter(is_active=True)]})


class AdminDispatchAutoView(APIView):
    permission_classes = [AdminPerm("dispatch.assign")]

    def post(self, request, jid):
        j = DeliveryJob.objects.filter(id=jid).first()
        if j is None:
            raise ApiError.not_found("Delivery")
        if j.status == "NO_RIDER":
            dispatch.keep_searching(j, "admin")
            return Response({"ok": True, "restarted": True})
        if j.status == "OFFERED":
            return Response({"ok": True, "pending": True})
        prev_mode = settings_service.get("delivery.dispatch").mode
        if prev_mode == "manual":
            # Manual mode: a one-off auto round on the dispatcher's request.
            from .services.dispatch import online_candidates, rank

            ranked = rank(j, online_candidates(j.pickup.y, j.pickup.x, settings_service.get("delivery.dispatch").maxRadiusMeters))
            if not ranked:
                raise ApiError.conflict("no_riders", "No eligible riders online near the store")
            dispatch.manual_assign(j, ranked[0][0], admin=request.user.admin)
            return Response({"ok": True, "riderId": str(ranked[0][0].id)})
        return Response(dispatch.run_round(str(j.id)))


# ================================================================ admin: zones & stores & stock
def zone_out(z: DeliveryZone) -> dict:
    return {"id": str(z.id), "name": z.name, "polygon": [[x, y] for x, y in z.polygon.coords[0]], "flatFee": z.flat_fee, "surcharge": z.surcharge, "serviceable": z.serviceable, "priority": z.priority, "color": z.color, "isActive": z.is_active}


def _polygon(coords) -> Polygon:
    if not coords or len(coords) < 3:
        raise ApiError.bad_request("Draw at least three points")
    ring = [(float(x), float(y)) for x, y in coords]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    poly = Polygon(ring, srid=4326)
    if not poly.valid:
        raise ApiError.bad_request("The zone outline crosses itself — redraw it")
    return poly


class AdminZonesView(APIView):
    def get_permissions(self):
        return [AdminPerm("dispatch.view")()] if self.request.method == "GET" else [AdminPerm("settings.manage")()]

    def get(self, request):
        return Response({"items": [zone_out(z) for z in DeliveryZone.objects.all()]})

    def post(self, request):
        d = request.data or {}
        z = DeliveryZone.objects.create(name=(d.get("name") or "Zone")[:80], polygon=_polygon(d.get("polygon")), flat_fee=d.get("flatFee"), surcharge=int(d.get("surcharge") or 0), serviceable=d.get("serviceable", True), priority=int(d.get("priority") or 0), color=d.get("color") or "#B8955A")
        audit("zone.create", "zone", z.id, request=request, after=zone_out(z))
        return Response(zone_out(z), status=201)


class AdminZoneView(APIView):
    permission_classes = [AdminPerm("settings.manage")]

    def patch(self, request, zid):
        z = DeliveryZone.objects.filter(id=zid).first()
        if z is None:
            raise ApiError.not_found("Zone")
        d = request.data or {}
        before = zone_out(z)
        if "polygon" in d:
            z.polygon = _polygon(d["polygon"])
        for k, f in (("name", "name"), ("flatFee", "flat_fee"), ("surcharge", "surcharge"), ("serviceable", "serviceable"), ("priority", "priority"), ("color", "color"), ("isActive", "is_active")):
            if k in d:
                setattr(z, f, d[k])
        z.save()
        audit("zone.update", "zone", z.id, request=request, before=before, after=zone_out(z))
        return Response(zone_out(z))

    def delete(self, request, zid):
        DeliveryZone.objects.filter(id=zid).delete()
        return Response({"ok": True})


def store_out(s: Store) -> dict:
    return {"id": str(s.id), "code": s.code, "name": s.name, "kind": s.kind, "address": s.address, "area": s.area or None, "city": s.city, "location": {"lat": s.location.y, "lng": s.location.x}, "phone": s.phone or None, "email": s.email or None, "hours": s.hours, "serviceableRadiusMeters": s.serviceable_radius_m, "fulfilsDelivery": s.fulfils_delivery, "allowsPickup": s.allows_pickup, "isActive": s.is_active}


class AdminStoresView(APIView):
    def get_permissions(self):
        return [AdminPerm("inventory.view")()] if self.request.method == "GET" else [AdminPerm("stores.manage")()]

    def get(self, request):
        return Response({"items": [store_out(s) for s in Store.objects.all()]})

    def post(self, request):
        s = Store()
        _apply_store(s, request.data or {})
        audit("store.create", "store", s.id, request=request, after=store_out(s))
        return Response(store_out(s), status=201)


class AdminStoreView(APIView):
    permission_classes = [AdminPerm("stores.manage")]

    def patch(self, request, sid):
        s = Store.objects.filter(id=sid).first()
        if s is None:
            raise ApiError.not_found("Store")
        before = store_out(s)
        _apply_store(s, request.data or {})
        audit("store.update", "store", s.id, request=request, before=before, after=store_out(s))
        return Response(store_out(s))


def _apply_store(s: Store, d: dict) -> None:
    from slugify import slugify

    if "name" in d or not s.name:
        if not (d.get("name") or "").strip():
            raise ApiError.bad_request("Name is required")
        s.name = d["name"].strip()[:80]
    if not s.code:
        base = slugify(d.get("code") or s.name)[:20]
        code, i = base, 2
        while Store.objects.filter(code=code).exists():
            code, i = f"{base}-{i}", i + 1
        s.code = code
    if "location" in d or s.location is None:
        loc = d.get("location") or {}
        s.location = Point(_f(loc.get("lng"), "location.lng"), _f(loc.get("lat"), "location.lat"), srid=4326)
    for k, f in (("kind", "kind"), ("address", "address"), ("area", "area"), ("city", "city"), ("phone", "phone"), ("email", "email"), ("hours", "hours"), ("serviceableRadiusMeters", "serviceable_radius_m"), ("fulfilsDelivery", "fulfils_delivery"), ("allowsPickup", "allows_pickup"), ("isActive", "is_active")):
        if k in d:
            setattr(s, f, d[k] if d[k] is not None else "")
    if not s.address:
        raise ApiError.bad_request("Address is required")
    s.save()


class AdminInventoryView(APIView):
    def get_permissions(self):
        return [AdminPerm("inventory.view")()] if self.request.method == "GET" else [AdminPerm("inventory.manage")()]

    def get(self, request):
        from django.db.models import F

        q = request.query_params
        cursor, limit = page_params(request, 100, 300)
        qs = InventoryLevel.objects.select_related("variant__product", "store").prefetch_related("variant__option_values")
        if q.get("storeId"):
            qs = qs.filter(store_id=q["storeId"])
        if q.get("low") == "1":
            qs = qs.filter(on_hand__lte=F("low_stock_threshold"))
        if q.get("q"):
            qs = qs.filter(Q(variant__sku__icontains=q["q"]) | Q(variant__product__title__icontains=q["q"]))
        rows, nxt = keyset(qs, ["variant__product__title", "id"], cursor, limit)
        return Response({"items": [{"id": l.id, "store": {"id": str(l.store_id), "name": l.store.name}, "variantId": str(l.variant_id), "sku": l.variant.sku, "product": {"id": str(l.variant.product_id), "title": l.variant.product.title}, "options": " · ".join(o.value for o in l.variant.option_values.all()), "onHand": l.on_hand, "reserved": l.reserved, "available": l.available, "lowStockThreshold": l.low_stock_threshold, "low": l.on_hand <= l.low_stock_threshold, "updatedAt": l.updated_at.isoformat()} for l in rows], "nextCursor": nxt})

    def post(self, request):
        """Adjustment: {storeId, variantId, delta | setTo, reason, note}"""
        from catalog.models import ProductVariant
        from inventory.services import adjust, set_stock

        d = request.data or {}
        store = Store.objects.filter(id=d.get("storeId")).first()
        v = ProductVariant.objects.filter(id=d.get("variantId")).first()
        if store is None or v is None:
            raise ApiError.not_found("Store or variant")
        if "setTo" in d:
            lvl = set_stock(store, v, int(d["setTo"]), low_threshold=d.get("lowStockThreshold"), admin=request.user.admin, reason="count", note=d.get("note") or "Stock count")
        else:
            lvl = adjust(store, v, int(d.get("delta") or 0), reason=d.get("reason") or "adjust", note=d.get("note") or "", admin=request.user.admin, request=request)
        return Response({"onHand": lvl.on_hand, "reserved": lvl.reserved, "available": lvl.available})


class AdminStockMovementsView(APIView):
    permission_classes = [AdminPerm("inventory.view")]

    def get(self, request):
        cursor, limit = page_params(request, 100, 300)
        qs = StockMovement.objects.select_related("store", "variant", "actor", "order")
        if request.query_params.get("variantId"):
            qs = qs.filter(variant_id=request.query_params["variantId"])
        rows, nxt = keyset(qs, ["-created_at", "-id"], cursor, limit)
        return Response({"items": [{"id": m.id, "store": m.store.name, "sku": m.variant.sku, "deltaOnHand": m.delta_on_hand, "deltaReserved": m.delta_reserved, "reason": m.reason, "note": m.note, "order": m.order.number if m.order_id else None, "by": m.actor.name if m.actor_id else None, "at": m.created_at.isoformat()} for m in rows], "nextCursor": nxt})


class AdminTransfersView(APIView):
    permission_classes = [AdminPerm("inventory.manage")]

    def get(self, request):
        return Response({"items": [{"id": str(t.id), "from": t.from_store.name, "to": t.to_store.name, "status": t.status, "lines": t.lines, "note": t.note, "createdAt": t.created_at.isoformat(), "shippedAt": t.shipped_at.isoformat() if t.shipped_at else None, "receivedAt": t.received_at.isoformat() if t.received_at else None} for t in StockTransfer.objects.select_related("from_store", "to_store").order_by("-created_at")[:200]]})

    def post(self, request):
        d = request.data or {}
        lines = [{"variantId": str(x["variantId"]), "qty": int(x["qty"])} for x in d.get("lines") or [] if int(x.get("qty", 0)) > 0]
        if not lines:
            raise ApiError.bad_request("Add at least one line")
        t = StockTransfer.objects.create(from_store_id=d.get("fromStoreId"), to_store_id=d.get("toStoreId"), lines=lines, note=(d.get("note") or "")[:240], created_by=request.user.admin)
        return Response({"id": str(t.id)}, status=201)


class AdminTransferView(APIView):
    permission_classes = [AdminPerm("inventory.manage")]

    def post(self, request, tid, action: str):
        from inventory.services import receive_transfer, ship_transfer

        t = StockTransfer.objects.filter(id=tid).first()
        if t is None:
            raise ApiError.not_found("Transfer")
        if action == "ship":
            ship_transfer(t, admin=request.user.admin)
        elif action == "receive":
            receive_transfer(t, admin=request.user.admin)
        elif action == "cancel" and t.status == "DRAFT":
            t.status = "CANCELLED"
            t.save(update_fields=["status"])
        else:
            raise ApiError.bad_request("Unknown action")
        audit(f"transfer.{action}", "transfer", t.id, request=request)
        return Response({"ok": True, "status": t.status})
