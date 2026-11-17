import { Suspense } from 'react';
import type { Metadata } from 'next';
import { QuizScreen } from '@/screens/auth';

export const metadata: Metadata = { title: 'Make it yours' };

export default function Page() {
  return (
    <Suspense>
      <QuizScreen />
    </Suspense>
  );
}
