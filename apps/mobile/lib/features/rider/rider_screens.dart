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
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../../ui/sw_map.dart';
import '../chat/chat_screen.dart';
import 'rider_state.dart';

/// Rider Mode home: a full-screen map with the rider's blue dot and the stores, today's numbers,
/// and one big Go online / Go offline control. Offers and the active job take over the screen.
class RiderHomeScreen extends ConsumerWidget {
  const RiderHomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final st = ref.watch(riderProvider);
    return st.when(
      loading: () => Scaffold(body: ALoaderBlock(message: s('loader.preparing'))),
      error: (e, _) => Scaffold(
        body: EmptyState(
          title: s('common.error.title'),
          body: e is ApiException ? e.message : null,
          icon: Ic.bike,
          action: SwButton(label: s('rider.switchToShopping'), onPressed: () => context.go('/')),
        ),
      ),
      data: (r) {
        if (r.justCompleted != null) return _Completed(job: r.justCompleted!);
        if (r.job != null) return _JobScreen(st: r);
        return Stack(
          children: [
            _Idle(st: r),
            if (r.offer != null) Positioned.fill(child: _OfferOverlay(offer: r.offer!)),
          ],
        );
      },
    );
  }
}

/* ================================================================== idle / online map */

class _Idle extends ConsumerWidget {
  const _Idle({required this.st});
  final RiderState st;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final rider = st.rider;
    final today = rider.obj('today') ?? const {};
    final cur = rider.str('currency', 'TZS');
    final here = st.here ?? LatLngD.fromJson(rider.obj('location')) ?? (st.stores.isNotEmpty ? LatLngD.fromJson(st.stores.first['location']) : null);
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: SwMap(
              fitKey: 'idle-${st.stores.length}',
              padding: EdgeInsets.only(top: context.safe.top + 150, bottom: 220 + context.safe.bottom),
              searching: st.online,
              markers: [
                for (final x in st.stores) SwMarker('s${x.str('id')}', PinKind.store, LatLngD.fromJson(x['location'])!, label: x.str('name')),
                if (here != null && st.online) SwMarker('me', PinKind.rider, here),
              ],
            ),
          ),
          // Header: identity + today
          Positioned(
            top: context.safe.top + SwSpace.s2,
            left: SwSpace.s4,
            right: SwSpace.s4,
            child: Column(
              children: [
                Row(
                  children: [
                    SwIconButton(icon: Ic.shoppingBag, semanticLabel: s('rider.switchToShopping'), filled: true, onPressed: () => context.go('/')),
                    const SizedBox(width: SwSpace.s3),
                    Expanded(
                      child: Container(
                        height: 44,
                        padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4),
                        decoration: BoxDecoration(
                          color: c.surface,
                          borderRadius: BorderRadius.circular(SwRadius.full),
                          boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.1), blurRadius: 16, offset: const Offset(0, 4))],
                        ),
                        child: Row(
                          children: [
                            AnimatedContainer(
                              duration: SwMotion.base,
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(shape: BoxShape.circle, color: st.online ? c.success : c.subtle),
                            ),
                            const SizedBox(width: SwSpace.s2),
                            Expanded(child: Text(st.online ? s('rider.online') : s('rider.offline'), style: context.type.titleS)),
                            if (st.online && today.integer('onlineMinutes') > 0)
                              Text(
                                today.integer('onlineMinutes') >= 60
                                    ? s('rider.onlineForHours', {'hours': today.integer('onlineMinutes') ~/ 60, 'minutes': today.integer('onlineMinutes') % 60})
                                    : s('rider.onlineFor', {'minutes': today.integer('onlineMinutes')}),
                                style: context.type.caption.copyWith(color: c.muted),
                              ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: SwSpace.s3),
                    SwIconButton(icon: Ic.wallet, semanticLabel: s('rider.earnings'), filled: true, onPressed: () => context.push('/rider/earnings')),
                  ],
                ),
                const SizedBox(height: SwSpace.s3),
                Container(
                  padding: const EdgeInsets.symmetric(vertical: SwSpace.s3),
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: BorderRadius.circular(SwRadius.md),
                    boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.08), blurRadius: 20, offset: const Offset(0, 6))],
                  ),
                  child: Row(
                    children: [
                      _Stat(label: s('rider.todayEarnings'), value: formatMoney(today.integer('earnings'), cur)),
                      Container(width: 1, height: 32, color: c.hairline),
                      _Stat(label: s('rider.deliveries'), value: '${today.integer('deliveries')}'),
                      Container(width: 1, height: 32, color: c.hairline),
                      _Stat(label: s('rider.rating'), value: rider.dbl('rating').toStringAsFixed(1), icon: Ic.star),
                    ],
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s5, SwSpace.s5, SwSpace.s5 + context.safe.bottom),
              decoration: BoxDecoration(
                color: c.surface,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(SwRadius.lg)),
                boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.12), blurRadius: 40, offset: const Offset(0, -8))],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!st.approved)
                    Padding(
                      padding: const EdgeInsets.only(bottom: SwSpace.s4),
                      child: Text(
                        s('rider.notApproved'),
                        style: context.type.bodyS.copyWith(color: c.warning),
                        textAlign: TextAlign.center,
                      ),
                    )
                  else
                    Padding(
                      padding: const EdgeInsets.only(bottom: SwSpace.s4),
                      child: AnimatedSwitcher(
                        duration: SwMotion.base,
                        child: Text(st.online ? s('rider.waiting') : s('rider.offline'), key: ValueKey(st.online), style: context.type.displayS, textAlign: TextAlign.center),
                      ),
                    ),
                  _OnlineSlider(online: st.online, enabled: st.approved),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value, this.icon});
  final String label, value;
  final IconData? icon;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Expanded(
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null) ...[Icon(icon, size: 14, color: c.accent), const SizedBox(width: 3)],
              Flexible(
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(value, style: context.type.priceM),
                ),
              ),
            ],
          ),
          Text(caps(label), style: context.type.labelS.copyWith(color: c.muted)),
        ],
      ),
    );
  }
}

