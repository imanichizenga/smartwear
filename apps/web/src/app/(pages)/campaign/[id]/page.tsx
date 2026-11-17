import type { Metadata } from 'next';
import { CampaignScreen } from '@/screens/campaign';

export const metadata: Metadata = { title: 'New for you', robots: { index: false, follow: true } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <CampaignScreen id={(await params).id} />;
}
