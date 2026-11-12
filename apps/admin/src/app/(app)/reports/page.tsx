import { ReportsWorkspace } from '@/components/reports/reports';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Reports' };

export default async function ReportsPage() {
  const c = await serverApi<{ pricing_wholesale?: { currency?: string } }>('/config/public');
  return <ReportsWorkspace currency={c.pricing_wholesale?.currency ?? 'TZS'} />;
}
