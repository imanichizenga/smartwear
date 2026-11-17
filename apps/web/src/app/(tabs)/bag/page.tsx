import { Suspense } from 'react';
import type { Metadata } from 'next';
import { BagScreen } from '@/screens/bag';

export const metadata: Metadata = { title: 'Bag', robots: { index: false } };

export default function Page() {
  return (
    <Suspense>
      <BagScreen />
    </Suspense>
  );
}
