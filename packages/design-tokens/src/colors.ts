/**
 * SmartWear Atelier — colour tokens.
 * Monochrome base, warm ivory canvas, one champagne-gold accent, a blush for beauty.
 * Semantic colours are deliberately desaturated: nothing neon, ever.
 */
export const palette = {
  ink: { light: '#0B0B0C', dark: '#F5F2EC' },
  canvas: { light: '#FAF8F4', dark: '#0E0E10' },
  surface: { light: '#FFFFFF', dark: '#17171A' },
  surfaceRaised: { light: '#FFFFFF', dark: '#1D1D21' },
  muted: { light: '#6E6A64', dark: '#A29D95' },
  subtle: { light: '#9A958D', dark: '#75716A' },
  hairline: { light: '#E9E4DC', dark: '#2A2A2E' },
  accent: { light: '#B8955A', dark: '#D1B07A' },
  accentSoft: { light: '#F1E7D5', dark: '#2E271C' },
  blush: { light: '#F3E3DD', dark: '#3A2C29' },
  success: { light: '#4E7A5A', dark: '#8FB89B' },
  successSoft: { light: '#E6EFE8', dark: '#1F2D23' },
  warning: { light: '#A8742C', dark: '#D9AE63' },
  warningSoft: { light: '#F6EBD7', dark: '#352A17' },
  danger: { light: '#9E4A47', dark: '#D08A87' },
  dangerSoft: { light: '#F4E3E2', dark: '#3A2322' },
  info: { light: '#4F6A8C', dark: '#93ACCB' },
  overlay: { light: 'rgba(11,11,12,0.45)', dark: 'rgba(0,0,0,0.6)' },
  scrim: { light: 'rgba(250,248,244,0.72)', dark: 'rgba(14,14,16,0.72)' },
  onInk: { light: '#FAF8F4', dark: '#0B0B0C' },
  onAccent: { light: '#0B0B0C', dark: '#0B0B0C' },
  // Map markers — fixed in both themes by product decision
  mapClient: { light: '#000000', dark: '#000000' },
  mapRider: { light: '#1E6BFF', dark: '#1E6BFF' },
  mapOffice: { light: '#1E6BFF', dark: '#1E6BFF' },
  mapRing: { light: '#FFFFFF', dark: '#FFFFFF' },
  mapRoute: { light: '#0B0B0C', dark: '#F5F2EC' },
  mapRouteSecondary: { light: '#B8955A', dark: '#D1B07A' },
} as const;

export type ColorToken = keyof typeof palette;
export type Theme = 'light' | 'dark';
export type ColorScheme = Record<ColorToken, string>;

export const colors: Record<Theme, ColorScheme> = {
  light: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, v.light])) as ColorScheme,
  dark: Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, v.dark])) as ColorScheme,
};
