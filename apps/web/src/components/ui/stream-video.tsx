'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type HlsType from 'hls.js';

/**
 * Smooth video for the feed: adaptive HLS (360p → 1080p as bandwidth allows, starts on a light rung so the first
 * frame appears fast), native HLS on Safari/iOS, progressive MP4 fallback. Nearby looks preload (buffer a few
 * seconds) while only the active one plays; far-away ones release their buffers.
 */
export interface StreamVideoProps {
  hls?: string | null;
  mp4?: string | null;
  poster?: string | null;
  /** On screen and allowed to play. */
  active: boolean;
  /** Adjacent to the active look: buffer ahead so a swipe starts instantly. */
  near: boolean;
  muted: boolean;
  className?: string;
  onBuffering?: (b: boolean) => void;
  onError?: () => void;
}

let hlsModule: Promise<typeof HlsType> | null = null;
const loadHls = () => (hlsModule ??= import('hls.js/light').then((m) => m.default));

export const StreamVideo = forwardRef<HTMLVideoElement | null, StreamVideoProps>(function StreamVideo({ hls, mp4, poster, active, near, muted, className, onBuffering, onError }, fwd) {
  const ref = useRef<HTMLVideoElement>(null);
  const player = useRef<HlsType | null>(null);
  useImperativeHandle(fwd, () => ref.current as HTMLVideoElement, []);
  const wanted = active || near;

  // Attach / detach the source as the look comes near / goes away.
  useEffect(() => {
    const v = ref.current;
    if (!v || !wanted) return;
    let cancelled = false;
    const native = !!hls && v.canPlayType('application/vnd.apple.mpegurl') !== '';
    if (hls && !native) {
      void loadHls()
        .then((Hls) => {
          if (cancelled || !ref.current) return;
          if (!Hls.isSupported()) {
            if (mp4) v.src = mp4;
            return;
          }
          const h = new Hls({
            capLevelToPlayerSize: true,
            startLevel: 0, // light rung first: first frame fast, ABR climbs within seconds
            abrEwmaDefaultEstimate: 700_000,
            maxBufferLength: active ? 20 : 6,
            maxMaxBufferLength: 30,
            backBufferLength: 10,
            enableWorker: true,
          });
          h.on(Hls.Events.ERROR, (_, d) => {
            if (!d.fatal) return;
            if (d.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
            else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
            else {
              h.destroy();
              player.current = null;
              if (mp4) v.src = mp4;
              else onError?.();
            }
          });
          h.loadSource(hls);
          h.attachMedia(v);
          player.current = h;
        })
        .catch(() => {
          if (!cancelled && mp4) v.src = mp4;
        });
    } else {
      const src = hls ?? mp4;
      if (src && v.getAttribute('src') !== src) v.src = src;
    }
    return () => {
      cancelled = true;
      player.current?.destroy();
      player.current = null;
      v.removeAttribute('src');
      v.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hls, mp4, wanted]);

  // Buffer more once active; play only when active.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (player.current) player.current.config.maxBufferLength = active ? 20 : 6;
    if (active) void v.play().catch(() => undefined);
    else v.pause();
  }, [active]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  return (
    <video
      ref={ref}
      poster={poster ?? undefined}
      className={className}
      loop
      playsInline
      muted={muted}
      preload={wanted ? 'auto' : 'none'}
      onWaiting={() => onBuffering?.(true)}
      onStalled={() => onBuffering?.(true)}
      onPlaying={() => onBuffering?.(false)}
      onCanPlay={() => onBuffering?.(false)}
      onError={() => !player.current && onError?.()}
    />
  );
});
