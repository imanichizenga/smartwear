import type { Metadata } from 'next';
import { OrdersScreen } from '@/screens/orders';

export const metadata: Metadata = { title: 'Orders', robots: { index: false } };
export default function Page() {
  return <OrdersScreen />;
}
