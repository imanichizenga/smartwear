import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../design/theme.dart';
import '../l10n/strings.dart';
import 'icons.dart';
import 'motion.dart';
import 'pressable.dart';
import 'sw_image.dart';

export 'icons.dart';
export 'pressable.dart';
export 'motion.dart';
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

/// One shimmer clock for every skeleton on screen (installed once in the app builder). Skeletons outside a
/// scope (tests, isolated widgets) fall back to their own controller.
class SkeletonScope extends StatefulWidget {
  const SkeletonScope({super.key, required this.child});
  final Widget child;

  static Animation<double>? of(BuildContext context) => context.dependOnInheritedWidgetOfExactType<_SkeletonClock>()?.animation;

  @override
  State<SkeletonScope> createState() => _SkeletonScopeState();
}

class _SkeletonScopeState extends State<SkeletonScope> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _SkeletonClock(animation: _c, child: widget.child);
}

class _SkeletonClock extends InheritedWidget {
  const _SkeletonClock({required this.animation, required super.child});
  final Animation<double> animation;
  @override
  bool updateShouldNotify(_SkeletonClock o) => o.animation != animation;
}

/// Token-coloured shimmer placeholder for lists and grids (actions use the A loader instead).
/// With reduce-motion on it is a static tint.
class Skeleton extends StatefulWidget {
  const Skeleton({super.key, this.width, this.height = 14, this.radius = SwRadius.xs, this.aspectRatio, this.dark = false});
  final double? width, height;
  final double radius;
  final double? aspectRatio;

  /// For skeletons over full-bleed dark media (Discover).
  final bool dark;

  /// Fills its parent (both axes).
  const Skeleton.expand({super.key, this.radius = 0, this.dark = false})
      : width = double.infinity,
        height = double.infinity,
        aspectRatio = null;

  @override
  State<Skeleton> createState() => _SkeletonState();
}

class _SkeletonState extends State<Skeleton> with SingleTickerProviderStateMixin {
  AnimationController? _own;

  Animation<double> _clock(BuildContext context) {
    final shared = SkeletonScope.of(context);
    if (shared != null) return shared;
    return _own ??= AnimationController(vsync: this, duration: const Duration(milliseconds: 1400))..repeat();
  }

  @override
  void dispose() {
    _own?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final reduce = context.reduceMotion;
    final base = widget.dark ? Colors.white.withValues(alpha: 0.08) : c.hairline;
    final hi = widget.dark ? Colors.white.withValues(alpha: 0.16) : Color.lerp(c.hairline, c.surface, 0.6)!;
    final size = SizedBox(width: widget.width, height: widget.aspectRatio == null ? widget.height : null);
    Widget box = reduce
        ? DecoratedBox(decoration: BoxDecoration(borderRadius: BorderRadius.circular(widget.radius), color: base), child: size)
        : AnimatedBuilder(
            animation: _clock(context),
            child: size,
            builder: (context, child) {
              final t = _clock(context).value;
              return DecoratedBox(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(widget.radius),
                  gradient: LinearGradient(begin: Alignment(-1.6 + 3.2 * t, 0), end: Alignment(-0.6 + 3.2 * t, 0), colors: [base, hi, base]),
                ),
                child: child,
              );
            },
          );
    if (widget.aspectRatio != null) box = AspectRatio(aspectRatio: widget.aspectRatio!, child: box);
    return ExcludeSemantics(child: box);
  }
}

/// A line of text that hasn't loaded yet.
class SkeletonLine extends StatelessWidget {
  const SkeletonLine({super.key, this.width, this.height = 12, this.dark = false});
  final double? width;
  final double height;
  final bool dark;
  @override
  Widget build(BuildContext context) => Skeleton(width: width, height: height, radius: height / 2.5, dark: dark);
}

/// An image or card block (fixed size or aspect ratio).
class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.width, this.height, this.aspectRatio, this.radius = SwRadius.xs, this.dark = false});
  final double? width, height, aspectRatio;
  final double radius;
  final bool dark;
  @override
  Widget build(BuildContext context) => Skeleton(width: width, height: height, aspectRatio: aspectRatio, radius: radius, dark: dark);
}

class SkeletonAvatar extends StatelessWidget {
  const SkeletonAvatar({super.key, this.size = 40, this.dark = false});
  final double size;
  final bool dark;
  @override
  Widget build(BuildContext context) => Skeleton(width: size, height: size, radius: size / 2, dark: dark);
}

