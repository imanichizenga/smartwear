import type { DeliveryJobStatus, OrderStatus } from '../enums';

/**
 * Explicit state machines. Every transition is enforced on the server with timestamps + actor.
 */
export type Actor = 'customer' | 'rider' | 'admin' | 'system';

export const ORDER_TRANSITIONS: Record<OrderStatus, Partial<Record<OrderStatus, Actor[]>>> = {
  PENDING_PAYMENT: { CONFIRMED: ['system', 'admin'], CANCELLED: ['customer', 'admin', 'system'], FAILED: ['system'] },
  CONFIRMED: { PREPARING: ['admin', 'system'], CANCELLED: ['customer', 'admin', 'system'] },
  PREPARING: { READY_FOR_PICKUP: ['admin', 'system'], ASSIGNED: ['system', 'admin'], CANCELLED: ['admin', 'system'] },
  READY_FOR_PICKUP: { ASSIGNED: ['system', 'admin'], PICKED_UP: ['rider', 'admin'], DELIVERED: ['admin'], CANCELLED: ['admin', 'system'] },
  ASSIGNED: { PICKED_UP: ['rider', 'admin'], READY_FOR_PICKUP: ['system', 'admin'], PREPARING: ['system', 'admin'], CANCELLED: ['admin', 'system'] },
  PICKED_UP: { ON_THE_WAY: ['rider', 'admin', 'system'], CANCELLED: ['admin'] },
  ON_THE_WAY: { ARRIVED: ['rider', 'admin'], CANCELLED: ['admin'] },
  ARRIVED: { DELIVERED: ['rider', 'admin'], ON_THE_WAY: ['rider'], CANCELLED: ['admin'] },
  DELIVERED: { REFUNDED: ['admin'] },
  CANCELLED: { REFUNDED: ['admin', 'system'] },
  REFUNDED: {},
  FAILED: { PENDING_PAYMENT: ['customer', 'system'], CANCELLED: ['admin', 'system'] },
};

export const DELIVERY_TRANSITIONS: Record<DeliveryJobStatus, Partial<Record<DeliveryJobStatus, Actor[]>>> = {
  SEARCHING: { OFFERED: ['system'], ACCEPTED: ['admin'], NO_RIDER: ['system'], CANCELLED: ['admin', 'system'] },
  OFFERED: { ACCEPTED: ['rider', 'admin'], SEARCHING: ['system', 'admin'], NO_RIDER: ['system'], CANCELLED: ['admin', 'system'] },
  ACCEPTED: { AT_STORE: ['rider', 'admin'], SEARCHING: ['rider', 'admin', 'system'], CANCELLED: ['admin', 'system'] },
  AT_STORE: { PICKED_UP: ['rider', 'admin'], SEARCHING: ['admin', 'system'], CANCELLED: ['admin', 'system'] },
  PICKED_UP: { EN_ROUTE: ['rider', 'admin', 'system'], CANCELLED: ['admin'] },
  EN_ROUTE: { ARRIVED: ['rider', 'admin'], CANCELLED: ['admin'] },
  ARRIVED: { COMPLETED: ['rider', 'admin'], EN_ROUTE: ['rider'], CANCELLED: ['admin'] },
  COMPLETED: {},
  CANCELLED: {},
  NO_RIDER: { SEARCHING: ['admin', 'system', 'customer'], CANCELLED: ['admin', 'customer', 'system'] },
};

export class InvalidTransitionError extends Error {
  constructor(public readonly machine: 'order' | 'delivery', public readonly from: string, public readonly to: string, public readonly actor: Actor) {
    super(`${machine}: ${from} → ${to} not allowed for ${actor}`);
    this.name = 'InvalidTransitionError';
  }
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: Actor): boolean {
  return ORDER_TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}
export function assertOrderTransition(from: OrderStatus, to: OrderStatus, actor: Actor): void {
  if (!canTransitionOrder(from, to, actor)) throw new InvalidTransitionError('order', from, to, actor);
}
export function canTransitionDelivery(from: DeliveryJobStatus, to: DeliveryJobStatus, actor: Actor): boolean {
  return DELIVERY_TRANSITIONS[from]?.[to]?.includes(actor) ?? false;
}
export function assertDeliveryTransition(from: DeliveryJobStatus, to: DeliveryJobStatus, actor: Actor): void {
  if (!canTransitionDelivery(from, to, actor)) throw new InvalidTransitionError('delivery', from, to, actor);
}

/** Maps a delivery job status to the order status that should accompany it (null = no change). */
export const DELIVERY_TO_ORDER: Partial<Record<DeliveryJobStatus, OrderStatus>> = {
  ACCEPTED: 'ASSIGNED',
  PICKED_UP: 'PICKED_UP',
  EN_ROUTE: 'ON_THE_WAY',
  ARRIVED: 'ARRIVED',
  COMPLETED: 'DELIVERED',
};

export const ORDER_ACTIVE_STATUSES: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'];
export const ORDER_TERMINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'CANCELLED', 'REFUNDED', 'FAILED'];
export const DELIVERY_ACTIVE_STATUSES: DeliveryJobStatus[] = ['SEARCHING', 'OFFERED', 'ACCEPTED', 'AT_STORE', 'PICKED_UP', 'EN_ROUTE', 'ARRIVED'];

/** Kanban columns (admin) in display order. */
export const ORDER_KANBAN_COLUMNS: OrderStatus[] = ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'ON_THE_WAY', 'DELIVERED'];
