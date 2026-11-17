import type { Metadata } from 'next';
import { CheckoutScreen } from '@/screens/checkout';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false, follow: false } };

export default function Page() {
  return <CheckoutScreen />;
}
