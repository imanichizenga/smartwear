import type { Tone } from '@/components/ui/primitives';
import type { MediaOut } from './types';
import type { LatLng } from './geo';

export type OrderStatus =
  | 'PENDING_PAYMENT' | 'CONFIRMED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'ASSIGNED' | 'PICKED_UP' | 'ON_THE_WAY' | 'ARRIVED' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED' | 'FAILED';
export type JobStatus = 'SEARCHING' | 'OFFERED' | 'ACCEPTED' | 'AT_STORE' | 'PICKED_UP' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_RIDER';
export type Presence = 'OFFLINE' | 'IDLE' | 'ASSIGNED' | 'EN_ROUTE';

export interface Sla {
  level: 'ok' | 'warning' | 'danger';
  label: string | null;
}

export interface OrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  placedAt: string;
  customer: { id: string; name: string; phone: string; type: string };
  store: string;
  total: number;
  currency: string;
  items: number;
  payment: { method: string; status: string };
  fulfilment: 'delivery' | 'pickup';
  area: string | null;
  delivery: { status: JobStatus; rider: string | null } | null;
  sla: Sla;
  promisedBy: string | null;
  ready: boolean;
}

export interface RiderPublic {
  id: string;
  name: string;
  firstName: string;
  photo: MediaOut | null;
  rating: number;
  deliveries: number;
  vehicle: { type: string; plate: string; color: string; make: string } | null;
  phone?: string;
}

export interface OrderDetail {
  id: string;
  number: string;
  status: OrderStatus;
  statusLabel: string;
  placedAt: string;
  currency: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  tax: number;
  total: number;
  savings: number;
  promoCode: string | null;
  fulfilment: 'delivery' | 'pickup';
  deliveryOption: { id: string; kind: string; name: string; etaMinMinutes: number; etaMaxMinutes: number } | null;
  store: { id: string; name: string; address: string; location: LatLng; phone: string | null };
  destination: { location: LatLng; label: string; area: string | null; landmark: string | null } | null;
  eta: { minMinutes: number | null; maxMinutes: number | null; promisedBy: string | null; liveSeconds: number | null };
  payment: { method: string; status: string; checkoutUrl: string | null };
  items: { id: number; productId: string | null; title: string; brand: string | null; options: string; sku: string; image: MediaOut | null; qty: number; unitPrice: number; retailUnitPrice: number; basis: string; tier: { minQty: number } | null; lineTotal: number; savings: number }[];
  delivery: {
    status: JobStatus;
    rider: RiderPublic | null;
    riderLocation: (LatLng & { heading: number | null; at: string | null }) | null;
    route: string | null;
    routeLeg: string | null;
    distanceMeters: number | null;
    searchingSince: string | null;
    timeline: Record<'accepted' | 'at_store' | 'picked_up' | 'en_route' | 'arrived' | 'completed', string | null>;
  } | null;
  pin: string | null;
  customer: { id: string; name: string; phone: string; email: string | null; customerType: string };
  contact: { name: string; phone: string };
  extraFields: Record<string, string>;
  feeBreakdown: Record<string, unknown>;
  adminNotes: string;
  cancelReason: string | null;
  events: { type: string; from: string | null; to: string | null; actor: string; actorId: string; data: Record<string, unknown>; at: string }[];
  payments: { id: string; method: string; provider: string; status: string; amount: number; reference: string; providerRef: string; paidAt: string | null; refunded: number }[];
  allowedTransitions: OrderStatus[];
  sla: Sla;
}

export interface RiderAdmin {
  id: string;
  userId: string;
  name: string;
  phone: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
  presence: Presence;
  photo: MediaOut | null;
  rating: number;
  ratingCount: number;
  deliveries: number;
  vehicle: { type: string; plate: string; color: string; make: string } | null;
  zone: { id: string; name: string } | null;
  homeStore: { id: string; name: string } | null;
  location: (LatLng & { heading: number | null; at: string | null }) | null;
  documentAlerts: { kind: string; expiresAt: string; expired: boolean }[];
  invitedAt: string | null;
  approvedAt: string | null;
  signedIn: boolean;
}

export interface DispatchJob {
  jobId: string;
  orderId: string;
  number: string;
  status: JobStatus;
  orderStatus: OrderStatus;
  placedAt: string;
  store: { id: string; name: string };
  dropoff: LatLng & { area: string };
  rider: { id: string; name: string } | null;
  etaSeconds: number | null;
  route: string | null;
  searchingSince: string | null;
  ready: boolean;
  sla: Sla;
  total: number;
  items: number;
  pendingOffers: number;
}
export interface DispatchStore {
  id: string;
  name: string;
  code: string;
  location: LatLng;
  kind: string;
}
export interface Zone {
  id: string;
  name: string;
  polygon: [number, number][];
  flatFee: number | null;
  surcharge: number;
  serviceable: boolean;
  priority: number;
  color: string;
  isActive: boolean;
}
export interface DispatchBoard {
  mode: 'auto' | 'manual' | 'hybrid';
  stores: DispatchStore[];
  riders: RiderAdmin[];
  jobs: DispatchJob[];
  zones: Zone[];
}

const ORDER_TONE: Record<OrderStatus, Tone> = {
  PENDING_PAYMENT: 'warning', CONFIRMED: 'info', PREPARING: 'accent', READY_FOR_PICKUP: 'accent', ASSIGNED: 'ink', PICKED_UP: 'ink', ON_THE_WAY: 'ink', ARRIVED: 'ink',
  DELIVERED: 'success', CANCELLED: 'neutral', REFUNDED: 'neutral', FAILED: 'danger',
};
export const orderTone = (s: string): Tone => ORDER_TONE[s as OrderStatus] ?? 'neutral';

const JOB_LABEL: Record<JobStatus, string> = {
  SEARCHING: 'Finding rider', OFFERED: 'Offer out', ACCEPTED: 'To store', AT_STORE: 'At store', PICKED_UP: 'Picked up', EN_ROUTE: 'On the way', ARRIVED: 'Arrived', COMPLETED: 'Delivered', CANCELLED: 'Cancelled', NO_RIDER: 'No rider',
};
export const jobLabel = (s: string) => JOB_LABEL[s as JobStatus] ?? s;
export const jobTone = (s: string): Tone => (s === 'NO_RIDER' ? 'danger' : s === 'SEARCHING' || s === 'OFFERED' ? 'warning' : s === 'COMPLETED' ? 'success' : s === 'CANCELLED' ? 'neutral' : 'ink');

export const presenceState = (p: Presence) => (p === 'IDLE' ? 'idle' : p === 'ASSIGNED' ? 'assigned' : p === 'EN_ROUTE' ? 'en_route' : 'offline') as 'idle' | 'assigned' | 'en_route' | 'offline';
export const presenceLabel: Record<Presence, string> = { OFFLINE: 'Offline', IDLE: 'Idle', ASSIGNED: 'Assigned', EN_ROUTE: 'On a delivery' };
export const VEHICLES: Record<string, string> = { MOTORBIKE: 'Motorbike', BICYCLE: 'Bicycle', CAR: 'Car', ON_FOOT: 'On foot' };
export const PAYMENT_LABEL: Record<string, string> = { CASH_ON_DELIVERY: 'Cash on delivery', MOBILE_MONEY: 'Mobile money', CARD: 'Card' };
export const PROVIDER_LABEL: Record<string, string> = { cash: 'Cash', snippe: 'Snippe', beem_checkout: 'Beem Checkout' };
export const paymentTone = (s: string): Tone => (s === 'PAID' ? 'success' : s === 'PENDING' ? 'warning' : s === 'FAILED' ? 'danger' : 'neutral');
