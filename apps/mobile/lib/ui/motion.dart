import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../core/money.dart';
import '../design/theme.dart';

/// Editorial entrance: content rises 14 px and fades in, staggered by [index] (45 ms apart,
/// capped so long lists never wait). Plays once per element; Reduce Motion renders it in place.
class Reveal extends StatefulWidget {
  const Reveal({super.key, required this.child, this.index = 0, this.offset = 14, this.duration = const Duration(milliseconds: 520)});
  final Widget child;
  final int index;
  final double offset;
  final Duration duration;

  @override
  State<Reveal> createState() => _RevealState();
}

class _RevealState extends State<Reveal> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: widget.duration);
  late final Animation<double> _t = CurvedAnimation(parent: _c, curve: SwMotion.atelier);
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started) return;
    _started = true;
    if (context.reduceMotion) {
      _c.value = 1;
      return;
    }
    final delay = Duration(milliseconds: 45 * widget.index.clamp(0, 8));
    Future<void>.delayed(delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _t,
        child: widget.child,
        builder: (_, child) => Opacity(
          opacity: _t.value,
          child: Transform.translate(offset: Offset(0, widget.offset * (1 - _t.value)), child: child),
        ),
      );
}

/// A price that rolls to its new value (totals, fees, earnings) instead of snapping.
class CountUpMoney extends StatelessWidget {
  const CountUpMoney(this.amount, {super.key, required this.currency, this.style, this.duration = const Duration(milliseconds: 650)});
  final int amount;
  final String currency;
  final TextStyle? style;
  final Duration duration;

  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(end: amount.toDouble()),
        duration: context.reduceMotion ? Duration.zero : duration,
        curve: SwMotion.atelier,
        builder: (_, v, _) => Text(formatMoney(v.round(), currency), style: style, semanticsLabel: formatMoney(amount, currency)),
      );
}

/// A short, physical "bump" every time [value] changes (bag badge, counters). No motion on first build.
class Bump extends StatefulWidget {
  const Bump({super.key, required this.value, required this.child, this.scale = 0.28});
  final Object? value;
  final Widget child;
  final double scale;

  @override
  State<Bump> createState() => _BumpState();
}

class _BumpState extends State<Bump> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 460));

  @override
  void didUpdateWidget(Bump old) {
    super.didUpdateWidget(old);
    if (old.value != widget.value && !context.reduceMotion) _c.forward(from: 0);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: _c,
        child: widget.child,
        // Rise fast, settle with a small overshoot — like a stitch pulled tight.
        builder: (_, child) => Transform.scale(scale: 1 + widget.scale * _bumpCurve(_c.value), child: child),
      );

  /// 0 → 1 quickly, then back to 0 with a light dip below rest (a damped spring).
  static double _bumpCurve(double t) => t < 0.3 ? Curves.easeOut.transform(t / 0.3) : math.exp(-5 * (t - 0.3)) * math.cos(9 * (t - 0.3)) * (1 - t) / 0.7;
}

/// Text that rolls vertically to its new value (prices, counts) — the old value lifts away as the
/// new one rises in. Use for values that change in place; first build is static.
class RollingText extends StatelessWidget {
  const RollingText(this.text, {super.key, this.style, this.semanticsLabel, this.textAlign});
  final String text;
  final TextStyle? style;
  final String? semanticsLabel;
  final TextAlign? textAlign;

  @override
  Widget build(BuildContext context) => AnimatedSwitcher(
        duration: context.reduceMotion ? Duration.zero : SwMotion.base,
        switchInCurve: SwMotion.atelier,
        switchOutCurve: SwMotion.accelerate,
        layoutBuilder: (current, previous) => Stack(alignment: Alignment.centerLeft, clipBehavior: Clip.none, children: [...previous, ?current]),
        transitionBuilder: (child, anim) {
          final incoming = child.key == ValueKey(text);
          return FadeTransition(
            opacity: anim,
            child: SlideTransition(position: Tween(begin: Offset(0, incoming ? 0.45 : -0.45), end: Offset.zero).animate(anim), child: child),
          );
        },
        child: Text(text, key: ValueKey(text), style: style, semanticsLabel: semanticsLabel, textAlign: textAlign),
      );
}

/// Eight small dots that fan out from the centre once — the wishlist "heart burst".
class ParticleBurst extends StatelessWidget {
  const ParticleBurst({super.key, required this.progress, required this.color, this.radius = 22, this.count = 8});
  final Animation<double> progress;
  final Color color;
  final double radius;
  final int count;

  @override
  Widget build(BuildContext context) => IgnorePointer(
        child: AnimatedBuilder(
          animation: progress,
          builder: (_, _) => CustomPaint(size: Size.square(radius * 2 + 8), painter: _BurstPainter(progress.value, color, radius, count)),
        ),
      );
}

class _BurstPainter extends CustomPainter {
  _BurstPainter(this.t, this.color, this.radius, this.count);
  final double t, radius;
  final Color color;
  final int count;

  @override
  void paint(Canvas canvas, Size size) {
    if (t <= 0 || t >= 1) return;
    final c = size.center(Offset.zero);
    final e = Curves.easeOutCubic.transform(t);
    final fade = 1 - Curves.easeIn.transform(t);
    for (var i = 0; i < count; i++) {
      final a = (i / count) * 2 * math.pi - math.pi / 2;
      final r = radius * (0.45 + 0.55 * e);
      final dot = Offset(c.dx + r * math.cos(a), c.dy + r * math.sin(a));
      canvas.drawCircle(dot, (i.isEven ? 2.2 : 1.5) * (1 - 0.5 * e), Paint()..color = color.withValues(alpha: fade));
    }
  }

  @override
  bool shouldRepaint(_BurstPainter o) => o.t != t || o.color != color;
}

/// One slow champagne light sweep across a card (loyalty, drop countdown) — plays once on entry.
class Sheen extends StatefulWidget {
  const Sheen({super.key, required this.child, this.borderRadius = 12, this.delay = const Duration(milliseconds: 500)});
  final Widget child;
  final double borderRadius;
  final Duration delay;

  @override
  State<Sheen> createState() => _SheenState();
}

class _SheenState extends State<Sheen> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));
  bool _started = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_started || context.reduceMotion) return;
    _started = true;
    Future<void>.delayed(widget.delay, () {
      if (mounted) _c.forward();
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(widget.borderRadius),
        child: Stack(children: [
          widget.child,
          Positioned.fill(
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _c,
                builder: (context, _) {
                  final t = SwMotion.atelier.transform(_c.value);
                  if (_c.value == 0 || _c.value == 1) return const SizedBox.shrink();
                  return DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment(-1.6 + 3.2 * t, -0.6),
                        end: Alignment(-0.9 + 3.2 * t, 0.6),
                        colors: [Colors.transparent, context.sw.accent.withValues(alpha: 0.22), Colors.transparent],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ]),
      );
}
