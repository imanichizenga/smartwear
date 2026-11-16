"""Delivery location mode: admin-selectable Automatic (map) vs Manual (written details, GPS optional)."""
from __future__ import annotations

import pytest

from accounts.models import User
from catalog.models import ProductVariant
from catalog.services.products import upsert_product
from catalog.tests.test_products import dress_payload, store
from commerce.models import Order
from commerce.tests.test_order_lifecycle import MIKOCHENI
from conftest import admin_client, user_client
from core import settings_service
from delivery.models import DeliveryJob, Rider, Vehicle
from delivery.services import dispatch

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(admin_user, customer):
    store()
    upsert_product(dress_payload(), admin=admin_user)
    ru = User.objects.create(phone="+255754000111", name="Juma Rider", phone_verified_at="2026-01-01T00:00:00Z")
    rider = Rider.objects.create(user=ru, status="ACTIVE", rating_avg=4.9)
    Vehicle.objects.create(rider=rider, type="MOTORBIKE", plate="MC 123 ABC", color="Black", is_primary=True)
    customer.phone_verified_at = "2026-01-01T00:00:00Z"
    customer.save()
    return {"variant": ProductVariant.objects.get(sku="ZURI-IVO-M"), "riderUser": ru, "customer": customer}

DETAILS = "Mikocheni B, Kawawa Rd, blue gate opposite the pharmacy"


def _manual(**extra):
    settings_service.update("checkout", {"locationMode": "manual", **extra})


def _bag(c, world):
    assert c.post("/v1/cart/items", {"variantId": str(world["variant"].id), "qty": 1}, format="json").status_code == 201


def test_public_config_exposes_location_mode(api):
    cfg = api.get("/v1/config/public").json()["checkout"]
    assert cfg["locationMode"] == "automatic"
    assert cfg["manualDetailFields"]["location"]["required"] is True
    assert cfg["manualDetailFields"]["notes"]["labelSw"]
    _manual()
    assert api.get("/v1/config/public").json()["checkout"]["locationMode"] == "manual"


def test_automatic_mode_still_requires_a_location(world):
    c = user_client(world["customer"])
    _bag(c, world)
    r = c.post("/v1/checkout/quote", {}, format="json")
    assert r.status_code == 400 and r.json()["details"]["field"] == "location"


def test_manual_quote_without_coordinates_uses_base_or_flat_fee(world):
    _manual()
    c = user_client(world["customer"])
    _bag(c, world)
    q = c.post("/v1/checkout/quote", {}, format="json")
    assert q.status_code == 200, q.json()
    q = q.json()
    assert q["locationMode"] == "manual" and q["deliverTo"] is None and q["canPlace"] is True, q["problems"]
    std = next(o for o in q["options"] if o["id"] == "standard")
    assert std["available"] and std["fee"] > 0 and std["breakdown"]["manual"] is True
    _manual(manualDeliveryFee=4000)
    std = next(o for o in c.post("/v1/checkout/quote", {}, format="json").json()["options"] if o["id"] == "standard")
    assert std["fee"] == 4000


def test_manual_place_validates_and_stores_details(world, admin_user):
    _manual()
    c = user_client(world["customer"])
    _bag(c, world)
    q = c.post("/v1/checkout/quote", {}, format="json").json()
    body = {"deliveryOptionId": q["selectedOptionId"], "expectedTotal": q["cart"]["total"]}
    missing = c.post("/v1/orders", {**body, "locationDetails": "   "}, format="json", HTTP_IDEMPOTENCY_KEY="m-0")
    assert missing.status_code == 400 and missing.json()["details"]["field"] == "locationDetails"

    placed = c.post("/v1/orders", {**body, "locationDetails": DETAILS, "deliveryNotes": "Call at the gate"}, format="json", HTTP_IDEMPOTENCY_KEY="m-1")
    assert placed.status_code == 201, placed.json()
    o = Order.objects.get(id=placed.json()["id"])
    assert (o.location_mode, o.location_details, o.delivery_notes, o.destination) == ("manual", DETAILS, "Call at the gate", None)
    assert o.destination_label.startswith("Mikocheni B")
    loc = placed.json()["location"]
    assert loc == {"mode": "manual", "details": DETAILS, "notes": "Call at the gate", "hasCoordinates": False, "accuracyMeters": None}

    # Admin order detail and the rider's job carry the written details.
    admin = admin_client(admin_user).get(f"/v1/admin/orders/{o.id}").json()
    assert admin["location"]["details"] == DETAILS
    job = DeliveryJob.objects.get(order=o)
    out = dispatch.job_out(job)
    assert out["dropoff"]["locationDetails"] == DETAILS and out["dropoff"]["location"] is None


def test_manual_with_detected_gps_keeps_coordinates(world):
    _manual()
    c = user_client(world["customer"])
    _bag(c, world)
    q = c.post("/v1/checkout/quote", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    assert q["deliverTo"] == {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}
    placed = c.post(
        "/v1/orders",
        {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "accuracy": 18.5, "deliveryOptionId": q["selectedOptionId"], "expectedTotal": q["cart"]["total"], "locationDetails": DETAILS},
        format="json",
        HTTP_IDEMPOTENCY_KEY="m-2",
    )
    assert placed.status_code == 201, placed.json()
    assert placed.json()["location"]["hasCoordinates"] is True and placed.json()["location"]["accuracyMeters"] == 18.5


def test_rider_can_arrive_on_a_manual_order_without_gps(world):
    _manual()
    c = user_client(world["customer"])
    _bag(c, world)
    rc = user_client(world["riderUser"])
    assert rc.post("/v1/rider/presence", {"online": True, "lat": -6.7490, "lng": 39.2780}, format="json").status_code == 200
    q = c.post("/v1/checkout/quote", {}, format="json").json()
    o = c.post("/v1/orders", {"deliveryOptionId": q["selectedOptionId"], "expectedTotal": q["cart"]["total"], "locationDetails": DETAILS}, format="json", HTTP_IDEMPOTENCY_KEY="m-3").json()
    job = DeliveryJob.objects.get(order_id=o["id"])
    dispatch.run_round(str(job.id))
    offer = rc.get("/v1/rider/me").json()["pendingOffer"]
    assert offer["dropoffArea"]["approx"] is None
    jid = rc.post(f"/v1/rider/offers/{offer['id']}/accept", {}, format="json").json()["job"]["id"]
    assert rc.post(f"/v1/rider/jobs/{jid}", {"step": "AT_STORE"}, format="json").status_code == 200
    assert rc.post(f"/v1/rider/jobs/{jid}", {"step": "PICKED_UP", "scan": f"SWPICK:{o['id']}"}, format="json").status_code == 200
    # Location pings on the client leg must not try to route to a point that doesn't exist.
    assert rc.post("/v1/rider/location", {"points": [{"lat": -6.76, "lng": 39.26}]}, format="json").status_code == 200
    r = rc.post(f"/v1/rider/jobs/{jid}", {"step": "ARRIVED", "lat": -6.80, "lng": 39.30}, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["navigationUrl"] is None
