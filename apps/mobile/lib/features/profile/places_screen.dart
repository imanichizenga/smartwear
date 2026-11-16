import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/location.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../checkout/checkout_state.dart';
import '../checkout/place_picker.dart';
import 'profile_data.dart';
import 'sub_page.dart';

IconData _kindIcon(String k) => switch (k) { 'home' => Ic.house, 'work' => Ic.briefcase, _ => Ic.mapPin };

/// Saved places: list, add (place picker, or a short form in manual-location mode), label as
/// Home / Work / Other, set default, delete with confirm.
class PlacesScreen extends ConsumerWidget {
  const PlacesScreen({super.key});

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final manual = (ref.read(configProvider).value?.obj('checkout') ?? const {}).manualLocation;
    if (manual) {
      await showSwSheet<void>(context, title: ref.s('places.add'), builder: (_) => const _ManualPlaceForm());
      return;
    }
    if (!await showPlacePicker(context) || !context.mounted) return;
    final p = ref.read(deliveryPointProvider).point;
    if (p == null) return;
    final kind = await _pickKind(context, ref, 'other');
    if (kind == null || !context.mounted) return;
    try {
      await ref.read(apiProvider).post<Json>('/me/places', {'kind': kind, 'lat': p.point.lat, 'lng': p.point.lng, 'address': p.label ?? p.area ?? '', 'area': p.area, 'landmarkNote': p.landmark, 'placeId': p.placeId});
      ref.invalidate(savedPlacesProvider);
      ref.invalidate(placesProvider);
      if (context.mounted) showSwToast(context, ref.s('places.saved'));
    } on ApiException catch (e) {
      if (context.mounted) toastError(context, e);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final places = ref.watch(savedPlacesProvider);
    return SubPage(
      title: s('profile.savedPlaces'),
      actions: [SwIconButton(icon: Ic.plus, semanticLabel: s('places.add'), onPressed: () => _add(context, ref))],
      body: AsyncBody<Json>(
        value: places,
        skeleton: const RowGroupSkeleton(count: 3),
        onRefresh: () => ref.refresh(savedPlacesProvider.future),
        isEmpty: (d) => d.list('saved').isEmpty,
        empty: EmptyState(title: s('places.empty.title'), body: s('places.empty.body'), icon: Ic.mapPin, action: SwButton(label: s('places.add'), icon: Ic.plus, onPressed: () => _add(context, ref))),
        builder: (context, d) => [
          RowGroup(children: [for (final p in d.list('saved')) _PlaceRow(place: p)]),
          const SizedBox(height: SwSpace.s4),
          Text(s('places.defaultHint'), style: context.type.caption.copyWith(color: context.sw.muted)),
        ],
      ),
    );
  }
}

Future<String?> _pickKind(BuildContext context, WidgetRef ref, String current) {
  final s = ref.s;
  return showSwSheet<String>(
    context,
    title: s('places.labelAs'),
    builder: (ctx) => Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.paddingOf(ctx).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        for (final k in const ['home', 'work', 'other'])
          ProfileRow(
            icon: _kindIcon(k),
            label: s('places.kind.$k'),
            chevron: false,
            trailing: k == current ? Icon(Ic.check, size: 18, color: ctx.sw.ink) : null,
            onTap: () => Navigator.pop(ctx, k),
          ),
      ]),
    ),
  );
}

class _PlaceRow extends ConsumerWidget {
  const _PlaceRow({required this.place});
  final Json place;

  Future<void> _patch(BuildContext context, WidgetRef ref, Json body, String done) async {
    try {
      await ref.read(apiProvider).patch<Json>('/me/places/${place.str('id')}', body);
      ref.invalidate(savedPlacesProvider);
      ref.invalidate(placesProvider);
      if (context.mounted) showSwToast(context, done);
    } on ApiException catch (e) {
      if (context.mounted) toastError(context, e);
    }
  }

