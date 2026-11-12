import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../../ui/motion.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final session = ref.watch(sessionProvider);
    final u = session.user;
    final c = context.sw;
    return Scaffold(
      body: ListView(padding: EdgeInsets.only(bottom: 120 + context.safe.bottom), children: [
        _Header(user: u),
        if (u != null) const _Loyalty(),
        if (u == null)
          Padding(
            padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, 0),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s('profile.signInCta'), style: context.type.bodyM.copyWith(color: c.muted)),
              const SizedBox(height: SwSpace.s4),
              SwButton(label: s('auth.loginRequired'), icon: Ic.user, expand: true, large: true, onPressed: () => context.push('/welcome?return=1')),
            ]),
          ),
        const SizedBox(height: SwSpace.s6),
        if (u != null) ...[
          Reveal(index: 1, child: _Group(children: [
            _Row(icon: Ic.receipt, label: s('profile.orders'), onTap: () => context.push('/orders')),
            _Row(icon: Ic.heart, label: s('profile.wishlist'), onTap: () => context.push('/wishlist')),
            _Row(icon: Ic.shirt, label: s('profile.styleProfile'), onTap: () => context.push('/auth/quiz')),
            _Row(icon: Ic.mapPin, label: s('profile.savedPlaces'), onTap: () => context.push('/places')),
            _Row(icon: Ic.wallet, label: s('profile.payments'), onTap: () => context.push('/payments')),
            _Row(icon: Ic.briefcase, label: s('profile.wholesale'), trailing: _wholesale(ref, u), onTap: () => context.push('/wholesale')),
          ])),
          const SizedBox(height: SwSpace.s6),
        ],
        Reveal(index: 2, child: _Group(children: [
          _Row(icon: Ic.bell, label: s('profile.notifications'), onTap: () => context.push('/notifications')),
          _Row(icon: Ic.globe, label: s('profile.language'), trailing: Text(ref.watch(localeProvider) == 'sw' ? 'Kiswahili' : 'English', style: context.type.bodyS.copyWith(color: c.muted)), onTap: () => _language(context, ref)),
          _Row(icon: Ic.sunMoon, label: s('profile.theme'), trailing: Text(s('profile.theme.${ref.watch(themeModeProvider).name}'), style: context.type.bodyS.copyWith(color: c.muted)), onTap: () => _theme(context, ref)),
          _Row(icon: Ic.messageCircle, label: s('profile.help'), onTap: () => context.push('/support')),
          if (u != null) _Row(icon: Ic.shield, label: s('profile.privacy'), onTap: () => context.push('/privacy')),
          if (session.isRider) _Row(icon: Ic.bike, label: s('profile.riderMode'), onTap: () => context.go('/rider')),
        ])),
        if (u != null) ...[
          const SizedBox(height: SwSpace.s6),
          _Group(children: [_Row(icon: Ic.logOut, label: s('auth.signOut'), onTap: () => ref.read(sessionProvider.notifier).signOut(), chevron: false)]),
        ],
        Padding(padding: const EdgeInsets.all(SwSpace.s8), child: Center(child: Text(s('profile.version', {'version': appVersion}), style: context.type.caption.copyWith(color: c.subtle)))),
      ]),
    );
  }

  Widget? _wholesale(WidgetRef ref, Json u) {
    if (u.flag('wholesaleApproved')) return SwChip(ref.s('product.wholesale'), tone: ChipTone.accent);
    return null;
  }

  void _language(BuildContext context, WidgetRef ref) {
    showSwSheet<void>(context, title: ref.s('profile.language'), builder: (ctx) => _Choices(options: const [('en', 'English'), ('sw', 'Kiswahili')], selected: ref.read(localeProvider), onSelect: (v) {
          ref.read(localeProvider.notifier).set(v);
          ref.read(apiProvider).patch<Json>('/me', {'locale': v}).ignore();
        }));
  }

  void _theme(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    showSwSheet<void>(context, title: s('profile.theme'), builder: (ctx) => _Choices(
          options: [('system', s('profile.theme.system')), ('light', s('profile.theme.light')), ('dark', s('profile.theme.dark'))],
          selected: ref.read(themeModeProvider).name,
          onSelect: (v) => ref.read(themeModeProvider.notifier).set(ThemeMode.values.byName(v)),
        ));
  }
}

class _Choices extends StatelessWidget {
  const _Choices({required this.options, required this.selected, required this.onSelect});
  final List<(String, String)> options;
  final String selected;
  final ValueChanged<String> onSelect;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s6 + context.safe.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        for (final (k, label) in options)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () {
              onSelect(k);
              Navigator.pop(context);
            },
            child: SizedBox(height: 52, child: Row(children: [Expanded(child: Text(label, style: context.type.bodyM)), if (k == selected) Icon(Ic.check, size: 18, color: context.sw.ink)])),
          ),
      ]),
    );
  }
}

