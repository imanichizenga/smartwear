"""Breadcrumb sampling: realistic 3 s / ~20 m updates must still leave a usable trail for replay and disputes."""
from datetime import timedelta

import pytest
from django.utils import timezone

from accounts.models import User
from delivery.models import Rider, RiderLocationPing
from delivery.services import dispatch

pytestmark = pytest.mark.django_db


def test_steady_cadence_keeps_a_sampled_trail():
    rider = Rider.objects.create(user=User.objects.create(phone="+255754000333", name="Neema"), status="ACTIVE", presence="IDLE")
    t0 = timezone.now() - timedelta(minutes=5)
    # 60 updates, 3 s apart, ~20 m apart (≈ 25 km/h) — 3 minutes, ~1.2 km.
    for i in range(60):
        dispatch.update_location(Rider.objects.get(pk=rider.pk), lat=-6.75 - i * 0.00018, lng=39.27, heading=180, recorded_at=t0 + timedelta(seconds=3 * i))
    n = RiderLocationPing.objects.filter(rider=rider).count()
    # One ping per 40 m (or 15 s): roughly every other update — never all, never just the first.
    assert 20 <= n <= 35, n


def test_stationary_rider_pings_every_15_seconds():
    rider = Rider.objects.create(user=User.objects.create(phone="+255754000334", name="Baraka"), status="ACTIVE", presence="IDLE")
    t0 = timezone.now() - timedelta(minutes=5)
    for i in range(20):  # 60 s parked
        dispatch.update_location(Rider.objects.get(pk=rider.pk), lat=-6.75, lng=39.27, recorded_at=t0 + timedelta(seconds=3 * i))
    assert RiderLocationPing.objects.filter(rider=rider).count() == 4  # t = 0, 15, 30, 45 s
