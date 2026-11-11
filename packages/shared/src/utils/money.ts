import { z } from 'zod';

/** Money is stored as integer minor units + ISO-4217 currency code. */
export const MoneySchema = z.object({ amount: z.number().int(), currency: z.string().length(3) });
export type Money = z.infer<typeof MoneySchema>;

/** Minor-unit exponent per currency (TZS has none in practice). */
const EXPONENTS: Record<string, number> = { TZS: 0, KES: 0, UGX: 0, RWF: 0, JPY: 0, USD: 2, EUR: 2, GBP: 2, ZAR: 2 };
export const currencyExponent = (currency: string) => EXPONENTS[currency.toUpperCase()] ?? 2;

export function money(amount: number, currency: string): Money {
  return { amount: Math.round(amount), currency: currency.toUpperCase() };
}
export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}
export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}
export function mulMoney(a: Money, factor: number): Money {
  return { amount: Math.round(a.amount * factor), currency: a.currency };
}
export function assertSameCurrency(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch ${a.currency} vs ${b.currency}`);
}

export type RoundingRule = 'none' | 'nearest_10' | 'nearest_50' | 'nearest_100' | 'nearest_500' | 'nearest_1000' | 'up_100' | 'down_100';

export function applyRounding(amount: number, rule: RoundingRule): number {
  switch (rule) {
    case 'none': return Math.round(amount);
    case 'nearest_10': return Math.round(amount / 10) * 10;
    case 'nearest_50': return Math.round(amount / 50) * 50;
    case 'nearest_100': return Math.round(amount / 100) * 100;
    case 'nearest_500': return Math.round(amount / 500) * 500;
    case 'nearest_1000': return Math.round(amount / 1000) * 1000;
    case 'up_100': return Math.ceil(amount / 100) * 100;
    case 'down_100': return Math.floor(amount / 100) * 100;
  }
}

export interface FormatMoneyOptions {
  locale?: string;
  /** 'symbol' → "TSh 25,000"; 'code' → "TZS 25,000"; 'none' → "25,000" */
  display?: 'symbol' | 'code' | 'none';
  compact?: boolean;
}

/** Correct formatting (no decimals for TZS) using Intl, with a deterministic fallback. */
export function formatMoney(m: Money, opts: FormatMoneyOptions = {}): string {
  const { locale = 'en-TZ', display = 'code', compact = false } = opts;
  const exp = currencyExponent(m.currency);
  const value = m.amount / 10 ** exp;
  try {
    const nf = new Intl.NumberFormat(locale, {
      style: display === 'none' ? 'decimal' : 'currency',
      currency: m.currency,
      currencyDisplay: display === 'symbol' ? 'narrowSymbol' : 'code',
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
      notation: compact ? 'compact' : 'standard',
    });
    let s = nf.format(value);
    // Intl prints "TZS 25,000" with a non-breaking space; normalise for layout consistency
    s = s.replace(/ /g, ' ');
    if (display === 'code') s = s.replace(/^([A-Z]{3})(\d)/, '$1 $2');
    return s;
  } catch {
    const grouped = Math.abs(value).toFixed(exp).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const sign = value < 0 ? '-' : '';
    return display === 'none' ? `${sign}${grouped}` : `${sign}${m.currency} ${grouped}`;
  }
}
