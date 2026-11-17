import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Fraunces, Manrope } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], weight: ['300', '400', '500', '600'], style: ['normal', 'italic'], variable: '--font-fraunces', display: 'swap' });
const sans = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-manrope', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://smartwear.co.tz'),
  title: { default: 'SmartWear — Fashion & beauty, delivered', template: '%s · SmartWear' },
  description: 'Editorial fashion and beauty, delivered to your door across Tanzania.',
  applicationName: 'SmartWear',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/favicon-32.png', sizes: '32x32' }], apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'SmartWear', statusBarStyle: 'default' },
  openGraph: { type: 'website', siteName: 'SmartWear', title: 'SmartWear — Fashion & beauty, delivered', description: 'Editorial fashion and beauty, delivered to your door.' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF8F4' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0E10' },
  ],
};

/** Applies the saved theme before first paint (no light→dark flash). */
const themeScript = `try{var t=localStorage.getItem('sw.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var l=localStorage.getItem('sw.locale');if(l==='sw'||l==='en')document.documentElement.lang=l}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('sw_theme')?.value;
  return (
    <html lang="en" data-theme={theme === 'light' || theme === 'dark' ? theme : undefined} className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
