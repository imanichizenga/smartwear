import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../core/upload.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import 'sub_page.dart';

/// Initials for an avatar placeholder ("Neema Mushi" → "NM").
String initialsOf(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  return parts.isEmpty ? 'SW' : parts.map((p) => p.characters.first).take(2).join().toUpperCase();
}

/// Avatar photo, or initials on ink.
class Avatar extends StatelessWidget {
  const Avatar({super.key, required this.user, this.size = 96, this.border = 4, this.overlay});
  final Json? user;
  final double size, border;
  final Widget? overlay;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final name = user?.str('displayName', user?.str('name') ?? '') ?? '';
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(shape: BoxShape.circle, color: c.ink, border: border > 0 ? Border.all(color: c.canvas, width: border) : null),
      clipBehavior: Clip.antiAlias,
      alignment: Alignment.center,
      child: Stack(fit: StackFit.expand, children: [
        if (user?.obj('avatar') != null) SwImage(user!.obj('avatar'), aspectRatio: null, radius: 0) else Center(child: Text(initialsOf(name), style: context.type.displayS.copyWith(color: c.onInk, fontSize: size * 0.32))),
        ?overlay,
      ]),
    );
  }
}

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});
  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  late final TextEditingController _name;
  late final TextEditingController _email;
  final _emailFocus = FocusNode();
  final Map<String, String> _errors = {};
  double? _progress;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final u = ref.read(sessionProvider).user ?? const {};
    _name = TextEditingController(text: u.str('name'));
    _email = TextEditingController(text: u.str('email'));
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _emailFocus.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar(ImageSource source) async {
    final x = await ImagePicker().pickImage(source: source, maxWidth: 1200, maxHeight: 1200, imageQuality: 86);
    if (x == null || !mounted) return;
    setState(() => _progress = 0);
    try {
      final api = ref.read(apiProvider);
      final m = await uploadImage(api, File(x.path), purpose: 'avatar', onProgress: (p) {
        if (mounted) setState(() => _progress = p);
      });
      final u = await api.patch<Json>('/me', {'avatarMediaId': m.str('id')});
      ref.read(sessionProvider.notifier).updateUser(u);
      HapticFeedback.lightImpact();
      if (mounted) showSwToast(context, ref.s('profile.edit.photoUpdated'));
    } on ApiException catch (e) {
      if (mounted) toastError(context, e);
    } finally {
      if (mounted) setState(() => _progress = null);
    }
  }

  void _photoSheet() {
    final s = ref.s;
    final hasPhoto = ref.read(sessionProvider).user?.obj('avatar') != null;
    showSwSheet<void>(
      context,
      title: s('profile.edit.photo'),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.paddingOf(ctx).bottom),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ProfileRow(icon: Ic.camera, label: s('profile.edit.takePhoto'), onTap: () {
            Navigator.pop(ctx);
            _pickAvatar(ImageSource.camera);
          }),
          ProfileRow(icon: Ic.image, label: s('profile.edit.choosePhoto'), onTap: () {
            Navigator.pop(ctx);
            _pickAvatar(ImageSource.gallery);
          }),
          if (hasPhoto)
            ProfileRow(icon: Ic.trash2, label: s('profile.edit.removePhoto'), danger: true, chevron: false, onTap: () async {
              Navigator.pop(ctx);
              try {
                final u = await ref.read(apiProvider).patch<Json>('/me', {'avatarMediaId': null});
                ref.read(sessionProvider.notifier).updateUser(u);
              } on ApiException catch (e) {
                if (mounted) toastError(context, e);
              }
            }),
        ]),
      ),
    );
  }

  Future<void> _save() async {
    final s = ref.s;
    if (_saving) return;
    final name = _name.text.trim();
    final email = _email.text.trim();
    setState(() {
      _errors
        ..clear()
        ..addAll({
          if (name.isEmpty) 'name': s('checkout.manual.required'),
          if (email.isNotEmpty && !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) 'email': s('profile.edit.emailInvalid'),
        });
    });
    if (_errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      final u = await ref.read(apiProvider).patch<Json>('/me', {'name': name, 'email': email.isEmpty ? null : email});
      ref.read(sessionProvider.notifier).updateUser(u);
      HapticFeedback.mediumImpact();
      if (!mounted) return;
      showSwToast(context, s('profile.edit.saved'));
      context.canPop() ? context.pop() : context.go('/profile');
    } on ApiException catch (e) {
      if (!mounted) return;
      final f = e.details['field'];
      if (f is String && (f == 'name' || f == 'email')) {
        setState(() => _errors[f] = e.message);
      } else {
        toastError(context, e);
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final u = ref.watch(sessionProvider).user;
    final verified = u?.strN('phone') != null && (u?.flag('phoneVerified') == true || u?.strN('phoneVerifiedAt') != null);
    return SubPage(
      title: s('profile.edit'),
      bottom: SafeArea(
        minimum: const EdgeInsets.only(bottom: SwSpace.s3),
        child: Padding(
          padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s3, SwSpace.s5, MediaQuery.viewInsetsOf(context).bottom > 0 ? SwSpace.s3 : 0),
          child: SwButton(label: s('common.save'), large: true, expand: true, pending: _saving, onPressed: _saving || _progress != null ? null : _save),
        ),
      ),
      body: ListView(
        keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s8),
        children: [
          Center(
            child: Semantics(
              button: true,
              label: s('profile.edit.photo'),
              child: GestureDetector(
                onTap: _progress == null ? _photoSheet : null,
                child: Stack(clipBehavior: Clip.none, children: [
                  Avatar(
                    user: u,
                    size: 104,
                    border: 0,
                    overlay: _progress == null
                        ? null
                        : ColoredBox(
                            color: c.ink.withValues(alpha: 0.45),
                            child: Center(child: SizedBox(width: 40, height: 40, child: CircularProgressIndicator(value: _progress == 0 ? null : _progress, strokeWidth: 2, color: c.onInk))),
                          ),
                  ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(shape: BoxShape.circle, color: c.surface, border: Border.all(color: c.hairline)),
                      child: Icon(Ic.camera, size: 18, color: c.ink),
                    ),
                  ),
                ]),
              ),
            ),
          ),
          const SizedBox(height: SwSpace.s8),
          SwTextField(controller: _name, label: s('profile.edit.name'), error: _errors['name'], textCapitalization: TextCapitalization.words, autofillHints: const [AutofillHints.name], textInputAction: TextInputAction.next, maxLength: 120, onSubmitted: (_) => _emailFocus.requestFocus()),
          const SizedBox(height: SwSpace.s5),
          SwTextField(controller: _email, focusNode: _emailFocus, label: s('profile.edit.email'), hint: 'name@example.com', error: _errors['email'], keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.email], textInputAction: TextInputAction.done, onSubmitted: (_) => _save()),
          const SizedBox(height: SwSpace.s5),
          Text(s('profile.edit.phone'), style: context.type.titleS),
          const SizedBox(height: SwSpace.s2),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s4),
            decoration: BoxDecoration(color: c.canvas, borderRadius: BorderRadius.circular(SwRadius.sm), border: Border.all(color: c.hairline)),
            child: Row(children: [
              Expanded(child: Text(u?.strN('phone') ?? s('profile.edit.noPhone'), style: context.type.bodyM.copyWith(color: u?.strN('phone') != null ? c.ink : c.muted))),
              if (verified) SwChip(s('profile.edit.verified'), tone: ChipTone.success, icon: Ic.circleCheck),
            ]),
          ),
          const SizedBox(height: SwSpace.s2),
          Text(s('profile.edit.phoneHelp'), style: context.type.caption.copyWith(color: c.muted)),
        ],
      ),
    );
  }
}
