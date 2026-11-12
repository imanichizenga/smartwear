import { CustomersWorkspace } from '@/components/customers/customers';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Customers' };

export default async function CustomersPage() {
  const c = await serverApi<{ pricing_wholesale?: { currency?: string } }>('/config/public');
  return <CustomersWorkspace currency={c.pricing_wholesale?.currency ?? 'TZS'} />;
}
