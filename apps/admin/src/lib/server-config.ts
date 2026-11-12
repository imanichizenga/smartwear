import 'server-only';
import { serverApi } from './server-api';

/** Store currency from the public runtime config (readable by every admin role, unlike Settings). */
export async function storeCurrency(): Promise<string> {
  const c = await serverApi<{ pricing_wholesale?: { currency?: string } }>('/config/public');
  return c.pricing_wholesale?.currency ?? 'TZS';
}
