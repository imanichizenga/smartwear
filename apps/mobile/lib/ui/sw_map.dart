import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart' as gm;

import '../core/api.dart';
import '../core/geo.dart';
import '../core/providers.dart';
import '../design/theme.dart';
import 'icons.dart';

/// Native Google Maps unless built with `--dart-define=MAPS_NATIVE=false` (or under test), in
/// which case the branded plan view renders the same markers and routes.
const _nativeMaps = bool.fromEnvironment('MAPS_NATIVE', defaultValue: true);
bool get _useNative => _nativeMaps && Platform.environment['FLUTTER_TEST'] != 'true';

enum PinKind { client, rider, store }

class SwMarker {
  const SwMarker(this.id, this.kind, this.point, {this.heading, this.label});
  final String id;
  final PinKind kind;
  final LatLngD point;
  final double? heading;
  final String? label;
}

class SwRoute {
  const SwRoute(this.id, this.points, {this.dashed = false});
  final String id;
  final List<LatLngD> points;
  final bool dashed;

  /// Identity of the line's shape: a new route (or new endpoints) re-plays the draw-on.
  String get signature => points.isEmpty ? id : '$id:${points.length}:${points.first.lat.toStringAsFixed(4)},${points.first.lng.toStringAsFixed(4)}:${points.last.lat.toStringAsFixed(4)},${points.last.lng.toStringAsFixed(4)}';
}

/// The first [t] (0–1) of a polyline by length — used to "sew" a route onto the map.
List<LatLngD> partialRoute(List<LatLngD> pts, double t) {
  if (t >= 1 || pts.length < 2) return pts;
  if (t <= 0) return [pts.first];
  final seg = [for (var i = 1; i < pts.length; i++) distanceMeters(pts[i - 1], pts[i])];
  final total = seg.fold<double>(0, (a, b) => a + b);
  var left = total * t;
  final out = [pts.first];
  for (var i = 0; i < seg.length; i++) {
    if (left >= seg[i]) {
      out.add(pts[i + 1]);
      left -= seg[i];
    } else {
      out.add(pts[i].lerp(pts[i + 1], seg[i] == 0 ? 0 : left / seg[i]));
      break;
    }
  }
  return out;
}

/// Route motion shared by both renderers: a 900 ms draw-on whenever a route appears or changes,
/// then (plan view) a slow gold "stitch" travelling from rider to client — the A loader's
/// crossbar, echoed on the map. Reduce Motion shows the finished line.
mixin _RouteDrawing<T extends StatefulWidget> on State<T>, TickerProvider {
  late final AnimationController draw = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..addListener(onDraw);
  late final AnimationController stitch = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600));
  String _sig = '';

  void onDraw();

  void syncRoutes(List<SwRoute> routes, {required bool reduce, bool loopStitch = true}) {
    final sig = routes.map((r) => r.signature).join('|');
    if (sig == _sig) return;
    _sig = sig;
    if (reduce || routes.isEmpty) {
      draw.value = 1;
      stitch.stop();
      return;
    }
    draw.forward(from: 0);
    if (loopStitch && routes.any((r) => !r.dashed && r.points.length > 1)) {
      if (!stitch.isAnimating) stitch.repeat();
    } else {
      stitch.stop();
    }
  }

  double get drawT => Curves.easeInOutCubic.transform(draw.value);

  void disposeRoutes() {
    draw.dispose();
    stitch.dispose();
  }
}

/// The one map of the app (checkout, set-on-map, tracking, Rider Mode).
/// * client = black dot with white ring + soft pulsing halo
/// * rider = blue dot with white ring + heading arrow, gliding between fixes
/// * store/office = blue dot with a store glyph
class SwMap extends ConsumerStatefulWidget {
  const SwMap({
    super.key,
    this.markers = const [],
    this.routes = const [],
    this.padding = EdgeInsets.zero,
    this.fitKey,
    this.center,
    this.zoom = 14.5,
    this.interactive = true,
    this.onCameraIdle,
    this.searching = false,
  });

