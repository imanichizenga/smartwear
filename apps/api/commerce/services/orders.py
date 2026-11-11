"""Order lifecycle — the only code that changes Order.status."""
from __future__ import annotations

import logging
import secrets
from typing import Any

from django.db import connection, transaction
from django.utils import timezone

from core import settings_service
from core.crypto import decrypt_secret, encrypt_secret
from core.exceptions import ApiError
from core.media_urls import media_out
from delivery import state
from notifications.realtime import broadcast
from notifications.service import notify

from ..models import LoyaltyLedger, Order, OrderEvent

logger = logging.getLogger("smartwear.orders")
ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
TIMESTAMP_FIELD = {"CONFIRMED": "confirmed_at", "READY_FOR_PICKUP": "ready_at", "PICKED_UP": "picked_up_at", "DELIVERED": "delivered_at", "CANCELLED": "cancelled_at"}
NOTIFY_KEY = {"CONFIRMED": "order.confirmed", "ASSIGNED": "order.rider_assigned", "ON_THE_WAY": "order.on_the_way", "ARRIVED": "order.arrived", "DELIVERED": "order.delivered", "CANCELLED": "order.cancelled"}


def next_order_number() -> str:
    with connection.cursor() as c:
        c.execute("SELECT nextval('commerce_order_number_seq')")
        n = c.fetchone()[0]
    s = ""
    while True:
        s = ALPHABET[n % 32] + s
        n //= 32
        if n == 0:
            break
    s = s.rjust(6, "2")
    return f"SW-{s[:4]}-{s[4:]}"


def new_pin() -> tuple[str, str]:
    n = settings_service.get("delivery.dispatch").deliveryPinLength
    pin = "".join(str(secrets.randbelow(10)) for _ in range(n))
    return pin, encrypt_secret(pin, settings_service.key_ring())


def reveal_pin(order: Order) -> str | None:
    if not order.delivery_pin:
        return None
    try:
        return decrypt_secret(order.delivery_pin, settings_service.key_ring())
    except Exception:  # noqa: BLE001
        return None


def add_event(order: Order, type_: str, *, actor: str, actor_id: str = "", frm: str = "", to: str = "", data: dict | None = None) -> OrderEvent:
    return OrderEvent.objects.create(order=order, type=type_, from_status=frm, to_status=to, actor_type=actor, actor_id=str(actor_id or ""), data=data or {})


@transaction.atomic
def transition(order: Order, to: str, *, actor: str, actor_id: str = "", reason: str = "", data: dict | None = None, notify_customer: bool = True) -> Order:
    order = Order.objects.select_for_update().get(pk=order.pk)
    frm = order.status
    if frm == to:
        return order
    state.assert_order(frm, to, actor)
    order.status = to
    field = TIMESTAMP_FIELD.get(to)
    if field and getattr(order, field) is None:
        setattr(order, field, timezone.now())
    if to == "CANCELLED":
        order.cancel_reason = reason[:240]
    order.save()
    add_event(order, "status", actor=actor, actor_id=actor_id, frm=frm, to=to, data={"reason": reason, **(data or {})} if reason or data else {})
    _side_effects(order, frm, to, actor=actor, reason=reason)
    payload = {"type": "order.status", "orderId": str(order.id), "number": order.number, "status": to, "from": frm, "at": timezone.now().isoformat()}
    transaction.on_commit(lambda: (broadcast(f"order.{order.id}", payload), broadcast("dispatch", payload)))
    if notify_customer and NOTIFY_KEY.get(to):
        vars_ = {"orderNumber": order.number, "pin": reveal_pin(order) or "", "eta": _eta_label(order)}
        if to == "ASSIGNED" and hasattr(order, "delivery") and order.delivery.rider_id:
            vars_["riderName"] = order.delivery.rider.user.name.split(" ")[0] or "Your rider"
        notify(order.user, NOTIFY_KEY[to], vars_, data={"orderId": str(order.id), "status": to})
    return order


def _eta_label(order: Order) -> str:
    job = getattr(order, "delivery", None)
    if job and job.eta_seconds:
        return f"{max(1, round(job.eta_seconds / 60))} min"
    if order.eta_max_minutes:
        return f"{order.eta_min_minutes}–{order.eta_max_minutes} min"
    return ""


