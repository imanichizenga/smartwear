'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { SwButton } from '@/components/ui/button';
import { Ic } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/kit';

const chunk = (e: unknown) => /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(String((e as Error)?.message ?? e) + String((e as Error)?.name));

/** Transient failures heal themselves: a stale deploy reloads once, anything else retries once in place. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const tried = useRef(false);
  useEffect(() => {
    const key = chunk(error) ? 'sw.web.reloadAt' : 'sw.web.retryAt';
    let recent = false;
    try {
      recent = Date.now() - Number(sessionStorage.getItem(key) || 0) < 20_000;
      if (!recent) sessionStorage.setItem(key, String(Date.now()));
    } catch {
      /* ignore */
    }
    if (recent || tried.current) return;
    tried.current = true;
    if (chunk(error)) window.location.reload();
    else {
      const t = setTimeout(() => {
        router.refresh();
        reset();
      }, 450);
      return () => clearTimeout(t);
    }
  }, [error, reset, router]);
  return (
    <main className="flex min-h-[70dvh] items-center justify-center">
      <EmptyState title="Something slipped" body="We could not finish that. Please try again in a moment." icon={Ic.circleAlert} action={<SwButton label="Try again" icon={Ic.refreshCw} variant="secondary" onPress={() => { router.refresh(); reset(); }} />} />
    </main>
  );
}
