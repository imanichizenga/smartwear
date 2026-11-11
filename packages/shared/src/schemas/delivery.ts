import { z } from 'zod';
import { IdSchema, LatLngSchema, MediaOutSchema, pageOf } from './common';
import { DELIVERY_JOB_STATUSES, RIDER_PRESENCE, RIDER_STATUSES, VEHICLE_TYPES } from '../enums';

// ---------- Places / maps (proxied) ----------
export const PlacesAutocompleteQuerySchema = z.object({ input: z.string().min(1).max(200), sessionToken: z.string().min(8).max(64), lat: z.coerce.number().optional(), lng: z.coerce.number().optional(), lang: z.string().max(10).optional() });
export const PlaceSuggestionSchema = z.object({ placeId: z.string(), mainText: z.string(), secondaryText: z.string().nullable(), fullText: z.string(), matches: z.array(z.object({ start: z.number().int(), end: z.number().int() })), distanceMeters: z.number().int().nullable(), types: z.array(z.string()) });
export const PlacesAutocompleteResponseSchema = z.object({ suggestions: z.array(PlaceSuggestionSchema) });
export const PlaceDetailsQuerySchema = z.object({ placeId: z.string(), sessionToken: z.string().min(8).max(64).optional() });
export const PlaceDetailsSchema = z.object({ placeId: z.string(), name: z.string().nullable(), address: z.string(), shortAddress: z.string().nullable(), location: LatLngSchema, plusCode: z.string().nullable() });
export const ReverseGeocodeQuerySchema = z.object({ lat: z.coerce.number(), lng: z.coerce.number(), lang: z.string().max(10).optional() });
export const ReverseGeocodeSchema = z.object({ label: z.string(), shortLabel: z.string(), plusCode: z.string().nullable(), components: z.record(z.string(), z.string()) });
export const RouteRequestSchema = z.object({ origin: LatLngSchema, destination: LatLngSchema });
export const RouteSchema = z.object({ distanceMeters: z.number().int(), durationSeconds: z.number().int(), polyline: z.string() });

// ---------- Stores ----------
export const StoreHoursSchema = z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/), closed: z.boolean().default(false) }));
export const StoreOutSchema = z.object({ id: IdSchema, name: z.string(), kind: z.enum(['store', 'warehouse', 'office']), address: z.string(), location: LatLngSchema, phone: z.string().nullable(), hours: StoreHoursSchema, serviceRadiusMeters: z.number().int(), active: z.boolean(), isOpenNow: z.boolean().optional() });
export const StoreInputSchema = StoreOutSchema.omit({ id: true, isOpenNow: true }).extend({ placeId: z.string().nullable().optional() });

// ---------- Zones ----------
export const ZoneOutSchema = z.object({ id: IdSchema, name: z.string(), ring: z.array(z.tuple([z.number(), z.number()])), flatFee: z.number().int().nullable(), surcharge: z.number().int(), serviceable: z.boolean(), priority: z.number().int(), color: z.string().nullable() });
export const ZoneInputSchema = ZoneOutSchema.omit({ id: true });

// ---------- Riders ----------
export const RiderDocumentSchema = z.object({ id: IdSchema.optional(), type: z.enum(['national_id', 'licence', 'insurance', 'vehicle_registration', 'other']), number: z.string().max(60).nullable().optional(), mediaId: IdSchema.nullable().optional(), expiresAt: z.string().nullable().optional(), verified: z.boolean().default(false) });
export const RiderRegisterSchema = z.object({
  phone: z.string().min(6).max(20), name: z.string().min(2).max(80), photoMediaId: IdSchema.nullable().optional(), email: z.string().email().nullable().optional(),
  nationalId: z.string().min(4).max(40), documents: z.array(RiderDocumentSchema).default([]),
  vehicle: z.object({ type: z.enum(VEHICLE_TYPES), plate: z.string().max(20).nullable().optional(), color: z.string().max(30).nullable().optional(), make: z.string().max(40).nullable().optional() }),
  storeId: IdSchema.nullable().optional(), zoneId: IdSchema.nullable().optional(),
  payout: z.object({ method: z.enum(['mobile_money', 'bank']), accountName: z.string().max(80), accountNumber: z.string().max(60), provider: z.string().max(40).nullable().optional() }).nullable().optional(),
  sendInvite: z.boolean().default(true),
});
export const RiderOutSchema = z.object({
  id: IdSchema, userId: IdSchema, name: z.string(), phone: z.string(), photo: MediaOutSchema.nullable(), status: z.enum(RIDER_STATUSES), presence: z.enum(RIDER_PRESENCE), rating: z.number(), ratingCount: z.number().int(), deliveriesCompleted: z.number().int(), vehicle: z.object({ type: z.enum(VEHICLE_TYPES), plate: z.string().nullable(), color: z.string().nullable(), make: z.string().nullable() }), documents: z.array(RiderDocumentSchema), store: z.object({ id: IdSchema, name: z.string() }).nullable(), lastLocation: LatLngSchema.extend({ bearing: z.number().nullable(), at: z.string() }).nullable(), earningsToday: z.number().int(), activeJobId: IdSchema.nullable(), createdAt: z.string(), inviteSentAt: z.string().nullable(), documentsExpiringSoon: z.boolean(),
});
export const RiderListQuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), status: z.enum(RIDER_STATUSES).optional(), presence: z.enum(RIDER_PRESENCE).optional(), q: z.string().optional() });

