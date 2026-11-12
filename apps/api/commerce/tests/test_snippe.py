"""Snippe mobile money: request shape, webhook verification, order confirmation, idempotency, reconciliation."""
from __future__ import annotations

import hashlib
import hmac
import json
import time

import httpx
import pytest
import respx

from commerce.models import Order, Payment, WebhookEvent
from commerce.services import snippe
from commerce.tests.test_order_lifecycle import MIKOCHENI, world  # noqa: F401  (fixture)
from conftest import user_client
from core import settings_service
from core.exceptions import ApiError
from delivery.models import DeliveryJob

pytestmark = pytest.mark.django_db
SECRET = "whsec_test_123"


@pytest.fixture
def snippe_on(admin_user):
    settings_service.update("payments", {"mobileMoneyProvider": "snippe", "snippeApiKey": "snp_test_key", "snippeWebhookSecret": SECRET, "publicApiBaseUrl": "https://api.smartwear.test"}, admin=admin_user)


def signed(body: dict, ts: int | None = None, secret: str = SECRET):
    raw = json.dumps(body).encode()
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"HTTP_X_WEBHOOK_TIMESTAMP": str(ts), "HTTP_X_WEBHOOK_SIGNATURE": sig, "HTTP_X_WEBHOOK_EVENT": body.get("type", "")}


def test_msisdn_normalisation():
    assert snippe.msisdn("+255712345678") == "255712345678"
    assert snippe.msisdn("0712 345 678") == "255712345678"
    with pytest.raises(ApiError):
        snippe.msisdn("+254712345678")


def test_verify_webhook_rejects_forged_stale_and_unsigned(snippe_on):
    body = {"id": "evt_1", "type": "payment.completed", "data": {"reference": "pi_1"}}
    raw, h = signed(body)
    assert snippe.verify_webhook(raw, h["HTTP_X_WEBHOOK_TIMESTAMP"], h["HTTP_X_WEBHOOK_SIGNATURE"])["id"] == "evt_1"
    _raw, bad = signed(body, secret="wrong")
    with pytest.raises(ApiError):
        snippe.verify_webhook(raw, bad["HTTP_X_WEBHOOK_TIMESTAMP"], bad["HTTP_X_WEBHOOK_SIGNATURE"])
    old_raw, old = signed(body, ts=int(time.time()) - 900)
    with pytest.raises(ApiError):
        snippe.verify_webhook(old_raw, old["HTTP_X_WEBHOOK_TIMESTAMP"], old["HTTP_X_WEBHOOK_SIGNATURE"])
    with pytest.raises(ApiError):
        snippe.verify_webhook(raw, None, None)


def _place(world, client):
    v = world["variant"]
    client.post("/v1/cart/items", {"variantId": str(v.id), "qty": 1}, format="json")
    q = client.post("/v1/checkout/quote", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    return client.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "deliveryOptionId": q["selectedOptionId"], "expectedTotal": q["cart"]["total"], "paymentMethod": "MOBILE_MONEY"},
                       format="json", HTTP_IDEMPOTENCY_KEY="snp-1")


@respx.mock
def test_mobile_money_order_is_confirmed_by_signed_webhook(world, snippe_on, api):  # noqa: F811
    route = respx.post("https://api.snippe.sh/v1/payments").mock(return_value=httpx.Response(201, json={"status": "success", "code": 201, "data": {"reference": "pi_abc", "status": "pending", "object": "payment", "payment_type": "mobile", "amount": {"currency": "TZS", "value": 1}}}))
    c = user_client(world["customer"])
    r = _place(world, c)
    assert r.status_code == 201, r.json()
    order = Order.objects.get(id=r.json()["id"])
    assert order.status == "PENDING_PAYMENT"
    sent = json.loads(route.calls.last.request.content)
    assert sent["payment_type"] == "mobile" and sent["details"]["currency"] == "TZS" and sent["details"]["amount"] == order.total
    assert sent["phone_number"].startswith("255") and len(sent["phone_number"]) == 12
    assert sent["webhook_url"] == "https://api.smartwear.test/v1/webhooks/snippe"
    assert route.calls.last.request.headers["Authorization"] == "Bearer snp_test_key"
    assert 0 < len(route.calls.last.request.headers["Idempotency-Key"]) <= 30
    assert Payment.objects.get(order=order).provider_ref == "pi_abc"

    event = {"id": "evt_ok", "type": "payment.completed", "api_version": "2026-01-25", "data": {"reference": "pi_abc", "status": "completed", "amount": {"value": order.total, "currency": "TZS"}}}
    raw, h = signed(event)
    assert api.post("/v1/webhooks/snippe", data=raw, content_type="application/json", **h).status_code == 200
    order.refresh_from_db()
    assert order.payment_status == "PAID" and order.status in ("CONFIRMED", "PREPARING")
    assert DeliveryJob.objects.filter(order=order).exists()
    # Snippe retries: the same event again changes nothing
    assert api.post("/v1/webhooks/snippe", data=raw, content_type="application/json", **h).json().get("duplicate") is True
    assert WebhookEvent.objects.filter(provider="snippe").count() == 1


