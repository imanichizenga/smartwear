export interface LatLng { lat: number; lng: number }

export function toLatLng(j: unknown): LatLng | null {
  if (!j || typeof j !== 'object') return null;
  const { lat, lng } = j as Record<string, unknown>;
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

/** Google encoded polyline (precision 5) → points. */
export function decodePolyline(encoded?: string | null): LatLng[] {
  if (!encoded) return [];
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (let axis = 0; axis < 2; axis++) {
      let shift = 0, result = 0, b = 0;
      do {
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < encoded.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d;
      else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

const rad = (d: number) => (d * Math.PI) / 180;
export function distanceMeters(a: LatLng, b: LatLng): number {
  const r = 6371000, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
export function fmtDistance(m?: number | null): string {
  if (m == null) return '—';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
export const etaMinutes = (s?: number | null) => (s == null ? 0 : Math.max(1, Math.round(s / 60)));

/** Dar es Salaam city centre — map fallback when nothing else is known. */
export const DAR: LatLng = { lat: -6.7924, lng: 39.2083 };
