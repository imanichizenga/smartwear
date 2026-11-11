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
import '../shared/nav.dart';

/// Home is whatever the admin's Home Layout builder says, in order.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final home = ref.watch(homeProvider);
    return Scaffold(
      body: RefreshIndicator(
        color: context.sw.ink,
        backgroundColor: context.sw.surface,
        onRefresh: () => ref.refresh(homeProvider.future),
        child: CustomScrollView(
          slivers: [
            const _HomeHeader(),
            ...home.when(
              data: (h) => [for (final s in h.list('sections')) SliverToBoxAdapter(child: HomeSection(section: s))],
              loading: () => [const SliverToBoxAdapter(child: _HomeSkeleton())],
              error: (e, _) => [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: EmptyState(
                    title: ref.s('common.error.title'),
                    body: ref.s('common.error.body'),
                    action: SwButton(label: ref.s('common.retry'), variant: SwButtonVariant.secondary, onPressed: () => ref.refresh(homeProvider.future)),
                  ),
                ),
              ],
            ),
            SliverToBoxAdapter(child: SizedBox(height: 120 + context.safe.bottom)),
          ],
        ),
      ),
    );
  }
}

class _HomeHeader extends ConsumerWidget {
  const _HomeHeader();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SliverAppBar(
      pinned: true,
      toolbarHeight: 56,
      backgroundColor: context.sw.canvas.withValues(alpha: 0.94),
      centerTitle: true,
      title: Text('SMARTWEAR', style: context.type.titleS.copyWith(letterSpacing: 13 * 0.32, fontSize: 13, fontWeight: FontWeight.w700)),
      leading: SwIconButton(icon: Ic.search, semanticLabel: ref.s('common.search'), onPressed: () => context.go('/search')),
      actions: [
        SwIconButton(icon: Ic.bell, semanticLabel: ref.s('notifications.title'), onPressed: () => context.push('/notifications')),
        const SizedBox(width: SwSpace.s2),
      ],
    );
  }
}

class HomeSection extends ConsumerWidget {
  const HomeSection({super.key, required this.section});
  final Json section;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = section;
    final title = s.strN('title');
    return switch (s.str('type')) {
      'stories' => _Stories(items: s.list('items')),
      'hero' => _Hero(items: s.list('items'), autoAdvance: Duration(milliseconds: s.integer('autoAdvanceMs', 5500))),
      'new_in' || 'product_rail' || 'recently_viewed' => s.list('items').isEmpty
          ? const SizedBox.shrink()
          : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              SectionHeader(title ?? ref.s('home.newIn'), onViewAll: () => context.push('/c/all?title=${Uri.encodeComponent(title ?? '')}')),
              ProductRail(items: s.list('items')),
            ]),
      'collections' => _Collections(title: title ?? ref.s('home.collections'), items: s.list('items')),
      'drop_countdown' => s.obj('drop') == null ? const SizedBox.shrink() : _DropCountdown(drop: s.obj('drop')!),
      'category_tiles' => _CategoryTiles(title: title, items: s.list('items')),
      'for_you' => _ForYou(title: title ?? ref.s('home.forYou'), items: s.list('items')),
      'brand_spotlight' => s.obj('brand') == null ? const SizedBox.shrink() : _BrandSpotlight(brand: s.obj('brand')!, items: s.list('items'), title: title),
      'beauty_corner' => _BeautyCorner(title: title ?? ref.s('home.beautyCorner'), categories: s.list('categories'), items: s.list('items')),
      'looks_teaser' => _LooksTeaser(title: title, items: s.list('items')),
      'banner' => s.list('items').isEmpty ? const SizedBox.shrink() : _Hero(items: s.list('items').take(1).toList(), autoAdvance: Duration.zero),
      _ => const SizedBox.shrink(),
    };
  }
}

