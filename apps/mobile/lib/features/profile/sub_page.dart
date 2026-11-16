import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// Shared chrome for every Profile sub-page: back button + serif title, optional actions and a bottom bar.
class SubPage extends ConsumerWidget {
  const SubPage({super.key, required this.title, required this.body, this.actions, this.bottom});
  final String title;
  final Widget body;
  final List<Widget>? actions;
  final Widget? bottom;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: ref.s('common.back'), onPressed: () => context.canPop() ? context.pop() : context.go('/profile')),
        title: Text(title, style: context.type.displayS),
        actions: [...?actions, const SizedBox(width: SwSpace.s2)],
      ),
      body: body,
      bottomNavigationBar: bottom,
    );
  }
}

/// AsyncValue → layout-faithful skeleton / offline-or-server error with retry / empty state / content,
/// with pull-to-refresh that keeps the current content on screen (no skeleton flash).
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({super.key, required this.value, required this.skeleton, required this.onRefresh, required this.builder, this.isEmpty, this.empty, this.padding = const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s10)});
  final AsyncValue<T> value;
  final Widget skeleton;
  final Future<void> Function() onRefresh;
  final List<Widget> Function(BuildContext context, T data) builder;
  final bool Function(T data)? isEmpty;
  final Widget? empty;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    return value.when(
      skipLoadingOnRefresh: true,
      skipLoadingOnReload: true,
      loading: () => skeleton,
      error: (e, _) => _Refreshable(onRefresh: onRefresh, child: Center(child: LoadError(error: e, onRetry: () => unawaited(onRefresh())))),
      data: (d) {
        if (isEmpty?.call(d) == true && empty != null) return _Refreshable(onRefresh: onRefresh, child: Center(child: empty));
        return RefreshIndicator(
          color: context.sw.ink,
          onRefresh: onRefresh,
          child: ListView(physics: const AlwaysScrollableScrollPhysics(), padding: padding.copyWith(bottom: padding.bottom + context.bottomInset), children: builder(context, d)),
        );
      },
    );
  }
}

/// Pull-to-refresh around a non-scrolling state (empty / error), so it can be refreshed too.
class _Refreshable extends StatelessWidget {
  const _Refreshable({required this.onRefresh, required this.child});
  final Future<void> Function() onRefresh;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: context.sw.ink,
      onRefresh: onRefresh,
      child: LayoutBuilder(builder: (context, box) => SingleChildScrollView(physics: const AlwaysScrollableScrollPhysics(), child: ConstrainedBox(constraints: BoxConstraints(minHeight: box.maxHeight), child: child))),
    );
  }
}

/// A hairline-bordered card group of rows (same look as the Profile list).
class RowGroup extends StatelessWidget {
  const RowGroup({super.key, required this.children, this.margin = EdgeInsets.zero});
  final List<Widget> children;
  final EdgeInsets margin;
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      decoration: BoxDecoration(color: context.sw.surface, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: context.sw.hairline)),
      child: Column(children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const Hairline(indent: 56), children[i]],
      ]),
    );
  }
}

/// The one row style used on Profile and every sub-page: icon, label (+ optional subtitle), trailing, chevron.
class ProfileRow extends StatelessWidget {
  const ProfileRow({super.key, required this.icon, required this.label, this.onTap, this.subtitle, this.trailing, this.chevron = true, this.danger = false});
  final IconData icon;
  final String label;
  final String? subtitle;
  final FutureOr<void> Function()? onTap;
  final Widget? trailing;
  final bool chevron, danger;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final row = ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 56),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: SwSpace.s3),
        child: Row(children: [
          const SizedBox(width: SwSpace.s4),
          Icon(icon, size: 20, color: danger ? c.danger : c.ink),
          const SizedBox(width: SwSpace.s4),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(label, style: context.type.bodyM.copyWith(color: danger ? c.danger : c.ink)),
              if (subtitle != null) Text(subtitle!, style: context.type.caption.copyWith(color: c.muted), maxLines: 2, overflow: TextOverflow.ellipsis),
            ]),
          ),
          ?trailing,
          if (chevron && onTap != null) Padding(padding: const EdgeInsets.only(left: SwSpace.s2), child: Icon(Ic.chevronRight, size: 18, color: c.subtle)),
          const SizedBox(width: SwSpace.s4),
        ]),
      ),
    );
    if (onTap == null) return Semantics(label: label, child: row);
    return PressableLink(onTap: onTap, loaderOverlay: false, scale: false, semanticLabel: label, child: row);
  }
}

/// Skeleton of a [RowGroup] with [count] rows (icon, two lines).
class RowGroupSkeleton extends StatelessWidget {
  const RowGroupSkeleton({super.key, this.count = 4, this.padding = const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, 0)});
  final int count;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Padding(
      padding: padding,
      child: Container(
        decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: c.hairline)),
        child: Column(children: [
          for (var i = 0; i < count; i++) ...[
            if (i > 0) const Hairline(indent: 56),
            const SizedBox(
              height: 64,
              child: Row(children: [
                SizedBox(width: SwSpace.s4),
                SkeletonBox(width: 20, height: 20, radius: 6),
                SizedBox(width: SwSpace.s4),
                Expanded(child: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.start, children: [SkeletonLine(width: 140, height: 12), SizedBox(height: SwSpace.s2), SkeletonLine(width: 90, height: 10)])),
                SizedBox(width: SwSpace.s4),
              ]),
            ),
          ],
        ]),
      ),
    );
  }
}

/// Confirm dialog in the app's style; resolves true when confirmed.
Future<bool> confirmSw(BuildContext context, {required String title, String? body, required String confirm, String? cancel, bool danger = false}) async {
  final s = context.s;
  final ok = await showSwSheet<bool>(
    context,
    title: title,
    builder: (ctx) => Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.paddingOf(ctx).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (body != null) Padding(padding: const EdgeInsets.only(bottom: SwSpace.s5), child: Text(body, style: ctx.type.bodyM.copyWith(color: ctx.sw.muted))),
        SwButton(label: confirm, large: true, expand: true, variant: danger ? SwButtonVariant.danger : SwButtonVariant.primary, onPressed: () => Navigator.pop(ctx, true)),
        const SizedBox(height: SwSpace.s2),
        SwButton(label: cancel ?? s('common.cancel'), large: true, expand: true, variant: SwButtonVariant.ghost, onPressed: () => Navigator.pop(ctx, false)),
      ]),
    ),
  );
  return ok == true;
}

/// "Something failed" toast that says "offline" when it was the connection.
void toastError(BuildContext context, Object e) {
  if (!context.mounted) return;
  final s = context.s;
  showSwToast(context, e is ApiException ? (e.isNetwork ? s('common.offlineAction') : e.message) : s('common.error.body'), error: true);
}
