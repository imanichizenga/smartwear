'use client';

import type { Json } from './json';
import { tokens } from './tokens';

export const APP_VERSION = '1.0.0';
const BASE = '/api/v1';

/** The API's error envelope {code, message, details}. status 0 = never reached the server. */
export class ApiException extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Json = {},
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0 && (this.code === 'offline' || this.code === 'timeout');
  }
  get field(): string | undefined {
    return typeof this.details.field === 'string' ? this.details.field : undefined;
  }
}

export type SignOutReason = 'revoked' | 'blocked';
export type RefreshResult = 'ok' | 'offline' | 'signedOut';

type Query = Record<string, string | number | boolean | null | undefined | string[]>;
interface Opts {
  query?: Query;
  body?: unknown;
  headers?: Record<string, string>;
  /** Sign-in / refresh: never send the (possibly expired) access token. */
  noAuth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFINITIVE = new Set(['refresh_invalid', 'refresh_device_mismatch', 'session_revoked']);
const PUBLIC_AUTH = new Set(['/auth/refresh', '/auth/otp/request', '/auth/otp/verify', '/auth/google']);
const TRANSIENT_STATUS = new Set([502, 503, 504]);

const hooks: {
  onSignedOut?: (r: SignOutReason) => void;
  onRefreshed?: (user: Json) => void;
  onNetwork?: (online: boolean) => void;
  locale: string;
} = { locale: 'en' };
export const apiHooks = hooks;

function qs(q?: Query) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    if (Array.isArray(v)) p.set(k, v.join(','));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function raw(method: string, path: string, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': hooks.locale, 'X-App-Version': APP_VERSION, ...o.headers };
  const device = tokens.deviceId;
  if (device) headers['X-Device-Id'] = device;
  const access = tokens.access;
  if (access && !o.noAuth && !PUBLIC_AUTH.has(path)) headers.Authorization = `Bearer ${access}`;
  let body: BodyInit | undefined;
  if (o.body instanceof FormData) body = o.body;
  else if (o.body !== undefined || (method !== 'GET' && method !== 'DELETE')) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(o.body ?? {});
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), o.timeoutMs ?? 20_000);
  const onAbort = () => ctrl.abort(o.signal?.reason);
  o.signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(`${BASE}${path}${qs(o.query)}`, { method, headers, body, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

async function parse(res: Response): Promise<{ data: unknown; err?: ApiException }> {
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 200) };
    }
  }
  if (res.ok) return { data };
  const d = (data && typeof data === 'object' ? ((data as Json).error ?? data) : {}) as Json;
  const msg = typeof d.message === 'string' && d.message ? d.message : res.status >= 500 ? 'Something went wrong' : `Request failed (${res.status})`;
  return { data, err: new ApiException(res.status, typeof d.code === 'string' ? d.code : 'error', msg, (d.details as Json) ?? {}) };
}

function networkError(e: unknown): ApiException {
  const timeout = e instanceof DOMException && (e.name === 'TimeoutError' || e.message === 'timeout');
  if (e instanceof DOMException && e.name === 'AbortError' && !timeout) return new ApiException(0, 'aborted', 'Cancelled');
  return new ApiException(0, timeout ? 'timeout' : 'offline', 'You are offline');
}

async function endSession(reason: SignOutReason) {
  if (!tokens.signedIn) return;
  tokens.clear();
  hooks.onSignedOut?.(reason);
}

/* ------------------------------------------------------------------ refresh (single-flight, across tabs) */

let inflight: Promise<RefreshResult> | null = null;