/// [count] skeleton rows shaped like the real list rows.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, required this.itemBuilder, this.count = 6, this.padding = const EdgeInsets.symmetric(horizontal: SwSpace.s5, vertical: SwSpace.s4), this.gap = SwSpace.s5, this.sliver = false});
  final Widget Function(BuildContext context, int index) itemBuilder;
  final int count;
  final EdgeInsetsGeometry padding;
  final double gap;
  final bool sliver;

  @override
  Widget build(BuildContext context) {
    final children = [for (var i = 0; i < count; i++) ...[if (i > 0) SizedBox(height: gap), itemBuilder(context, i)]];
    final body = Padding(padding: padding, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children));
    final content = Semantics(label: context.s('common.loading'), liveRegion: true, child: body);
    return sliver ? SliverToBoxAdapter(child: content) : SingleChildScrollView(physics: const NeverScrollableScrollPhysics(), child: content);
  }
}

/// Error state for a failed load: a distinct offline view (no connection) versus a server-error view, each
/// with an inline retry. Use with `AsyncValue.when(skipLoadingOnRefresh: true, …)` so pull-to-refresh keeps
/// the data on screen.
class LoadError extends StatelessWidget {
  const LoadError({super.key, required this.error, this.onRetry, this.compact = false});
  final Object error;
  final VoidCallback? onRetry;
  final bool compact;

  static bool isOffline(Object e) => e is ApiException && e.isNetwork;

  @override
  Widget build(BuildContext context) {
    final s = context.s;
    final offline = isOffline(error);
    final title = offline ? s('state.offline.title') : s('common.error.title');
    final body = offline ? s('state.offline.body') : s('common.error.body');
    final action = onRetry == null ? null : SwButton(label: s('common.retry'), icon: Ic.refreshCw, variant: SwButtonVariant.secondary, onPressed: onRetry);
    if (compact) {
      final c = context.sw;
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5, vertical: SwSpace.s4),
        child: Row(children: [
          Icon(offline ? Ic.wifiOff : Ic.circleAlert, size: 18, color: c.muted),
          const SizedBox(width: SwSpace.s3),
          Expanded(child: Text(offline ? s('state.offline.title') : s('common.error.title'), style: context.type.bodyS.copyWith(color: c.muted))),
          if (onRetry != null) SwButton(label: s('common.retry'), variant: SwButtonVariant.ghost, onPressed: onRetry),
        ]),
      );
    }
    return EmptyState(title: title, body: body, icon: offline ? Ic.wifiOff : Ic.circleAlert, action: action);
  }
}

/// Neutral, branded stand-in for media that is genuinely missing — never a "broken image" icon.
class MediaFallback extends StatelessWidget {
  const MediaFallback({super.key, this.dark = false});
  final bool dark;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final base = dark ? const Color(0xFF1C1A18) : c.hairline;
    return ExcludeSemantics(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color.lerp(base, c.surface, dark ? 0.05 : 0.55)!, base]),
        ),
        child: LayoutBuilder(builder: (context, box) {
          final size = (box.biggest.shortestSide * 0.18).clamp(10.0, 28.0).toDouble();
          return Center(
            child: Text('SW', style: context.type.titleS.copyWith(fontSize: size, letterSpacing: size * 0.3, color: (dark ? Colors.white : c.ink).withValues(alpha: 0.14), fontWeight: FontWeight.w700)),
          );
        }),
      ),
    );
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
        // Rolls when the price changes in place (variant, quantity tier, wholesale switch).
        RollingText(varies ? '${ref.s('common.from')} ${formatMoney(min, cur)}' : formatMoney(your, cur), style: style),
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
            Flexible(
              child: RollingText(
                ref.s('product.tierNudge', {'count': nextTier.integer('minQty') - qty, 'price': formatAmount(nextTier.integer('unitPrice'), cur)}),
                style: context.type.caption.copyWith(color: c.ink),
              ),
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
              if (badges.isNotEmpty) Flexible(child: Align(alignment: Alignment.centerRight, child: FittedBox(fit: BoxFit.scaleDown, alignment: Alignment.centerRight, child: SwChip(badges.first.str('label'), tone: _tone(badges.first.str('tone')))))),
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
  late final AnimationController _burst = AnimationController(vsync: this, duration: const Duration(milliseconds: 560));
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
          child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
            OverflowBox(maxWidth: 60, maxHeight: 60, child: ParticleBurst(progress: _burst, color: context.sw.accent, radius: 24)),
            AnimatedBuilder(
              animation: _burst,
              builder: (context, child) => Transform.scale(scale: 1 + 0.28 * Curves.easeOut.transform(1 - (2 * _burst.value - 1).abs()), child: child),
              child: Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(color: context.sw.scrim, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: AnimatedSwitcher(
                  duration: SwMotion.fast,
                  transitionBuilder: (c, a) => ScaleTransition(scale: a, child: c),
                  child: HeartIcon(key: ValueKey(widget.active), filled: widget.active, size: 17, color: context.sw.ink),
                ),
              ),
            ),
          ]),
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
/// One-time-code field: responsive boxes, blinking caret, paste (long-press), SMS autofill hints,
/// error shake and a success state. [onCompleted] fires once per distinct complete code, never while
/// disabled, so rebuilds / selection changes can't double-submit.
class OtpInput extends StatefulWidget {
  const OtpInput({super.key, required this.controller, required this.onCompleted, this.length = 6, this.error = false, this.enabled = true, this.success = false, this.pasteLabel = 'Paste'});
  final TextEditingController controller;
  final ValueChanged<String> onCompleted;
  final int length;
  final bool error, enabled, success;
  final String pasteLabel;

