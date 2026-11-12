"""
Snippe (https://snippe.sh) — mobile money collections for Tanzania (M-Pesa, Airtel Money, Mixx by Yas, Halotel).

Implemented against the 2026-01-25 API (docs.snippe.sh):
  • POST /v1/payments                 payment_type=mobile → USSD push to the customer's phone
      headers  Authorization: Bearer snp_…, Idempotency-Key (≤30 chars, 24h)
      body     {payment_type, details:{amount, currency}, phone_number:"255…", customer:{firstname,lastname,email},
                webhook_url, metadata}
  • GET  /v1/payments/{reference}     status: pending | completed | failed | voided | expired (4h)
  • GET  /v1/payments/balance         used by Test connection
  • POST /api/v1/sessions             hosted checkout (checkout_url) — the "hosted" mode
  • POST /v1/payouts/send            channel=mobile → rider payouts {amount, channel, recipient_phone, recipient_name,
                                      narration, webhook_url, metadata}; statuses pending | completed | failed | reversed
  • GET  /v1/payouts/{reference}      payout status;  GET /v1/payouts/fee?amount= → {fee_amount, total_amount}
  • Webhooks  X-Webhook-Timestamp + X-Webhook-Signature = hex(HMAC-SHA256(secret, f"{ts}.{raw_body}")),
              events payment.completed|failed|voided|expired and payout.completed|failed|reversed,
              retried with backoff → idempotent by event id.

Amounts are integers in the smallest unit (TZS has none), minimum 500 TZS.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

from core import settings_service
from core.exceptions import ApiError

logger = logging.getLogger("smartwear.payments.snippe")
MIN_AMOUNT = 500
TERMINAL_FAIL = {"failed", "voided", "expired"}


def _cfg():
    return settings_service.get("payments")


def configured() -> bool:
    c = _cfg()
    return c.mobileMoneyProvider == "snippe" and bool(c.snippeApiKey)


def _client() -> httpx.Client:
    c = _cfg()
    return httpx.Client(base_url=(c.snippeBaseUrl or "https://api.snippe.sh").rstrip("/"), timeout=20,
                        headers={"Authorization": f"Bearer {c.snippeApiKey}", "Content-Type": "application/json", "Accept": "application/json"})


def _error(r: httpx.Response) -> str:
    try:
        d = r.json()
    except ValueError:
        return f"HTTP {r.status_code}"
    err = d.get("error")
    msg = d.get("message") or (err.get("message") if isinstance(err, dict) else err) or f"HTTP {r.status_code}"
    code = d.get("error_code") or (err.get("code") if isinstance(err, dict) else None)
    return f"{msg} ({code})" if code else str(msg)


def msisdn(phone: str) -> str:
    """E.164 (+255…) or local (07…) → Snippe's 255XXXXXXXXX."""
    digits = "".join(ch for ch in phone if ch.isdigit())
    if digits.startswith("0") and len(digits) == 10:
        digits = "255" + digits[1:]
    if not (digits.startswith("255") and len(digits) == 12):
        raise ApiError.bad_request("Enter a Tanzanian mobile number for mobile money (e.g. 0712 345 678)", details={"field": "msisdn"})
    return digits


def webhook_url() -> str:
    base = (_cfg().publicApiBaseUrl or "").rstrip("/")
    if not base.startswith("https://") and not base.startswith("http://"):
        raise ApiError.not_configured("Payments", "Set the public API URL in Settings → Payments so Snippe can send payment results.")
    return f"{base}/v1/webhooks/snippe"


def create_mobile_payment(*, amount: int, currency: str, phone: str, first_name: str, last_name: str, email: str, idempotency_key: str, metadata: dict[str, Any]) -> dict:
    if currency != "TZS":
        raise ApiError.bad_request("Snippe collects in TZS only")
    if amount < MIN_AMOUNT:
        raise ApiError.bad_request(f"Mobile money payments start at {MIN_AMOUNT} TZS")
    body = {
        "payment_type": "mobile",
        "details": {"amount": int(amount), "currency": currency},
        "phone_number": msisdn(phone),
        "customer": {"firstname": first_name or "SmartWear", "lastname": last_name or "Customer", "email": email},
        "webhook_url": webhook_url(),
        "metadata": metadata,
    }
    try:
        with _client() as c:
            r = c.post("/v1/payments", json=body, headers={"Idempotency-Key": idempotency_key[:30]})
    except httpx.HTTPError as e:
        raise ApiError.upstream("Snippe", "could not reach the payment service") from e
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))
    return (r.json() or {}).get("data") or {}


