import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { Fraunces, Manrope } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const display = Fraunces({ subsets: ['latin'], variable: '--sw-font-display', axes: ['opsz', 'SOFT'], display: 'swap' });
const sans = Manrope({ subsets: ['latin'], variable: '--sw-font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'SmartWear Admin', template: '%s · SmartWear Admin' },
  description: 'Run the SmartWear fashion & beauty store.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF8F4' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0E10' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get('sw_theme')?.value;
  return (
    <html lang="en" data-theme={theme === 'light' || theme === 'dark' ? theme : undefined} className={`${display.variable} ${sans.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
