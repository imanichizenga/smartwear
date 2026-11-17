import type { Metadata } from 'next';
import { NotificationsScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false, follow: false } };
export default function Page() {
  return <NotificationsScreen />;
}
