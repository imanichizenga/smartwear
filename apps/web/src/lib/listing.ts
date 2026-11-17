import 'server-only';
import type { Json } from './json';
import { serverGet, slim } from './server';

const pretty = (slug: string) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Server data for a listing page: its name/intro (for <title>, <h1>, description) and the first page of products. */
export async function loadListing(kind: 'category' | 'collection' | 'brand', slug: string) {
  const qs = new URLSearchParams({ limit: '20' });
  if (kind === 'category' && slug !== 'all') qs.set('category', slug);
  if (kind === 'collection') qs.set('collection', slug);
  if (kind === 'brand') qs.set('brand', slug);
  const detailPath = kind === 'category' ? (slug === 'all' ? null : `/categories/${encodeURIComponent(slug)}`) : kind === 'collection' ? `/collections/${encodeURIComponent(slug)}` : `/brands/${encodeURIComponent(slug)}`;
  const [detail, first] = await Promise.all([detailPath ? serverGet<Json>(detailPath, 300) : Promise.resolve(null), serverGet<Json>(`/products?${qs}`, 120)]);
  const title = (detail && ((detail.name as string) || (detail.title as string))) || (slug === 'all' ? 'New in' : pretty(slug));
  const intro = (detail && ((detail.subtitle as string) || (detail.description as string) || (detail.story as string))) || null;
  const canonicalSlug = (detail?.slug as string) || slug;
  return { detail, first: first ? slim(first) : null, title, intro, canonicalSlug };
}