  final List<SwMarker> markers;
  final List<SwRoute> routes;

  /// Space covered by sheets/headers, so fitted content stays visible.
  final EdgeInsets padding;

  /// Changing it re-fits the camera to all markers and routes.
  final Object? fitKey;

  /// Fixed camera centre (set-on-map); with [onCameraIdle] the map reports where it settled.
  final LatLngD? center;
  final double zoom;
  final bool interactive;
  final ValueChanged<LatLngD>? onCameraIdle;

  /// Expanding radius rings around the client dot ("Finding your rider…").
  final bool searching;

  @override
  ConsumerState<SwMap> createState() => _SwMapState();
}

class _SwMapState extends ConsumerState<SwMap> {
  @override
  Widget build(BuildContext context) {
    final map = _useNative ? _NativeMap(widget: widget) : _PlanMap(widget: widget);
    return Stack(fit: StackFit.expand, children: [
      map,
      if (widget.searching) IgnorePointer(child: _SearchRings(padding: widget.padding)),
    ]);
  }
}

/* ================================================================== gliding positions */

/// Eases each rider marker to its latest fix over ~1.2s (heading the short way round), so the blue
/// dot glides along the road instead of jumping every few seconds. Reduce Motion snaps.
class _Glide {
  _Glide(this.pos, this.heading);
  LatLngD pos, from = darEsSalaam, to = darEsSalaam;
  double? heading, fromH, toH;
  double t = 1;

  void retarget(LatLngD p, double? h) {
    if (p == to && h == toH) return;
    from = pos;
    fromH = heading;
    to = p;
    toH = h ?? heading;
    t = 0;
  }

  bool step(double dt, bool reduce) {
    if (t >= 1) return false;
    t = reduce ? 1 : math.min(1, t + dt / 1.2);
    final e = 1 - math.pow(1 - t, 3).toDouble();
    pos = from.lerp(to, e);
    heading = (fromH != null && toH != null) ? lerpAngle(fromH!, toH!, e) : toH;
    return true;
  }
}

mixin _Gliding<T extends StatefulWidget> on State<T>, TickerProvider {
  final Map<String, _Glide> glides = {};
  Ticker? _ticker;
  Duration _last = Duration.zero;

  void syncGlides(List<SwMarker> markers) {
    final ids = <String>{};
    for (final m in markers.where((m) => m.kind == PinKind.rider)) {
      ids.add(m.id);
      final g = glides[m.id];
      if (g == null) {
        glides[m.id] = _Glide(m.point, m.heading)
          ..to = m.point
          ..toH = m.heading;
      } else {
        g.retarget(m.point, m.heading);
      }
    }
    glides.removeWhere((k, _) => !ids.contains(k));
    _ticker ??= createTicker(_tick);
    if (!_ticker!.isActive) {
      _last = Duration.zero;
      _ticker!.start();
    }
  }

  void _tick(Duration now) {
    final dt = _last == Duration.zero ? 0.016 : (now - _last).inMicroseconds / 1e6;
    _last = now;
    final reduce = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    var moving = false;
    for (final g in glides.values) {
      moving = g.step(dt, reduce) || moving;
    }
    if (moving) {
      onGlide();
    } else {
      _ticker?.stop();
    }
  }

  void onGlide();

  LatLngD shown(SwMarker m) => m.kind == PinKind.rider ? (glides[m.id]?.pos ?? m.point) : m.point;
  double? shownHeading(SwMarker m) => m.kind == PinKind.rider ? (glides[m.id]?.heading ?? m.heading) : null;

  void disposeGlides() => _ticker?.dispose();
}

/* ================================================================== native Google map */

class _NativeMap extends ConsumerStatefulWidget {
  const _NativeMap({required this.widget});
  final SwMap widget;
  @override
  ConsumerState<_NativeMap> createState() => _NativeMapState();
}

class _NativeMapState extends ConsumerState<_NativeMap> with TickerProviderStateMixin, _Gliding, _RouteDrawing {
  gm.GoogleMapController? _c;
  Object? _fitted;
  final Map<String, gm.BitmapDescriptor> _icons = {};
  LatLngD? _camera;

