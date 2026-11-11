import { z } from 'zod';
import { VEHICLE_TYPES, type VehicleType } from '../enums';

export const DispatchSettingsSchema = z.object({
  mode: z.enum(['auto', 'manual', 'hybrid']).default('auto'),
  /** 'sequential' offers one rider at a time; 'batch' offers to N riders and first to accept wins. */
  strategy: z.enum(['sequential', 'batch']).default('sequential'),
  batchSize: z.number().int().min(1).max(10).default(3),
  offerTimeoutSeconds: z.number().int().min(5).max(120).default(20),
  initialRadiusMeters: z.number().int().min(200).default(2500),
  radiusStepMeters: z.number().int().min(100).default(1500),
  maxRadiusMeters: z.number().int().min(500).default(12000),
  maxRounds: z.number().int().min(1).max(20).default(6),
  maxConcurrentJobsPerRider: z.number().int().min(1).max(5).default(1),
  eligibleVehicleTypes: z.array(z.enum(VEHICLE_TYPES)).default(['MOTORBIKE', 'BICYCLE', 'CAR', 'ON_FOOT']),
  heartbeatTtlSeconds: z.number().int().min(10).default(45),
  /** Minutes without a rider before admins get an alert and the client sees options. */
  noRiderAlertMinutes: z.number().int().min(1).default(5),
  /** Rider ranking weights. */
  weights: z.object({ distance: z.number().default(1), rating: z.number().default(0.15), recency: z.number().default(0.05) }).default({ distance: 1, rating: 0.15, recency: 0.05 }),
  deliveryPinEnabled: z.boolean().default(true),
  deliveryPinLength: z.number().int().min(4).max(6).default(4),
  workingHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/).default('07:00'), end: z.string().regex(/^\d{2}:\d{2}$/).default('22:00'), timezone: z.string().default('Africa/Dar_es_Salaam') }).default({ start: '07:00', end: '22:00', timezone: 'Africa/Dar_es_Salaam' }),
});
export type DispatchSettings = z.infer<typeof DispatchSettingsSchema>;

export interface RiderCandidate {
  riderId: string;
  distanceMeters: number;
  rating: number; // 0..5
  activeJobs: number;
  vehicleType: VehicleType;
  lastSeenAt: number; // epoch ms
  declinedJobIds?: string[];
}

export interface RankInput {
  jobId: string;
  candidates: RiderCandidate[];
  settings: DispatchSettings;
  now?: number;
  /** Riders already offered this job (skipped). */
  excludeRiderIds?: string[];
}

/** Filters eligible riders and ranks them — lower score is better. Pure. */
export function rankRiders({ jobId, candidates, settings, now = Date.now(), excludeRiderIds = [] }: RankInput): RiderCandidate[] {
  const w = settings.weights;
  const excluded = new Set(excludeRiderIds);
  return candidates
    .filter((c) => !excluded.has(c.riderId))
    .filter((c) => settings.eligibleVehicleTypes.includes(c.vehicleType))
    .filter((c) => c.activeJobs < settings.maxConcurrentJobsPerRider)
    .filter((c) => now - c.lastSeenAt <= settings.heartbeatTtlSeconds * 1000)
    .filter((c) => !c.declinedJobIds?.includes(jobId))
    .map((c) => {
      const km = c.distanceMeters / 1000;
      const ratingPenalty = (5 - Math.min(5, Math.max(0, c.rating))) * w.rating;
      const recencyPenalty = ((now - c.lastSeenAt) / 1000 / 10) * w.recency;
      return { c, score: km * w.distance + ratingPenalty + recencyPenalty };
    })
    .sort((a, b) => a.score - b.score || a.c.distanceMeters - b.c.distanceMeters)
    .map((x) => x.c);
}

/** Radius for a given dispatch round (0-based). */
export function radiusForRound(settings: DispatchSettings, round: number): number {
  return Math.min(settings.maxRadiusMeters, settings.initialRadiusMeters + round * settings.radiusStepMeters);
}

export function generateDeliveryPin(length: number, random: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < length; i++) s += Math.floor(random() * 10).toString();
  return s;
}

export function isWithinWorkingHours(settings: DispatchSettings, at: Date): boolean {
  const fmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: settings.workingHours.timezone });
  const [h, m] = fmt.format(at).split(':').map(Number);
  const cur = (h ?? 0) * 60 + (m ?? 0);
  const [sh, sm] = settings.workingHours.start.split(':').map(Number);
  const [eh, em] = settings.workingHours.end.split(':').map(Number);
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  const end = (eh ?? 0) * 60 + (em ?? 0);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}
