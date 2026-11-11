import { z } from 'zod';
import { applyRounding, type Money, type RoundingRule } from '../utils/money';
import type { CustomerType } from '../enums';

/**
 * Pricing engine — pure, deterministic, fully unit-tested.
 * All prices are integer minor units in one currency. The server is the only place this runs
 * for anything that is charged; clients only display what the server returns.
 */

export const PriceTierSchema = z.object({
  minQty: z.number().int().min(1),
  unitPrice: z.number().int().min(0),
});
export type PriceTier = z.infer<typeof PriceTierSchema>;

export const VariantPricingSchema = z.object({
  retailPrice: z.number().int().min(0),
  compareAtPrice: z.number().int().min(0).nullable().optional(),
  wholesaleTiers: z.array(PriceTierSchema).default([]),
  wholesaleMoq: z.number().int().min(1).nullable().optional(),
  costPrice: z.number().int().min(0).nullable().optional(),
  currency: z.string().length(3),
});
export type VariantPricing = z.infer<typeof VariantPricingSchema>;

export const WholesaleSettingsSchema = z.object({
  visibility: z.enum(['everyone', 'approved_only', 'hidden']).default('approved_only'),
  /** When true, retail customers automatically get tier prices by quantity. */
  autoTiersForRetail: z.boolean().default(true),
  rounding: z.custom<RoundingRule>((v) => typeof v === 'string').default('none'),
  taxInclusive: z.boolean().default(true),
  taxRateBps: z.number().int().min(0).max(10000).default(0),
  currency: z.string().length(3).default('TZS'),
});
export type WholesaleSettings = z.infer<typeof WholesaleSettingsSchema>;

export interface PriceListEntry { variantId: string; unitPrice: number; minQty?: number }

export interface PricingContext {
  customerType: CustomerType;
  wholesaleApproved: boolean;
  settings: WholesaleSettings;
  /** Per-customer or per-group price list overrides (already resolved for this customer). */
  priceList?: PriceListEntry[];
}

export interface TierRow { label: string; minQty: number; maxQty: number | null; unitPrice: number; active: boolean }

export interface UnitPriceResult {
  unitPrice: number;
  basis: 'retail' | 'tier' | 'price_list';
  tier: PriceTier | null;
  compareAtPrice: number | null;
  /** Savings vs retail × qty, in minor units (0 when none). */
  savings: number;
  /** Next tier nudge: how many more units unlock a cheaper price. */
  nextTier: { addQty: number; unitPrice: number } | null;
  moqViolation: boolean;
}

export const sortTiers = (tiers: PriceTier[]) => [...tiers].sort((a, b) => a.minQty - b.minQty);

/** Whether wholesale prices should be visible to this customer at all. */
export function canSeeWholesale(ctx: Pick<PricingContext, 'customerType' | 'wholesaleApproved' | 'settings'>): boolean {
  switch (ctx.settings.visibility) {
    case 'hidden': return false;
    case 'everyone': return true;
    case 'approved_only': return ctx.customerType === 'WHOLESALE' && ctx.wholesaleApproved;
  }
}

/** Whether tier pricing is *applied* (not just visible) for this customer. */
export function tiersApply(ctx: Pick<PricingContext, 'customerType' | 'wholesaleApproved' | 'settings'>): boolean {
  if (ctx.settings.visibility === 'hidden') return false;
  if (ctx.customerType === 'WHOLESALE' && ctx.wholesaleApproved) return true;
  return ctx.settings.autoTiersForRetail && ctx.settings.visibility === 'everyone';
}

export function activeTier(tiers: PriceTier[], qty: number): PriceTier | null {
  let best: PriceTier | null = null;
  for (const t of sortTiers(tiers)) if (qty >= t.minQty) best = t;
  return best;
}

export function nextTier(tiers: PriceTier[], qty: number): PriceTier | null {
  for (const t of sortTiers(tiers)) if (qty < t.minQty) return t;
  return null;
}

