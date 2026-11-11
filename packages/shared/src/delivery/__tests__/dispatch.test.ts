import { describe, expect, it } from 'vitest';
import { DispatchSettingsSchema, generateDeliveryPin, isWithinWorkingHours, radiusForRound, rankRiders } from '../dispatch';

const settings = DispatchSettingsSchema.parse({});
const now = 1_800_000_000_000;
const c = (riderId: string, distanceMeters: number, extra: Partial<Parameters<typeof rankRiders>[0]['candidates'][number]> = {}) => ({ riderId, distanceMeters, rating: 4.8, activeJobs: 0, vehicleType: 'MOTORBIKE' as const, lastSeenAt: now - 5000, ...extra });

describe('rankRiders', () => {
  it('nearest first', () => {
    const r = rankRiders({ jobId: 'j', settings, now, candidates: [c('far', 3000), c('near', 500), c('mid', 1500)] });
    expect(r.map((x) => x.riderId)).toEqual(['near', 'mid', 'far']);
  });
  it('filters busy, stale, ineligible vehicles, excluded, declined', () => {
    const r = rankRiders({ jobId: 'j', settings, now, excludeRiderIds: ['ex'], candidates: [
      c('ok', 1000), c('busy', 100, { activeJobs: 1 }), c('stale', 100, { lastSeenAt: now - 120_000 }), c('car', 100, { vehicleType: 'CAR' }), c('ex', 100), c('declined', 100, { declinedJobIds: ['j'] }),
    ] });
    // CAR is eligible by default, so it stays
    expect(r.map((x) => x.riderId)).toEqual(['car', 'ok']);
  });
  it('rating breaks near-ties', () => {
    const r = rankRiders({ jobId: 'j', settings, now, candidates: [c('low', 1000, { rating: 3.0 }), c('high', 1050, { rating: 5 })] });
    expect(r[0]!.riderId).toBe('high');
  });
});

describe('radiusForRound', () => {
  it('expands and caps', () => {
    expect(radiusForRound(settings, 0)).toBe(2500);
    expect(radiusForRound(settings, 1)).toBe(4000);
    expect(radiusForRound(settings, 99)).toBe(settings.maxRadiusMeters);
  });
});

describe('pin + hours', () => {
  it('pin has requested length and digits only', () => {
    expect(generateDeliveryPin(4, () => 0.5)).toBe('5555');
    expect(generateDeliveryPin(6)).toMatch(/^\d{6}$/);
  });
  it('working hours in Dar es Salaam (UTC+3)', () => {
    expect(isWithinWorkingHours(settings, new Date('2026-06-01T07:30:00Z'))).toBe(true); // 10:30 local
    expect(isWithinWorkingHours(settings, new Date('2026-06-01T20:30:00Z'))).toBe(false); // 23:30 local
  });
});
