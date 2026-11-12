import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/geo.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../core/realtime.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../../ui/sw_map.dart';
import '../chat/chat_screen.dart';

enum TrackPhase { payment, searching, noRider, preparing, toStore, onTheWay, arrived, delivered, closed }

TrackPhase phaseOf(Json o) {
  final st = o.str('status');
  final d = o.obj('delivery');
  final js = d?.str('status');
  if (st == 'PENDING_PAYMENT') return TrackPhase.payment;
  if (st == 'DELIVERED') return TrackPhase.delivered;
  if (st == 'CANCELLED' || st == 'REFUNDED' || st == 'FAILED') return TrackPhase.closed;
  if (o.str('fulfilment') == 'pickup') return TrackPhase.preparing;
  if (js == 'NO_RIDER') return TrackPhase.noRider;
  if (js == 'ARRIVED' || st == 'ARRIVED') return TrackPhase.arrived;
  if (js == 'PICKED_UP' || js == 'EN_ROUTE' || st == 'ON_THE_WAY' || st == 'PICKED_UP') return TrackPhase.onTheWay;
  if (js == 'ACCEPTED' || js == 'AT_STORE') return TrackPhase.toStore;
  if (js == 'SEARCHING' || js == 'OFFERED') return TrackPhase.searching;
  return TrackPhase.preparing;
}

/// Bolt-style live tracking, in SmartWear's own editorial skin.
class TrackingScreen extends ConsumerStatefulWidget {
  const TrackingScreen({super.key, required this.orderId});
  final String orderId;
  @override
  ConsumerState<TrackingScreen> createState() => _TrackingScreenState();
}

class _TrackingScreenState extends ConsumerState<TrackingScreen> {
  Json? _o;
  LatLngD? _rider;
  double? _heading;
  DateTime? _riderAt;
  int? _etaSeconds;
  DateTime _etaAt = DateTime.now();
  TrackPhase? _lastPhase;
  void Function()? _unsub;
  StreamSubscription<RtEvent>? _sub;
  Timer? _poll, _tick;

  Api get _api => ref.read(apiProvider);

