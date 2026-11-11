import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../brand/a_loader.dart';
import '../design/theme.dart';

const _minPending = Duration(milliseconds: 300);

/// Runs [fn] with a pending flag that stays on ≥300ms and ignores taps while pending.
mixin PendingAction<T extends StatefulWidget> on State<T> {
  bool pending = false;

  Future<void> runPending(FutureOr<void> Function() fn) async {
    if (pending) return;
    setState(() => pending = true);
    final started = DateTime.now();
    try {
      await fn();
    } finally {
      final left = _minPending - DateTime.now().difference(started);
      if (left > Duration.zero) await Future<void>.delayed(left);
      if (mounted) setState(() => pending = false);
    }
  }
}

/// Swaps [child] for the A loader in place (same box, no layout shift) and cross-fades back (150ms).
class PendingSwap extends StatelessWidget {
  const PendingSwap({super.key, required this.pending, required this.child, this.size = ALoaderSize.sm, this.color});
  final bool pending;
  final Widget child;
  final ALoaderSize size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Stack(alignment: Alignment.center, children: [
      AnimatedOpacity(opacity: pending ? 0 : 1, duration: SwMotion.crossfade, child: child),
      if (pending)
        Positioned.fill(child: Center(child: ALoader(size: size, color: color))),
    ]);
  }
}

/// The app's only tap target for navigation and cards. Press scales gently; while [onTap]'s future
/// runs (prefetch → route), the [icon] — or, without one, a small loader over the content — shows
/// the A loader. Ban on raw GestureDetector/InkWell for navigation lives in analysis_options.
class PressableLink extends StatefulWidget {
  const PressableLink({super.key, required this.onTap, required this.child, this.semanticLabel, this.haptic = false, this.loaderOverlay = true, this.scale = true});

  final FutureOr<void> Function()? onTap;
  final Widget child;
  final String? semanticLabel;
  final bool haptic;

  /// For cards: show a frosted A loader centred over the content while pending.
  final bool loaderOverlay;
  final bool scale;

  @override
  State<PressableLink> createState() => _PressableLinkState();
}

class _PressableLinkState extends State<PressableLink> with PendingAction {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final enabled = widget.onTap != null && !pending;
    return Semantics(
      button: true,
      enabled: enabled,
      label: widget.semanticLabel,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: enabled
            ? () {
                if (widget.haptic) HapticFeedback.lightImpact();
                runPending(widget.onTap!);
              }
            : null,
        child: AnimatedScale(
          scale: widget.scale && _down && !context.reduceMotion ? SwMotion.pressScale : 1,
          duration: SwMotion.fast,
          curve: SwMotion.atelier,
          child: Stack(children: [
            widget.child,
            if (pending && widget.loaderOverlay) const Positioned.fill(child: Center(child: ALoader(size: ALoaderSize.md, backdrop: true))),
          ]),
        ),
      ),
    );
  }
}

enum SwButtonVariant { primary, secondary, ghost, premium, danger }

/// Button with built-in pending state: the icon (or the label, when there is no icon) becomes the
/// A loader while [onPressed] runs. Heights 44/52 keep every target ≥44pt.
class SwButton extends StatefulWidget {
  const SwButton({super.key, required this.label, this.onPressed, this.icon, this.variant = SwButtonVariant.primary, this.expand = false, this.large = false, this.pending, this.haptic = false});

  final String label;
  final FutureOr<void> Function()? onPressed;
  final IconData? icon;
  final SwButtonVariant variant;
  final bool expand;
  final bool large;

  /// External pending flag (e.g. a mutation owned by a provider). Combined with the internal one.
  final bool? pending;
  final bool haptic;

  @override
  State<SwButton> createState() => _SwButtonState();
}

