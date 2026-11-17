import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, parseResponse } from './api-error';

const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ADMIN_COOKIE = 'sw_admin';

/** Gateway / restart blips worth one more try. A 500 is retried once too: these are read-only GETs. */
const RETRY_STATUS = new Set([500, 502, 503, 504]);
const ATTEMPTS = 3;
const TIMEOUT_MS = 20_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One GET to Django with a timeout. Network failures (a pooled keep-alive socket the API already closed, a
 * gunicorn worker recycling, the API restarting) and gateway errors are retried with a short backoff, so a
 * Server Component never fails the whole page on a transient blip — that was the "fails once, works on
 * refresh" error.
 */
async function getWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
  let last: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!RETRY_STATUS.has(res.status) || attempt === ATTEMPTS - 1 || (res.status === 500 && attempt > 0)) return res;
      await res.body?.cancel().catch(() => undefined);
      last = new ApiError(res.status, { message: `Request failed (${res.status})` });
    } catch (e) {
      last = e;
      if (attempt === ATTEMPTS - 1) break;
    }
    await sleep(250 * 2 ** attempt);
  }
  if (last instanceof ApiError) throw last;
  throw new ApiError(503, { code: 'unavailable', message: 'The SmartWear API could not be reached. Please try again.' });
}

/** Server Components → Django directly, forwarding the admin session as a header (no CSRF needed server-to-server). */
export async function serverApi<T = unknown>(path: string, init: { query?: Record<string, string | undefined>; revalidate?: number } = {}): Promise<T> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) redirect('/login');
  const qs = init.query ? new URLSearchParams(Object.entries(init.query).filter(([, v]) => v) as [string, string][]).toString() : '';
  const res = await getWithRetry(`${API}/v1${path}${qs ? `?${qs}` : ''}`, { Accept: 'application/json', 'X-Admin-Session': token });
  try {
    return await parseResponse<T>(res);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(e.code === 'mfa_required' ? '/login?step=mfa' : '/login');
    throw e;
  }
}