async function doRefresh(startedWith: string | null): Promise<RefreshResult> {
  const current = tokens.refresh;
  if (!current) return 'signedOut';
  // Another tab rotated while we waited for the lock: its fresh pair is already in storage.
  if (startedWith && current !== startedWith) {
    const exp = tokens.accessExpiresAt();
    if (exp && exp > Date.now() + 15_000) return 'ok';
  }
  let res: Response;
  try {
    res = await raw('POST', '/auth/refresh', { body: { refreshToken: current }, noAuth: true, timeoutMs: 15_000 });
  } catch {
    return 'offline';
  }
  const { data, err } = await parse(res);
  if (err) {
    if (err.status === 403 || (err.status === 401 && DEFINITIVE.has(err.code))) {
      await endSession(err.status === 403 ? 'blocked' : 'revoked');
      return 'signedOut';
    }
    return 'offline'; // 5xx / malformed: keep the session
  }
  const d = (data ?? {}) as Json;
  if (typeof d.accessToken !== 'string' || typeof d.refreshToken !== 'string') return 'offline';
  tokens.save(d.accessToken, d.refreshToken, typeof d.sessionId === 'string' ? d.sessionId : null);
  if (d.user && typeof d.user === 'object') {
    tokens.saveUser(d.user as Json);
    hooks.onRefreshed?.(d.user as Json);
  }
  return 'ok';
}

/** One refresh at a time in this tab, and (with Web Locks) across every SmartWear tab of this browser. */
export function refreshSession(): Promise<RefreshResult> {
  if (!tokens.refresh) return Promise.resolve('signedOut');
  if (inflight) return inflight;
  const startedWith = tokens.refresh;
  const run = async (): Promise<RefreshResult> => {
    const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (locks?.request) return (await locks.request('sw-refresh', () => doRefresh(startedWith))) as RefreshResult;
    return doRefresh(startedWith);
  };
  inflight = run().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Refresh ahead of time when the access token expires within `marginMs` (tab focus, before the socket connects). */
export async function refreshIfExpiring(marginMs = 60_000): Promise<RefreshResult> {
  if (!tokens.signedIn) return 'signedOut';
  const exp = tokens.accessExpiresAt();
  if (tokens.access && exp && exp > Date.now() + marginMs) return 'ok';
  return refreshSession();
}

/* ------------------------------------------------------------------ requests */

async function send<T>(method: string, path: string, o: Opts = {}, idempotent = false): Promise<T> {
  let retried = false;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await raw(method, path, o);
    } catch (e) {
      const err = networkError(e);
      if (err.code === 'aborted') throw err;
      hooks.onNetwork?.(false);
      if (idempotent && attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      throw err;
    }
    hooks.onNetwork?.(true);
    const { data, err } = await parse(res);
    if (!err) return data as T;
    if (err.status === 401 && !retried && tokens.refresh && !PUBLIC_AUTH.has(path)) {
      retried = true;
      const r = await refreshSession();
      if (r === 'ok') continue;
      if (r === 'offline') throw new ApiException(0, 'offline', 'You are offline');
      throw err;
    }
    if (err.status === 403 && err.code === 'account_blocked' && tokens.signedIn) await endSession('blocked');
    if (idempotent && attempt < 2 && TRANSIENT_STATUS.has(err.status)) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      continue;
    }
    throw err;
  }
}

export const api = {
  get: <T = Json>(path: string, query?: Query, o: Omit<Opts, 'query'> = {}) => send<T>('GET', path, { ...o, query }, true),
  post: <T = Json>(path: string, body?: unknown, headers?: Record<string, string>) => send<T>('POST', path, { body: body ?? {}, headers }),
  patch: <T = Json>(path: string, body?: unknown) => send<T>('PATCH', path, { body: body ?? {} }),
  put: <T = Json>(path: string, body?: unknown) => send<T>('PUT', path, { body: body ?? {} }),
  delete: <T = Json>(path: string, query?: Query) => send<T>('DELETE', path, { query }),
};

/** "You are offline" vs the server's message, for toasts. */
export function errorMessage(e: unknown, t: (k: string) => string): string {
  if (e instanceof ApiException) return e.isNetwork ? t('common.offlineAction') : e.message;
  return t('common.error.body');
}
