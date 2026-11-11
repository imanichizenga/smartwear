'use client';

import { ApiError, parseResponse } from './api-error';

export { ApiError };

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Browser → /api/v1/* (rewritten by Next to Django). The admin cookie is httpOnly + SameSite=Lax;
 * the custom X-Requested-With header is the API's CSRF check for cookie-authenticated writes.
 */
export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = opts.body !== undefined ? 'POST' : 'GET', body, query, headers, signal } = opts;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const res = await fetch(`/api/v1${path}${buildQuery(query)}`, {
    method,
    credentials: 'same-origin',
    signal,
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'SmartWearAdmin',
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
  if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/admin/auth/')) {
    // Hard navigation on purpose: the session is gone, so drop all client state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }
  return parseResponse<T>(res);
}
