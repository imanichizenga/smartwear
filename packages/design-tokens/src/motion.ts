/** Purposeful, physical motion. Springs are gentle — never bouncy. */
export const durations = { instant: 80, fast: 150, base: 240, slow: 400, loaderLoop: 1600, crossfade: 150, minPending: 300 } as const;

export const easings = {
  /** Custom "atelier" curve — eases in late, resolves softly. */
  atelier: [0.22, 0.61, 0.36, 1] as const,
  standard: [0.2, 0, 0, 1] as const,
  decelerate: [0, 0, 0.2, 1] as const,
  accelerate: [0.4, 0, 1, 1] as const,
};

export const cssEasing = (e: readonly [number, number, number, number]) => `cubic-bezier(${e.join(',')})`;

export const springs = {
  gentle: { damping: 22, stiffness: 180, mass: 1 },
  snappy: { damping: 26, stiffness: 300, mass: 0.9 },
  sheet: { damping: 28, stiffness: 260, mass: 1 },
  press: { damping: 20, stiffness: 400, mass: 0.7 },
} as const;

export const pressScale = 0.97;
