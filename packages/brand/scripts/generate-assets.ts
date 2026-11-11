/**
 * Generates app icon, adaptive icon, splash and favicons from the Atelier A mark.
 * Output: packages/brand/assets/*  (consumed by apps/mobile/app.config.ts and apps/admin/public).
 */
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atelierMarkSvg } from '../src/wordmark';
import { colors } from '@smartwear/design-tokens';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'assets');
mkdirSync(out, { recursive: true });

async function png(svg: string, file: string, size: number) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(join(out, file));
}

const light = colors.light;
const dark = colors.dark;

async function main() {
  // App icon (iOS: no transparency, ivory background, ink A)
  const icon = atelierMarkSvg({ ink: light.ink, accent: light.accent, background: light.canvas, size: 1024, radius: 0, inset: 0.6 });
  writeFileSync(join(out, 'icon.svg'), icon);
  await png(icon, 'icon.png', 1024);
  // Android adaptive foreground (transparent, mark inset) + background colour file via app.config
  const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024"><g transform="translate(20 20) scale(0.6)">${atelierMarkSvg({ ink: light.ink, accent: light.accent }).replace(/<svg[^>]*>|<\/svg>/g, '')}</g></svg>`;
  await png(fg, 'adaptive-icon.png', 1024);
  // Splash: mark centered on canvas (light & dark)
  for (const [name, theme] of [['splash-light', light], ['splash-dark', dark]] as const) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="2048" height="2048"><rect width="100" height="100" fill="${theme.canvas}"/><g transform="translate(32 32) scale(0.36)">${atelierMarkSvg({ ink: theme.ink, accent: theme.accent }).replace(/<svg[^>]*>|<\/svg>/g, '')}</g></svg>`;
    await png(svg, `${name}.png`, 2048);
  }
  // Favicons
  const fav = atelierMarkSvg({ ink: light.ink, accent: light.accent, background: light.canvas, radius: 0.18, inset: 0.78 });
  writeFileSync(join(out, 'favicon.svg'), fav);
  await png(fav, 'favicon-32.png', 32);
  await png(fav, 'favicon-180.png', 180);
  await png(fav, 'favicon-512.png', 512);
  console.log('brand assets written to', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
