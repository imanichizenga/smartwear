import { colors, type Theme } from './colors';
import { fontFamilies, fontSizes, letterSpacing } from './typography';
import { radii, space, shadows } from './layout';
import { durations, easings, cssEasing } from './motion';

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Emit `--sw-*` custom properties for one theme (used by admin + web loader). */
export function tokensToCssVariables(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors[theme])) out[`--sw-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(space)) out[`--sw-space-${String(k).replace('.', '_')}`] = `${v}px`;
  for (const [k, v] of Object.entries(radii)) out[`--sw-radius-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(fontSizes)) out[`--sw-text-${k}`] = `${v}px`;
  for (const [k, v] of Object.entries(letterSpacing)) out[`--sw-tracking-${k}`] = `${v}em`;
  out['--sw-font-display'] = `"${fontFamilies.display}", "Playfair Display", Georgia, serif`;
  out['--sw-font-sans'] = `"${fontFamilies.sans}", "Inter", system-ui, -apple-system, sans-serif`;
  out['--sw-font-mono'] = `"${fontFamilies.mono}", ui-monospace, SFMono-Regular, monospace`;
  for (const [k, v] of Object.entries(durations)) out[`--sw-duration-${kebab(k)}`] = `${v}ms`;
  out['--sw-ease-atelier'] = cssEasing(easings.atelier);
  out['--sw-ease-standard'] = cssEasing(easings.standard);
  const inkRgb = theme === 'light' ? '11,11,12' : '0,0,0';
  for (const [k, s] of Object.entries(shadows)) {
    out[`--sw-shadow-${k}`] = s.blur === 0 ? 'none' : `0 ${s.offsetY}px ${s.blur}px rgba(${inkRgb},${s.opacity})`;
  }
  return out;
}

export function cssVariablesBlock(theme: Theme, selector = ':root'): string {
  const vars = tokensToCssVariables(theme);
  return `${selector}{\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')}\n}`;
}
