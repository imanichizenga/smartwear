"""Payments: cash on delivery (default) and mobile money through Snippe (USSD push) or Beem Checkout."""
from __future__ import annotations

import logging
import secrets
import uuid

import httpx
from django.db import transaction
from django.utils import timezone

from core import settings_service
from core.crypto import safe_equal, sha256
from core.exceptions import ApiError

from ..models import Order, Payment, WebhookEvent

logger = logging.getLogger("smartwear.payments")
CHECKOUT_URL = "https://checkout.beem.africa/v1/checkout"


def _reference(order: Order) -> str:
    prefix = settings_service.get("payments").beemCheckoutReferencePrefix or "SW"
    return f"{prefix}-{order.number.replace('SW-', '').replace('-', '')}{secrets.token_hex(2).upper()}"


def start_payment(order: Order, method: str, *, msisdn: str = "") -> Payment:
    if method == "CASH_ON_DELIVERY":
        return Payment.objects.create(order=order, method=method, provider="cash", amount=order.total, currency=order.currency, reference=_reference(order))
    if method == "MOBILE_MONEY":
        return _mobile_money(order, msisdn)
    raise ApiError.bad_request("That payment method isn't available")


def _mobile_money(order: Order, msisdn: str) -> Payment:
    provider = settings_service.get("payments").mobileMoneyProvider
    if provider == "snippe":
        return _snippe_push(order, msisdn)
    if provider == "beem_checkout":
        return _beem_checkout(order, msisdn)
    raise ApiError.not_configured("Mobile money", "Choose a mobile-money provider in Settings → Payments.")


def _snippe_push(order: Order, msisdn: str) -> Payment:
    from . import snippe

    if not snippe.configured():
        raise ApiError.not_configured("Snippe", "Enter the Snippe API key in Settings → Payments.")
    ref = _reference(order)
    user = order.user
    first, _, last = (user.name or "").strip().partition(" ")
    # Snippe requires an email; shoppers who signed up by phone get a stable, non-deliverable alias.
    email = user.email or f"{(user.phone or str(user.id)).lstrip('+')}@customers.smartwear.invalid"
    phone = msisdn or user.phone or ""
    data = snippe.create_mobile_payment(
        amount=int(order.total), currency=order.currency, phone=phone, first_name=first, last_name=last or first, email=email,
        idempotency_key=ref, metadata={"orderId": str(order.id), "orderNumber": order.number, "reference": ref},
    )
    return Payment.objects.create(order=order, method="MOBILE_MONEY", provider="snippe", amount=order.total, currency=order.currency, reference=ref,
                                  provider_ref=str(data.get("reference") or ""), msisdn=phone, raw={"created": data})


def _mark_paid(p: Payment, *, raw: dict) -> None:
    from .orders import transition

    order = p.order
    p.status, p.paid_at = "PAID", timezone.now()
    p.raw = {**p.raw, **raw}
    p.save()
    order.payment_status = "PAID"
    order.save(update_fields=["payment_status"])
    if order.status == "PENDING_PAYMENT":
        transition(order, "CONFIRMED", actor="system", data={"payment": p.method, "provider": p.provider})
        if order.fulfilment == "delivery":
            from delivery.services.dispatch import create_job

            create_job(order)


def _mark_failed(p: Payment, *, raw: dict, reason: str) -> None:
    from .orders import transition

    order = p.order
    p.status = "FAILED"
    p.raw = {**p.raw, **raw}
    p.save()
    order.payment_status = "FAILED"
    order.save(update_fields=["payment_status"])
    if order.status == "PENDING_PAYMENT":
        transition(order, "FAILED", actor="system", reason=reason)