/* ------------------------------------------------------------------ stories */
class _Stories extends ConsumerWidget {
  const _Stories({required this.items});
  final List<Json> items;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const SizedBox.shrink();
    final c = context.sw;
    return SizedBox(
      height: 112,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s3, SwSpace.s5, 0),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s4),
        itemBuilder: (context, i) {
          final st = items[i];
          final seen = st.flag('seen');
          return PressableLink(
            semanticLabel: st.str('title'),
            loaderOverlay: false,
            onTap: () => openStory(context, items, i),
            child: SizedBox(
              width: 68,
              child: Column(children: [
                Container(
                  width: 68,
                  height: 68,
                  padding: const EdgeInsets.all(2.5),
                  decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: seen ? c.hairline : c.accent, width: 1.5)),
                  child: ClipOval(child: SwImage(st.obj('cover'), aspectRatio: 1, radius: 0)),
                ),
                const SizedBox(height: SwSpace.s2),
                Text(st.str('title'), style: context.type.caption.copyWith(color: c.ink), maxLines: 1, overflow: TextOverflow.ellipsis),
              ]),
            ),
          );
        },
      ),
    );
  }
}

/* ------------------------------------------------------------------ hero carousel */
class _Hero extends StatefulWidget {
  const _Hero({required this.items, required this.autoAdvance});
  final List<Json> items;
  final Duration autoAdvance;
  @override
  State<_Hero> createState() => _HeroState();
}

class _HeroState extends State<_Hero> {
  final _page = PageController(viewportFraction: 0.88);
  Timer? _timer;
  int _index = 0;

  @override
  void initState() {
    super.initState();
    if (widget.autoAdvance > Duration.zero && widget.items.length > 1) {
      _timer = Timer.periodic(widget.autoAdvance, (_) {
        if (!_page.hasClients || MediaQuery.of(context).disableAnimations) return;
        _page.animateToPage((_index + 1) % widget.items.length, duration: SwMotion.slow, curve: SwMotion.atelier);
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final h = (w * 0.88 - SwSpace.s3) * 5 / 4;
    return Padding(
      padding: const EdgeInsets.only(top: SwSpace.s6),
      child: Column(children: [
        SizedBox(
          height: h,
          child: PageView.builder(
            controller: _page,
            padEnds: false,
            onPageChanged: (i) => setState(() => _index = i),
            itemCount: widget.items.length,
            itemBuilder: (context, i) {
              final b = widget.items[i];
              return Padding(
                padding: EdgeInsets.only(left: i == 0 ? SwSpace.s5 : SwSpace.s3 / 2, right: SwSpace.s3 / 2),
                child: PressableLink(
                  semanticLabel: b.str('title'),
                  onTap: () => openLink(context, b.obj('link'), title: b.str('title')),
                  child: AnimatedBuilder(
                    animation: _page,
                    builder: (context, child) {
                      final offset = _page.hasClients && _page.position.haveDimensions ? (_page.page ?? 0) - i : 0.0;
                      return _HeroCard(banner: b, parallax: context.reduceMotion ? 0 : offset.clamp(-1.0, 1.0));
                    },
                  ),
                ),
              );
            },
          ),
        ),
        if (widget.items.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: SwSpace.s4),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              for (var i = 0; i < widget.items.length; i++)
                AnimatedContainer(
                  duration: SwMotion.base,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _index ? 18 : 5,
                  height: 2,
                  color: i == _index ? context.sw.ink : context.sw.hairline,
                ),
            ]),
          ),
      ]),
    );
  }
}

