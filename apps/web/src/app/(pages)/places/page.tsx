import type { Metadata } from 'next';
import { PlacesScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Saved places', robots: { index: false, follow: false } };
export default function Page() {
  return <PlacesScreen />;
}
