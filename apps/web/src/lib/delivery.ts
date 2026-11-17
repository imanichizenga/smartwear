'use client';

import { useSyncExternalStore } from 'react';
import { api } from './api';
import { toLatLng, type LatLng } from './geo';
import { flag, list, str, strN, type Json } from './json';

export type PointSource = 'gps' | 'saved' | 'search' | 'map';
export type LocPermission = 'unknown' | 'granted' | 'denied' | 'prompt' | 'unsupported';
export interface DeliveryPoint {
  point: LatLng;
  label?: string | null;
  area?: string | null;
  landmark?: string | null;
  source: PointSource;
  accuracy?: number | null;
  placeId?: string | null;
}
export interface DeliveryState {
  point: DeliveryPoint | null;
  permission: LocPermission;
  locating: boolean;
}

let state: DeliveryState = { point: null, permission: 'unknown', locating: false };
const subs = new Set<() => void>();
const set = (s: Partial<DeliveryState>) => {
  state = { ...state, ...s };
  subs.forEach((f) => f());
};
export const getDelivery = () => state;
export function useDelivery() {
  return useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => state, () => state);
}

export async function permissionState(): Promise<LocPermission> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported';
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (!p) return 'unknown';
    return p.state === 'granted' ? 'granted' : p.state === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'unknown';
  }
}

function fix(highAccuracy: boolean, timeout: number, maximumAge: number): Promise<GeolocationPosition> {
  return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: highAccuracy, timeout, maximumAge }));
}

async function label(p: DeliveryPoint) {
  try {
    const r = await api.get<Json>('/maps/reverse', { lat: p.point.lat, lng: p.point.lng });
    if (state.point?.point === p.point) set({ point: { ...p, label: strN(r, 'address'), area: strN(r, 'area') } });
  } catch {
    /* maps not configured / offline: the pin is still exact */
  }
}

/** Coarse fix first (cached, instant), refined to high accuracy; labels come from reverse geocoding. */
export async function locate(): Promise<boolean> {
  if (!navigator.geolocation) {
    set({ permission: 'unsupported' });
    return false;
  }
  set({ locating: true });
  let got = false;
  try {
    const coarse = await fix(false, 4000, 5 * 60_000).catch(() => null);
    if (coarse) {
      got = true;
      set({ permission: 'granted', point: { point: { lat: coarse.coords.latitude, lng: coarse.coords.longitude }, accuracy: coarse.coords.accuracy, source: 'gps' } });
    }
    const precise = await fix(true, 12_000, 0).catch((e: GeolocationPositionError) => {
      if (e?.code === 1) set({ permission: 'denied' });
      return null;
    });
    if (precise) {
      got = true;
      set({ permission: 'granted', point: { point: { lat: precise.coords.latitude, lng: precise.coords.longitude }, accuracy: precise.coords.accuracy, source: 'gps' } });
    }
  } finally {
    set({ locating: false });
  }
  if (state.point && state.point.source === 'gps') void label(state.point);
  return got;
}

/** Silent start: with permission already granted take a fix; otherwise start from the default saved place. */
export async function initDelivery(signedIn: boolean) {
  if (state.point) return;
  const perm = await permissionState();
  set({ permission: perm });
  if (perm === 'granted') {
    void locate();
    return;
  }
  if (!signedIn) return;
  try {
    const places = await api.get<Json>('/me/places');
    const d = list(places, 'saved').find((x) => flag(x, 'isDefault'));
    const at = d ? toLatLng(d.location) : null;
    if (d && at && !state.point) set({ point: { point: at, label: str(d, 'address'), area: strN(d, 'area') ?? strN(d, 'label'), landmark: strN(d, 'landmarkNote'), source: 'saved' } });
  } catch {
    /* offline / signed out: the shopper picks a place */
  }
}

export function setPoint(p: DeliveryPoint) {
  set({ point: p });
  if (!p.label) void label(p);
}
