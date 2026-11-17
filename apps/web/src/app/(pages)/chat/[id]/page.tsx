import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ChatScreen } from '@/screens/chat';

export const metadata: Metadata = { title: 'Chat', robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ChatScreen threadId={id} />
    </Suspense>
  );
}
