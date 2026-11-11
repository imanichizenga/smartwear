import { z } from 'zod';
import { pointInPolygon, type LatLng } from '../utils/geo';

export const DeliveryOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameSw: z.string().optional(),
  description: z.string().optional(),
  kind: z.enum(['express', 'standard', 'pickup']),
  enabled: z.boolean().default(true),
  /** Multiplier on the computed distance fee (pickup ignores it and is free). */
  feeMultiplier: z.number().min(0).default(1),
  /** Fixed surcharge added after multiplier. */
  surcharge: z.number().int().min(0).default(0),
  etaMinMinutes: z.number().int().min(0),
  etaMaxMinutes: z.number().int().min(0),
  sortOrder: z.number().int().default(0),
});
export type DeliveryOption = z.infer<typeof DeliveryOptionSchema>;

export const PeakWindowSchema = z.object({
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  days: z.array(z.number().int().min(0).max(6)).default([]),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  multiplier: z.number().min(1).max(5),
});

export const DeliveryPricingSettingsSchema = z.object({
  currency: z.string().length(3).default('TZS'),
  baseFee: z.number().int().min(0).default(2000),
  perKm: z.number().int().min(0).default(700),
  minimumFee: z.number().int().min(0).default(2500),
  /** Subtotal at/above which delivery is free (null = never). */
  freeDeliveryThreshold: z.number().int().min(0).nullable().default(null),
  /** Round fee to this step, e.g. 100 or 500. */
  roundTo: z.number().int().min(1).default(100),
  /** First N metres are included in the base fee. */
  includedMeters: z.number().int().min(0).default(1000),
  maxDistanceMeters: z.number().int().min(1000).default(35000),
  peakWindows: z.array(PeakWindowSchema).default([]),
  options: z.array(DeliveryOptionSchema).default([
    { id: 'express', name: 'Express', nameSw: 'Haraka', kind: 'express', enabled: true, feeMultiplier: 1.5, surcharge: 0, etaMinMinutes: 25, etaMaxMinutes: 45, sortOrder: 0 },
    { id: 'standard', name: 'Standard', nameSw: 'Kawaida', kind: 'standard', enabled: true, feeMultiplier: 1, surcharge: 0, etaMinMinutes: 60, etaMaxMinutes: 120, sortOrder: 1 },
    { id: 'pickup', name: 'Store pickup', nameSw: 'Chukua dukani', kind: 'pickup', enabled: true, feeMultiplier: 0, surcharge: 0, etaMinMinutes: 30, etaMaxMinutes: 90, sortOrder: 2 },
  ]),
  /** Rider earnings — configured separately from the customer fee. */
  riderEarning: z.object({
    baseFee: z.number().int().min(0).default(1500),
    perKm: z.number().int().min(0).default(400),
    minimum: z.number().int().min(0).default(2000),
    /** Or a share of the customer delivery fee, in bps; used if > 0. */
    shareOfFeeBps: z.number().int().min(0).max(10000).default(0),
  }).default({ baseFee: 1500, perKm: 400, minimum: 2000, shareOfFeeBps: 0 }),
});
export type DeliveryPricingSettings = z.infer<typeof DeliveryPricingSettingsSchema>;

export interface ZoneRule {
  id: string;
  name: string;
  /** GeoJSON polygon ring: [lng, lat][] */
  ring: [number, number][];
  /** Flat fee override (minor units) or null to use the formula. */
  flatFee: number | null;
  /** Additional surcharge applied on top of formula/flat. */
  surcharge: number;
  /** Whether delivery is allowed at all inside this zone. */
  serviceable: boolean;
  priority: number;
}

export interface FeeBreakdown {
  distanceMeters: number;
  billableMeters: number;
  baseFee: number;
  distanceFee: number;
  zoneFee: number | null;
  zoneSurcharge: number;
  peakMultiplier: number;
  optionMultiplier: number;
  optionSurcharge: number;
  subtotalBeforeFree: number;
  freeDelivery: boolean;
  fee: number;
  zone: { id: string; name: string } | null;
  serviceable: boolean;
  reason?: 'out_of_range' | 'zone_not_serviceable';
}

export function roundTo(n: number, step: number): number {
  return step <= 1 ? Math.round(n) : Math.round(n / step) * step;
}

