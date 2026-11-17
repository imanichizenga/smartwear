import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProfileScreen } from '@/screens/profile';

export const metadata: Metadata = { title: 'Profile', robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <ProfileScreen />
    </Suspense>
  );
}
