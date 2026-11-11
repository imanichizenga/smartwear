import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../home/home_screen.dart' show ProductRail;
import '../shared/nav.dart';

/// Full-screen, vertically swiped Looks. Double-tap to like (heart burst); tags open the products.
class DiscoverScreen extends ConsumerWidget {
  const DiscoverScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final looks = ref.watch(looksProvider);
    const on = SwColors.dark;
    return Scaffold(
      backgroundColor: on.canvas,
      body: looks.when(
        loading: () => const Center(child: Skeleton(width: 240, height: 420)),
        error: (e, _) => EmptyState(title: ref.s('common.error.title'), action: SwButton(label: ref.s('common.retry'), onPressed: () => ref.refresh(looksProvider.future))),
        data: (items) => items.isEmpty
            ? EmptyState(title: ref.s('looks.empty'), icon: Ic.compass)
            : PageView.builder(scrollDirection: Axis.vertical, itemCount: items.length, itemBuilder: (context, i) => LookPage(look: items[i])),
      ),
    );
  }
}

class LookPage extends ConsumerStatefulWidget {
  const LookPage({super.key, required this.look});
  final Json look;
  @override
  ConsumerState<LookPage> createState() => _LookPageState();
}

class _LookPageState extends ConsumerState<LookPage> with SingleTickerProviderStateMixin {
  late bool _liked = widget.look.flag('liked');
  late bool _saved = widget.look.flag('saved');
  late int _likes = widget.look.integer('likes');
  late final AnimationController _burst = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));

  @override
  void dispose() {
    _burst.dispose();
    super.dispose();
  }

  Future<void> _react(String kind, {bool? force}) async {
    await requireSignIn(context, ref, () async {
      final on = force ?? !(kind == 'like' ? _liked : _saved);
      setState(() {
        if (kind == 'like') {
          if (on != _liked) _likes += on ? 1 : -1;
          _liked = on;
        } else {
          _saved = on;
        }
      });
      HapticFeedback.lightImpact();
      try {
        await ref.read(apiProvider).post<Json>('/looks/${widget.look.str('id')}/react/$kind', {'on': on});
      } on ApiException {
        // Optimistic; the next feed load reconciles.
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    const on = SwColors.dark;
    final tags = widget.look.list('tags');
    final products = [for (final t in tags) if (t.obj('product') != null) t.obj('product')!];
    return GestureDetector(
      onDoubleTap: () {
        if (!context.reduceMotion) _burst.forward(from: 0);
        _react('like', force: true);
      },
      child: Stack(fit: StackFit.expand, children: [
        SwImage(widget.look.obj('media'), aspectRatio: null, radius: 0),
        DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, stops: const [0, 0.25, 0.6, 1], colors: [on.canvas.withValues(alpha: 0.35), on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0.75)]))),
        // Product tag pins at their x/y on the photo.
        LayoutBuilder(builder: (context, box) {
          return Stack(children: [
            for (final t in tags)
              if (t.obj('product') != null)
                Positioned(
                  left: t.dbl('x', 0.5) * box.maxWidth - 14,
                  top: t.dbl('y', 0.5) * box.maxHeight - 14,
                  child: Semantics(
                    button: true,
                    label: t.obj('product')!.str('title'),
                    child: GestureDetector(
                      onTap: () => openProduct(context, ref, t.obj('product')!),
                      child: Container(width: 28, height: 28, decoration: BoxDecoration(shape: BoxShape.circle, color: on.ink.withValues(alpha: 0.9), border: Border.all(color: on.canvas.withValues(alpha: 0.2), width: 6))),
                    ),
                  ),
                ),
          ]);
        }),
        Center(
          child: AnimatedBuilder(
            animation: _burst,
            builder: (_, _) {
              final t = _burst.value;
              if (t == 0 || t == 1) return const SizedBox.shrink();
              return Opacity(opacity: (1 - t).clamp(0, 1), child: Transform.scale(scale: 0.6 + t * 0.9, child: HeartIcon(filled: true, size: 96, color: on.ink)));
            },
          ),
        ),
        Positioned(
          right: SwSpace.s3,
          bottom: 150 + context.safe.bottom,
          child: Column(children: [
            _Action(icon: HeartIcon(filled: _liked, color: on.ink, size: 26), label: '$_likes', onTap: () => _react('like')),
            _Action(icon: Icon(_saved ? Ic.bookmarkCheck : Ic.bookmark, color: on.ink, size: 26), label: ref.s('wishlist.added'), onTap: () => _react('save')),
            _Action(icon: Icon(Ic.share2, color: on.ink, size: 26), label: ref.s('common.share'), onTap: () => Clipboard.setData(ClipboardData(text: 'https://smartwear.co.tz/looks/${widget.look.str('id')}'))),
          ]),
        ),
        Positioned(
          left: SwSpace.s5,
          right: 88,
          bottom: 104 + context.safe.bottom,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (widget.look.strN('caption') != null) Text(widget.look.str('caption'), style: context.type.displayS.copyWith(color: on.ink)),
            const SizedBox(height: SwSpace.s4),
            if (products.isNotEmpty)
              SwButton(
                label: '${ref.s('looks.shopThisLook')} · ${products.length}',
                icon: Ic.shoppingBag,
                variant: SwButtonVariant.premium,
                onPressed: () => showSwSheet<void>(context, title: ref.s('looks.shopThisLook'), builder: (ctx) => Padding(padding: EdgeInsets.only(bottom: SwSpace.s6 + ctx.safe.bottom), child: ProductRail(items: products))),
              ),
          ]),
        ),
      ]),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.onTap});
  final Widget icon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: GestureDetector(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: SwSpace.s2),
          child: SizedBox(width: 56, child: Column(children: [icon, const SizedBox(height: 4), Text(label, style: context.type.caption.copyWith(color: SwColors.dark.ink), maxLines: 1, overflow: TextOverflow.ellipsis)])),
        ),
      ),
    );
  }
}
