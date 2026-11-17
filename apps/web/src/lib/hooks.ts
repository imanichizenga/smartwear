'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { translate, type Translate, type Vars } from './i18n';
import { flag, list, obj, str, type Json } from './json';
import { queryClient, useOnline, usePrefs, useSession } from './session';

/* ------------------------------------------------------------------ strings */

export function useT(): Translate {
  const { locale } = usePrefs();
  return useCallback((k: string, v?: Vars) => translate(locale, k, v), [locale]);
}

/* ------------------------------------------------------------------ public runtime config (cached copy first) */

const CFG_KEY = 'sw.config';
function cachedConfig(): Json | undefined {
  try {
    const c = localStorage.getItem(CFG_KEY);
    return c ? (JSON.parse(c) as Json) : undefined;
  } catch {
    return undefined;
  }
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: async () => {
      const c = await api.get<Json>('/config/public');
      try {
        localStorage.setItem(CFG_KEY, JSON.stringify(c));
      } catch {
        /* ignore */
      }
      return c;
    },
    initialData: typeof window === 'undefined' ? undefined : cachedConfig,
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    retry: 3,
    retryDelay: (n) => Math.min(60_000, 5000 * 2 ** n),
  });
}
export const feature = (cfg: Json | undefined, k: string) => obj(cfg, 'features')?.[k] !== false;
export const currencyOf = (cfg: Json | undefined) => str(obj(cfg, 'localization'), 'currency', 'TZS');

/* ------------------------------------------------------------------ catalog */

/** Guests get the server-rendered Home at once (SEO + first paint); signed-in shoppers their personalised one. */
export function useHome(initial?: Json | null) {
  const { user, ready } = useSession();
  const uid = (user?.id as string | undefined) ?? null;
  return useQuery({
    queryKey: ['home', uid],
    queryFn: () => api.get<Json>('/home'),
    initialData: !uid && initial ? initial : undefined,
    initialDataUpdatedAt: Date.now(),
    enabled: ready || typeof window === 'undefined',
    placeholderData: (prev) => prev,
  });
}
export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: async () => list(await api.get<Json>('/categories'), 'items'), staleTime: 5 * 60_000 });
}
export function productQueryOptions(slug: string) {
  return { queryKey: ['product', slug], queryFn: () => api.get<Json>(`/products/${encodeURIComponent(slug)}`) };
}
export function useProduct(slug: string) {
  return useQuery(productQueryOptions(slug));
}
/** Card tap → prefetch the product (≤350 ms, the card shows the A loader) → open it. */
export async function prefetchProduct(slug: string) {
  await Promise.race([queryClient.prefetchQuery(productQueryOptions(slug)), new Promise((r) => setTimeout(r, 350))]);
}

