import { SupportInbox } from '@/components/sell/support';

export const metadata = { title: 'Support inbox' };

/** `?thread=<id>` opens that conversation (e.g. "Message customer" on an order). */
export default async function SupportPage({ searchParams }: { searchParams: Promise<{ thread?: string }> }) {
  const { thread } = await searchParams;
  return <SupportInbox initialThread={thread ?? null} />;
}
