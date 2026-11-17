'use client';

import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { AppBar } from '../shell/app-shell';
import { cn } from '../ui/cn';
import { Ic, Icon } from '../ui/icons';
import { Hairline, LoadError, SkeletonLine, Skeleton } from '../ui/kit';
import { SwImage } from '../ui/sw-image';
import { useBack } from '@/lib/nav';
import { obj, str, type Json } from '@/lib/json';

/** Shared chrome for every Profile sub-page: back button + serif title, optional actions and a bottom bar. */
export function SubPage({ title, children, actions, bottom, back = '/profile', narrow = true }: { title: string; children: ReactNode; actions?: ReactNode; bottom?: ReactNode; back?: string; narrow?: boolean }) {
  const onBack = useBack(back);
  return (
    <main className={cn('min-h-dvh', bottom ? 'pb-[calc(96px+env(safe-area-inset-bottom))]' : 'pb-16')}>
      <div className={narrow ? 'sw-narrow' : 'sw-container'}>
        <AppBar title={title} titleClass="t-display-s md:t-display-l" onBack={onBack} actions={actions} />
        <div className="px-5 pt-2 md:px-0 md:pt-6">{children}</div>
      </div>
      {bottom && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-canvas px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 md:static md:border-0 md:bg-transparent md:px-0 md:pt-0">
          <div className="sw-narrow md:pt-6">{bottom}</div>
        </div>
      )}
    </main>
  );
}

/** Query → layout-faithful skeleton / offline-or-server error with retry / empty state / content. */
export function AsyncBody<T>({ q, skeleton, empty, isEmpty, children }: { q: UseQueryResult<T>; skeleton: ReactNode; empty?: ReactNode; isEmpty?: (d: T) => boolean; children: (d: T) => ReactNode }) {
  if (q.isPending) return <>{skeleton}</>;
  if (q.isError && q.data === undefined)
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  const d = q.data as T;
  if (empty && isEmpty?.(d)) return <div className="flex min-h-[55vh] items-center justify-center">{empty}</div>;
  return <>{children(d)}</>;
}

/** A hairline-bordered card group of rows (same look as the Profile list). */
export function RowGroup({ children, className }: { children: ReactNode; className?: string }) {
  const kids = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <div className={cn('overflow-hidden rounded-md border border-hairline bg-surface', className)}>
      {kids.map((c, i) => (
        <div key={i}>
          {i > 0 && <Hairline indent={56} />}
          {c}
        </div>
      ))}
    </div>
  );
}

/** The one row style used on Profile and every sub-page: icon, label (+ subtitle), trailing, chevron. */
export function ProfileRow({ icon, label, subtitle, onPress, href, trailing, chevron = true, danger = false }: { icon: LucideIcon; label: string; subtitle?: string | null; onPress?: () => unknown; href?: string; trailing?: ReactNode; chevron?: boolean; danger?: boolean }) {
  const inner = (
    <span className="flex min-h-14 items-center gap-4 px-4 py-3">
      <Icon icon={icon} size={20} className={danger ? 'text-danger' : 'text-ink'} />
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className={cn('t-body-m', danger ? 'text-danger' : 'text-ink')}>{label}</span>
        {subtitle && <span className="t-caption line-clamp-2 text-muted">{subtitle}</span>}
      </span>
      {trailing}
      {chevron && (onPress || href) && <Icon icon={Ic.chevronRight} size={18} className="ml-1 text-subtle" />}
    </span>
  );
  const cls = 'block w-full transition-colors hover:bg-[color-mix(in_srgb,var(--sw-ink)_3%,transparent)] active:bg-[color-mix(in_srgb,var(--sw-ink)_5%,transparent)]';
  if (href)
    return (
      <a href={href} className={cls} onClick={(e) => { if (onPress && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void onPress(); } }}>
        {inner}
      </a>
    );
  if (onPress)
    return (
      <button type="button" onClick={() => void onPress()} className={cls}>
        {inner}
      </button>
    );
  return <div>{inner}</div>;
}

export function RowGroupSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-md border border-hairline bg-surface', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          {i > 0 && <Hairline indent={56} />}
          <div className="flex h-16 items-center gap-4 px-4">
            <Skeleton w={20} h={20} r={6} />
            <div className="flex flex-1 flex-col gap-2">
              <SkeletonLine w={140} h={12} />
              <SkeletonLine w={90} h={10} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export const initialsOf = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.map((p) => p[0]!).slice(0, 2).join('').toUpperCase() : 'SW';
};

/** Avatar photo, or initials on ink. */
export function Avatar({ user, size = 96, border = 4, overlay }: { user: Json | null | undefined; size?: number; border?: number; overlay?: ReactNode }) {
  const name = str(user, 'displayName') || str(user, 'name');
  return (
    <span className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink" style={{ width: size, height: size, boxShadow: border ? `0 0 0 ${border}px var(--sw-canvas)` : undefined }}>
      {obj(user, 'avatar') ? (
        <SwImage media={obj(user, 'avatar')} aspect={null} rounded="rounded-full" sizes={`${size * 2}px`} />
      ) : (
        <span className="text-on-ink" style={{ fontFamily: 'var(--sw-font-display)', fontSize: size * 0.32 }}>
          {initialsOf(name)}
        </span>
      )}
      {overlay}
    </span>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="t-label mb-3 text-muted">{children}</p>;
}
