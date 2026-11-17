'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useCart, useT, useWishlist } from '@/lib/hooks';
import { int } from '@/lib/json';
import { useSession } from '@/lib/session';
import { cn } from '../ui/cn';
import { Ic, Icon, type IconType } from '../ui/icons';
import { Bump } from '../ui/kit';

const TABS: { href: string; icon: IconType; key: string }[] = [
  { href: '/', icon: Ic.house, key: 'tab.home' },
  { href: '/discover', icon: Ic.compass, key: 'tab.discover' },
  { href: '/search', icon: Ic.search, key: 'tab.search' },
  { href: '/bag', icon: Ic.shoppingBag, key: 'tab.bag' },
  { href: '/profile', icon: Ic.user, key: 'tab.profile' },
];
const tabIndex = (p: string) => (p === '/' ? 0 : TABS.findIndex((t, i) => i > 0 && (p === t.href || p.startsWith(`${t.href}/`))));

function Badge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn('pointer-events-none absolute transition-transform duration-[240ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]', className)} style={{ transform: n > 0 ? 'scale(1)' : 'scale(0)' }}>
      <Bump value={n}>
        <span className="flex h-4 min-w-4 items-center justify-center rounded-lg bg-accent px-1 text-[10px] font-bold leading-none text-on-accent">{n > 99 ? '99+' : n > 0 ? n : ''}</span>
      </Bump>
    </span>
  );
}

