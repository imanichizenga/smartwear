import type { Metadata } from 'next';
import { WholesaleScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Wholesale', robots: { index: false, follow: false } };
export default function Page() {
  return <WholesaleScreen />;
}