class _SwButtonState extends State<SwButton> with PendingAction {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final busy = pending || (widget.pending ?? false);
    final enabled = widget.onPressed != null && !busy;
    final (bg, fg, border) = switch (widget.variant) {
      SwButtonVariant.primary => (c.ink, c.onInk, Colors.transparent),
      SwButtonVariant.secondary => (c.surface, c.ink, c.ink.withValues(alpha: 0.18)),
      SwButtonVariant.ghost => (Colors.transparent, c.ink, Colors.transparent),
      SwButtonVariant.premium => (c.accent, c.onAccent, Colors.transparent),
      SwButtonVariant.danger => (c.surface, c.danger, c.danger.withValues(alpha: 0.3)),
    };
    final h = widget.large ? 52.0 : 44.0;
    final labelStyle = context.type.titleS.copyWith(color: fg, letterSpacing: 0.2, fontSize: widget.large ? 15 : 14);
    final loaderSize = ALoaderSize.sm;
    final label = Text(widget.label, style: labelStyle, maxLines: 1, overflow: TextOverflow.ellipsis);
    final content = Row(mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
      if (widget.icon != null) ...[
        PendingSwap(pending: busy, size: loaderSize, color: fg, child: Icon(widget.icon, size: 18, color: fg)),
        const SizedBox(width: SwSpace.s2),
        Flexible(child: label),
      ] else
        Flexible(child: PendingSwap(pending: busy, size: loaderSize, color: fg, child: label)),
    ]);
    return Semantics(
      button: true,
      enabled: enabled,
      label: busy ? '${widget.label}, loading' : widget.label,
      excludeSemantics: true,
      child: GestureDetector(
        onTapDown: enabled ? (_) => setState(() => _down = true) : null,
        onTapCancel: () => setState(() => _down = false),
        onTapUp: (_) => setState(() => _down = false),
        onTap: enabled
            ? () {
                if (widget.haptic) HapticFeedback.lightImpact();
                runPending(widget.onPressed!);
              }
            : null,
        child: AnimatedScale(
          scale: _down && !context.reduceMotion ? SwMotion.pressScale : 1,
          duration: SwMotion.fast,
          child: AnimatedOpacity(
            opacity: widget.onPressed == null ? 0.45 : 1,
            duration: SwMotion.fast,
            child: Container(
              height: h,
              padding: EdgeInsets.symmetric(horizontal: widget.large ? SwSpace.s6 : SwSpace.s5),
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SwRadius.sm), border: Border.all(color: border)),
              child: content,
            ),
          ),
        ),
      ),
    );
  }
}

/// 44pt round icon button (wishlist, close, share…) with the same pending swap.
class SwIconButton extends StatefulWidget {
  const SwIconButton({super.key, required this.icon, required this.onPressed, required this.semanticLabel, this.color, this.filled = false, this.haptic = false, this.size = 44, this.activeIcon, this.active = false});

  final IconData icon;
  final IconData? activeIcon;
  final bool active;
  final FutureOr<void> Function()? onPressed;
  final String semanticLabel;
  final Color? color;
  final bool filled;
  final bool haptic;
  final double size;

  @override
  State<SwIconButton> createState() => _SwIconButtonState();
}

class _SwIconButtonState extends State<SwIconButton> with PendingAction {
  @override
  Widget build(BuildContext context) {
    final fg = widget.color ?? context.sw.ink;
    return Semantics(
      button: true,
      label: widget.semanticLabel,
      toggled: widget.activeIcon != null ? widget.active : null,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: widget.onPressed == null || pending
            ? null
            : () {
                if (widget.haptic) HapticFeedback.lightImpact();
                runPending(widget.onPressed!);
              },
        child: SizedBox.square(
          dimension: widget.size,
          child: Center(
            child: Container(
              width: widget.filled ? 36 : null,
              height: widget.filled ? 36 : null,
              decoration: widget.filled ? BoxDecoration(color: context.sw.scrim, shape: BoxShape.circle) : null,
              alignment: Alignment.center,
              child: PendingSwap(
                pending: pending,
                size: ALoaderSize.sm,
                color: fg,
                child: AnimatedSwitcher(
                  duration: SwMotion.fast,
                  transitionBuilder: (c, a) => ScaleTransition(scale: Tween(begin: 0.6, end: 1.0).animate(a), child: FadeTransition(opacity: a, child: c)),
                  child: Icon(widget.active && widget.activeIcon != null ? widget.activeIcon : widget.icon, key: ValueKey(widget.active), size: 22, color: fg),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
