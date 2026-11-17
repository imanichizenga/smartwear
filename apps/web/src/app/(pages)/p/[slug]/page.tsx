import type { Metadata } from 'next';
import { ProductScreen } from '@/screens/product';
import { serverGet, slim } from '@/lib/server';
import type { Json } from '@/lib/json';
import { SITE } from '@/lib/seo';

type Props = { params: Promise<{ slug: string }> };

const plain = (html: unknown) => (typeof html === 'string' ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) : '');

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const p = await serverGet<Json>(`/products/${encodeURIComponent(decodeURIComponent(slug))}`);
  if (!p) return { title: 'SmartWear' };
  const brand = (p.brand as Json | undefined)?.name as string | undefined;
  const title = brand ? `${p.title} — ${brand}` : String(p.title);
  const price = p.price as Json | undefined;
  const money = price ? `${price.currency ?? 'TZS'} ${Number(price.yourPrice ?? price.retail ?? 0).toLocaleString('en-US')}` : '';
  const description = [p.tagline, plain(p.descriptionHtml)].filter(Boolean).join('. ').replace(/\.\.+/g, '.').slice(0, 150) + (money ? ` — ${money}, delivered across Tanzania.` : '');
  const image = `/og/p/${p.slug}`;
  return {
    title,
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { type: 'website', title, description, images: image ? [{ url: image, width: 1200, alt: String(p.title) }] : undefined },
    twitter: { card: 'summary_large_image', title, description, images: image ? [image] : undefined },
  };
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const s = decodeURIComponent(slug);
  const p = await serverGet<Json>(`/products/${encodeURIComponent(s)}`);
  const price = p?.price as Json | undefined;
  const ld = p
    ? {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.title,
        brand: (p.brand as Json | undefined)?.name ? { '@type': 'Brand', name: (p.brand as Json).name } : undefined,
        description: plain(p.descriptionHtml),
        image: `${SITE}/og/p/${p.slug}`,
        url: `${SITE}/p/${p.slug}`,
        sku: (p.variants as Json[] | undefined)?.[0]?.sku,
        aggregateRating: Number(p.reviewCount) > 0 ? { '@type': 'AggregateRating', ratingValue: (p.reviews as Json | undefined)?.average, reviewCount: p.reviewCount } : undefined,
        offers: price ? { '@type': 'Offer', url: `${SITE}/p/${p.slug}`, priceCurrency: price.currency ?? 'TZS', price: price.retail, itemCondition: 'https://schema.org/NewCondition', availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', seller: { '@type': 'Organization', name: 'SmartWear' } } : undefined,
      }
    : null;
  return (
    <>
      {ld && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, '\\u003c') }} />}
      <ProductScreen slug={s} initial={p ? slim(p) : null} />
    </>
  );
}
