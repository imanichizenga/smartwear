'use client';

import type { ReactNode } from 'react';
import { motion } from 'motion/react';
import { AppLink, type AppLinkProps } from '@/components/ui/app-link';
import { ActionButton } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

/** Underlined tab row with a sliding ink indicator — shared by every list page. */
export function Tabs<K extends string>({ id, tabs, value, onChange, counts, className }: {
  id: string;
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  counts?: Partial<Record<K, number>>;
  className?: string;
}) {
  return (
    <div className={cn('scrollbar-none flex flex-1 gap-1 overflow-x-auto', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key || 'all'}
          role="tab"
          aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={cn('relative flex h-12 shrink-0 items-center gap-2 px-3 text-[13px] font-semibold transition-colors', value === t.key ? 'text-ink' : 'text-muted hover:text-ink')}
        >
          {t.label}
          {counts && counts[t.key] != null && <span className="rounded-full bg-ink/5 px-1.5 text-[11px] tabular">{counts[t.key]}</span>}
          {value === t.key && <motion.span layoutId={`${id}-tab`} className="absolute inset-x-2 bottom-0 h-0.5 bg-ink" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}

const linkVariants = {
  primary: 'bg-ink text-on-ink hover:bg-ink/88',
  secondary: 'border border-ink/18 bg-surface hover:border-ink/40',
  ghost: 'text-muted hover:bg-ink/5 hover:text-ink',
};

/** AppLink dressed as a button (navigation keeps the in-place A loader). */
export function LinkButton({ variant = 'secondary', size = 'md', className, ...p }: AppLinkProps & { variant?: keyof typeof linkVariants; size?: 'sm' | 'md' }) {
  return <AppLink {...p} className={cn('justify-center rounded-sm font-semibold transition-colors', size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm', linkVariants[variant], className)} />;
}

/** Staggered fade-up for list rows (capped so long lists don't wait). */
export function Rise({ i = 0, children, className, as = 'div' }: { i?: number; children: ReactNode; className?: string; as?: 'div' | 'li' | 'tr' }) {
  const C = as === 'li' ? motion.li : as === 'tr' ? motion.tr : motion.div;
  return (
    <C className={className} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 14) * 0.022, duration: 0.28, ease: [0.22, 0.61, 0.36, 1] }}>
      {children}
    </C>
  );
}

export function RowsSkeleton({ rows = 6, avatar }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="divide-y divide-hairline">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          {avatar && <Skeleton className="h-12 w-10 rounded-xs" />}
          <Skeleton className="w-48" />
          <Skeleton className="hidden w-32 sm:block" />
          <Skeleton className="ml-auto w-20" />
        </div>
      ))}
    </div>
  );
}

export function LoadMore({ hasMore, onMore }: { hasMore: boolean | undefined; onMore: () => Promise<unknown> }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center border-t border-hairline p-3">
      <ActionButton variant="ghost" onAction={onMore}>Load more</ActionButton>
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center gap-2 border-b border-hairline p-3', className)}>{children}</div>;
}

/** Thin labelled meter (tier progress, stock vs threshold, campaign reach). */
export function Meter({ value, max, tone = 'ink', label }: { value: number; max: number; tone?: 'ink' | 'accent' | 'warning' | 'danger' | 'success'; label?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bg = { ink: 'bg-ink', accent: 'bg-accent', warning: 'bg-warning', danger: 'bg-danger', success: 'bg-success' }[tone];
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-ink/8" role="meter" aria-valuenow={value} aria-valuemax={max} aria-label={label}>
      <motion.div className={cn('h-full rounded-full', bg)} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: [0.22, 0.61, 0.36, 1] }} />
    </div>
  );
}

/** Section block inside an editor card. */
export function Section({ title, description, actions, children, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-b border-hairline px-5 py-5 last:border-0', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-sans text-[15px] font-semibold tracking-normal">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
