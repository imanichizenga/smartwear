import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PhoneScreen } from '@/screens/auth';

export const metadata: Metadata = { title: 'Sign in' };

export default function Page() {
  return (
    <Suspense>
      <PhoneScreen />
    </Suspense>
  );
}
