"""Rider payouts: balance maths, manual + Snippe payouts, webhook settlement and guards."""
import hashlib
import hmac
import json
import time

import pytest
import respx
from httpx import Response

from django.contrib.gis.geos import Point

from accounts.models import User
from commerce.models import Order
from commerce.tests.test_order_lifecycle import store as make_store
from core import settings_service
from delivery.models import DeliveryJob, Rider, RiderPayout
from delivery.services import payouts

pytestmark = pytest.mark.django_db

SECRET = "whsec_test"


@pytest.fixture
def snippe_on(admin_user):
    settings_service.update("payments", {"mobileMoneyProvider": "snippe", "snippeApiKey": "snp_test", "snippeWebhookSecret": SECRET, "publicApiBaseUrl": "https://api.example.com", "riderPayoutsProvider": "snippe", "riderPayoutMinimum": 1000}, admin=admin_user)


@pytest.fixture
def rider(db):
    u = User.objects.create(phone="+255754000222", name="Asha Rider")
    return Rider.objects.create(user=u, status="ACTIVE", payout_method="mobile_money")


@pytest.fixture
def store(db):
    return make_store()


@pytest.fixture
def order_factory(customer, store):
    n = iter(range(1, 1000))

    def make():
        return Order.objects.create(number=f"T-{next(n)}", user=customer, store=store, status="DELIVERED", currency="TZS", subtotal=10000, total=10000, destination=Point(39.24, -6.77, srid=4326))

    return make


def _complete_jobs(rider, store, order_factory, earnings):
    for e in earnings:
        DeliveryJob.objects.create(order=order_factory(), rider=rider, status="COMPLETED", store=store, pickup=Point(39.28, -6.75, srid=4326), dropoff=Point(39.24, -6.77, srid=4326), earning=e)


def test_balance_counts_completed_jobs_minus_holding_payouts(rider, store, order_factory, admin_user):
    _complete_jobs(rider, store, order_factory, [3000, 2500])
    assert payouts.owed(rider)["unpaid"] == 5500
    payouts.create(rider, amount=2000, method="manual", admin=admin_user)
    b = payouts.owed(rider)
    assert (b["paid"], b["unpaid"]) == (2000, 3500)
    RiderPayout.objects.create(rider=rider, method="snippe", status="FAILED", amount=3500, reference="POFAILED1")
    assert payouts.owed(rider)["unpaid"] == 3500, "failed payouts release the money"


def test_cannot_overpay(rider, store, order_factory, admin_user):
    _complete_jobs(rider, store, order_factory, [1500])
    with pytest.raises(Exception, match="owed"):
        payouts.create(rider, amount=2000, method="manual", admin=admin_user)


@respx.mock
def test_snippe_payout_then_webhook_completes(rider, store, order_factory, admin_user, snippe_on):
    _complete_jobs(rider, store, order_factory, [4000, 2000])
    route = respx.post("https://api.snippe.sh/v1/payouts/send").mock(return_value=Response(201, json={"status": "success", "code": 201, "data": {
        "reference": "SNP-PO-1", "status": "pending", "channel": {"provider": "airtel", "type": "mobile_money"}, "fees": {"currency": "TZS", "value": 150}}}))
    p = payouts.create(rider, amount=None, method="snippe", admin=admin_user)
    body = json.loads(route.calls[0].request.content)
    assert body["amount"] == 6000 and body["channel"] == "mobile" and body["recipient_phone"].startswith("255")
    assert route.calls[0].request.headers["Idempotency-Key"] == p.reference
    p.refresh_from_db()
    assert (p.status, p.provider_ref, p.fee, p.network) == ("PENDING", "SNP-PO-1", 150, "airtel")
    assert payouts.owed(rider)["unpaid"] == 0, "a pending payout holds the balance"

    raw = json.dumps({"id": "evt_po_1", "type": "payout.completed", "data": {"reference": "SNP-PO-1", "status": "completed", "external_reference": "AIR123"}}).encode()
    ts = str(int(time.time()))
    sig = hmac.new(SECRET.encode(), f"{ts}.".encode() + raw, hashlib.sha256).hexdigest()
    from rest_framework.test import APIClient

    r = APIClient().post("/v1/webhooks/snippe", data=raw, content_type="application/json", HTTP_X_WEBHOOK_TIMESTAMP=ts, HTTP_X_WEBHOOK_SIGNATURE=sig)
    assert r.status_code == 200
    p.refresh_from_db()
    assert (p.status, p.external_ref) == ("COMPLETED", "AIR123") and p.completed_at


@respx.mock
def test_snippe_rejection_marks_failed_and_releases(rider, store, order_factory, admin_user, snippe_on):
    _complete_jobs(rider, store, order_factory, [5000])
    respx.post("https://api.snippe.sh/v1/payouts/send").mock(return_value=Response(400, json={"error_code": "insufficient_balance", "message": "Insufficient balance"}))
    with pytest.raises(Exception, match="Insufficient balance"):
        payouts.create(rider, amount=None, method="snippe", admin=admin_user)
    p = RiderPayout.objects.get(rider=rider)
    assert p.status == "FAILED" and "Insufficient" in p.failure_reason
    assert payouts.owed(rider)["unpaid"] == 5000


def test_snippe_requires_configuration(rider, store, order_factory, admin_user):
    _complete_jobs(rider, store, order_factory, [5000])
    with pytest.raises(Exception, match="Snippe payouts"):
        payouts.create(rider, amount=None, method="snippe", admin=admin_user)
