import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/geo.dart';
import '../../core/location.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../../ui/sw_map.dart';
import 'checkout_state.dart';

String _session() {
  final r = math.Random.secure();
  return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
}

/// "Where to?" — saved places, recent, then live Places results (session tokens, location bias,
/// 250ms debounce, highlighted matches). Plus codes and landmarks work too. Returns true when set.
Future<bool> showPlacePicker(BuildContext context) async {
  final r = await showSwSheet<bool>(context, expand: true, builder: (_) => const _PlaceSearch());
  return r == true;
}

class _PlaceSearch extends ConsumerStatefulWidget {
  const _PlaceSearch();
  @override
  ConsumerState<_PlaceSearch> createState() => _PlaceSearchState();
}

class _PlaceSearchState extends ConsumerState<_PlaceSearch> {
  final _q = TextEditingController();
  final _session0 = _session();
  Timer? _debounce;
  List<Json> _results = const [];
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _debounce?.cancel();
    _q.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    if (v.trim().length < 2) {
      setState(() => _results = const []);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () => _search(v.trim()));
  }

  Future<void> _search(String text) async {
    setState(() => _loading = true);
    final here = ref.read(deliveryPointProvider).point?.point;
    try {
      final r = await ref.read(apiProvider).get<Json>('/maps/autocomplete', query: {'q': text, 'session': _session0, 'lat': here?.lat, 'lng': here?.lng});
      if (mounted && _q.text.trim() == text) setState(() { _results = r.list('items'); _error = null; });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.code == 'not_configured' ? ref.s('checkout.setOnMap') : e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pick(Json item) async {
    final loc = LatLngD.fromJson(item['location']);
    Json d = item;
    if (loc == null) d = await ref.read(apiProvider).get<Json>('/maps/places/${item.str('placeId')}', query: {'session': _session0});
    final p = LatLngD.fromJson(d['location']) ?? LatLngD(d.dbl('lat'), d.dbl('lng'));
    ref.read(deliveryPointProvider.notifier).set(DeliveryPoint(p, label: d.strN('address') ?? item.strN('secondary') ?? item.str('primary'), area: d.strN('area') ?? item.strN('primary'), source: PointSource.search, placeId: item.strN('placeId')));
    HapticFeedback.selectionClick();
    if (mounted) Navigator.of(context).pop(true);
  }

  void _pickSaved(Json p) {
    ref.read(deliveryPointProvider.notifier).set(DeliveryPoint(LatLngD.fromJson(p['location'])!, label: p.str('address'), area: p.strN('area') ?? p.strN('label'), landmark: p.strN('landmarkNote'), source: PointSource.saved));
    HapticFeedback.selectionClick();
    Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final places = ref.watch(placesProvider).value;
    final saved = places?.list('saved') ?? const <Json>[];
    final recent = places?.list('recent') ?? const <Json>[];
    final searching = _q.text.trim().length >= 2;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s5, SwSpace.s5, SwSpace.s3),
          child: Text(s('checkout.deliverTo'), style: context.type.displayS),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          child: SwSearchBar(controller: _q, hint: s('checkout.searchPlaces'), autofocus: true, onChanged: _onChanged, trailing: _loading ? const ALoader(size: ALoaderSize.sm) : null),
        ),
        const SizedBox(height: SwSpace.s2),
        Expanded(
          child: ListView(padding: const EdgeInsets.only(bottom: SwSpace.s10), children: [
            if (!searching) ...[
              _Row(icon: Ic.locateFixed, title: s('checkout.useCurrent'), accent: true, onTap: () async {
                Navigator.of(context).pop(true);
                await ref.read(deliveryPointProvider.notifier).requestAndLocate();
              }),
              _Row(icon: Ic.mapPin, title: s('checkout.setOnMap'), subtitle: s('checkout.moveMap'), onTap: () async {
                final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const SetOnMapScreen()));
                if (ok == true && context.mounted) Navigator.of(context).pop(true);
              }),
              if (saved.isNotEmpty) _Label(s('checkout.savedPlaces')),
              for (final p in saved) _Row(icon: p.str('kind') == 'home' ? Ic.house : p.str('kind') == 'work' ? Ic.briefcase : Ic.bookmark, title: p.str('label', p.str('address')), subtitle: p.str('address'), onTap: () => _pickSaved(p)),
              if (recent.isNotEmpty) _Label(s('checkout.recent')),
              for (final p in recent)
                _Row(
                  icon: Ic.history,
                  title: [p.strN('label'), p.strN('area'), p.strN('address')].firstWhere((x) => x != null && x.isNotEmpty, orElse: () => s('checkout.droppedPin'))!,
                  subtitle: [p.strN('landmarkNote'), p.strN('address')].firstWhere((x) => x != null && x.isNotEmpty, orElse: () => '') ?? '',
                  onTap: () => _pickSaved(p),
                ),
            ] else ...[
              if (_error != null) Padding(padding: const EdgeInsets.all(SwSpace.s5), child: Text(_error!, style: context.type.bodyS.copyWith(color: c.muted))),
              for (final r in _results)
                _Row(
                  icon: r.str('kind') == 'plus_code' ? Ic.crosshair : Ic.mapPin,
                  titleSpan: _highlight(context, r.str('primary'), r.list('matches')),
                  subtitle: [r.str('secondary'), if (r['distanceMeters'] != null) fmtDistance(r['distanceMeters'] as num)].where((x) => x.isNotEmpty).join(' · '),
                  onTap: () => _pick(r),
                ),
              _Row(icon: Ic.mapPin, title: s('checkout.setOnMap'), subtitle: s('checkout.moveMap'), onTap: () async {
                final ok = await Navigator.of(context).push<bool>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const SetOnMapScreen()));
                if (ok == true && context.mounted) Navigator.of(context).pop(true);
              }),
            ],
          ]),
        ),
      ]),
    );
  }

  TextSpan _highlight(BuildContext context, String text, List<Json> matches) {
    final base = context.type.titleS;
    if (matches.isEmpty) return TextSpan(text: text, style: base);
    final spans = <TextSpan>[];
    var i = 0;
    for (final m in matches) {
      final a = m.integer('start').clamp(0, text.length), b = m.integer('end').clamp(0, text.length);
      if (a > i) spans.add(TextSpan(text: text.substring(i, a), style: base.copyWith(fontWeight: FontWeight.w500, color: context.sw.muted)));
      spans.add(TextSpan(text: text.substring(a, b), style: base.copyWith(fontWeight: FontWeight.w700)));
      i = b;
    }
    if (i < text.length) spans.add(TextSpan(text: text.substring(i), style: base.copyWith(fontWeight: FontWeight.w500, color: context.sw.muted)));
    return TextSpan(children: spans);
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, SwSpace.s2),
        child: Text(caps(text), style: context.type.label.copyWith(color: context.sw.muted)),
      );
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, this.title, this.titleSpan, this.subtitle, required this.onTap, this.accent = false});
  final IconData icon;
  final String? title, subtitle;
  final TextSpan? titleSpan;
  final FutureOr<void> Function() onTap;
  final bool accent;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return PressableLink(
      onTap: onTap,
      loaderOverlay: false,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5, vertical: SwSpace.s3),
        child: Row(children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(shape: BoxShape.circle, color: accent ? c.accentSoft : c.ink.withValues(alpha: 0.05)),
            child: Icon(icon, size: 18, color: c.ink),
          ),
          const SizedBox(width: SwSpace.s4),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              if (titleSpan != null) Text.rich(titleSpan!, maxLines: 1, overflow: TextOverflow.ellipsis) else Text(title ?? '', style: context.type.titleS, maxLines: 1, overflow: TextOverflow.ellipsis),
              if (subtitle != null && subtitle!.isNotEmpty) Text(subtitle!, style: context.type.caption.copyWith(color: c.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
            ]),
          ),
        ]),
      ),
    );
  }
}

