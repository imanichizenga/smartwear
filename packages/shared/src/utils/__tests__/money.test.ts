import { describe, expect, it } from 'vitest';
import { applyRounding, formatMoney } from '../money';
import { normalizePhone, toBeemMsisdn } from '../phone';
import { decodePolyline, encodePolyline, haversineMeters, pointAlongRoute, pointInPolygon } from '../geo';

describe('formatMoney', () => {
  it('TZS has no decimals', () => {
    expect(formatMoney({ amount: 25000, currency: 'TZS' })).toBe('TZS 25,000');
    expect(formatMoney({ amount: 25000, currency: 'TZS' }, { display: 'none' })).toBe('25,000');
  });
  it('USD has 2 decimals', () => {
    expect(formatMoney({ amount: 1999, currency: 'USD' }, { locale: 'en-US', display: 'symbol' })).toBe('$19.99');
  });
  it('rounding rules', () => {
    expect(applyRounding(25049, 'nearest_100')).toBe(25000);
    expect(applyRounding(25050, 'nearest_100')).toBe(25100);
    expect(applyRounding(25001, 'up_100')).toBe(25100);
  });
});

describe('phone', () => {
  it('normalises Tanzanian numbers', () => {
    expect(normalizePhone('0712 345 678')?.e164).toBe('+255712345678');
    expect(normalizePhone('712345678')?.e164).toBe('+255712345678');
    expect(normalizePhone('+255 712 345 678')?.e164).toBe('+255712345678');
    expect(toBeemMsisdn('+255712345678')).toBe('255712345678');
  });
  it('rejects garbage', () => {
    expect(normalizePhone('12')).toBeNull();
  });
});

describe('geo', () => {
  it('polyline roundtrip', () => {
    const pts = [{ lat: -6.7924, lng: 39.2083 }, { lat: -6.80, lng: 39.25 }];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts.map((p) => ({ lat: Math.round(p.lat * 1e5) / 1e5, lng: Math.round(p.lng * 1e5) / 1e5 })));
  });
  it('haversine ~ 5.7km across Dar', () => {
    const d = haversineMeters({ lat: -6.7924, lng: 39.2083 }, { lat: -6.8161, lng: 39.2803 });
    expect(d).toBeGreaterThan(8000); expect(d).toBeLessThan(9000);
  });
  it('point in polygon & along route', () => {
    const ring: [number, number][] = [[39.2, -6.8], [39.3, -6.8], [39.3, -6.7], [39.2, -6.7], [39.2, -6.8]];
    expect(pointInPolygon({ lat: -6.75, lng: 39.25 }, ring)).toBe(true);
    expect(pointInPolygon({ lat: -6.95, lng: 39.25 }, ring)).toBe(false);
    const r = pointAlongRoute([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }], 0.5);
    expect(r.point.lng).toBeCloseTo(0.5, 5);
    expect(r.bearing).toBeCloseTo(90, 0);
  });
});
