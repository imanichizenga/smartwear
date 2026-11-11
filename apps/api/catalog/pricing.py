"""
Server-side pricing engine — the only place charged prices are computed.
Mirrors packages/shared/src/pricing/engine.ts exactly (same rules, same rounding) so the
apps' display helpers and the server always agree. Integer minor units throughout.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Literal

Rounding = Literal["none", "nearest_10", "nearest_50", "nearest_100", "nearest_500", "nearest_1000", "up_100", "down_100"]


def _round_half_up(x: float) -> int:
    # JS Math.round semantics (half rounds towards +∞), not Python's banker's rounding.
    return math.floor(x + 0.5)


def apply_rounding(amount: float, rule: str) -> int:
    if rule == "none":
        return _round_half_up(amount)
    if rule.startswith("nearest_"):
        step = int(rule.split("_")[1])
        return _round_half_up(amount / step) * step
    if rule == "up_100":
        return math.ceil(amount / 100) * 100
    if rule == "down_100":
        return math.floor(amount / 100) * 100
    raise ValueError(f"unknown rounding {rule}")


@dataclass(frozen=True)
class Tier:
    min_qty: int
    unit_price: int


@dataclass
class VariantPricing:
    retail_price: int
    currency: str
    compare_at_price: int | None = None
    tiers: list[Tier] = field(default_factory=list)
    moq: int | None = None
    cost_price: int | None = None


@dataclass
class WholesaleSettings:
    visibility: str = "approved_only"
    auto_tiers_for_retail: bool = True
    rounding: str = "none"
    tax_inclusive: bool = True
    tax_rate_bps: int = 0
    currency: str = "TZS"

    @classmethod
    def from_settings(cls, s) -> WholesaleSettings:
        return cls(visibility=s.visibility, auto_tiers_for_retail=s.autoTiersForRetail, rounding=s.rounding, tax_inclusive=s.taxInclusive, tax_rate_bps=s.taxRateBps, currency=s.currency)


@dataclass
class PriceListEntry:
    variant_id: str
    unit_price: int
    min_qty: int = 1


@dataclass
class PricingContext:
    customer_type: str
    wholesale_approved: bool
    settings: WholesaleSettings
    price_list: list[PriceListEntry] = field(default_factory=list)

    @property
    def is_wholesale(self) -> bool:
        return self.customer_type == "WHOLESALE" and self.wholesale_approved


@dataclass
class UnitPrice:
    unit_price: int
    basis: str  # retail | tier | price_list
    tier: Tier | None
    compare_at_price: int | None
    savings: int
    next_tier: dict | None
    moq_violation: bool

    def to_json(self) -> dict[str, Any]:
        return {
            "unitPrice": self.unit_price, "basis": self.basis, "tier": {"minQty": self.tier.min_qty, "unitPrice": self.tier.unit_price} if self.tier else None,
            "compareAtPrice": self.compare_at_price, "savings": self.savings, "nextTier": self.next_tier, "moqViolation": self.moq_violation,
        }


def sort_tiers(tiers: list[Tier]) -> list[Tier]:
    return sorted(tiers, key=lambda t: t.min_qty)


def can_see_wholesale(ctx: PricingContext) -> bool:
    v = ctx.settings.visibility
    return v == "everyone" or (v == "approved_only" and ctx.is_wholesale)


def tiers_apply(ctx: PricingContext) -> bool:
    if ctx.settings.visibility == "hidden":
        return False
    if ctx.is_wholesale:
        return True
    return ctx.settings.auto_tiers_for_retail and ctx.settings.visibility == "everyone"


def active_tier(tiers: list[Tier], qty: int) -> Tier | None:
    best = None
    for t in sort_tiers(tiers):
        if qty >= t.min_qty:
            best = t
    return best


def next_tier(tiers: list[Tier], qty: int) -> Tier | None:
    for t in sort_tiers(tiers):
        if qty < t.min_qty:
            return t
    return None


def unit_price_for(variant_id: str, p: VariantPricing, qty: int, ctx: PricingContext) -> UnitPrice:
    r = ctx.settings.rounding
    retail = apply_rounding(p.retail_price, r)
    compare_at = apply_rounding(p.compare_at_price, r) if p.compare_at_price and p.compare_at_price > p.retail_price else None

    if ctx.is_wholesale and ctx.price_list:
        entries = sorted([e for e in ctx.price_list if e.variant_id == variant_id and qty >= (e.min_qty or 1)], key=lambda e: -(e.min_qty or 1))
        if entries:
            unit = apply_rounding(entries[0].unit_price, r)
            return UnitPrice(unit, "price_list", None, compare_at, max(0, (retail - unit) * qty), None, False)

    applies = tiers_apply(ctx) and bool(p.tiers)
    tier = active_tier(p.tiers, qty) if applies else None
    nt = next_tier(p.tiers, qty) if applies else None
    moq_violation = ctx.is_wholesale and bool(p.moq) and qty < (p.moq or 0)

    if tier:
        unit = apply_rounding(min(tier.unit_price, retail), r)
        nxt = {"addQty": nt.min_qty - qty, "unitPrice": apply_rounding(nt.unit_price, r)} if nt and nt.unit_price < unit else None
        return UnitPrice(unit, "tier", tier, compare_at, max(0, (retail - unit) * qty), nxt, moq_violation)
    nxt = {"addQty": nt.min_qty - qty, "unitPrice": apply_rounding(nt.unit_price, r)} if nt and nt.unit_price < retail else None
    return UnitPrice(retail, "retail", None, compare_at, 0, nxt, moq_violation)


def tier_table(p: VariantPricing, qty: int, rounding: str = "none") -> list[dict[str, Any]]:
    tiers = [t for t in sort_tiers(p.tiers) if t.unit_price < p.retail_price]
    if not tiers:
        return []
    rows: list[dict[str, Any]] = []
    first = tiers[0].min_qty
    if first > 1:
        rows.append({"label": "1" if first - 1 == 1 else f"1–{first - 1}", "minQty": 1, "maxQty": first - 1, "unitPrice": apply_rounding(p.retail_price, rounding), "active": False})
    for i, t in enumerate(tiers):
        nxt = tiers[i + 1] if i + 1 < len(tiers) else None
        mx = nxt.min_qty - 1 if nxt else None
        label = f"{t.min_qty}+" if mx is None else (f"{t.min_qty}" if mx == t.min_qty else f"{t.min_qty}–{mx}")
        rows.append({"label": label, "minQty": t.min_qty, "maxQty": mx, "unitPrice": apply_rounding(t.unit_price, rounding), "active": False})
    for row in rows:
        row["active"] = qty >= row["minQty"] and (row["maxQty"] is None or qty <= row["maxQty"])
    return rows


@dataclass
class CartLine:
    line_id: str
    variant_id: str
    qty: int
    pricing: VariantPricing


@dataclass
class CartTotals:
    currency: str
    lines: list[dict[str, Any]]
    subtotal: int
    discount: int
    delivery_fee: int
    tax: int
    total: int
    savings: int


def price_cart(lines: list[CartLine], ctx: PricingContext, *, delivery_fee: int = 0, discount: int = 0, currency: str | None = None) -> CartTotals:
    priced = []
    for line in lines:
        u = unit_price_for(line.variant_id, line.pricing, line.qty, ctx)
        priced.append({"lineId": line.line_id, "variantId": line.variant_id, "qty": line.qty, "lineTotal": u.unit_price * line.qty, **u.to_json()})
    subtotal = sum(x["lineTotal"] for x in priced)
    discount = min(subtotal, max(0, discount))
    delivery_fee = max(0, delivery_fee)
    taxable = subtotal - discount
    rate = ctx.settings.tax_rate_bps / 10000
    tax = _round_half_up(taxable - taxable / (1 + rate)) if ctx.settings.tax_inclusive else _round_half_up(taxable * rate)
    total = taxable + delivery_fee + (0 if ctx.settings.tax_inclusive else tax)
    return CartTotals(currency or ctx.settings.currency, priced, subtotal, discount, delivery_fee, tax, total, sum(x["savings"] for x in priced))


@dataclass
class PromoRule:
    code: str
    type: str
    value: int
    min_subtotal: int | None = None
    max_discount: int | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    usage_limit: int | None = None
    used_count: int = 0
    per_customer_limit: int | None = None
    customer_uses: int = 0
    customer_types: list[str] | None = None
    active: bool = True


def evaluate_promo(rule: PromoRule, subtotal: int, delivery_fee: int, customer_type: str, now: datetime) -> dict[str, Any]:
    if not rule.active:
        return {"ok": False, "reason": "inactive"}
    if rule.starts_at and rule.starts_at > now:
        return {"ok": False, "reason": "not_started"}
    if rule.ends_at and rule.ends_at < now:
        return {"ok": False, "reason": "expired"}
    if rule.min_subtotal and subtotal < rule.min_subtotal:
        return {"ok": False, "reason": "min_subtotal", "minSubtotal": rule.min_subtotal}
    if rule.usage_limit is not None and rule.used_count >= rule.usage_limit:
        return {"ok": False, "reason": "usage_limit"}
    if rule.per_customer_limit is not None and rule.customer_uses >= rule.per_customer_limit:
        return {"ok": False, "reason": "customer_limit"}
    if rule.customer_types and customer_type not in rule.customer_types:
        return {"ok": False, "reason": "customer_type"}
    if rule.type == "PERCENT":
        d = _round_half_up(subtotal * rule.value / 10000)
        if rule.max_discount is not None:
            d = min(d, rule.max_discount)
        return {"ok": True, "discount": min(d, subtotal), "freeDelivery": False}
    if rule.type == "FIXED":
        return {"ok": True, "discount": min(rule.value, subtotal), "freeDelivery": False}
    return {"ok": True, "discount": 0, "freeDelivery": delivery_fee > 0}


def margin_bps(unit_price: int, cost: int | None) -> int | None:
    if cost is None or unit_price <= 0:
        return None
    return _round_half_up((unit_price - cost) / unit_price * 10000)


def as_dict(x) -> dict:
    return asdict(x)
