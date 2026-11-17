import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Not found', robots: { index: false } };

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
      <p className="t-wordmark text-muted">SmartWear</p>
      <h1 className="t-display-l mt-6">This page has moved on</h1>
      <p className="t-body-m mt-3 max-w-sm text-muted">The piece or page you were looking for isn’t here any more. The new edit is waiting on the homepage.</p>
      <Link href="/" className="t-title-s mt-8 inline-flex h-[52px] items-center rounded-sm bg-ink px-6 text-on-ink">
        Back to the shop
      </Link>
    </main>
  );
}
