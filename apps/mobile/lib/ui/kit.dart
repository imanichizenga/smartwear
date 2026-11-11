import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../design/theme.dart';
import '../l10n/strings.dart';
import 'icons.dart';
import 'pressable.dart';
import 'sw_image.dart';

export 'icons.dart';
export 'pressable.dart';
export 'sw_image.dart';

/* ================================================================ basics */

enum ChipTone { neutral, ink, accent, blush, success, warning, danger }

/// Small uppercase label chip — badges ("New", "Limited") live here, never on the photo itself.
class SwChip extends StatelessWidget {
  const SwChip(this.label, {super.key, this.tone = ChipTone.neutral, this.icon});
  final String label;
  final ChipTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final (bg, fg) = switch (tone) {
      ChipTone.neutral => (c.ink.withValues(alpha: 0.06), c.muted),
      ChipTone.ink => (c.ink, c.onInk),
      ChipTone.accent => (c.accentSoft, Color.lerp(c.accent, c.ink, 0.35)!),
      ChipTone.blush => (c.blush, c.ink),
      ChipTone.success => (c.successSoft, c.success),
      ChipTone.warning => (c.warningSoft, c.warning),
      ChipTone.danger => (c.dangerSoft, c.danger),
    };
    return Container(
      height: 22,
      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s2),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SwRadius.xs)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 12, color: fg), const SizedBox(width: SwSpace.s1)],
        Text(caps(label), style: context.type.labelS.copyWith(color: fg, height: 1)),
      ]),
    );
  }
}

/// Toggleable filter / choice chip (filters, quiz answers, sizes in sheets).
class ChoiceChipSw extends StatelessWidget {
  const ChoiceChipSw({super.key, required this.label, required this.selected, required this.onTap, this.leading});
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final Widget? leading;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Semantics(
      selected: selected,
      button: true,
      child: GestureDetector(
        onTap: () {
          HapticFeedback.selectionClick();
          onTap();
        },
        child: AnimatedContainer(
          duration: SwMotion.fast,
          constraints: const BoxConstraints(minHeight: 40),
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s2),
          decoration: BoxDecoration(
            color: selected ? c.ink : c.surface,
            borderRadius: BorderRadius.circular(SwRadius.full),
            border: Border.all(color: selected ? c.ink : c.hairline),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            if (leading != null) ...[leading!, const SizedBox(width: SwSpace.s2)],
            Text(label, style: context.type.titleS.copyWith(color: selected ? c.onInk : c.ink, fontWeight: FontWeight.w500)),
          ]),
        ),
      ),
    );
  }
}

/// Token-coloured shimmer placeholder for lists and grids (actions use the A loader instead).
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.width, this.height = 14, this.radius = SwRadius.xs, this.aspectRatio});
  final double? width, height;
  final double radius;
  final double? aspectRatio;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    Widget box = AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        final t = context.reduceMotion ? 0.5 : _c.value;
        return DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            gradient: LinearGradient(
              begin: Alignment(-1.6 + 3.2 * t, 0),
              end: Alignment(-0.6 + 3.2 * t, 0),
              colors: [c.hairline, Color.lerp(c.hairline, c.surface, 0.6)!, c.hairline],
            ),
          ),
          child: SizedBox(width: widget.width, height: widget.aspectRatio == null ? widget.height : null),
        );
      },
    );
    if (widget.aspectRatio != null) box = AspectRatio(aspectRatio: widget.aspectRatio!, child: box);
    return ExcludeSemantics(child: box);
  }
}

/// Editorial empty/error state: a hairline A-arch illustration, a serif line and one action.
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.title, this.body, this.action, this.icon = Ic.sparkles});
  final String title;
  final String? body;
  final Widget? action;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: SwSpace.s8, vertical: SwSpace.s12),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        SizedBox(
          width: 120,
          height: 96,
          child: CustomPaint(
            painter: _ArchPainter(c.hairline, c.accent),
            child: Center(child: Padding(padding: const EdgeInsets.only(top: 18), child: Icon(icon, size: 26, color: c.ink))),
          ),
        ),
        const SizedBox(height: SwSpace.s6),
        Text(title, style: context.type.displayS, textAlign: TextAlign.center),
        if (body != null) ...[
          const SizedBox(height: SwSpace.s2),
          Text(body!, style: context.type.bodyS.copyWith(color: c.muted), textAlign: TextAlign.center),
        ],
        if (action != null) ...[const SizedBox(height: SwSpace.s6), action!],
      ]),
    );
  }
}

