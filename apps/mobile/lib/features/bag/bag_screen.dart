import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// The bag shows exactly what the server priced: unit price applied, tier, savings, totals.
class BagScreen extends ConsumerWidget {
  const BagScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final cart = ref.watch(cartProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s('bag.title'), style: context.type.displayS), automaticallyImplyLeading: false),
      body: cart.when(
        loading: () => const Center(child: Skeleton(width: 320, height: 120)),
        error: (e, _) => EmptyState(title: s('common.error.title'), action: SwButton(label: s('common.retry'), onPressed: () => ref.refresh(cartProvider.future))),
        data: (c) {
          final items = c.list('items');
          final saved = c.list('savedForLater');
          if (items.isEmpty && saved.isEmpty) {
            return EmptyState(title: s('bag.empty.title'), body: s('bag.empty.body'), icon: Ic.shoppingBag, action: SwButton(label: s('bag.empty.cta'), onPressed: () => context.go('/')));
          }
          final cur = c.str('currency', 'TZS');
          return Stack(children: [
            ListView(padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, 260 + context.safe.bottom), children: [
              for (final i in items) _Line(item: i, currency: cur),
              if (c.list('problems').isNotEmpty)
                for (final p in c.list('problems')) Padding(padding: const EdgeInsets.only(top: SwSpace.s3), child: Text(p.str('message'), style: context.type.caption.copyWith(color: context.sw.warning))),
              const SizedBox(height: SwSpace.s6),
              _Promo(applied: c.obj('promo')),
              if (saved.isNotEmpty) ...[
                SectionHeader(s('bag.savedForLater'), padding: const EdgeInsets.only(top: SwSpace.s10, bottom: SwSpace.s4)),
                for (final i in saved) _Line(item: i, currency: cur, saved: true),
              ],
            ]),
            Positioned(left: 0, right: 0, bottom: 0, child: _Summary(cart: c)),
          ]);
        },
      ),
    );
  }
}

class _Line extends ConsumerWidget {
  const _Line({required this.item, required this.currency, this.saved = false});
  final Json item;
  final String currency;
  final bool saved;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final cart = ref.read(cartProvider.notifier);
    final qty = item.integer('qty');
    final next = item.obj('nextTier');
    return Dismissible(
      key: ValueKey('line-${item.integer('id')}'),
      direction: DismissDirection.endToStart,
      background: Container(alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: SwSpace.s6), color: c.dangerSoft, child: Icon(Ic.trash2, color: c.danger)),
      onDismissed: (_) {
        HapticFeedback.mediumImpact();
        cart.setQty(item.integer('id'), 0);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: SwSpace.s4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SizedBox(width: 92, child: PressableLink(onTap: () => context.push('/p/${item.str('slug')}'), child: SwImage(item.obj('image')))),
          const SizedBox(width: SwSpace.s4),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(caps(item.str('brand')), style: context.type.labelS.copyWith(color: c.muted)),
              const SizedBox(height: 2),
              Text(item.str('title'), style: context.type.bodyM, maxLines: 2, overflow: TextOverflow.ellipsis),
              Text(item.str('options'), style: context.type.caption.copyWith(color: c.muted)),
              const SizedBox(height: SwSpace.s2),
              Wrap(spacing: SwSpace.s2, crossAxisAlignment: WrapCrossAlignment.center, children: [
                Text(formatMoney(item.integer('lineTotal'), currency), style: context.type.priceS),
                if (qty > 1) Text('${formatMoney(item.integer('unitPrice'), currency)} ${s('product.tierEach', {'price': ''}).trim()}', style: context.type.caption.copyWith(color: c.muted)),
                if (item.strN('tier') != null) SwChip(s('bag.tier', {'label': item.str('tier')}), tone: ChipTone.accent),
                if (item.integer('savings') > 0) Text(s('bag.savings', {'amount': formatMoney(item.integer('savings'), currency)}), style: context.type.caption.copyWith(color: c.success)),
              ]),
              if (next != null)
                Padding(
                  padding: const EdgeInsets.only(top: SwSpace.s1),
                  child: Text(s('product.tierNudge', {'count': next.integer('minQty') - qty, 'price': formatAmount(next.integer('unitPrice'), currency)}), style: context.type.caption.copyWith(color: c.ink)),
                ),
              const SizedBox(height: SwSpace.s3),
              Row(children: [
                if (!saved) _Stepper(qty: qty, onChanged: (q) => cart.setQty(item.integer('id'), q)),
                const Spacer(),
                PressableLink(
                  loaderOverlay: false,
                  onTap: () => cart.saveForLater(item.integer('id'), !saved),
                  child: Padding(padding: const EdgeInsets.all(SwSpace.s2), child: Text(saved ? s('bag.moveToBag') : s('bag.saveForLater'), style: context.type.caption.copyWith(decoration: TextDecoration.underline, color: c.ink))),
                ),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.qty, required this.onChanged});
  final int qty;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) {
    return Container(
      height: 40,
      decoration: BoxDecoration(border: Border.all(color: context.sw.hairline), borderRadius: BorderRadius.circular(SwRadius.full)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        SwIconButton(icon: qty > 1 ? Ic.minus : Ic.trash2, size: 40, semanticLabel: 'Decrease', onPressed: () => onChanged(qty - 1)),
        SizedBox(width: 20, child: Text('$qty', textAlign: TextAlign.center, style: context.type.titleS)),
        SwIconButton(icon: Ic.plus, size: 40, semanticLabel: 'Increase', onPressed: () => onChanged(qty + 1)),
      ]),
    );
  }
}

