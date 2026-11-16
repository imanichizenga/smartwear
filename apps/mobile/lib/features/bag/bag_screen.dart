import 'dart:async';

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
import '../../ui/motion.dart';

/// The bag shows exactly what the server priced: unit price applied, tier, savings, totals.
/// Layout: the list scrolls in the space left above the summary, and the summary sits flush on the nav bar
/// (its bottom padding is exactly the shared bottom inset), so there is no blank band on any phone.
class BagScreen extends ConsumerWidget {
  const BagScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final cart = ref.watch(cartProvider);
    return Scaffold(
      appBar: AppBar(title: Text(s('bag.title'), style: context.type.displayS), automaticallyImplyLeading: false),
      body: cart.when(
        skipLoadingOnRefresh: true,
        skipLoadingOnReload: true,
        loading: () => const _BagSkeleton(),
        error: (e, _) => Center(child: LoadError(error: e, onRetry: () => ref.invalidate(cartProvider))),
        data: (c) {
          final items = c.list('items');
          final saved = c.list('savedForLater');
          if (items.isEmpty && saved.isEmpty) {
            return EmptyState(title: s('bag.empty.title'), body: s('bag.empty.body'), icon: Ic.shoppingBag, action: SwButton(label: s('bag.empty.cta'), onPressed: () => context.go('/')));
          }
          final cur = c.str('currency', 'TZS');
          final problems = c.list('problems');
          return Column(children: [
            Expanded(
              child: RefreshIndicator(
                color: context.sw.ink,
                onRefresh: () => ref.refresh(cartProvider.future),
                child: ListView(padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s6), children: [
                  if (problems.isNotEmpty) _ProblemsBanner(problems: problems),
                  for (final (k, i) in items.indexed) Reveal(key: ValueKey(i['id']), index: k, child: _Line(item: i, currency: cur)),
                  const SizedBox(height: SwSpace.s6),
                  _Promo(applied: c.obj('promo')),
                  if (saved.isNotEmpty) ...[
                    SectionHeader(s('bag.savedForLater'), padding: const EdgeInsets.only(top: SwSpace.s10, bottom: SwSpace.s4)),
                    for (final i in saved) _Line(item: i, currency: cur, saved: true),
                  ],
                ]),
              ),
            ),
            _Summary(cart: c),
          ]);
        },
      ),
    );
  }
}

/// Mirrors the real bag: three lines (92 px 4:5 thumb, brand, title, price, stepper) and the summary block.
class _BagSkeleton extends StatelessWidget {
  const _BagSkeleton();
  @override
  Widget build(BuildContext context) {
    return Column(children: [
      Expanded(
        child: SkeletonList(
          count: 3,
          padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, SwSpace.s4),
          gap: SwSpace.s8,
          itemBuilder: (context, _) => const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 92, child: SkeletonBox(aspectRatio: 4 / 5)),
            SizedBox(width: SwSpace.s4),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                SkeletonLine(width: 64, height: 10),
                SizedBox(height: SwSpace.s2),
                SkeletonLine(height: 14),
                SizedBox(height: SwSpace.s1),
                SkeletonLine(width: 120, height: 14),
                SizedBox(height: SwSpace.s3),
                SkeletonLine(width: 88, height: 16),
                SizedBox(height: SwSpace.s4),
                SkeletonBox(width: 108, height: 40, radius: SwRadius.full),
              ]),
            ),
          ]),
        ),
      ),
      Container(
        padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s3 + context.bottomInset),
        decoration: BoxDecoration(color: context.sw.surface, border: Border(top: BorderSide(color: context.sw.hairline))),
        child: const Column(mainAxisSize: MainAxisSize.min, children: [
          Row(children: [SkeletonLine(width: 72), Spacer(), SkeletonLine(width: 84)]),
          SizedBox(height: SwSpace.s3),
          Row(children: [SkeletonLine(width: 56, height: 16), Spacer(), SkeletonLine(width: 110, height: 18)]),
          SizedBox(height: SwSpace.s4),
          SkeletonBox(height: 56, radius: SwRadius.full),
        ]),
      ),
    ]);
  }
}