class _ArchPainter extends CustomPainter {
  _ArchPainter(this.line, this.accent);
  final Color line, accent;
  @override
  void paint(Canvas canvas, Size s) {
    final p = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1
      ..color = line;
    final r = Rect.fromLTWH(s.width * 0.18, 0, s.width * 0.64, s.height * 1.4);
    canvas.drawArc(r, 3.14159, 3.14159, false, p);
    canvas.drawLine(Offset(s.width * 0.18, s.height * 0.7), Offset(s.width * 0.18, s.height), p);
    canvas.drawLine(Offset(s.width * 0.82, s.height * 0.7), Offset(s.width * 0.82, s.height), p);
    canvas.drawCircle(Offset(s.width * 0.5, 2), 2.2, Paint()..color = accent);
  }

  @override
  bool shouldRepaint(_ArchPainter o) => o.line != line;
}

/// Serif section title + "View all" link.
class SectionHeader extends ConsumerWidget {
  const SectionHeader(this.title, {super.key, this.subtitle, this.onViewAll, this.padding = const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s10, SwSpace.s5, SwSpace.s4)});
  final String title;
  final String? subtitle;
  final FutureOr<void> Function()? onViewAll;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: padding,
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: context.type.displayM),
            if (subtitle != null) Padding(padding: const EdgeInsets.only(top: SwSpace.s1), child: Text(subtitle!, style: context.type.bodyS.copyWith(color: context.sw.muted))),
          ]),
        ),
        if (onViewAll != null)
          PressableLink(
            onTap: onViewAll,
            loaderOverlay: false,
            semanticLabel: ref.s('common.viewAll'),
            child: _ViewAll(label: ref.s('common.viewAll')),
          ),
      ]),
    );
  }
}

class _ViewAll extends StatelessWidget {
  const _ViewAll({required this.label});
  final String label;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: SwSpace.s3),
      child: Text(caps(label), style: context.type.label.copyWith(color: context.sw.ink, decoration: TextDecoration.underline, decorationColor: context.sw.accent, decorationThickness: 1.5)),
    );
  }
}

/* ================================================================ commerce */

/// Retail/wholesale-aware price. Retail in serif; compare-at struck through only for real discounts;
/// optional "From … in bulk" line when wholesale pricing is visible to this shopper.
class PriceTag extends ConsumerWidget {
  const PriceTag(this.price, {super.key, this.size = PriceSize.m, this.showBulk = true, this.range});
  final Json? price;
  final Json? range;
  final PriceSize size;
  final bool showBulk;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = price;
    if (p == null) return const SizedBox.shrink();
    final cur = p.str('currency', 'TZS');
    final style = switch (size) { PriceSize.s => context.type.priceS, PriceSize.m => context.type.priceM, PriceSize.l => context.type.priceL };
    final your = p.integer('yourPrice', p.integer('retail'));
    final compare = p.intN('compareAt');
    final wholesale = p.str('yourBasis') == 'wholesale' || p.str('yourBasis') == 'price_list';
    final min = range?.intN('min');
    final max = range?.intN('max');
    final varies = min != null && max != null && min != max;
    final line = Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: SwSpace.s2, runSpacing: 2, children: [
        Text(varies ? '${ref.s('common.from')} ${formatMoney(min, cur)}' : formatMoney(your, cur), style: style),
        if (compare != null && compare > your)
          Text(formatMoney(compare, cur), style: context.type.bodyS.copyWith(color: context.sw.muted, decoration: TextDecoration.lineThrough)),
        if (wholesale) SwChip(ref.s('product.wholesale'), tone: ChipTone.accent),
      ]);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      // Small (card) prices stay on one line in every language — they scale down rather than wrap.
      if (size == PriceSize.s) FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerLeft, child: line) else line,
      if (showBulk && p.flag('showWholesale') && p.intN('fromBulk') != null && !wholesale)
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: Text(ref.s('product.fromBulk', {'price': formatMoney(p.intN('fromBulk'), cur)}), style: context.type.caption.copyWith(color: context.sw.muted)),
        ),
    ]);
  }
}