  @override
  void initState() {
    super.initState();
    final rt = ref.read(realtimeProvider);
    _unsub = rt.subscribe('order.${widget.orderId}');
    _sub = rt.events.listen(_onEvent);
    _poll = Timer.periodic(const Duration(seconds: 10), (_) => _load());
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => mounted ? setState(() {}) : null);
    _load();
  }

  @override
  void dispose() {
    _unsub?.call();
    _sub?.cancel();
    _poll?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  void _onEvent(RtEvent e) {
    if (e['orderId'] != null && e['orderId'] != widget.orderId) return;
    if (e['type'] == 'rider.location') {
      setState(() {
        _rider = LatLngD((e['lat'] as num).toDouble(), (e['lng'] as num).toDouble());
        _heading = (e['heading'] as num?)?.toDouble() ?? _heading;
        _riderAt = DateTime.now();
        if (e['etaSeconds'] is num) {
          _etaSeconds = (e['etaSeconds'] as num).toInt();
          _etaAt = DateTime.now();
        }
      });
    } else {
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final o = await _api.get<Json>('/me/orders/${widget.orderId}');
      if (!mounted) return;
      final d = o.obj('delivery');
      final loc = d?.obj('riderLocation');
      setState(() {
        _o = o;
        if (loc != null) {
          _rider = LatLngD.fromJson(loc);
          _heading = loc.dbl('heading', _heading ?? 0);
          _riderAt = DateTime.tryParse(loc.str('at'))?.toLocal() ?? DateTime.now();
        } else if (d?.obj('rider') == null) {
          _rider = null;
        }
        final live = o.obj('eta')?.intN('liveSeconds');
        if (live != null) {
          _etaSeconds = live;
          _etaAt = DateTime.now();
        }
      });
      final p = phaseOf(o);
      if (_lastPhase != null && p != _lastPhase && (p == TrackPhase.arrived || p == TrackPhase.toStore || p == TrackPhase.delivered)) HapticFeedback.heavyImpact();
      _lastPhase = p;
      if (p == TrackPhase.delivered || p == TrackPhase.closed) _poll?.cancel();
    } on ApiException {
      // Keep the last known state; the header shows "updating…".
    }
  }

  int? get _etaNow => _etaSeconds == null ? null : math.max(0, _etaSeconds! - DateTime.now().difference(_etaAt).inSeconds);

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final o = _o;
    if (o == null) return Scaffold(body: ALoaderBlock(message: s('loader.searchingRider')));
    final phase = phaseOf(o);
    final store = LatLngD.fromJson(o.obj('store')?['location']);
    final dest = LatLngD.fromJson(o.obj('destination')?['location']);
    final d = o.obj('delivery');
    final route = decodePolyline(d?.strN('route'));
    final showRider = _rider != null && (phase == TrackPhase.toStore || phase == TrackPhase.onTheWay || phase == TrackPhase.arrived);
    final markers = <SwMarker>[
      if (store != null) SwMarker('store', PinKind.store, store, label: o.obj('store')?.str('name')),
      if (dest != null) SwMarker('me', PinKind.client, dest),
      if (showRider) SwMarker('rider', PinKind.rider, _rider!, heading: _heading),
    ];
    final routes = <SwRoute>[
      if (route.isNotEmpty) SwRoute('live', route)
      else if (showRider && phase == TrackPhase.toStore && store != null) SwRoute('r', [_rider!, store], dashed: true)
      else if (showRider && dest != null) SwRoute('r', [_rider!, dest], dashed: true)
      else if (store != null && dest != null) SwRoute('r', [store, dest], dashed: true),
    ];
    final stale = _riderAt != null && DateTime.now().difference(_riderAt!).inSeconds > 30 && showRider;
    final sheetH = MediaQuery.sizeOf(context).height * 0.42;
    return Scaffold(
      body: Stack(children: [
        Positioned.fill(
          child: SwMap(
            markers: markers,
            routes: routes,
            searching: phase == TrackPhase.searching,
            fitKey: '${phase.name}|${showRider ? 'r' : ''}',
            padding: EdgeInsets.only(top: context.safe.top + 80, bottom: sheetH, left: 24, right: 24),
          ),
        ),
        if (phase == TrackPhase.searching)
          Positioned(
            left: 0,
            right: 0,
            top: context.safe.top + 70,
            bottom: sheetH,
            child: IgnorePointer(
              child: Center(
                child: Container(
                  padding: const EdgeInsets.all(SwSpace.s5),
                  decoration: BoxDecoration(color: c.surface.withValues(alpha: 0.86), shape: BoxShape.circle, boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.12), blurRadius: 30)]),
                  child: const ALoader(size: ALoaderSize.xl),
                ),
              ),
            ),
          ),
        Positioned(
          top: context.safe.top + SwSpace.s2,
          left: SwSpace.s4,
          right: SwSpace.s4,
          child: Row(children: [
            SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), filled: true, onPressed: () => context.canPop() ? context.pop() : context.go('/orders')),
            const Spacer(),
            _TopPill(o: o, stale: stale),
            const Spacer(),
            if (o.strN('shareToken') != null && phase != TrackPhase.delivered && phase != TrackPhase.closed)
              SwIconButton(icon: Ic.share2, semanticLabel: s('track.shareLink'), filled: true, onPressed: () async {
                await Clipboard.setData(ClipboardData(text: '$apiUrl/v1/track/${o.str('shareToken')}'));
                if (context.mounted) showSwToast(context, s('track.shareLink'), icon: Ic.copy);
              })
            else
              const SizedBox(width: 44),
          ]),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _Sheet(
            child: AnimatedSwitcher(
              duration: SwMotion.slow,
              switchInCurve: SwMotion.atelier,
              switchOutCurve: SwMotion.atelier,
              transitionBuilder: (child, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0, 0.06), end: Offset.zero).animate(a), child: child)),
              layoutBuilder: (cur, prev) => Stack(alignment: Alignment.bottomCenter, children: [...prev, ?cur]),
              child: KeyedSubtree(key: ValueKey(phase), child: _content(context, o, phase)),
            ),
          ),
        ),
      ]),
    );
  }

  Widget _content(BuildContext context, Json o, TrackPhase phase) {
    final s = ref.s;
    final d = o.obj('delivery');
    final rider = d?.obj('rider');
    final eta = _etaNow;
    switch (phase) {
      case TrackPhase.payment:
        return _Block(title: s('track.status.PENDING_PAYMENT'), body: s('pay.approve.steps'), children: [
          SwButton(label: s('pay.approve.title'), icon: Ic.smartphone, large: true, expand: true, onPressed: () => context.go('/orders/${widget.orderId}/pay')),
        ]);
      case TrackPhase.searching:
        return _Block(eyebrow: o.str('number'), title: s('checkout.findingRider'), body: s('track.findingBody'), children: [
          _StoreLine(o: o),
          _Progress(value: null),
        ]);
      case TrackPhase.noRider:
        return _Block(title: s('track.noRider.title'), body: s('track.noRider.body'), children: [
          Row(children: [
            Expanded(child: SwButton(label: s('track.keepWaiting'), onPressed: () async {
              await _api.post<Json>('/me/orders/${widget.orderId}/keep-searching');
              await _load();
            })),
            const SizedBox(width: SwSpace.s2),
            Expanded(child: SwButton(label: s('track.cancelOrder'), variant: SwButtonVariant.secondary, onPressed: () async {
              try {
                await _api.post<Json>('/me/orders/${widget.orderId}/cancel', {'reason': 'No rider available'});
                await _load();
              } on ApiException catch (e) {
                if (context.mounted) showSwToast(context, e.message, error: true);
              }
            })),
          ]),
        ]);
      case TrackPhase.preparing:
        return _Block(eyebrow: o.str('number'), title: s('track.status.${o.str('status')}'), body: o.str('fulfilment') == 'pickup' ? s('checkout.pickupAt', {'store': o.obj('store')?.str('name') ?? ''}) : s('track.preparing'), children: [
          _StoreLine(o: o),
          const _Progress(value: 0.25),
        ]);
      case TrackPhase.toStore:
        return _Block(eyebrow: s('track.status.ASSIGNED'), title: s('track.assigned', {'name': rider?.str('firstName') ?? ''}), children: [
          if (rider != null) _RiderCard(rider: rider, orderId: widget.orderId),
          const _Progress(value: 0.5),
          _PinRow(pin: o.strN('pin')),
        ]);
      case TrackPhase.onTheWay:
        return _Block(
          eyebrow: s('track.status.ON_THE_WAY'),
          titleWidget: Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Expanded(child: Text(s('track.pickedUpBy', {'name': rider?.str('firstName') ?? ''}), style: context.type.displayS)),
            if (eta != null) _EtaBadge(seconds: eta),
          ]),
          children: [
            if (rider != null) _RiderCard(rider: rider, orderId: widget.orderId),
            const _Progress(value: 0.78),
            _PinRow(pin: o.strN('pin')),
          ],
        );
      case TrackPhase.arrived:
        return _Block(eyebrow: s('track.arriving'), title: s('track.status.ARRIVED'), children: [
          _BigPin(pin: o.strN('pin')),
          if (rider != null) _RiderCard(rider: rider, orderId: widget.orderId, compact: true),
        ]);
      case TrackPhase.delivered:
        return _Delivered(o: o, onRated: _load);
      case TrackPhase.closed:
        return _Block(title: s('track.status.${o.str('status')}'), body: o.strN('cancelReason'), children: [
          SwButton(label: s('track.reorder'), icon: Ic.rotateCcw, variant: SwButtonVariant.secondary, expand: true, onPressed: () async {
            await _api.post<Json>('/me/orders/${widget.orderId}/reorder');
            ref.invalidate(cartProvider);
            if (context.mounted) context.go('/bag');
          }),
        ]);
    }
  }
}