/// Big pill toggle: tap or slide the knob. Ink when offline ("Go online"), success when online.
class _OnlineSlider extends ConsumerStatefulWidget {
  const _OnlineSlider({required this.online, required this.enabled});
  final bool online, enabled;
  @override
  ConsumerState<_OnlineSlider> createState() => _OnlineSliderState();
}

class _OnlineSliderState extends ConsumerState<_OnlineSlider> {
  bool _busy = false;

  Future<void> _toggle() async {
    if (_busy || !widget.enabled) return;
    setState(() => _busy = true);
    try {
      final err = await ref.read(riderProvider.notifier).setOnline(!widget.online);
      if (err != null && mounted) showSwToast(context, ref.s(err), error: true);
    } on ApiException catch (e) {
      if (mounted) showSwToast(context, e.message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final on = widget.online;
    return Semantics(
      button: true,
      toggled: on,
      label: on ? s('rider.goOffline') : s('rider.goOnline'),
      child: GestureDetector(
        onTap: _toggle,
        onHorizontalDragEnd: (d) {
          final v = d.primaryVelocity ?? 0;
          if ((v > 200 && !on) || (v < -200 && on)) _toggle();
        },
        child: Opacity(
          opacity: widget.enabled ? 1 : 0.4,
          child: AnimatedContainer(
            duration: SwMotion.slow,
            curve: SwMotion.atelier,
            height: 64,
            decoration: BoxDecoration(color: on ? c.success : c.ink, borderRadius: BorderRadius.circular(SwRadius.full)),
            child: LayoutBuilder(
              builder: (context, box) {
                const k = 54.0;
                return Stack(
                  children: [
                    Center(
                      child: AnimatedSwitcher(
                        duration: SwMotion.base,
                        child: Text(
                          on ? s('rider.goOffline') : s('rider.goOnline'),
                          key: ValueKey(on),
                          style: context.type.titleM.copyWith(color: c.onInk),
                        ),
                      ),
                    ),
                    AnimatedPositioned(
                      duration: SwMotion.slow,
                      curve: Curves.easeOutBack,
                      left: on ? box.maxWidth - k - 5 : 5,
                      top: 5,
                      child: Container(
                        width: k,
                        height: k,
                        decoration: BoxDecoration(shape: BoxShape.circle, color: c.surface),
                        child: Center(
                          child: _busy ? const ALoader(size: ALoaderSize.sm) : Icon(on ? Ic.pause : Ic.bike, color: on ? c.success : c.ink, size: 24),
                        ),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

/* ================================================================== incoming offer */

class _OfferOverlay extends ConsumerStatefulWidget {
  const _OfferOverlay({required this.offer});
  final Json offer;
  @override
  ConsumerState<_OfferOverlay> createState() => _OfferOverlayState();
}

class _OfferOverlayState extends ConsumerState<_OfferOverlay> with SingleTickerProviderStateMixin {
  late final int _total = math.max(1, widget.offer.integer('timeoutSeconds', 20));
  late final AnimationController _ring = AnimationController(
    vsync: this,
    duration: Duration(seconds: _total),
  )..forward();
  Timer? _buzz;

  @override
  void initState() {
    super.initState();
    HapticFeedback.heavyImpact();
    // A gentle repeating vibration until the rider decides (or it expires).
    _buzz = Timer.periodic(const Duration(seconds: 2), (_) => HapticFeedback.mediumImpact());
    _ring.addStatusListener((st) {
      if (st == AnimationStatus.completed) ref.read(riderProvider.notifier).offerExpired();
    });
  }

  @override
  void dispose() {
    _buzz?.cancel();
    _ring.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final o = widget.offer;
    final store = o.obj('store') ?? const {};
    return Material(
      color: c.overlay,
      child: SafeArea(
        child: Align(
          alignment: Alignment.bottomCenter,
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: 1),
            duration: SwMotion.slow,
            curve: Curves.easeOutBack,
            builder: (_, v, ch) => Transform.translate(
              offset: Offset(0, 80 * (1 - v)),
              child: Opacity(opacity: v.clamp(0, 1), child: ch),
            ),
            child: Container(
              margin: const EdgeInsets.all(SwSpace.s3),
              padding: const EdgeInsets.all(SwSpace.s6),
              decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.lg)),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(caps(s('rider.newRequest')), style: context.type.label.copyWith(color: c.accent)),
                            const SizedBox(height: SwSpace.s1),
                            Text(formatMoney(o.integer('earning'), o.str('currency', 'TZS')), style: context.type.displayL),
                            Text(s('rider.estimatedEarning'), style: context.type.caption.copyWith(color: c.muted)),
                          ],
                        ),
                      ),
                      AnimatedBuilder(
                        animation: _ring,
                        builder: (_, _) {
                          final left = (_total * (1 - _ring.value)).ceil();
                          return SizedBox(
                            width: 76,
                            height: 76,
                            child: CustomPaint(
                              painter: _RingPainter(1 - _ring.value, left <= 5 ? c.danger : c.ink, c.hairline),
                              child: Center(
                                child: Text(s('rider.offerExpires', {'seconds': left}), style: context.type.priceM.copyWith(color: left <= 5 ? c.danger : c.ink)),
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: SwSpace.s5),
                  _Leg(
                    icon: Ic.store,
                    color: c.mapOffice,
                    title: store.str('name'),
                    subtitle: '${s('rider.pickup')} · ${s('rider.toStore', {'distance': fmtDistance(o['distanceToStoreMeters'] as num?)})}',
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(left: 19),
                      child: _DashedConnector(color: c.muted),
                    ),
                  ),
                  _Leg(
                    icon: Ic.mapPin,
                    color: c.mapClient,
                    title: o.obj('dropoffArea')?.str('label') ?? '',
                    subtitle: '${s('rider.dropoff')} · ${s('rider.trip', {'distance': fmtDistance(o['tripDistanceMeters'] as num?)})}',
                  ),
                  const SizedBox(height: SwSpace.s3),
                  Row(
                    children: [
                      Icon(Ic.package, size: 14, color: c.muted),
                      const SizedBox(width: 6),
                      Text(s('rider.items', {'count': o.integer('items')}), style: context.type.caption.copyWith(color: c.muted)),
                    ],
                  ),
                  const SizedBox(height: SwSpace.s6),
                  Row(
                    children: [
                      Expanded(
                        flex: 2,
                        child: SwButton(label: s('rider.decline'), variant: SwButtonVariant.secondary, large: true, onPressed: () => ref.read(riderProvider.notifier).decline(o.integer('id'))),
                      ),
                      const SizedBox(width: SwSpace.s3),
                      Expanded(
                        flex: 3,
                        child: SwButton(
                          label: s('rider.accept'),
                          icon: Ic.check,
                          variant: SwButtonVariant.premium,
                          large: true,
                          haptic: true,
                          onPressed: () async {
                            try {
                              await ref.read(riderProvider.notifier).accept(o.integer('id'));
                            } on ApiException catch (e) {
                              if (context.mounted) showSwToast(context, e.message, error: true);
                              ref.read(riderProvider.notifier).offerExpired();
                            }
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.t, this.color, this.track);
  final double t;
  final Color color, track;
  @override
  void paint(Canvas canvas, Size size) {
    final r = Rect.fromLTWH(3, 3, size.width - 6, size.height - 6);
    canvas.drawArc(
      r,
      0,
      math.pi * 2,
      false,
      Paint()
        ..color = track
        ..strokeWidth = 4
        ..style = PaintingStyle.stroke,
    );
    canvas.drawArc(
      r,
      -math.pi / 2,
      math.pi * 2 * t,
      false,
      Paint()
        ..color = color
        ..strokeWidth = 4
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter o) => o.t != t || o.color != color;
}

/// Store → drop-off connector: a short stitched line, echoing the A loader's crossbar.
class _DashedConnector extends StatelessWidget {
  const _DashedConnector({required this.color});
  final Color color;
  @override
  Widget build(BuildContext context) => SizedBox(
    width: 2,
    height: 22,
    child: Column(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [for (var i = 0; i < 4; i++) Container(width: 2, height: 3, color: color.withValues(alpha: 0.5))],
    ),
  );
}

class _Leg extends StatelessWidget {
  const _Leg({required this.icon, required this.color, required this.title, required this.subtitle});
  final IconData icon;
  final Color color;
  final String title, subtitle;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(shape: BoxShape.circle, color: color),
          child: Icon(icon, size: 18, color: c.mapRing),
        ),
        const SizedBox(width: SwSpace.s3),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: context.type.titleM, maxLines: 1, overflow: TextOverflow.ellipsis),
              Text(subtitle, style: context.type.caption.copyWith(color: c.muted)),
            ],
          ),
        ),
      ],
    );
  }
}

/* ================================================================== active job */

class _JobScreen extends ConsumerWidget {
  const _JobScreen({required this.st});
  final RiderState st;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final j = st.job!;
    final status = j.str('status');
    final toStore = status == 'ACCEPTED' || status == 'AT_STORE';
    final store = LatLngD.fromJson(j.obj('store')?['location']);
    final drop = LatLngD.fromJson(j.obj('dropoff')?['location']);
    final route = decodePolyline(j.strN('route'));
    final here = st.here;
    final target = toStore ? store : drop;
    final collect = j.obj('payment')?.integer('collect') ?? 0;
    final cur = j.str('currency', 'TZS');
    final (label, step, icon) = switch (status) {
      'ACCEPTED' => (s('rider.arrivedAtStore'), 'AT_STORE', Ic.store),
      'AT_STORE' => (s('rider.pickedUp'), 'PICKED_UP', Ic.package),
      'PICKED_UP' || 'EN_ROUTE' => (s('rider.arrived'), 'ARRIVED', Ic.mapPin),
      _ => (j.flag('pinRequired') ? s('rider.enterPin') : s('rider.complete'), 'COMPLETED', Ic.keyRound),
    };
    final stepKey = switch (status) {
      'ACCEPTED' => 'ACCEPTED',
      'AT_STORE' => 'AT_STORE',
      'ARRIVED' => 'ARRIVED',
      _ => 'EN_ROUTE',
    };
    final person = j.obj('customer');

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: SwMap(
              fitKey: 'job-$status',
              padding: EdgeInsets.only(top: context.safe.top + 90, bottom: 330 + context.safe.bottom, left: 24, right: 24),
              markers: [if (store != null) SwMarker('store', PinKind.store, store), if (drop != null) SwMarker('drop', PinKind.client, drop), if (here != null) SwMarker('me', PinKind.rider, here)],
              routes: [
                if (route.isNotEmpty) SwRoute('r', route) else if (here != null && target != null) SwRoute('r', [here, target], dashed: true),
              ],
            ),
          ),
          Positioned(
            top: context.safe.top + SwSpace.s2,
            left: SwSpace.s4,
            right: SwSpace.s4,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
              decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.md)),
              child: Row(
                children: [
                  Icon(toStore ? Ic.store : Ic.navigation, color: c.accent, size: 22),
                  const SizedBox(width: SwSpace.s3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(s('rider.step.$stepKey'), style: context.type.titleM.copyWith(color: c.onInk)),
                        Text(
                          toStore ? (j.obj('store')?.str('address') ?? '') : (j.obj('dropoff')?.str('label') ?? ''),
                          style: context.type.caption.copyWith(color: c.onInk.withValues(alpha: 0.7)),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  if (!toStore && j.integer('etaSeconds') > 0) ...[
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('${(j.integer('etaSeconds') / 60).ceil()}', style: context.type.priceM.copyWith(color: c.onInk)),
                        Text(caps(s('track.min')), style: context.type.labelS.copyWith(color: c.accent)),
                      ],
                    ),
                    const SizedBox(width: SwSpace.s2),
                  ],
                  if (j.strN('navigationUrl') != null)
                    SwIconButton(
                      icon: Ic.externalLink,
                      semanticLabel: s('rider.openInMaps'),
                      color: c.onInk,
                      onPressed: () => launchUrl(Uri.parse(j.str('navigationUrl')), mode: LaunchMode.externalApplication),
                    ),
                ],
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: Container(
              padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s5, SwSpace.s5, SwSpace.s5 + context.safe.bottom),
              decoration: BoxDecoration(
                color: c.surface,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(SwRadius.lg)),
                boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.14), blurRadius: 40, offset: const Offset(0, -8))],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _JobSteps(status: status),
                  const SizedBox(height: SwSpace.s4),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(j.str('orderNumber'), style: context.type.label.copyWith(color: c.muted)),
                            Text(
                              toStore ? j.obj('store')?.str('name') ?? '' : (person?.str('firstName') ?? j.obj('dropoff')?.str('area') ?? ''),
                              style: context.type.displayS,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (!toStore && j.obj('dropoff')?.strN('landmark') != null) Text('“${j.obj('dropoff')!.str('landmark')}”', style: context.type.caption.copyWith(color: c.muted)),
                            if (toStore)
                              Text(
                                j.list('items').map((i) => '${i.integer('qty')}× ${i.str('title')}').join(', '),
                                style: context.type.caption.copyWith(color: c.muted),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                          ],
                        ),
                      ),
                      if (!toStore) ...[
                        SwIconButton(icon: Ic.messageCircle, semanticLabel: s('track.chat'), filled: true, onPressed: () => openOrderChat(context, ref, j.str('orderId'))),
                        const SizedBox(width: SwSpace.s2),
                      ],
                      SwIconButton(
                        icon: Ic.phone,
                        semanticLabel: toStore ? s('track.call') : s('rider.callCustomer'),
                        filled: true,
                        onPressed: () async {
                          final p = toStore ? j.obj('store')?.strN('phone') : person?.strN('phone');
                          if (p != null) await launchUrl(Uri.parse('tel:$p'));
                        },
                      ),
                    ],
                  ),
                  if (collect > 0) ...[
                    const SizedBox(height: SwSpace.s3),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
                      decoration: BoxDecoration(color: c.warningSoft, borderRadius: BorderRadius.circular(SwRadius.md)),
                      child: Row(
                        children: [
                          Icon(Ic.banknote, size: 18, color: c.warning),
                          const SizedBox(width: SwSpace.s3),
                          Text(s('rider.cashToCollect', {'amount': formatMoney(collect, cur)}), style: context.type.titleS),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: SwSpace.s4),
                  SwButton(
                    label: label,
                    icon: icon,
                    large: true,
                    expand: true,
                    haptic: true,
                    variant: step == 'COMPLETED' ? SwButtonVariant.premium : SwButtonVariant.primary,
                    onPressed: () async {
                      try {
                        if (step == 'COMPLETED' && j.flag('pinRequired')) {
                          final pin = await showSwSheet<String>(context, title: s('rider.enterPin'), builder: (_) => const _PinSheet());
                          if (pin == null) return;
                          await ref.read(riderProvider.notifier).step('COMPLETED', pin: pin);
                        } else {
                          await ref.read(riderProvider.notifier).step(step);
                        }
                      } on ApiException catch (e) {
                        if (context.mounted) showSwToast(context, e.message, error: true);
                      }
                    },
                  ),
                  if (toStore) SwButton(label: s('rider.release'), variant: SwButtonVariant.ghost, expand: true, onPressed: () => ref.read(riderProvider.notifier).release('rider_unavailable')),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _JobSteps extends StatelessWidget {
  const _JobSteps({required this.status});
  final String status;
  static const _order = ['ACCEPTED', 'AT_STORE', 'EN_ROUTE', 'ARRIVED'];
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final idx = math.max(0, _order.indexOf(status == 'PICKED_UP' ? 'EN_ROUTE' : status));
    return Row(
      children: [
        for (var i = 0; i < _order.length; i++)
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(right: i < _order.length - 1 ? 4 : 0),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: TweenAnimationBuilder<double>(
                  tween: Tween(
                    begin: 0,
                    end: i < idx
                        ? 1
                        : i == idx
                        ? 0.5
                        : 0,
                  ),
                  duration: const Duration(milliseconds: 700),
                  curve: SwMotion.atelier,
                  builder: (_, v, _) => LinearProgressIndicator(value: v, minHeight: 4, backgroundColor: c.hairline, color: c.ink),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _PinSheet extends ConsumerStatefulWidget {
  const _PinSheet();
  @override
  ConsumerState<_PinSheet> createState() => _PinSheetState();
}

class _PinSheetState extends ConsumerState<_PinSheet> {
  final _c = TextEditingController();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    return Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s6 + MediaQuery.viewInsetsOf(context).bottom + context.safe.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            s('rider.pinHelp'),
            style: context.type.bodyS.copyWith(color: context.sw.muted),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: SwSpace.s5),
          OtpInput(controller: _c, length: 4, onCompleted: (v) => Navigator.of(context).pop(v)),
        ],
      ),
    );
  }
}

/* ================================================================== completed */

class _Completed extends ConsumerWidget {
  const _Completed({required this.job});
  final Json job;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    return Scaffold(
      backgroundColor: c.ink,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(SwSpace.s6),
          child: Column(
            children: [
              const Spacer(),
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: 1),
                duration: const Duration(milliseconds: 700),
                curve: Curves.easeOutBack,
                builder: (_, v, ch) => Transform.scale(scale: v, child: ch),
                child: Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(shape: BoxShape.circle, color: c.accent),
                  child: Icon(Ic.check, size: 44, color: c.onAccent),
                ),
              ),
              const SizedBox(height: SwSpace.s8),
              Text(s('rider.delivered'), style: context.type.displayL.copyWith(color: c.onInk)),
              const SizedBox(height: SwSpace.s2),
              Text(
                s('rider.deliveredBody', {'amount': formatMoney(job.integer('earning'), job.str('currency', 'TZS'))}),
                style: context.type.bodyM.copyWith(color: c.onInk.withValues(alpha: 0.75)),
                textAlign: TextAlign.center,
              ),
              const Spacer(),
              SwButton(label: s('rider.backOnline'), variant: SwButtonVariant.premium, large: true, expand: true, onPressed: () => ref.read(riderProvider.notifier).dismissCompleted()),
            ],
          ),
        ),
      ),
    );
  }
}

/* ================================================================== earnings */

class RiderEarningsScreen extends ConsumerWidget {
  const RiderEarningsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final h = ref.watch(riderHistoryProvider);
    final cur = ref.watch(riderProvider).value?.rider.str('currency', 'TZS') ?? 'TZS';
    return Scaffold(
      appBar: AppBar(
        leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.pop()),
        title: Text(s('rider.earnings'), style: context.type.displayS),
      ),
      body: h.when(
        loading: () => const Center(child: ALoader(size: ALoaderSize.lg)),
        error: (e, _) => EmptyState(title: s('common.error.title')),
        data: (d) {
          final week = _fillWeek(d.list('week'));
          final total = week.fold<int>(0, (a, x) => a + x.integer('earnings'));
          final trips = week.fold<int>(0, (a, x) => a + x.integer('deliveries'));
          return ListView(
            padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s10 + context.safe.bottom),
            children: [
              Text(caps(s('rider.weekEarnings')), style: context.type.label.copyWith(color: c.muted)),
              const SizedBox(height: SwSpace.s1),
              TweenAnimationBuilder<double>(
                tween: Tween(begin: 0, end: total.toDouble()),
                duration: const Duration(milliseconds: 900),
                curve: SwMotion.atelier,
                builder: (_, v, _) => Text(formatMoney(v.round(), cur), style: context.type.displayL),
              ),
              Text(s('rider.tripCount', {'count': trips}), style: context.type.caption.copyWith(color: c.muted)),
              const SizedBox(height: SwSpace.s6),
              _WeekBars(week: week, currency: cur),
            if (d.obj('balance') != null) ...[
              const SizedBox(height: SwSpace.s3),
              Reveal(child: _BalanceCard(balance: d.obj('balance')!, currency: cur)),
            ],
            if (d.list('payouts').isNotEmpty) ...[
              SectionHeader(s('rider.payouts'), padding: const EdgeInsets.only(top: SwSpace.s8, bottom: SwSpace.s2)),
              for (final (k, p) in d.list('payouts').indexed) Reveal(index: k, child: _PayoutRow(p: p)),
            ],
              SectionHeader(
                s('rider.history'),
                padding: const EdgeInsets.only(top: SwSpace.s8, bottom: SwSpace.s2),
              ),
              for (final (k, j) in d.list('items').indexed)
                Reveal(
                  index: k,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: SwSpace.s3),
                    child: Row(
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: j.str('status') == 'COMPLETED' ? c.successSoft : c.ink.withValues(alpha: 0.05)),
                          child: Icon(j.str('status') == 'COMPLETED' ? Ic.check : Ic.x, size: 18, color: j.str('status') == 'COMPLETED' ? c.success : c.muted),
                        ),
                        const SizedBox(width: SwSpace.s3),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${j.str('orderNumber')} · ${j.strN('area') ?? j.str('store')}', style: context.type.titleS),
                              Text('${j.str('store')} · ${fmtDistance(j['distanceMeters'] as num?)}', style: context.type.caption.copyWith(color: c.muted)),
                            ],
                          ),
                        ),
                        Text(j.integer('earning') > 0 ? formatMoney(j.integer('earning'), cur) : '—', style: context.type.priceS),
                      ],
                    ),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