def handle_snippe_webhook(raw_body: bytes, headers) -> dict:
    """Verified (HMAC over "{ts}.{body}") and idempotent (event id; Snippe retries with backoff)."""
    from . import snippe

    event = snippe.verify_webhook(raw_body, headers.get("X-Webhook-Timestamp"), headers.get("X-Webhook-Signature"))
    etype = str(event.get("type") or event.get("event") or headers.get("X-Webhook-Event") or "")
    data = event.get("data") if isinstance(event.get("data"), dict) else event
    ref = str(data.get("reference") or "")
    event_id = str(event.get("id") or f"{ref}:{etype}")
    with transaction.atomic():
        evt, created = WebhookEvent.objects.get_or_create(provider="snippe", event_id=event_id, defaults={"payload": event})
        if not created and evt.processed_at:
            return {"ok": True, "duplicate": True}
        if etype.startswith("payout."):
            from delivery.services import payouts

            if not payouts.handle_webhook(etype, data):
                logger.warning("snippe webhook for unknown payout %s", ref)
            evt.processed_at = timezone.now()
            evt.save(update_fields=["processed_at"])
            return {"ok": True}
        p = Payment.objects.select_for_update(of=("self",)).select_related("order").filter(provider="snippe", provider_ref=ref).first() if ref else None
        if p is None:
            meta_ref = str((data.get("metadata") or {}).get("reference") or "")
            p = Payment.objects.select_for_update(of=("self",)).select_related("order").filter(provider="snippe", reference=meta_ref).first() if meta_ref else None
        if p is None:
            logger.warning("snippe webhook for unknown payment %s", ref)
            evt.processed_at = timezone.now()
            evt.save(update_fields=["processed_at"])
            return {"ok": True, "unknown": True}
        if p.status == "PENDING":
            amount = data.get("amount")
            raw_value = amount.get("value") if isinstance(amount, dict) else amount
            try:
                value = int(raw_value or 0)
            except (TypeError, ValueError):
                value = 0
            if etype == "payment.completed" and value >= p.amount:
                _mark_paid(p, raw={"webhook": event})
            elif etype == "payment.completed":
                _mark_failed(p, raw={"webhook": event}, reason=f"Paid amount {value} is less than {p.amount}")
            elif etype in ("payment.failed", "payment.voided", "payment.expired"):
                _mark_failed(p, raw={"webhook": event}, reason=f"Mobile money {etype.split('.')[-1]}")
        evt.processed_at = timezone.now()
        evt.save(update_fields=["processed_at"])
    return {"ok": True}


def sync_snippe(p: Payment) -> Payment:
    """Reconcile one pending Snippe payment from GET /v1/payments/{reference} (covers missed webhooks)."""
    from . import snippe

    if p.provider != "snippe" or p.status != "PENDING" or not p.provider_ref:
        return p
    d = snippe.get_payment(p.provider_ref)
    status = str(d.get("status") or "")
    with transaction.atomic():
        p = Payment.objects.select_for_update(of=("self",)).select_related("order").get(id=p.id)
        if p.status != "PENDING":
            return p
        if status == "completed":
            _mark_paid(p, raw={"status": d})
        elif status in snippe.TERMINAL_FAIL:
            _mark_failed(p, raw={"status": d}, reason=f"Mobile money {status}")
    return p


def resend_push(order: Order) -> Payment:
    from . import snippe

    p = order.payments.filter(provider="snippe", status="PENDING").order_by("-created_at").first()
    if p is None:
        raise ApiError.conflict("no_pending_payment", "There is no mobile-money payment waiting for approval")
    snippe.push_again(p.provider_ref)
    return p


def _beem_checkout(order: Order, msisdn: str) -> Payment:
    cfg = settings_service.get("payments")
    if cfg.mobileMoneyProvider != "beem_checkout" or not (cfg.beemCheckoutApiKey and cfg.beemCheckoutSecretKey):
        raise ApiError.not_configured("Mobile money", "Enter the Beem Checkout credentials in Settings → Payments.")
    txn = str(uuid.uuid4())
    token = secrets.token_urlsafe(24)
    ref = _reference(order)
    params = {"amount": int(order.total), "reference_number": ref, "transaction_id": txn, "currency": order.currency, "sendSource": "true"}
    if msisdn:
        params["mobile"] = msisdn.lstrip("+")
    if order.user.email:
        params["email"] = order.user.email
    try:
        r = httpx.get(CHECKOUT_URL, params=params, auth=(cfg.beemCheckoutApiKey, cfg.beemCheckoutSecretKey), headers={"beem-secure-token": token}, timeout=15)
    except httpx.HTTPError as e:
        raise ApiError.upstream("Beem Checkout", "could not start the payment") from e
    d = r.json() if r.content else {}
    if not r.is_success or "src" not in d:
        msg = (d.get("data") or {}).get("message") or d.get("message") or f"HTTP {r.status_code}"
        raise ApiError.upstream("Beem Checkout", msg)
    return Payment.objects.create(order=order, method="MOBILE_MONEY", provider="beem_checkout", amount=order.total, currency=order.currency, reference=ref, provider_ref=txn, checkout_url=d["src"], msisdn=msisdn, raw={"tokenHash": sha256(token)})


