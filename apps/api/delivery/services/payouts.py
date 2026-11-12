"""Rider payouts: what each rider is owed, and paying it out by Snippe mobile money or recording a
manual payment. A payout is created PENDING; Snippe's webhook (or the reconcile task) settles it.

Unpaid balance = Σ earning of COMPLETED jobs − Σ amount of PENDING/COMPLETED payouts.
FAILED payouts release their amount back to the balance (Snippe refunds our wallet too).
"""
from __future__ import annotations

import json
import logging
import secrets

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.utils import timezone

from core import settings_service
from core.audit import audit
from core.crypto import decrypt_secret
from core.exceptions import ApiError

from ..models import DeliveryJob, Rider, RiderPayout

logger = logging.getLogger("smartwear.payouts")


def format_money(v: int, cur: str = "TZS") -> str:
    return f"{cur} {int(v):,}"
HOLDS = ("PENDING", "COMPLETED")


def owed(rider: Rider) -> dict:
    earned = DeliveryJob.objects.filter(rider=rider, status="COMPLETED").aggregate(total=Sum("earning"), n=Count("id"))
    paid = RiderPayout.objects.filter(rider=rider, status__in=HOLDS).aggregate(total=Sum("amount"), pending=Sum("amount", filter=Q(status="PENDING")))
    total_earned, total_paid = int(earned["total"] or 0), int(paid["total"] or 0)
    return {"earned": total_earned, "jobs": int(earned["n"] or 0), "paid": total_paid, "pending": int(paid["pending"] or 0), "unpaid": max(0, total_earned - total_paid)}


def balances() -> list[dict]:
    """Every rider with earnings, most owed first — one query each for earnings and payouts."""
    earned = {r["rider_id"]: r for r in DeliveryJob.objects.filter(status="COMPLETED", rider__isnull=False).values("rider_id").annotate(total=Sum("earning"), n=Count("id"), last=Max("completed_at"))}
    paid = {r["rider_id"]: r for r in RiderPayout.objects.filter(status__in=HOLDS).values("rider_id").annotate(total=Sum("amount"), pending=Sum("amount", filter=Q(status="PENDING")), last=Max("created_at"))}
    riders = Rider.objects.filter(id__in=set(earned) | set(paid)).select_related("user")
    out = []
    for r in riders:
        e, p = earned.get(r.id, {}), paid.get(r.id, {})
        te, tp = int(e.get("total") or 0), int(p.get("total") or 0)
        out.append({
            "rider": {"id": str(r.id), "name": r.user.name, "phone": r.user.phone, "status": r.status, "payoutMethod": r.payout_method or None, "payoutAccount": _mask(recipient(r)[0]) if recipient(r)[0] else None},
            "earned": te, "jobs": int(e.get("n") or 0), "paid": tp, "pending": int(p.get("pending") or 0), "unpaid": max(0, te - tp),
            "lastDeliveryAt": e["last"].isoformat() if e.get("last") else None, "lastPayoutAt": p["last"].isoformat() if p.get("last") else None,
        })
    return sorted(out, key=lambda x: -x["unpaid"])


def recipient(rider: Rider) -> tuple[str | None, str]:
    """(wallet phone, name) from the encrypted payout details, falling back to the login phone."""
    phone, name = None, rider.user.name or ""
    if rider.payout_details:
        try:
            d = json.loads(decrypt_secret(rider.payout_details, settings_service.key_ring()))
            if (d.get("method") or rider.payout_method) in ("mobile_money", None, ""):
                phone = d.get("account") or None
            name = d.get("name") or name
        except Exception:  # noqa: BLE001 — undecryptable details just fall back
            logger.warning("payout details for rider %s unreadable", rider.id)
    if not phone and rider.payout_method in ("", "mobile_money"):
        phone = rider.user.phone or None
    return phone, name


def _mask(phone: str) -> str:
    d = "".join(c for c in phone if c.isdigit())
    return f"•••• {d[-4:]}" if len(d) >= 4 else phone


def payout_out(p: RiderPayout) -> dict:
    return {
        "id": str(p.id), "riderId": str(p.rider_id), "riderName": p.rider.user.name if p.rider_id else None, "method": p.method, "status": p.status,
        "amount": p.amount, "fee": p.fee, "currency": p.currency, "reference": p.reference, "providerRef": p.provider_ref or None, "externalRef": p.external_ref or None,
        "network": p.network or None, "recipient": _mask(p.recipient_phone) if p.recipient_phone else None, "recipientName": p.recipient_name or None,
        "note": p.note or None, "failureReason": p.failure_reason or None, "jobs": p.jobs_count,
        "createdAt": p.created_at.isoformat(), "completedAt": p.completed_at.isoformat() if p.completed_at else None,
        "createdBy": p.created_by.name if p.created_by_id else None,
    }


