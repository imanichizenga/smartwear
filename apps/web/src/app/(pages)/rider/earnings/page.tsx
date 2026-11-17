import type { Metadata } from 'next';
import { RiderEarningsScreen } from '@/screens/rider';

export const metadata: Metadata = { title: 'Earnings', robots: { index: false, follow: false } };
export default function Page() {
  return <RiderEarningsScreen />;
}
