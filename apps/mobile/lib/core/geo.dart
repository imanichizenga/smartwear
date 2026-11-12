import 'dart:math' as math;

/// Plain lat/lng value (the maps layer converts to plugin types at its edge).
class LatLngD {
  const LatLngD(this.lat, this.lng);
  final double lat, lng;

  static LatLngD? fromJson(Object? j) {
    if (j is! Map) return null;
    final lat = j['lat'], lng = j['lng'];
    if (lat is! num || lng is! num) return null;
    return LatLngD(lat.toDouble(), lng.toDouble());
  }

  Map<String, double> toJson() => {'lat': lat, 'lng': lng};
  LatLngD lerp(LatLngD b, double t) => LatLngD(lat + (b.lat - lat) * t, lng + (b.lng - lng) * t);

  @override
  bool operator ==(Object o) => o is LatLngD && o.lat == lat && o.lng == lng;
  @override
  int get hashCode => Object.hash(lat, lng);
}

/// Google encoded polyline (precision 5) → points.
List<LatLngD> decodePolyline(String? encoded) {
  if (encoded == null || encoded.isEmpty) return const [];
  final out = <LatLngD>[];
  var i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (var axis = 0; axis < 2; axis++) {
      var shift = 0, result = 0, b = 0;
      do {
        b = encoded.codeUnitAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < encoded.length);
      final d = (result & 1) != 0 ? ~(result >> 1) : result >> 1;
      if (axis == 0) {
        lat += d;
      } else {
        lng += d;
      }
    }
    out.add(LatLngD(lat / 1e5, lng / 1e5));
  }
  return out;
}

double _rad(double d) => d * math.pi / 180;

double distanceMeters(LatLngD a, LatLngD b) {
  const r = 6371000.0;
  final dLat = _rad(b.lat - a.lat), dLng = _rad(b.lng - a.lng);
  final h = math.pow(math.sin(dLat / 2), 2) + math.cos(_rad(a.lat)) * math.cos(_rad(b.lat)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * r * math.asin(math.sqrt(h.toDouble()));
}

double bearingDeg(LatLngD a, LatLngD b) {
  final y = math.sin(_rad(b.lng - a.lng)) * math.cos(_rad(b.lat));
  final x = math.cos(_rad(a.lat)) * math.sin(_rad(b.lat)) - math.sin(_rad(a.lat)) * math.cos(_rad(b.lat)) * math.cos(_rad(b.lng - a.lng));
  return (math.atan2(y, x) * 180 / math.pi + 360) % 360;
}

/// Shortest-way heading interpolation (350° → 10° turns 20°).
double lerpAngle(double a, double b, double t) {
  final d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

String fmtDistance(num? m) {
  if (m == null) return '—';
  if (m < 1000) return '${(m / 10).round() * 10} m';
  return '${(m / 1000).toStringAsFixed(m < 10000 ? 1 : 0)} km';
}

int etaMinutes(num? seconds) => seconds == null ? 0 : math.max(1, (seconds / 60).round());

/// Dar es Salaam city centre — map fallback when nothing else is known.
const darEsSalaam = LatLngD(-6.7924, 39.2083);
