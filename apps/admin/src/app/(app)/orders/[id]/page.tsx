import { notFound } from 'next/navigation';
import { OrderDetail } from '@/components/orders/order-detail';
import { ApiError } from '@/lib/api-error';
import type { OrderDetail as Order } from '@/lib/ops';
import { serverApi } from '@/lib/server-api';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: `Order ${(await params).id.slice(0, 8)}` };
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: Order;
  try {
    data = await serverApi<Order>(`/admin/orders/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  return <OrderDetail initial={data} />;
}
