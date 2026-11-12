import { notFound } from 'next/navigation';
import { RiderDetail } from '@/components/riders/rider-detail';
import { ApiError } from '@/lib/api-error';
import { serverApi } from '@/lib/server-api';
import { storeCurrency } from '@/lib/server-config';

export const metadata = { title: 'Rider' };

export default async function RiderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let r: Parameters<typeof RiderDetail>[0]['initial'];
  let currency: string;
  try {
    [r, currency] = await Promise.all([serverApi<Parameters<typeof RiderDetail>[0]['initial']>(`/admin/riders/${id}`), storeCurrency()]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return <RiderDetail initial={r} currency={currency} />;
}
