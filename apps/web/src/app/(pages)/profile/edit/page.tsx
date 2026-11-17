import type { Metadata } from 'next';
import { EditProfileScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Edit profile', robots: { index: false, follow: false } };
export default function Page() {
  return <EditProfileScreen />;
}
