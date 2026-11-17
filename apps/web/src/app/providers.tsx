'use client';

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StoriesHost } from '@/components/home/stories';
import { Ic, Icon } from '@/components/ui/icons';
import { SheetHost, toast, ToastHost } from '@/components/ui/overlay';
import { apiHooks, refreshIfExpiring, refreshSession } from '@/lib/api';
import { useT } from '@/lib/hooks';
import { isAuthOnly, runIntent, takeIntent, trackNavigation } from '@/lib/nav';
import { realtime } from '@/lib/realtime';
import { clearEndedBy, queryClient, restorePrefs, restoreSession, revalidate, setOnline, useOnline, useSession } from '@/lib/session';
import { tokens } from '@/lib/tokens';

// Restore before the first client render: tokens and prefs live in localStorage, no network needed.
if (typeof window !== 'undefined') {
  restorePrefs();
  restoreSession();
  apiHooks.onNetwork = setOnline;
}

/**
 * Keeps a signed-in session healthy for the tab's lifetime (core/session_keeper.dart):
 *  * refreshes the access token ~60 s before it expires, and when the tab becomes visible again;
 *  * revalidates `/me` on focus (offline is fine — nothing is cleared);
 *  * on the server's `session.revoked` event, asks the server (a refresh) — a stale event changes nothing;
 *  * keeps the realtime socket connected while signed in.
 */
function SessionKeeper() {
  const { signedIn } = useSession();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!signedIn) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      const exp = tokens.accessExpiresAt();
      if (!exp) return;
      const wait = Math.max(0, exp - Date.now() - 60_000);
      timer.current = setTimeout(async () => {
        const r = await refreshSession();
        if (r === 'ok') schedule();
        else if (r === 'offline') timer.current = setTimeout(schedule, 30_000);
      }, Math.min(wait, 2 ** 31 - 1));
    };
    schedule();
    realtime.ensure();
    const onVisible = async () => {
      if (document.visibilityState !== 'visible' || !tokens.signedIn) return;
      const r = await refreshIfExpiring();
      if (r === 'signedOut') return;
      schedule();
      realtime.ensure();
      void revalidate();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    const offEvent = realtime.onEvent((e) => {
      if (e.type !== 'session.revoked' || !tokens.signedIn) return;
      const ids = ((e.sessionIds as unknown[]) ?? []).map(String);
      const mine = tokens.sessionId;
      if (mine && !ids.includes(mine)) return;
      void refreshSession();
    });
    const offConn = realtime.onConnected((up) => up && setOnline(true));
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      offEvent();
      offConn();
    };
  }, [signedIn]);
  return null;
}

/** Router guards (router.dart): account-only pages → Welcome with `from`; signed-in shoppers never see Welcome. */
function Guards() {
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useT();

  useEffect(() => {
    if (!s.ready) return;
    const here = sp.toString() ? `${pathname}?${sp.toString()}` : pathname;
    if (!s.signedIn && isAuthOnly(pathname)) {
      router.replace(`/welcome?from=${encodeURIComponent(here)}`);
      return;
    }
    if (s.signedIn && !completing() && (pathname === '/welcome' || (pathname.startsWith('/auth/') && pathname !== '/auth/quiz'))) {
      const from = sp.get('from');
      router.replace(from && from.startsWith('/') && !from.startsWith('//') ? from : '/');
      return;
    }
    // The app opens on Welcome for first launches; the website must not: the homepage is the shop (and what search
    // engines index). Sign-in lives on /welcome and is offered from every gated action instead.
  }, [s.ready, s.signedIn, pathname, sp, router]);

  // The server ended the session (block / revoke / account deleted): go to Welcome and say why.
  useEffect(() => {
    if (!s.endedBy) return;
    toast(t(s.endedBy === 'blocked' ? 'auth.signedOut.blocked' : 'auth.signedOut.revoked'), { error: true });
    clearEndedBy();
    router.replace('/welcome');
  }, [s.endedBy, router, t]);

  // A gated action started as a guest resumes here after signing in.
  useEffect(() => {
    if (!s.signedIn) return;
    const i = takeIntent(pathname);
    if (i) void runIntent(i, t);
  }, [s.signedIn, pathname, t]);
  return null;
}

/** Counts in-app navigations so Back can tell "pop" from "leave the site". */
function NavTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  const popped = useRef(false);
  useEffect(() => {
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    trackNavigation(popped.current ? 'pop' : 'push');
    popped.current = false;
  }, [pathname]);
  return null;
}

let completingUntil = 0;
/** True briefly after a successful sign-in so the guard doesn't race the auth screen's own navigation. */
export const markCompleting = () => {
  completingUntil = Date.now() + 2500;
};
const completing = () => Date.now() < completingUntil;

/** "You are offline. Showing saved content." — slides in while the API can't be reached. */
function OfflineBanner() {
  const online = useOnline();
  const t = useT();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-5 top-[calc(env(safe-area-inset-top)+8px)] z-[95] flex justify-center">
      <div className="sw-offline flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-on-ink" style={{ transform: online ? 'translateY(-200%)' : 'none', opacity: online ? 0 : 1 }}>
        <Icon icon={Ic.wifiOff} size={14} />
        <span className="t-caption text-center">{t('common.offline')}</span>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Server: a fresh cache per request (server-rendered public data must never leak between visitors).
  const [client] = useState(() => (typeof window === 'undefined' ? new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } }) : queryClient));
  return (
    <QueryClientProvider client={client}>
      {children}
      <SessionKeeper />
      <Suspense fallback={null}>
        <Guards />
      </Suspense>
      <NavTracker />
      <OfflineBanner />
      <StoriesHost />
      <SheetHost />
      <ToastHost />
    </QueryClientProvider>
  );
}