enum PriceSize { s, m, l }

/// Elegant tier table with the active tier highlighted and a real (server-computed) nudge.
class TierTable extends ConsumerWidget {
  const TierTable({super.key, required this.price, required this.qty});
  final Json price;
  final int qty;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tiers = price.list('tiers');
    if (tiers.isEmpty) return const SizedBox.shrink();
    final cur = price.str('currency', 'TZS');
    final rows = <(String, int, bool)>[];
    final retail = price.integer('retail');
    final first = tiers.first.integer('minQty');
    final active = tiers.lastWhere((t) => qty >= t.integer('minQty'), orElse: () => const {});
    rows.add(('1–${first - 1}', retail, active.isEmpty));
    for (var i = 0; i < tiers.length; i++) {
      final t = tiers[i];
      final next = i + 1 < tiers.length ? tiers[i + 1].integer('minQty') - 1 : null;
      rows.add((next == null ? '${t.integer('minQty')}+' : '${t.integer('minQty')}–$next', t.integer('unitPrice'), identical(t, active) || (active.isNotEmpty && active['minQty'] == t['minQty'])));
    }
    final nextTier = tiers.where((t) => t.integer('minQty') > qty).firstOrNull;
    final c = context.sw;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Container(
        decoration: BoxDecoration(border: Border.all(color: c.hairline), borderRadius: BorderRadius.circular(SwRadius.sm)),
        child: Row(children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) Container(width: 1, height: 56, color: c.hairline),
            Expanded(
              child: AnimatedContainer(
                duration: SwMotion.base,
                height: 56,
                color: rows[i].$3 ? c.accentSoft : Colors.transparent,
                child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  Text(rows[i].$1, style: context.type.caption.copyWith(color: c.muted)),
                  const SizedBox(height: 2),
                  Text(formatAmount(rows[i].$2, cur), style: context.type.priceS.copyWith(fontWeight: rows[i].$3 ? FontWeight.w600 : FontWeight.w500)),
                ]),
              ),
            ),
          ],
        ]),
      ),
      if (nextTier != null)
        Padding(
          padding: const EdgeInsets.only(top: SwSpace.s2),
          child: Row(children: [
            Icon(Ic.sparkles, size: 14, color: c.accent),
            const SizedBox(width: SwSpace.s1_5),
            Text(
              ref.s('product.tierNudge', {'count': nextTier.integer('minQty') - qty, 'price': formatAmount(nextTier.integer('unitPrice'), cur)}),
              style: context.type.caption.copyWith(color: c.ink),
            ),
          ]),
        ),
    ]);
  }
}

/// Filled heart in Lucide's outline geometry (Lucide has no filled glyph; we keep one icon language).
class HeartIcon extends StatelessWidget {
  const HeartIcon({super.key, required this.filled, this.size = 22, this.color});
  final bool filled;
  final double size;
  final Color? color;
  @override
  Widget build(BuildContext context) {
    final col = color ?? context.sw.ink;
    if (!filled) return Icon(Ic.heart, size: size, color: col);
    return CustomPaint(size: Size.square(size), painter: _HeartPainter(col));
  }
}

class _HeartPainter extends CustomPainter {
  _HeartPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size s) {
    final k = s.width / 24;
    final p = Path()
      ..moveTo(12 * k, 20.5 * k)
      ..cubicTo(11.5 * k, 20.2 * k, 3 * k, 15 * k, 3 * k, 8.8 * k)
      ..cubicTo(3 * k, 6.1 * k, 5.1 * k, 4 * k, 7.6 * k, 4 * k)
      ..cubicTo(9.3 * k, 4 * k, 10.9 * k, 4.9 * k, 12 * k, 6.4 * k)
      ..cubicTo(13.1 * k, 4.9 * k, 14.7 * k, 4 * k, 16.4 * k, 4 * k)
      ..cubicTo(18.9 * k, 4 * k, 21 * k, 6.1 * k, 21 * k, 8.8 * k)
      ..cubicTo(21 * k, 15 * k, 12.5 * k, 20.2 * k, 12 * k, 20.5 * k)
      ..close();
    canvas.drawPath(p, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_HeartPainter o) => o.color != color;
}

