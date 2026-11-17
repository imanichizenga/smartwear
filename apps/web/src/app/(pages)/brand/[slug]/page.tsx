import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProductListScreen } from '@/screens/product-list';
import { loadListing } from '@/lib/listing';
import { itemListLd, JsonLd } from '@/lib/seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = await loadListing('brand', decodeURIComponent((await params).slug));
  const description = l.intro || `Shop ${l.title} at SmartWear.`;
  return { title: l.title, description, alternates: { canonical: `/brand/${l.canonicalSlug}` }, openGraph: { title: `${l.title} · SmartWear`, description } };
}

export default async function Page({ params }: Props) {
  const slug = decodeURIComponent((await params).slug);
  const l = await loadListing('brand', slug);
  return (
    <>
      <JsonLd data={itemListLd(l.title, l.first)} />
      <Suspense>
        <ProductListScreen brand={slug} title={l.title} intro={l.intro} initial={l.first} />
      </Suspense>
    </>
  );
}
