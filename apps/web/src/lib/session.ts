'use client';

import { useSyncExternalStore } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { api, APP_VERSION, apiHooks, ApiException, type SignOutReason } from './api';
import type { Json } from './json';
import { realtime } from './realtime';
import { tokens } from './tokens';

/* ------------------------------------------------------------------ query client (one per tab) */

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
      // The API client already retries network blips / gateway errors for GETs; only retry 5xx once more here.
      retry: (n, e) => (e instanceof ApiException ? e.status >= 500 && n < 1 : n < 1),
    },
    mutations: { retry: false },
  },
});

/* ------------------------------------------------------------------ tiny external store */

function store<T>(initial: T) {
  let state = initial;
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: T) {
      if (Object.is(next, state)) return;
      state = next;
      subs.forEach((f) => f());
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}

/* ------------------------------------------------------------------ session */

export interface SessionState {
  ready: boolean;
  signedIn: boolean;
  user: Json | null;
  /** Set when the server ended the session (admin block / revoke), so the UI can say why. */
  endedBy: SignOutReason | null;
}
const SERVER_SESSION: SessionState = { ready: false, signedIn: false, user: null, endedBy: null };
const session = store<SessionState>(SERVER_SESSION);

export const isRider = (u: Json | null | undefined) => u?.isRider === true || (!!u?.rider && typeof u.rider === 'object');

function invalidateAccount() {
  queryClient.removeQueries({ queryKey: ['cart'] });
  queryClient.removeQueries({ queryKey: ['wishlist'] });
  queryClient.removeQueries({ queryKey: ['me'] });
  queryClient.invalidateQueries({ queryKey: ['home'] });
}

let restored = false;
/** Restore never waits for the network: a stored refresh token means "signed in" at once (cached user). */
export function restoreSession() {
  if (restored || typeof window === 'undefined') return;
  restored = true;
  const signedIn = tokens.signedIn;
  session.set({ ready: true, signedIn, user: signedIn ? tokens.cachedUser : null, endedBy: null });
  apiHooks.onSignedOut = (reason) => {
    const was = session.get().signedIn;
    session.set({ ready: true, signedIn: false, user: null, endedBy: expecting ? null : reason });
    expecting = false;
    realtime.reset();
    if (was) invalidateAccount();
  };
  apiHooks.onRefreshed = (user) => {
    if (session.get().signedIn) session.set({ ...session.get(), user });
  };
  // Another tab signed in or out: follow it.
  window.addEventListener('storage', (e) => {
    if (e.key !== tokens.keys.refresh && e.key !== tokens.keys.user && e.key !== null) return;
    const now = tokens.signedIn;
    const cur = session.get();
    if (now !== cur.signedIn) {
      session.set({ ready: true, signedIn: now, user: now ? tokens.cachedUser : null, endedBy: null });
      if (!now) realtime.reset();
      invalidateAccount();
    } else if (now && e.key === tokens.keys.user) {
      session.set({ ...cur, user: tokens.cachedUser });
    }
  });
  if (signedIn) void revalidate();
}

let expecting = false;
/** Set just before deleting the account so the resulting revocation signs out quietly. */
export const expectSignOut = (v = true) => {
  expecting = v;
};

export async function revalidate() {
  if (!tokens.signedIn) return;
  try {
    const me = await api.get<Json>('/me');
    const user = (me.user && typeof me.user === 'object' ? me.user : me) as Json;
    if (tokens.signedIn) setUser(user);
  } catch {
    /* offline / server trouble: stay signed in with what we have */
  }
}

export function setUser(user: Json) {
  tokens.saveUser(user);
  session.set({ ready: true, signedIn: true, user, endedBy: null });
  if (typeof user.locale === 'string' && (user.locale === 'en' || user.locale === 'sw') && !localeChosenLocally()) setLocale(user.locale, false);
}