/* ------------------------------------------------------------------ sheet pieces */

class _Sheet extends StatelessWidget {
  const _Sheet({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Container(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s3, SwSpace.s5, SwSpace.s5 + context.safe.bottom),
      decoration: BoxDecoration(color: c.surface, borderRadius: const BorderRadius.vertical(top: Radius.circular(SwRadius.lg)), boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.14), blurRadius: 40, offset: const Offset(0, -8))]),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 36, height: 4, margin: const EdgeInsets.only(bottom: SwSpace.s4), decoration: BoxDecoration(color: c.hairline, borderRadius: BorderRadius.circular(2))),
        AnimatedSize(duration: SwMotion.slow, curve: SwMotion.atelier, alignment: Alignment.bottomCenter, child: child),
      ]),
    );
  }
}

class _Block extends StatelessWidget {
  const _Block({this.eyebrow, this.title, this.titleWidget, this.body, this.children = const []});
  final String? eyebrow, title, body;
  final Widget? titleWidget;
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
      if (eyebrow != null) Text(caps(eyebrow!), style: context.type.label.copyWith(color: c.muted)),
      if (eyebrow != null) const SizedBox(height: SwSpace.s1),
      titleWidget ?? Text(title ?? '', style: context.type.displayS),
      if (body != null) ...[const SizedBox(height: SwSpace.s2), Text(body!, style: context.type.bodyS.copyWith(color: c.muted))],
      for (final ch in children) Padding(padding: const EdgeInsets.only(top: SwSpace.s4), child: ch),
    ]);
  }
}

