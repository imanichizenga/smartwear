import type { Metadata } from 'next';
import { SupportScreen } from '@/screens/chat';

export const metadata: Metadata = { title: 'Help & support', robots: { index: false } };
export default function Page() {
  return <SupportScreen />;
}