/// The API returns only days with activity; the chart always shows the last 7 days.
List<Json> _fillWeek(List<Json> days) {
  final by = {for (final d in days) d.str('date'): d};
  final today = DateTime.now();
  return [
    for (var i = 6; i >= 0; i--)
      () {
        final day = DateTime(today.year, today.month, today.day).subtract(Duration(days: i));
        final key = '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';
        return <String, dynamic>{'date': key, 'weekday': day.weekday, 'earnings': by[key]?.integer('earnings') ?? 0, 'deliveries': by[key]?.integer('deliveries') ?? 0};
      }(),
  ];
}

class _WeekBars extends ConsumerStatefulWidget {
  const _WeekBars({required this.week, required this.currency});
  final List<Json> week;
  final String currency;
  @override
  ConsumerState<_WeekBars> createState() => _WeekBarsState();
}

class _WeekBarsState extends ConsumerState<_WeekBars> {
  late int _sel = widget.week.lastIndexWhere((d) => d.integer('earnings') > 0).clamp(0, widget.week.length - 1);

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final s = ref.s;
    final maxE = widget.week.fold<int>(1, (a, x) => math.max(a, x.integer('earnings')));
    final sel = widget.week[_sel];
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    return Container(
      padding: const EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s4, SwSpace.s4, SwSpace.s3),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(SwRadius.md),
        border: Border.all(color: c.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AnimatedSwitcher(
            duration: SwMotion.fast,
            child: Row(
              key: ValueKey(_sel),
              children: [
                Text(formatMoney(sel.integer('earnings'), widget.currency), style: context.type.priceM),
                const SizedBox(width: SwSpace.s2),
                Text('· ${s('rider.tripCount', {'count': sel.integer('deliveries')})}', style: context.type.caption.copyWith(color: c.muted)),
              ],
            ),
          ),
          const SizedBox(height: SwSpace.s4),
          SizedBox(
            height: 120,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (var i = 0; i < widget.week.length; i++)
                  Expanded(
                    child: Semantics(
                      button: true,
                      label: '${widget.week[i].str('date')}: ${formatMoney(widget.week[i].integer('earnings'), widget.currency)}',
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: () {
                          HapticFeedback.selectionClick();
                          setState(() => _sel = i);
                        },
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0, end: widget.week[i].integer('earnings') / maxE),
                              duration: Duration(milliseconds: 600 + i * 70),
                              curve: SwMotion.atelier,
                              builder: (_, v, _) => AnimatedContainer(
                                duration: SwMotion.fast,
                                width: 22,
                                height: 4 + 84 * v,
                                decoration: BoxDecoration(
                                  color: i == _sel ? c.accent : (widget.week[i].integer('earnings') > 0 ? c.ink : c.hairline),
                                  borderRadius: const BorderRadius.vertical(top: Radius.circular(6), bottom: Radius.circular(2)),
                                ),
                              ),
                            ),
                            const SizedBox(height: SwSpace.s2),
                            Text(days[(widget.week[i].integer('weekday') - 1) % 7], style: context.type.labelS.copyWith(color: i == _sel ? c.ink : c.muted)),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends ConsumerWidget {
  const _BalanceCard({required this.balance, required this.currency});
  final Json balance;
  final String currency;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    final s = ref.s;
    final earned = balance.integer('earned');
    final paid = balance.integer('paid');
    return Container(
      padding: const EdgeInsets.all(SwSpace.s4),
      decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.md)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(caps(s('rider.unpaid')), style: context.type.label.copyWith(color: c.accent)),
        const SizedBox(height: SwSpace.s1),
        CountUpMoney(balance.integer('unpaid'), currency: currency, style: context.type.displayM.copyWith(color: c.onInk)),
        const SizedBox(height: SwSpace.s3),
        ClipRRect(
          borderRadius: BorderRadius.circular(SwRadius.full),
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0, end: earned == 0 ? 0 : paid / earned),
            duration: const Duration(milliseconds: 900),
            curve: SwMotion.atelier,
            builder: (_, v, _) => LinearProgressIndicator(value: v, minHeight: 4, backgroundColor: c.onInk.withValues(alpha: 0.15), valueColor: AlwaysStoppedAnimation(c.accent)),
          ),
        ),
        const SizedBox(height: SwSpace.s2),
        Text(s('rider.unpaidHint'), style: context.type.caption.copyWith(color: c.onInk.withValues(alpha: 0.7))),
      ]),
    );
  }
}