/// Colour / shade dots under a product card.
class SwatchDots extends StatelessWidget {
  const SwatchDots({super.key, required this.swatches, this.more = 0});
  final List<Json> swatches;
  final int more;
  @override
  Widget build(BuildContext context) {
    if (swatches.length < 2) return const SizedBox(height: 10);
    final c = context.sw;
    return Row(children: [
      for (final s in swatches.take(5))
        Container(
          width: 10,
          height: 10,
          margin: const EdgeInsets.only(right: SwSpace.s1_5),
          decoration: BoxDecoration(color: _hex(s.strN('hex') ?? s.strN('swatchHex')) ?? c.hairline, shape: BoxShape.circle, border: Border.all(color: c.ink.withValues(alpha: 0.15), width: 0.5)),
        ),
      if (more > 0 || swatches.length > 5) Text('+${more + (swatches.length > 5 ? swatches.length - 5 : 0)}', style: context.type.caption.copyWith(color: c.muted, height: 1)),
    ]);
  }
}

Color? _hex(String? h) => h == null || h.length != 7 ? null : Color(int.parse('FF${h.substring(1)}', radix: 16));
Color? hexColor(String? h) => _hex(h);

/// The product card: 4:5 photo, quiet chrome, serif price, swatch dots, wishlist heart.
/// Height of the card's text block below the 4:5 photo (brand, 2-line title, price, swatches) at
/// 1× text — fixed so every card in a row shares a baseline. Scale with the user's text size.
const productCardInfoHeight = 136.0;
double productCardExtent(BuildContext context, double width) => width * 5 / 4 + productCardInfoHeight * MediaQuery.textScalerOf(context).scale(1);

class ProductCard extends ConsumerWidget {
  const ProductCard({super.key, required this.product, required this.onTap, this.onWishlist, this.wishlisted = false, this.width, this.hero = false});

  /// Shared-element tag for the product page — only where the product appears once on screen.
  final bool hero;
  final Json product;
  final FutureOr<void> Function() onTap;
  final FutureOr<void> Function()? onWishlist;
  final bool wishlisted;
  final double? width;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    final badges = product.list('badges');
    final soldOut = product['inStock'] == false;
    final card = Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      Stack(children: [
        if (hero)
          Hero(tag: 'product-${product.str('id')}', child: SwImage(product.obj('cover'), semanticLabel: product.str('title')))
        else
          SwImage(product.obj('cover'), semanticLabel: product.str('title')),
        if (soldOut)
          Positioned(left: SwSpace.s2, bottom: SwSpace.s2, child: SwChip(ref.s('product.outOfStock'))),
      ]),
      SizedBox(
        height: productCardInfoHeight * MediaQuery.textScalerOf(context).scale(1),
        child: Padding(
          padding: const EdgeInsets.only(top: SwSpace.s3),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(caps(product.obj('brand')?.str('name') ?? ''), style: context.type.labelS.copyWith(color: c.muted), maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: SwSpace.s1),
            Text(product.str('title'), style: context.type.bodyS.copyWith(color: c.ink), maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: SwSpace.s2),
            PriceTag(product.obj('price'), range: product.obj('priceRange'), size: PriceSize.s),
            const SizedBox(height: SwSpace.s2),
            Row(children: [
              Expanded(child: SwatchDots(swatches: product.list('swatches'), more: product.integer('moreSwatches'))),
              if (badges.isNotEmpty) Flexible(child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: SwChip(badges.first.str('label'), tone: _tone(badges.first.str('tone'))))),
            ]),
          ]),
        ),
      ),
    ]);
    return SizedBox(
      width: width,
      child: Stack(children: [
        PressableLink(onTap: onTap, semanticLabel: product.str('title'), child: card),
        if (onWishlist != null)
          Positioned(
            right: 0,
            top: 0,
            child: _WishButton(active: wishlisted, onTap: onWishlist!, label: ref.s('wishlist.add')),
          ),
      ]),
    );
  }

  static ChipTone _tone(String t) => switch (t) { 'ink' => ChipTone.ink, 'accent' => ChipTone.accent, 'blush' => ChipTone.blush, _ => ChipTone.neutral };
}