export const RiderPresenceSchema = z.object({ online: z.boolean(), location: LatLngSchema.optional(), batteryLevel: z.number().min(0).max(1).optional() });
export const RiderLocationPingSchema = z.object({ lat: z.number(), lng: z.number(), bearing: z.number().nullable().optional(), speed: z.number().nullable().optional(), accuracy: z.number().nullable().optional(), at: z.string().optional(), batteryLevel: z.number().min(0).max(1).optional() });
export const RiderLocationBatchSchema = z.object({ pings: z.array(RiderLocationPingSchema).min(1).max(50) });

export const RiderJobOutSchema = z.object({
  id: IdSchema, orderId: IdSchema, orderNumber: z.string(), status: z.enum(DELIVERY_JOB_STATUSES), store: z.object({ id: IdSchema, name: z.string(), address: z.string(), location: LatLngSchema, phone: z.string().nullable() }), dropoff: z.object({ location: LatLngSchema, address: z.string(), landmark: z.string().nullable(), approximate: z.boolean() }), customer: z.object({ name: z.string(), phoneMasked: z.string().nullable() }).nullable(), distanceToStoreMeters: z.number().int().nullable(), distanceStoreToDropMeters: z.number().int().nullable(), earning: z.number().int(), currency: z.string(), itemCount: z.number().int(), paymentMethod: z.string(), cashToCollect: z.number().int(), offer: z.object({ id: IdSchema, expiresAt: z.string() }).nullable(), routePolyline: z.string().nullable(), etaSeconds: z.number().int().nullable(), pinRequired: z.boolean(), chatThreadId: IdSchema.nullable(), createdAt: z.string(), acceptedAt: z.string().nullable(), completedAt: z.string().nullable(),
});
export type RiderJobOut = z.infer<typeof RiderJobOutSchema>;
export const RiderJobActionSchema = z.object({ action: z.enum(['accept', 'decline', 'arrived_at_store', 'picked_up', 'start_delivery', 'arrived', 'complete', 'cancel']), pin: z.string().optional(), proofMediaId: IdSchema.nullable().optional(), reason: z.string().max(300).optional() });
export const RiderEarningsSchema = z.object({ today: z.number().int(), week: z.number().int(), month: z.number().int(), currency: z.string(), deliveriesToday: z.number().int(), rating: z.number(), history: z.array(z.object({ jobId: IdSchema, orderNumber: z.string(), earning: z.number().int(), distanceMeters: z.number().int(), completedAt: z.string() })) });

// ---------- Dispatch (admin) ----------
export const DispatchSnapshotSchema = z.object({
  stores: z.array(StoreOutSchema),
  riders: z.array(RiderOutSchema.pick({ id: true, name: true, presence: true, vehicle: true, rating: true, activeJobId: true, lastLocation: true, photo: true })),
  jobs: z.array(z.object({ id: IdSchema, orderId: IdSchema, orderNumber: z.string(), status: z.enum(DELIVERY_JOB_STATUSES), storeId: IdSchema, dropoff: LatLngSchema, riderId: IdSchema.nullable(), createdAt: z.string(), waitingSeconds: z.number().int(), total: z.number().int(), customerName: z.string(), stuck: z.boolean(), etaSeconds: z.number().int().nullable(), routePolyline: z.string().nullable() })),
  generatedAt: z.string(),
});
export const DispatchAssignSchema = z.object({ jobId: IdSchema, riderId: IdSchema.nullable(), force: z.boolean().default(false) });
export const RiderRouteReplaySchema = z.object({ jobId: IdSchema.nullable(), points: z.array(LatLngSchema.extend({ at: z.string(), bearing: z.number().nullable(), speed: z.number().nullable() })) });
export const RiderJobListSchema = pageOf(RiderJobOutSchema);
