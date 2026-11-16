import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/money.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import 'profile_data.dart';
import 'sub_page.dart';

/// Payments: preferred method, saved mobile-money numbers, and payment history.
class PaymentsScreen extends ConsumerWidget {
  const PaymentsScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(paymentHistoryProvider);
    await ref.refresh(paymentMethodsProvider.future);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final methods = ref.watch(paymentMethodsProvider);
    final history = ref.watch(paymentHistoryProvider);
    return SubPage(
      title: s('profile.payments'),
      body: AsyncBody<Json>(
        value: methods,
        skeleton: const Column(children: [RowGroupSkeleton(count: 2), SizedBox(height: SwSpace.s8), RowGroupSkeleton(count: 3)]),
        onRefresh: () => _refresh(ref),
        builder: (context, m) {
          final available = m.list('available');
          final saved = m.list('saved');
          final mobileMoney = available.any((a) => a.str('method') == 'MOBILE_MONEY');
          return [
            _Label(s('payments.methods')),
            RowGroup(children: [
              for (final p in saved) _SavedMethodRow(m: p),
              if (saved.isEmpty)
                for (final a in available)
                  ProfileRow(
                    icon: a.str('method') == 'MOBILE_MONEY' ? Ic.smartphone : Ic.banknote,
                    label: ref.watch(localeProvider) == 'sw' ? a.str('labelSw', a.str('label')) : a.str('label'),
                    subtitle: m.obj('default')?.str('method') == a.str('method') ? s('payments.preferred') : null,
                    chevron: false,
                  ),
              if (mobileMoney) ProfileRow(icon: Ic.plus, label: s('payments.addNumber'), onTap: () => showSwSheet<void>(context, title: s('payments.addNumber'), builder: (_) => const _AddNumberSheet())),
            ]),
            if (available.isEmpty) Padding(padding: const EdgeInsets.only(top: SwSpace.s3), child: Text(s('payments.noneAvailable'), style: context.type.caption.copyWith(color: context.sw.muted))),
            const SizedBox(height: SwSpace.s8),
            _Label(s('payments.history')),
            ...history.when<List<Widget>>(
              skipLoadingOnRefresh: true,
              loading: () => const [RowGroupSkeleton(count: 3, padding: EdgeInsets.zero)],
              error: (e, _) => [LoadError(error: e, compact: true, onRetry: () => ref.invalidate(paymentHistoryProvider))],
              data: (items) => items.isEmpty
                  ? [Padding(padding: const EdgeInsets.symmetric(vertical: SwSpace.s4), child: Text(s('payments.historyEmpty'), style: context.type.bodyS.copyWith(color: context.sw.muted)))]
                  : [RowGroup(children: [for (final p in items) _HistoryRow(p: p)])],
            ),
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

class _SavedMethodRow extends ConsumerWidget {
  const _SavedMethodRow({required this.m});
  final Json m;

  Future<void> _menu(BuildContext context, WidgetRef ref) async {
    final s = ref.s;
    final action = await showSwSheet<String>(
      context,
      title: m.str('label', m.str('msisdn', m.str('method'))),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.paddingOf(ctx).bottom),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (!m.flag('isDefault')) ProfileRow(icon: Ic.star, label: s('payments.makePreferred'), onTap: () => Navigator.pop(ctx, 'default')),
          ProfileRow(icon: Ic.trash2, label: s('payments.remove'), danger: true, chevron: false, onTap: () => Navigator.pop(ctx, 'delete')),
        ]),
      ),
    );
    if (action == null || !context.mounted) return;
    try {
      if (action == 'default') {
        await ref.read(apiProvider).patch<Json>('/me/payment-methods/${m.str('id')}', {'isDefault': true});
      } else if (await confirmSw(context, title: s('payments.removeConfirm'), confirm: s('payments.remove'), danger: true)) {
        await ref.read(apiProvider).delete<Json>('/me/payment-methods/${m.str('id')}');
      }
      ref.invalidate(paymentMethodsProvider);
    } on ApiException catch (e) {
      if (context.mounted) toastError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final mm = m.str('method') == 'MOBILE_MONEY';
    return ProfileRow(
      icon: mm ? Ic.smartphone : Ic.banknote,
      label: m.strN('label') ?? (mm ? s('payments.mobileMoney') : s('payments.cash')),
      subtitle: [if (m.strN('provider') != null) caps(m.str('provider')), if (m.strN('msisdn') != null) m.str('msisdn')].join(' · '),
      trailing: m.flag('isDefault') ? SwChip(s('payments.preferred'), tone: ChipTone.accent) : null,
      onTap: () => _menu(context, ref),
    );
  }
}

class _HistoryRow extends ConsumerWidget {
  const _HistoryRow({required this.p});
  final Json p;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final at = DateTime.tryParse(p.str('paidAt', p.str('createdAt')))?.toLocal();
    final status = p.str('status');
    final tone = switch (status) { 'PAID' => ChipTone.success, 'FAILED' => ChipTone.danger, 'PENDING' => ChipTone.warning, _ => ChipTone.neutral };
    return ProfileRow(
      icon: p.str('method') == 'MOBILE_MONEY' ? Ic.smartphone : Ic.banknote,
      label: '${p.obj('order')?.str('number') ?? ''} · ${formatMoney(p.integer('amount'), p.str('currency', 'TZS'))}',
      subtitle: [if (at != null) '${at.day}/${at.month}/${at.year}', if (p.strN('msisdn') != null) p.str('msisdn')].join(' · '),
      trailing: SwChip(s('payments.status.$status'), tone: tone),
      onTap: () => context.push('/orders/${p.obj('order')?.str('id')}/track'),
    );
  }
}

class _AddNumberSheet extends ConsumerStatefulWidget {
  const _AddNumberSheet();
  @override
  ConsumerState<_AddNumberSheet> createState() => _AddNumberSheetState();
}

class _AddNumberSheetState extends ConsumerState<_AddNumberSheet> {
  final _ctrl = TextEditingController();
  String? _provider;
  String? _error;
  bool _saving = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final s = ref.s;
    final digits = _ctrl.text.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp(r'^0'), '');
    if (digits.length != 9) return setState(() => _error = s('auth.phone.invalid'));
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).post<Json>('/me/payment-methods', {'method': 'MOBILE_MONEY', 'msisdn': '+255$digits', 'provider': ?_provider, 'isDefault': true});
      ref.invalidate(paymentMethodsProvider);
      HapticFeedback.mediumImpact();
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.isNetwork ? s('common.offlineAction') : e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final providers = (ref.watch(paymentMethodsProvider).value?.list('available').firstWhere((a) => a.str('method') == 'MOBILE_MONEY', orElse: () => const {})['providers'] as List?)?.cast<String>() ?? const <String>[];
    return Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.viewInsetsOf(context).bottom + MediaQuery.paddingOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (providers.isNotEmpty) ...[
          Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
            for (final p in providers) ChoiceChipSw(label: caps(p), selected: _provider == p, onTap: () => setState(() => _provider = p)),
          ]),
          const SizedBox(height: SwSpace.s4),
        ],
        SwTextField(
          controller: _ctrl,
          autofocus: true,
          label: s('payments.number'),
          hint: s('auth.phone.placeholder'),
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10)],
          prefix: Padding(padding: const EdgeInsets.only(left: SwSpace.s4, right: SwSpace.s2), child: Align(widthFactor: 1, child: Text('+255', style: context.type.bodyM.copyWith(fontWeight: FontWeight.w600)))),
          error: _error,
          textInputAction: TextInputAction.done,
          onChanged: (_) {
            if (_error != null) setState(() => _error = null);
          },
          onSubmitted: (_) => _save(),
        ),
        const SizedBox(height: SwSpace.s5),
        SwButton(label: s('common.save'), large: true, expand: true, pending: _saving, onPressed: _saving ? null : _save),
      ]),
    );
  }
}