  SwMap get w => widget.widget;

  @override
  void initState() {
    super.initState();
    syncGlides(w.markers);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Native polylines are re-sent per frame only during the short draw-on (no looping stitch).
    syncRoutes(w.routes, reduce: context.reduceMotion, loopStitch: false);
  }

  @override
  void didUpdateWidget(covariant _NativeMap old) {
    super.didUpdateWidget(old);
    syncGlides(w.markers);
    syncRoutes(w.routes, reduce: context.reduceMotion, loopStitch: false);
    if (w.fitKey != _fitted) _fit();
  }

  @override
  void onDraw() => setState(() {});

  @override
  void dispose() {
    disposeGlides();
    disposeRoutes();
    super.dispose();
  }

  @override
  void onGlide() => setState(() {});

  Future<void> _ensureIcons(BuildContext context) async {
    if (_icons.isNotEmpty) return;
    final c = context.sw;
    final dpr = MediaQuery.devicePixelRatioOf(context);
    final entries = await Future.wait([
      _paintPin(PinKind.client, c, dpr).then((b) => MapEntry('client', b)),
      _paintPin(PinKind.rider, c, dpr).then((b) => MapEntry('rider', b)),
      _paintPin(PinKind.store, c, dpr).then((b) => MapEntry('store', b)),
    ]);
    if (!mounted) return;
    setState(() => _icons.addEntries(entries.map((e) => MapEntry(e.key, gm.BitmapDescriptor.bytes(e.value, imagePixelRatio: dpr)))));
  }

  void _fit() {
    final c = _c;
    if (c == null) return;
    _fitted = w.fitKey;
    if (w.center != null) {
      c.moveCamera(gm.CameraUpdate.newLatLngZoom(_ll(w.center!), w.zoom));
      return;
    }
    final pts = [...w.markers.map((m) => m.point), ...w.routes.expand((r) => r.points)];
    if (pts.isEmpty) return;
    if (pts.length == 1) {
      c.animateCamera(gm.CameraUpdate.newLatLngZoom(_ll(pts.first), w.zoom));
      return;
    }
    var s = pts.first.lat, n = s, west = pts.first.lng, e = west;
    for (final p in pts) {
      s = math.min(s, p.lat);
      n = math.max(n, p.lat);
      west = math.min(west, p.lng);
      e = math.max(e, p.lng);
    }
    c.animateCamera(gm.CameraUpdate.newLatLngBounds(gm.LatLngBounds(southwest: gm.LatLng(s, west), northeast: gm.LatLng(n, e)), 56));
  }

  @override
  Widget build(BuildContext context) {
    unawaited(_ensureIcons(context));
    final c = context.sw;
    final cfg = ref.watch(configProvider).value?.obj('maps_google');
    final style = cfg == null ? null : (context.isDark ? cfg['mapStyleDark'] : cfg['mapStyleLight']);
    final start = w.center ?? (w.markers.isNotEmpty ? w.markers.first.point : darEsSalaam);
    return gm.GoogleMap(
      initialCameraPosition: gm.CameraPosition(target: _ll(start), zoom: w.zoom),
      style: style is List && style.isNotEmpty ? jsonEncode(style) : null,
      padding: w.padding,
      myLocationEnabled: false,
      myLocationButtonEnabled: false,
      zoomControlsEnabled: false,
      mapToolbarEnabled: false,
      compassEnabled: false,
      buildingsEnabled: false,
      rotateGesturesEnabled: w.interactive,
      scrollGesturesEnabled: w.interactive,
      zoomGesturesEnabled: w.interactive,
      tiltGesturesEnabled: false,
      onMapCreated: (ctl) {
        _c = ctl;
        _fit();
      },
      onCameraMove: (p) => _camera = LatLngD(p.target.latitude, p.target.longitude),
      onCameraIdle: () {
        if (_camera != null) w.onCameraIdle?.call(_camera!);
      },
      markers: {
        if (_icons.isNotEmpty)
          for (final m in w.markers)
            gm.Marker(
              markerId: gm.MarkerId(m.id),
              position: _ll(shown(m)),
              icon: _icons[m.kind.name]!,
              anchor: const Offset(0.5, 0.5),
              flat: m.kind == PinKind.rider,
              rotation: shownHeading(m) ?? 0,
              zIndexInt: m.kind == PinKind.rider ? 3 : m.kind == PinKind.client ? 2 : 1,
              infoWindow: m.label == null ? gm.InfoWindow.noText : gm.InfoWindow(title: m.label),
            ),
      },
      polylines: {
        for (final r in w.routes)
          gm.Polyline(
            polylineId: gm.PolylineId(r.id),
            points: partialRoute(r.points, drawT).map(_ll).toList(),
            color: r.dashed ? c.mapRouteSecondary : (context.isDark ? c.ink : c.mapRoute),
            width: r.dashed ? 3 : 5,
            patterns: r.dashed ? [gm.PatternItem.dot, gm.PatternItem.gap(12)] : const [],
            jointType: gm.JointType.round,
            startCap: gm.Cap.roundCap,
            endCap: gm.Cap.roundCap,
          ),
      },
    );
  }

