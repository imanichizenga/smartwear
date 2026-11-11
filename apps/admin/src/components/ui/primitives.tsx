'use client';

import type { HTMLAttributes, ReactNode } from 'react';
import { Checkbox as RCheckbox, Switch as RSwitch, Tooltip as RTooltip } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-md border border-hairline bg-surface', className)} {...p} />;
}

export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="font-sans text-[15px] font-semibold tracking-normal">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = 'neutral' | 'ink' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'blush';
const tones: Record<Tone, string> = {
  neutral: 'bg-ink/5 text-muted',
  ink: 'bg-ink text-on-ink',
  accent: 'bg-accent-soft text-[color-mix(in_srgb,var(--sw-accent)_70%,var(--sw-ink))]',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-ink/5 text-info',
  blush: 'bg-blush text-ink',
};

export function Chip({ tone = 'neutral', dot, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-[11px] font-semibold uppercase tracking-[0.06em]', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('sw-skeleton h-4', className)} aria-hidden />;
}

export function Switch({ checked, onCheckedChange, disabled, id, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string; label?: string }) {
  return (
    <RSwitch.Root
      id={id}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className="relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full bg-ink/15 transition-colors duration-150 data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-atelier data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, label, id }: { checked: boolean | 'indeterminate'; onCheckedChange: (v: boolean) => void; label?: string; id?: string }) {
  return (
    <RCheckbox.Root
      id={id}
      aria-label={label}
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-xs border border-ink/30 bg-surface transition-colors data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink"
    >
      <RCheckbox.Indicator className="text-on-ink">
        {checked === 'indeterminate' ? <span className="block h-0.5 w-2 bg-current" /> : <Check className="size-3.5" strokeWidth={2.5} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RTooltip.Root delayDuration={250}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} sideOffset={6} className="z-50 max-w-64 rounded-sm bg-ink px-2.5 py-1.5 text-xs font-medium text-on-ink shadow-floating">
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      {icon && <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-accent-soft text-ink [&>svg]:size-6 [&>svg]:stroke-[1.5]">{icon}</div>}
      <p className="font-display text-2xl leading-8">{title}</p>
      {body && <p className="mt-2 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="label-caps mb-2 text-muted">{eyebrow}</div>}
        <h1 className="text-[32px] leading-10 md:text-4xl md:leading-[44px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <div className="label-caps text-muted">{label}</div>
      <div className="mt-3 whitespace-nowrap font-display text-[22px] leading-7 tabular sm:text-[28px] sm:leading-9 xl:text-[32px]">{value}</div>
      {hint && <div className={cn('mt-2 text-xs', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-muted')}>{hint}</div>}
    </Card>
  );
}
