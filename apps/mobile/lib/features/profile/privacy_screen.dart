import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import 'profile_data.dart';
import 'sub_page.dart';

/// Privacy & account: signed-in devices (sign out the others), data export, delete account.
class PrivacyScreen extends ConsumerWidget {
  const PrivacyScreen({super.key});

  Future<void> _revokeOthers(BuildContext context, WidgetRef ref, List<Json> others) async {
    final s = ref.s;
    if (!await confirmSw(context, title: s('privacy.signOutOthers'), body: s('privacy.signOutOthers.body', {'count': others.length}), confirm: s('privacy.signOutOthers'))) return;
    try {
      for (final o in others) {
        await ref.read(apiProvider).delete<Json>('/me/sessions/${o.str('id')}');
      }
      ref.invalidate(sessionsListProvider);
      if (context.mounted) showSwToast(context, s('privacy.signedOutOthers'));
    } on ApiException catch (e) {
      if (context.mounted) toastError(context, e);
    }
  }

  Future<void> _export(BuildContext context, WidgetRef ref) async {
    final s = ref.s;
    try {
      final data = await ref.read(apiProvider).get<Json>('/me/export');
      if (!context.mounted) return;
      final pretty = const JsonEncoder.withIndent('  ').convert(data);
      await showSwSheet<void>(
        context,
        title: s('privacy.export.ready'),
        builder: (ctx) => Padding(
          padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.paddingOf(ctx).bottom),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Text(s('privacy.export.body', {'size': (pretty.length / 1024).ceil()}), style: ctx.type.bodyS.copyWith(color: ctx.sw.muted)),
            const SizedBox(height: SwSpace.s5),
            SwButton(
              label: s('privacy.export.copy'),
              icon: Ic.copy,
              large: true,
              expand: true,
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: pretty));
                if (ctx.mounted) {
                  Navigator.pop(ctx);
                  showSwToast(context, s('privacy.export.copied'));
                }
              },
            ),
          ]),
        ),
      );
    } on ApiException catch (e) {
      if (context.mounted) toastError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final sessions = ref.watch(sessionsListProvider);
    return SubPage(
      title: s('profile.privacy'),
      body: AsyncBody<List<Json>>(
        value: sessions,
        skeleton: const Column(children: [RowGroupSkeleton(count: 2), SizedBox(height: SwSpace.s8), RowGroupSkeleton(count: 2)]),
        onRefresh: () => ref.refresh(sessionsListProvider.future),
        builder: (context, list) {
          final others = [for (final x in list) if (!x.flag('current')) x];
          return [
            _Label(s('privacy.devices')),
            RowGroup(children: [for (final x in list) _SessionRow(x: x)]),
            if (others.isNotEmpty) ...[
              const SizedBox(height: SwSpace.s3),
              SwButton(label: s('privacy.signOutOthers'), icon: Ic.logOut, variant: SwButtonVariant.secondary, expand: true, onPressed: () => _revokeOthers(context, ref, others)),
            ],
            const SizedBox(height: SwSpace.s8),
            _Label(s('privacy.yourData')),
            RowGroup(children: [
              ProfileRow(icon: Ic.download, label: s('privacy.export'), subtitle: s('privacy.export.help'), onTap: () => _export(context, ref)),
              ProfileRow(icon: Ic.trash2, label: s('privacy.delete'), subtitle: s('privacy.delete.help'), danger: true, onTap: () => context.push('/privacy/delete')),
            ]),
          ];
        },
      ),
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: SwSpace.s3), child: Text(caps(text), style: context.type.label.copyWith(color: context.sw.muted)));
}

class _SessionRow extends ConsumerWidget {
  const _SessionRow({required this.x});
  final Json x;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final current = x.flag('current');
    final last = DateTime.tryParse(x.str('lastUsedAt'))?.toLocal();
    final device = switch (x.str('platform')) { 'ios' => 'iPhone', 'android' => 'Android', _ => s('privacy.device') };
    return ProfileRow(
      icon: Ic.smartphone,
      label: '$device${x.strN('appVersion') != null ? ' · v${x.str('appVersion')}' : ''}',
      subtitle: current ? s('privacy.thisDevice') : (last != null ? s('privacy.lastActive', {'date': '${last.day}/${last.month}/${last.year}'}) : null),
      chevron: false,
      trailing: current
          ? SwChip(s('privacy.thisDevice'), tone: ChipTone.success)
          : SwButton(
              label: s('privacy.signOut'),
              variant: SwButtonVariant.ghost,
              onPressed: () async {
                try {
                  await ref.read(apiProvider).delete<Json>('/me/sessions/${x.str('id')}');
                  ref.invalidate(sessionsListProvider);
                } on ApiException catch (e) {
                  if (context.mounted) toastError(context, e);
                }
              },
            ),
    );
  }
}

/// Delete account: explains what happens, then asks the shopper to type DELETE (or FUTA) to confirm.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({super.key});
  @override
  ConsumerState<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _ctrl = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  String get _word => ref.read(localeProvider) == 'sw' ? 'FUTA' : 'DELETE';

  Future<void> _delete() async {
    if (_busy || _ctrl.text.trim().toUpperCase() != _word) return;
    setState(() => _busy = true);
    final session = ref.read(sessionProvider.notifier)..expectSignOut();
    try {
      await ref.read(apiProvider).delete<Json>('/me');
      HapticFeedback.heavyImpact();
      await session.forgetLocally();
      if (!mounted) return;
      context.go('/welcome');
      showSwToast(context, ref.s('privacy.deleted'));
    } on ApiException catch (e) {
      session.cancelExpectedSignOut(); // nothing was deleted: stay signed in
      if (mounted) toastError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final ready = _ctrl.text.trim().toUpperCase() == _word;
    return SubPage(
      title: s('privacy.delete'),
      body: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s10 + context.bottomInset),
        children: [
          Text(s('privacy.delete.title'), style: context.type.displayS),
          const SizedBox(height: SwSpace.s3),
          for (final k in const ['privacy.delete.point1', 'privacy.delete.point2', 'privacy.delete.point3'])
            Padding(
              padding: const EdgeInsets.only(bottom: SwSpace.s3),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(Ic.circleAlert, size: 16, color: c.danger), const SizedBox(width: SwSpace.s3), Expanded(child: Text(s(k), style: context.type.bodyS))]),
            ),
          const SizedBox(height: SwSpace.s4),
          SwTextField(
            controller: _ctrl,
            label: s('privacy.delete.type', {'word': _word}),
            hint: _word,
            textCapitalization: TextCapitalization.characters,
            textInputAction: TextInputAction.done,
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _delete(),
          ),
          const SizedBox(height: SwSpace.s6),
          SwButton(label: s('privacy.delete.confirm'), icon: Ic.trash2, variant: SwButtonVariant.danger, large: true, expand: true, pending: _busy, onPressed: ready && !_busy ? _delete : null),
        ],
      ),
    );
  }
}
