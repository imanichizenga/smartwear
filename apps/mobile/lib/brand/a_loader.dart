import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../design/theme.dart';
import 'geometry.g.dart';

export 'geometry.g.dart' show ALoaderSize;

/// The Atelier A — the SmartWear loader.
///
/// One 1.6 s loop, phase-for-phase identical to the admin's CSS loader (both read packages/brand):
/// legs draw base → apex with a champagne sheen, the crossbar is sewn as a dashed stitch led by a
/// needle dot, a sparkle twinkles at the apex, then the mark breathes and fades to restart.
/// With Reduce Motion on it is a static A with a gentle opacity pulse.
class ALoader extends StatefulWidget {
  const ALoader({super.key, this.size = ALoaderSize.md, this.color, this.backdrop = false, this.semanticLabel});

  final ALoaderSize size;

  /// Ink colour; defaults to the theme's ink (adapts to light/dark).
  final Color? color;

  /// Frosted circular backdrop, for use over photography.
  final bool backdrop;
  final String? semanticLabel;

  @override
  State<ALoader> createState() => _ALoaderState();
}

class _ALoaderState extends State<ALoader> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: ALoaderTiming.loop);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduce = context.reduceMotion;
    _c.duration = reduce ? ALoaderTiming.pulsePeriod : ALoaderTiming.loop;
    if (!_c.isAnimating) _c.repeat();
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ink = widget.color ?? context.sw.ink;
    final accent = context.sw.accent;
    final px = widget.size.px;
    Widget mark = RepaintBoundary(
      child: CustomPaint(
        size: Size.square(px),
        painter: _APainter(_c, ink: ink, accent: accent, size: widget.size, reduceMotion: context.reduceMotion),
      ),
    );
    if (widget.backdrop) {
      mark = ClipOval(
        child: BackdropFilter(
          filter: ui.ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: Container(
            padding: EdgeInsets.all(px * 0.28),
            color: context.sw.scrim,
            child: mark,
          ),
        ),
      );
    }
    return Semantics(label: widget.semanticLabel, liveRegion: widget.semanticLabel != null, child: mark);
  }
}

/// Absolute M/C/Z parser — enough for the sparkle path in packages/brand.
Path _parseSvg(String d) {
  final p = Path();
  final tokens = RegExp(r'[MCZ]|-?\d*\.?\d+').allMatches(d).map((m) => m.group(0)!).toList();
  var i = 0;
  double n() => double.parse(tokens[i++]);
  while (i < tokens.length) {
    final cmd = tokens[i++];
    switch (cmd) {
      case 'M':
        p.moveTo(n(), n());
      case 'C':
        while (i < tokens.length && !RegExp(r'^[MCZ]$').hasMatch(tokens[i])) {
          p.cubicTo(n(), n(), n(), n(), n(), n());
        }
      case 'Z':
        p.close();
    }
  }
  return p;
}

final Path _sparkle = _parseSvg(AGeometry.sparklePath);
final Cubic _ease = Cubic(ALoaderTiming.easing[0], ALoaderTiming.easing[1], ALoaderTiming.easing[2], ALoaderTiming.easing[3]);

class _APainter extends CustomPainter {
  _APainter(this.anim, {required this.ink, required this.accent, required this.size, required this.reduceMotion}) : super(repaint: anim);

  final Animation<double> anim;
  final Color ink, accent;
  final ALoaderSize size;
  final bool reduceMotion;

  double _e(APhase ph, double t) => _ease.transform(ph.progress(t));

