"""Payments: cash on delivery (default) and mobile money through Beem Checkout (Bpay)."""
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
        return _beem_checkout(order, msisdn)
    raise ApiError.bad_request("That payment method isn't available")


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
        from .orders import transition

        order = p.order
        if status == "success" and amount >= p.amount:
            p.status, p.paid_at = "PAID", timezone.now()
            p.raw = {**p.raw, "callback": body, "providerTxn": txn}
            p.save()
            order.payment_status = "PAID"
            order.save(update_fields=["payment_status"])
            if order.status == "PENDING_PAYMENT":
                transition(order, "CONFIRMED", actor="system", data={"payment": "MOBILE_MONEY"})
                if order.fulfilment == "delivery":
                    from delivery.services.dispatch import create_job

                    create_job(order)
            ack["statusMessage"] = "Payment was successful!"
        else:
            p.status = "FAILED"
            p.raw = {**p.raw, "callback": body}
            p.save()
            order.payment_status = "FAILED"
            order.save(update_fields=["payment_status"])
            if order.status == "PENDING_PAYMENT":
                transition(order, "FAILED", actor="system", reason="Mobile money payment failed")
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
    return _beem_checkout(order, msisdn)


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
