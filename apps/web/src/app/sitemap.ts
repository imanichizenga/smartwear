import type { MetadataRoute } from 'next';
import type { Json } from '@/lib/json';
import { SITE } from '@/lib/seo';
import { serverGet } from '@/lib/server';

export const revalidate = 3600;

function flatten(cats: Json[]): Json[] {
  return cats.flatMap((c) => [c, ...flatten((c.children as Json[] | undefined) ?? [])]);
}

/** Every public page: home, discover, all categories, collections, brands and every product (cursor-paged). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const out: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/discover`, lastModified: now, changeFrequency: 'daily', priority: 0.6 },
    { url: `${SITE}/search`, changeFrequency: 'weekly', priority: 0.3 },
  ];
  const [cats, cols, brands] = await Promise.all([serverGet<Json>('/categories', 3600), serverGet<Json>('/collections', 3600), serverGet<Json>('/brands', 3600)]);
  for (const c of flatten((cats?.items as Json[]) ?? [])) out.push({ url: `${SITE}/c/${c.slug}`, changeFrequency: 'daily', priority: c.depth === 0 ? 0.8 : 0.7 });
  for (const c of (cols?.items as Json[]) ?? []) out.push({ url: `${SITE}/collection/${c.slug}`, changeFrequency: 'weekly', priority: 0.7 });
  for (const b of (brands?.items as Json[]) ?? []) out.push({ url: `${SITE}/brand/${b.slug}`, changeFrequency: 'weekly', priority: 0.6 });
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const r: Json | null = await serverGet<Json>(`/products?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, 3600);
    for (const p of (r?.items as Json[]) ?? []) out.push({ url: `${SITE}/p/${p.slug}`, changeFrequency: 'weekly', priority: 0.9 });
    cursor = (r?.nextCursor as string) || null;
    if (!cursor) break;
  }
  return out;
}
