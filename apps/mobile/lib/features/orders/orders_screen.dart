import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

const _active = {'PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED'};

ChipTone orderTone(String s) => switch (s) {
      'DELIVERED' => ChipTone.success,
      'PENDING_PAYMENT' => ChipTone.warning,
      'CANCELLED' || 'REFUNDED' => ChipTone.neutral,
      'FAILED' => ChipTone.danger,
      _ => ChipTone.ink,
    };

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final orders = ref.watch(ordersProvider);
    return Scaffold(
      appBar: AppBar(
        leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.canPop() ? context.pop() : context.go('/profile')),
        title: Text(s('orders.title'), style: context.type.displayS),
      ),
      body: orders.when(
        loading: () => ListView(padding: const EdgeInsets.all(SwSpace.s5), children: [for (var i = 0; i < 4; i++) const Padding(padding: EdgeInsets.only(bottom: SwSpace.s3), child: Skeleton(height: 96, radius: SwRadius.md))]),
        error: (e, _) => EmptyState(title: s('common.error.title'), action: SwButton(label: s('common.retry'), onPressed: () => ref.refresh(ordersProvider.future))),
        data: (items) {
          if (items.isEmpty) return EmptyState(title: s('orders.empty.title'), body: s('orders.empty.body'), icon: Ic.package, action: SwButton(label: s('bag.empty.cta'), onPressed: () => context.go('/')));
          final active = items.where((o) => _active.contains(o.str('status'))).toList();
          final past = items.where((o) => !_active.contains(o.str('status'))).toList();
          return RefreshIndicator(
            color: context.sw.ink,
            onRefresh: () => ref.refresh(ordersProvider.future),
            child: ListView(padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s10 + context.safe.bottom), children: [
              if (active.isNotEmpty) SectionHeader(s('orders.active'), padding: const EdgeInsets.only(bottom: SwSpace.s3)),
              for (final (i, o) in active.indexed) Reveal(index: i, child: _OrderCard(o: o, live: true)),
              if (past.isNotEmpty) SectionHeader(s('orders.past'), padding: const EdgeInsets.only(top: SwSpace.s6, bottom: SwSpace.s3)),
              for (final (i, o) in past.indexed) Reveal(index: active.length + i, child: _OrderCard(o: o)),
            ]),
          );
        },
      ),
    );
  }
}

class _OrderCard extends ConsumerWidget {
  const _OrderCard({required this.o, this.live = false});
  final Json o;
  final bool live;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final images = o.list('images');
    final placed = DateTime.tryParse(o.str('placedAt'))?.toLocal();
    return Padding(
      padding: const EdgeInsets.only(bottom: SwSpace.s3),
      child: PressableLink(
        onTap: () => context.push(o.str('status') == 'PENDING_PAYMENT' ? '/orders/${o.str('id')}/pay' : '/orders/${o.str('id')}/track'),
        semanticLabel: '${o.str('number')}, ${o.str('statusLabel')}',
        child: Container(
          padding: const EdgeInsets.all(SwSpace.s4),
          decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: live ? c.ink.withValues(alpha: 0.6) : c.hairline)),
          child: Row(children: [
            _Thumbs(images: images),
            const SizedBox(width: SwSpace.s4),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Text(o.str('number'), style: context.type.titleS),
                  const Spacer(),
                  Text(formatMoney(o.integer('total'), o.str('currency', 'TZS')), style: context.type.priceS),
                ]),
                const SizedBox(height: SwSpace.s1),
                Text(
                  [s('checkout.items', {'count': o.integer('itemCount')}), if (placed != null) '${placed.day}/${placed.month}/${placed.year}'].join(' · '),
                  style: context.type.caption.copyWith(color: c.muted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: SwSpace.s2),
                Row(children: [
                  SwChip(o.str('statusLabel', o.str('status')), tone: orderTone(o.str('status'))),
                  const Spacer(),
                  if (live)
                    Row(children: [Text(s('orders.track'), style: context.type.titleS), const SizedBox(width: 2), Icon(Ic.chevronRight, size: 16, color: c.ink)])
                  else if (placed != null)
                    Text('${placed.day}/${placed.month}/${placed.year}', style: context.type.caption.copyWith(color: c.subtle)),
                ]),
              ]),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Up to three item photos fanned like a small stack of lookbook prints.
class _Thumbs extends StatelessWidget {
  const _Thumbs({required this.images});
  final List<Json> images;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final shown = images.take(3).toList();
    if (shown.isEmpty) {
      return Container(width: 56, height: 70, decoration: BoxDecoration(color: c.blush, borderRadius: BorderRadius.circular(SwRadius.xs)), child: Icon(Ic.shoppingBag, size: 20, color: c.muted));
    }
    return SizedBox(
      width: 56 + (shown.length - 1) * 8,
      height: 70,
      child: Stack(children: [
        for (var i = shown.length - 1; i >= 0; i--)
          Positioned(
            left: i * 8.0,
            top: i * 3.0,
            bottom: i * 3.0,
            child: Container(
              width: 56 - i * 4.8,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(SwRadius.xs), border: Border.all(color: c.surface, width: i == 0 ? 0 : 1.5)),
              child: ClipRRect(borderRadius: BorderRadius.circular(SwRadius.xs), child: SwImage(shown[i], aspectRatio: null)),
            ),
          ),
      ]),
    );
  }
}