class _Promo extends ConsumerStatefulWidget {
  const _Promo({required this.applied});
  final Json? applied;
  @override
  ConsumerState<_Promo> createState() => _PromoState();
}

class _PromoState extends ConsumerState<_Promo> {
  final _ctrl = TextEditingController();
  String? _error;
  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    if (widget.applied != null) {
      return Row(children: [Icon(Ic.tag, size: 16, color: context.sw.success), const SizedBox(width: SwSpace.s2), Text(widget.applied!.str('code'), style: context.type.titleS)]);
    }
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(child: SwTextField(controller: _ctrl, hint: s('bag.promo'), leadingIcon: Ic.tag, error: _error)),
      const SizedBox(width: SwSpace.s2),
      SwButton(
        label: s('bag.promo.apply'),
        variant: SwButtonVariant.secondary,
        onPressed: () async {
          try {
            await ref.read(cartProvider.notifier).applyPromo(_ctrl.text.trim());
            setState(() => _error = null);
          } on ApiException catch (e) {
            setState(() => _error = e.message);
          }
        },
      ),
    ]);
  }
}

class _Summary extends ConsumerWidget {
  const _Summary({required this.cart});
  final Json cart;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final cur = cart.str('currency', 'TZS');
    Widget row(String k, String v, {bool strong = false, Color? color}) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(children: [Expanded(child: Text(k, style: strong ? context.type.titleM : context.type.bodyS.copyWith(color: c.muted))), Text(v, style: strong ? context.type.priceM : context.type.bodyS.copyWith(color: color ?? c.ink))]),
        );
    return Container(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s4 + 84 + context.safe.bottom),
      decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.hairline))),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        row(s('bag.subtotal'), formatMoney(cart.integer('subtotal'), cur)),
        if (cart.integer('discount') > 0) row(s('bag.discount'), '−${formatMoney(cart.integer('discount'), cur)}', color: c.success),
        if (cart.integer('savings') > 0) row(s('bag.savings', {'amount': ''}).trim(), formatMoney(cart.integer('savings'), cur), color: c.success),
        if (cart.integer('tax') > 0) row(s('bag.tax'), formatMoney(cart.integer('tax'), cur)),
        const SizedBox(height: SwSpace.s2),
        row(s('bag.total'), formatMoney(cart.integer('total'), cur), strong: true),
        const SizedBox(height: SwSpace.s4),
        SwButton(label: s('bag.checkout'), icon: Ic.arrowRight, large: true, expand: true, onPressed: cart.list('items').isEmpty ? null : () => context.push('/checkout')),
      ]),
    );
  }
}
