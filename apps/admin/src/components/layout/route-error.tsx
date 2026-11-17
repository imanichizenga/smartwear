'use client';

import { useEffect, useRef, useState, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { LoaderBlock } from '@/components/brand/LoaderA';
import { Button } from '@/components/ui/button';

/** A deploy replaced the hashed JS chunks an open tab still points at. Only a full reload fixes that. */
export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(msg);
}

const RELOAD_KEY = 'sw.admin.chunkReloadAt';
const RETRY_KEY = 'sw.admin.autoRetryAt';

function recently(key: string, ms: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(key) || 0);
    return Date.now() - at < ms;
  } catch {
    return false;
  }
}
function mark(key: string) {
  try {
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    /* private mode: fine */
  }
}

/**
 * Route error boundary. Transient failures (API blip, worker restart, stale chunk after a deploy) recover on
 * their own: a stale chunk reloads the page once; anything else is retried once in place (refresh the server
 * data + re-render). Only if that also fails does the admin see this card — with retry and reload.
 */
export function RouteError({ error, reset, fullPage = false }: { error: Error & { digest?: string }; reset: () => void; fullPage?: boolean }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const tried = useRef(false);

  const retry = () => {
    setRetrying(true);
    startTransition(() => {
      router.refresh();
      reset();
    });
    // If the retry fails again the boundary re-mounts with the new error; this just ends the spinner otherwise.
    setTimeout(() => setRetrying(false), 4000);
  };

  useEffect(() => {
    console.error(error);
    if (isChunkError(error)) {
      if (!recently(RELOAD_KEY, 30_000)) {
        mark(RELOAD_KEY);
        window.location.reload();
        return;
      }
    } else if (!tried.current && !recently(RETRY_KEY, 15_000)) {
      tried.current = true;
      mark(RETRY_KEY);
      const t = setTimeout(retry, 450);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  const autoRecovering = (isChunkError(error) && !recently(RELOAD_KEY, 30_000)) || retrying;
  if (autoRecovering) return <LoaderBlock message="Reconnecting…" className={fullPage ? 'min-h-screen' : 'min-h-[50vh]'} />;

  return (
    <div className={`flex flex-col items-center justify-center px-6 py-16 text-center ${fullPage ? 'min-h-screen' : 'min-h-[50vh]'}`}>
      <div className="mb-5 flex size-14 items-center justify-center rounded-full bg-accent-soft text-ink">
        <TriangleAlert className="size-6" strokeWidth={1.5} />
      </div>
      <p className="font-display text-2xl leading-8">This page didn’t load</p>
      <p className="mt-2 max-w-sm text-sm text-muted">The connection to SmartWear dropped for a moment. Your data is safe — try again.</p>
      <div className="mt-6 flex gap-2">
        <Button icon={<RefreshCw />} onClick={retry} pending={retrying}>
          Try again
        </Button>
        <Button variant="secondary" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </div>
      {error.digest && <p className="mt-6 font-mono text-[11px] text-subtle">Ref {error.digest}</p>}
    </div>
  );
}