class _WishButton extends StatefulWidget {
  const _WishButton({required this.active, required this.onTap, required this.label});
  final bool active;
  final FutureOr<void> Function() onTap;
  final String label;
  @override
  State<_WishButton> createState() => _WishButtonState();
}

class _WishButtonState extends State<_WishButton> with SingleTickerProviderStateMixin {
  late final AnimationController _burst = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));
  @override
  void dispose() {
    _burst.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      toggled: widget.active,
      label: widget.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () {
          HapticFeedback.lightImpact();
          if (!widget.active && !context.reduceMotion) _burst.forward(from: 0);
          widget.onTap();
        },
        child: SizedBox.square(
          dimension: 44,
          child: Center(
            child: AnimatedBuilder(
              animation: _burst,
              builder: (context, child) => Transform.scale(scale: 1 + 0.28 * Curves.easeOut.transform(1 - (2 * _burst.value - 1).abs()), child: child),
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(color: context.sw.scrim, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: HeartIcon(filled: widget.active, size: 17, color: context.sw.ink),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Size picker — 44pt pills; unavailable sizes are struck, never hidden.
class SizePicker extends StatelessWidget {
  const SizePicker({super.key, required this.values, required this.selected, required this.onSelect, this.unavailable = const {}});
  final List<Json> values;
  final String? selected;
  final ValueChanged<String> onSelect;
  final Set<String> unavailable;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
      for (final v in values)
        Builder(builder: (context) {
          final id = v.str('id');
          final on = id == selected;
          final out = unavailable.contains(id);
          return Semantics(
            selected: on,
            button: true,
            label: '${v.str('label', v.str('value'))}${out ? ', sold out' : ''}',
            excludeSemantics: true,
            child: GestureDetector(
              onTap: () {
                HapticFeedback.selectionClick();
                onSelect(id);
              },
              child: AnimatedContainer(
                duration: SwMotion.fast,
                constraints: const BoxConstraints(minWidth: 52, minHeight: 44),
                padding: const EdgeInsets.symmetric(horizontal: SwSpace.s3),
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: on ? c.ink : c.surface,
                  borderRadius: BorderRadius.circular(SwRadius.sm),
                  border: Border.all(color: on ? c.ink : c.hairline),
                ),
                child: Text(
                  v.str('label', v.str('value')),
                  style: context.type.titleS.copyWith(
                    color: on ? c.onInk : out ? c.subtle : c.ink,
                    decoration: out ? TextDecoration.lineThrough : null,
                    decorationColor: c.subtle,
                  ),
                ),
              ),
            ),
          );
        }),
    ]);
  }
}

/// Colour / shade swatches — 44pt targets with a 2px ring on the selected one.
class SwatchPicker extends StatelessWidget {
  const SwatchPicker({super.key, required this.values, required this.selected, required this.onSelect});
  final List<Json> values;
  final String? selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Wrap(spacing: SwSpace.s1, children: [
      for (final v in values)
        Semantics(
          selected: v.str('id') == selected,
          button: true,
          label: v.str('label', v.str('value')),
          excludeSemantics: true,
          child: GestureDetector(
            onTap: () {
              HapticFeedback.selectionClick();
              onSelect(v.str('id'));
            },
            child: SizedBox.square(
              dimension: 44,
              child: Center(
                child: AnimatedContainer(
                  duration: SwMotion.fast,
                  width: 34,
                  height: 34,
                  padding: const EdgeInsets.all(3),
                  decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: v.str('id') == selected ? c.ink : Colors.transparent, width: 1.5)),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: hexColor(v.strN('swatchHex')) ?? c.hairline,
                      border: Border.all(color: c.ink.withValues(alpha: 0.12), width: 0.5),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
    ]);
  }
}

class RatingStars extends StatelessWidget {
  const RatingStars({super.key, required this.rating, this.size = 14, this.count});
  final double rating;
  final double size;
  final int? count;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Semantics(
      label: '${rating.toStringAsFixed(1)} out of 5',
      excludeSemantics: true,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 1; i <= 5; i++) Icon(Ic.star, size: size, color: i <= rating.round() ? c.accent : c.hairline),
        if (count != null) Padding(padding: const EdgeInsets.only(left: SwSpace.s1_5), child: Text('($count)', style: context.type.caption.copyWith(color: c.muted))),
      ]),
    );
  }
}

