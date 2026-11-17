import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:8030';

const config: NextConfig = {
  poweredByHeader: false,
  output: 'standalone',
  reactStrictMode: true,
  transpilePackages: ['@smartwear/shared', '@smartwear/design-tokens', '@smartwear/brand'],
  // Images come pre-sized from the media pipeline (WebP/AVIF renditions + ThumbHash), so Next's optimiser is off.
  images: { unoptimized: true },
  // Same-origin API. In production nginx forwards /api and /realtime straight to Django; these rewrites make
  // `next start` / `next dev` behave the same way.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/:path*` },
      { source: '/realtime/:path*', destination: `${API}/realtime/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};

export default config;
