/**
 * The Atelier "A" — single source of geometry and timing for the RN and web loaders.
 *
 * ViewBox is 100×100. The A is built from:
 *   - two diagonal strokes drawn base → apex (left leg, right leg)
 *   - a dashed "stitch" crossbar sewn left → right, led by a needle dot
 *   - a four-point sparkle at the apex
 *   - a soft breathe (scale 1.00 → 1.04 → 1.00) while the strokes fade to restart
 *
 * One loop = 1600ms. Phases are expressed as fractions of the loop so both platforms stay in sync.
 */
export const LOADER_VIEWBOX = 100;

export const A_GEOMETRY = {
  apex: { x: 50, y: 14 },
  baseLeft: { x: 18, y: 86 },
  baseRight: { x: 82, y: 86 },
  crossbar: { y: 62, x1: 28.67, x2: 71.33 },
  /** Left leg: base-left → apex. Right leg: base-right → apex. Drawn simultaneously. */
  leftLegPath: 'M18 86 L50 14',
  rightLegPath: 'M82 86 L50 14',
  /** Crossbar as straight segment (stitched). */
  crossbarPath: 'M28.67 62 L71.33 62',
  /** Four-point sparkle centred at apex; drawn in a 12×12 box, offset to apex. */
  sparklePath:
    'M50 4 C50.6 8.2 51.8 9.4 56 10 C51.8 10.6 50.6 11.8 50 16 C49.4 11.8 48.2 10.6 44 10 C48.2 9.4 49.4 8.2 50 4 Z',
  legLength: Math.hypot(50 - 18, 14 - 86), // ≈ 78.8
  crossbarLength: 42.66,
  stitchDash: [3.2, 2.4] as const,
} as const;

export const LOADER_LOOP_MS = 1600;

/** Phase windows in [0,1] of one loop. */
export const LOADER_PHASES = {
  drawOn: { start: 0.0, end: 0.42 },
  stitch: { start: 0.34, end: 0.66 },
  sparkle: { start: 0.58, end: 0.84 },
  breathe: { start: 0.62, end: 0.92 },
  fadeOut: { start: 0.86, end: 1.0 },
} as const;

/** Custom cubic-bezier used for every phase. */
export const LOADER_EASING: readonly [number, number, number, number] = [0.22, 0.61, 0.36, 1];

export const LOADER_SIZES = { xs: 16, sm: 20, md: 24, lg: 48, xl: 96 } as const;
export type LoaderSize = keyof typeof LOADER_SIZES;

/** Stroke width in viewBox units per size — thicker at small sizes so the mark stays legible. */
export const LOADER_STROKE: Record<LoaderSize, number> = { xs: 11, sm: 10, md: 9, lg: 7, xl: 6 };
export const LOADER_STITCH_STROKE: Record<LoaderSize, number> = { xs: 7, sm: 6, md: 5.5, lg: 4.5, xl: 4 };
export const LOADER_NEEDLE_RADIUS: Record<LoaderSize, number> = { xs: 5, sm: 4.5, md: 4, lg: 3.2, xl: 2.8 };

export const BREATHE_SCALE = 1.04;

/** Reduce-motion fallback: static A with gentle opacity pulse between these values. */
export const REDUCED_MOTION_PULSE = { min: 0.45, max: 1, periodMs: 1800 } as const;

/** Gradient sheen stops for the champagne highlight travelling along the strokes. */
export const SHEEN = { color: '#B8955A', width: 0.22 } as const;

/** Helper: progress of a sub-phase at loop time t ∈ [0,1). */
export function phaseProgress(t: number, phase: { start: number; end: number }): number {
  if (t <= phase.start) return 0;
  if (t >= phase.end) return 1;
  return (t - phase.start) / (phase.end - phase.start);
}

/** Bezier easing evaluated numerically — shared by tests and the web keyframe generator. */
export function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
  const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      const d = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(dx) < 1e-6 || d === 0) break;
      t -= dx / d;
    }
    return Math.min(1, Math.max(0, t));
  };
  return (x: number) => sampleY(solveX(x));
}

export const easeAtelier = cubicBezier(...LOADER_EASING);
