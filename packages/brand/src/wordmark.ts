/** Static brand marks (SVG strings) derived from the same A geometry: app icon, splash, favicon. */
import { A_GEOMETRY, LOADER_VIEWBOX } from './loader';

export interface MarkOptions {
  ink?: string;
  accent?: string;
  background?: string | null;
  size?: number;
  /** Corner radius for icon backgrounds, as fraction of size. */
  radius?: number;
  /** Fraction of the canvas the mark occupies (icons need breathing room; 1 = edge to edge). */
  inset?: number;
}

export function atelierMarkSvg(opts: MarkOptions = {}): string {
  const { ink = '#0B0B0C', accent = '#B8955A', background = null, size = 512, radius = 0, inset = 1 } = opts;
  const g = A_GEOMETRY;
  const vb = LOADER_VIEWBOX;
  const bg = background
    ? `<rect width="${vb}" height="${vb}" rx="${radius * vb}" fill="${background}"/>`
    : '';
  // Optical centre of the mark (sparkle top y=4 → base y=86) is (50, 45); scale about it.
  const t = inset === 1 ? '' : ` transform="translate(${50 - inset * 50} ${50 - inset * 45}) scale(${inset})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" width="${size}" height="${size}">
${bg}
<g${t}>
<path d="${g.leftLegPath}" stroke="${ink}" stroke-width="6.5" stroke-linecap="round" fill="none"/>
<path d="${g.rightLegPath}" stroke="${ink}" stroke-width="6.5" stroke-linecap="round" fill="none"/>
<path d="${g.crossbarPath}" stroke="${ink}" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="4.2 3.6" fill="none"/>
<path d="${g.sparklePath}" fill="${accent}"/>
</g>
</svg>`;
}

export const WORDMARK = 'SMARTWEAR';
export const WORDMARK_TRACKING_EM = 0.28;