/// Stock or price changed since the item was added: say so above the lines.
class _ProblemsBanner extends ConsumerWidget {
  const _ProblemsBanner({required this.problems});
  final List<Json> problems;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    return Container(
      margin: const EdgeInsets.only(top: SwSpace.s2, bottom: SwSpace.s2),
      padding: const EdgeInsets.all(SwSpace.s4),
      decoration: BoxDecoration(color: c.warningSoft, borderRadius: BorderRadius.circular(SwRadius.sm)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(Ic.circleAlert, size: 18, color: c.warning),
        const SizedBox(width: SwSpace.s3),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(ref.s('bag.problems.title'), style: context.type.titleS),
            for (final p in problems) Padding(padding: const EdgeInsets.only(top: SwSpace.s1), child: Text(p.str('message'), style: context.type.caption.copyWith(color: c.ink))),
          ]),
        ),
      ]),
    );
  }
}

class _Line extends ConsumerStatefulWidget {
  const _Line({required this.item, required this.currency, this.saved = false});
  final Json item;
  final String currency;
  final bool saved;
  @override
  ConsumerState<_Line> createState() => _LineState();
}

class _LineState extends ConsumerState<_Line> {
  Timer? _debounce;

  /// Quantity shown while taps are being collected (debounced into one request).
  int? _pendingQty;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _setQty(int q) {
    if (q <= 0) {
      unawaited(_remove());
      return;
    }
    HapticFeedback.selectionClick();
    setState(() => _pendingQty = q);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      try {
        await ref.read(cartProvider.notifier).setQty(widget.item.integer('id'), q);
      } on ApiException catch (e) {
        if (mounted) showSwToast(context, e.message, error: true);
      } finally {
        if (mounted) setState(() => _pendingQty = null);
      }
    });
  }

  /// Remove with an Undo toast (re-adds the same variant and quantity).
  Future<void> _remove() async {
    _debounce?.cancel();
    HapticFeedback.mediumImpact();
    final item = widget.item;
    final messenger = ScaffoldMessenger.maybeOf(context);
    final undoLabel = ref.s('common.undo');
    final removedLabel = ref.s('bag.removed');
    final notifier = ref.read(cartProvider.notifier);
    try {
      await notifier.setQty(item.integer('id'), 0);
      if (!mounted || messenger == null) return;
      showSwToast(context, removedLabel, icon: Ic.trash2, actionLabel: undoLabel, onAction: () {
        notifier.add(item.str('variantId'), item.integer('qty', 1)).catchError((_) {});
      });
    } on ApiException catch (e) {
      if (mounted) showSwToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final item = widget.item;
    final cart = ref.read(cartProvider.notifier);
    final qty = _pendingQty ?? item.integer('qty');
    final next = item.obj('nextTier');
    return Dismissible(
      key: ValueKey('line-${item.integer('id')}'),
      direction: DismissDirection.endToStart,
      background: Container(alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: SwSpace.s6), color: c.dangerSoft, child: Icon(Ic.trash2, color: c.danger)),
      onDismissed: (_) => _remove(),
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
                CountUpMoney(item.integer('lineTotal'), currency: widget.currency, style: context.type.priceS),
                if (qty > 1) Text('${formatMoney(item.integer('unitPrice'), widget.currency)} ${s('product.tierEach', {'price': ''}).trim()}', style: context.type.caption.copyWith(color: c.muted)),
                if (item.strN('tier') != null) SwChip(s('bag.tier', {'label': item.str('tier')}), tone: ChipTone.accent),
                if (item.integer('savings') > 0) Text(s('bag.savings', {'amount': formatMoney(item.integer('savings'), widget.currency)}), style: context.type.caption.copyWith(color: c.success)),
              ]),
              if (next != null)
                Padding(
                  padding: const EdgeInsets.only(top: SwSpace.s1),
                  child: Text(s('product.tierNudge', {'count': next.integer('minQty') - qty, 'price': formatAmount(next.integer('unitPrice'), widget.currency)}), style: context.type.caption.copyWith(color: c.ink)),
                ),
              const SizedBox(height: SwSpace.s3),
              Row(children: [
                if (!widget.saved) _Stepper(qty: qty, onChanged: _setQty),
                const Spacer(),
                PressableLink(
                  loaderOverlay: false,
                  onTap: () => cart.saveForLater(item.integer('id'), !widget.saved),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 44),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s2),
                      child: Center(widthFactor: 1, child: Text(widget.saved ? s('bag.moveToBag') : s('bag.saveForLater'), style: context.type.caption.copyWith(decoration: TextDecoration.underline, color: c.ink))),
                    ),
                  ),
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
      height: 44,
      decoration: BoxDecoration(border: Border.all(color: context.sw.hairline), borderRadius: BorderRadius.circular(SwRadius.full)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        SwIconButton(icon: qty > 1 ? Ic.minus : Ic.trash2, size: 44, semanticLabel: context.s('bag.decrease'), onPressed: () => onChanged(qty - 1)),
        SizedBox(width: 24, child: Text('$qty', textAlign: TextAlign.center, style: context.type.titleS)),
        SwIconButton(icon: Ic.plus, size: 44, semanticLabel: context.s('bag.increase'), onPressed: () => onChanged(qty + 1)),
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
  bool _busy = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final code = _ctrl.text.trim();
    if (_busy || code.isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(cartProvider.notifier).applyPromo(code);
      if (mounted) setState(() => _error = null);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.isNetwork ? ref.s('common.offlineAction') : e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    if (widget.applied != null) {
      return Row(children: [Icon(Ic.tag, size: 16, color: context.sw.success), const SizedBox(width: SwSpace.s2), Text(widget.applied!.str('code'), style: context.type.titleS)]);
    }
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Expanded(
        child: SwTextField(
          controller: _ctrl,
          hint: s('bag.promo'),
          leadingIcon: Ic.tag,
          error: _error,
          textInputAction: TextInputAction.done,
          // The error belongs to the code that was tried; editing clears it.
          onChanged: (_) {
            if (_error != null) setState(() => _error = null);
          },
          onSubmitted: (_) => _apply(),
        ),
      ),
      const SizedBox(width: SwSpace.s2),
      SwButton(label: s('bag.promo.apply'), variant: SwButtonVariant.secondary, onPressed: _busy ? null : _apply),
    ]);
  }
}

