/**
 * Display: Fraunces (high-contrast editorial serif, variable, Google Fonts / OFL).
 * UI/body: Manrope (geometric sans with warm roundness, variable, Google Fonts / OFL).
 */
export const fontFamilies = {
  display: 'Fraunces',
  sans: 'Manrope',
  mono: 'JetBrains Mono',
} as const;

/** Font files as named in the mobile asset bundle (expo-font keys). */
export const fontAssets = {
  'Fraunces-Light': 'Fraunces_300Light',
  'Fraunces-Regular': 'Fraunces_400Regular',
  'Fraunces-Medium': 'Fraunces_500Medium',
  'Fraunces-SemiBold': 'Fraunces_600SemiBold',
  'Fraunces-LightItalic': 'Fraunces_300Light_Italic',
  'Manrope-Regular': 'Manrope_400Regular',
  'Manrope-Medium': 'Manrope_500Medium',
  'Manrope-SemiBold': 'Manrope_600SemiBold',
  'Manrope-Bold': 'Manrope_700Bold',
} as const;

export const fontSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 22,
  '2xl': 28,
  '3xl': 36,
  '4xl': 48,
} as const;

export type FontSizeToken = keyof typeof fontSizes;

export const lineHeights: Record<FontSizeToken, number> = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 26,
  xl: 28,
  '2xl': 34,
  '3xl': 42,
  '4xl': 54,
};

/** Letter spacing in em. Tight on large serif, wide on small uppercase labels. */
export const letterSpacing = {
  tight: -0.02,
  tighter: -0.03,
  normal: 0,
  label: 0.08,
  wide: 0.12,
} as const;

/**
 * Named text styles — the only type styles screens may use.
 * `family` is 'display' (serif) or 'sans'.
 */
export const textStyles = {
  displayXL: { family: 'display', size: '4xl', weight: 300, tracking: 'tighter', lineHeight: 54 },
  displayL: { family: 'display', size: '3xl', weight: 300, tracking: 'tight', lineHeight: 42 },
  displayM: { family: 'display', size: '2xl', weight: 400, tracking: 'tight', lineHeight: 34 },
  displayS: { family: 'display', size: 'xl', weight: 400, tracking: 'tight', lineHeight: 28 },
  titleL: { family: 'sans', size: 'lg', weight: 600, tracking: 'normal', lineHeight: 26 },
  titleM: { family: 'sans', size: 'md', weight: 600, tracking: 'normal', lineHeight: 24 },
  titleS: { family: 'sans', size: 'sm', weight: 600, tracking: 'normal', lineHeight: 20 },
  bodyL: { family: 'sans', size: 'lg', weight: 400, tracking: 'normal', lineHeight: 28 },
  bodyM: { family: 'sans', size: 'md', weight: 400, tracking: 'normal', lineHeight: 24 },
  bodyS: { family: 'sans', size: 'sm', weight: 400, tracking: 'normal', lineHeight: 20 },
  caption: { family: 'sans', size: 'xs', weight: 500, tracking: 'normal', lineHeight: 16 },
  label: { family: 'sans', size: 'xs', weight: 600, tracking: 'label', lineHeight: 16, uppercase: true },
  labelS: { family: 'sans', size: 'xs', weight: 600, tracking: 'wide', lineHeight: 14, uppercase: true },
  priceL: { family: 'display', size: 'xl', weight: 500, tracking: 'tight', lineHeight: 28 },
  priceM: { family: 'display', size: 'lg', weight: 500, tracking: 'tight', lineHeight: 24 },
  priceS: { family: 'display', size: 'md', weight: 500, tracking: 'normal', lineHeight: 22 },
} as const;

export type TextStyleToken = keyof typeof textStyles;
