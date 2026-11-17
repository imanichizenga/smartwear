'use client';

import { forwardRef, useEffect, useId, useRef, useState, type CSSProperties, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ApiException } from '@/lib/api';
import { useReducedMotion, useT } from '@/lib/hooks';
import { flag, int, intN, list, str, type Json } from '@/lib/json';
import { formatAmount, formatMoney } from '@/lib/money';
import { usePrefs } from '@/lib/session';
import { SwButton } from './button';
import { cn } from './cn';
import { Ic, Icon } from './icons';

/* ================================================================ basics */

export type ChipTone = 'neutral' | 'ink' | 'accent' | 'blush' | 'success' | 'warning' | 'danger';
const chipTone: Record<ChipTone, [string, string]> = {
  neutral: ['color-mix(in srgb, var(--sw-ink) 6%, transparent)', 'var(--sw-muted)'],
  ink: ['var(--sw-ink)', 'var(--sw-on-ink)'],
  accent: ['var(--sw-accent-soft)', 'color-mix(in srgb, var(--sw-accent) 65%, var(--sw-ink))'],
  blush: ['var(--sw-blush)', 'var(--sw-ink)'],
  success: ['var(--sw-success-soft)', 'var(--sw-success)'],
  warning: ['var(--sw-warning-soft)', 'var(--sw-warning)'],
  danger: ['var(--sw-danger-soft)', 'var(--sw-danger)'],
};
export const toneOf = (t?: string | null): ChipTone => (t === 'ink' || t === 'accent' || t === 'blush' ? t : 'neutral');

/** Small uppercase label chip — badges ("New", "Limited") live here, never on the photo itself. */
export function SwChip({ label, tone = 'neutral', icon, className }: { label: string; tone?: ChipTone; icon?: LucideIcon; className?: string }) {
  const [bg, fg] = chipTone[tone];
  return (
    <span className={cn('t-label-s inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-xs px-2', className)} style={{ background: bg, color: fg, lineHeight: 1 }}>
      {icon && <Icon icon={icon} size={12} />}
      {label}
    </span>
  );
}

/** Toggleable filter / choice chip (filters, quiz answers, sizes in sheets). */
export function ChoiceChip({ label, selected, onPress, leading, className }: { label: string; selected: boolean; onPress: () => void; leading?: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      className={cn('press inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border px-4 py-2 transition-colors duration-150', selected ? 'border-ink bg-ink text-on-ink' : 'border-hairline bg-surface text-ink hover:border-[color-mix(in_srgb,var(--sw-ink)_35%,transparent)]', className)}
    >
      {leading}
      <span className="t-title-s whitespace-nowrap" style={{ fontWeight: 500 }}>
        {label}
      </span>
    </button>
  );
}

export function Hairline({ indent = 0, className }: { indent?: number; className?: string }) {
  return <div aria-hidden className={cn('h-px bg-hairline', className)} style={{ marginLeft: indent }} />;
}

/* ---------------------------------------------------------------- skeletons */

export function Skeleton({ w, h = 14, r = 2, aspect, dark, className, style }: { w?: number | string; h?: number | string; r?: number; aspect?: number; dark?: boolean; className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn('sw-skeleton block', className)} data-dark={dark} style={{ width: w ?? '100%', height: aspect ? undefined : h, aspectRatio: aspect ? String(aspect) : undefined, borderRadius: r, ...style }} />;
}
export const SkeletonLine = ({ w, h = 12, dark }: { w?: number | string; h?: number; dark?: boolean }) => <Skeleton w={w} h={h} r={h / 2.5} dark={dark} />;
export const SkeletonAvatar = ({ size = 40, dark }: { size?: number; dark?: boolean }) => <Skeleton w={size} h={size} r={size / 2} dark={dark} />;

