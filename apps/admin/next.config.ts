import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactCompiler: true,
  poweredByHeader: false,
  output: 'standalone',
  transpilePackages: ['@smartwear/shared', '@smartwear/design-tokens', '@smartwear/brand'],
  // Same-origin API: the browser talks to /api/* and Next forwards to Django, so the httpOnly
  // admin cookie is first-party and no CORS preflights are needed.
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
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default config;