def create_session(*, amount: int, currency: str, customer: dict, description: str, redirect_url: str, metadata: dict, expires_in: int = 3600) -> dict:
    """Hosted checkout page (snippe.me) — for shoppers who prefer to pay on Snippe's page."""
    body = {"amount": int(amount), "currency": currency, "allowed_methods": ["mobile_money"], "customer": customer, "redirect_url": redirect_url,
            "webhook_url": webhook_url(), "description": description[:500], "metadata": metadata, "expires_in": expires_in}
    try:
        with _client() as c:
            r = c.post("/api/v1/sessions", json=body)
    except httpx.HTTPError as e:
        raise ApiError.upstream("Snippe", "could not create the checkout page") from e
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))
    return (r.json() or {}).get("data") or {}


def get_payment(reference: str) -> dict:
    with _client() as c:
        r = c.get(f"/v1/payments/{reference}")
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))
    return (r.json() or {}).get("data") or {}


def push_again(reference: str) -> None:
    """Re-send the USSD prompt (the shopper dismissed it or their phone was off)."""
    with _client() as c:
        r = c.post(f"/v1/payments/{reference}/push", json={})
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))


def balance() -> dict:
    with _client() as c:
        r = c.get("/v1/payments/balance")
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))
    return (r.json() or {}).get("data") or {}


def payouts_configured() -> bool:
    c = _cfg()
    return c.riderPayoutsProvider == "snippe" and bool(c.snippeApiKey)


def payout_fee(amount: int) -> dict:
    with _client() as c:
        r = c.get("/v1/payouts/fee", params={"amount": int(amount)})
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))
    return (r.json() or {}).get("data") or {}


def send_payout(*, amount: int, phone: str, name: str, narration: str, idempotency_key: str, metadata: dict[str, Any]) -> dict:
    """Mobile-money payout (needs the disbursement:create scope). The network is detected from the number."""
    body = {
        "amount": int(amount),
        "channel": "mobile",
        "recipient_phone": msisdn(phone),
        "recipient_name": (name or "SmartWear Rider")[:120],
        "narration": narration[:140],
        "webhook_url": webhook_url(),
        "metadata": metadata,
    }
    try:
        with _client() as c:
            r = c.post("/v1/payouts/send", json=body, headers={"Idempotency-Key": idempotency_key[:30]})
    except httpx.HTTPError as e:
        raise ApiError.upstream("Snippe", "could not reach the payout service") from e
    if r.status_code >= 400:
        msg = _error(r)
        if r.status_code == 403 or "scope" in msg.lower():
            msg = f"{msg} — the API key needs the disbursement:create scope"
        raise ApiError.upstream("Snippe", msg)
    return (r.json() or {}).get("data") or {}


def get_payout(reference: str) -> dict:
    with _client() as c:
        r = c.get(f"/v1/payouts/{reference}")
    if r.status_code >= 400:
        raise ApiError.upstream("Snippe", _error(r))
    return (r.json() or {}).get("data") or {}


def verify_webhook(raw_body: bytes, timestamp: str | None, signature: str | None, *, now: float | None = None, tolerance: int = 300) -> dict:
    """Reject unsigned, stale (>5 min) or forged deliveries; return the parsed event."""
    secret = _cfg().snippeWebhookSecret
    if not secret:
        raise ApiError.not_configured("Snippe webhooks", "Copy the Webhook Secret from the Snippe dashboard into Settings → Payments.")
    if not timestamp or not signature:
        raise ApiError.forbidden("Missing webhook signature")
    try:
        ts = int(timestamp)
    except ValueError as e:
        raise ApiError.forbidden("Bad webhook timestamp") from e
    if abs((now or time.time()) - ts) > tolerance:
        raise ApiError.forbidden("Stale webhook")
    expected = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature.strip().lower()):
        raise ApiError.forbidden("Invalid webhook signature")
    try:
        return json.loads(raw_body)
    except ValueError as e:
        raise ApiError.bad_request("Invalid JSON") from e


def ping() -> tuple[bool, str, dict]:
    try:
        b = balance()
    except ApiError as e:
        msg = e.message
        if "401" in msg or "unauthor" in msg.lower():
            msg = "Snippe rejected the API key (401). Check it's a live key with the collection:read and collection:create scopes."
        return False, msg, {}
    except httpx.HTTPError as e:
        return False, f"Could not reach Snippe: {e}", {}
    avail = (b.get("available") or {})
    return True, f"Connected — available balance {avail.get('currency', 'TZS')} {int(avail.get('value') or 0):,}", b