export function SkeletonList({ count = 6, gap = 20, className, children }: { count?: number; gap?: number; className?: string; children: (i: number) => ReactNode }) {
  const t = useT();
  return (
    <div role="status" aria-label={t('common.loading')} className={cn('flex flex-col px-5 py-4', className)} style={{ gap }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{children(i)}</div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- states */

/** Editorial empty/error state: a hairline A-arch illustration, a serif line and one action. */
export function EmptyState({ title, body, action, icon = Ic.sparkles, className, dark }: { title: string; body?: string | null; action?: ReactNode; icon?: LucideIcon; className?: string; dark?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center px-8 py-12 text-center', className)} data-theme={dark ? 'dark' : undefined}>
      <div className="relative h-24 w-[120px]">
        <svg viewBox="0 0 120 96" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
          <path d="M21.6 96 V67.2 A38.4 67.2 0 0 1 98.4 67.2 V96" stroke="var(--sw-hairline)" strokeWidth="1" />
          <circle cx="60" cy="2" r="2.2" fill="var(--sw-accent)" />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center pt-[18px] text-ink">
          <Icon icon={icon} size={26} />
        </span>
      </div>
      <p className="t-display-s mt-6 max-w-md text-ink">{title}</p>
      {body && <p className="t-body-s mt-2 max-w-sm text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export const isOffline = (e: unknown) => e instanceof ApiException && e.isNetwork;

/** Failed load: a distinct offline view versus a server-error view, each with an inline retry. */
export function LoadError({ error, onRetry, compact = false, dark }: { error: unknown; onRetry?: () => void; compact?: boolean; dark?: boolean }) {
  const t = useT();
  const off = isOffline(error);
  const title = off ? t('state.offline.title') : t('common.error.title');
  if (compact) {
    return (
      <div className="flex items-center gap-3 px-5 py-4">
        <Icon icon={off ? Ic.wifiOff : Ic.circleAlert} size={18} className="text-muted" />
        <span className="t-body-s flex-1 text-muted">{title}</span>
        {onRetry && <SwButton label={t('common.retry')} variant="ghost" onPress={onRetry} />}
      </div>
    );
  }
  return (
    <EmptyState
      dark={dark}
      title={title}
      body={off ? t('state.offline.body') : t('common.error.body')}
      icon={off ? Ic.wifiOff : Ic.circleAlert}
      action={onRetry ? <SwButton label={t('common.retry')} icon={Ic.refreshCw} variant="secondary" onPress={onRetry} /> : undefined}
    />
  );
}

/** Serif section title + "View all" link. */
export function SectionHeader({ title, subtitle, onViewAll, viewAllHref, className }: { title: string; subtitle?: string | null; onViewAll?: () => void; viewAllHref?: string; className?: string }) {
  const t = useT();
  const va = <span className="t-label link-accent text-ink">{t('common.viewAll')}</span>;
  return (
    <div className={cn('flex items-end gap-4 px-5 pb-4 pt-10 md:px-0', className)}>
      <div className="min-w-0 flex-1">
        <h2 className="t-display-m text-ink">{title}</h2>
        {subtitle && <p className="t-body-s mt-1 text-muted">{subtitle}</p>}
      </div>
      {viewAllHref ? (
        <a href={viewAllHref} className="press py-3" onClick={(e) => { if (onViewAll && !e.metaKey && !e.ctrlKey) { e.preventDefault(); onViewAll(); } }}>
          {va}
        </a>
      ) : onViewAll ? (
        <button type="button" className="press py-3" onClick={onViewAll}>
          {va}
        </button>
      ) : null}
    </div>
  );
}

/* ================================================================ motion */

/** Editorial entrance: rises 14 px and fades in, staggered by `index` (45 ms apart, capped). Plays once. */
export function Reveal({ index = 0, offset = 14, children, className, as: As = 'div' }: { index?: number; offset?: number; children: ReactNode; className?: string; as?: 'div' | 'li' | 'section' }) {
  return (
    <As className={cn('sw-reveal', className)} style={{ ['--i' as string]: Math.max(0, Math.min(index, 8)), ['--rise' as string]: `${offset}px` }}>
      {children}
    </As>
  );
}

/** Text that rolls to its new value (prices, counts). First render is static. */
export function RollingText({ text, className, style, live }: { text: string; className?: string; style?: CSSProperties; /** time-based value: may differ between server render and hydration */ live?: boolean }) {
  const first = useRef(true);
  const prev = useRef(text);
  const changed = !first.current && prev.current !== text;
  useEffect(() => {
    first.current = false;
    prev.current = text;
  }, [text]);
  return (
    <span className={cn('inline-block overflow-hidden align-bottom', className)} style={style}>
      <span key={text} className={changed ? 'sw-roll' : undefined} suppressHydrationWarning={live}>
        {text}
      </span>
    </span>
  );
}

/** A price that counts to its new value (totals, fees, earnings) instead of snapping. */
export function CountUpMoney({ amount, currency, className, duration = 650 }: { amount: number; currency: string; className?: string; duration?: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(amount);
  const from = useRef(amount);
  useEffect(() => {
    if (reduce || from.current === amount) {
      from.current = amount;
      setShown(amount);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(Math.round(a + (amount - a) * ease(p)));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = amount;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [amount, duration, reduce]);
  return (
    <span className={cn('tabular', className)} aria-label={formatMoney(amount, currency)}>
      {formatMoney(shown, currency)}
    </span>
  );
}

/** A short physical "bump" every time `value` changes (bag badge). No motion on first render. */
export function Bump({ value, children, className }: { value: unknown; children: ReactNode; className?: string }) {
  const [n, setN] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setN((x) => x + 1);
  }, [value]);
  return (
    <span key={n} className={cn('inline-flex', n > 0 && 'sw-bump', className)}>
      {children}
    </span>
  );
}

/** Eight dots that fan out once — the wishlist "heart burst". Re-plays when `play` changes. */
export function ParticleBurst({ play }: { play: number }) {
  if (!play) return null;
  return (
    <span key={play} aria-hidden className="sw-burst pointer-events-none absolute inset-0">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} style={{ ['--a' as string]: `${(i / 8) * 360}deg` }} />
      ))}
    </span>
  );
}

/* ================================================================ commerce */

/** Filled heart in Lucide's outline geometry (one icon language). */
export function HeartIcon({ filled, size = 22, color }: { filled: boolean; size?: number; color?: string }) {
  if (!filled) return <Icon icon={Ic.heart} size={size} style={{ color }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ color: color ?? 'currentColor' }}>
      <path d="M12 20.5C11.5 20.2 3 15 3 8.8 3 6.1 5.1 4 7.6 4c1.7 0 3.3.9 4.4 2.4C13.1 4.9 14.7 4 16.4 4 18.9 4 21 6.1 21 8.8 21 15 12.5 20.2 12 20.5z" fill="currentColor" />
    </svg>
  );
}

const hex = (h?: string | null) => (h && /^#[0-9a-f]{6}$/i.test(h) ? h : null);
export const hexColor = hex;

/** Colour / shade dots under a product card. */
export function SwatchDots({ swatches, more = 0 }: { swatches: Json[]; more?: number }) {
  if (swatches.length < 2) return <span className="block h-2.5" />;
  const extra = more + (swatches.length > 5 ? swatches.length - 5 : 0);
  return (
    <span className="flex items-center">
      {swatches.slice(0, 5).map((s, i) => (
        <span key={i} className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: hex(str(s, 'hex') || str(s, 'swatchHex')) ?? 'var(--sw-hairline)', boxShadow: 'inset 0 0 0 0.5px color-mix(in srgb, var(--sw-ink) 15%, transparent)' }} />
      ))}
      {extra > 0 && <span className="t-caption text-muted" style={{ lineHeight: 1 }}>+{extra}</span>}
    </span>
  );
}

