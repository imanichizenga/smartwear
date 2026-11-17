import type { Json } from './json';

export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://smartwear.co.tz';

export function JsonLd({ data }: { data: unknown }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}

/** schema.org ItemList of the products on a listing page (rich results / crawl hints). */
export function itemListLd(name: string, first: Json | null) {
  const items = ((first?.items as Json[] | undefined) ?? []).slice(0, 20);
  if (!items.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/p/${p.slug}`, name: p.title })),
  };
}

export const organizationLd = (branding?: Json | null) => ({
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'SmartWear', url: SITE, logo: `${SITE}/icon-512.png`, ...(branding?.supportEmail ? { email: branding.supportEmail } : {}), ...(branding?.supportPhone ? { telephone: branding.supportPhone } : {}), areaServed: 'TZ' },
    { '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'SmartWear', url: SITE, inLanguage: ['en', 'sw'], publisher: { '@id': `${SITE}/#org` }, potentialAction: { '@type': 'SearchAction', target: `${SITE}/search?q={search_term_string}`, 'query-input': 'required name=search_term_string' } },
  ],
});
