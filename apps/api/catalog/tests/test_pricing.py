"""Same cases as packages/shared/src/pricing/__tests__/engine.test.ts — the two engines must agree."""
from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime

from catalog.pricing import (
    CartLine, PriceListEntry, PricingContext, PromoRule, Tier, VariantPricing, WholesaleSettings, apply_rounding, evaluate_promo,
    margin_bps, price_cart, tier_table, unit_price_for,
)

P = VariantPricing(retail_price=25000, compare_at_price=30000, tiers=[Tier(6, 21000), Tier(24, 18000)], moq=6, currency="TZS")
BASE = WholesaleSettings(visibility="everyone", auto_tiers_for_retail=True, rounding="none", tax_inclusive=True, tax_rate_bps=1800, currency="TZS")
RETAIL = PricingContext("RETAIL", False, BASE)
WHOLESALE = PricingContext("WHOLESALE", True, replace(BASE, visibility="approved_only"))


def test_retail_qty1_gets_nudge():
    r = unit_price_for("v1", P, 1, RETAIL)
    assert (r.unit_price, r.basis, r.compare_at_price) == (25000, "retail", 30000)
    assert r.next_tier == {"addQty": 5, "unitPrice": 21000}


def test_retail_auto_tier_at_6():
    r = unit_price_for("v1", P, 6, RETAIL)
    assert (r.unit_price, r.basis, r.savings) == (21000, "tier", 4000 * 6)
    assert r.next_tier == {"addQty": 18, "unitPrice": 18000}


def test_approved_only_hides_tiers_from_retail():
    r = unit_price_for("v1", P, 30, PricingContext("RETAIL", False, replace(BASE, visibility="approved_only")))
    assert r.unit_price == 25000 and r.next_tier is None


def test_hidden_disables_tiers():
    assert unit_price_for("v1", P, 30, PricingContext("WHOLESALE", True, replace(BASE, visibility="hidden"))).unit_price == 25000


def test_wholesale_moq_and_top_tier():
    assert unit_price_for("v1", P, 2, WHOLESALE).moq_violation is True
    r = unit_price_for("v1", P, 24, WHOLESALE)
    assert (r.unit_price, r.moq_violation, r.next_tier) == (18000, False, None)


def test_price_list_beats_tiers():
    ctx = replace(WHOLESALE, price_list=[PriceListEntry("v1", 17000)])
    r = unit_price_for("v1", P, 1, ctx)
    assert (r.unit_price, r.basis) == (17000, "price_list")


def test_price_list_picks_highest_min_qty_reached():
    ctx = replace(WHOLESALE, price_list=[PriceListEntry("v1", 17000, 1), PriceListEntry("v1", 15000, 50)])
    assert unit_price_for("v1", P, 49, ctx).unit_price == 17000
    assert unit_price_for("v1", P, 50, ctx).unit_price == 15000


def test_tier_never_exceeds_retail():
    assert unit_price_for("v1", replace(P, tiers=[Tier(2, 99000)]), 5, RETAIL).unit_price == 25000


def test_rounding():
    ctx = PricingContext("RETAIL", False, replace(BASE, rounding="nearest_100"))
    assert unit_price_for("v1", replace(P, retail_price=25049), 1, ctx).unit_price == 25000
    assert apply_rounding(25050, "nearest_100") == 25100  # half up, like JS Math.round
    assert apply_rounding(25001, "up_100") == 25100 and apply_rounding(25099, "down_100") == 25000


def test_tier_table():
    rows = tier_table(P, 7)
    assert [r["label"] for r in rows] == ["1–5", "6–23", "24+"]
    assert next(r for r in rows if r["active"])["label"] == "6–23"
    assert tier_table(replace(P, tiers=[]), 1) == []


def test_price_cart_inclusive_tax():
    t = price_cart([CartLine("a", "v1", 2, P), CartLine("b", "v2", 6, P)], RETAIL, delivery_fee=3000, discount=5000)
    assert t.subtotal == 50000 + 126000
    assert t.discount == 5000
    assert t.total == 176000 - 5000 + 3000
    assert t.tax == round(171000 - 171000 / 1.18)
    assert t.savings == 24000


def test_price_cart_exclusive_tax():
    t = price_cart([CartLine("a", "v1", 1, P)], PricingContext("RETAIL", False, replace(BASE, tax_inclusive=False)))
    assert (t.tax, t.total) == (4500, 29500)


NOW = datetime(2026, 6, 1, tzinfo=UTC)


def test_promo_percent_cap():
    assert evaluate_promo(PromoRule("TEN", "PERCENT", 1000, max_discount=2000), 50000, 0, "RETAIL", NOW) == {"ok": True, "discount": 2000, "freeDelivery": False}


def test_promo_rules():
    assert evaluate_promo(PromoRule("A", "FIXED", 1000, min_subtotal=60000), 50000, 0, "RETAIL", NOW)["reason"] == "min_subtotal"
    assert evaluate_promo(PromoRule("A", "FIXED", 1000, ends_at=datetime(2026, 1, 1, tzinfo=UTC)), 50000, 0, "RETAIL", NOW)["reason"] == "expired"
    assert evaluate_promo(PromoRule("A", "FIXED", 1000, usage_limit=1, used_count=1), 50000, 0, "RETAIL", NOW)["reason"] == "usage_limit"
    assert evaluate_promo(PromoRule("A", "FIXED", 1000, customer_types=["WHOLESALE"]), 50000, 0, "RETAIL", NOW)["reason"] == "customer_type"


def test_promo_free_delivery():
    assert evaluate_promo(PromoRule("SHIP", "FREE_DELIVERY", 0), 50000, 3000, "RETAIL", NOW) == {"ok": True, "discount": 0, "freeDelivery": True}


def test_margin():
    assert margin_bps(25000, 15000) == 4000
    assert margin_bps(25000, None) is None