def _side_effects(order: Order, frm: str, to: str, *, actor: str, reason: str) -> None:
    from inventory.services import commit_sale, release_for_order

    if to == "CANCELLED":
        if frm not in ("PICKED_UP", "ON_THE_WAY", "ARRIVED"):
            release_for_order(order)
        job = getattr(order, "delivery", None)
        if job and job.status in state.DELIVERY_ACTIVE:
            from delivery.services.dispatch import cancel_job

            cancel_job(job, actor="system", reason=reason or "Order cancelled")
        for p in order.payments.filter(status__in=["PENDING", "AUTHORIZED"]):
            p.status = "CANCELLED"
            p.save(update_fields=["status", "updated_at"])
        if order.loyalty_points_redeemed:
            _loyalty(order.user, order.loyalty_points_redeemed, "refund_redeemed", order)
    elif to == "PICKED_UP" or (to == "DELIVERED" and order.fulfilment == "pickup"):
        commit_sale(order)
    if to == "DELIVERED":
        for p in order.payments.filter(method="CASH_ON_DELIVERY", status="PENDING"):
            p.status, p.paid_at = "PAID", timezone.now()
            p.save(update_fields=["status", "paid_at", "updated_at"])
            order.payment_status = "PAID"
            order.save(update_fields=["payment_status"])
        cfg = settings_service.get("loyalty")
        if cfg.enabled and order.loyalty_points_earned == 0:
            pts = int((order.total - order.delivery_fee) * cfg.pointsPerCurrencyUnit)
            if pts > 0:
                order.loyalty_points_earned = pts
                order.save(update_fields=["loyalty_points_earned"])
                _loyalty(order.user, pts, "order_delivered", order)
        from catalog.models import Product

        for item in order.items.all():
            if item.product_id:
                Product.objects.filter(id=item.product_id).update(popularity=models_F("popularity") + 25 * item.qty)


def models_F(name: str):
    from django.db.models import F

    return F(name)


def _loyalty(user, delta: int, reason: str, order: Order | None = None) -> None:
    from accounts.models import User

    LoyaltyLedger.objects.create(user=user, delta=delta, reason=reason, order=order)
    User.objects.filter(pk=user.pk).update(loyalty_points=models_F("loyalty_points") + delta)


# ---------------------------------------------------------------- output
STATUS_LABELS = {
    "PENDING_PAYMENT": ("Awaiting payment", "Inasubiri malipo"), "CONFIRMED": ("Confirmed", "Imethibitishwa"), "PREPARING": ("Being prepared", "Inaandaliwa"),
    "READY_FOR_PICKUP": ("Ready", "Iko tayari"), "ASSIGNED": ("Rider assigned", "Dereva amepatikana"), "PICKED_UP": ("Picked up", "Imechukuliwa"),
    "ON_THE_WAY": ("On the way", "Iko njiani"), "ARRIVED": ("Rider has arrived", "Dereva amefika"), "DELIVERED": ("Delivered", "Imefika"),
    "CANCELLED": ("Cancelled", "Imeghairiwa"), "REFUNDED": ("Refunded", "Imerejeshwa"), "FAILED": ("Payment failed", "Malipo yameshindikana"),
}


def _point(p) -> dict | None:
    return {"lat": p.y, "lng": p.x} if p else None


def rider_public(rider) -> dict[str, Any]:
    v = rider.vehicles.filter(is_primary=True).first()
    u = rider.user
    return {
        "id": str(rider.id), "name": u.name or "SmartWear rider", "firstName": (u.name or "Rider").split(" ")[0], "photo": media_out(rider.photo) if rider.photo_id else None,
        "rating": round(rider.rating_avg, 1), "deliveries": rider.deliveries_count, "vehicle": {"type": v.type, "plate": v.plate, "color": v.color, "make": v.make} if v else None,
    }