class _TopPill extends ConsumerWidget {
  const _TopPill({required this.o, required this.stale});
  final Json o;
  final bool stale;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    return Container(
      height: 36,
      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4),
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.full), boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.12), blurRadius: 16, offset: const Offset(0, 4))]),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(o.str('number'), style: context.type.titleS),
        if (stale) ...[
          const SizedBox(width: SwSpace.s2),
          const ALoader(size: ALoaderSize.xs),
          const SizedBox(width: 4),
          Text(s('common.updating'), style: context.type.caption.copyWith(color: c.muted)),
        ],
      ]),
    );
  }
}

class _StoreLine extends ConsumerWidget {
  const _StoreLine({required this.o});
  final Json o;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    final items = o.list('items');
    return Row(children: [
      SizedBox(
        width: 26.0 * math.min(3, items.length) + 18,
        height: 44,
        child: Stack(children: [
          for (var i = 0; i < math.min(3, items.length); i++)
            Positioned(
              left: i * 26.0,
              child: Container(
                width: 36,
                height: 44,
                decoration: BoxDecoration(borderRadius: BorderRadius.circular(SwRadius.xs), border: Border.all(color: c.surface, width: 2)),
                clipBehavior: Clip.antiAlias,
                child: SwImage(items[i].obj('image'), aspectRatio: null),
              ),
            ),
        ]),
      ),
      const SizedBox(width: SwSpace.s3),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(ref.s('track.storeAt', {'store': o.obj('store')?.str('name') ?? ''}), style: context.type.titleS, maxLines: 1, overflow: TextOverflow.ellipsis),
          Text('${ref.s('checkout.items', {'count': items.fold<int>(0, (a, i) => a + i.integer('qty'))})} · ${formatMoney(o.integer('total'), o.str('currency', 'TZS'))}', style: context.type.caption.copyWith(color: c.muted)),
        ]),
      ),
    ]);
  }
}

/// Thin progress rail; indeterminate shimmer while searching.
class _Progress extends StatefulWidget {
  const _Progress({required this.value});
  final double? value;
  @override
  State<_Progress> createState() => _ProgressState();
}

class _ProgressState extends State<_Progress> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 1600))..repeat();
  @override
  void dispose() {
    _a.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: SizedBox(
        height: 3,
        child: LayoutBuilder(builder: (context, box) {
          if (widget.value == null) {
            return AnimatedBuilder(
              animation: _a,
              builder: (_, _) => Stack(children: [
                Container(color: c.hairline),
                Positioned(left: (box.maxWidth * 1.4) * SwMotion.atelier.transform(_a.value) - box.maxWidth * 0.4, width: box.maxWidth * 0.4, top: 0, bottom: 0, child: Container(color: c.accent)),
              ]),
            );
          }
          return Stack(children: [
            Container(color: c.hairline),
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: widget.value!),
              duration: const Duration(milliseconds: 900),
              curve: SwMotion.atelier,
              builder: (_, v, _) => Container(width: box.maxWidth * v, color: c.ink),
            ),
          ]);
        }),
      ),
    );
  }
}

class _EtaBadge extends ConsumerWidget {
  const _EtaBadge({required this.seconds});
  final int seconds;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s3, vertical: SwSpace.s2),
      decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.sm)),
      child: Column(children: [
        AnimatedSwitcher(
          duration: SwMotion.base,
          transitionBuilder: (ch, a) => FadeTransition(opacity: a, child: SlideTransition(position: Tween(begin: const Offset(0, 0.4), end: Offset.zero).animate(a), child: ch)),
          child: Text('${etaMinutes(seconds)}', key: ValueKey(etaMinutes(seconds)), style: context.type.priceL.copyWith(color: c.onInk, height: 1)),
        ),
        Text(caps(ref.s('track.min')), style: context.type.labelS.copyWith(color: c.accent)),
      ]),
    );
  }
}