/// Editorial banner: the photograph stays clean; the type sits on a soft scrim at the foot.
class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.banner, required this.parallax});
  final Json banner;
  final double parallax;
  @override
  Widget build(BuildContext context) {
    const on = SwColors.dark;
    return ClipRRect(
      borderRadius: BorderRadius.circular(SwRadius.xs),
      child: Stack(fit: StackFit.expand, children: [
        Transform.translate(offset: Offset(parallax * -36, 0), child: Transform.scale(scale: 1.12, child: SwImage(banner.obj('media'), aspectRatio: null, radius: 0))),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, stops: const [0.45, 1], colors: [on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0.72)]),
          ),
        ),
        Positioned(
          left: SwSpace.s5,
          right: SwSpace.s5,
          bottom: SwSpace.s6,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (banner.strN('eyebrow') != null) Text(caps(banner.str('eyebrow')), style: context.type.label.copyWith(color: on.accent)),
            const SizedBox(height: SwSpace.s2),
            Text(banner.str('title'), style: context.type.displayL.copyWith(color: on.ink)),
            if (banner.strN('subtitle') != null) Padding(padding: const EdgeInsets.only(top: SwSpace.s2), child: Text(banner.str('subtitle'), style: context.type.bodyS.copyWith(color: on.ink.withValues(alpha: 0.82)))),
            if (banner.strN('ctaLabel') != null)
              Padding(
                padding: const EdgeInsets.only(top: SwSpace.s4),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(caps(banner.str('ctaLabel')), style: context.type.label.copyWith(color: on.ink)),
                  const SizedBox(width: SwSpace.s2),
                  Icon(Ic.arrowRight, size: 16, color: on.ink),
                ]),
              ),
          ]),
        ),
      ]),
    );
  }
}

/* ------------------------------------------------------------------ rails & grids */
class ProductRail extends ConsumerWidget {
  const ProductRail({super.key, required this.items, this.cardWidth = 156});
  final List<Json> items;
  final double cardWidth;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wish = ref.watch(wishlistProvider).value ?? const <String>{};
    return SizedBox(
      height: productCardExtent(context, cardWidth),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s4),
        itemBuilder: (context, i) => ProductCard(
          product: items[i],
          width: cardWidth,
          wishlisted: wish.contains(items[i].str('id')),
          onTap: () => openProduct(context, ref, items[i]),
          onWishlist: () => toggleWishlist(context, ref, items[i].str('id')),
        ),
      ),
    );
  }
}

class ProductGrid extends ConsumerWidget {
  const ProductGrid({super.key, required this.items, this.padding = const EdgeInsets.symmetric(horizontal: SwSpace.s5)});
  final List<Json> items;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wish = ref.watch(wishlistProvider).value ?? const <String>{};
    return Padding(
      padding: padding,
      child: LayoutBuilder(builder: (context, box) {
        final w = (box.maxWidth - SwSpace.s4) / 2;
        return Wrap(spacing: SwSpace.s4, runSpacing: SwSpace.s8, children: [
          for (final p in items)
            ProductCard(product: p, width: w, wishlisted: wish.contains(p.str('id')), onTap: () => openProduct(context, ref, p), onWishlist: () => toggleWishlist(context, ref, p.str('id'))),
        ]);
      }),
    );
  }
}

class _ForYou extends StatelessWidget {
  const _ForYou({required this.title, required this.items});
  final String title;
  final List<Json> items;
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [SectionHeader(title), ProductGrid(items: items.take(8).toList())]);
  }
}

/* ------------------------------------------------------------------ collections */
class _Collections extends StatelessWidget {
  const _Collections({required this.title, required this.items});
  final String title;
  final List<Json> items;
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader(title),
      SizedBox(
        height: 240 * 5 / 4 + 112 * MediaQuery.textScalerOf(context).scale(1),
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s4),
          itemBuilder: (context, i) {
            final c = items[i];
            return SizedBox(
              width: 240,
              child: PressableLink(
                semanticLabel: c.str('title'),
                onTap: () => context.push('/collection/${c.str('slug')}?title=${Uri.encodeComponent(c.str('title'))}'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SwImage(c.obj('cover')),
                  const SizedBox(height: SwSpace.s3),
                  Text(c.str('title'), style: context.type.displayS),
                  const SizedBox(height: SwSpace.s1),
                  Text(c.str('subtitle'), style: context.type.bodyS.copyWith(color: context.sw.muted), maxLines: 2, overflow: TextOverflow.ellipsis),
                ]),
              ),
            );
          },
        ),
      ),
    ]);
  }
}

