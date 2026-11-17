import type { Metadata } from 'next';
import { PaymentWaitScreen } from '@/screens/orders';

export const metadata: Metadata = { title: 'Approve payment', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <PaymentWaitScreen id={(await params).id} />;
}
