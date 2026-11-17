import { thumbHashToDataURL } from 'thumbhash';
import type { Json } from './json';

const thumbCache = new Map<string, string | null>();

/** ThumbHash → tiny blurred data URL, decoded once. Bad base64 / corrupt hashes yield null. */
export function thumbhashUrl(hash?: string | null): string | null {
  if (!hash) return null;
  if (thumbCache.has(hash)) return thumbCache.get(hash)!;
  let url: string | null = null;
  try {
    if (typeof atob === 'function') {
      const bin = atob(hash);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      url = thumbHashToDataURL(bytes);
    }
  } catch {
    url = null;
  }
  thumbCache.set(hash, url);
  return url;
}

export interface Src {
  width: number;
  url: string;
}
export const sourcesOf = (m: Json | null | undefined, fmt: 'avif' | 'webp' | 'jpeg'): Src[] => {
  const s = (m?.sources as Json | undefined)?.[fmt];
  return Array.isArray(s) ? (s as Src[]).filter((x) => x && typeof x.url === 'string').sort((a, b) => a.width - b.width) : [];
};
export const srcSet = (list: Src[]) => list.map((s) => `${s.url} ${s.width}w`).join(', ');

/** Media the pipeline hasn't finished yet (show a shimmer, not a fallback). */
export const mediaPending = (m: Json | null | undefined) => ['UPLOADING', 'UPLOADED', 'PROCESSING'].includes(String(m?.status ?? ''));

/** The best single URL at least `w` px wide (for backgrounds, preloads and OG tags). */
export function pickUrl(m: Json | null | undefined, w = 1024): string | null {
  if (!m) return null;
  if (m.type === 'VIDEO') return typeof m.posterUrl === 'string' ? m.posterUrl : null;
  const list = [...sourcesOf(m, 'webp')];
  if (!list.length) list.push(...sourcesOf(m, 'jpeg'));
  if (!list.length) return typeof m.url === 'string' ? m.url : null;
  return (list.find((s) => s.width >= w) ?? list[list.length - 1]!).url;
}