/* ------------------------------------------------------------------ drop countdown (real data only) */
class _DropCountdown extends ConsumerStatefulWidget {
  const _DropCountdown({required this.drop});
  final Json drop;
  @override
  ConsumerState<_DropCountdown> createState() => _DropCountdownState();
}

class _DropCountdownState extends ConsumerState<_DropCountdown> {
  Timer? _t;
  late bool _subscribed = widget.drop.flag('subscribed');

  @override
  void initState() {
    super.initState();
    _t = Timer.periodic(const Duration(seconds: 1), (_) => setState(() {}));
  }

  @override
  void dispose() {
    _t?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final launches = DateTime.tryParse(widget.drop.str('launchesAt'));
    if (launches == null) return const SizedBox.shrink();
    final left = launches.difference(DateTime.now());
    if (left.isNegative) return const SizedBox.shrink();
    const on = SwColors.dark;
    final parts = [(left.inDays, 'D'), (left.inHours % 24, 'H'), (left.inMinutes % 60, 'M'), (left.inSeconds % 60, 'S')];
    return Padding(
      padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s10, SwSpace.s5, 0),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(SwRadius.md),
        child: ColoredBox(
          color: on.canvas,
          child: SizedBox(height: 232, child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(width: 128, child: SwImage(widget.drop.obj('cover'), aspectRatio: null, radius: 0)),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(SwSpace.s5),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(caps(ref.s('home.dropIn')), style: context.type.labelS.copyWith(color: on.accent)),
                  const SizedBox(height: SwSpace.s2),
                  Text(widget.drop.str('title'), style: context.type.displayS.copyWith(color: on.ink)),
                  const SizedBox(height: SwSpace.s4),
                  Row(children: [
                    for (final (v, u) in parts) ...[
                      Text(v.toString().padLeft(2, '0'), style: context.type.priceM.copyWith(color: on.ink, fontFeatures: const [FontFeature.tabularFigures()])),
                      Padding(padding: const EdgeInsets.only(left: 2, right: SwSpace.s3, top: 4), child: Text(u, style: context.type.caption.copyWith(color: on.muted))),
                    ],
                  ]),
                  const SizedBox(height: SwSpace.s4),
                  SwButton(
                    label: _subscribed ? ref.s('home.notifyOn') : ref.s('home.notifyMe'),
                    icon: _subscribed ? Ic.bookmarkCheck : Ic.bell,
                    variant: SwButtonVariant.premium,
                    onPressed: _subscribed
                        ? null
                        : () => requireSignIn(context, ref, () async {
                              await ref.read(apiProvider).post<Json>('/collections/${widget.drop.str('id')}/notify');
                              HapticFeedback.lightImpact();
                              setState(() => _subscribed = true);
                            }),
                  ),
                ]),
              ),
            ),
          ])),
        ),
      ),
    );
  }
}

/* ------------------------------------------------------------------ categories */
class _CategoryTiles extends ConsumerWidget {
  const _CategoryTiles({required this.title, required this.items});
  final String? title;
  final List<Json> items;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader(title ?? ref.s('home.collections')),
      SizedBox(
        height: 132,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s3),
          itemBuilder: (context, i) => CategoryTile(category: items[i]),
        ),
      ),
    ]);
  }
}

