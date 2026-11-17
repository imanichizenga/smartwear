import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ProductListScreen } from '@/screens/product-list';
import { loadListing } from '@/lib/listing';
import { itemListLd, JsonLd } from '@/lib/seo';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ brand?: string; title?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const slug = decodeURIComponent((await params).slug);
  const { brand, title: qt } = await searchParams;
  if (slug === 'all' && brand) return { title: qt || 'Shop', alternates: { canonical: `/brand/${brand}` } };
  const l = await loadListing('category', slug);
  const description = l.intro || `Shop ${l.title} at SmartWear — fashion & beauty delivered across Tanzania.`;
  return { title: l.title, description, alternates: { canonical: `/c/${l.canonicalSlug}` }, openGraph: { title: `${l.title} · SmartWear`, description } };
}

export default async function Page({ params, searchParams }: Props) {
  const slug = decodeURIComponent((await params).slug);
  const { brand } = await searchParams;
  if (slug === 'all' && brand) {
    const l = await loadListing('brand', brand);
    return (
      <Suspense>
        <ProductListScreen brand={brand} title={l.title} intro={l.intro} initial={l.first} />
      </Suspense>
    );
  }
  const l = await loadListing('category', slug);
  return (
    <>
      <JsonLd data={itemListLd(l.title, l.first)} />
      <Suspense>
        <ProductListScreen category={slug} title={l.title} intro={l.intro} initial={l.first} />
      </Suspense>
    </>
  );
}