class _RiderCard extends ConsumerWidget {
  const _RiderCard({required this.rider, required this.orderId, this.compact = false});
  final Json rider;
  final String orderId;
  final bool compact;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final v = rider.obj('vehicle');
    final photo = rider.obj('photo');
    return Row(children: [
      Stack(clipBehavior: Clip.none, children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(shape: BoxShape.circle, color: c.blush),
          clipBehavior: Clip.antiAlias,
          child: photo != null ? SwImage(photo, aspectRatio: null) : Center(child: Text(rider.str('firstName', 'R').substring(0, 1), style: context.type.displayS)),
        ),
        Positioned(
          right: -4,
          bottom: -2,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
            decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.full), border: Border.all(color: c.hairline)),
            child: Row(mainAxisSize: MainAxisSize.min, children: [Icon(Ic.star, size: 10, color: c.accent), const SizedBox(width: 2), Text(rider.dbl('rating').toStringAsFixed(1), style: context.type.labelS)]),
          ),
        ),
      ]),
      const SizedBox(width: SwSpace.s4),
      Expanded(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(rider.str('name'), style: context.type.titleM, maxLines: 1, overflow: TextOverflow.ellipsis),
          if (v != null && !compact)
            Text([v.str('color'), v.str('make')].where((x) => x.isNotEmpty).join(' '), style: context.type.caption.copyWith(color: c.muted), maxLines: 1),
          if (v != null && v.str('plate').isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(color: c.warningSoft, borderRadius: BorderRadius.circular(SwRadius.xs), border: Border.all(color: c.ink.withValues(alpha: 0.2))),
                child: Text(v.str('plate'), style: context.type.labelS.copyWith(letterSpacing: 1.2)),
              ),
            ),
        ]),
      ),
      SwIconButton(icon: Ic.messageCircle, semanticLabel: s('track.chat'), filled: true, onPressed: () => openOrderChat(context, ref, orderId)),
      const SizedBox(width: SwSpace.s2),
      SwIconButton(icon: Ic.phone, semanticLabel: s('track.call'), filled: true, onPressed: () async {
        final phone = rider.strN('phone') ?? ref.read(orderProvider(orderId)).value?.obj('store')?.strN('phone');
        if (phone != null) await launchUrl(Uri.parse('tel:$phone'));
      }),
    ]);
  }
}

class _PinRow extends ConsumerWidget {
  const _PinRow({required this.pin});
  final String? pin;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (pin == null) return const SizedBox.shrink();
    final s = ref.s;
    final c = context.sw;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
      decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(SwRadius.md)),
      child: Row(children: [
        Icon(Ic.keyRound, size: 18, color: c.ink),
        const SizedBox(width: SwSpace.s3),
        Expanded(child: Text(s('track.pin'), style: context.type.titleS)),
        Text(pin!.split('').join(' '), style: context.type.priceM.copyWith(letterSpacing: 2)),
      ]),
    );
  }
}

class _BigPin extends ConsumerWidget {
  const _BigPin({required this.pin});
  final String? pin;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    if (pin == null) return const SizedBox.shrink();
    return Column(children: [
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        for (final (i, d) in pin!.split('').indexed)
          TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: Duration(milliseconds: 420 + i * 90),
            curve: Curves.easeOutBack,
            builder: (_, v, ch) => Transform.translate(offset: Offset(0, 16 * (1 - v)), child: Opacity(opacity: v.clamp(0, 1), child: ch)),
            child: Container(
              width: 62,
              height: 76,
              margin: const EdgeInsets.symmetric(horizontal: 5),
              alignment: Alignment.center,
              decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.md)),
              child: Text(d, style: context.type.displayL.copyWith(color: c.onInk)),
            ),
          ),
      ]),
      const SizedBox(height: SwSpace.s3),
      Text(s('track.pinHelp'), style: context.type.bodyS.copyWith(color: c.muted), textAlign: TextAlign.center),
      Text(s('track.pinSecret'), style: context.type.caption.copyWith(color: c.subtle), textAlign: TextAlign.center),
    ]);
  }
}

/* ------------------------------------------------------------------ delivered + rating */

class _Delivered extends ConsumerStatefulWidget {
  const _Delivered({required this.o, required this.onRated});
  final Json o;
  final Future<void> Function() onRated;
  @override
  ConsumerState<_Delivered> createState() => _DeliveredState();
}

class _DeliveredState extends ConsumerState<_Delivered> with SingleTickerProviderStateMixin {
  int _stars = 0;
  final _tags = <String>{};
  bool _sent = false;
  late final AnimationController _burst = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..forward();

