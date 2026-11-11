/**
 * Default Google Maps JSON styles — minimal monochrome / soft silver, with a dark variant.
 * Stored in settings (`maps.google.mapStyleLight/Dark`) on first boot; admins may edit them.
 */
export const DEFAULT_MAP_STYLE_LIGHT: Record<string, unknown>[] = [
  { elementType: 'geometry', stylers: [{ color: '#f3f1ec' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6e6a64' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#faf8f4' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#9a958d' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e8e9e1' }, { visibility: 'on' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e9e4dc' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#8a857d' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f6f3ee' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e3ddd3' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#d9dee0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8f9a9e' }] },
];

export const DEFAULT_MAP_STYLE_DARK: Record<string, unknown>[] = [
  { elementType: 'geometry', stylers: [{ color: '#151518' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a29d95' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e0e10' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1a1d1a' }, { visibility: 'on' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#232327' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2a2a2e' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#75716a' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2c2c31' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#36363b' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0f14' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4f5a63' }] },
];
