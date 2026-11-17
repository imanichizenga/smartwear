import type { Metadata } from 'next';
import { PrivacyScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Privacy', robots: { index: false, follow: false } };
export default function Page() {
  return <PrivacyScreen />;
}
