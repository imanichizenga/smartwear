'use client';

import { useEffect } from 'react';
import { isChunkError } from '@/components/layout/route-error';
import './globals.css';

/** Root-layout failures (rare): reload once for a stale deploy, otherwise offer a reload. */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!isChunkError(error)) return;
    try {
      const at = Number(sessionStorage.getItem('sw.admin.chunkReloadAt') || 0);
      if (Date.now() - at < 30_000) return;
      sessionStorage.setItem('sw.admin.chunkReloadAt', String(Date.now()));
    } catch {
      /* ignore */
    }
    window.location.reload();
  }, [error]);
  return (
    <html lang="en">
      <body className="bg-canvas text-ink">
        <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center font-sans">
          <p className="font-display text-2xl">SmartWear Admin couldn’t load</p>
          <p className="mt-2 max-w-sm text-sm text-muted">Please reload the page. If it keeps happening, the API may be restarting — give it a minute.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-6 h-10 rounded-sm bg-ink px-5 text-sm font-semibold text-on-ink">
            Reload
          </button>
          {error.digest && <p className="mt-6 font-mono text-[11px] text-subtle">Ref {error.digest}</p>}
        </main>
      </body>
    </html>
  );
}
