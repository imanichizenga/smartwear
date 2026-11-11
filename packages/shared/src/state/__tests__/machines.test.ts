import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, DELIVERY_JOB_STATUSES } from '../../enums';
import { assertDeliveryTransition, assertOrderTransition, canTransitionOrder, DELIVERY_TRANSITIONS, InvalidTransitionError, ORDER_TRANSITIONS } from '../machines';

describe('order state machine', () => {
  it('happy path', () => {
    const path = ['PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED', 'DELIVERED'] as const;
    const actors = ['system', 'admin', 'admin', 'system', 'rider', 'rider', 'rider', 'rider'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(() => assertOrderTransition(path[i]!, path[i + 1]!, actors[i]!)).not.toThrow();
  });
  it('customers cannot mark delivered; riders cannot refund', () => {
    expect(canTransitionOrder('ARRIVED', 'DELIVERED', 'customer')).toBe(false);
    expect(() => assertOrderTransition('DELIVERED', 'REFUNDED', 'rider')).toThrow(InvalidTransitionError);
  });
  it('every status is defined in the table and terminal states have no exits except refund', () => {
    for (const s of ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toBeDefined();
    expect(Object.keys(ORDER_TRANSITIONS.REFUNDED)).toHaveLength(0);
  });
});

describe('delivery state machine', () => {
  it('every status defined', () => {
    for (const s of DELIVERY_JOB_STATUSES) expect(DELIVERY_TRANSITIONS[s]).toBeDefined();
  });
  it('rider cancel re-dispatches via SEARCHING', () => {
    expect(() => assertDeliveryTransition('ACCEPTED', 'SEARCHING', 'rider')).not.toThrow();
    expect(() => assertDeliveryTransition('EN_ROUTE', 'SEARCHING', 'rider')).toThrow();
  });
});
