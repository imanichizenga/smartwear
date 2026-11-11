import { describe, expect, it } from 'vitest';
import { DeliveryPricingSettingsSchema, computeDeliveryFee, computeRiderEarning, peakMultiplier, type ZoneRule } from '../fees';

const settings = DeliveryPricingSettingsSchema.parse({ baseFee: 2000, perKm: 700, minimumFee: 2500, includedMeters: 1000, roundTo: 100, freeDeliveryThreshold: 150000, maxDistanceMeters: 20000, peakWindows: [{ days: [], startHour: 17, endHour: 20, multiplier: 1.3 }] });
const standard = settings.options.find((o) => o.id === 'standard')!;
const express = settings.options.find((o) => o.id === 'express')!;
const pickup = settings.options.find((o) => o.id === 'pickup')!;
const dest = { lat: -6.77, lng: 39.24 };
const quiet = new Date('2026-06-01T10:00:00');
const peak = new Date('2026-06-01T18:00:00');

describe('computeDeliveryFee', () => {
  it('base + per km beyond included distance, rounded', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 4500, destination: dest, zones: [], option: standard, subtotal: 40000, at: quiet });
    // billable 3.5km * 700 = 2450 + 2000 = 4450 → 4500 (round to 100, 4450 rounds to 4500 with Math.round)
    expect(r.fee).toBe(4500);
    expect(r.serviceable).toBe(true);
  });
  it('enforces minimum fee', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 300, destination: dest, zones: [], option: standard, subtotal: 1000, at: quiet });
    expect(r.fee).toBe(2500);
  });
  it('express multiplies', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 4500, destination: dest, zones: [], option: express, subtotal: 1000, at: quiet });
    expect(r.fee).toBe(roundish(4450 * 1.5));
  });
  it('pickup is free', () => {
    expect(computeDeliveryFee({ settings, distanceMeters: 99999, destination: dest, zones: [], option: pickup, subtotal: 0, at: quiet }).fee).toBe(0);
  });
  it('peak multiplier applies in window', () => {
    expect(peakMultiplier(settings, peak)).toBe(1.3);
    expect(peakMultiplier(settings, quiet)).toBe(1);
  });
  it('free delivery threshold zeroes the fee but keeps the pre-free amount', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 4500, destination: dest, zones: [], option: standard, subtotal: 200000, at: quiet });
    expect(r.fee).toBe(0);
    expect(r.freeDelivery).toBe(true);
    expect(r.subtotalBeforeFree).toBe(4500);
  });
  it('out of range without zone', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 50000, destination: dest, zones: [], option: standard, subtotal: 0, at: quiet });
    expect(r.serviceable).toBe(false);
    expect(r.reason).toBe('out_of_range');
  });
  const zone: ZoneRule = { id: 'z1', name: 'Masaki', ring: [[39.2, -6.8], [39.3, -6.8], [39.3, -6.7], [39.2, -6.7], [39.2, -6.8]], flatFee: 3000, surcharge: 500, serviceable: true, priority: 1 };
  it('zone flat fee + surcharge override', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 4500, destination: dest, zones: [zone], option: standard, subtotal: 0, at: quiet });
    expect(r.zone?.id).toBe('z1');
    expect(r.fee).toBe(3500);
  });
  it('non-serviceable zone blocks delivery', () => {
    const r = computeDeliveryFee({ settings, distanceMeters: 4500, destination: dest, zones: [{ ...zone, serviceable: false }], option: standard, subtotal: 0, at: quiet });
    expect(r.serviceable).toBe(false);
    expect(r.reason).toBe('zone_not_serviceable');
  });
});

describe('computeRiderEarning', () => {
  it('formula and minimum', () => {
    expect(computeRiderEarning(settings, 5000, 0)).toBe(1500 + 2000);
    expect(computeRiderEarning(settings, 100, 0)).toBe(2000);
  });
  it('share of fee', () => {
    const s = { ...settings, riderEarning: { ...settings.riderEarning, shareOfFeeBps: 7000 } };
    expect(computeRiderEarning(s, 5000, 10000)).toBe(7000);
  });
});

function roundish(n: number) { return Math.round(n / 100) * 100; }