  @override
  void paint(Canvas canvas, Size s) {
    final t = anim.value;
    canvas.save();
    canvas.scale(s.width / 100, s.height / 100);

    final legPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = size.stroke;
    const base = [Offset(AGeometry.baseLeftX, AGeometry.baseLeftY), Offset(AGeometry.baseRightX, AGeometry.baseRightY)];
    const apex = Offset(AGeometry.apexX, AGeometry.apexY);

    if (reduceMotion) {
      // Static A with a gentle opacity pulse.
      final o = ALoaderTiming.pulseMin + (ALoaderTiming.pulseMax - ALoaderTiming.pulseMin) * (0.5 - 0.5 * math.cos(t * 2 * math.pi));
      legPaint.color = ink.withValues(alpha: o);
      for (final b in base) {
        canvas.drawLine(b, apex, legPaint);
      }
      _stitch(canvas, 1, ink.withValues(alpha: o));
      canvas.drawPath(_sparkle, Paint()..color = accent.withValues(alpha: o));
      canvas.restore();
      return;
    }

    // Breathe (about the optical centre) — applies to the whole mark.
    final breathe = t < ALoaderTiming.breathe.start || t > ALoaderTiming.breathe.end
        ? 1.0
        : 1 + (ALoaderTiming.breatheScale - 1) * math.sin(ALoaderTiming.breathe.progress(t) * math.pi);
    canvas.translate(50, 55);
    canvas.scale(breathe);
    canvas.translate(-50, -55);

    final fade = 1 - _e(ALoaderTiming.fadeOut, t);
    final draw = _e(ALoaderTiming.drawOn, t);

    // 1 · Draw-on: both legs grow from the base to the apex.
    legPaint.color = ink.withValues(alpha: fade);
    for (final b in base) {
      canvas.drawLine(b, Offset.lerp(b, apex, draw)!, legPaint);
    }
    // Champagne sheen travelling along the strokes (hidden at tiny sizes where it would muddy).
    if (size.px >= 24) {
      final sp = (t / 0.58).clamp(0.0, 1.0);
      final sheenAlpha = (sp < 0.12 ? sp / 0.12 : sp > 0.86 ? (1 - sp) / 0.14 : 1.0) * 0.9 * fade;
      if (sheenAlpha > 0.01) {
        final sheen = Paint()
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeWidth = size.stroke * 0.55
          ..color = accent.withValues(alpha: sheenAlpha);
        for (final b in base) {
          final head = math.min(sp * 1.15, draw);
          final tail = math.max(0.0, head - 0.18);
          if (head > tail) canvas.drawLine(Offset.lerp(b, apex, tail)!, Offset.lerp(b, apex, head)!, sheen);
        }
      }
    }

    // 2 · Stitch: the crossbar is sewn left → right, led by a needle dot.
    final stitch = _e(ALoaderTiming.stitch, t);
    if (stitch > 0) _stitch(canvas, stitch, ink.withValues(alpha: fade));
    if (t > 0.33 && t < 0.70) {
      final needleAlpha = t < 0.35 ? (t - 0.33) / 0.02 : t > 0.66 ? (0.70 - t) / 0.04 : 1.0;
      final x = AGeometry.crossX1 + AGeometry.crossbarLength * stitch;
      canvas.drawCircle(Offset(x, AGeometry.crossY), size.needleRadius, Paint()..color = accent.withValues(alpha: needleAlpha.clamp(0, 1) * fade));
    }

    // 3 · Sparkle twinkles at the apex (scale + turn).
    final sp = ALoaderTiming.sparkle.progress(t);
    if (sp > 0) {
      final grow = sp < 0.46 ? _ease.transform(sp / 0.46) * 1.15 : 1.15 - 0.25 * _ease.transform((sp - 0.46) / 0.54);
      final turn = (-30 + 75 * _ease.transform(sp)) * math.pi / 180;
      canvas.save();
      canvas.translate(50, 10);
      canvas.rotate(turn);
      canvas.scale(grow);
      canvas.translate(-50, -10);
      canvas.drawPath(_sparkle, Paint()..color = accent.withValues(alpha: math.min(1, sp * 4)));
      canvas.restore();
    }
    canvas.restore();
  }

  void _stitch(Canvas canvas, double progress, Color color) {
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = size.stitchStroke
      ..color = color;
    final end = AGeometry.crossX1 + AGeometry.crossbarLength * progress;
    final dash = AGeometry.stitchDash[0], gap = AGeometry.stitchDash[1];
    var x = AGeometry.crossX1;
    while (x < end) {
      canvas.drawLine(Offset(x, AGeometry.crossY), Offset(math.min(x + dash, end), AGeometry.crossY), paint);
      x += dash + gap;
    }
  }

  @override
  bool shouldRepaint(_APainter old) => old.ink != ink || old.accent != accent || old.size != size || old.reduceMotion != reduceMotion;
}

/// Full-area wait: the `xl` mark with a serif status line (first launch, payment, finding a rider).
class ALoaderBlock extends StatelessWidget {
  const ALoaderBlock({super.key, this.message, this.size = ALoaderSize.xl});
  final String? message;
  final ALoaderSize size;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ALoader(size: size, semanticLabel: message ?? 'Loading'),
          if (message != null) ...[
            const SizedBox(height: SwSpace.s6),
            Text(message!, style: context.type.displayS.copyWith(color: context.sw.muted), textAlign: TextAlign.center),
          ],
        ],
      ),
    );
  }
}
