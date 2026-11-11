"""End-to-end through the API: bag → quote → place (COD) → dispatch → rider steps → PIN → delivered."""
from __future__ import annotations

import pytest
from django.contrib.gis.geos import Point

from accounts.models import User
from catalog.models import ProductVariant
from catalog.services.products import upsert_product
from catalog.tests.test_products import dress_payload, store
from commerce.models import Order
from conftest import admin_client, user_client
from delivery.models import DeliveryJob, Rider, Vehicle
from delivery.services import dispatch
from inventory.models import InventoryLevel

pytestmark = pytest.mark.django_db

MIKOCHENI = (-6.7700, 39.2420)


@pytest.fixture
def world(admin_user, customer):
    s = store()
    p = upsert_product(dress_payload(), admin=admin_user)
    v = ProductVariant.objects.get(sku="ZURI-IVO-M")
    ru = User.objects.create(phone="+255754000111", name="Juma Rider", phone_verified_at="2026-01-01T00:00:00Z")
    rider = Rider.objects.create(user=ru, status="ACTIVE", rating_avg=4.9)
    Vehicle.objects.create(rider=rider, type="MOTORBIKE", plate="MC 123 ABC", color="Black", is_primary=True)
    customer.phone_verified_at = "2026-01-01T00:00:00Z"
    customer.save()
    return {"store": s, "product": p, "variant": v, "rider": rider, "riderUser": ru, "customer": customer}