  static gm.LatLng _ll(LatLngD p) => gm.LatLng(p.lat, p.lng);
}

/// Paints a marker bitmap with exactly the plan-view visuals (no external assets).
Future<Uint8List> _paintPin(PinKind kind, SwColors c, double dpr) async {
  final logical = kind == PinKind.store ? 34.0 : kind == PinKind.rider ? 40.0 : 26.0;
  final size = logical * dpr;
  final rec = ui.PictureRecorder();
  final canvas = Canvas(rec)..scale(dpr);
  final o = Offset(logical / 2, logical / 2);
  final shadow = Paint()
    ..color = const Color(0x40000000)
    ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 3);
  switch (kind) {
    case PinKind.client:
      canvas.drawCircle(o.translate(0, 1), 9, shadow);
      canvas.drawCircle(o, 9, Paint()..color = c.mapRing);
      canvas.drawCircle(o, 6, Paint()..color = c.mapClient);
    case PinKind.rider:
      // Heading arrow points north; the marker is rotated to the rider's bearing.
      final arrow = Path()
        ..moveTo(o.dx, o.dy - 19)
        ..lineTo(o.dx + 6, o.dy - 10)
        ..lineTo(o.dx, o.dy - 12.5)
        ..lineTo(o.dx - 6, o.dy - 10)
        ..close();
      canvas.drawPath(arrow, Paint()..color = c.mapRider);
      canvas.drawCircle(o.translate(0, 1), 10, shadow);
      canvas.drawCircle(o, 10, Paint()..color = c.mapRing);
      canvas.drawCircle(o, 7, Paint()..color = c.mapRider);
    case PinKind.store:
      canvas.drawCircle(o.translate(0, 1), 14, shadow);
      canvas.drawCircle(o, 14, Paint()..color = c.mapRing);
      canvas.drawCircle(o, 11, Paint()..color = c.mapOffice);
      final tp = TextPainter(text: TextSpan(text: String.fromCharCode(Ic.store.codePoint), style: TextStyle(fontFamily: Ic.store.fontFamily, fontSize: 13, color: c.mapRing)), textDirection: TextDirection.ltr)..layout();
      tp.paint(canvas, o - Offset(tp.width / 2, tp.height / 2));
  }
  final img = await rec.endRecording().toImage(size.ceil(), size.ceil());
  final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
  return bytes!.buffer.asUint8List();
}

/* ================================================================== plan view (no native maps) */

class _PlanMap extends StatefulWidget {
  const _PlanMap({required this.widget});
  final SwMap widget;
  @override
  State<_PlanMap> createState() => _PlanMapState();
}

