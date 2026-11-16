import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import 'profile_data.dart';
import 'sub_page.dart';

/// Where a notification leads: order → tracking, chat → the thread, product → its page.
String? notificationRoute(Json data) {
  final thread = data.strN('threadId');
  if (thread != null) return '/chat/$thread';
  final order = data.strN('orderId');
  if (order != null) return '/orders/$order/track';
  final slug = data.strN('productSlug');
  if (slug != null) return '/p/$slug';
  return null;
}

/// Notifications: inbox with unread dots, mark-all-read, and per-channel switches.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});
  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _settings = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final inbox = ref.watch(inboxProvider);
    final unread = inbox.value?.integer('unread') ?? 0;
    return SubPage(
      title: s('profile.notifications'),
      actions: [
        if (unread > 0 && !_settings)
          SwButton(
            label: s('notifications.markAll'),
            variant: SwButtonVariant.ghost,
            onPressed: () async {
              try {
                await ref.read(inboxProvider.notifier).markRead();
              } on ApiException catch (e) {
                if (context.mounted) toastError(context, e);
              }
            },
          ),
        SwIconButton(icon: _settings ? Ic.bell : Ic.settings, semanticLabel: _settings ? s('notifications.inbox') : s('notifications.settings'), onPressed: () => setState(() => _settings = !_settings)),
      ],
      body: _settings
          ? const _ChannelSettings()
          : AsyncBody<Json>(
              value: inbox,
              skeleton: SkeletonList(
                count: 6,
                itemBuilder: (context, _) => const Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SkeletonAvatar(size: 40),
                  SizedBox(width: SwSpace.s3),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [SkeletonLine(width: 180, height: 14), SizedBox(height: SwSpace.s2), SkeletonLine(height: 10), SizedBox(height: SwSpace.s1), SkeletonLine(width: 80, height: 10)])),
                ]),
              ),
              onRefresh: () => ref.refresh(inboxProvider.future),
              isEmpty: (d) => d.list('items').isEmpty,
              empty: EmptyState(title: s('notifications.empty.title'), body: s('notifications.empty.body'), icon: Ic.bell),
              builder: (context, d) => [for (final n in d.list('items')) _Item(n: n)],
            ),
    );
  }
}

class _Item extends ConsumerWidget {
  const _Item({required this.n});
  final Json n;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sw;
    final unread = n['readAt'] == null;
    final at = DateTime.tryParse(n.str('createdAt'))?.toLocal();
    final route = notificationRoute(n.obj('data') ?? const {});
    final icon = switch (n.str('type')) { 'order' => Ic.package, 'chat' => Ic.messageCircle, 'drop' => Ic.sparkles, 'price_drop' => Ic.tag, 'wholesale' => Ic.briefcase, 'rider' => Ic.bike, _ => Ic.bell };
    return PressableLink(
      loaderOverlay: false,
      scale: false,
      semanticLabel: '${unread ? '${ref.s('notifications.unread')}. ' : ''}${n.str('title')}. ${n.str('body')}',
      onTap: () {
        if (unread) ref.read(inboxProvider.notifier).markRead(ids: [n.str('id')]).catchError((_) {});
        if (route != null) context.push(route);
      },
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: SwSpace.s3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 40, height: 40, decoration: BoxDecoration(shape: BoxShape.circle, color: unread ? c.accentSoft : c.surface, border: Border.all(color: c.hairline)), child: Icon(icon, size: 18, color: c.ink)),
          const SizedBox(width: SwSpace.s3),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(n.str('title'), style: context.type.titleS.copyWith(fontWeight: unread ? FontWeight.w700 : FontWeight.w600)),
              const SizedBox(height: 2),
              Text(n.str('body'), style: context.type.bodyS.copyWith(color: c.muted), maxLines: 3, overflow: TextOverflow.ellipsis),
              if (at != null) Padding(padding: const EdgeInsets.only(top: SwSpace.s1), child: Text(_ago(context, at), style: context.type.caption.copyWith(color: c.subtle))),
            ]),
          ),
          SizedBox(
            width: 20,
            child: unread ? Align(alignment: Alignment.topRight, child: Container(width: 8, height: 8, margin: const EdgeInsets.only(top: 6), decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle))) : null,
          ),
        ]),
      ),
    );
  }

  static String _ago(BuildContext context, DateTime t) {
    final s = context.s;
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return s('time.now');
    if (d.inHours < 1) return s('time.minutes', {'count': d.inMinutes});
    if (d.inDays < 1) return s('time.hours', {'count': d.inHours});
    if (d.inDays < 7) return s('time.days', {'count': d.inDays});
    return '${t.day}/${t.month}/${t.year}';
  }
}

/// Per-channel switches → `PATCH /me {notificationPrefs}`; optimistic, restored on failure.
class _ChannelSettings extends ConsumerStatefulWidget {
  const _ChannelSettings();
  @override
  ConsumerState<_ChannelSettings> createState() => _ChannelSettingsState();
}

class _ChannelSettingsState extends ConsumerState<_ChannelSettings> {
  Map<String, bool>? _prefs;

  Map<String, bool> get _current {
    final fromUser = ref.read(sessionProvider).user?.obj('notificationPrefs') ?? const {};
    return _prefs ?? {for (final k in notificationChannels) k: fromUser[k] != false};
  }

  Future<void> _set(String k, bool v) async {
    final before = _current;
    final next = {...before, k: v};
    setState(() => _prefs = next);
    try {
      final u = await ref.read(apiProvider).patch<Json>('/me', {'notificationPrefs': next});
      ref.read(sessionProvider.notifier).updateUser(u.obj('user') ?? u);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _prefs = before);
      toastError(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final prefs = _current;
    return ListView(padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s10 + context.bottomInset), children: [
      Text(s('notifications.settings.body'), style: context.type.bodyS.copyWith(color: context.sw.muted)),
      const SizedBox(height: SwSpace.s4),
      RowGroup(children: [
        for (final k in notificationChannels)
          ProfileRow(
            icon: switch (k) { 'order' => Ic.package, 'chat' => Ic.messageCircle, 'drop' => Ic.sparkles, 'wishlist' => Ic.tag, 'marketing' => Ic.gift, _ => Ic.smartphone },
            label: s('notifications.channel.$k'),
            subtitle: s('notifications.channel.$k.help'),
            chevron: false,
            trailing: Switch.adaptive(value: prefs[k] ?? true, activeTrackColor: context.sw.ink, onChanged: (v) => _set(k, v)),
            onTap: () => _set(k, !(prefs[k] ?? true)),
          ),
      ]),
    ]);
  }
}
