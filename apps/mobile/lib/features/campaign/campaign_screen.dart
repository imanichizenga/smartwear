import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../home/home_screen.dart' show ProductGrid;
import '../product/product_list_screen.dart' show GridSkeleton;

final campaignProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) => ref.read(apiProvider).get<Json>('/campaigns/$id'));

/// Where a push featuring several products lands: the picture, the message and the products.
class CampaignScreen extends ConsumerWidget {
  const CampaignScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final q = ref.watch(campaignProvider(id));
    return Scaffold(
      appBar: AppBar(leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.canPop() ? context.pop() : context.go('/'))),
      body: q.when(
        skipLoadingOnRefresh: true,
        loading: () => const SingleChildScrollView(physics: NeverScrollableScrollPhysics(), child: GridSkeleton()),
        error: (e, _) => Center(child: LoadError(error: e, onRetry: () => ref.invalidate(campaignProvider(id)))),
        data: (d) => RefreshIndicator(
          color: c.ink,
          onRefresh: () => ref.refresh(campaignProvider(id).future),
          child: ListView(padding: EdgeInsets.only(bottom: SwSpace.s10 + context.bottomInset), children: [
            if (d.obj('image') != null)
              Padding(padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5), child: SwImage(d.obj('image'), aspectRatio: 16 / 10)),
            Reveal(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, SwSpace.s2),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(d.str('title'), style: context.type.displayL),
                  const SizedBox(height: SwSpace.s2),
                  Text(d.str('body'), style: context.type.bodyM.copyWith(color: c.muted)),
                ]),
              ),
            ),
            if (d.list('products').isEmpty)
              EmptyState(title: s('search.noResults.title'), body: s('search.noResults.body'), icon: Ic.shoppingBag)
            else ...[
              const SizedBox(height: SwSpace.s4),
              ProductGrid(items: d.list('products')),
            ],
          ]),
        ),
      ),
    );
  }
}
