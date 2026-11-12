import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/geo.dart';
import '../../core/location.dart';

enum PointSource { gps, saved, search, map }

/// Where the order goes. Comes from GPS by default, or the place picker — never a form.
class DeliveryPoint {
  const DeliveryPoint(this.point, {this.label, this.area, this.landmark, this.source = PointSource.gps, this.accuracy, this.placeId});
  final LatLngD point;
  final String? label, area, landmark, placeId;
  final PointSource source;
  final double? accuracy;

  DeliveryPoint copyWith({String? label, String? area, String? landmark}) =>
      DeliveryPoint(point, label: label ?? this.label, area: area ?? this.area, landmark: landmark ?? this.landmark, source: source, accuracy: accuracy, placeId: placeId);
}

class DeliveryPointState {
  const DeliveryPointState({this.point, this.permission = LocPermission.unknown, this.locating = false});
  final DeliveryPoint? point;
  final LocPermission permission;
  final bool locating;
}

final deliveryPointProvider = NotifierProvider<DeliveryPointNotifier, DeliveryPointState>(DeliveryPointNotifier.new);

class DeliveryPointNotifier extends Notifier<DeliveryPointState> {
  @override
  DeliveryPointState build() => const DeliveryPointState();

  LocationService get _loc => ref.read(locationServiceProvider);

  /// Silent start: if permission is already granted, take a fix straight away.
  Future<void> init() async {
    if (state.point != null) return;
    final p = await _loc.permission();
    state = DeliveryPointState(permission: p, point: state.point);
    if (p == LocPermission.granted) await locate();
  }

  Future<void> requestAndLocate() async {
    final p = await _loc.request();
    state = DeliveryPointState(permission: p, point: state.point);
    if (p == LocPermission.granted) await locate();
  }

  /// Coarse fix first (instant), refined to high accuracy; labels come from reverse geocoding.
  Future<void> locate() async {
    state = DeliveryPointState(permission: LocPermission.granted, point: state.point, locating: true);
    await for (final f in _loc.fixes()) {
      state = DeliveryPointState(permission: LocPermission.granted, point: DeliveryPoint(f.point, accuracy: f.accuracy, label: state.point?.source == PointSource.gps ? state.point?.label : null, area: state.point?.source == PointSource.gps ? state.point?.area : null), locating: !f.precise);
      if (f.precise) break;
    }
    state = DeliveryPointState(permission: LocPermission.granted, point: state.point, locating: false);
    final pt = state.point;
    if (pt != null) await _label(pt);
  }

  Future<void> _label(DeliveryPoint pt) async {
    try {
      final r = await ref.read(apiProvider).get<Json>('/maps/reverse', query: {'lat': pt.point.lat, 'lng': pt.point.lng});
      if (state.point?.point == pt.point) state = DeliveryPointState(permission: state.permission, point: pt.copyWith(label: r.strN('address'), area: r.strN('area')));
    } on ApiException {
      // Maps not configured / offline: the map pin is still exact; the label stays generic.
    }
  }

  void set(DeliveryPoint p) {
    state = DeliveryPointState(permission: state.permission, point: p);
    if (p.label == null) _label(p);
  }

  void setLandmark(String v) {
    final p = state.point;
    if (p != null) state = DeliveryPointState(permission: state.permission, point: p.copyWith(landmark: v));
  }
}

class CheckoutChoice {
  const CheckoutChoice({this.optionId, this.method, this.msisdn, this.promo, this.extra = const {}});
  final String? optionId, method, msisdn, promo;
  final Map<String, String> extra;
  CheckoutChoice copyWith({String? optionId, String? method, String? msisdn, String? promo, Map<String, String>? extra}) =>
      CheckoutChoice(optionId: optionId ?? this.optionId, method: method ?? this.method, msisdn: msisdn ?? this.msisdn, promo: promo ?? this.promo, extra: extra ?? this.extra);
}

final checkoutChoiceProvider = NotifierProvider<CheckoutChoiceNotifier, CheckoutChoice>(CheckoutChoiceNotifier.new);

class CheckoutChoiceNotifier extends Notifier<CheckoutChoice> {
  @override
  CheckoutChoice build() => const CheckoutChoice();
  void option(String id) => state = state.copyWith(optionId: id);
  void payment(String method, {String? msisdn}) => state = state.copyWith(method: method, msisdn: msisdn);
  void extra(String k, String v) => state = state.copyWith(extra: {...state.extra, k: v});
}

/// Server quote for the current point + option. All prices, fees and ETAs come from here.
final quoteProvider = FutureProvider.autoDispose<Json?>((ref) async {
  final p = ref.watch(deliveryPointProvider.select((s) => s.point?.point));
  final option = ref.watch(checkoutChoiceProvider.select((c) => c.optionId));
  if (p == null) return null;
  return ref.read(apiProvider).post<Json>('/checkout/quote', {'lat': p.lat, 'lng': p.lng, 'deliveryOptionId': ?option});
});

final placesProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(apiProvider).get<Json>('/me/places'));