/** Returns the API's `isNewUser` so the caller can offer the (skippable) style quiz. */
export function completeLogin(payload: Json): boolean {
  tokens.save(String(payload.accessToken), String(payload.refreshToken), typeof payload.sessionId === 'string' ? payload.sessionId : null);
  const user = (payload.user as Json) ?? null;
  if (user) tokens.saveUser(user);
  session.set({ ready: true, signedIn: true, user, endedBy: null });
  invalidateAccount();
  realtime.ensure();
  try {
    localStorage.setItem('sw.welcomed', '1');
  } catch {
    /* ignore */
  }
  void revalidate();
  return payload.isNewUser === true;
}

export const requestOtp = (phone: string) => api.post('/auth/otp/request', { phone });

export async function verifyOtp(phone: string, code: string) {
  const deviceId = tokens.ensureDeviceId();
  const r = await api.post<Json>('/auth/otp/verify', { phone, code, deviceId, platform: 'web', appVersion: APP_VERSION });
  return completeLogin(r);
}

export async function googleSignIn(idToken: string) {
  const deviceId = tokens.ensureDeviceId();
  const r = await api.post<Json>('/auth/google', { idToken, deviceId, platform: 'web', appVersion: APP_VERSION });
  return completeLogin(r);
}

export async function signOut() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* signing out locally must always work, even offline */
  }
  forgetLocally();
}

export function forgetLocally() {
  expecting = false;
  tokens.clear();
  realtime.reset();
  session.set({ ready: true, signedIn: false, user: null, endedBy: null });
  invalidateAccount();
}

export const clearEndedBy = () => session.set({ ...session.get(), endedBy: null });

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.get, () => SERVER_SESSION);
}
export const getSession = session.get;

/* ------------------------------------------------------------------ preferences: theme + language */

export type ThemeMode = 'system' | 'light' | 'dark';
export type Locale = 'en' | 'sw';
interface Prefs {
  theme: ThemeMode;
  locale: Locale;
  ready: boolean;
}
const SERVER_PREFS: Prefs = { theme: 'system', locale: 'en', ready: false };
const prefs = store<Prefs>(SERVER_PREFS);

function readLS(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLS(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
const localeChosenLocally = () => readLS('sw.localeChosen') === '1';

function applyTheme(t: ThemeMode) {
  const el = document.documentElement;
  if (t === 'system') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', dark ? '#0E0E10' : '#FAF8F4');
  document.cookie = `sw_theme=${t}; path=/; max-age=31536000; samesite=lax`;
}

export function restorePrefs() {
  if (prefs.get().ready || typeof window === 'undefined') return;
  const t = readLS('sw.theme');
  const l = readLS('sw.locale');
  const theme: ThemeMode = t === 'light' || t === 'dark' ? t : 'system';
  const nav = (navigator.language || 'en').toLowerCase().startsWith('sw') ? 'sw' : 'en';
  const locale: Locale = l === 'sw' || l === 'en' ? l : nav;
  prefs.set({ theme, locale, ready: true });
  apiHooks.locale = locale;
  document.documentElement.lang = locale;
}

export function setTheme(theme: ThemeMode) {
  writeLS('sw.theme', theme);
  prefs.set({ ...prefs.get(), theme });
  applyTheme(theme);
}

export function setLocale(locale: Locale, chosen = true) {
  writeLS('sw.locale', locale);
  if (chosen) writeLS('sw.localeChosen', '1');
  prefs.set({ ...prefs.get(), locale });
  apiHooks.locale = locale;
  document.documentElement.lang = locale;
  queryClient.invalidateQueries();
}

export const getPrefs = () => prefs.get();
export function usePrefs(): Prefs {
  return useSyncExternalStore(prefs.subscribe, prefs.get, () => SERVER_PREFS);
}

/* ------------------------------------------------------------------ online */

const online = store(true);
let probe: ReturnType<typeof setInterval> | null = null;
export function setOnline(v: boolean) {
  online.set(v);
  if (v) {
    if (probe) clearInterval(probe);
    probe = null;
  } else if (!probe) {
    // Offline: probe a cheap public GET every 10 s until the API answers again.
    probe = setInterval(() => void api.get('/config/public').catch(() => undefined), 10_000);
  }
}
export function useOnline() {
  return useSyncExternalStore(online.subscribe, online.get, () => true);
}