export function unitPriceFor(variantId: string, pricing: VariantPricing, qty: number, ctx: PricingContext): UnitPriceResult {
  const rounding = ctx.settings.rounding;
  const retail = applyRounding(pricing.retailPrice, rounding);
  const compareAt = pricing.compareAtPrice && pricing.compareAtPrice > pricing.retailPrice ? applyRounding(pricing.compareAtPrice, rounding) : null;

  // 1) Explicit price list wins (wholesale approved accounts only)
  if (ctx.customerType === 'WHOLESALE' && ctx.wholesaleApproved && ctx.priceList?.length) {
    const entries = ctx.priceList.filter((e) => e.variantId === variantId && qty >= (e.minQty ?? 1)).sort((a, b) => (b.minQty ?? 1) - (a.minQty ?? 1));
    const e = entries[0];
    if (e) {
      const unit = applyRounding(e.unitPrice, rounding);
      return { unitPrice: unit, basis: 'price_list', tier: null, compareAtPrice: compareAt, savings: Math.max(0, (retail - unit) * qty), nextTier: null, moqViolation: false };
    }
  }

  // 2) Wholesale tiers
  const applies = tiersApply(ctx) && pricing.wholesaleTiers.length > 0;
  const tier = applies ? activeTier(pricing.wholesaleTiers, qty) : null;
  const nt = applies ? nextTier(pricing.wholesaleTiers, qty) : null;
  const moqViolation = ctx.customerType === 'WHOLESALE' && ctx.wholesaleApproved && !!pricing.wholesaleMoq && qty < pricing.wholesaleMoq;

  if (tier) {
    const unit = applyRounding(Math.min(tier.unitPrice, retail), rounding);
    return {
      unitPrice: unit,
      basis: 'tier',
      tier,
      compareAtPrice: compareAt,
      savings: Math.max(0, (retail - unit) * qty),
      nextTier: nt && nt.unitPrice < unit ? { addQty: nt.minQty - qty, unitPrice: applyRounding(nt.unitPrice, rounding) } : null,
      moqViolation,
    };
  }
  return {
    unitPrice: retail,
    basis: 'retail',
    tier: null,
    compareAtPrice: compareAt,
    savings: 0,
    nextTier: nt && nt.unitPrice < retail ? { addQty: nt.minQty - qty, unitPrice: applyRounding(nt.unitPrice, rounding) } : null,
    moqViolation,
  };
}

/** Rows for the elegant tier table ("1–5: 25,000 · 6–23: 21,000 · 24+: 18,000"). */
export function tierTable(pricing: VariantPricing, qty: number, rounding: RoundingRule = 'none'): TierRow[] {
  const tiers = sortTiers(pricing.wholesaleTiers).filter((t) => t.unitPrice < pricing.retailPrice);
  if (tiers.length === 0) return [];
  const rows: TierRow[] = [];
  const firstMin = tiers[0]!.minQty;
  if (firstMin > 1) rows.push({ label: firstMin - 1 === 1 ? '1' : `1–${firstMin - 1}`, minQty: 1, maxQty: firstMin - 1, unitPrice: applyRounding(pricing.retailPrice, rounding), active: false });
  tiers.forEach((t, i) => {
    const next = tiers[i + 1];
    const max = next ? next.minQty - 1 : null;
    rows.push({ label: max === null ? `${t.minQty}+` : max === t.minQty ? `${t.minQty}` : `${t.minQty}–${max}`, minQty: t.minQty, maxQty: max, unitPrice: applyRounding(t.unitPrice, rounding), active: false });
  });
  for (const r of rows) r.active = qty >= r.minQty && (r.maxQty === null || qty <= r.maxQty);
  return rows;
}

export interface CartLineInput { lineId: string; variantId: string; qty: number; pricing: VariantPricing }
export interface CartLinePriced extends UnitPriceResult { lineId: string; variantId: string; qty: number; lineTotal: number }

