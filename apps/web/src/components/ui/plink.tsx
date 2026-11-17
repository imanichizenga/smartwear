'use client';

import Link from 'next/link';
import { useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ALoader } from './aloader';
import { cn } from './cn';

/**
 * The app's PressableLink for the web: a real <a href> (open in new tab, crawlable) whose tap scales gently and,
 * while `onNavigate` runs (prefetch → route), shows a frosted A loader over the card.
 */
export function PLink({
  href,
  onNavigate,
  children,
  className,
  style,
  overlay = true,
  scale = true,
  label,
  replace,
}: {
  href: string;
  onNavigate?: () => unknown;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  overlay?: boolean;
  scale?: boolean;
  label?: string;
  replace?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const t0 = Date.now();
    try {
      await onNavigate();
    } finally {
      const left = 300 - (Date.now() - t0);
      setTimeout(() => setPending(false), Math.max(0, left) + 400);
    }
  };
  return (
    <Link href={href} replace={replace} onClick={onClick} aria-label={label} aria-busy={pending || undefined} className={cn('relative block', scale && 'press', className)} style={style}>
      {children}
      {pending && overlay && (
        <span className="absolute inset-0 z-10 flex items-center justify-center">
          <ALoader size="md" backdrop />
        </span>
      )}
    </Link>
  );
}
