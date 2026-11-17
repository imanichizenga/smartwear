import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SearchScreen } from '@/screens/search';

export const metadata: Metadata = { title: 'Search' };

export default function Page() {
  return (
    <Suspense>
      <SearchScreen />
    </Suspense>
  );
}