/** Five tabs in a floating, frosted bar with thin icons (phones). On Discover it turns smoky over the photography. */
export function TabBar() {
  const t = useT();
  const pathname = usePathname();
  const i = tabIndex(pathname);
  const bag = int(useCart().data, 'itemCount');
  if (i < 0 || (TABS[i]!.href !== pathname && i !== 0)) return null;
  const onDark = false; // the bar follows the theme on every tab, Discover included
  return (
    <nav aria-label="Main" className="fixed inset-x-5 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 md:hidden">
      <div
        className="relative mx-auto flex h-16 max-w-[520px] overflow-hidden rounded-full border backdrop-blur-xl"
        style={{
          background: onDark ? 'rgba(0,0,0,.35)' : 'color-mix(in srgb, var(--sw-surface) 82%, transparent)',
          borderColor: onDark ? 'rgba(255,255,255,.12)' : 'var(--sw-hairline)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {/* The pill glides to the selected tab. */}
        <span
          aria-hidden
          className="absolute top-2 h-12 w-[52px] rounded-full transition-[left] duration-[420ms] ease-[var(--sw-ease-atelier)]"
          style={{ left: `calc(${(i * 100) / TABS.length}% + (${100 / TABS.length}% - 52px) / 2)`, background: onDark ? 'rgba(255,255,255,.14)' : 'color-mix(in srgb, var(--sw-ink) 6%, transparent)' }}
        />
        {TABS.map((tab, k) => {
          const sel = k === i;
          const fg = onDark ? (sel ? '#fff' : 'rgba(255,255,255,.6)') : sel ? 'var(--sw-ink)' : 'var(--sw-muted)';
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={sel ? 'page' : undefined}
              aria-label={k === 3 && bag > 0 ? `${t(tab.key)}, ${bag} items` : t(tab.key)}
              onClick={() => sel && window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="relative z-10 flex flex-1 flex-col items-center justify-center"
            >
              <span className="relative transition-transform duration-[240ms] ease-[var(--sw-ease-atelier)]" style={{ transform: sel ? 'scale(1.08)' : 'none', color: fg }}>
                <Icon icon={tab.icon} size={22} />
                {k === 3 && <Badge n={bag} className="-right-2 -top-1" />}
              </span>
              <span className="mt-[5px] h-1 rounded-full bg-accent transition-[width] duration-[240ms]" style={{ width: sel ? 4 : 0 }} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Tablet / desktop: the same five destinations in a frosted top bar, plus wishlist and notifications. */
export function TopBar() {
  const t = useT();
  const pathname = usePathname();
  // Every page — Discover included — follows the shopper's theme.
  const dark = false;
  const i = tabIndex(pathname);
  const bag = int(useCart().data, 'itemCount');
  const wish = useWishlist().data?.size ?? 0;
  const { signedIn } = useSession();
  const fg = dark ? '#F5F2EC' : 'var(--sw-ink)';
  return (
    <header
      data-theme={dark ? 'dark' : undefined}
      className="sticky top-0 z-40 hidden border-b backdrop-blur-xl md:block"
      style={{ background: dark ? 'rgba(14,14,16,.72)' : 'color-mix(in srgb, var(--sw-canvas) 88%, transparent)', borderColor: dark ? 'rgba(255,255,255,.08)' : 'var(--sw-hairline)', WebkitBackdropFilter: 'blur(20px)' }}
    >
      <div className="sw-container flex h-16 items-center gap-6">
        <Link href="/" className="t-wordmark shrink-0" style={{ color: fg }} aria-label="SmartWear home">
          SmartWear
        </Link>
        <nav aria-label="Main" className="relative mx-auto flex items-center rounded-full p-1" style={{ background: dark ? 'rgba(255,255,255,.06)' : 'color-mix(in srgb, var(--sw-ink) 4%, transparent)' }}>
          {TABS.map((tab, k) => {
            const sel = k === i;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={sel ? 'page' : undefined}
                className={cn('t-title-s relative flex h-10 items-center gap-2 rounded-full px-4 transition-colors duration-[240ms] lg:px-5', sel ? 'shadow-[0_1px_2px_rgba(0,0,0,.06)]' : 'hover:opacity-100')}
                style={{ background: sel ? (dark ? 'rgba(255,255,255,.14)' : 'var(--sw-surface)') : 'transparent', color: sel ? fg : dark ? 'rgba(245,242,236,.65)' : 'var(--sw-muted)' }}
              >
                <span className="relative">
                  <Icon icon={tab.icon} size={18} />
                  {k === 3 && <Badge n={bag} className="-right-2.5 -top-1.5" />}
                </span>
                <span className="hidden lg:inline">{t(tab.key)}</span>
              </Link>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-1" style={{ color: fg }}>
          <Link href={signedIn ? '/wishlist' : `/welcome?return=1&from=${encodeURIComponent('/wishlist')}`} aria-label={t('profile.wishlist')} className="relative flex size-10 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]">
            <Icon icon={Ic.heart} size={20} />
            <Badge n={wish} className="right-0.5 top-0.5" />
          </Link>
          <Link href="/notifications" aria-label={t('notifications.title')} className="flex size-10 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,currentColor_8%,transparent)]">
            <Icon icon={Ic.bell} size={20} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Mobile app bar for pushed pages: back button + serif title (+ actions). Hidden chrome on desktop is the TopBar. */
export function AppBar({ title, onBack, actions, className, titleClass = 't-display-s', sticky = true }: { title?: ReactNode; onBack?: () => void; actions?: ReactNode; className?: string; titleClass?: string; sticky?: boolean }) {
  const t = useT();
  return (
    <div className={cn('z-30 flex h-14 items-center gap-1 bg-[color-mix(in_srgb,var(--sw-canvas)_94%,transparent)] px-1 backdrop-blur-md md:h-auto md:bg-transparent md:px-0 md:pt-8 md:backdrop-blur-none', sticky && 'sticky top-0 md:static', className)}>
      {onBack && (
        <button type="button" onClick={onBack} aria-label={t('common.back')} className="flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--sw-ink)_6%,transparent)] md:-ml-3">
          <Icon icon={Ic.arrowLeft} size={22} />
        </button>
      )}
      <div className={cn('min-w-0 flex-1 truncate', titleClass, !onBack && 'pl-4 md:pl-0')}>{title}</div>
      {actions && <div className="flex shrink-0 items-center gap-1 pr-1 md:pr-0">{actions}</div>}
    </div>
  );
}