def handle_beem_callback(body: dict, secure_token: str | None) -> dict:
    """Verified (per-payment secure token) and idempotent (WebhookEvent)."""
    ref = str(body.get("referenceNumber") or "")
    txn = str(body.get("transactionID") or "")
    status = str(body.get("status") or "")
    ack = {"amount": str(body.get("amount", "")), "status": status == "success", "referenceNumber": ref, "statusMessage": "", "transactionID": txn}
    with transaction.atomic():
        p = Payment.objects.select_for_update(of=("self",)).select_related("order").filter(reference=ref, provider="beem_checkout").first()
        if p is None:
            ack["statusMessage"] = "Unknown reference"
            return ack
        expected = (p.raw or {}).get("tokenHash")
        if not expected or not secure_token or not safe_equal(expected, sha256(secure_token)):
            logger.warning("beem callback with bad token for %s", ref)
            raise ApiError.forbidden("Invalid callback token")
        event_id = f"{ref}:{txn}:{status}"
        evt, created = WebhookEvent.objects.get_or_create(provider="beem_checkout", event_id=event_id, defaults={"payload": body})
        if not created and evt.processed_at:
            ack["statusMessage"] = "Already processed"
            return ack
        try:
            amount = int(float(body.get("amount") or 0))
        except ValueError:
            amount = 0
        if status == "success" and amount >= p.amount:
            _mark_paid(p, raw={"callback": body, "providerTxn": txn})
            ack["statusMessage"] = "Payment was successful!"
        else:
            _mark_failed(p, raw={"callback": body}, reason="Mobile money payment failed" if status != "success" else "Amount mismatch")
            ack["statusMessage"] = "Payment failed" if status != "success" else "Amount mismatch"
        evt.processed_at = timezone.now()
        evt.save(update_fields=["processed_at"])
    return ack


def retry_payment(order: Order, msisdn: str = "") -> Payment:
    from .orders import transition

    if order.status == "FAILED":
        transition(order, "PENDING_PAYMENT", actor="customer")
    if order.status != "PENDING_PAYMENT":
        raise ApiError.conflict("not_payable", "This order doesn't need a payment")
    return _mobile_money(order, msisdn)


def beem_checkout_ping() -> tuple[bool, str]:
    """Sandbox-safe ping: request a checkout page for 1 TZS with a throwaway reference (never charged unless paid)."""
    cfg = settings_service.get("payments")
    try:
        r = httpx.get(CHECKOUT_URL, params={"amount": 1, "reference_number": f"{cfg.beemCheckoutReferencePrefix or 'SW'}-TEST{secrets.token_hex(3).upper()}", "transaction_id": str(uuid.uuid4()), "sendSource": "true"}, auth=(cfg.beemCheckoutApiKey, cfg.beemCheckoutSecretKey), timeout=12)
    except httpx.HTTPError as e:
        return False, f"Could not reach Beem Checkout: {e}"
    d = r.json() if r.content else {}
    if r.status_code == 401 or d.get("code") == 120:
        return False, "Invalid Bpay API key or secret (code 120)"
    if r.is_success and d.get("src"):
        return True, "Checkout page created — credentials and route are valid"
    return False, (d.get("data") or {}).get("message") or d.get("message") or f"HTTP {r.status_code}"


def refund(order: Order, amount: int, *, admin, reason: str) -> None:
    """Records a refund. Cash/mobile-money refunds are paid out manually; this keeps the ledger exact."""
    from core.audit import audit

    paid = [p for p in order.payments.all() if p.status == "PAID"]
    total_paid = sum(p.amount - p.refunded_amount for p in paid)
    if amount <= 0 or amount > total_paid:
        raise ApiError.bad_request(f"Refund must be between 1 and {total_paid}")
    remaining = amount
    for p in paid:
        give = min(remaining, p.amount - p.refunded_amount)
        if give <= 0:
            continue
        p.refunded_amount += give
        if p.refunded_amount >= p.amount:
            p.status = "REFUNDED"
        p.save()
        remaining -= give
    if amount >= total_paid:
        order.payment_status = "REFUNDED"
        order.save(update_fields=["payment_status"])
        if order.status in ("DELIVERED", "CANCELLED"):
            from .orders import transition

            transition(order, "REFUNDED", actor="admin", actor_id=str(admin.id), reason=reason)
    audit("order.refund", "order", order.id, admin=admin, meta={"amount": amount, "reason": reason})
