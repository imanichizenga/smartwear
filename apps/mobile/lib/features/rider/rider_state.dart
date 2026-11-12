import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/geo.dart';
import '../../core/location.dart';
import '../../core/realtime.dart';
import '../../l10n/strings.dart';

/// Rider Mode state: profile + today, nearby stores, the pending offer and the active job.
/// While online it streams location (socket first, batched HTTP fallback) and listens on
/// `rider.<id>` for offers, reassignments and cancellations.
class RiderState {
  const RiderState({required this.me, this.offer, this.job, this.here, this.justCompleted});
  final Json me;
  final Json? offer, job, justCompleted;
  final LatLngD? here;

  Json get rider => me.obj('rider') ?? const {};
  bool get online => rider.str('presence', 'OFFLINE') != 'OFFLINE';
  bool get approved => rider.str('status') == 'ACTIVE';
  List<Json> get stores => me.list('stores');

  RiderState copy({Json? me, Object? offer = _keep, Object? job = _keep, LatLngD? here, Object? justCompleted = _keep}) => RiderState(
        me: me ?? this.me,
        offer: identical(offer, _keep) ? this.offer : offer as Json?,
        job: identical(job, _keep) ? this.job : job as Json?,
        here: here ?? this.here,
        justCompleted: identical(justCompleted, _keep) ? this.justCompleted : justCompleted as Json?,
      );
}

const _keep = Object();

final riderProvider = AsyncNotifierProvider<RiderNotifier, RiderState>(RiderNotifier.new);

class RiderNotifier extends AsyncNotifier<RiderState> {
  StreamSubscription<LocFix>? _loc;
  StreamSubscription<RtEvent>? _rt;
  final List<Map<String, dynamic>> _batch = [];
  Timer? _flush;
  DateTime _lastSent = DateTime.fromMillisecondsSinceEpoch(0);

  Api get _api => ref.read(apiProvider);

  @override
  Future<RiderState> build() async {
    ref.onDispose(_stopTracking);
    ref.onDispose(() => _rt?.cancel());
    final me = await _api.get<Json>('/rider/me');
    final st = RiderState(me: me, offer: me.obj('pendingOffer'), job: me.obj('activeJob'));
    final rt = ref.read(realtimeProvider)..ensure();
    _rt = rt.events.listen(_onEvent);
    if (st.online) _startTracking();
    return st;
  }

  RiderState get _s => state.requireValue;

  Future<void> refresh() async {
    final me = await _api.get<Json>('/rider/me');
    state = AsyncData(_s.copy(me: me, offer: me.obj('pendingOffer'), job: me.obj('activeJob')));
  }

  void _onEvent(RtEvent e) {
    final s = state.value;
    if (s == null) return;
    switch (e['type']) {
      case 'job.offer':
        HapticFeedback.heavyImpact();
        state = AsyncData(s.copy(offer: Map<String, dynamic>.from(e['offer'] as Map)));
      case 'job.offer_expired' || 'job.offer_taken':
        if (s.offer?['id'] == e['offerId']) state = AsyncData(s.copy(offer: null));
      case 'job.assigned':
        if (e['job'] is Map) state = AsyncData(s.copy(job: Map<String, dynamic>.from(e['job'] as Map), offer: null));
        refresh();
      case 'job.cancelled' || 'job.reassigned' || 'job.status':
        refresh();
    }
  }

  /* ---------------------------------------------------------------- presence + location */

  Future<String?> setOnline(bool on) async {
    final loc = ref.read(locationServiceProvider);
    if (on) {
      var p = await loc.permission();
      if (p != LocPermission.granted) p = await loc.request();
      if (p != LocPermission.granted) return 'rider.locationNeeded';
      LatLngD? here;
      await for (final f in loc.fixes()) {
        here = f.point;
      }
      if (here == null) return 'rider.locationNeeded';
      final r = await _api.post<Json>('/rider/presence', {'online': true, 'lat': here.lat, 'lng': here.lng});
      state = AsyncData(_s.copy(me: {..._s.me, 'rider': r}, here: here));
      _startTracking();
    } else {
      final r = await _api.post<Json>('/rider/presence', {'online': false});
      _stopTracking();
      state = AsyncData(_s.copy(me: {..._s.me, 'rider': r}));
    }
    HapticFeedback.mediumImpact();
    return null;
  }

  void _startTracking() {
    if (_loc != null) return;
    final s = S(ref.read(localeProvider));
    _loc = ref.read(locationServiceProvider).track(notificationTitle: 'SmartWear Rider', notificationText: s('rider.backgroundNotice')).listen(_onFix);
    _flush = Timer.periodic(const Duration(seconds: 5), (_) => _flushBatch());
  }

  void _stopTracking() {
    _loc?.cancel();
    _loc = null;
    _flush?.cancel();
    _flush = null;
    _batch.clear();
  }

  void _onFix(LocFix f) {
    final s = state.value;
    if (s != null) state = AsyncData(s.copy(here: f.point));
    // ≤1 update per 3s; the OS already filters to ~10 m of movement.
    if (DateTime.now().difference(_lastSent) < const Duration(seconds: 3)) return;
    _lastSent = DateTime.now();
    final fix = {'lat': f.point.lat, 'lng': f.point.lng, 'heading': f.heading, 'speed': f.speed, 'accuracy': f.accuracy, 'at': DateTime.now().toUtc().toIso8601String()};
    if (!ref.read(realtimeProvider).sendLocation(fix)) _batch.add(fix);
  }

  Future<void> _flushBatch() async {
    if (_batch.isEmpty) return;
    final pts = List<Map<String, dynamic>>.from(_batch);
    _batch.clear();
    try {
      await _api.post<Json>('/rider/location', {'points': pts});
    } on ApiException {
      _batch.insertAll(0, pts.length > 20 ? pts.sublist(pts.length - 20) : pts);
    }
  }

  /* ---------------------------------------------------------------- offers + job steps */

  Future<void> accept(int offerId) async {
    final r = await _api.post<Json>('/rider/offers/$offerId/accept');
    HapticFeedback.heavyImpact();
    state = AsyncData(_s.copy(job: r.obj('job'), offer: null));
  }

  Future<void> decline(int offerId, [String reason = '']) async {
    try {
      await _api.post<Json>('/rider/offers/$offerId/decline', {'reason': reason});
    } finally {
      state = AsyncData(_s.copy(offer: null));
    }
  }

  void offerExpired() {
    if (state.value?.offer != null) state = AsyncData(_s.copy(offer: null));
  }

  Future<void> step(String step, {String? pin}) async {
    final job = _s.job;
    if (job == null) return;
    final here = _s.here;
    final r = await _api.post<Json>('/rider/jobs/${job.str('id')}', {'step': step, 'pin': ?pin, if (here != null) 'lat': here.lat, if (here != null) 'lng': here.lng});
    HapticFeedback.mediumImpact();
    if (r.str('status') == 'COMPLETED') {
      state = AsyncData(_s.copy(job: null, justCompleted: r));
      await refresh();
    } else {
      state = AsyncData(_s.copy(job: r));
    }
  }

  Future<void> release(String reason) async {
    final job = _s.job;
    if (job == null) return;
    await _api.post<Json>('/rider/jobs/${job.str('id')}', {'release': reason});
    await refresh();
  }

  void dismissCompleted() => state = AsyncData(_s.copy(justCompleted: null));
}

final riderHistoryProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(apiProvider).get<Json>('/rider/history'));
