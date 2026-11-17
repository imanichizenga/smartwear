import { NextResponse } from 'next/server';
import type { Json } from '@/lib/json';
import { pickUrl } from '@/lib/media';
import { serverGet } from '@/lib/server';

/** Stable share-image URL for a product (/og/p/<slug>) → a fresh signed rendition. Link previews never go stale. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await serverGet<Json>(`/products/${encodeURIComponent(slug)}`, 600);
  const url = pickUrl((p?.media as Json[] | undefined)?.find((m) => m.type === 'IMAGE'), 1200);
  if (!url) return NextResponse.redirect(new URL('/icon-1024.png', process.env.NEXT_PUBLIC_SITE_URL ?? 'https://smartwear.co.tz'), 302);
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'public, max-age=1800' } });
}
