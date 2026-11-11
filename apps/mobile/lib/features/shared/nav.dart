import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// Card tap → prefetch the product (≤350ms, while the card shows the A loader) → open it.
/// The product page renders instantly when the prefetch won; otherwise it shows its skeleton.
Future<void> openProduct(BuildContext context, WidgetRef ref, Json product) async {
  final slug = product.str('slug');
  final prefetch = ref.read(productProvider(slug).future).then<void>((_) {}, onError: (_) {});
  await Future.any([prefetch, Future<void>.delayed(const Duration(milliseconds: 350))]);
  if (context.mounted) await context.push('/p/$slug');
}

/// Wishlist needs an account; guests are sent to sign in and come back.
Future<void> toggleWishlist(BuildContext context, WidgetRef ref, String productId) async {
  await requireSignIn(context, ref, () async {
    final was = ref.read(wishlistProvider).value?.contains(productId) ?? false;
    try {
      await ref.read(wishlistProvider.notifier).toggle(productId);
      if (context.mounted && !was) showSwToast(context, ref.s('wishlist.added'), icon: Ic.heart);
    } on ApiException catch (e) {
      if (context.mounted) showSwToast(context, e.message, error: true);
    }
  });
}

Future<void> requireSignIn(BuildContext context, WidgetRef ref, FutureOr<void> Function() action) async {
  if (ref.read(sessionProvider).signedIn) return action();
  HapticFeedback.selectionClick();
  await context.push('/welcome?return=1');
  if (ref.read(sessionProvider).signedIn) await action();
}

/// Banner / story link → destination.
Future<void> openLink(BuildContext context, Json? link, {String? title}) async {
  if (link == null) return;
  final t = Uri.encodeComponent(title ?? '');
  switch (link.str('type')) {
    case 'collection':
      await context.push('/collection/${link.str('slug', link.str('id'))}?title=$t');
    case 'category':
      await context.push('/c/${link.str('slug', link.str('id'))}?title=$t');
    case 'product':
      await context.push('/p/${link.str('slug', link.str('id'))}');
    case 'brand':
      await context.push('/c/all?brand=${link.str('slug', link.str('id'))}&title=$t');
    case 'look':
      context.go('/discover?look=${link.str('id')}');
  }
}

/// Category icon names come from the controlled set in catalog.taxonomy.CATEGORY_ICONS.
IconData categoryIconData(String? name) => switch (name) {
      'shirt' => Ic.shirt,
      'baby' => Ic.baby,
      'footprints' => Ic.footprints,
      'shopping-bag' => Ic.shoppingBag,
      'glasses' => Ic.glasses,
      'gem' => Ic.gem,
      'sparkles' => Ic.sparkles,
      'palette' => Ic.palette,
      'activity' => Ic.activity,
      'moon' => Ic.moon,
      'heart' => Ic.heart,
      'moon-star' => Ic.moonStar,
      'heart-handshake' => Ic.heartHandshake,
      'scissors' => Ic.scissors,
      'watch' => Ic.watch,
      'crown' => Ic.crown,
      'droplet' => Ic.droplet,
      'flower' => Ic.flower,
      'flower-2' => Ic.flower2,
      'wind' => Ic.wind,
      'sun' => Ic.sun,
      'brush' => Ic.brush,
      'spray-can' => Ic.sprayCan,
      'package' => Ic.package,
      'tag' => Ic.tag,
      'star' => Ic.star,
      'leaf' => Ic.leaf,
      'snowflake' => Ic.snowflake,
      'umbrella' => Ic.umbrella,
      'briefcase' => Ic.briefcase,
      'backpack' => Ic.backpack,
      'wallet' => Ic.wallet,
      'ribbon' => Ic.ribbon,
      _ => Ic.tag,
    };

/// Full-screen stories: tap right/left to move, hold to pause, swipe down to close.
Future<void> openStory(BuildContext context, List<Json> stories, int index) {
  return Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
    opaque: false,
    barrierColor: SwColors.dark.canvas,
    pageBuilder: (_, _, _) => _StoryViewer(stories: stories, start: index),
    transitionsBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: ScaleTransition(scale: Tween(begin: 0.96, end: 1.0).animate(a), child: child)),
  ));
}