@respx.mock
def test_forged_webhook_is_rejected_and_failure_fails_order(world, snippe_on, api):  # noqa: F811
    respx.post("https://api.snippe.sh/v1/payments").mock(return_value=httpx.Response(201, json={"data": {"reference": "pi_x", "status": "pending"}}))
    c = user_client(world["customer"])
    order = Order.objects.get(id=_place(world, c).json()["id"])
    raw, h = signed({"id": "evt_f", "type": "payment.completed", "data": {"reference": "pi_x", "amount": {"value": order.total}}}, secret="attacker")
    assert api.post("/v1/webhooks/snippe", data=raw, content_type="application/json", **h).status_code == 403
    order.refresh_from_db()
    assert order.payment_status != "PAID"
    raw, h = signed({"id": "evt_e", "type": "payment.expired", "data": {"reference": "pi_x"}})
    api.post("/v1/webhooks/snippe", data=raw, content_type="application/json", **h)
    order.refresh_from_db()
    assert order.status == "FAILED" and order.payment_status == "FAILED"


@respx.mock
def test_status_poll_reconciles_missed_webhook(world, snippe_on):  # noqa: F811
    respx.post("https://api.snippe.sh/v1/payments").mock(return_value=httpx.Response(201, json={"data": {"reference": "pi_poll", "status": "pending"}}))
    respx.get("https://api.snippe.sh/v1/payments/pi_poll").mock(return_value=httpx.Response(200, json={"data": {"reference": "pi_poll", "status": "completed"}}))
    c = user_client(world["customer"])
    oid = _place(world, c).json()["id"]
    r = c.get(f"/v1/me/orders/{oid}/payment").json()
    assert r["paymentStatus"] == "PAID" and r["payment"]["provider"] == "snippe"


def test_without_api_key_mobile_money_is_not_offered(world, api):  # noqa: F811
    settings_service.update("payments", {"mobileMoneyProvider": "snippe", "snippeApiKey": ""})
    c = user_client(world["customer"])
    c.post("/v1/cart/items", {"variantId": str(world["variant"].id), "qty": 1}, format="json")
    q = c.post("/v1/checkout/quote", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    assert "MOBILE_MONEY" not in {m["method"] for m in q["payment"]["available"]}
    with pytest.raises(ApiError) as e:
        from commerce.services.payments import _snippe_push

        _snippe_push(Order(user=world["customer"], total=1000, currency="TZS", number="SW-1"), "+255712345678")
    assert e.value.code == "not_configured"


@respx.mock
def test_admin_payments_ledger_and_resync(world, snippe_on, admin_user):  # noqa: F811
    from conftest import admin_client

    respx.post("https://api.snippe.sh/v1/payments").mock(return_value=httpx.Response(201, json={"data": {"reference": "pi_led", "status": "pending"}}))
    respx.get("https://api.snippe.sh/v1/payments/pi_led").mock(return_value=httpx.Response(200, json={"data": {"reference": "pi_led", "status": "completed"}}))
    c = user_client(world["customer"])
    order = Order.objects.get(id=_place(world, c).json()["id"])
    a = admin_client(admin_user)
    r = a.get("/v1/admin/payments", {"provider": "snippe"}).json()
    assert r["items"][0]["providerRef"] == "pi_led" and r["items"][0]["status"] == "PENDING"
    assert r["summary"]["pendingCount"] >= 1
    assert a.get("/v1/admin/payments", {"q": order.number}).json()["items"][0]["order"]["number"] == order.number
    pid = r["items"][0]["id"]
    assert a.post(f"/v1/admin/payments/{pid}/sync").json()["status"] == "PAID"
    order.refresh_from_db()
    assert order.payment_status == "PAID"
