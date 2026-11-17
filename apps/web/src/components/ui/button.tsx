'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { usePending } from '@/lib/hooks';
import { ALoader } from './aloader';
import { cn } from './cn';
import { Icon } from './icons';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'premium' | 'danger';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-on-ink border-transparent hover:opacity-90',
  secondary: 'bg-surface text-ink border-[color-mix(in_srgb,var(--sw-ink)_18%,transparent)] hover:border-[color-mix(in_srgb,var(--sw-ink)_40%,transparent)]',
  ghost: 'bg-transparent text-ink border-transparent hover:bg-[color-mix(in_srgb,var(--sw-ink)_5%,transparent)]',
  premium: 'bg-accent text-on-accent border-transparent hover:opacity-90',
  danger: 'bg-surface text-danger border-[color-mix(in_srgb,var(--sw-danger)_30%,transparent)] hover:bg-danger-soft',
};
const fg: Record<ButtonVariant, string> = {
  primary: 'var(--sw-on-ink)', secondary: 'var(--sw-ink)', ghost: 'var(--sw-ink)', premium: 'var(--sw-on-accent)', danger: 'var(--sw-danger)',
};

/** Swaps its child for the A loader in place (same box, no layout shift), cross-fading 150 ms. */
export function PendingSwap({ pending, children, color, size = 'sm' }: { pending: boolean; children: ReactNode; color?: string; size?: 'xs' | 'sm' | 'md' }) {
  return (
    <span className="relative inline-grid place-items-center">
      <span className="col-start-1 row-start-1 inline-flex items-center transition-opacity duration-150" style={{ opacity: pending ? 0 : 1 }}>
        {children}
      </span>
      {pending && (
        <span className="absolute inset-0 flex items-center justify-center">
          <ALoader size={size} color={color} />
        </span>
      )}
    </span>
  );
}

export interface SwButtonProps {
  label: string;
  onPress?: (() => unknown) | null;
  icon?: LucideIcon;
  variant?: ButtonVariant;
  expand?: boolean;
  large?: boolean;
  /** External pending flag (combined with the internal one while onPress runs). */
  pending?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  style?: CSSProperties;
}

/** Button with built-in pending state: the icon (or the label) becomes the A loader while onPress runs. 44/52 px. */
export function SwButton({ label, onPress, icon, variant = 'primary', expand = false, large = false, pending, type = 'button', className, style }: SwButtonProps) {
  const [own, run] = usePending();
  const busy = own || !!pending;
  const disabled = !onPress && type !== 'submit';
  const color = fg[variant];
  const text = <span className="truncate">{label}</span>;
  return (
    <button
      type={type}
      aria-busy={busy || undefined}
      aria-label={busy ? `${label}, loading` : undefined}
      disabled={disabled || busy}
      onClick={onPress ? () => void run(onPress) : undefined}
      className={cn(
        'press inline-flex select-none items-center justify-center gap-2 rounded-sm border font-semibold transition-[opacity,background-color,border-color] duration-150',
        large ? 'h-[52px] px-6 text-[15px]' : 'h-11 px-5 text-[14px]',
        expand ? 'w-full' : 'max-w-full',
        variants[variant],
        disabled && 'opacity-45',
        className,
      )}
      style={{ letterSpacing: '0.2px', ...style }}
    >
      {icon ? (
        <>
          <PendingSwap pending={busy} color={color}>
            <Icon icon={icon} size={18} />
          </PendingSwap>
          {text}
        </>
      ) : (
        <PendingSwap pending={busy} color={color}>
          {text}
        </PendingSwap>
      )}
    </button>
  );
}

/** 44 px round icon button (wishlist, close, share…) with the same pending swap. `filled` puts it on a scrim. */
export function SwIconButton({
  icon,
  activeIcon,
  active = false,
  onPress,
  label,
  color,
  filled = false,
  size = 44,
  iconSize = 22,
  className,
  children,
}: {
  icon: LucideIcon;
  activeIcon?: LucideIcon;
  active?: boolean;
  onPress?: (() => unknown) | null;
  label: string;
  color?: string;
  filled?: boolean;
  size?: number;
  iconSize?: number;
  className?: string;
  children?: ReactNode;
}) {
  const [pending, run] = usePending();
  const I = active && activeIcon ? activeIcon : icon;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={activeIcon ? active : undefined}
      disabled={!onPress || pending}
      onClick={onPress ? () => void run(onPress) : undefined}
      className={cn('relative inline-flex shrink-0 items-center justify-center rounded-full disabled:opacity-100', !onPress && 'opacity-45', className)}
      style={{ width: size, height: size, color: color ?? 'var(--sw-ink)' }}
    >
      <span className={cn('flex items-center justify-center rounded-full transition-colors', filled && 'bg-scrim backdrop-blur-md', !filled && onPress && 'hover:bg-[color-mix(in_srgb,currentColor_7%,transparent)]')} style={{ width: filled ? 36 : size - 4, height: filled ? 36 : size - 4 }}>
        <PendingSwap pending={pending} color={color ?? 'var(--sw-ink)'}>
          <span key={String(active)} className={activeIcon ? 'sw-pop' : undefined}>
            <Icon icon={I} size={iconSize} fill={active && activeIcon ? 'currentColor' : 'none'} />
          </span>
        </PendingSwap>
      </span>
      {children}
    </button>
  );
}