def test_full_lifecycle(world, admin_user):
    c = user_client(world["customer"])
    v = world["variant"]
    r = c.post("/v1/cart/items", {"variantId": str(v.id), "qty": 2}, format="json")
    assert r.status_code == 201 and r.json()["subtotal"] == 170000
    # Rider online near the store before the order lands
    rc = user_client(world["riderUser"])
    assert rc.post("/v1/rider/presence", {"online": True, "lat": -6.7490, "lng": 39.2780}, format="json").status_code == 200
    q = c.post("/v1/checkout/quote", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    assert q["canPlace"] is True, q["problems"]
    assert q["store"]["name"] == "SmartWear Masaki"
    kinds = {o["kind"]: o for o in q["options"]}
    assert kinds["express"]["fee"] > kinds["standard"]["fee"] > 0 and kinds["pickup"]["fee"] == 0
    assert q["payment"]["default"]["method"] == "CASH_ON_DELIVERY"
    std = kinds["standard"]
    placed = c.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "deliveryOptionId": "standard", "expectedTotal": q["cart"]["total"] - kinds[q["selectedOptionId"]]["fee"] + std["fee"], "landmarkNote": "Blue gate opposite the pharmacy"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
    assert placed.status_code == 201, placed.json()
    o = placed.json()
    assert o["status"] == "PREPARING" and o["total"] == 170000 + std["fee"]
    # Idempotent replay returns the same order, never a second one
    again = c.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "deliveryOptionId": "standard", "expectedTotal": q["cart"]["total"] - kinds[q["selectedOptionId"]]["fee"] + std["fee"], "landmarkNote": "Blue gate opposite the pharmacy"}, format="json", HTTP_IDEMPOTENCY_KEY="k-1")
    assert again.json()["id"] == o["id"] and Order.objects.count() == 1
    lvl = InventoryLevel.objects.get(store=world["store"], variant=v)
    assert (lvl.on_hand, lvl.reserved) == (5, 2)
    assert c.get("/v1/cart").json()["items"] == []

    job = DeliveryJob.objects.get(order_id=o["id"])
    assert job.status == "SEARCHING"
    res = dispatch.run_round(str(job.id))
    assert res["offered"] == 1
    me = rc.get("/v1/rider/me").json()
    offer = me["pendingOffer"]
    assert offer and offer["dropoffArea"]["approx"]["lat"] == round(MIKOCHENI[0], 3)  # approximate until accepted
    acc = rc.post(f"/v1/rider/offers/{offer['id']}/accept", {}, format="json")
    assert acc.status_code == 200, acc.json()
    jid = acc.json()["job"]["id"]
    assert acc.json()["job"]["dropoff"]["landmark"] == "Blue gate opposite the pharmacy"
    track = c.get(f"/v1/me/orders/{o['id']}").json()
    assert track["status"] == "ASSIGNED" and track["delivery"]["rider"]["firstName"] == "Juma"
    assert track["delivery"]["rider"]["vehicle"]["plate"] == "MC 123 ABC"
    pin = track["pin"]
    assert pin and len(pin) == 4

    assert rc.post(f"/v1/rider/jobs/{jid}", {"step": "AT_STORE"}, format="json").status_code == 200
    assert rc.post(f"/v1/rider/jobs/{jid}", {"step": "PICKED_UP", "scan": "SWPICK:wrong"}, format="json").status_code == 400
    j = rc.post(f"/v1/rider/jobs/{jid}", {"step": "PICKED_UP", "scan": f"SWPICK:{o['id']}"}, format="json").json()
    assert j["status"] == "EN_ROUTE"
    lvl.refresh_from_db()
    assert (lvl.on_hand, lvl.reserved) == (3, 0)
    assert c.get(f"/v1/me/orders/{o['id']}").json()["status"] == "ON_THE_WAY"
    loc = rc.post("/v1/rider/location", {"points": [{"lat": -6.7600, "lng": 39.2600, "heading": 270, "battery": 0.8}]}, format="json").json()
    assert loc["ok"] and loc["nextIntervalSeconds"] == 3
    live = c.get(f"/v1/me/orders/{o['id']}").json()["delivery"]
    assert live["riderLocation"]["lat"] == -6.76 and live["riderLocation"]["heading"] == 270
    assert rc.post(f"/v1/rider/jobs/{jid}", {"step": "ARRIVED", "lat": 0, "lng": 0}, format="json").json()["code"] == "too_far"
    assert rc.post(f"/v1/rider/jobs/{jid}", {"step": "ARRIVED", "lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").status_code == 200
    bad = rc.post(f"/v1/rider/jobs/{jid}", {"step": "COMPLETED", "pin": "0000" if pin != "0000" else "1111"}, format="json")
    assert bad.status_code == 400 and bad.json()["code"] == "pin_invalid"
    done = rc.post(f"/v1/rider/jobs/{jid}", {"step": "COMPLETED", "pin": pin}, format="json")
    assert done.status_code == 200, done.json()
    final = c.get(f"/v1/me/orders/{o['id']}").json()
    assert final["status"] == "DELIVERED" and final["payment"]["status"] == "PAID" and final["pin"] is None and final["delivery"]["riderLocation"] is None
    world["customer"].refresh_from_db()
    assert world["customer"].loyalty_points == int(170000 * 0.001)
    rate = c.post(f"/v1/me/orders/{o['id']}/rate", {"riderRating": 5, "riderTags": ["Friendly"], "products": [{"productId": str(world["product"].id), "rating": 5}]}, format="json")
    assert rate.status_code == 200
    rider = Rider.objects.get(id=world["rider"].id)
    assert rider.deliveries_count == 1 and rider.rating_count == 1 and rider.presence == "IDLE"
    adm = admin_client(admin_user).get(f"/v1/admin/orders/{o['id']}").json()
    assert [e["to"] for e in adm["events"] if e["type"] == "status"] == ["CONFIRMED", "PREPARING", "ASSIGNED", "PICKED_UP", "ON_THE_WAY", "ARRIVED", "DELIVERED"]
    assert admin_client(admin_user).get(f"/v1/admin/orders/{o['id']}/invoice.pdf").content[:4] == b"%PDF"


def test_no_rider_then_manual_assign(world, admin_user, settings):
    c = user_client(world["customer"])
    c.post("/v1/cart/items", {"variantId": str(world["variant"].id), "qty": 1}, format="json")
    o = c.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "deliveryOptionId": "express"}, format="json").json()
    job = DeliveryJob.objects.get(order_id=o["id"])
    from core import settings_service

    for _ in range(settings_service.get("delivery.dispatch").maxRounds):
        dispatch.run_round(str(job.id))
    job.refresh_from_db()
    assert job.status == "NO_RIDER"
    assert c.post(f"/v1/me/orders/{o['id']}/keep-searching", {}, format="json").json()["delivery"]["status"] == "SEARCHING"
    adm = admin_client(admin_user)
    r = adm.post(f"/v1/admin/orders/{o['id']}/actions", {"action": "assign", "riderId": str(world["rider"].id)}, format="json")
    assert r.status_code == 200, r.json()
    assert r.json()["status"] == "ASSIGNED" and r.json()["delivery"]["rider"]["phone"] == "+255754000111"


