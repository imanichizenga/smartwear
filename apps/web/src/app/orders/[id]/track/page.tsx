import type { Metadata } from 'next';
import { TrackingScreen } from '@/screens/orders';

export const metadata: Metadata = { title: 'Tracking', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <TrackingScreen id={(await params).id} />;
}