/* ================================================================ inputs */

class SwTextField extends StatelessWidget {
  const SwTextField({super.key, this.controller, this.hint, this.label, this.prefix, this.keyboardType, this.autofocus = false, this.onChanged, this.onSubmitted, this.error, this.inputFormatters, this.textInputAction, this.autofillHints, this.leadingIcon, this.trailing, this.focusNode, this.maxLength});
  final TextEditingController? controller;
  final String? hint, label, error;
  final Widget? prefix, trailing;
  final IconData? leadingIcon;
  final TextInputType? keyboardType;
  final bool autofocus;
  final ValueChanged<String>? onChanged, onSubmitted;
  final List<TextInputFormatter>? inputFormatters;
  final TextInputAction? textInputAction;
  final Iterable<String>? autofillHints;
  final FocusNode? focusNode;
  final int? maxLength;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    OutlineInputBorder b(Color col, [double w = 1]) => OutlineInputBorder(borderRadius: BorderRadius.circular(SwRadius.sm), borderSide: BorderSide(color: col, width: w));
    return Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
      if (label != null) Padding(padding: const EdgeInsets.only(bottom: SwSpace.s2), child: Text(label!, style: context.type.titleS)),
      TextField(
        controller: controller,
        focusNode: focusNode,
        autofocus: autofocus,
        keyboardType: keyboardType,
        onChanged: onChanged,
        onSubmitted: onSubmitted,
        inputFormatters: inputFormatters,
        textInputAction: textInputAction,
        autofillHints: autofillHints,
        maxLength: maxLength,
        style: context.type.bodyM,
        cursorColor: c.ink,
        decoration: InputDecoration(
          isDense: true,
          counterText: '',
          hintText: hint,
          hintStyle: context.type.bodyM.copyWith(color: c.subtle),
          filled: true,
          fillColor: c.surface,
          prefixIcon: leadingIcon != null ? Icon(leadingIcon, size: 18, color: c.muted) : prefix,
          prefixIconConstraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          suffixIcon: trailing,
          contentPadding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s4),
          enabledBorder: b(error != null ? c.danger : c.hairline),
          focusedBorder: b(error != null ? c.danger : c.ink, 1.2),
          border: b(c.hairline),
        ),
      ),
      if (error != null) Padding(padding: const EdgeInsets.only(top: SwSpace.s2), child: Text(error!, style: context.type.caption.copyWith(color: c.danger))),
    ]);
  }
}

/// Six-box OTP input that auto-submits on the last digit; supports paste and SMS autofill
/// (`AutofillHints.oneTimeCode` on iOS; the Android SMS Retriever feeds [controller]).
class OtpInput extends StatefulWidget {
  const OtpInput({super.key, required this.controller, required this.onCompleted, this.length = 6, this.error = false, this.enabled = true});
  final TextEditingController controller;
  final ValueChanged<String> onCompleted;
  final int length;
  final bool error, enabled;

  @override
  State<OtpInput> createState() => _OtpInputState();
}

