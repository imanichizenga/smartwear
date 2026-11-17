const EXP: Record<string, number> = { TZS: 0, KES: 2, UGX: 0, RWF: 0, USD: 2, EUR: 2, GBP: 2 };
const fmts = new Map<number, Intl.NumberFormat>();
function nf(d: number) {
  let f = fmts.get(d);
  if (!f) fmts.set(d, (f = new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })));
  return f;
}

/** Integer minor units + ISO code → "TZS 85,000" (TZS has no minor unit). */
export function formatMoney(amount: number | null | undefined, currency = 'TZS'): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const e = EXP[currency.toUpperCase()] ?? 2;
  return `${currency} ${nf(e).format(amount / 10 ** e)}`;
}

/** "21,000" — tier tables where the currency is stated once. */
export function formatAmount(amount: number, currency = 'TZS'): string {
  const e = EXP[currency.toUpperCase()] ?? 2;
  return nf(e).format(amount / 10 ** e);
}