  @override
  void dispose() {
    _burst.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final canRate = widget.o.flag('canRate') && !_sent;
    final rider = widget.o.obj('delivery')?.obj('rider');
    return Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        height: 96,
        child: AnimatedBuilder(
          animation: _burst,
          builder: (_, _) => CustomPaint(
            painter: _SparkleBurst(context.reduceMotion ? 1 : _burst.value, c.accent, c.ink),
            child: Center(
              child: Transform.scale(
                scale: Curves.easeOutBack.transform((_burst.value * 1.6).clamp(0, 1)),
                child: Container(width: 64, height: 64, decoration: BoxDecoration(shape: BoxShape.circle, color: c.ink), child: Icon(Ic.check, size: 30, color: c.accent)),
              ),
            ),
          ),
        ),
      ),
      Text(s('track.delivered.title'), style: context.type.displayS, textAlign: TextAlign.center),
      const SizedBox(height: SwSpace.s1),
      Text(_sent || !widget.o.flag('canRate') ? s('track.rateThanks') : s('track.delivered.body'), style: context.type.bodyS.copyWith(color: c.muted), textAlign: TextAlign.center),
      if (canRate && rider != null) ...[
        const SizedBox(height: SwSpace.s5),
        Text(s('track.rateRider'), style: context.type.titleS, textAlign: TextAlign.center),
        const SizedBox(height: SwSpace.s2),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          for (var i = 1; i <= 5; i++)
            GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() => _stars = i);
              },
              child: Padding(
                padding: const EdgeInsets.all(6),
                child: AnimatedScale(
                  scale: i <= _stars ? 1.15 : 1,
                  duration: SwMotion.base,
                  curve: Curves.easeOutBack,
                  child: Icon(Ic.star, size: 34, color: i <= _stars ? c.accent : c.hairline),
                ),
              ),
            ),
        ]),
        AnimatedSize(
          duration: SwMotion.base,
          child: _stars == 0
              ? const SizedBox(width: double.infinity)
              : Padding(
                  padding: const EdgeInsets.only(top: SwSpace.s3),
                  child: Wrap(alignment: WrapAlignment.center, spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
                    for (final t in ['fast', 'friendly', 'careful', 'onTime', 'communication'])
                      ChoiceChipSw(label: s('track.tags.$t'), selected: _tags.contains(t), onTap: () => setState(() => _tags.contains(t) ? _tags.remove(t) : _tags.add(t))),
                  ]),
                ),
        ),
        const SizedBox(height: SwSpace.s4),
        SwButton(
          label: s('track.submitRating'),
          large: true,
          expand: true,
          onPressed: _stars == 0
              ? null
              : () async {
                  try {
                    await ref.read(apiProvider).post<Json>('/me/orders/${widget.o.str('id')}/rate', {'riderRating': _stars, 'riderTags': _tags.toList()});
                    setState(() => _sent = true);
                    HapticFeedback.lightImpact();
                    await widget.onRated();
                  } on ApiException catch (e) {
                    if (context.mounted) showSwToast(context, e.message, error: true);
                  }
                },
        ),
      ] else ...[
        const SizedBox(height: SwSpace.s5),
        SwButton(label: s('common.done'), large: true, expand: true, onPressed: () => context.go('/')),
      ],
    ]);
  }
}

/// Elegant gold sparkles fanning out once — celebratory, never confetti-loud.
class _SparkleBurst extends CustomPainter {
  _SparkleBurst(this.t, this.gold, this.ink);
  final double t;
  final Color gold, ink;
  @override
  void paint(Canvas canvas, Size size) {
    final o = size.center(Offset.zero);
    final e = Curves.easeOutCubic.transform(t);
    for (var i = 0; i < 10; i++) {
      final a = i / 10 * math.pi * 2 - math.pi / 2;
      final r = 30 + 46 * e;
      final p = o + Offset(math.cos(a), math.sin(a)) * r;
      final k = (1 - t) * (i.isEven ? 6 : 4);
      if (k <= 0.2) continue;
      final paint = Paint()..color = (i % 3 == 0 ? ink : gold).withValues(alpha: (1 - t).clamp(0, 1));
      final star = Path()
        ..moveTo(p.dx, p.dy - k)
        ..quadraticBezierTo(p.dx, p.dy, p.dx + k, p.dy)
        ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy + k)
        ..quadraticBezierTo(p.dx, p.dy, p.dx - k, p.dy)
        ..quadraticBezierTo(p.dx, p.dy, p.dx, p.dy - k);
      canvas.drawPath(star, paint);
    }
  }

  @override
  bool shouldRepaint(covariant _SparkleBurst o) => o.t != t;
}