export function peakMultiplier(settings: DeliveryPricingSettings, at: Date): number {
  const day = at.getDay();
  const hour = at.getHours() + at.getMinutes() / 60;
  let m = 1;
  for (const w of settings.peakWindows) {
    const dayOk = w.days.length === 0 || w.days.includes(day);
    if (dayOk && hour >= w.startHour && hour < w.endHour) m = Math.max(m, w.multiplier);
  }
  return m;
}

export function matchZone(point: LatLng, zones: ZoneRule[]): ZoneRule | null {
  const hits = zones.filter((z) => pointInPolygon(point, z.ring)).sort((a, b) => b.priority - a.priority);
  return hits[0] ?? null;
}

export function computeDeliveryFee(input: {
  settings: DeliveryPricingSettings;
  distanceMeters: number;
  destination: LatLng;
  zones: ZoneRule[];
  option: DeliveryOption;
  subtotal: number;
  at?: Date;
}): FeeBreakdown {
  const { settings, distanceMeters, destination, zones, option, subtotal } = input;
  const at = input.at ?? new Date();
  const zone = matchZone(destination, zones);
  const empty = (serviceable: boolean, reason?: FeeBreakdown['reason']): FeeBreakdown => ({
    distanceMeters, billableMeters: 0, baseFee: 0, distanceFee: 0, zoneFee: null, zoneSurcharge: 0, peakMultiplier: 1, optionMultiplier: option.feeMultiplier, optionSurcharge: option.surcharge,
    subtotalBeforeFree: 0, freeDelivery: false, fee: 0, zone: zone ? { id: zone.id, name: zone.name } : null, serviceable, reason,
  });

  if (option.kind === 'pickup') return { ...empty(true), fee: 0 };
  if (zone && !zone.serviceable) return empty(false, 'zone_not_serviceable');
  if (!zone && distanceMeters > settings.maxDistanceMeters) return empty(false, 'out_of_range');

  const billableMeters = Math.max(0, distanceMeters - settings.includedMeters);
  const baseFee = settings.baseFee;
  const distanceFee = Math.round((billableMeters / 1000) * settings.perKm);
  const formula = Math.max(settings.minimumFee, baseFee + distanceFee);
  const zoneFee = zone?.flatFee ?? null;
  const core = zoneFee ?? formula;
  const zoneSurcharge = zone?.surcharge ?? 0;
  const pm = peakMultiplier(settings, at);
  let fee = (core + zoneSurcharge) * pm * option.feeMultiplier + option.surcharge;
  fee = roundTo(fee, settings.roundTo);
  const subtotalBeforeFree = fee;
  const freeDelivery = settings.freeDeliveryThreshold != null && subtotal >= settings.freeDeliveryThreshold;
  if (freeDelivery) fee = 0;
  return { distanceMeters, billableMeters, baseFee, distanceFee, zoneFee, zoneSurcharge, peakMultiplier: pm, optionMultiplier: option.feeMultiplier, optionSurcharge: option.surcharge, subtotalBeforeFree, freeDelivery, fee, zone: zone ? { id: zone.id, name: zone.name } : null, serviceable: true };
}

export function computeRiderEarning(settings: DeliveryPricingSettings, distanceMeters: number, customerFee: number): number {
  const r = settings.riderEarning;
  if (r.shareOfFeeBps > 0) return Math.max(r.minimum, Math.round((customerFee * r.shareOfFeeBps) / 10000));
  return Math.max(r.minimum, r.baseFee + Math.round((distanceMeters / 1000) * r.perKm));
}

/** ETA window text helper (pure; the UI localises the words). */
export function etaWindow(option: DeliveryOption, routeMinutes: number | null, prepMinutes: number): { minMinutes: number; maxMinutes: number } {
  if (option.kind === 'pickup') return { minMinutes: option.etaMinMinutes, maxMinutes: option.etaMaxMinutes };
  const travel = routeMinutes ?? option.etaMinMinutes;
  const min = Math.max(option.etaMinMinutes, Math.round(prepMinutes + travel));
  const max = Math.max(option.etaMaxMinutes, Math.round(prepMinutes + travel * 1.4 + 10));
  return { minMinutes: min, maxMinutes: max };
}
