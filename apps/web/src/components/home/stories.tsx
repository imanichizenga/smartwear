'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useT } from '@/lib/hooks';
import { int, list, obj, str, strN, type Json } from '@/lib/json';
import { linkHref } from '@/lib/nav';
import { SwButton } from '../ui/button';
import { Ic, Icon } from '../ui/icons';
import { SwImage } from '../ui/sw-image';

let state: { stories: Json[]; start: number } | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export function openStories(stories: Json[], start: number) {
  state = { stories, start };
  emit();
}
const close = () => {
  state = null;
  emit();
};

export function StoriesHost() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => state,
    () => null,
  );
  if (!s || typeof document === 'undefined') return null;
  return createPortal(<Viewer key={s.start + ':' + s.stories.length} stories={s.stories} start={s.start} />, document.body);
}

/** Full-screen stories: tap right/left to move, hold to pause, swipe down (or Esc) to close. */
function Viewer({ stories, start }: { stories: Json[]; start: number }) {
  const t = useT();
  const router = useRouter();
  const [story, setStory] = useState(start);
  const [item, setItem] = useState(0);
  const [progress, setProgress] = useState(0);
  const paused = useRef(false);
  const touchY = useRef<number | null>(null);
  const items = list(stories[story], 'items');
  const cur = items[item] ?? {};
  const duration = int(cur, 'durationMs', 5000);

  const next = () => {
    if (item + 1 < items.length) setItem(item + 1);
    else if (story + 1 < stories.length) {
      setStory(story + 1);
      setItem(0);
    } else close();
  };
  const prev = () => {
    if (item > 0) setItem(item - 1);
    else if (story > 0) {
      setStory(story - 1);
      setItem(0);
    }
  };

  useEffect(() => {
    if (!items.length) return close();
    setProgress(0);
    void api.post(`/stories/${str(stories[story], 'id')}/seen`).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, item]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!paused.current && !document.hidden) {
        setProgress((p) => {
          const np = p + dt / duration;
          if (np >= 1) {
            queueMicrotask(next);
            return 1;
          }
          return np;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, item, duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    const o = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = o;
    };
  });

  const link = obj(cur, 'link');
  const href = linkHref(link);
  return (
    <div data-theme="dark" className="fixed inset-0 z-[85] flex items-center justify-center bg-canvas" style={{ animation: 'sw-fade-in 240ms both' }} role="dialog" aria-modal="true" aria-label={str(stories[story], 'title')}>
      <div
        className="relative h-full w-full overflow-hidden md:h-[min(92dvh,860px)] md:w-auto md:rounded-md"
        style={{ aspectRatio: undefined }}
        onPointerDown={() => (paused.current = true)}
        onPointerUp={() => (paused.current = false)}
        onPointerLeave={() => (paused.current = false)}
        onTouchStart={(e) => (touchY.current = e.touches[0]?.clientY ?? null)}
        onTouchEnd={(e) => {
          const y0 = touchY.current;
          const y1 = e.changedTouches[0]?.clientY;
          if (y0 != null && y1 != null && y1 - y0 > 90) close();
          touchY.current = null;
        }}
      >
        <div className="relative h-full md:aspect-[9/16]">
          <SwImage key={`${story}-${item}`} media={obj(cur, 'media')} aspect={null} rounded="" sizes="(min-width:768px) 480px, 100vw" priority dark />
          <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(14,14,16,.5), rgba(14,14,16,0) 20%, rgba(14,14,16,0) 60%, rgba(14,14,16,.7))' }} />
          <button type="button" aria-label="Previous" className="absolute inset-y-0 left-0 w-1/3" onClick={prev} />
          <button type="button" aria-label="Next" className="absolute inset-y-0 right-0 w-2/3" onClick={next} />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col p-4 pt-[calc(env(safe-area-inset-top)+16px)]">
            <div className="flex gap-1">
              {items.map((_, i) => (
                <span key={i} className="h-0.5 flex-1 overflow-hidden" style={{ background: 'rgba(245,242,236,.3)' }}>
                  <span className="block h-full bg-ink" style={{ width: `${(i < item ? 1 : i === item ? progress : 0) * 100}%` }} />
                </span>
              ))}
            </div>
            <div className="pointer-events-auto mt-4 flex items-center">
              <p className="t-label flex-1 text-ink">{str(stories[story], 'title')}</p>
              <button type="button" aria-label={t('common.close')} onClick={close} className="flex size-11 items-center justify-center text-ink">
                <Icon icon={Ic.x} size={22} />
              </button>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 p-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
            {strN(cur, 'caption') && <p className="t-display-m text-ink">{str(cur, 'caption')}</p>}
            {href && (
              <div className="mt-5">
                <SwButton
                  label={t('common.seeMore')}
                  icon={Ic.arrowRight}
                  variant="premium"
                  onPress={() => {
                    close();
                    router.push(href);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <button type="button" aria-label="Previous story" onClick={prev} className="absolute left-6 top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-ink md:flex">
        <Icon icon={Ic.chevronLeft} size={22} />
      </button>
      <button type="button" aria-label="Next story" onClick={next} className="absolute right-6 top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-ink md:flex">
        <Icon icon={Ic.chevronRight} size={22} />
      </button>
    </div>
  );
}
