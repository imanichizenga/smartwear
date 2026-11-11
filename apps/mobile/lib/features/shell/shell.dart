import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// Five tabs in a floating, frosted bar with thin icons. Tabs keep their state (indexed stack).
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final bagCount = ref.watch(cartProvider).value?.integer('itemCount') ?? 0;
    final tabs = [
      (Ic.house, s('tab.home')),
      (Ic.compass, s('tab.discover')),
      (Ic.search, s('tab.search')),
      (Ic.shoppingBag, s('tab.bag')),
      (Ic.user, s('tab.profile')),
    ];
    final onDark = shell.currentIndex == 1; // Discover is full-bleed photography
    return Scaffold(
      extendBody: true,
      body: shell,
      bottomNavigationBar: SafeArea(
        minimum: const EdgeInsets.only(bottom: SwSpace.s3),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(SwRadius.full),
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(
                height: 64,
                decoration: BoxDecoration(
                  color: onDark ? Colors.black.withValues(alpha: 0.35) : context.sw.surface.withValues(alpha: 0.82),
                  borderRadius: BorderRadius.circular(SwRadius.full),
                  border: Border.all(color: onDark ? Colors.white.withValues(alpha: 0.12) : context.sw.hairline),
                ),
                child: Row(children: [
                  for (var i = 0; i < tabs.length; i++)
                    Expanded(
                      child: _Tab(
                        icon: tabs[i].$1,
                        label: tabs[i].$2,
                        selected: i == shell.currentIndex,
                        onDark: onDark,
                        badge: i == 3 ? bagCount : 0,
                        onTap: () {
                          HapticFeedback.selectionClick();
                          shell.goBranch(i, initialLocation: i == shell.currentIndex);
                        },
                      ),
                    ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Tab extends StatelessWidget {
  const _Tab({required this.icon, required this.label, required this.selected, required this.onTap, required this.onDark, this.badge = 0});
  final IconData icon;
  final String label;
  final bool selected, onDark;
  final int badge;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = onDark ? Colors.white : context.sw.ink;
    final dim = onDark ? Colors.white.withValues(alpha: 0.6) : context.sw.muted;
    return Semantics(
      selected: selected,
      button: true,
      label: badge > 0 ? '$label, $badge items' : label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          Stack(clipBehavior: Clip.none, children: [
            Icon(icon, size: 22, color: selected ? fg : dim),
            if (badge > 0)
              Positioned(
                right: -8,
                top: -4,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 16),
                  height: 16,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(color: context.sw.accent, borderRadius: BorderRadius.circular(8)),
                  child: Text('$badge', style: context.type.caption.copyWith(fontSize: 10, height: 1, color: context.sw.onAccent, fontWeight: FontWeight.w700)),
                ),
              ),
          ]),
          const SizedBox(height: 5),
          AnimatedContainer(duration: SwMotion.base, width: selected ? 4 : 0, height: 4, decoration: BoxDecoration(color: context.sw.accent, shape: BoxShape.circle)),
        ]),
      ),
    );
  }
}
