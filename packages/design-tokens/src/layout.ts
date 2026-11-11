/** 8-pt grid. Use these and nothing else for spacing. */
export const space = {
  0: 0,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
} as const;
export type SpaceToken = keyof typeof space;

export const radii = {
  none: 0,
  xs: 2,
  sm: 4, // chips, inputs, product images
  md: 12, // cards
  lg: 24, // sheets
  full: 9999,
} as const;
export type RadiusToken = keyof typeof radii;

export const borderWidths = { hairline: 1, thin: 1.5, thick: 2 } as const;

/** Product imagery is always 4:5 portrait. */
export const aspectRatios = { product: 4 / 5, hero: 3 / 4, story: 9 / 16, square: 1, wide: 16 / 9 } as const;

export const iconSizes = { xs: 16, sm: 20, md: 24, lg: 28, xl: 32 } as const;
export const iconStroke = 1.5;

export const touchTarget = 44;
export const screenGutter = space[5]; // 20pt side gutter on phones
export const gridGap = space[3];

/** Elevation: almost flat. Only floating elements get a soft, large, low-opacity shadow. */
export const shadows = {
  none: { offsetY: 0, blur: 0, opacity: 0, radius: 0 },
  floating: { offsetY: 12, blur: 32, opacity: 0.12, radius: 32 },
  sheet: { offsetY: -8, blur: 40, opacity: 0.14, radius: 40 },
  sticky: { offsetY: 6, blur: 24, opacity: 0.1, radius: 24 },
} as const;
export type ShadowToken = keyof typeof shadows;

export const zIndex = { base: 0, raised: 1, sticky: 10, overlay: 50, sheet: 60, toast: 70, loader: 80 } as const;
