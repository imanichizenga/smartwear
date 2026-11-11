import { describe, expect, it } from 'vitest';
import { evaluatePromo, priceCart, tierTable, unitPriceFor, type PricingContext, type VariantPricing } from '../engine';

const pricing: VariantPricing = {
  retailPrice: 25000,
  compareAtPrice: 30000,
  wholesaleTiers: [{ minQty: 6, unitPrice: 21000 }, { minQty: 24, unitPrice: 18000 }],
  wholesaleMoq: 6,
  currency: 'TZS',
};
const base = { visibility: 'everyone', autoTiersForRetail: true, rounding: 'none', taxInclusive: true, taxRateBps: 1800, currency: 'TZS' } as const;
const retail: PricingContext = { customerType: 'RETAIL', wholesaleApproved: false, settings: { ...base } };
const wholesale: PricingContext = { customerType: 'WHOLESALE', wholesaleApproved: true, settings: { ...base, visibility: 'approved_only' } };

describe('unitPriceFor', () => {
  it('retail at qty 1 pays retail and sees the nudge to the next tier', () => {
    const r = unitPriceFor('v1', pricing, 1, retail);
    expect(r.unitPrice).toBe(25000);
    expect(r.basis).toBe('retail');
    expect(r.compareAtPrice).toBe(30000);
    expect(r.nextTier).toEqual({ addQty: 5, unitPrice: 21000 });
  });
  it('retail with autoTiers unlocks tier at 6', () => {
    const r = unitPriceFor('v1', pricing, 6, retail);
    expect(r.unitPrice).toBe(21000);
    expect(r.basis).toBe('tier');
    expect(r.savings).toBe(4000 * 6);
    expect(r.nextTier).toEqual({ addQty: 18, unitPrice: 18000 });
  });
  it('retail never gets tiers when visibility is approved_only', () => {
    const r = unitPriceFor('v1', pricing, 30, { ...retail, settings: { ...base, visibility: 'approved_only' } });
    expect(r.unitPrice).toBe(25000);
    expect(r.nextTier).toBeNull();
  });
  it('hidden visibility disables tiers for everyone', () => {
    const r = unitPriceFor('v1', pricing, 30, { ...wholesale, settings: { ...base, visibility: 'hidden' } });
    expect(r.unitPrice).toBe(25000);
  });
  it('wholesale approved gets tiers and MOQ flag below MOQ', () => {
    expect(unitPriceFor('v1', pricing, 2, wholesale).moqViolation).toBe(true);
    const r = unitPriceFor('v1', pricing, 24, wholesale);
    expect(r.unitPrice).toBe(18000);
    expect(r.moqViolation).toBe(false);
    expect(r.nextTier).toBeNull();
  });
  it('price list beats tiers for approved wholesale', () => {
    const r = unitPriceFor('v1', pricing, 1, { ...wholesale, priceList: [{ variantId: 'v1', unitPrice: 17000 }] });
    expect(r.unitPrice).toBe(17000);
    expect(r.basis).toBe('price_list');
  });
  it('tier never exceeds retail', () => {
    const r = unitPriceFor('v1', { ...pricing, wholesaleTiers: [{ minQty: 2, unitPrice: 99000 }] }, 5, retail);
    expect(r.unitPrice).toBe(25000);
  });
  it('applies rounding rule', () => {
    const r = unitPriceFor('v1', { ...pricing, retailPrice: 25049 }, 1, { ...retail, settings: { ...base, rounding: 'nearest_100' } });
    expect(r.unitPrice).toBe(25000);
  });
});

describe('tierTable', () => {
  it('renders ranges with the active row', () => {
    const rows = tierTable(pricing, 7);
    expect(rows.map((r) => r.label)).toEqual(['1–5', '6–23', '24+']);
    expect(rows.find((r) => r.active)?.label).toBe('6–23');
  });
  it('is empty when no cheaper tiers', () => {
    expect(tierTable({ ...pricing, wholesaleTiers: [] }, 1)).toEqual([]);
  });
});

describe('priceCart', () => {
  it('sums lines, applies promo, delivery and inclusive tax', () => {
    const t = priceCart([
      { lineId: 'a', variantId: 'v1', qty: 2, pricing },
      { lineId: 'b', variantId: 'v2', qty: 6, pricing },
    ], retail, { deliveryFee: 3000, promo: { code: 'X', discount: 5000 } });
    expect(t.subtotal).toBe(50000 + 126000);
    expect(t.discount).toBe(5000);
    expect(t.total).toBe(176000 - 5000 + 3000);
    expect(t.tax).toBe(Math.round(171000 - 171000 / 1.18));
    expect(t.savings).toBe(24000);
  });
  it('exclusive tax adds on top', () => {
    const t = priceCart([{ lineId: 'a', variantId: 'v1', qty: 1, pricing }], { ...retail, settings: { ...base, taxInclusive: false } });
    expect(t.tax).toBe(4500);
    expect(t.total).toBe(29500);
  });
});

describe('evaluatePromo', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  it('percent with cap', () => {
    const r = evaluatePromo({ code: 'TEN', type: 'PERCENT', value: 1000, maxDiscount: 2000 }, 50000, 0, retail, now);
    expect(r).toEqual({ ok: true, discount: 2000, freeDelivery: false });
  });
  it('respects min subtotal, dates and limits', () => {
    expect(evaluatePromo({ code: 'A', type: 'FIXED', value: 1000, minSubtotal: 60000 }, 50000, 0, retail, now)).toEqual({ ok: false, reason: 'min_subtotal' });
    expect(evaluatePromo({ code: 'A', type: 'FIXED', value: 1000, endsAt: '2026-01-01' }, 50000, 0, retail, now)).toEqual({ ok: false, reason: 'expired' });
    expect(evaluatePromo({ code: 'A', type: 'FIXED', value: 1000, usageLimit: 1, usedCount: 1 }, 50000, 0, retail, now)).toEqual({ ok: false, reason: 'usage_limit' });
    expect(evaluatePromo({ code: 'A', type: 'FIXED', value: 1000, customerTypes: ['WHOLESALE'] }, 50000, 0, retail, now)).toEqual({ ok: false, reason: 'customer_type' });
  });
  it('free delivery', () => {
    expect(evaluatePromo({ code: 'SHIP', type: 'FREE_DELIVERY', value: 0 }, 50000, 3000, retail, now)).toEqual({ ok: true, discount: 0, freeDelivery: true });
  });
});
