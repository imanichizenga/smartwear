import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/upload.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import 'profile_data.dart';
import 'sub_page.dart';

/// Wholesale: how tiers work, the application status (none / pending / approved / rejected) and the form.
class WholesaleScreen extends ConsumerWidget {
  const WholesaleScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final st = ref.watch(wholesaleStatusProvider);
    final open = ref.watch(configProvider).value?.feature('wholesaleApplications') ?? true;
    return SubPage(
      title: s('profile.wholesale'),
      body: AsyncBody<Json>(
        value: st,
        skeleton: const SkeletonList(count: 1, itemBuilder: _skeleton),
        onRefresh: () => ref.refresh(wholesaleStatusProvider.future),
        builder: (context, d) {
          final app = d.obj('application');
          final status = d.flag('approved') ? 'APPROVED' : (app?.str('status') ?? 'NONE');
          return [
            _StatusCard(status: status, app: app),
            const SizedBox(height: SwSpace.s6),
            _TiersExplainer(),
            const SizedBox(height: SwSpace.s6),
            if ((status == 'NONE' || status == 'REJECTED') && open) const _ApplyForm(),
            if ((status == 'NONE' || status == 'REJECTED') && !open) Text(s('wholesale.closed'), style: context.type.bodyS.copyWith(color: context.sw.muted)),
          ];
        },
      ),
    );
  }

  static Widget _skeleton(BuildContext context, int _) => const Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        SkeletonBox(height: 96, radius: SwRadius.md),
        SizedBox(height: SwSpace.s6),
        SkeletonLine(width: 160, height: 14),
        SizedBox(height: SwSpace.s3),
        SkeletonLine(height: 12),
        SizedBox(height: SwSpace.s2),
        SkeletonLine(width: 220, height: 12),
        SizedBox(height: SwSpace.s6),
        SkeletonBox(height: 52, radius: SwRadius.sm),
        SizedBox(height: SwSpace.s4),
        SkeletonBox(height: 52, radius: SwRadius.sm),
      ]);
}

class _StatusCard extends ConsumerWidget {
  const _StatusCard({required this.status, required this.app});
  final String status;
  final Json? app;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final (icon, tone, bg) = switch (status) {
      'APPROVED' => (Ic.circleCheck, ChipTone.success, c.successSoft),
      'PENDING' => (Ic.clock, ChipTone.warning, c.warningSoft),
      'REJECTED' => (Ic.circleAlert, ChipTone.danger, c.dangerSoft),
      _ => (Ic.briefcase, ChipTone.neutral, c.surface),
    };
    return Container(
      padding: const EdgeInsets.all(SwSpace.s5),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: c.hairline)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 22, color: c.ink),
        const SizedBox(width: SwSpace.s4),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SwChip(s('wholesale.status.$status'), tone: tone),
            const SizedBox(height: SwSpace.s2),
            Text(s('wholesale.status.$status.body', {'business': app?.str('businessName') ?? ''}), style: context.type.bodyS),
            if (status == 'REJECTED' && app?.strN('reviewNote') != null) Padding(padding: const EdgeInsets.only(top: SwSpace.s2), child: Text('“${app!.str('reviewNote')}”', style: context.type.caption.copyWith(color: c.muted))),
          ]),
        ),
      ]),
    );
  }
}

class _TiersExplainer extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    Widget point(IconData i, String t) => Padding(
          padding: const EdgeInsets.only(bottom: SwSpace.s3),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Icon(i, size: 18, color: c.accent), const SizedBox(width: SwSpace.s3), Expanded(child: Text(t, style: context.type.bodyS))]),
        );
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(s('wholesale.how.title'), style: context.type.titleM),
      const SizedBox(height: SwSpace.s3),
      point(Ic.layoutGrid, s('wholesale.how.tiers')),
      point(Ic.tag, s('wholesale.how.prices')),
      point(Ic.package, s('wholesale.how.moq')),
    ]);
  }
}

class _ApplyForm extends ConsumerStatefulWidget {
  const _ApplyForm();
  @override
  ConsumerState<_ApplyForm> createState() => _ApplyFormState();
}

