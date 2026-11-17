import { Suspense } from 'react';
import type { Metadata } from 'next';
import { DiscoverScreen } from '@/screens/discover';

export const metadata: Metadata = { title: 'Discover' };

export default function Page() {
  return (
    <Suspense>
      <DiscoverScreen />
    </Suspense>
  );
}
