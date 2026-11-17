'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from '@/components/ui/overlay';
import { Ic } from '@/components/ui/icons';
import { errorMessage } from './api';
import { cartApi, prefetchProduct, toggleWishlistId, useT } from './hooks';
import { str, type Json } from './json';
import { getSession } from './session';

/** Pages that need an account. Guests are sent to Welcome with `from`, and land back here after signing in. */
const AUTH_ONLY = ['/orders', '/checkout', '/chat/', '/wishlist', '/places', '/payments', '/wholesale', '/notifications', '/support', '/privacy', '/profile/edit', '/rider'];
export const isAuthOnly = (loc: string) => AUTH_ONLY.some((p) => loc === p || loc.startsWith(p.endsWith('/') ? p : `${p}/`));

/** An action a guest started; it runs right after they sign in and come back (like the app's requireSignIn). */
export type Intent = { kind: 'wishlist'; productId: string } | { kind: 'bag'; variantId: string; qty: number } | { kind: 'notify'; collectionId: string };
const INTENT_KEY = 'sw.intent';

export function saveIntent(i: Intent, from: string) {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ ...i, from, at: Date.now() }));
  } catch {
    /* ignore */
  }
}
export function takeIntent(path: string): Intent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Intent & { from: string; at: number };
    if (Date.now() - v.at > 30 * 60_000) {
      sessionStorage.removeItem(INTENT_KEY);
      return null;
    }
    if (v.from.split('?')[0] !== path) return null;
    sessionStorage.removeItem(INTENT_KEY);
    return v;
  } catch {
    return null;
  }
}

export function useHere() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const q = sp.toString();
  return q ? `${pathname}?${q}` : pathname;
}

export function useAppNav() {
  const router = useRouter();
  const here = useHere();
  const t = useT();

  const signInHref = useCallback((from = here) => `/welcome?return=1&from=${encodeURIComponent(from)}`, [here]);

  /** Gated action: guests sign in and come back here; the action then resumes (when it has an intent). */
  const requireSignIn = useCallback(
    async (action: () => unknown, intent?: Intent) => {
      if (getSession().signedIn) return action();
      if (intent) saveIntent(intent, here);
      router.push(signInHref());
    },
    [here, router, signInHref],
  );

  const toggleWishlist = useCallback(
    (productId: string) =>
      requireSignIn(
        async () => {
          try {
            const on = await toggleWishlistId(productId);
            if (on) toast(t('wishlist.added'), { icon: Ic.heart });
          } catch (e) {
            toast(errorMessage(e, t), { error: true });
          }
        },
        { kind: 'wishlist', productId },
      ),
    [requireSignIn, t],
  );

  /** Card tap → prefetch the product (≤350 ms) → open it. */
  const openProduct = useCallback(
    async (p: Json) => {
      const slug = str(p, 'slug');
      await prefetchProduct(slug);
      router.push(`/p/${encodeURIComponent(slug)}`);
    },
    [router],
  );

  return { router, here, signInHref, requireSignIn, toggleWishlist, openProduct };
}

/** Banner / story link → destination path. */
export function linkHref(link: Json | null | undefined, title?: string): string | null {
  if (!link) return null;
  const id = str(link, 'slug') || str(link, 'id');
  const tq = title ? `?title=${encodeURIComponent(title)}` : '';
  switch (str(link, 'type')) {
    case 'collection':
      return `/collection/${encodeURIComponent(id)}${tq}`;
    case 'category':
      return `/c/${encodeURIComponent(id)}${tq}`;
    case 'product':
      return `/p/${encodeURIComponent(id)}`;
    case 'brand':
      return `/brand/${encodeURIComponent(id)}`;
    case 'look':
      return `/discover?look=${encodeURIComponent(str(link, 'id'))}`;
    default:
      return typeof link.url === 'string' ? link.url : null;
  }
}

/** Runs a saved intent after sign-in (called by the shell once the session is signed in on the origin page). */
export async function runIntent(i: Intent, t: (k: string) => string) {
  try {
    if (i.kind === 'wishlist') {
      const on = await toggleWishlistId(i.productId);
      if (on) toast(t('wishlist.added'), { icon: Ic.heart });
    } else if (i.kind === 'bag') {
      await cartApi.add(i.variantId, i.qty);
      toast(t('product.added'), { icon: Ic.shoppingBag });
    } else if (i.kind === 'notify') {
      const { api } = await import('./api');
      await api.post(`/collections/${i.collectionId}/notify`);
      toast(t('home.notifyOn'), { icon: Ic.bell });
    }
  } catch (e) {
    toast(errorMessage(e, t), { error: true });
  }
}

/** In-app history depth: >0 means "back" stays inside SmartWear (tracked by <NavTracker/>). */
let depth = 0;
export function trackNavigation(kind: 'push' | 'pop') {
  depth = kind === 'pop' ? Math.max(0, depth - 1) : depth + 1;
}

/** Back like the app's `context.canPop() ? pop() : go(fallback)`. */
export function useBack(fallback = '/') {
  const router = useRouter();
  return useCallback(() => {
    if (depth > 0) router.back();
    else router.replace(fallback);
  }, [router, fallback]);
}
