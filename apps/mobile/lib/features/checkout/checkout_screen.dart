import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/geo.dart';
import '../../core/location.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../../ui/sw_map.dart';
import 'checkout_state.dart';
import 'place_picker.dart';

/// One screen, no forms: location from GPS (or the picker), contact from the profile, payment
/// from the saved method. Everything priced by the server quote; "Place order" commits it.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});
  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _idem = 'co-${DateTime.now().microsecondsSinceEpoch}-${math.Random().nextInt(1 << 32)}';
  bool _placing = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(deliveryPointProvider.notifier).init());
  }

  Future<void> _place(Json q) async {
    final s = ref.s;
    final dp = ref.read(deliveryPointProvider).point!;
    final choice = ref.read(checkoutChoiceProvider);
    final method = choice.method ?? q.obj('payment')?.obj('default')?.strN('method');
    setState(() => _placing = true);
    try {
      final o = await ref
          .read(apiProvider)
          .post<Json>(
            '/orders',
            {
              'lat': dp.point.lat,
              'lng': dp.point.lng,
              'deliveryOptionId': q.strN('selectedOptionId'),
              'expectedTotal': q.obj('cart')?.integer('total'),
              'paymentMethod': method,
              if (choice.msisdn != null) 'msisdn': choice.msisdn,
              if (dp.label != null) 'label': dp.label,
              if (dp.area != null) 'area': dp.area,
              if (dp.landmark != null) 'landmarkNote': dp.landmark,
              if (choice.extra.isNotEmpty) 'extraFields': choice.extra,
            },
            {'Idempotency-Key': _idem},
          );
      HapticFeedback.mediumImpact();
      ref.invalidate(cartProvider);
      ref.invalidate(ordersProvider);
      if (!mounted) return;
      final pay = o.obj('payment');
      if (pay?.str('method') == 'MOBILE_MONEY' && pay?.str('status') != 'PAID') {
        context.go('/orders/${o.str('id')}/pay');
      } else {
        context.go('/orders/${o.str('id')}/track');
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'total_changed' || e.code == 'checkout_problems') {
        ref.invalidate(quoteProvider);
        showSwToast(context, s('checkout.priceChanged'), error: true);
      } else {
        showSwToast(context, e.message, error: true);
      }
    } finally {
      if (mounted) setState(() => _placing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final dps = ref.watch(deliveryPointProvider);
    final quote = ref.watch(quoteProvider);
    final q = quote.value;
    final mapH = math.min(360.0, MediaQuery.sizeOf(context).height * 0.42);
    final dest = dps.point?.point;
    final store = LatLngD.fromJson(q?.obj('store')?['location']);
    final route = decodePolyline(q?.obj('route')?.strN('polyline'));

    return Scaffold(
      body: Stack(
        children: [
          CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: SizedBox(
                  height: mapH,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (dest != null)
                        SwMap(
                          interactive: false,
                          fitKey: '${dest.lat},${dest.lng},${store?.lat}',
                          padding: const EdgeInsets.fromLTRB(24, 90, 24, 96),
                          markers: [
                            if (store != null) SwMarker('store', PinKind.store, store, label: q?.obj('store')?.str('name')),
                            SwMarker('me', PinKind.client, dest),
                          ],
                          routes: [
                            if (store != null) SwRoute('r', route.isNotEmpty ? route : [store, dest], dashed: route.isEmpty),
                          ],
                        )
                      else
                        _NoLocation(permission: dps.permission, locating: dps.locating),
                      // Soft fade into the sheet below.
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: 90,
                        child: IgnorePointer(
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [c.canvas.withValues(alpha: 0), c.canvas]),
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        top: context.safe.top + SwSpace.s2,
                        left: SwSpace.s4,
                        child: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), filled: true, onPressed: () => context.pop()),
                      ),
                      Positioned(
                        top: context.safe.top + SwSpace.s4,
                        left: 0,
                        right: 0,
                        child: IgnorePointer(
                          child: Center(child: Text(s('checkout.title'), style: context.type.titleM)),
                        ),
                      ),
                      if (dest != null)
                        Positioned(
                          left: SwSpace.s4,
                          right: SwSpace.s4,
                          bottom: SwSpace.s2,
                          child: _DeliverToCard(dps: dps),
                        ),
                    ],
                  ),
                ),
              ),
              SliverPadding(
                padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, 160 + context.safe.bottom),
                sliver: SliverList.list(
                  children: [
                    if (dest == null)
                      const SizedBox.shrink()
                    else if (quote.isLoading && q == null) ...[
                      for (var i = 0; i < 3; i++)
                        const Padding(
                          padding: EdgeInsets.only(bottom: SwSpace.s3),
                          child: Skeleton(height: 72, radius: SwRadius.md),
                        ),
                    ] else if (quote.hasError)
                      EmptyState(
                        title: s('common.error.title'),
                        body: (quote.error is ApiException) ? (quote.error as ApiException).message : null,
                        action: SwButton(label: s('common.retry'), onPressed: () => ref.invalidate(quoteProvider)),
                      )
                    else if (q != null) ...[
                      for (final p in q.list('problems')) _Problem(p: p),
                      _Section(s('checkout.deliveryOption')),
                      _OptionCards(q: q),
                      const SizedBox(height: SwSpace.s6),
                      _Section(s('checkout.payment')),
                      _PaymentRow(q: q),
                      const SizedBox(height: SwSpace.s6),
                      _Section(s('checkout.summary')),
                      _Summary(q: q),
                      if (q.list('extraFields').isNotEmpty) ...[const SizedBox(height: SwSpace.s6), _ExtraFields(fields: q.list('extraFields'))],
                      const SizedBox(height: SwSpace.s5),
                      Row(
                        children: [
                          Icon(Ic.phone, size: 16, color: c.muted),
                          const SizedBox(width: SwSpace.s2),
                          Expanded(
                            child: Text(s('checkout.contact', {'phone': q.obj('contact')?.str('phone') ?? ''}), style: context.type.caption.copyWith(color: c.muted)),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          if (q != null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _PlaceBar(q: q, placing: _placing, onPlace: () => _place(q)),
            ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: SwSpace.s3),
    child: Text(caps(text), style: context.type.label.copyWith(color: context.sw.muted)),
  );
}

/* ------------------------------------------------------------------ location states */

class _NoLocation extends ConsumerWidget {
  const _NoLocation({required this.permission, required this.locating});
  final LocPermission permission;
  final bool locating;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    if (locating || permission == LocPermission.unknown && locating) {
      return ColoredBox(
        color: c.canvas,
        child: ALoaderBlock(message: s('checkout.locating'), size: ALoaderSize.lg),
      );
    }
    return ColoredBox(
      color: c.blush,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(SwSpace.s6, SwSpace.s14, SwSpace.s6, SwSpace.s6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(shape: BoxShape.circle, color: c.surface),
                child: Icon(Ic.locateFixed, color: c.ink, size: 22),
              ),
              const SizedBox(height: SwSpace.s4),
              Text(s('checkout.locationPermission.title'), style: context.type.displayS),
              const SizedBox(height: SwSpace.s2),
              Text(
                permission == LocPermission.granted
                    ? s('checkout.locating')
                    : (permission == LocPermission.denied || permission == LocPermission.deniedForever || permission == LocPermission.serviceOff)
                    ? s('checkout.locationDenied')
                    : s('checkout.locationPermission.body'),
                style: context.type.bodyS.copyWith(color: c.muted),
              ),
              const SizedBox(height: SwSpace.s5),
              Row(
                children: [
                  SwButton(
                    label: s('checkout.locationPermission.allow'),
                    icon: Ic.locateFixed,
                    onPressed: () async {
                      if (permission == LocPermission.deniedForever) {
                        await ref.read(locationServiceProvider).openSettings();
                      } else {
                        await ref.read(deliveryPointProvider.notifier).requestAndLocate();
                      }
                    },
                  ),
                  const SizedBox(width: SwSpace.s2),
                  SwButton(label: s('checkout.locationPermission.manual'), variant: SwButtonVariant.ghost, onPressed: () => showPlacePicker(context)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DeliverToCard extends ConsumerWidget {
  const _DeliverToCard({required this.dps});
  final DeliveryPointState dps;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final p = dps.point!;
    final title = p.area ?? (p.source == PointSource.gps ? s('checkout.currentLocation') : (p.label ?? s('checkout.currentLocation')));
    final sub = [
      if (p.source == PointSource.gps && p.area != null) s('checkout.currentLocation'),
      if (p.label != null && p.label != title) p.label!,
      if (p.landmark != null) '“${p.landmark}”',
    ].join(' · ');
    return PressableLink(
      onTap: () => showPlacePicker(context),
      semanticLabel: '${s('checkout.deliverTo')} $title. ${s('checkout.change')}',
      loaderOverlay: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s3, SwSpace.s3, SwSpace.s3),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(SwRadius.md),
          boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.10), blurRadius: 32, offset: const Offset(0, 10))],
        ),
        child: Row(
          children: [
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: c.mapClient,
                border: Border.all(color: c.mapRing, width: 2),
                boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.25), blurRadius: 4)],
              ),
            ),
            const SizedBox(width: SwSpace.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(caps(s('checkout.deliverTo')), style: context.type.labelS.copyWith(color: c.muted)),
                  const SizedBox(height: 2),
                  AnimatedSwitcher(
                    duration: SwMotion.base,
                    child: Text(title, key: ValueKey(title), style: context.type.titleM, maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                  if (sub.isNotEmpty)
                    Text(
                      sub,
                      style: context.type.caption.copyWith(color: c.muted),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  if (dps.locating || (p.accuracy != null && p.accuracy! > 40))
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Row(
                        children: [
                          if (dps.locating) ...[const ALoader(size: ALoaderSize.xs), const SizedBox(width: 6)],
                          Text(dps.locating ? s('checkout.locating') : s('checkout.accuracy', {'meters': p.accuracy!.round()}), style: context.type.caption.copyWith(color: c.warning)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
            Text(
              s('checkout.change'),
              style: context.type.titleS.copyWith(decoration: TextDecoration.underline, decorationColor: c.hairline),
            ),
          ],
        ),
      ),
    );
  }
}

class _Problem extends StatelessWidget {
  const _Problem({required this.p});
  final Json p;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Container(
      margin: const EdgeInsets.only(bottom: SwSpace.s4),
      padding: const EdgeInsets.all(SwSpace.s4),
      decoration: BoxDecoration(color: c.warningSoft, borderRadius: BorderRadius.circular(SwRadius.md)),
      child: Row(
        children: [
          Icon(Ic.circleAlert, size: 18, color: c.warning),
          const SizedBox(width: SwSpace.s3),
          Expanded(child: Text(p.str('message', p.str('reason')), style: context.type.bodyS)),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ delivery options */

class _OptionCards extends ConsumerWidget {
  const _OptionCards({required this.q});
  final Json q;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final cur = q.obj('cart')?.str('currency', 'TZS') ?? 'TZS';
    final selected = q.strN('selectedOptionId');
    return Column(
      children: [
        for (final (i, o) in q.list('options').indexed)
          Reveal(
            index: i,
            child: Padding(
              padding: const EdgeInsets.only(bottom: SwSpace.s2),
              child: PressableLink(
                onTap: o.flag('available') ? () => ref.read(checkoutChoiceProvider.notifier).option(o.str('id')) : null,
                loaderOverlay: false,
                haptic: true,
                semanticLabel: o.str('name'),
                child: AnimatedContainer(
                  duration: SwMotion.base,
                  curve: SwMotion.atelier,
                  padding: const EdgeInsets.all(SwSpace.s4),
                  decoration: BoxDecoration(
                    color: selected == o.str('id') ? c.surface : c.surface.withValues(alpha: 0.6),
                    borderRadius: BorderRadius.circular(SwRadius.md),
                    border: Border.all(color: selected == o.str('id') ? c.ink : c.hairline, width: selected == o.str('id') ? 1.5 : 1),
                  ),
                  child: Opacity(
                    opacity: o.flag('available') ? 1 : 0.45,
                    child: Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(color: selected == o.str('id') ? c.ink : c.ink.withValues(alpha: 0.05), borderRadius: BorderRadius.circular(SwRadius.sm)),
                          child: Icon(
                            o.str('kind') == 'pickup'
                                ? Ic.store
                                : o.str('kind') == 'express'
                                ? Ic.zap
                                : Ic.bike,
                            size: 20,
                            color: selected == o.str('id') ? c.onInk : c.ink,
                          ),
                        ),
                        const SizedBox(width: SwSpace.s4),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(o.str('name'), style: context.type.titleM),
                              const SizedBox(height: 2),
                              Text(
                                !o.flag('available')
                                    ? s('checkout.notServiceable')
                                    : o.str('kind') == 'pickup'
                                    ? s('checkout.pickupAt', {'store': o.obj('store')?.str('name') ?? ''})
                                    : s('checkout.minutes', {'min': o.integer('etaMinMinutes'), 'max': o.integer('etaMaxMinutes')}),
                                style: context.type.caption.copyWith(color: c.muted),
                              ),
                            ],
                          ),
                        ),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(o.integer('fee') == 0 ? s('checkout.free') : formatMoney(o.integer('fee'), cur), style: context.type.priceS),
                            if (o.flag('freeDelivery') && o.integer('feeBeforeFree') > 0)
                              Text(
                                formatMoney(o.integer('feeBeforeFree'), cur),
                                style: context.type.caption.copyWith(color: c.subtle, decoration: TextDecoration.lineThrough),
                              ),
                          ],
                        ),
                        const SizedBox(width: SwSpace.s3),
                        AnimatedScale(
                          scale: selected == o.str('id') ? 1 : 0,
                          duration: SwMotion.base,
                          curve: Curves.easeOutBack,
                          child: Container(
                            width: 22,
                            height: 22,
                            decoration: BoxDecoration(shape: BoxShape.circle, color: c.accent),
                            child: Icon(Ic.check, size: 14, color: c.onAccent),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        if (q.strN('arrivesBy') != null)
          Padding(
            padding: const EdgeInsets.only(top: SwSpace.s1),
            child: Row(
              children: [
                Icon(Ic.clock, size: 14, color: c.muted),
                const SizedBox(width: SwSpace.s2),
                Text(s('checkout.arrivesBy', {'time': _hm(q.str('arrivesBy'))}), style: context.type.caption.copyWith(color: c.muted)),
                if (q.obj('store') != null) ...[
                  Text(' · ', style: context.type.caption.copyWith(color: c.muted)),
                  Flexible(
                    child: Text(
                      s('checkout.fromStore', {'store': q.obj('store')!.str('name')}),
                      style: context.type.caption.copyWith(color: c.muted),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }

  static String _hm(String iso) {
    final d = DateTime.tryParse(iso)?.toLocal();
    if (d == null) return '';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}

/* ------------------------------------------------------------------ payment */

class _PaymentRow extends ConsumerWidget {
  const _PaymentRow({required this.q});
  final Json q;

  static IconData icon(String m) => m == 'MOBILE_MONEY'
      ? Ic.smartphone
      : m == 'CARD'
      ? Ic.creditCard
      : Ic.banknote;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final pay = q.obj('payment') ?? const {};
    final choice = ref.watch(checkoutChoiceProvider);
    final method = choice.method ?? pay.obj('default')?.strN('method') ?? 'CASH_ON_DELIVERY';
    final saved = pay.list('saved').where((m) => m.str('method') == method).firstOrNull;
    final number = choice.msisdn ?? saved?.strN('msisdn') ?? q.obj('contact')?.strN('phone');
    return PressableLink(
      onTap: () => _pick(context, ref, pay, method, number),
      loaderOverlay: false,
      semanticLabel: '${s('checkout.payment')}: ${s('payment.$method')}',
      child: Container(
        padding: const EdgeInsets.all(SwSpace.s4),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(SwRadius.md),
          border: Border.all(color: c.hairline),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(SwRadius.sm)),
              child: Icon(icon(method), size: 20, color: c.ink),
            ),
            const SizedBox(width: SwSpace.s4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s('payment.$method'), style: context.type.titleM),
                  Text(
                    method == 'MOBILE_MONEY'
                        ? (number ?? s('pay.networks'))
                        : method == 'CASH_ON_DELIVERY'
                        ? s('pay.cashBody')
                        : '',
                    style: context.type.caption.copyWith(color: c.muted),
                  ),
                ],
              ),
            ),
            Icon(Ic.chevronRight, size: 18, color: c.muted),
          ],
        ),
      ),
    );
  }

  Future<void> _pick(BuildContext context, WidgetRef ref, Json pay, String current, String? number) async {
    final s = ref.s;
    await showSwSheet<void>(
      context,
      title: s('checkout.paymentSheet'),
      builder: (ctx) => _PaymentSheet(available: pay.list('available'), current: current, number: number),
    );
  }
}

class _PaymentSheet extends ConsumerStatefulWidget {
  const _PaymentSheet({required this.available, required this.current, this.number});
  final List<Json> available;
  final String current;
  final String? number;
  @override
  ConsumerState<_PaymentSheet> createState() => _PaymentSheetState();
}

class _PaymentSheetState extends ConsumerState<_PaymentSheet> {
  late String _m = widget.current;
  late final _num = TextEditingController(text: widget.number?.replaceFirst('+255', '') ?? '');

  @override
  void dispose() {
    _num.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    return Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s5 + MediaQuery.viewInsetsOf(context).bottom + context.safe.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final a in widget.available)
            Padding(
              padding: const EdgeInsets.only(bottom: SwSpace.s2),
              child: PressableLink(
                onTap: () => setState(() => _m = a.str('method')),
                loaderOverlay: false,
                haptic: true,
                child: AnimatedContainer(
                  duration: SwMotion.base,
                  padding: const EdgeInsets.all(SwSpace.s4),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(SwRadius.md),
                    border: Border.all(color: _m == a.str('method') ? c.ink : c.hairline, width: _m == a.str('method') ? 1.5 : 1),
                  ),
                  child: Row(
                    children: [
                      Icon(_PaymentRow.icon(a.str('method')), size: 22, color: c.ink),
                      const SizedBox(width: SwSpace.s4),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(s('payment.${a.str('method')}'), style: context.type.titleM),
                            if (a.str('method') == 'MOBILE_MONEY') Text(s('pay.networks'), style: context.type.caption.copyWith(color: c.muted)),
                          ],
                        ),
                      ),
                      AnimatedOpacity(
                        opacity: _m == a.str('method') ? 1 : 0,
                        duration: SwMotion.fast,
                        child: Icon(Ic.circleCheck, color: c.ink, size: 22),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          AnimatedSize(
            duration: SwMotion.base,
            curve: SwMotion.atelier,
            child: _m == 'MOBILE_MONEY'
                ? Padding(
                    padding: const EdgeInsets.only(top: SwSpace.s3),
                    child: SwTextField(
                      controller: _num,
                      label: s('pay.number'),
                      prefix: Text('+255 ', style: context.type.bodyM),
                      keyboardType: TextInputType.phone,
                      hint: '712 345 678',
                      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
          const SizedBox(height: SwSpace.s5),
          SwButton(
            label: s('common.done'),
            large: true,
            expand: true,
            onPressed: () {
              final digits = _num.text.replaceFirst(RegExp('^0'), '');
              ref.read(checkoutChoiceProvider.notifier).payment(_m, msisdn: _m == 'MOBILE_MONEY' && digits.length >= 9 ? '+255$digits' : null);
              Navigator.of(context).pop();
            },
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ summary & extras */

class _Summary extends ConsumerWidget {
  const _Summary({required this.q});
  final Json q;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final cart = q.obj('cart') ?? const {};
    final cur = cart.str('currency', 'TZS');
    final items = cart.list('items');
    Widget row(String k, String v, {Color? color}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(k, style: context.type.bodyS.copyWith(color: c.muted)),
          ),
          Text(v, style: context.type.bodyS.copyWith(color: color ?? c.ink)),
        ],
      ),
    );
    return Container(
      padding: const EdgeInsets.all(SwSpace.s4),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(SwRadius.md),
        border: Border.all(color: c.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            height: 70,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s2),
              itemBuilder: (_, i) => Stack(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(SwRadius.xs),
                    child: SizedBox(width: 56, height: 70, child: SwImage(items[i].obj('image'), aspectRatio: null)),
                  ),
                  if (items[i].integer('qty') > 1)
                    Positioned(
                      right: 3,
                      bottom: 3,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                        decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.xs)),
                        child: Text('×${items[i].integer('qty')}', style: context.type.labelS.copyWith(color: c.onInk)),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: SwSpace.s3),
          row(s('checkout.subtotal'), formatMoney(cart.integer('subtotal'), cur)),
          if (cart.integer('discount') > 0) row(s('checkout.discount'), '−${formatMoney(cart.integer('discount'), cur)}', color: c.success),
          row(s('checkout.deliveryFee'), cart.integer('deliveryFee') == 0 ? s('checkout.free') : formatMoney(cart.integer('deliveryFee'), cur)),
          if (cart.integer('savings') > 0) row(s('bag.savings', {'amount': ''}).trim(), formatMoney(cart.integer('savings'), cur), color: c.success),
        ],
      ),
    );
  }
}

class _ExtraFields extends ConsumerWidget {
  const _ExtraFields({required this.fields});
  final List<Json> fields;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    return Theme(
      data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
      child: ExpansionTile(
        tilePadding: EdgeInsets.zero,
        title: Text(s('checkout.extraFields'), style: context.type.titleS),
        children: [
          for (final f in fields)
            Padding(
              padding: const EdgeInsets.only(bottom: SwSpace.s3),
              child: SwTextField(label: f.str('label', f.str('key')), hint: f.strN('placeholder'), onChanged: (v) => ref.read(checkoutChoiceProvider.notifier).extra(f.str('key'), v)),
            ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------ place bar */

class _PlaceBar extends ConsumerWidget {
  const _PlaceBar({required this.q, required this.placing, required this.onPlace});
  final Json q;
  final bool placing;
  final Future<void> Function() onPlace;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final cart = q.obj('cart') ?? const {};
    final can = q.flag('canPlace') || (q.list('problems').isEmpty && q.strN('selectedOptionId') != null && !q.flag('requiresPhone'));
    return Container(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s4 + context.safe.bottom),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border(top: BorderSide(color: c.hairline)),
        boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.06), blurRadius: 24, offset: const Offset(0, -6))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(s('checkout.total'), style: context.type.titleM),
              const Spacer(),
              CountUpMoney(cart.integer('total'), currency: cart.str('currency', 'TZS'), style: context.type.priceL),
            ],
          ),
          if (q.flag('requiresPhone'))
            Padding(
              padding: const EdgeInsets.only(top: SwSpace.s2),
              child: Text(s('checkout.phoneRequired'), style: context.type.caption.copyWith(color: c.warning)),
            ),
          const SizedBox(height: SwSpace.s3),
          if (q.flag('slideToConfirm'))
            SlideToConfirm(label: s('checkout.slideToConfirm'), enabled: can && !placing, busy: placing, onConfirmed: onPlace)
          else
            SwButton(label: s('checkout.placeOrder'), icon: Ic.check, large: true, expand: true, haptic: true, pending: placing, onPressed: can ? onPlace : null),
        ],
      ),
    );
  }
}

/// Optional "slide to confirm" (checkout.slideToConfirm): drag the A-mark knob to the end.
class SlideToConfirm extends StatefulWidget {
  const SlideToConfirm({super.key, required this.label, required this.onConfirmed, this.enabled = true, this.busy = false});
  final String label;
  final Future<void> Function() onConfirmed;
  final bool enabled, busy;
  @override
  State<SlideToConfirm> createState() => _SlideToConfirmState();
}

class _SlideToConfirmState extends State<SlideToConfirm> with SingleTickerProviderStateMixin {
  double _x = 0;
  late final AnimationController _back = AnimationController(vsync: this, duration: SwMotion.slow)..addListener(() => setState(() => _x = _x * (1 - _back.value)));

  @override
  void dispose() {
    _back.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return LayoutBuilder(
      builder: (context, box) {
        const knob = 52.0;
        final max = box.maxWidth - knob - 8;
        final t = max <= 0 ? 0.0 : (_x / max).clamp(0.0, 1.0);
        return Opacity(
          opacity: widget.enabled || widget.busy ? 1 : 0.45,
          child: Container(
            height: 60,
            decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.full)),
            child: Stack(
              alignment: Alignment.centerLeft,
              children: [
                Center(
                  child: Opacity(
                    opacity: 1 - t,
                    child: Text(widget.label, style: context.type.titleS.copyWith(color: c.onInk)),
                  ),
                ),
                Positioned(
                  left: 4 + _x,
                  child: GestureDetector(
                    onHorizontalDragUpdate: widget.enabled ? (d) => setState(() => _x = (_x + d.delta.dx).clamp(0, max)) : null,
                    onHorizontalDragEnd: widget.enabled
                        ? (_) async {
                            if (t > 0.86) {
                              setState(() => _x = max);
                              HapticFeedback.mediumImpact();
                              await widget.onConfirmed();
                              if (mounted) _back.forward(from: 0);
                            } else {
                              _back.forward(from: 0);
                            }
                          }
                        : null,
                    child: Container(
                      width: knob,
                      height: knob,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: c.accent),
                      child: Center(
                        child: widget.busy ? ALoader(size: ALoaderSize.sm, color: c.onAccent) : Icon(Ic.arrowRight, color: c.onAccent, size: 22),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
