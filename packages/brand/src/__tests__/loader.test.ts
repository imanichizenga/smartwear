import { describe, expect, it } from 'vitest';
import { A_GEOMETRY, LOADER_PHASES, easeAtelier, phaseProgress } from '../loader';

describe('Atelier A loader geometry', () => {
  it('legs are equal length and meet at the apex', () => {
    const l = Math.hypot(A_GEOMETRY.apex.x - A_GEOMETRY.baseLeft.x, A_GEOMETRY.apex.y - A_GEOMETRY.baseLeft.y);
    const r = Math.hypot(A_GEOMETRY.apex.x - A_GEOMETRY.baseRight.x, A_GEOMETRY.apex.y - A_GEOMETRY.baseRight.y);
    expect(l).toBeCloseTo(r, 6);
    expect(A_GEOMETRY.legLength).toBeCloseTo(l, 6);
  });
  it('crossbar sits on both legs', () => {
    // x on left leg at crossbar y
    const t = (A_GEOMETRY.crossbar.y - A_GEOMETRY.baseLeft.y) / (A_GEOMETRY.apex.y - A_GEOMETRY.baseLeft.y);
    const xLeft = A_GEOMETRY.baseLeft.x + t * (A_GEOMETRY.apex.x - A_GEOMETRY.baseLeft.x);
    expect(xLeft).toBeCloseTo(A_GEOMETRY.crossbar.x1, 0);
  });
  it('phases cover the loop and overlap intentionally', () => {
    expect(LOADER_PHASES.drawOn.start).toBe(0);
    expect(LOADER_PHASES.fadeOut.end).toBe(1);
    expect(LOADER_PHASES.stitch.start).toBeLessThan(LOADER_PHASES.drawOn.end);
  });
  it('easing is monotonic and bounded', () => {
    let prev = 0;
    for (let i = 0; i <= 20; i++) {
      const v = easeAtelier(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    expect(easeAtelier(0)).toBeCloseTo(0, 5);
    expect(easeAtelier(1)).toBeCloseTo(1, 5);
  });
  it('phaseProgress clamps', () => {
    expect(phaseProgress(0, LOADER_PHASES.stitch)).toBe(0);
    expect(phaseProgress(0.5, LOADER_PHASES.stitch)).toBeCloseTo(0.5, 5);
    expect(phaseProgress(0.99, LOADER_PHASES.stitch)).toBe(1);
  });
});
