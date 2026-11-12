import { PromosWorkspace } from '@/components/marketing/promos';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Promo codes' };

export default async function PromosPage() {
  const c = await serverApi<{ pricing_wholesale?: { currency?: string } }>('/config/public');
  return <PromosWorkspace currency={c.pricing_wholesale?.currency ?? 'TZS'} />;
}
