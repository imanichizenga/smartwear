import { Suspense } from 'react';
import type { Metadata } from 'next';
import { WelcomeScreen } from '@/screens/auth';

export const metadata: Metadata = { title: 'Welcome' };

export default function Page() {
  return (
    <Suspense>
      <WelcomeScreen />
    </Suspense>
  );
}