  @override
  State<OtpInput> createState() => _OtpInputState();
}

class _OtpInputState extends State<OtpInput> with TickerProviderStateMixin {
  final _focus = FocusNode();
  late final AnimationController _caret = AnimationController(vsync: this, duration: const Duration(milliseconds: 530));
  late final AnimationController _shake = AnimationController(vsync: this, duration: const Duration(milliseconds: 360));
  String? _fired;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _focus.addListener(_focusChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focus.requestFocus();
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncCaret();
  }

  @override
  void didUpdateWidget(OtpInput old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.removeListener(_changed);
      widget.controller.addListener(_changed);
    }
    if (widget.error && !old.error && !context.reduceMotion) _shake.forward(from: 0);
    // Re-enabled after a failed attempt with the same digits still there: allow submitting them again.
    if (widget.enabled && !old.enabled && widget.error) _fired = null;
    _syncCaret();
  }

  void _focusChanged() {
    if (!mounted) return;
    setState(() {});
    _syncCaret();
  }

  void _syncCaret() {
    final blink = _focus.hasFocus && widget.enabled && !widget.success && !context.reduceMotion;
    if (blink && !_caret.isAnimating) {
      _caret.repeat(reverse: true);
    } else if (!blink && _caret.isAnimating) {
      _caret.stop();
      _caret.value = 1;
    }
  }

  void _changed() {
    if (!mounted) return;
    setState(() {});
    final v = widget.controller.text;
    if (v.length < widget.length) {
      _fired = null;
      return;
    }
    if (!widget.enabled || v == _fired) return;
    _fired = v;
    widget.onCompleted(v);
  }

  /// Fill from any text: keeps digits only (e.g. "Your code is 123 456").
  void fill(String raw) {
    final digits = raw.replaceAll(RegExp(r'\D'), '');
    if (digits.isEmpty || !widget.enabled) return;
    final code = digits.length > widget.length ? digits.substring(0, widget.length) : digits;
    widget.controller.value = TextEditingValue(text: code, selection: TextSelection.collapsed(offset: code.length));
  }

  Future<void> _paste(Offset globalPos) async {
    if (!widget.enabled) return;
    final overlay = Overlay.of(context).context.findRenderObject() as RenderBox?;
    if (overlay == null) return;
    HapticFeedback.selectionClick();
    final picked = await showMenu<bool>(
      context: context,
      position: RelativeRect.fromRect(globalPos & const Size(1, 1), Offset.zero & overlay.size),
      color: context.sw.surfaceRaised,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SwRadius.sm)),
      items: [
        PopupMenuItem<bool>(
          value: true,
          height: 44,
          child: Row(children: [Icon(Ic.copy, size: 18, color: context.sw.ink), const SizedBox(width: SwSpace.s3), Text(widget.pasteLabel, style: context.type.bodyM)]),
        ),
      ],
    );
    if (picked != true) return;
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null) fill(data!.text!);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _focus.removeListener(_focusChanged);
    _focus.dispose();
    _caret.dispose();
    _shake.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final v = widget.controller.text;
    final n = widget.length;
    return LayoutBuilder(builder: (context, box) {
      const gap = SwSpace.s2;
      final fit = (box.maxWidth - gap * (n - 1)) / n;
      // 40–56 dp boxes; below 40 only when the screen physically can't fit them (very narrow phones).
      final double w = fit < 40 ? fit : fit.clamp(40.0, 56.0).toDouble();
      final double h = (w * 1.22).clamp(52.0, 64.0).toDouble();
      return GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => _focus.requestFocus(),
        onLongPressStart: (d) => _paste(d.globalPosition),
        child: Stack(children: [
          Opacity(
            opacity: 0,
            child: SizedBox(
              height: h,
              child: TextField(
                controller: widget.controller,
                focusNode: _focus,
                readOnly: !widget.enabled,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                // Paste of a whole message ("Code: 123456") keeps just the digits.
                inputFormatters: [_DigitsFormatter(), LengthLimitingTextInputFormatter(n)],
                showCursor: false,
                enableInteractiveSelection: false,
              ),
            ),
          ),
          AnimatedBuilder(
            animation: _shake,
            builder: (context, child) {
              final t = _shake.value;
              final dx = _shake.isAnimating ? math.sin(t * math.pi * 6) * 8 * (1 - t) : 0.0;
              return Transform.translate(offset: Offset(dx, 0), child: child);
            },
            child: Semantics(
              label: 'Verification code, ${v.length} of $n digits entered',
              child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                for (var i = 0; i < n; i++) ...[
                  if (i > 0) const SizedBox(width: gap),
                  _OtpBox(
                    width: w,
                    height: h,
                    digit: i < v.length ? v[i] : '',
                    active: i == v.length.clamp(0, n - 1) && v.length < n && _focus.hasFocus && widget.enabled,
                    filled: i < v.length,
                    error: widget.error,
                    success: widget.success,
                    caret: _caret,
                  ),
                ],
              ]),
            ),
          ),
        ]),
      );
    });
  }
}

