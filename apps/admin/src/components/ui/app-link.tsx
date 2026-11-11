'use client';

import Link, { useLinkStatus, type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { LoaderA } from '@/components/brand/LoaderA';
import type { LoaderSize } from '@smartwear/brand';
import { cn } from '@/lib/cn';
import { useMinimumPending } from '@/lib/use-pending';
import { useReportPending } from '@/lib/nav-progress';

type AnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps | 'children'>;

export interface AppLinkProps extends LinkProps, AnchorProps {
  /** Icon shown before the label; replaced in place by the A loader while the route loads. */
  icon?: ReactNode;
  /** When there is no icon, the loader appears after the label instead (never shifting layout). */
  loaderSize?: LoaderSize;
  children?: ReactNode;
  className?: string;
}

/** Swaps the icon for the A loader while this link's navigation is pending (Next.js useLinkStatus). */
function PendingIcon({ icon, size }: { icon?: ReactNode; size: LoaderSize }) {
  const { pending } = useLinkStatus();
  const shown = useMinimumPending(pending);
  useReportPending(pending);
  if (!icon) {
    // Label-only links: the loader floats just after the text so it takes no space when idle.
    return shown ? (
      <span className="pointer-events-none absolute left-full top-1/2 ml-1.5 -translate-y-1/2" aria-hidden>
        <LoaderA size={size} />
      </span>
    ) : null;
  }
  return (
    <span className="sw-swap" data-pending={shown} aria-hidden>
      <span className="sw-swap-content inline-flex [&>svg]:size-[18px]">{icon}</span>
      <span className="sw-swap-loader inline-flex">{shown && <LoaderA size={size} />}</span>
    </span>
  );
}

/** Every navigation link in the admin goes through AppLink (enforced by eslint `no-restricted-imports`). */
export function AppLink({ icon, loaderSize = 'xs', children, className, ...props }: AppLinkProps) {
  return (
    <Link {...props} className={cn('relative inline-flex items-center gap-2', className)}>
      {icon && <PendingIcon icon={icon} size={loaderSize} />}
      {children}
      {!icon && <PendingIcon size={loaderSize} />}
    </Link>
  );
}