/* ================================================================== set on map */

/// Fixed centre pin over a draggable map ("Move the map to adjust"); the address label updates
/// when the map settles, with an optional one-line landmark note. Optionally save as Home/Work.
class SetOnMapScreen extends ConsumerStatefulWidget {
  const SetOnMapScreen({super.key});
  @override
  ConsumerState<SetOnMapScreen> createState() => _SetOnMapScreenState();
}

class _SetOnMapScreenState extends ConsumerState<SetOnMapScreen> {
  late final LatLngD _start = ref.read(deliveryPointProvider).point?.point ?? LocationService.testFix.point;
  late LatLngD _at = _start;
  String? _label, _area;
  bool _moving = false, _resolving = false;
  String? _saveAs;
  final _landmark = TextEditingController();
  int _seq = 0;

  @override
  void initState() {
    super.initState();
    _landmark.text = ref.read(deliveryPointProvider).point?.landmark ?? '';
    _resolve(_start);
  }

  @override
  void dispose() {
    _landmark.dispose();
    super.dispose();
  }

  Future<void> _resolve(LatLngD p) async {
    final n = ++_seq;
    setState(() { _resolving = true; _moving = false; });
    try {
      final r = await ref.read(apiProvider).get<Json>('/maps/reverse', query: {'lat': p.lat, 'lng': p.lng});
      if (mounted && n == _seq) setState(() { _label = r.strN('address'); _area = r.strN('area'); });
    } on ApiException {
      if (mounted && n == _seq) setState(() { _label = null; _area = null; });
    } finally {
      if (mounted && n == _seq) setState(() => _resolving = false);
    }
  }

