import { ReturnsWorkspace } from '@/components/sell/returns';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Returns' };

export default async function ReturnsPage() {
  const c = await serverApi<{ pricing_wholesale?: { currency?: string } }>('/config/public');
  return <ReturnsWorkspace currency={c.pricing_wholesale?.currency ?? 'TZS'} />;
}