export interface CartTotals {
  currency: string;
  lines: CartLinePriced[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
  savings: number;
}

export interface PromoResult { discount: number; code: string | null }

export function priceCart(lines: CartLineInput[], ctx: PricingContext, opts: { deliveryFee?: number; promo?: PromoResult; currency?: string } = {}): CartTotals {
  const currency = opts.currency ?? ctx.settings.currency;
  const priced: CartLinePriced[] = lines.map((l) => {
    const u = unitPriceFor(l.variantId, l.pricing, l.qty, ctx);
    return { ...u, lineId: l.lineId, variantId: l.variantId, qty: l.qty, lineTotal: u.unitPrice * l.qty };
  });
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const discount = Math.min(subtotal, Math.max(0, opts.promo?.discount ?? 0));
  const deliveryFee = Math.max(0, opts.deliveryFee ?? 0);
  const taxable = subtotal - discount;
  const rate = ctx.settings.taxRateBps / 10000;
  // Tax-inclusive: tax is embedded in prices (informational). Exclusive: added on top.
  const tax = ctx.settings.taxInclusive ? Math.round(taxable - taxable / (1 + rate)) : Math.round(taxable * rate);
  const total = taxable + deliveryFee + (ctx.settings.taxInclusive ? 0 : tax);
  return { currency, lines: priced, subtotal, discount, deliveryFee, tax, total, savings: priced.reduce((s, l) => s + l.savings, 0) };
}

export const PROMO_TYPES = ['PERCENT', 'FIXED', 'FREE_DELIVERY'] as const;
export interface PromoRule {
  code: string;
  type: (typeof PROMO_TYPES)[number];
  value: number; // percent in bps for PERCENT, minor units for FIXED
  minSubtotal?: number | null;
  maxDiscount?: number | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  usageLimit?: number | null;
  usedCount?: number;
  perCustomerLimit?: number | null;
  customerUses?: number;
  customerTypes?: CustomerType[] | null;
  active?: boolean;
}

export type PromoEvaluation = { ok: true; discount: number; freeDelivery: boolean } | { ok: false; reason: 'inactive' | 'expired' | 'not_started' | 'min_subtotal' | 'usage_limit' | 'customer_limit' | 'customer_type' };

export function evaluatePromo(rule: PromoRule, subtotal: number, deliveryFee: number, ctx: Pick<PricingContext, 'customerType'>, now = new Date()): PromoEvaluation {
  if (rule.active === false) return { ok: false, reason: 'inactive' };
  if (rule.startsAt && new Date(rule.startsAt) > now) return { ok: false, reason: 'not_started' };
  if (rule.endsAt && new Date(rule.endsAt) < now) return { ok: false, reason: 'expired' };
  if (rule.minSubtotal && subtotal < rule.minSubtotal) return { ok: false, reason: 'min_subtotal' };
  if (rule.usageLimit != null && (rule.usedCount ?? 0) >= rule.usageLimit) return { ok: false, reason: 'usage_limit' };
  if (rule.perCustomerLimit != null && (rule.customerUses ?? 0) >= rule.perCustomerLimit) return { ok: false, reason: 'customer_limit' };
  if (rule.customerTypes?.length && !rule.customerTypes.includes(ctx.customerType)) return { ok: false, reason: 'customer_type' };
  switch (rule.type) {
    case 'PERCENT': {
      let d = Math.round((subtotal * rule.value) / 10000);
      if (rule.maxDiscount != null) d = Math.min(d, rule.maxDiscount);
      return { ok: true, discount: Math.min(d, subtotal), freeDelivery: false };
    }
    case 'FIXED': return { ok: true, discount: Math.min(rule.value, subtotal), freeDelivery: false };
    case 'FREE_DELIVERY': return { ok: true, discount: 0, freeDelivery: deliveryFee > 0 };
  }
}

export function marginBps(unitPrice: number, costPrice: number | null | undefined): number | null {
  if (costPrice == null || unitPrice <= 0) return null;
  return Math.round(((unitPrice - costPrice) / unitPrice) * 10000);
}

export const asMoney = (amount: number, currency: string): Money => ({ amount, currency });