class _PlanMapState extends State<_PlanMap> with TickerProviderStateMixin, _Gliding, _RouteDrawing {
  Offset _pan = Offset.zero;
  double _k = 1, _k0 = 1;
  Offset _pan0 = Offset.zero, _focal0 = Offset.zero;
  Object? _fitted;

  SwMap get w => widget.widget;

  @override
  void initState() {
    super.initState();
    syncGlides(w.markers);
    _fitted = w.fitKey;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    syncRoutes(w.routes, reduce: context.reduceMotion);
  }

  @override
  void onDraw() => setState(() {});

  @override
  void didUpdateWidget(covariant _PlanMap old) {
    super.didUpdateWidget(old);
    syncGlides(w.markers);
    syncRoutes(w.routes, reduce: context.reduceMotion);
    if (w.fitKey != _fitted) {
      _fitted = w.fitKey;
      _pan = Offset.zero;
      _k = 1;
    }
  }

  @override
  void dispose() {
    disposeGlides();
    disposeRoutes();
    super.dispose();
  }

  @override
  void onGlide() => setState(() {});

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return LayoutBuilder(builder: (context, box) {
      final size = Size(box.maxWidth, box.maxHeight);
      final inner = w.padding.deflateRect(Offset.zero & size);
      final proj = _Projection.fit(
        w.center != null ? [w.center!] : [...w.markers.map((m) => m.point), ...w.routes.expand((r) => r.points)],
        inner.deflate(40),
        zoomForSingle: w.zoom,
      );
      Offset at(LatLngD p) => (proj.toScreen(p) - inner.center) * _k + inner.center + _pan;
      final body = Stack(clipBehavior: Clip.hardEdge, children: [
        Positioned.fill(
          child: AnimatedBuilder(
            animation: stitch,
            builder: (_, _) => CustomPaint(painter: _PlanPainter(c: c, routes: w.routes, at: at, grid: 28 * _k, origin: inner.center + _pan, dark: context.isDark, draw: drawT, stitch: stitch.isAnimating ? stitch.value : null)),
          ),
        ),
        for (final m in w.markers)
          Positioned(
            left: at(shown(m)).dx - 30,
            top: at(shown(m)).dy - 30,
            width: 60,
            height: 60,
            child: IgnorePointer(child: Center(child: MapPin(kind: m.kind, heading: shownHeading(m)))),
          ),
      ]);
      if (!w.interactive) return body;
      return GestureDetector(
        onScaleStart: (d) {
          _k0 = _k;
          _pan0 = _pan;
          _focal0 = d.localFocalPoint;
        },
        onScaleUpdate: (d) => setState(() {
          _k = (_k0 * d.scale).clamp(0.5, 8);
          _pan = _pan0 + (d.localFocalPoint - _focal0);
        }),
        onScaleEnd: (_) {
          if (w.onCameraIdle != null) {
            final centre = (inner.center - _pan - inner.center) / _k + inner.center;
            w.onCameraIdle!(proj.toLatLng(centre));
          }
        },
        child: body,
      );
    });
  }
}

class _Projection {
  _Projection(this.cx, this.cy, this.scale, this.screenCenter);
  final double cx, cy, scale;
  final Offset screenCenter;

  static double _merc(double lat) => math.log(math.tan(math.pi / 4 + lat * math.pi / 360)) * 180 / math.pi;
  static double _unmerc(double y) => (2 * math.atan(math.exp(y * math.pi / 180)) - math.pi / 2) * 180 / math.pi;

  factory _Projection.fit(List<LatLngD> pts, Rect r, {double zoomForSingle = 15}) {
    if (pts.isEmpty) pts = const [darEsSalaam];
    var s = pts.first.lat, n = s, w = pts.first.lng, e = w;
    for (final p in pts) {
      s = math.min(s, p.lat);
      n = math.max(n, p.lat);
      w = math.min(w, p.lng);
      e = math.max(e, p.lng);
    }
    // A single point gets a neighbourhood-sized frame (~zoom level) instead of infinite zoom.
    final span = 360 / math.pow(2, zoomForSingle) * 1.2;
    final dx = math.max(e - w, span), dy = math.max(_merc(n) - _merc(s), span * 0.7);
    final scale = math.min(r.width / dx, r.height / dy);
    return _Projection((w + e) / 2, (_merc(s) + _merc(n)) / 2, scale, r.center);
  }

