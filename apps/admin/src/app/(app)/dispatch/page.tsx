import { ControlRoom } from '@/components/dispatch/control-room';
import type { DispatchBoard } from '@/lib/ops';
import { serverApi } from '@/lib/server-api';
import { storeCurrency } from '@/lib/server-config';

export const metadata = { title: 'Dispatch' };

export default async function DispatchPage() {
  const [board, currency] = await Promise.all([serverApi<DispatchBoard>('/admin/dispatch'), storeCurrency()]);
  return <ControlRoom initial={board} currency={currency} />;
}