class _PayoutRow extends ConsumerWidget {
  const _PayoutRow({required this.p});
  final Json p;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    final s = ref.s;
    final st = p.str('status');
    final (bg, fg, icon) = switch (st) {
      'COMPLETED' => (c.successSoft, c.success, Ic.check),
      'PENDING' => (c.warningSoft, c.warning, Ic.clock),
      _ => (c.dangerSoft, c.danger, Ic.x),
    };
    final when = DateTime.tryParse(p.str('completedAt', p.str('createdAt')))?.toLocal();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: SwSpace.s3),
      child: Row(children: [
        Container(width: 40, height: 40, decoration: BoxDecoration(shape: BoxShape.circle, color: bg), child: Icon(icon, size: 18, color: fg)),
        const SizedBox(width: SwSpace.s3),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s('rider.payout.$st'), style: context.type.titleS),
            Text(
              [p.str('method') == 'manual' ? s('rider.payout.manual') : (p.strN('recipient') ?? ''), if (when != null) '${when.day}/${when.month}/${when.year}'].where((x) => x.isNotEmpty).join(' · '),
              style: context.type.caption.copyWith(color: c.muted),
            ),
          ]),
        ),
        Text(formatMoney(p.integer('amount'), p.str('currency', 'TZS')), style: context.type.priceS),
      ]),
    );
  }
}
