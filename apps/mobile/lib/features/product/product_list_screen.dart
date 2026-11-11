import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../shared/nav.dart';

/// 2-column 4:5 grid with infinite scroll; used for categories, collections, brands and search.
class ProductListScreen extends ConsumerWidget {
  const ProductListScreen({super.key, this.category, this.collection, this.title});
  final String? category, collection, title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final q = ProductQuery(category: category == 'all' ? null : category, collection: collection);
    return Scaffold(
      appBar: AppBar(
        leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: ref.s('common.back'), onPressed: () => context.pop()),
        title: Text(title?.isNotEmpty == true ? title! : ref.s('home.newIn'), style: context.type.displayS),
      ),
      body: ProductGridView(query: q),
    );
  }
}

class ProductGridView extends ConsumerWidget {
  const ProductGridView({super.key, required this.query, this.header});
  final ProductQuery query;
  final Widget? header;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final page = ref.watch(productListProvider(query));
    final wish = ref.watch(wishlistProvider).value ?? const <String>{};
    return page.when(
      loading: () => CustomScrollView(slivers: [if (header != null) SliverToBoxAdapter(child: header), const SliverToBoxAdapter(child: GridSkeleton())]),
      error: (e, _) => EmptyState(title: ref.s('common.error.title'), body: e is ApiException ? e.message : null, action: SwButton(label: ref.s('common.retry'), onPressed: () => ref.refresh(productListProvider(query).future))),
      data: (pg) => NotificationListener<ScrollNotification>(
        onNotification: (n) {
          if (n.metrics.extentAfter < 600) ref.read(productListProvider(query).notifier).loadMore();
          return false;
        },
        child: CustomScrollView(slivers: [
          if (header != null) SliverToBoxAdapter(child: header),
          if (pg.items.isEmpty)
            SliverFillRemaining(hasScrollBody: false, child: EmptyState(title: ref.s('search.noResults.title'), body: ref.s('search.noResults.body'), icon: Ic.search))
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, 0),
              sliver: SliverGrid.builder(
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 2,
                  mainAxisSpacing: SwSpace.s6,
                  crossAxisSpacing: SwSpace.s4,
                  mainAxisExtent: productCardExtent(context, (MediaQuery.sizeOf(context).width - SwSpace.s5 * 2 - SwSpace.s4) / 2),
                ),
                itemCount: pg.items.length,
                itemBuilder: (context, i) => ProductCard(
                  product: pg.items[i],
                  hero: true,
                  wishlisted: wish.contains(pg.items[i].str('id')),
                  onTap: () => openProduct(context, ref, pg.items[i]),
                  onWishlist: () => toggleWishlist(context, ref, pg.items[i].str('id')),
                ),
              ),
            ),
          SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.fromLTRB(0, SwSpace.s8, 0, 120 + context.safe.bottom),
              child: Center(child: pg.loadingMore ? const ALoader(size: ALoaderSize.lg) : const SizedBox.shrink()),
            ),
          ),
        ]),
      ),
    );
  }
}

class GridSkeleton extends StatelessWidget {
  const GridSkeleton({super.key});
  @override
  Widget build(BuildContext context) {
    Widget card() => const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Skeleton(aspectRatio: 4 / 5), SizedBox(height: SwSpace.s3), Skeleton(width: 60, height: 10), SizedBox(height: SwSpace.s2), Skeleton(width: 120, height: 12), SizedBox(height: SwSpace.s2), Skeleton(width: 70, height: 14)]);
    return Padding(
      padding: const EdgeInsets.all(SwSpace.s5),
      child: Column(children: [
        for (var r = 0; r < 2; r++) ...[
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: card()), const SizedBox(width: SwSpace.s4), Expanded(child: card())]),
          const SizedBox(height: SwSpace.s8),
        ],
      ]),
    );
  }
}