/// Category tile: the category photo when the admin set one, otherwise its thin icon on blush.
class CategoryTile extends StatelessWidget {
  const CategoryTile({super.key, required this.category, this.size = 96});
  final Json category;
  final double size;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return SizedBox(
      width: size,
      child: PressableLink(
        semanticLabel: category.str('name'),
        onTap: () => context.push('/c/${category.str('slug')}?title=${Uri.encodeComponent(category.str('name'))}'),
        child: Column(children: [
          SizedBox.square(
            dimension: size,
            child: category.obj('image') != null
                ? SwImage(category.obj('image'), aspectRatio: 1, radius: SwRadius.md)
                : DecoratedBox(
                    decoration: BoxDecoration(color: c.blush, borderRadius: BorderRadius.circular(SwRadius.md)),
                    child: Center(child: Icon(categoryIconData(category.strN('icon')), size: 28, color: c.ink)),
                  ),
          ),
          const SizedBox(height: SwSpace.s2),
          Text(category.str('name'), style: context.type.caption.copyWith(color: c.ink, fontWeight: FontWeight.w600), textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      ),
    );
  }
}

/* ------------------------------------------------------------------ brand spotlight */
class _BrandSpotlight extends StatelessWidget {
  const _BrandSpotlight({required this.brand, required this.items, this.title});
  final Json brand;
  final List<Json> items;
  final String? title;
  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader(title ?? brand.str('name')),
      Padding(padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5), child: SwImage(brand.obj('cover'), aspectRatio: 16 / 10)),
      Padding(
        padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s5),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(brand.str('name'), style: context.type.displayS),
          const SizedBox(height: SwSpace.s2),
          Text(brand.str('story'), style: context.type.bodyS.copyWith(color: context.sw.muted), maxLines: 3, overflow: TextOverflow.ellipsis),
        ]),
      ),
      if (items.isNotEmpty) ProductRail(items: items, cardWidth: 140),
    ]);
  }
}

/* ------------------------------------------------------------------ beauty corner */
class _BeautyCorner extends StatelessWidget {
  const _BeautyCorner({required this.title, required this.categories, required this.items});
  final String title;
  final List<Json> categories, items;
  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: SwSpace.s10),
      color: context.sw.blush,
      padding: const EdgeInsets.only(bottom: SwSpace.s8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SectionHeader(title, padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s8, SwSpace.s5, SwSpace.s4)),
        if (categories.isNotEmpty)
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
              itemCount: categories.length,
              separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s2),
              itemBuilder: (context, i) {
                final c = categories[i];
                return ChoiceChipSw(
                  label: c.str('name'),
                  selected: false,
                  leading: Icon(categoryIconData(c.strN('icon')), size: 16, color: context.sw.ink),
                  onTap: () => context.push('/c/${c.str('slug')}?title=${Uri.encodeComponent(c.str('name'))}'),
                );
              },
            ),
          ),
        const SizedBox(height: SwSpace.s5),
        ProductRail(items: items),
      ]),
    );
  }
}

/* ------------------------------------------------------------------ looks teaser */
class _LooksTeaser extends ConsumerWidget {
  const _LooksTeaser({required this.items, this.title});
  final List<Json> items;
  final String? title;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader(title ?? ref.s('looks.shopThisLook'), onViewAll: () => context.go('/discover')),
      SizedBox(
        height: 260,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(width: SwSpace.s3),
          itemBuilder: (context, i) => SizedBox(
            width: 146,
            child: PressableLink(
              semanticLabel: items[i].str('caption'),
              onTap: () => context.go('/discover?look=${items[i].str('id')}'),
              child: Stack(children: [
                SwImage(items[i].obj('media'), aspectRatio: 9 / 16),
                Positioned(left: SwSpace.s3, bottom: SwSpace.s3, child: Icon(Ic.play, size: 16, color: SwColors.dark.ink)),
              ]),
            ),
          ),
        ),
      ),
    ]);
  }
}

/* ------------------------------------------------------------------ skeleton */
class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(SwSpace.s5),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(height: 60, child: ClipRect(child: OverflowBox(alignment: Alignment.centerLeft, maxWidth: double.infinity, child: Row(children: [for (var i = 0; i < 6; i++) const Padding(padding: EdgeInsets.only(right: SwSpace.s4), child: Skeleton(width: 60, height: 60, radius: 30))])))),
        const SizedBox(height: SwSpace.s6),
        const Skeleton(aspectRatio: 4 / 5),
        const SizedBox(height: SwSpace.s8),
        const Skeleton(width: 160, height: 24),
        const SizedBox(height: SwSpace.s4),
        Row(children: const [Expanded(child: Skeleton(aspectRatio: 4 / 5)), SizedBox(width: SwSpace.s4), Expanded(child: Skeleton(aspectRatio: 4 / 5))]),
      ]),
    );
  }
}