def create(rider: Rider, *, amount: int | None, method: str, admin=None, note: str = "", request=None) -> RiderPayout:
    cfg = settings_service.get("payments")
    if method not in ("snippe", "manual"):
        raise ApiError.bad_request("method must be snippe or manual")
    with transaction.atomic():
        Rider.objects.select_for_update().filter(id=rider.id).first()  # serialise payouts per rider
        bal = owed(rider)
        amount = int(amount if amount is not None else bal["unpaid"])
        if amount <= 0:
            raise ApiError.bad_request("Nothing to pay — this rider has no unpaid earnings")
        if amount > bal["unpaid"]:
            raise ApiError.bad_request(f"{rider.user.name or 'This rider'} is owed {format_money(bal['unpaid'], 'TZS')} — you can't pay more than that")
        phone, name = recipient(rider)
        if method == "snippe":
            from commerce.services import snippe

            if cfg.riderPayoutsProvider != "snippe" or not cfg.snippeApiKey:
                raise ApiError.not_configured("Snippe payouts", "Turn on Snippe payouts in Settings → Payments (the API key needs the disbursement:create scope).")
            if amount < cfg.riderPayoutMinimum:
                raise ApiError.bad_request(f"Payouts start at {format_money(cfg.riderPayoutMinimum, 'TZS')}")
            if not phone:
                raise ApiError.bad_request("Add the rider's mobile money number in their payout details first")
            snippe.msisdn(phone)  # validate before we hold the money
        p = RiderPayout.objects.create(
            rider=rider, method=method, status="PENDING" if method == "snippe" else "COMPLETED", amount=amount, currency="TZS",
            reference=f"PO{timezone.now():%y%m%d}{secrets.token_hex(5).upper()}", recipient_phone=phone or "", recipient_name=name[:120],
            note=note[:240], jobs_count=bal["jobs"], created_by=admin, completed_at=None if method == "snippe" else timezone.now(),
        )
        audit("payout.create", "rider_payout", p.id, request=request, after={"rider": str(rider.id), "amount": amount, "method": method})
    if method == "snippe":
        _send(p, cfg)
    else:
        _notify(p, "rider.payout_sent")
    return p


def _send(p: RiderPayout, cfg) -> None:
    from commerce.services import snippe

    try:
        d = snippe.send_payout(amount=p.amount, phone=p.recipient_phone, name=p.recipient_name, narration=cfg.riderPayoutNarration,
                               idempotency_key=p.reference, metadata={"payoutId": str(p.id), "riderId": str(p.rider_id), "reference": p.reference})
    except ApiError as e:
        _settle(p, "FAILED", reason=e.message)
        raise
    p.provider_ref = str(d.get("reference") or "")
    p.external_ref = str(d.get("external_reference") or "")
    p.network = str((d.get("channel") or {}).get("provider") or "")
    p.fee = int(((d.get("fees") or {}).get("value")) or 0)
    p.raw = {"create": d}
    p.save(update_fields=["provider_ref", "external_ref", "network", "fee", "raw", "updated_at"])
    status = str(d.get("status") or "pending").lower()
    if status != "pending":
        _apply_status(p, status, d)
    else:
        _notify(p, "rider.payout_sent")


def _apply_status(p: RiderPayout, status: str, data: dict) -> None:
    mapping = {"completed": "COMPLETED", "failed": "FAILED", "reversed": "REVERSED"}
    if status in mapping:
        _settle(p, mapping[status], reason=str(data.get("failure_reason") or ""), data=data)


def _settle(p: RiderPayout, status: str, *, reason: str = "", data: dict | None = None) -> None:
    with transaction.atomic():
        p = RiderPayout.objects.select_for_update().select_related("rider__user").get(id=p.id)
        if p.status == status or (p.status != "PENDING" and status != "REVERSED"):
            return
        p.status = status
        p.failure_reason = reason[:240]
        if data:
            p.external_ref = str(data.get("external_reference") or p.external_ref)
            p.raw = {**(p.raw or {}), status.lower(): data}
        if status == "COMPLETED":
            p.completed_at = timezone.now()
        p.save()
        audit(f"payout.{status.lower()}", "rider_payout", p.id, after={"reason": reason} if reason else None)
    if status in ("FAILED", "REVERSED"):
        _notify(p, "rider.payout_failed")


def _notify(p: RiderPayout, key: str) -> None:
    try:
        from notifications.service import notify

        notify(p.rider.user, key, {"amount": format_money(p.amount, p.currency), "phone": _mask(p.recipient_phone) if p.recipient_phone else ""}, data={"payoutId": str(p.id)})
    except Exception:  # noqa: BLE001 — notifications never block money movement
        logger.exception("payout notification failed")


def sync(p: RiderPayout) -> RiderPayout:
    """Reconcile a pending Snippe payout from GET /v1/payouts/{reference} (covers missed webhooks)."""
    from commerce.services import snippe

    if p.method != "snippe" or p.status != "PENDING" or not p.provider_ref:
        return p
    d = snippe.get_payout(p.provider_ref)
    _apply_status(p, str(d.get("status") or "").lower(), d)
    p.refresh_from_db()
    return p


def handle_webhook(etype: str, data: dict) -> bool:
    """payout.completed / payout.failed / payout.reversed → True if it matched one of ours."""
    ref = str(data.get("reference") or "")
    meta_ref = str((data.get("metadata") or {}).get("reference") or "")
    p = RiderPayout.objects.filter(Q(provider_ref=ref) if ref else Q(pk__in=[])).first() or (RiderPayout.objects.filter(reference=meta_ref).first() if meta_ref else None)
    if p is None:
        return False
    _apply_status(p, etype.split(".")[-1], data)
    return True
