import type { Metadata } from 'next';
import { PaymentsScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Payments', robots: { index: false, follow: false } };
export default function Page() {
  return <PaymentsScreen />;
}