class _StoryViewer extends ConsumerStatefulWidget {
  const _StoryViewer({required this.stories, required this.start});
  final List<Json> stories;
  final int start;
  @override
  ConsumerState<_StoryViewer> createState() => _StoryViewerState();
}

class _StoryViewerState extends ConsumerState<_StoryViewer> with SingleTickerProviderStateMixin {
  late int _story = widget.start;
  int _item = 0;
  late final AnimationController _progress = AnimationController(vsync: this)..addStatusListener((s) {
      if (s == AnimationStatus.completed) _next();
    });

  List<Json> get _items => widget.stories[_story].list('items');

  @override
  void initState() {
    super.initState();
    _play();
  }

  void _play() {
    final items = _items;
    if (items.isEmpty) return _close();
    _progress.duration = Duration(milliseconds: items[_item].integer('durationMs', 5000));
    _progress.forward(from: 0);
    ref.read(apiProvider).post<Json>('/stories/${widget.stories[_story].str('id')}/seen').ignore();
  }

  void _next() {
    if (_item + 1 < _items.length) {
      setState(() => _item++);
    } else if (_story + 1 < widget.stories.length) {
      setState(() {
        _story++;
        _item = 0;
      });
    } else {
      return _close();
    }
    _play();
  }

  void _prev() {
    if (_item > 0) {
      setState(() => _item--);
    } else if (_story > 0) {
      setState(() {
        _story--;
        _item = 0;
      });
    }
    _play();
  }

  void _close() {
    if (mounted) Navigator.of(context).maybePop();
  }

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const on = SwColors.dark;
    final st = widget.stories[_story];
    final item = _items.isEmpty ? const <String, dynamic>{} : _items[_item];
    return Scaffold(
      backgroundColor: on.canvas,
      body: GestureDetector(
        onTapUp: (d) => d.localPosition.dx > MediaQuery.sizeOf(context).width / 3 ? _next() : _prev(),
        onLongPressStart: (_) => _progress.stop(),
        onLongPressEnd: (_) => _progress.forward(),
        onVerticalDragEnd: (d) => (d.primaryVelocity ?? 0) > 200 ? _close() : null,
        child: Stack(fit: StackFit.expand, children: [
          SwImage(item.obj('media'), aspectRatio: null, radius: 0),
          DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [on.canvas.withValues(alpha: 0.5), on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0.7)], stops: const [0, 0.2, 0.6, 1]))),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(SwSpace.s4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  for (var i = 0; i < _items.length; i++)
                    Expanded(
                      child: Container(
                        height: 2,
                        margin: const EdgeInsets.symmetric(horizontal: 2),
                        color: on.ink.withValues(alpha: 0.3),
                        alignment: Alignment.centerLeft,
                        child: AnimatedBuilder(
                          animation: _progress,
                          builder: (_, _) => FractionallySizedBox(widthFactor: i < _item ? 1 : i == _item ? _progress.value : 0, child: Container(color: on.ink)),
                        ),
                      ),
                    ),
                ]),
                const SizedBox(height: SwSpace.s4),
                Row(children: [
                  Text(caps(st.str('title')), style: context.type.label.copyWith(color: on.ink)),
                  const Spacer(),
                  SwIconButton(icon: Ic.x, color: on.ink, semanticLabel: ref.s('common.close'), onPressed: _close),
                ]),
                const Spacer(),
                if (item.strN('caption') != null) Text(item.str('caption'), style: context.type.displayM.copyWith(color: on.ink)),
                if (item.obj('link') != null) ...[
                  const SizedBox(height: SwSpace.s5),
                  SwButton(
                    label: ref.s('common.seeMore'),
                    icon: Ic.arrowRight,
                    variant: SwButtonVariant.premium,
                    onPressed: () async {
                      _progress.stop();
                      final link = item.obj('link');
                      Navigator.of(context).pop();
                      final root = GoRouter.of(context);
                      if (link?.str('type') == 'collection') await root.push('/collection/${link!.str('slug', link.str('id'))}');
                    },
                  ),
                ],
                const SizedBox(height: SwSpace.s4),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