class _OtpInputState extends State<OtpInput> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    WidgetsBinding.instance.addPostFrameCallback((_) => _focus.requestFocus());
  }

  void _changed() {
    setState(() {});
    final v = widget.controller.text;
    if (v.length == widget.length) widget.onCompleted(v);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final v = widget.controller.text;
    return GestureDetector(
      onTap: () => _focus.requestFocus(),
      child: Stack(children: [
        Opacity(
          opacity: 0,
          child: SizedBox(
            height: 60,
            child: TextField(
              controller: widget.controller,
              focusNode: _focus,
              enabled: widget.enabled,
              keyboardType: TextInputType.number,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(widget.length)],
              showCursor: false,
              enableInteractiveSelection: false,
            ),
          ),
        ),
        Semantics(
          label: 'Verification code, ${v.length} of ${widget.length} digits entered',
          child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            for (var i = 0; i < widget.length; i++)
              AnimatedContainer(
                duration: SwMotion.fast,
                width: 48,
                height: 60,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: c.surface,
                  borderRadius: BorderRadius.circular(SwRadius.sm),
                  border: Border.all(
                    color: widget.error ? c.danger : (i == v.length && _focus.hasFocus) ? c.ink : c.hairline,
                    width: (i == v.length && _focus.hasFocus) ? 1.4 : 1,
                  ),
                ),
                child: Text(i < v.length ? v[i] : '', style: context.type.displayM),
              ),
          ]),
        ),
      ]),
    );
  }
}

/// Rounded search field used on Search and in place pickers.
class SwSearchBar extends StatelessWidget {
  const SwSearchBar({super.key, this.controller, required this.hint, this.onChanged, this.autofocus = false, this.onTap, this.readOnly = false, this.trailing, this.focusNode});
  final TextEditingController? controller;
  final String hint;
  final ValueChanged<String>? onChanged;
  final bool autofocus, readOnly;
  final VoidCallback? onTap;
  final Widget? trailing;
  final FocusNode? focusNode;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Container(
      height: 48,
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.full), border: Border.all(color: c.hairline)),
      child: Row(children: [
        const SizedBox(width: SwSpace.s4),
        Icon(Ic.search, size: 18, color: c.muted),
        const SizedBox(width: SwSpace.s3),
        Expanded(
          child: TextField(
            controller: controller,
            focusNode: focusNode,
            readOnly: readOnly,
            onTap: onTap,
            autofocus: autofocus,
            onChanged: onChanged,
            textInputAction: TextInputAction.search,
            style: context.type.bodyM,
            cursorColor: c.ink,
            decoration: InputDecoration(isCollapsed: true, border: InputBorder.none, hintText: hint, hintStyle: context.type.bodyM.copyWith(color: c.subtle)),
          ),
        ),
        ?trailing,
        const SizedBox(width: SwSpace.s2),
      ]),
    );
  }
}

/* ================================================================ sheets & toasts */

Future<T?> showSwSheet<T>(BuildContext context, {required Widget Function(BuildContext) builder, String? title, bool expand = false}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: context.sw.surface,
    barrierColor: context.sw.overlay,
    builder: (ctx) => ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * (expand ? 0.92 : 0.86)),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Center(
          child: Container(margin: const EdgeInsets.only(top: SwSpace.s3), width: 36, height: 4, decoration: BoxDecoration(color: ctx.sw.hairline, borderRadius: BorderRadius.circular(2))),
        ),
        if (title != null)
          Padding(padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s5, SwSpace.s5, SwSpace.s2), child: Text(title, style: ctx.type.displayS)),
        Flexible(child: builder(ctx)),
      ]),
    ),
  );
}

void showSwToast(BuildContext context, String message, {IconData icon = Ic.check, bool error = false}) {
  final c = context.sw;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      backgroundColor: c.ink,
      margin: const EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, 96),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SwRadius.md)),
      duration: const Duration(milliseconds: 2400),
      content: Row(children: [
        Icon(error ? Ic.circleAlert : icon, size: 18, color: error ? c.dangerSoft : c.accent),
        const SizedBox(width: SwSpace.s3),
        Expanded(child: Text(message, style: context.type.bodyS.copyWith(color: c.onInk))),
      ]),
    ));
}

/// Hairline divider with optional inset.
class Hairline extends StatelessWidget {
  const Hairline({super.key, this.indent = 0});
  final double indent;
  @override
  Widget build(BuildContext context) => Container(height: 1, margin: EdgeInsets.only(left: indent), color: context.sw.hairline);
}