  Offset toScreen(LatLngD p) => screenCenter + Offset((p.lng - cx) * scale, -(_merc(p.lat) - cy) * scale);
  LatLngD toLatLng(Offset o) => LatLngD(_unmerc(cy - (o.dy - screenCenter.dy) / scale), cx + (o.dx - screenCenter.dx) / scale);
}

class _PlanPainter extends CustomPainter {
  _PlanPainter({required this.c, required this.routes, required this.at, required this.grid, required this.origin, required this.dark, this.draw = 1, this.stitch});
  final double draw;
  final double? stitch;
  final SwColors c;
  final List<SwRoute> routes;
  final Offset Function(LatLngD) at;
  final double grid;
  final Offset origin;
  final bool dark;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = c.canvas);
    // Soft "blocks" give the plan a city feel without pretending to be a street map.
    final block = Paint()..color = c.ink.withValues(alpha: dark ? 0.035 : 0.025);
    final g = grid * 4;
    final ox = origin.dx % g, oy = origin.dy % g;
    for (var x = ox - g; x < size.width + g; x += g) {
      for (var y = oy - g; y < size.height + g; y += g) {
        canvas.drawRRect(RRect.fromRectAndRadius(Rect.fromLTWH(x + 6, y + 6, g - 12, g - 12), const Radius.circular(6)), block);
      }
    }
    final dot = Paint()..color = c.ink.withValues(alpha: 0.08);
    for (var x = origin.dx % grid; x < size.width; x += grid) {
      for (var y = origin.dy % grid; y < size.height; y += grid) {
        canvas.drawCircle(Offset(x, y), 0.9, dot);
      }
    }
    for (final r in routes) {
      if (r.points.length < 2) continue;
      final pts = partialRoute(r.points, draw);
      final path = Path()..moveTo(at(pts.first).dx, at(pts.first).dy);
      for (final p in pts.skip(1)) {
        final o = at(p);
        path.lineTo(o.dx, o.dy);
      }
      if (r.dashed) {
        final paint = Paint()
          ..color = c.mapRouteSecondary
          ..strokeWidth = 3
          ..strokeCap = StrokeCap.round
          ..style = PaintingStyle.stroke;
        for (final m in path.computeMetrics()) {
          for (var d = 0.0; d < m.length; d += 10) {
            final t = m.getTangentForOffset(d);
            if (t != null) canvas.drawCircle(t.position, 1.6, paint..style = PaintingStyle.fill);
          }
        }
      } else {
        canvas.drawPath(path, Paint()
          ..color = c.surface
          ..strokeWidth = 9
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round);
        canvas.drawPath(path, Paint()
          ..color = dark ? c.ink : c.mapRoute
          ..strokeWidth = 4.5
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round);
        final st = stitch;
        if (st != null && draw >= 1) {
          // A short gold stitch sewn along the line toward the client, fading in and out.
          for (final m in path.computeMetrics()) {
            final len = math.min(46.0, m.length * 0.3);
            final head = (m.length + len) * st;
            final seg = m.extractPath(math.max(0, head - len), math.min(m.length, head));
            final fade = math.sin(st * math.pi);
            canvas.drawPath(seg, Paint()
              ..color = c.accent.withValues(alpha: 0.9 * fade)
              ..strokeWidth = 2.2
              ..style = PaintingStyle.stroke
              ..strokeCap = StrokeCap.round);
          }
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _PlanPainter o) => true;
}

/* ================================================================== pins (shared visuals) */

class MapPin extends StatefulWidget {
  const MapPin({super.key, required this.kind, this.heading});
  final PinKind kind;
  final double? heading;
  @override
  State<MapPin> createState() => _MapPinState();
}

class _MapPinState extends State<MapPin> with SingleTickerProviderStateMixin {
  late final AnimationController _halo = AnimationController(vsync: this, duration: const Duration(milliseconds: 2200));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (widget.kind == PinKind.client && !context.reduceMotion) {
      if (!_halo.isAnimating) _halo.repeat();
    } else {
      _halo.stop();
    }
  }

  @override
  void dispose() {
    _halo.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final ring = [BoxShadow(color: c.ink.withValues(alpha: 0.28), blurRadius: 8, offset: const Offset(0, 2))];
    return switch (widget.kind) {
      PinKind.client => Stack(alignment: Alignment.center, children: [
          AnimatedBuilder(
            animation: _halo,
            builder: (_, _) {
              final t = SwMotion.atelier.transform(_halo.value);
              return Opacity(opacity: (1 - t) * 0.55, child: Container(width: 14 + 34 * t, height: 14 + 34 * t, decoration: BoxDecoration(shape: BoxShape.circle, color: c.mapClient.withValues(alpha: 0.35))));
            },
          ),
          Container(width: 18, height: 18, decoration: BoxDecoration(shape: BoxShape.circle, color: c.mapClient, border: Border.all(color: c.mapRing, width: 3), boxShadow: ring)),
        ]),
      PinKind.rider => SizedBox(
          width: 40,
          height: 40,
          child: Stack(alignment: Alignment.center, children: [
            if (widget.heading != null)
              Transform.rotate(
                angle: widget.heading! * math.pi / 180,
                child: CustomPaint(size: const Size(40, 40), painter: _ArrowPainter(c.mapRider)),
              ),
            Container(width: 20, height: 20, decoration: BoxDecoration(shape: BoxShape.circle, color: c.mapRider, border: Border.all(color: c.mapRing, width: 3), boxShadow: ring)),
          ]),
        ),
      PinKind.store => Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(shape: BoxShape.circle, color: c.mapOffice, border: Border.all(color: c.mapRing, width: 3), boxShadow: ring),
          child: Icon(Ic.store, size: 14, color: c.mapRing),
        ),
    };
  }
}