export interface ProductQuery {
  category?: string | null;
  q?: string | null;
  sort?: string | null;
  collection?: string | null;
  brand?: string | null;
  filters?: Record<string, string[]>;
}
export function useProductList(q: ProductQuery, enabled = true, initial?: Json | null) {
  return useInfiniteQuery({
    queryKey: ['products', q],
    enabled,
    initialData: initial ? { pages: [initial], pageParams: [null] } : undefined,
    initialDataUpdatedAt: Date.now(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<Json>('/products', {
        category: q.category,
        q: q.q,
        sort: q.sort,
        collection: q.collection,
        brand: q.brand,
        cursor: pageParam,
        limit: 20,
        ...Object.fromEntries(Object.entries(q.filters ?? {}).map(([k, v]) => [k, v.join(',')])),
      }),
    getNextPageParam: (last) => (typeof last.nextCursor === 'string' ? last.nextCursor : null),
  });
}

/* ------------------------------------------------------------------ cart (server-priced) */

const EMPTY_CART: Json = { items: [], itemCount: 0 };
export function useCart() {
  const { signedIn, ready } = useSession();
  return useQuery({
    queryKey: ['cart', signedIn],
    queryFn: () => (signedIn ? api.get<Json>('/cart') : Promise.resolve(EMPTY_CART)),
    enabled: ready,
    placeholderData: (prev) => prev,
  });
}
const setCart = (c: Json) => queryClient.setQueryData(['cart', true], c);
export const cartApi = {
  async add(variantId: string, qty: number) {
    setCart(await api.post<Json>('/cart/items', { variantId, qty }));
  },
  async saveForLater(itemId: number, saved: boolean) {
    setCart(await api.patch<Json>(`/cart/items/${itemId}`, { savedForLater: saved }));
  },
  async applyPromo(code: string) {
    setCart(await api.post<Json>('/cart/promo', { code }));
  },
};
const qtySeq = new Map<number, number>();
/** Optimistic quantity; latest request per line wins; the server's re-priced cart replaces it. */
export async function setCartQty(itemId: number, qty: number) {
  const seq = (qtySeq.get(itemId) ?? 0) + 1;
  qtySeq.set(itemId, seq);
  const prev = queryClient.getQueryData<Json>(['cart', true]);
  if (prev) {
    setCart({ ...prev, items: list(prev, 'items').flatMap((i) => (i.id !== itemId ? [i] : qty > 0 ? [{ ...i, qty }] : [])) });
  }
  try {
    const next = qty <= 0 ? await api.delete<Json>(`/cart/items/${itemId}`) : await api.patch<Json>(`/cart/items/${itemId}`, { qty });
    if (qtySeq.get(itemId) === seq) setCart(next);
  } catch (e) {
    if (prev && qtySeq.get(itemId) === seq) setCart(prev);
    throw e;
  }
}

/* ------------------------------------------------------------------ wishlist (optimistic set of product ids) */

export function useWishlist() {
  const { signedIn, ready } = useSession();
  return useQuery({
    queryKey: ['wishlist', signedIn],
    enabled: ready,
    queryFn: async () => {
      if (!signedIn) return new Set<string>();
      const r = await api.get<Json>('/wishlist');
      return new Set<string>(((r.productIds as unknown[]) ?? []).map(String));
    },
  });
}
export async function toggleWishlistId(productId: string): Promise<boolean> {
  const key = ['wishlist', true];
  const cur = new Set(queryClient.getQueryData<Set<string>>(key) ?? []);
  const on = !cur.has(productId);
  const next = new Set(cur);
  if (on) next.add(productId);
  else next.delete(productId);
  queryClient.setQueryData(key, next);
  try {
    if (on) await api.post('/wishlist', { productId });
    else await api.delete('/wishlist', { productId });
    queryClient.invalidateQueries({ queryKey: ['wishlist-products'] });
  } catch (e) {
    queryClient.setQueryData(key, cur);
    throw e;
  }
  return on;
}

/* ------------------------------------------------------------------ account */

export function useAuthedQuery<T = Json>(key: unknown[], path: string, query?: Record<string, string | number | null | undefined>, opts: { refetchInterval?: number | false } = {}) {
  const { signedIn } = useSession();
  return useQuery<T>({ queryKey: ['me', ...key], enabled: signedIn, queryFn: () => api.get<T>(path, query), refetchInterval: opts.refetchInterval });
}
export const useOrders = () => useAuthedQuery<Json>(['orders'], '/me/orders');
export const useLoyalty = () => useAuthedQuery<Json>(['loyalty'], '/me/loyalty');

/* ------------------------------------------------------------------ misc UI hooks */

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Runs `fn` with a pending flag that stays on ≥300 ms and ignores calls while pending (PendingAction). */
export function usePending() {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = useCallback(async (fn: () => unknown) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const t0 = Date.now();
    try {
      await fn();
    } finally {
      const left = 300 - (Date.now() - t0);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      busy.current = false;
      setPending(false);
    }
  }, []);
  return [pending, run] as const;
}

export function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const f = () => setR(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return r;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    setM(mq.matches);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}

export { useOnline, useQueryClient, useMutation, useMemo, flag };
