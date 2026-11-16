import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../../ui/motion.dart';
import '../product/product_list_screen.dart';
import '../shared/nav.dart';
import 'profile_data.dart';
import 'sub_page.dart';

/// Wishlist: saved pieces as product cards. Tapping the heart removes with an Undo toast.
class WishlistScreen extends ConsumerStatefulWidget {
  const WishlistScreen({super.key});
  @override
  ConsumerState<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends ConsumerState<WishlistScreen> {
  /// Hidden right away on remove, so the grid reacts instantly; restored on Undo or failure.
  final _hidden = <String>{};

  Future<void> _remove(Json p) async {
    final id = p.str('id');
    HapticFeedback.selectionClick();
    setState(() => _hidden.add(id));
    final notifier = ref.read(wishlistProvider.notifier);
    try {
      if (ref.read(wishlistProvider).value?.contains(id) ?? true) await notifier.toggle(id);
      if (!mounted) return;
      showSwToast(context, ref.s('wishlist.removed'), icon: Ic.heart, actionLabel: ref.s('common.undo'), onAction: () async {
        if (mounted) setState(() => _hidden.remove(id));
        try {
          await notifier.toggle(id);
        } on ApiException {
          if (mounted) setState(() => _hidden.add(id));
        }
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _hidden.remove(id));
      toastError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final products = ref.watch(wishlistProductsProvider);
    final saved = ref.watch(wishlistProvider).value;
    final width = (MediaQuery.sizeOf(context).width - SwSpace.s5 * 2 - SwSpace.s4) / 2;
    return SubPage(
      title: s('profile.wishlist'),
      body: products.when(
        skipLoadingOnRefresh: true,
        skipLoadingOnReload: true,
        loading: () => const SingleChildScrollView(physics: NeverScrollableScrollPhysics(), child: GridSkeleton()),
        error: (e, _) => Center(child: LoadError(error: e, onRetry: () => ref.invalidate(wishlistProductsProvider))),
        data: (all) {
          // Hide anything removed here or elsewhere (e.g. from a product page) since this list loaded.
          final items = [for (final p in all) if (!_hidden.contains(p.str('id')) && (saved == null || saved.contains(p.str('id')))) p];
          return RefreshIndicator(
            color: context.sw.ink,
            onRefresh: () async {
              setState(_hidden.clear);
              ref.invalidate(wishlistProvider);
              await ref.refresh(wishlistProductsProvider.future);
            },
            child: items.isEmpty
                ? LayoutBuilder(
                    builder: (context, box) => SingleChildScrollView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      child: ConstrainedBox(
                        constraints: BoxConstraints(minHeight: box.maxHeight),
                        child: Center(
                          child: EmptyState(
                            title: s('wishlist.empty.title'),
                            body: s('wishlist.empty.body'),
                            icon: Ic.heart,
                            action: SwButton(label: s('wishlist.empty.cta'), icon: Ic.compass, onPressed: () => context.go('/discover')),
                          ),
                        ),
                      ),
                    ),
                  )
                : GridView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s10 + context.bottomInset),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, mainAxisSpacing: SwSpace.s6, crossAxisSpacing: SwSpace.s4, mainAxisExtent: productCardExtent(context, width)),
                    itemCount: items.length,
                    itemBuilder: (context, i) => Reveal(
                      key: ValueKey(items[i].str('id')),
                      index: i < 6 ? i : i % 2,
                      child: ProductCard(product: items[i], wishlisted: true, onTap: () => openProduct(context, ref, items[i]), onWishlist: () => _remove(items[i])),
                    ),
                  ),
          );
        },
      ),
    );
  }
}
