from __future__ import annotations

import pytest
from django.core.management import call_command

from delivery.management.commands.simulate_rider import bearing, curved, decode_polyline


def test_decode_polyline_matches_google_reference():
    # Reference example from Google's Encoded Polyline Algorithm documentation.
    pts = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    assert pts == [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)]


def test_curved_path_starts_and_ends_on_the_points():
    a, b = (-6.7486, 39.2789), (-6.7666, 39.2569)
    path = curved(a, b, n=20)
    assert len(path) == 21 and path[0] == pytest.approx(a) and path[-1] == pytest.approx(b)


def test_bearing_cardinal_directions():
    assert bearing((0, 0), (1, 0)) == pytest.approx(0, abs=1e-6)
    assert bearing((0, 0), (0, 1)) == pytest.approx(90, abs=1e-6)


@pytest.mark.django_db
def test_seed_without_media_is_idempotent_and_keeps_drafts():
    from catalog.models import Brand, Product
    from delivery.models import Rider
    from inventory.models import InventoryLevel, Store

    call_command("seed", "--no-media", "--admin-password", "test-password-123", stdout=open("/dev/null", "w"))
    n = Product.objects.count()
    assert n >= 40 and Store.objects.count() == 5 and Rider.objects.filter(status="ACTIVE").count() == 3 and Brand.objects.count() >= 10
    # No image → nothing is published (the brief never allows an imageless product in the app)
    assert not Product.objects.filter(status="PUBLISHED").exists()
    assert InventoryLevel.objects.filter(on_hand__gt=0).exists()
    lipstick = Product.objects.get(title="Velvet matte lipstick")
    assert lipstick.is_beauty and lipstick.option_types.filter(kind="shade").exists()
    call_command("seed", "--no-media", stdout=open("/dev/null", "w"))
    assert Product.objects.count() == n