class _OtpBox extends StatelessWidget {
  const _OtpBox({required this.width, required this.height, required this.digit, required this.active, required this.filled, required this.error, required this.success, required this.caret});
  final double width, height;
  final String digit;
  final bool active, filled, error, success;
  final Animation<double> caret;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final color = success ? c.success : error ? c.danger : active ? c.accent : filled ? c.ink : c.hairline;
    return AnimatedContainer(
      duration: SwMotion.fast,
      width: width,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: success ? c.successSoft : c.surface,
        borderRadius: BorderRadius.circular(SwRadius.sm),
        border: Border.all(color: color, width: active || success || error ? 1.5 : 1),
      ),
      child: digit.isNotEmpty
          ? Text(digit, style: context.type.displayM.copyWith(color: error ? c.danger : c.ink))
          : active
              ? FadeTransition(opacity: caret, child: Container(width: 1.5, height: height * 0.42, color: c.accent))
              : null,
    );
  }
}

class _DigitsFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final d = newValue.text.replaceAll(RegExp(r'\D'), '');
    return TextEditingValue(text: d, selection: TextSelection.collapsed(offset: d.length));
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

/// Floating toast. With [actionLabel] / [onAction] it shows a text action (e.g. Undo) and stays a little longer.
void showSwToast(BuildContext context, String message, {IconData icon = Ic.check, bool error = false, String? actionLabel, VoidCallback? onAction}) {
  final c = context.sw;
  final hasAction = actionLabel != null && onAction != null;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      behavior: SnackBarBehavior.floating,
      elevation: 0,
      backgroundColor: c.ink,
      margin: const EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, 96),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SwRadius.md)),
      duration: Duration(milliseconds: hasAction ? 4000 : 2400),
      action: hasAction ? SnackBarAction(label: actionLabel, textColor: c.accent, onPressed: onAction) : null,
      content: Row(children: [
        Icon(error ? Ic.circleAlert : icon, size: 18, color: error ? c.dangerSoft : c.accent),
        const SizedBox(width: SwSpace.s3),
        Expanded(child: Text(message, style: context.type.bodyS.copyWith(color: c.onInk))),
      ]),
    ));
}

/// Bottom clearance for content and bottom bars. Inside the tab shell this already includes the floating nav
/// bar (the shell's Scaffold uses `extendBody`, which adds the bar's height to MediaQuery's bottom padding);
/// on pushed pages it is just the system inset. Use this instead of magic numbers.
extension SwInsets on BuildContext {
  double get bottomInset => MediaQuery.paddingOf(this).bottom;
}

/// Hairline divider with optional inset.
class Hairline extends StatelessWidget {
  const Hairline({super.key, this.indent = 0});
  final double indent;
  @override
  Widget build(BuildContext context) => Container(height: 1, margin: EdgeInsets.only(left: indent), color: context.sw.hairline);
}