  Future<void> _confirm() async {
    final p = DeliveryPoint(_at, label: _label, area: _area, landmark: _landmark.text.trim().isEmpty ? null : _landmark.text.trim(), source: PointSource.map);
    ref.read(deliveryPointProvider.notifier).set(p);
    if (_saveAs != null) {
      try {
        await ref.read(apiProvider).post<Json>('/me/places', {'kind': _saveAs, 'lat': _at.lat, 'lng': _at.lng, 'address': _label ?? 'Pinned location', 'area': _area, 'landmarkNote': p.landmark});
        ref.invalidate(placesProvider);
      } on ApiException {
        // Saving is a convenience; the order still uses the pin.
      }
    }
    HapticFeedback.mediumImpact();
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    const sheetH = 300.0;
    return Scaffold(
      body: Stack(children: [
        Positioned.fill(
          child: Listener(
            onPointerDown: (_) => setState(() => _moving = true),
            child: SwMap(
              center: _start,
              zoom: 17,
              padding: EdgeInsets.only(top: context.safe.top + 56, bottom: sheetH + context.safe.bottom),
              onCameraIdle: (p) {
                _at = p;
                _resolve(p);
              },
            ),
          ),
        ),
        // Fixed centre pin: lifts while dragging, drops with a soft bounce when the map settles.
        Positioned(
          left: 0,
          right: 0,
          top: context.safe.top + 56,
          bottom: sheetH + context.safe.bottom,
          child: IgnorePointer(
            child: Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                AnimatedSlide(
                  offset: Offset(0, _moving ? -0.35 : 0),
                  duration: const Duration(milliseconds: 220),
                  curve: _moving ? SwMotion.atelier : Curves.elasticOut,
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: c.mapClient, border: Border.all(color: c.mapRing, width: 4), boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, 4))]),
                    ),
                    Container(width: 2.5, height: 18, color: c.mapClient),
                  ]),
                ),
                AnimatedContainer(duration: const Duration(milliseconds: 220), width: _moving ? 14 : 8, height: 4, decoration: BoxDecoration(color: c.ink.withValues(alpha: _moving ? 0.15 : 0.3), borderRadius: BorderRadius.circular(4))),
                const SizedBox(height: 22),
              ]),
            ),
          ),
        ),
        Positioned(
          top: context.safe.top + SwSpace.s2,
          left: SwSpace.s4,
          child: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), filled: true, onPressed: () => Navigator.of(context).pop(false)),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s5, SwSpace.s5, SwSpace.s5 + context.safe.bottom),
            decoration: BoxDecoration(color: c.surface, borderRadius: const BorderRadius.vertical(top: Radius.circular(SwRadius.lg)), boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.12), blurRadius: 40, offset: const Offset(0, -8))]),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(caps(s('checkout.moveMap')), style: context.type.label.copyWith(color: c.muted)),
              const SizedBox(height: SwSpace.s2),
              SizedBox(
                height: 52,
                child: AnimatedSwitcher(
                  duration: SwMotion.base,
                  child: _moving || _resolving
                      ? Align(key: const ValueKey('l'), alignment: Alignment.centerLeft, child: Skeleton(width: 220, height: 18))
                      : Column(key: ValueKey(_label), crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(_area ?? _label ?? s('checkout.currentLocation'), style: context.type.titleL, maxLines: 1, overflow: TextOverflow.ellipsis),
                          if (_label != null && _area != null) Text(_label!, style: context.type.caption.copyWith(color: c.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
                        ]),
                ),
              ),
              const SizedBox(height: SwSpace.s3),
              SwTextField(controller: _landmark, hint: s('checkout.landmarkPlaceholder'), leadingIcon: Ic.flower2, maxLength: 120, textInputAction: TextInputAction.done),
              const SizedBox(height: SwSpace.s3),
              Row(children: [
                Text(s('checkout.saveAs'), style: context.type.caption.copyWith(color: c.muted)),
                const SizedBox(width: SwSpace.s3),
                ChoiceChipSw(label: s('places.home'), leading: const Icon(Ic.house, size: 14), selected: _saveAs == 'home', onTap: () => setState(() => _saveAs = _saveAs == 'home' ? null : 'home')),
                const SizedBox(width: SwSpace.s2),
                ChoiceChipSw(label: s('places.work'), leading: const Icon(Ic.briefcase, size: 14), selected: _saveAs == 'work', onTap: () => setState(() => _saveAs = _saveAs == 'work' ? null : 'work')),
              ]),
              const SizedBox(height: SwSpace.s4),
              SwButton(label: s('checkout.confirmLocation'), icon: Ic.check, large: true, expand: true, haptic: true, onPressed: _moving ? null : _confirm),
            ]),
          ),
        ),
      ]),
    );
  }
}