  Future<void> _menu(BuildContext context, WidgetRef ref) async {
    final s = ref.s;
    final action = await showSwSheet<String>(
      context,
      title: place.str('label', place.str('address')),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.paddingOf(ctx).bottom),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ProfileRow(icon: Ic.tag, label: s('places.labelAs'), onTap: () => Navigator.pop(ctx, 'kind')),
          ProfileRow(icon: Ic.pencil, label: s('places.rename'), onTap: () => Navigator.pop(ctx, 'rename')),
          if (!place.flag('isDefault')) ProfileRow(icon: Ic.star, label: s('places.makeDefault'), onTap: () => Navigator.pop(ctx, 'default')),
          ProfileRow(icon: Ic.trash2, label: s('places.delete'), danger: true, chevron: false, onTap: () => Navigator.pop(ctx, 'delete')),
        ]),
      ),
    );
    if (!context.mounted || action == null) return;
    switch (action) {
      case 'kind':
        final k = await _pickKind(context, ref, place.str('kind'));
        if (k != null && context.mounted) await _patch(context, ref, {'kind': k}, s('places.updated'));
      case 'rename':
        final name = await _rename(context, ref);
        if (name != null && context.mounted) await _patch(context, ref, {'label': name}, s('places.updated'));
      case 'default':
        await _patch(context, ref, {'isDefault': true}, s('places.defaultSet'));
      case 'delete':
        if (await confirmSw(context, title: s('places.deleteConfirm'), body: place.str('address'), confirm: s('places.delete'), danger: true) && context.mounted) {
          try {
            await ref.read(apiProvider).delete<Json>('/me/places/${place.str('id')}');
            ref.invalidate(savedPlacesProvider);
            ref.invalidate(placesProvider);
          } on ApiException catch (e) {
            if (context.mounted) toastError(context, e);
          }
        }
    }
  }

  Future<String?> _rename(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final ctrl = TextEditingController(text: place.str('label'));
    return showSwSheet<String>(
      context,
      title: s('places.rename'),
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.viewInsetsOf(ctx).bottom + MediaQuery.paddingOf(ctx).bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SwTextField(controller: ctrl, autofocus: true, hint: s('places.namePlaceholder'), maxLength: 60, textCapitalization: TextCapitalization.words, textInputAction: TextInputAction.done, onSubmitted: (v) => Navigator.pop(ctx, v.trim())),
          const SizedBox(height: SwSpace.s4),
          SwButton(label: s('common.save'), large: true, expand: true, onPressed: () => Navigator.pop(ctx, ctrl.text.trim())),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final kind = place.str('kind');
    final title = place.str('label').isNotEmpty ? place.str('label') : s('places.kind.$kind');
    return ProfileRow(
      icon: _kindIcon(kind),
      label: title,
      subtitle: [place.str('address'), if (place.strN('landmarkNote') != null) '“${place.str('landmarkNote')}”'].join(' · '),
      trailing: place.flag('isDefault') ? SwChip(s('places.default'), tone: ChipTone.accent) : null,
      onTap: () => _menu(context, ref),
    );
  }
}

/// Manual-location mode: a short form. The point comes from the phone's location (required to save a place);
/// the written address is what riders read.
class _ManualPlaceForm extends ConsumerStatefulWidget {
  const _ManualPlaceForm();
  @override
  ConsumerState<_ManualPlaceForm> createState() => _ManualPlaceFormState();
}

class _ManualPlaceFormState extends ConsumerState<_ManualPlaceForm> {
  final _label = TextEditingController();
  final _address = TextEditingController();
  String _kind = 'home';
  String? _error;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(deliveryPointProvider.notifier).init());
  }

  @override
  void dispose() {
    _label.dispose();
    _address.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final s = ref.s;
    final p = ref.read(deliveryPointProvider).point;
    if (_address.text.trim().isEmpty) return setState(() => _error = s('checkout.manual.required'));
    if (p == null) return setState(() => _error = s('places.needLocation'));
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).post<Json>('/me/places', {'kind': _kind, 'label': _label.text.trim(), 'address': _address.text.trim(), 'area': p.area, 'lat': p.point.lat, 'lng': p.point.lng});
      ref.invalidate(savedPlacesProvider);
      ref.invalidate(placesProvider);
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
    final c = context.sw;
    final dps = ref.watch(deliveryPointProvider);
    return Padding(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s5 + MediaQuery.viewInsetsOf(context).bottom + MediaQuery.paddingOf(context).bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Wrap(spacing: SwSpace.s2, children: [
            for (final k in const ['home', 'work', 'other']) ChoiceChipSw(label: s('places.kind.$k'), selected: _kind == k, onTap: () => setState(() => _kind = k)),
          ]),
          const SizedBox(height: SwSpace.s4),
          SwTextField(controller: _label, label: s('places.name'), hint: s('places.namePlaceholder'), maxLength: 60, textCapitalization: TextCapitalization.words, textInputAction: TextInputAction.next),
          const SizedBox(height: SwSpace.s4),
          SwTextField(controller: _address, label: s('checkout.manual.location'), minLines: 2, maxLines: 4, maxLength: 240, showCounter: true, textCapitalization: TextCapitalization.sentences, error: _error, onChanged: (_) {
            if (_error != null) setState(() => _error = null);
          }),
          const SizedBox(height: SwSpace.s3),
          Row(children: [
            if (dps.locating) const ALoader(size: ALoaderSize.xs) else Icon(dps.point != null ? Ic.mapPin : Ic.locateFixed, size: 16, color: dps.point != null ? c.ink : c.muted),
            const SizedBox(width: SwSpace.s2),
            Expanded(child: Text(dps.point != null ? (dps.point!.area ?? dps.point!.label ?? s('checkout.manual.detected')) : s('checkout.manual.notDetected'), style: context.type.caption.copyWith(color: c.muted))),
            if (dps.point == null && !dps.locating)
              SwButton(
                label: dps.permission == LocPermission.deniedForever ? s('checkout.manual.openSettings') : s('checkout.manual.useLocation'),
                variant: SwButtonVariant.ghost,
                onPressed: () => dps.permission == LocPermission.deniedForever ? ref.read(locationServiceProvider).openSettings() : ref.read(deliveryPointProvider.notifier).requestAndLocate(),
              ),
          ]),
          const SizedBox(height: SwSpace.s5),
          SwButton(label: s('common.save'), large: true, expand: true, pending: _saving, onPressed: _saving ? null : _save),
        ]),
      ),
    );
  }
}
