import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ApiError, parseResponse } from './api-error';

const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const ADMIN_COOKIE = 'sw_admin';

/** Server Components → Django directly, forwarding the admin session as a header (no CSRF needed server-to-server). */
export async function serverApi<T = unknown>(path: string, init: { query?: Record<string, string | undefined>; revalidate?: number } = {}): Promise<T> {
  const jar = await cookies();
  const token = jar.get(ADMIN_COOKIE)?.value;
  if (!token) redirect('/login');
  const qs = init.query ? new URLSearchParams(Object.entries(init.query).filter(([, v]) => v) as [string, string][]).toString() : '';
  const res = await fetch(`${API}/v1${path}${qs ? `?${qs}` : ''}`, {
    headers: { Accept: 'application/json', 'X-Admin-Session': token },
    cache: 'no-store',
  });
  try {
    return await parseResponse<T>(res);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect(e.code === 'mfa_required' ? '/login?step=mfa' : '/login');
    throw e;
  }
}
