import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../core/realtime.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// Mobile money by USSD push (Snippe): the shopper approves on their phone; we listen for the
/// order room event and poll the reconciling status endpoint, then glide into live tracking.
class PaymentWaitScreen extends ConsumerStatefulWidget {
  const PaymentWaitScreen({super.key, required this.orderId});
  final String orderId;
  @override
  ConsumerState<PaymentWaitScreen> createState() => _PaymentWaitScreenState();
}

class _PaymentWaitScreenState extends ConsumerState<PaymentWaitScreen> with SingleTickerProviderStateMixin {
  Timer? _poll;
  String _status = 'PENDING';
  bool _done = false;
  void Function()? _unsub;
  StreamSubscription<RtEvent>? _rt;
  late final AnimationController _pulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 1800))..repeat();

  Api get _api => ref.read(apiProvider);

  @override
  void initState() {
    super.initState();
    _poll = Timer.periodic(const Duration(seconds: 3), (_) => _check());
    final rt = ref.read(realtimeProvider);
    _unsub = rt.subscribe('order.${widget.orderId}');
    _rt = rt.events.where((e) => e['orderId'] == widget.orderId || '${e['type']}'.startsWith('order.')).listen((_) => _check());
    _check();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _rt?.cancel();
    _unsub?.call();
    _pulse.dispose();
    super.dispose();
  }

  Future<void> _check() async {
    if (_done) return;
    try {
      final r = await _api.get<Json>('/me/orders/${widget.orderId}/payment');
      final st = r.str('paymentStatus', 'PENDING');
      if (!mounted) return;
      setState(() => _status = st);
      if (st == 'PAID') {
        _done = true;
        _poll?.cancel();
        HapticFeedback.heavyImpact();
        ref.invalidate(orderProvider(widget.orderId));
        await Future<void>.delayed(const Duration(milliseconds: 1100));
        if (mounted) context.go('/orders/${widget.orderId}/track');
      }
    } on ApiException {
      // Poll again; the order room / webhook will catch up.
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final order = ref.watch(orderProvider(widget.orderId)).value;
    final phone = ref.watch(sessionProvider).user?.strN('phone') ?? '';
    final amount = order == null ? '' : formatMoney(order.integer('total'), order.str('currency', 'TZS'));
    final failed = _status == 'FAILED';
    final paid = _status == 'PAID';
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: SwSpace.s6),
            child: Column(children: [
              const SizedBox(height: SwSpace.s4),
              Align(alignment: Alignment.centerRight, child: SwIconButton(icon: Ic.x, semanticLabel: s('common.close'), onPressed: () => context.go('/orders'))),
              const Spacer(),
              SizedBox(
                height: 220,
                child: AnimatedSwitcher(
                  duration: SwMotion.slow,
                  switchInCurve: Curves.easeOutBack,
                  child: paid
                      ? Container(key: const ValueKey('ok'), width: 112, height: 112, decoration: BoxDecoration(shape: BoxShape.circle, color: c.ink), child: Icon(Ic.check, size: 48, color: c.accent))
                      : failed
                          ? Container(key: const ValueKey('x'), width: 112, height: 112, decoration: BoxDecoration(shape: BoxShape.circle, color: c.dangerSoft), child: Icon(Ic.x, size: 44, color: c.danger))
                          : _Phone(key: const ValueKey('ph'), pulse: _pulse),
                ),
              ),
              const SizedBox(height: SwSpace.s8),
              AnimatedSwitcher(
                duration: SwMotion.base,
                child: Text(paid ? s('pay.approve.paid') : failed ? s('pay.approve.failed') : s('pay.approve.title'), key: ValueKey(_status), style: context.type.displayM, textAlign: TextAlign.center),
              ),
              const SizedBox(height: SwSpace.s3),
              Text(
                failed ? s('pay.approve.failedBody') : s('pay.approve.body', {'phone': phone, 'amount': amount}),
                style: context.type.bodyM.copyWith(color: c.muted),
                textAlign: TextAlign.center,
              ),
              if (!failed && !paid) ...[
                const SizedBox(height: SwSpace.s5),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
                  decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(SwRadius.full)),
                  child: Text(s('pay.approve.steps'), style: context.type.caption, textAlign: TextAlign.center),
                ),
              ],
              const Spacer(),
              if (!paid) ...[
                Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  if (!failed) ...[const ALoader(size: ALoaderSize.sm), const SizedBox(width: SwSpace.s2), Text(s('pay.approve.waiting'), style: context.type.caption.copyWith(color: c.muted))],
                ]),
                const SizedBox(height: SwSpace.s5),
                SwButton(
                  label: failed ? s('common.retry') : s('pay.approve.resend'),
                  icon: Ic.refreshCw,
                  variant: failed ? SwButtonVariant.primary : SwButtonVariant.secondary,
                  large: true,
                  expand: true,
                  onPressed: () async {
                    try {
                      if (failed) {
                        await _api.post<Json>('/me/orders/${widget.orderId}/pay');
                        setState(() => _status = 'PENDING');
                      } else {
                        await _api.post<Json>('/me/orders/${widget.orderId}/payment');
                      }
                      if (context.mounted) showSwToast(context, s('pay.approve.resent'), icon: Ic.send);
                    } on ApiException catch (e) {
                      if (context.mounted) showSwToast(context, e.message, error: true);
                    }
                  },
                ),
                const SizedBox(height: SwSpace.s2),
                SwButton(
                  label: s('track.cancelOrder'),
                  variant: SwButtonVariant.ghost,
                  expand: true,
                  onPressed: () async {
                    try {
                      await _api.post<Json>('/me/orders/${widget.orderId}/cancel', {'reason': 'Payment not completed'});
                      ref.invalidate(ordersProvider);
                      if (context.mounted) context.go('/bag');
                    } on ApiException catch (e) {
                      if (context.mounted) showSwToast(context, e.message, error: true);
                    }
                  },
                ),
              ],
              const SizedBox(height: SwSpace.s6),
            ]),
          ),
        ),
      ),
    );
  }
}

