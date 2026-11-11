import { formatMoney } from '@smartwear/shared';

export const fmtMoney = (amount: number | null | undefined, currency = 'TZS') => (amount == null ? '—' : formatMoney({ amount, currency }));
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : new Intl.NumberFormat('en-GB').format(n));
export const fmtPct = (n: number | null | undefined, digits = 1) => (n == null ? '—' : `${n.toFixed(digits)}%`);

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function fmtAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return 'just now';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day');
  return fmtDate(iso);
}
export const fmtDate = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '—');
export const fmtDateTime = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';
export const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