class _ApplyFormState extends ConsumerState<_ApplyForm> {
  final _name = TextEditingController();
  final _tin = TextEditingController();
  final _type = TextEditingController();
  final _address = TextEditingController();
  final _volume = TextEditingController();
  final Map<String, String> _errors = {};
  String? _licenceId;
  double? _uploading;
  bool _sending = false;

  @override
  void dispose() {
    for (final c in [_name, _tin, _type, _address, _volume]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _pickLicence() async {
    final x = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 2400, imageQuality: 88);
    if (x == null || !mounted) return;
    setState(() => _uploading = 0);
    try {
      final m = await uploadImage(ref.read(apiProvider), File(x.path), purpose: 'wholesale_licence', onProgress: (p) {
        if (mounted) setState(() => _uploading = p);
      });
      if (mounted) setState(() => _licenceId = m.str('id'));
    } on ApiException catch (e) {
      if (mounted) toastError(context, e);
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  Future<void> _submit() async {
    final s = ref.s;
    if (_sending || _uploading != null) return;
    final tin = _tin.text.replaceAll(RegExp(r'\D'), '');
    setState(() {
      _errors
        ..clear()
        ..addAll({
          if (_name.text.trim().isEmpty) 'businessName': s('checkout.manual.required'),
          if (tin.length != 9) 'tin': s('wholesale.tinInvalid'),
        });
    });
    if (_errors.isNotEmpty) return;
    setState(() => _sending = true);
    try {
      await ref.read(apiProvider).post<Json>('/me/wholesale', {
        'businessName': _name.text.trim(),
        'tin': tin,
        'businessType': _type.text.trim(),
        'address': _address.text.trim(),
        'expectedMonthlyVolume': _volume.text.trim(),
        'licenceMediaId': ?_licenceId,
      });
      HapticFeedback.mediumImpact();
      ref.invalidate(wholesaleStatusProvider);
      if (mounted) showSwToast(context, s('wholesale.submitted'));
    } on ApiException catch (e) {
      if (!mounted) return;
      final f = e.details['field'];
      if (f is String) {
        setState(() => _errors[f] = e.message);
      } else {
        toastError(context, e);
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    Widget gap() => const SizedBox(height: SwSpace.s4);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(s('wholesale.apply.title'), style: context.type.titleM),
      const SizedBox(height: SwSpace.s4),
      SwTextField(controller: _name, label: s('wholesale.businessName'), error: _errors['businessName'], textCapitalization: TextCapitalization.words, textInputAction: TextInputAction.next, maxLength: 120),
      gap(),
      SwTextField(controller: _tin, label: s('wholesale.tin'), helper: s('wholesale.tinHelp'), error: _errors['tin'], keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(9)], textInputAction: TextInputAction.next),
      gap(),
      SwTextField(controller: _type, label: s('wholesale.businessType'), hint: s('wholesale.businessTypeHint'), textCapitalization: TextCapitalization.sentences, textInputAction: TextInputAction.next, maxLength: 60),
      gap(),
      SwTextField(controller: _address, label: s('wholesale.address'), minLines: 2, maxLines: 3, maxLength: 240, textCapitalization: TextCapitalization.sentences),
      gap(),
      SwTextField(controller: _volume, label: s('wholesale.volume'), hint: s('wholesale.volumeHint'), textInputAction: TextInputAction.done, maxLength: 40),
      gap(),
      ProfileRow(
        icon: _licenceId != null ? Ic.circleCheck : Ic.camera,
        label: _licenceId != null ? s('wholesale.licenceAdded') : s('wholesale.licence'),
        subtitle: _uploading != null ? s('wholesale.uploading', {'percent': (_uploading! * 100).round()}) : s('wholesale.licenceHelp'),
        trailing: _uploading != null ? SizedBox(width: 48, child: LinearProgressIndicator(value: _uploading, color: c.ink, backgroundColor: c.hairline, minHeight: 2)) : null,
        onTap: _uploading != null ? null : _pickLicence,
      ),
      const SizedBox(height: SwSpace.s6),
      SwButton(label: s('wholesale.submit'), large: true, expand: true, pending: _sending, onPressed: _sending || _uploading != null ? null : _submit),
    ]);
  }
}