/// A phone outline with a USSD prompt card breathing on its screen.
class _Phone extends StatelessWidget {
  const _Phone({super.key, required this.pulse});
  final Animation<double> pulse;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return AnimatedBuilder(
      animation: pulse,
      builder: (context, _) {
        final t = context.reduceMotion ? 0.5 : SwMotion.atelier.transform(pulse.value);
        return Stack(alignment: Alignment.center, children: [
          for (final k in [t, (t + 0.5) % 1])
            Opacity(opacity: (1 - k) * 0.5, child: Container(width: 120 + 120 * k, height: 120 + 120 * k, decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: c.accent, width: 1.2)))),
          Container(
            width: 108,
            height: 200,
            decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(22), border: Border.all(color: c.ink, width: 2.5), boxShadow: [BoxShadow(color: c.ink.withValues(alpha: 0.12), blurRadius: 30, offset: const Offset(0, 14))]),
            child: Column(children: [
              const SizedBox(height: 10),
              Container(width: 30, height: 4, decoration: BoxDecoration(color: c.ink.withValues(alpha: 0.2), borderRadius: BorderRadius.circular(2))),
              const Spacer(),
              Transform.scale(
                scale: 0.96 + 0.04 * (1 - (t - 0.5).abs() * 2),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 10),
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(8)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Container(height: 4, width: 50, color: c.onInk.withValues(alpha: 0.5)),
                    const SizedBox(height: 5),
                    Container(height: 4, width: 70, color: c.onInk.withValues(alpha: 0.3)),
                    const SizedBox(height: 8),
                    Row(children: [for (var i = 0; i < 4; i++) Padding(padding: const EdgeInsets.only(right: 4), child: Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: i < (t * 5).floor() ? c.accent : c.onInk.withValues(alpha: 0.25))))]),
                  ]),
                ),
              ),
              const Spacer(),
              Container(width: 26, height: 26, margin: const EdgeInsets.only(bottom: 10), decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: c.ink.withValues(alpha: 0.2)))),
            ]),
          ),
        ]);
      },
    );
  }
}