/// Compact totals and a full-width Checkout directly above the nav bar.
class _Summary extends ConsumerWidget {
  const _Summary({required this.cart});
  final Json cart;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final cur = cart.str('currency', 'TZS');
    Widget row(String k, String v, {bool strong = false, Color? color, int? amount}) {
      final style = strong ? context.type.priceM : context.type.bodyS.copyWith(color: color ?? c.ink);
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(children: [
          Expanded(child: Text(k, style: strong ? context.type.titleM : context.type.bodyS.copyWith(color: c.muted))),
          // Totals count to their new value when a quantity or promo changes.
          if (amount != null) CountUpMoney(amount, currency: cur, style: style) else Text(v, style: style),
        ]),
      );
    }

    return Container(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s3 + context.bottomInset),
      decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.hairline))),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        row(s('bag.subtotal'), '', amount: cart.integer('subtotal')),
        if (cart.integer('discount') > 0) row(s('bag.discount'), '−${formatMoney(cart.integer('discount'), cur)}', color: c.success),
        if (cart.integer('savings') > 0) row(s('bag.savings', {'amount': ''}).trim(), formatMoney(cart.integer('savings'), cur), color: c.success),
        if (cart.integer('tax') > 0) row(s('bag.tax'), formatMoney(cart.integer('tax'), cur)),
        const SizedBox(height: SwSpace.s1),
        row(s('bag.total'), '', strong: true, amount: cart.integer('total')),
        const SizedBox(height: SwSpace.s3),
        SwButton(label: s('bag.checkout'), icon: Ic.arrowRight, large: true, expand: true, onPressed: cart.list('items').isEmpty ? null : () => context.push('/checkout')),
      ]),
    );
  }
}
