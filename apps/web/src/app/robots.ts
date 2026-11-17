import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/realtime/', '/checkout', '/orders', '/chat/', '/rider', '/profile/', '/bag', '/wishlist', '/places', '/payments', '/wholesale', '/notifications', '/support', '/privacy', '/auth/', '/welcome'] }],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
