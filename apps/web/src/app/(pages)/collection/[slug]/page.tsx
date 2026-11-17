import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProductListScreen } from '@/screens/product-list';
import { loadListing } from '@/lib/listing';
import { pickUrl } from '@/lib/media';
import type { Json } from '@/lib/json';
import { itemListLd, JsonLd } from '@/lib/seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = await loadListing('collection', decodeURIComponent((await params).slug));
  const description = l.intro || `${l.title} — a SmartWear edit.`;
  const image = pickUrl(l.detail?.cover as Json | undefined, 1200);
  return { title: l.title, description, alternates: { canonical: `/collection/${l.canonicalSlug}` }, openGraph: { title: `${l.title} · SmartWear`, description, images: image ? [image] : undefined } };
}

export default async function Page({ params }: Props) {
  const slug = decodeURIComponent((await params).slug);
  const l = await loadListing('collection', slug);
  return (
    <>
      <JsonLd data={itemListLd(l.title, l.first)} />
      <Suspense>
        <ProductListScreen collection={slug} title={l.title} intro={l.intro} initial={l.first} />
      </Suspense>
    </>
  );
}
