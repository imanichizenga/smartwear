"""Endpoints behind the Profile screens: wishlist cards, default saved place, payment history."""
from __future__ import annotations

import pytest

from catalog.services.products import upsert_product
from catalog.tests.test_products import dress_payload, store
from commerce.models import Order, Payment
from conftest import user_client

pytestmark = pytest.mark.django_db


def test_wishlist_expand_returns_product_cards(customer, admin_user):
    store()
    p = upsert_product(dress_payload(), admin=admin_user)
    c = user_client(customer)
    assert c.post("/v1/wishlist", {"productId": str(p.id)}, format="json").status_code == 201
    plain = c.get("/v1/wishlist").json()
    assert plain["productIds"] == [str(p.id)] and "products" not in plain
    full = c.get("/v1/wishlist?expand=products").json()
    assert [x["id"] for x in full["products"]] == [str(p.id)] and full["products"][0]["wishlisted"] is True


def test_saved_place_default(customer):
    c = user_client(customer)
    home = c.post("/v1/me/places", {"lat": -6.77, "lng": 39.24, "kind": "home", "address": "Mikocheni"}, format="json").json()
    assert home["isDefault"] is True  # the first saved place becomes the default
    work = c.post("/v1/me/places", {"lat": -6.81, "lng": 39.28, "kind": "work", "address": "Posta"}, format="json").json()
    assert work["isDefault"] is False
    assert c.patch(f"/v1/me/places/{work['id']}", {"isDefault": True}, format="json").json()["isDefault"] is True
    saved = {p["id"]: p for p in c.get("/v1/me/places").json()["saved"]}
    assert saved[work["id"]]["isDefault"] and not saved[home["id"]]["isDefault"]
    renamed = c.patch(f"/v1/me/places/{home['id']}", {"label": "Mum's", "kind": "other"}, format="json").json()
    assert renamed["label"] == "Mum's" and renamed["kind"] == "other"


def test_payment_history(customer):
    from inventory.models import Store

    s = store() if not Store.objects.exists() else Store.objects.first()
    o = Order.objects.create(number="SW-9001", user=customer, store=s, currency="TZS", subtotal=1000, total=1000, payment_method="MOBILE_MONEY", delivery_option={})
    Payment.objects.create(order=o, method="MOBILE_MONEY", provider="snippe", status="PAID", amount=1000, currency="TZS", reference="ref-1", msisdn="255712345678")
    r = user_client(customer).get("/v1/me/payments").json()
    assert len(r["items"]) == 1
    item = r["items"][0]
    assert item["order"]["number"] == "SW-9001" and item["status"] == "PAID" and item["msisdn"].startswith("255712") and "345" not in item["msisdn"][6:]
