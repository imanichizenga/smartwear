"""Delivery fee + rider earning — mirrors packages/shared/src/delivery/fees.ts."""
from __future__ import annotations

import math
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo


def _round(x: float) -> int:
    return math.floor(x + 0.5)


def round_to(n: float, step: int) -> int:
    return _round(n) if step <= 1 else _round(n / step) * step


def peak_multiplier(settings, at: datetime, tz: str = "Africa/Dar_es_Salaam") -> float:
    local = at.astimezone(ZoneInfo(tz))
    day = (local.weekday() + 1) % 7  # JS getDay(): Sunday = 0
    hour = local.hour + local.minute / 60
    m = 1.0
    for w in settings.peakWindows:
        if (not w.days or day in w.days) and w.startHour <= hour < w.endHour:
            m = max(m, w.multiplier)
    return m


def compute_fee(settings, *, distance_m: int, zone: dict | None, option, subtotal: int, at: datetime, tz: str = "Africa/Dar_es_Salaam") -> dict[str, Any]:
    def empty(serviceable: bool, reason: str | None = None) -> dict[str, Any]:
        return {"distanceMeters": distance_m, "billableMeters": 0, "baseFee": 0, "distanceFee": 0, "zoneFee": None, "zoneSurcharge": 0, "peakMultiplier": 1, "optionMultiplier": option.feeMultiplier,
                "optionSurcharge": option.surcharge, "subtotalBeforeFree": 0, "freeDelivery": False, "fee": 0, "zone": {"id": zone["id"], "name": zone["name"]} if zone else None, "serviceable": serviceable, "reason": reason}

    if option.kind == "pickup":
        return empty(True)
    if zone and not zone["serviceable"]:
        return empty(False, "zone_not_serviceable")
    if not zone and distance_m > settings.maxDistanceMeters:
        return empty(False, "out_of_range")
    billable = max(0, distance_m - settings.includedMeters)
    distance_fee = _round(billable / 1000 * settings.perKm)
    formula = max(settings.minimumFee, settings.baseFee + distance_fee)
    zone_fee = zone["flatFee"] if zone and zone.get("flatFee") is not None else None
    core = zone_fee if zone_fee is not None else formula
    surcharge = zone["surcharge"] if zone else 0
    pm = peak_multiplier(settings, at, tz)
    fee = round_to((core + surcharge) * pm * option.feeMultiplier + option.surcharge, settings.roundTo)
    before = fee
    free = settings.freeDeliveryThreshold is not None and subtotal >= settings.freeDeliveryThreshold
    return {"distanceMeters": distance_m, "billableMeters": billable, "baseFee": settings.baseFee, "distanceFee": distance_fee, "zoneFee": zone_fee, "zoneSurcharge": surcharge, "peakMultiplier": pm,
            "optionMultiplier": option.feeMultiplier, "optionSurcharge": option.surcharge, "subtotalBeforeFree": before, "freeDelivery": free, "fee": 0 if free else fee,
            "zone": {"id": zone["id"], "name": zone["name"]} if zone else None, "serviceable": True, "reason": None}


def rider_earning(settings, distance_m: int, customer_fee: int) -> int:
    r = settings.riderEarning
    if r.shareOfFeeBps > 0:
        return max(r.minimum, _round(customer_fee * r.shareOfFeeBps / 10000))
    return max(r.minimum, r.baseFee + _round(distance_m / 1000 * r.perKm))


def eta_window(option, route_minutes: float | None, prep_minutes: int) -> tuple[int, int]:
    if option.kind == "pickup":
        return option.etaMinMinutes, option.etaMaxMinutes
    travel = route_minutes if route_minutes is not None else option.etaMinMinutes
    return max(option.etaMinMinutes, _round(prep_minutes + travel)), max(option.etaMaxMinutes, _round(prep_minutes + travel * 1.4 + 10))


def match_zone(lat: float, lng: float) -> dict | None:
    from django.contrib.gis.geos import Point

    from .models import DeliveryZone

    z = DeliveryZone.objects.filter(is_active=True, polygon__intersects=Point(lng, lat, srid=4326)).order_by("-priority").first()
    return {"id": str(z.id), "name": z.name, "flatFee": z.flat_fee, "surcharge": z.surcharge, "serviceable": z.serviceable} if z else None
