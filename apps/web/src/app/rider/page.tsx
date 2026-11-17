import type { Metadata } from 'next';
import { RiderHomeScreen } from '@/screens/rider';

export const metadata: Metadata = { title: 'Rider Mode', robots: { index: false, follow: false } };
export default function Page() {
  return <RiderHomeScreen />;
}
