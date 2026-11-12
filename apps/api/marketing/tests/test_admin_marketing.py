from __future__ import annotations

import pytest

from accounts.models import User
from notifications.models import PushToken
from conftest import admin_client
from marketing.models import Story

pytestmark = pytest.mark.django_db


def test_campaign_reach_estimate_respects_audience_and_opt_outs(admin_user):
    a = User.objects.create(phone="+255700000001", name="A", customer_type="WHOLESALE")
    b = User.objects.create(phone="+255700000002", name="B")
    User.objects.create(phone="+255700000003", name="C", notification_prefs={"sms": False})
    PushToken.objects.create(user=a, token="tok-a", platform="android")
    c = admin_client(admin_user)
    sms = c.post("/v1/admin/campaigns/estimate", {"channel": "sms", "audience": {}}, format="json").json()["audience"]
    assert sms == 2  # opted-out C excluded, A and B (no prefs set) included
    assert c.post("/v1/admin/campaigns/estimate", {"channel": "sms", "audience": {"customerTypes": ["WHOLESALE"]}}, format="json").json()["audience"] == 1
    assert c.post("/v1/admin/campaigns/estimate", {"channel": "push", "audience": {}}, format="json").json()["audience"] == 1
    assert b.id


def test_story_admin_out_includes_brand_id(admin_user):
    from catalog.models import Brand
    from catalog.tests.test_products import ready_image

    brand = Brand.objects.create(name="Pwani", slug="pwani")
    Story.objects.create(title="Glow", cover=ready_image(), brand=brand)
    items = admin_client(admin_user).get("/v1/admin/stories").json()["items"]
    assert items[0]["brandId"] == str(brand.id)