class _ArrowPainter extends CustomPainter {
  _ArrowPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size s) {
    final o = s.center(Offset.zero);
    canvas.drawPath(
      Path()
        ..moveTo(o.dx, o.dy - 19)
        ..lineTo(o.dx + 6, o.dy - 10)
        ..lineTo(o.dx, o.dy - 12.5)
        ..lineTo(o.dx - 6, o.dy - 10)
        ..close(),
      Paint()..color = color,
    );
  }

  @override
  bool shouldRepaint(covariant _ArrowPainter o) => o.color != color;
}

/// Expanding radius rings centred in the visible map area while dispatch searches for a rider.
class _SearchRings extends StatefulWidget {
  const _SearchRings({required this.padding});
  final EdgeInsets padding;
  @override
  State<_SearchRings> createState() => _SearchRingsState();
}

class _SearchRingsState extends State<_SearchRings> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 2600))..repeat();
  @override
  void dispose() {
    _a.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Padding(
      padding: widget.padding,
      child: AnimatedBuilder(
        animation: _a,
        builder: (_, _) => CustomPaint(painter: _RingsPainter(context.reduceMotion ? 0.4 : _a.value, c.accent)),
      ),
    );
  }
}

class _RingsPainter extends CustomPainter {
  _RingsPainter(this.t, this.color);
  final double t;
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    final o = size.center(Offset.zero);
    final maxR = size.shortestSide * 0.48;
    for (var i = 0; i < 3; i++) {
      final k = (t + i / 3) % 1;
      final e = SwMotion.atelier.transform(k);
      canvas.drawCircle(o, 16 + maxR * e, Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.4
        ..color = color.withValues(alpha: (1 - e) * 0.7));
      canvas.drawCircle(o, 16 + maxR * e, Paint()..color = color.withValues(alpha: (1 - e) * 0.06));
    }
  }

  @override
  bool shouldRepaint(covariant _RingsPainter o) => o.t != t;
}