class _Header extends ConsumerWidget {
  const _Header({required this.user});
  final Json? user;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    final name = user?.str('displayName', user?.str('name') ?? '') ?? '';
    final initials = name.trim().isEmpty ? 'SW' : name.trim().split(RegExp(r'\s+')).map((p) => p[0]).take(2).join().toUpperCase();
    return SizedBox(
      height: 196 + context.safe.top,
      child: Stack(children: [
        Positioned.fill(
          bottom: 56,
          child: user?.obj('cover') != null
              ? SwImage(user!.obj('cover'), aspectRatio: null, radius: 0)
              : DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [c.blush, c.accentSoft]))),
        ),
        Positioned(
          left: SwSpace.s5,
          right: SwSpace.s5,
          bottom: 0,
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(shape: BoxShape.circle, color: c.ink, border: Border.all(color: c.canvas, width: 4)),
              clipBehavior: Clip.antiAlias,
              alignment: Alignment.center,
              child: user?.obj('avatar') != null ? SwImage(user!.obj('avatar'), aspectRatio: 1, radius: 0) : Text(initials, style: context.type.displayS.copyWith(color: c.onInk)),
            ),
            const SizedBox(width: SwSpace.s4),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(bottom: SwSpace.s2),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(user == null ? ref.s('profile.guest') : name, style: context.type.displayM, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (user?.strN('phone') != null) Text(user!.str('phone'), style: context.type.bodyS.copyWith(color: c.muted)),
                ]),
              ),
            ),
          ]),
        ),
      ]),
    );
  }
}

class _Loyalty extends ConsumerWidget {
  const _Loyalty();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = ref.watch(loyaltyProvider).value;
    if (l == null) return const SizedBox(height: SwSpace.s6);
    final points = l.integer('points', l.integer('balance'));
    final tier = l.obj('tier');
    final next = l.obj('nextTier');
    final progress = next == null ? 1.0 : (points / next.integer('minPoints', 1)).clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, 0),
      child: Sheen(
        borderRadius: SwRadius.md,
        child: Container(
        padding: const EdgeInsets.all(SwSpace.s5),
        decoration: BoxDecoration(color: SwColors.dark.canvas, borderRadius: BorderRadius.circular(SwRadius.md)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Icon(Ic.crown, size: 16, color: SwColors.dark.accent),
            const SizedBox(width: SwSpace.s2),
            Text(caps(ref.s('profile.tier', {'tier': tier?.str('name') ?? 'Atelier'})), style: context.type.labelS.copyWith(color: SwColors.dark.accent)),
          ]),
          const SizedBox(height: SwSpace.s3),
          // Points count up and the tier bar fills once when the profile opens.
          TweenAnimationBuilder<double>(
            tween: Tween(begin: context.reduceMotion ? 1 : 0, end: 1),
            duration: const Duration(milliseconds: 1100),
            curve: SwMotion.atelier,
            builder: (context, t, _) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(ref.s('profile.points', {'points': (points * t).round()}), style: context.type.displayM.copyWith(color: SwColors.dark.ink), semanticsLabel: ref.s('profile.points', {'points': points})),
              const SizedBox(height: SwSpace.s4),
              ClipRRect(borderRadius: BorderRadius.circular(2), child: LinearProgressIndicator(value: progress * t, minHeight: 3, color: SwColors.dark.accent, backgroundColor: SwColors.dark.hairline)),
            ]),
          ),
          if (next != null)
            Padding(
              padding: const EdgeInsets.only(top: SwSpace.s2),
              child: Text(ref.s('profile.toNextTier', {'points': next.integer('minPoints') - points, 'tier': next.str('name')}), style: context.type.caption.copyWith(color: SwColors.dark.muted)),
            ),
        ]),
      ),
      ),
    );
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
      decoration: BoxDecoration(color: context.sw.surface, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: context.sw.hairline)),
      child: Column(children: [
        for (var i = 0; i < children.length; i++) ...[if (i > 0) const Hairline(indent: 56), children[i]],
      ]),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.label, required this.onTap, this.trailing, this.chevron = true});
  final IconData icon;
  final String label;
  final FutureOr<void> Function() onTap;
  final Widget? trailing;
  final bool chevron;
  @override
  Widget build(BuildContext context) {
    return PressableLink(
      onTap: onTap,
      loaderOverlay: false,
      scale: false,
      semanticLabel: label,
      child: SizedBox(
        height: 56,
        child: Row(children: [
          const SizedBox(width: SwSpace.s4),
          Icon(icon, size: 20, color: context.sw.ink),
          const SizedBox(width: SwSpace.s4),
          Expanded(child: Text(label, style: context.type.bodyM)),
          ?trailing,
          if (chevron) Padding(padding: const EdgeInsets.only(left: SwSpace.s2), child: Icon(Ic.chevronRight, size: 18, color: context.sw.subtle)),
          const SizedBox(width: SwSpace.s4),
        ]),
      ),
    );
  }
}