export function RatingStars({ rating, size = 14, count }: { rating: number; size?: number; count?: number }) {
  return (
    <span className="inline-flex items-center" role="img" aria-label={`${rating.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} icon={Ic.star} size={size} style={{ color: i <= Math.round(rating) ? 'var(--sw-accent)' : 'var(--sw-hairline)' }} fill={i <= Math.round(rating) ? 'currentColor' : 'none'} />
      ))}
      {count != null && <span className="t-caption ml-1.5 text-muted">({count})</span>}
    </span>
  );
}

export type PriceSize = 's' | 'm' | 'l';
/** Retail/wholesale-aware price: serif retail, compare-at struck only for real discounts, "From … in bulk". */
export function PriceTag({ price: p, range, size = 'm', showBulk = true }: { price: Json | null | undefined; range?: Json | null; size?: PriceSize; showBulk?: boolean }) {
  const t = useT();
  if (!p) return null;
  const cur = str(p, 'currency', 'TZS');
  const your = int(p, 'yourPrice', int(p, 'retail'));
  const compare = intN(p, 'compareAt');
  const wholesale = str(p, 'yourBasis') === 'wholesale' || str(p, 'yourBasis') === 'price_list';
  const min = intN(range, 'min');
  const max = intN(range, 'max');
  const varies = min != null && max != null && min !== max;
  const cls = size === 's' ? 't-price-s' : size === 'm' ? 't-price-m' : 't-price-l';
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn('flex min-w-0 items-center gap-x-2 gap-y-0.5', size === 's' ? 'flex-nowrap overflow-hidden' : 'flex-wrap')}>
        <RollingText text={varies ? `${t('common.from')} ${formatMoney(min, cur)}` : formatMoney(your, cur)} className={cn(cls, 'whitespace-nowrap text-ink')} />
        {compare != null && compare > your && <span className="t-body-s whitespace-nowrap text-muted line-through">{formatMoney(compare, cur)}</span>}
        {wholesale && <SwChip label={t('product.wholesale')} tone="accent" />}
      </span>
      {showBulk && flag(p, 'showWholesale') && intN(p, 'fromBulk') != null && !wholesale && (
        <span className="t-caption mt-0.5 text-muted">{t('product.fromBulk', { price: formatMoney(intN(p, 'fromBulk'), cur) })}</span>
      )}
    </span>
  );
}

/** Elegant tier table with the active tier highlighted and a real (server-computed) nudge. */
export function TierTable({ price, qty }: { price: Json; qty: number }) {
  const t = useT();
  const tiers = list(price, 'tiers');
  if (!tiers.length) return null;
  const cur = str(price, 'currency', 'TZS');
  const retail = int(price, 'retail');
  const first = int(tiers[0], 'minQty');
  const active = [...tiers].reverse().find((x) => qty >= int(x, 'minQty'));
  const rows: [string, number, boolean][] = [[`1–${first - 1}`, retail, !active]];
  tiers.forEach((x, i) => {
    const next = i + 1 < tiers.length ? int(tiers[i + 1], 'minQty') - 1 : null;
    rows.push([next == null ? `${int(x, 'minQty')}+` : `${int(x, 'minQty')}–${next}`, int(x, 'unitPrice'), !!active && int(active, 'minQty') === int(x, 'minQty')]);
  });
  const nextTier = tiers.find((x) => int(x, 'minQty') > qty);
  return (
    <div>
      <div className="flex overflow-hidden rounded-sm border border-hairline">
        {rows.map(([label, amount, on], i) => (
          <div key={i} className={cn('flex h-14 flex-1 flex-col items-center justify-center transition-colors duration-[240ms]', i > 0 && 'border-l border-hairline')} style={{ background: on ? 'var(--sw-accent-soft)' : 'transparent' }}>
            <span className="t-caption text-muted">{label}</span>
            <span className="t-price-s mt-0.5" style={{ fontWeight: on ? 600 : 500 }}>
              {formatAmount(amount, cur)}
            </span>
          </div>
        ))}
      </div>
      {nextTier && (
        <p className="mt-2 flex items-center gap-1.5">
          <Icon icon={Ic.sparkles} size={14} className="text-accent" />
          <RollingText className="t-caption text-ink" text={t('product.tierNudge', { count: int(nextTier, 'minQty') - qty, price: formatAmount(int(nextTier, 'unitPrice'), cur) })} />
        </p>
      )}
    </div>
  );
}

/** Size picker — 44 px pills; unavailable sizes are struck, never hidden. */
export function SizePicker({ values, selected, unavailable, onSelect }: { values: Json[]; selected?: string | null; unavailable: Set<string>; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {values.map((v) => {
        const id = str(v, 'id');
        const on = id === selected;
        const out = unavailable.has(id);
        const label = str(v, 'label', str(v, 'value'));
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            aria-label={`${label}${out ? ', sold out' : ''}`}
            onClick={() => onSelect(id)}
            className={cn('press t-title-s inline-flex min-h-11 min-w-[52px] items-center justify-center rounded-sm border px-3 transition-colors duration-150', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline bg-surface hover:border-[color-mix(in_srgb,var(--sw-ink)_40%,transparent)]', !on && (out ? 'text-subtle line-through' : 'text-ink'))}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Colour / shade swatches — 44 px targets with a ring on the selected one. */
export function SwatchPicker({ values, selected, onSelect }: { values: Json[]; selected?: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => {
        const id = str(v, 'id');
        const on = id === selected;
        return (
          <button key={id} type="button" aria-pressed={on} aria-label={str(v, 'label', str(v, 'value'))} title={str(v, 'label', str(v, 'value'))} onClick={() => onSelect(id)} className="flex size-11 items-center justify-center">
            <span className="flex size-[34px] items-center justify-center rounded-full p-[3px] transition-[border-color] duration-150" style={{ border: `1.5px solid ${on ? 'var(--sw-ink)' : 'transparent'}` }}>
              <span className="block h-full w-full rounded-full" style={{ background: hex(strOr(v)) ?? 'var(--sw-hairline)', boxShadow: 'inset 0 0 0 0.5px color-mix(in srgb, var(--sw-ink) 12%, transparent)' }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
const strOr = (v: Json) => str(v, 'swatchHex') || str(v, 'hex');

/* ================================================================ inputs */

type FieldBase = { label?: string; error?: string | null; helper?: string | null; prefix?: ReactNode; leadingIcon?: LucideIcon; trailing?: ReactNode; counter?: boolean };

/** Label → field → helper / error (8 px apart), one style everywhere. */
export const TextField = forwardRef<HTMLInputElement, FieldBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'>>(function TextField({ label, error, helper, prefix, leadingIcon, trailing, counter, className, id, maxLength, value, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const len = typeof value === 'string' ? value.length : 0;
  return (
    <div className={cn('flex flex-col', className)}>
      {label && (
        <label htmlFor={fid} className="t-title-s mb-2 text-ink">
          {label}
        </label>
      )}
      <div className={cn('flex min-h-[52px] items-center rounded-sm border bg-surface transition-[border-color,box-shadow] duration-150 focus-within:shadow-[0_0_0_0.2px_var(--sw-ink)]', error ? 'border-danger' : 'border-hairline focus-within:border-ink')}>
        {leadingIcon ? <Icon icon={leadingIcon} size={18} className="ml-4 shrink-0 text-muted" /> : prefix}
        <input
          ref={ref}
          id={fid}
          maxLength={maxLength}
          value={value}
          aria-invalid={!!error || undefined}
          aria-describedby={error || helper ? `${fid}-help` : undefined}
          className="t-body-m h-[50px] min-w-0 flex-1 bg-transparent px-4 text-ink outline-none placeholder:text-subtle"
          {...rest}
        />
        {trailing}
      </div>
      {(error || helper || (counter && maxLength)) && (
        <div className="mt-2 flex gap-3">
          <p id={`${fid}-help`} className={cn('t-caption flex-1', error ? 'text-danger' : 'text-muted')}>
            {error || helper}
          </p>
          {counter && maxLength ? <span className={cn('t-caption', len >= maxLength ? 'text-warning' : 'text-subtle')}>{`${len}/${maxLength}`}</span> : null}
        </div>
      )}
    </div>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, FieldBase & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'prefix'>>(function TextArea({ label, error, helper, counter, className, id, maxLength, value, rows = 3, prefix: _p, leadingIcon: _l, trailing: _t, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const len = typeof value === 'string' ? value.length : 0;
  return (
    <div className={cn('flex flex-col', className)}>
      {label && (
        <label htmlFor={fid} className="t-title-s mb-2 text-ink">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={fid}
        rows={rows}
        maxLength={maxLength}
        value={value}
        aria-invalid={!!error || undefined}
        className={cn('t-body-m min-h-[52px] resize-y rounded-sm border bg-surface px-4 py-3.5 text-ink outline-none transition-colors placeholder:text-subtle', error ? 'border-danger' : 'border-hairline focus:border-ink')}
        {...rest}
      />
      {(error || helper || (counter && maxLength)) && (
        <div className="mt-2 flex gap-3">
          <p className={cn('t-caption flex-1', error ? 'text-danger' : 'text-muted')}>{error || helper}</p>
          {counter && maxLength ? <span className={cn('t-caption', len >= maxLength ? 'text-warning' : 'text-subtle')}>{`${len}/${maxLength}`}</span> : null}
        </div>
      )}
    </div>
  );
});

/** Rounded search field used on Search and in the place picker. */
export const SearchBar = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { trailing?: ReactNode }>(function SearchBar({ trailing, className, ...rest }, ref) {
  return (
    <div className={cn('flex h-12 items-center rounded-full border border-hairline bg-surface pl-4 pr-1 transition-colors focus-within:border-[color-mix(in_srgb,var(--sw-ink)_45%,transparent)]', className)}>
      <Icon icon={Ic.search} size={18} className="shrink-0 text-muted" />
      <input ref={ref} type="search" enterKeyHint="search" className="t-body-m h-full min-w-0 flex-1 bg-transparent px-3 text-ink outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden" {...rest} />
      {trailing}
    </div>
  );
});

/** iOS-style switch in ink. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={(e) => { e.stopPropagation(); onChange(!checked); }} className="relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200" style={{ background: checked ? 'var(--sw-ink)' : 'var(--sw-hairline)' }}>
      <span className="absolute top-[3px] size-6 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,.25)] transition-[left] duration-200 ease-[var(--sw-ease-atelier)]" style={{ left: checked ? 23 : 3 }} />
    </button>
  );
}

/** "Label   value" option heading (product colour / size). */
export function OptionLabel({ label, value }: { label: string; value?: string | null }) {
  return (
    <p className="mb-1">
      <span className="t-label text-muted">{label}</span>
      {value && <span className="t-title-s ml-3 text-ink">{value}</span>}
    </p>
  );
}

/** Uppercase muted section label. */
export function Label({ children, className, action }: { children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div className={cn('mb-3 flex items-center', className)}>
      <p className="t-label flex-1 text-muted">{children}</p>
      {action}
    </div>
  );
}

/** Localised field helper: Swahili text when present. */
export function useLocalised() {
  const { locale } = usePrefs();
  return (o: Json | null | undefined, key: string) => (locale === 'sw' ? str(o, `${key}Sw`) || str(o, key) : str(o, key));
}
