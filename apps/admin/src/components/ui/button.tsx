'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderA } from '@/components/brand/LoaderA';
import { cn } from '@/lib/cn';
import { usePendingAction } from '@/lib/use-pending';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'premium' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-on-ink hover:bg-ink/88 active:bg-ink/80',
  secondary: 'border border-ink/18 bg-surface text-ink hover:border-ink/40 hover:bg-canvas',
  ghost: 'text-ink hover:bg-ink/5 active:bg-ink/8',
  premium: 'bg-accent text-on-accent hover:bg-accent/90',
  danger: 'border border-danger/30 bg-surface text-danger hover:bg-danger-soft',
  link: 'h-auto px-0 text-ink underline-offset-4 hover:underline',
};
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-[15px]',
  icon: 'h-10 w-10',
  'icon-sm': 'h-8 w-8',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. While pending, the A loader takes its place at the same size. */
  icon?: ReactNode;
  iconRight?: ReactNode;
  pending?: boolean;
}

/** The only button in the admin. Pending swaps the icon (or the label when there is no icon) for the A loader in place. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, pending = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const iconOnly = size === 'icon' || size === 'icon-sm';
  const loaderSize = size === 'sm' || size === 'icon-sm' ? 'xs' : 'sm';
  const swapLabel = !icon && !iconOnly;
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-sm font-semibold tracking-[0.01em] transition-[background-color,border-color,color,opacity] duration-150 ease-atelier',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-busy:opacity-100 aria-busy:cursor-progress',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon || iconOnly ? (
        <span className="sw-swap" data-pending={pending}>
          <span className="sw-swap-content inline-flex [&>svg]:size-4">{icon ?? children}</span>
          <span className="sw-swap-loader inline-flex">{pending && <LoaderA size={loaderSize} />}</span>
        </span>
      ) : null}
      {!iconOnly &&
        (swapLabel ? (
          <span className="sw-swap" data-pending={pending}>
            <span className="sw-swap-content">{children}</span>
            <span className="sw-swap-loader inline-flex">{pending && <LoaderA size={loaderSize} />}</span>
          </span>
        ) : (
          children
        ))}
      {iconRight && <span className="inline-flex [&>svg]:size-4">{iconRight}</span>}
    </button>
  );
});

export interface ActionButtonProps extends Omit<ButtonProps, 'onClick' | 'pending'> {
  onAction: () => Promise<unknown>;
}

/** Async button: shows the A loader while `onAction` runs (≥300ms) and blocks double taps. */
export function ActionButton({ onAction, ...props }: ActionButtonProps) {
  const [run, pending] = usePendingAction(onAction);
  return <Button {...props} pending={pending} onClick={() => void run()} />;
}