def order_out(order: Order, *, viewer: str = "customer", locale: str = "en") -> dict[str, Any]:
    job = getattr(order, "delivery", None)
    show_rider = job is not None and job.rider_id and job.status in state.RIDER_HOLDS + ["COMPLETED"]
    rider_live = job is not None and job.rider_id and job.status in state.RIDER_HOLDS
    pin_visible = viewer == "customer" and job is not None and job.status in state.RIDER_HOLDS and settings_service.get("delivery.dispatch").deliveryPinEnabled
    label = STATUS_LABELS.get(order.status, (order.status, order.status))
    out: dict[str, Any] = {
        "id": str(order.id), "number": order.number, "status": order.status, "statusLabel": label[1] if locale == "sw" else label[0],
        "placedAt": order.placed_at.isoformat(), "currency": order.currency,
        "subtotal": order.subtotal, "discount": order.discount, "deliveryFee": order.delivery_fee, "tax": order.tax, "total": order.total, "savings": order.savings,
        "promoCode": order.promo_code or None, "fulfilment": order.fulfilment, "deliveryOption": order.delivery_option,
        "store": {"id": str(order.store_id), "name": order.store.name, "address": order.store.address, "location": _point(order.store.location), "phone": order.store.phone or None},
        "destination": {"location": _point(order.destination), "label": order.destination_label, "area": order.destination_area or None, "landmark": order.landmark_note or None} if order.destination else None,
        "eta": {"minMinutes": order.eta_min_minutes, "maxMinutes": order.eta_max_minutes, "promisedBy": order.promised_by.isoformat() if order.promised_by else None, "liveSeconds": job.eta_seconds if job else None},
        "payment": {"method": order.payment_method, "status": order.payment_status, "checkoutUrl": next((p.checkout_url for p in order.payments.all() if p.status == "PENDING" and p.checkout_url), None)},
        "items": [{"id": i.id, "productId": str(i.product_id) if i.product_id else None, "variantId": str(i.variant_id) if i.variant_id else None, "title": i.title, "brand": i.brand or None, "options": i.options_label, "sku": i.sku, "image": media_out(i.image) if i.image_id else None, "qty": i.qty, "unitPrice": i.unit_price, "retailUnitPrice": i.retail_unit_price, "basis": i.price_basis, "tier": i.tier, "lineTotal": i.line_total, "savings": i.savings, "reviewed": i.reviewed} for i in order.items.all()],
        "delivery": {
            "status": job.status, "rider": rider_public(job.rider) if show_rider else None,
            "riderLocation": {**_point(job.rider.last_location), "heading": job.rider.last_heading, "at": job.rider.last_seen_at.isoformat() if job.rider.last_seen_at else None} if rider_live and job.rider.last_location else None,
            "route": job.route_polyline or None, "routeLeg": job.route_leg or None, "distanceMeters": job.distance_m,
            "searchingSince": job.searching_since.isoformat() if job.searching_since else None,
            "timeline": {k: getattr(job, f"{k}_at").isoformat() if getattr(job, f"{k}_at") else None for k in ("accepted", "at_store", "picked_up", "en_route", "arrived", "completed")},
        } if job else None,
        "pin": reveal_pin(order) if pin_visible else None,
        "canCancel": state.can_order(order.status, "CANCELLED", "customer"),
        "canRate": order.status == "DELIVERED" and order.rated_at is None,
        "canReturn": order.status == "DELIVERED" and settings_service.get("features").returns and order.delivered_at is not None and (timezone.now() - order.delivered_at).days <= 14,
        "shareToken": order.share_token if viewer == "customer" else None,
    }
    if viewer == "admin":
        out.update({
            "customer": {"id": str(order.user_id), "name": order.user.display_name, "phone": order.contact_phone or order.user.phone, "email": order.user.email, "customerType": order.customer_type},
            "contact": {"name": order.contact_name, "phone": order.contact_phone}, "extraFields": order.extra_fields, "feeBreakdown": order.fee_breakdown,
            "adminNotes": order.admin_notes, "cancelReason": order.cancel_reason or None, "pin": reveal_pin(order),
            "events": [{"type": e.type, "from": e.from_status, "to": e.to_status, "actor": e.actor_type, "actorId": e.actor_id, "data": e.data, "at": e.created_at.isoformat()} for e in order.events.all()],
            "payments": [{"id": str(p.id), "method": p.method, "provider": p.provider, "status": p.status, "amount": p.amount, "reference": p.reference, "providerRef": p.provider_ref, "paidAt": p.paid_at.isoformat() if p.paid_at else None, "refunded": p.refunded_amount} for p in order.payments.all()],
            "allowedTransitions": [t for t, actors in state.ORDER_TRANSITIONS.get(order.status, {}).items() if "admin" in actors],
            "riderLocation": out["delivery"]["riderLocation"] if out["delivery"] else None,
            "sla": sla(order),
        })
        if job and job.rider_id:
            out["delivery"]["rider"] = rider_public(job.rider) | {"phone": job.rider.user.phone}
    return out


def sla(order: Order) -> dict[str, Any]:
    now = timezone.now()
    job = getattr(order, "delivery", None)
    level, label = "ok", None
    if job and job.status in ("SEARCHING", "OFFERED", "NO_RIDER") and job.searching_since:
        mins = (now - job.searching_since).total_seconds() / 60
        alert = settings_service.get("delivery.dispatch").noRiderAlertMinutes
        if mins >= alert * 2:
            level, label = "danger", f"No rider for {int(mins)} min"
        elif mins >= alert:
            level, label = "warning", f"Waiting for rider {int(mins)} min"
    if order.promised_by and order.status in state.ORDER_ACTIVE and now > order.promised_by:
        level, label = "danger", "Past promised time"
    return {"level": level, "label": label}


def order_queryset():
    return Order.objects.select_related("store", "user", "delivery__rider__user", "delivery__rider__photo").prefetch_related("items__image", "payments", "events", "delivery__rider__vehicles")
