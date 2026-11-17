import type { Metadata } from 'next';
import { DeleteAccountScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Delete account', robots: { index: false, follow: false } };
export default function Page() {
  return <DeleteAccountScreen />;
}