def test_rider_release_redispatches_and_cancel_releases_stock(world):
    c = user_client(world["customer"])
    rc = user_client(world["riderUser"])
    rc.post("/v1/rider/presence", {"online": True, "lat": -6.7490, "lng": 39.2780}, format="json")
    c.post("/v1/cart/items", {"variantId": str(world["variant"].id), "qty": 1}, format="json")
    o = c.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    job = DeliveryJob.objects.get(order_id=o["id"])
    dispatch.run_round(str(job.id))
    offer = rc.get("/v1/rider/me").json()["pendingOffer"]
    jid = rc.post(f"/v1/rider/offers/{offer['id']}/accept", {}, format="json").json()["job"]["id"]
    assert rc.post(f"/v1/rider/jobs/{jid}", {"release": "Puncture"}, format="json").json()["released"] is True
    job.refresh_from_db()
    assert job.status == "SEARCHING" and job.rider_id is None
    assert c.get(f"/v1/me/orders/{o['id']}").json()["status"] == "PREPARING"
    # Rider who released isn't offered the same job again
    assert dispatch.run_round(str(job.id))["offered"] == 0
    cancel = c.post(f"/v1/me/orders/{o['id']}/cancel", {"reason": "Changed my mind"}, format="json")
    assert cancel.status_code == 409  # customers can only cancel before preparation starts
    from commerce.services.orders import transition

    transition(Order.objects.get(id=o["id"]), "CANCELLED", actor="admin", reason="Customer called")
    lvl = InventoryLevel.objects.get(store=world["store"], variant=world["variant"])
    assert lvl.reserved == 0 and lvl.on_hand == 5
    job.refresh_from_db()
    assert job.status == "CANCELLED"


def test_stock_race_and_price_change_protection(world):
    c = user_client(world["customer"])
    v = world["variant"]
    c.post("/v1/cart/items", {"variantId": str(v.id), "qty": 6}, format="json")
    q = c.post("/v1/checkout/quote", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    assert q["store"] is None and q["canPlace"] is False  # only 5 in stock anywhere
    assert any(p["reason"] == "out_of_stock" for p in q["problems"])
    c.patch(f"/v1/cart/items/{q['cart']['items'][0]['id']}", {"qty": 1}, format="json")
    q = c.post("/v1/checkout/quote", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1]}, format="json").json()
    r = c.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "expectedTotal": q["cart"]["total"] - 1}, format="json")
    assert r.status_code == 409 and r.json()["code"] == "total_changed"


def test_wholesale_tier_applies_in_cart_and_order(world):
    u = world["customer"]
    u.customer_type, u.wholesale_approved = "WHOLESALE", True
    u.save()
    InventoryLevel.objects.filter(variant=world["variant"]).update(on_hand=50)
    c = user_client(u)
    cart = c.post("/v1/cart/items", {"variantId": str(world["variant"].id), "qty": 5}, format="json").json()
    line = cart["items"][0]
    assert line["unitPrice"] == 85000 and line["nextTier"] == {"addQty": 1, "unitPrice": 72000}
    assert line["moqViolation"] is False
    cart = c.patch(f"/v1/cart/items/{line['id']}", {"qty": 6}, format="json").json()
    assert cart["items"][0]["unitPrice"] == 72000 and cart["savings"] == 13000 * 6
    o = c.post("/v1/orders", {"lat": MIKOCHENI[0], "lng": MIKOCHENI[1], "deliveryOptionId": "pickup"}, format="json").json()
    assert o["items"][0]["basis"] == "tier" and o["items"][0]["unitPrice"] == 72000 and o["fulfilment"] == "pickup" and o["deliveryFee"] == 0
