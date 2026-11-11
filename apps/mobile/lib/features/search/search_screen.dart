import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../home/home_screen.dart' show CategoryTile;
import '../product/product_list_screen.dart';

final _recentProvider = NotifierProvider<_Recent, List<String>>(_Recent.new);

class _Recent extends Notifier<List<String>> {
  @override
  List<String> build() => ref.read(prefsProvider).getStringList('sw.recentSearches') ?? const [];
  void add(String q) {
    final next = [q, ...state.where((x) => x.toLowerCase() != q.toLowerCase())].take(8).toList();
    state = next;
    ref.read(prefsProvider).setStringList('sw.recentSearches', next);
  }

  void clear() {
    state = const [];
    ref.read(prefsProvider).remove('sw.recentSearches');
  }
}

final _suggestProvider = FutureProvider.family<Json, String>((ref, q) => ref.read(apiProvider).get<Json>('/search/suggest', query: {'q': q}));

/// Instant, typo-tolerant search (Postgres FTS + trigram on the API), 250ms debounce.
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});
  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  final _ctrl = TextEditingController();
  Timer? _debounce;
  String _q = '';
  String? _sort;
  Map<String, List<String>> _filters = {};

  @override
  void dispose() {
    _debounce?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () {
      setState(() => _q = v.trim());
      if (v.trim().length >= 2) ref.read(_recentProvider.notifier).add(v.trim());
    });
  }

  void _search(String v) {
    _ctrl.text = v;
    _ctrl.selection = TextSelection.collapsed(offset: v.length);
    setState(() => _q = v);
    ref.read(_recentProvider.notifier).add(v);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final query = ProductQuery(q: _q, sort: _sort, filters: _filters);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s3, SwSpace.s5, SwSpace.s2),
            child: SwSearchBar(
              controller: _ctrl,
              hint: s('search.placeholder'),
              onChanged: _onChanged,
              trailing: _q.isEmpty ? null : SwIconButton(icon: Ic.x, size: 40, semanticLabel: s('search.clearAll'), onPressed: () => _search('')),
            ),
          ),
          if (_q.isNotEmpty || _filters.isNotEmpty) _FilterBar(sort: _sort, filters: _filters, onSort: (v) => setState(() => _sort = v), onFilters: (f) => setState(() => _filters = f)),
          Expanded(child: _q.isEmpty && _filters.isEmpty ? _Idle(onSearch: _search) : ProductGridView(query: query)),
        ]),
      ),
    );
  }
}

class _Idle extends ConsumerWidget {
  const _Idle({required this.onSearch});
  final ValueChanged<String> onSearch;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final recent = ref.watch(_recentProvider);
    final cats = ref.watch(categoriesProvider).value ?? const [];
    final trending = ref.watch(_suggestProvider('')).value?.list('trending') ?? const [];
    return ListView(padding: EdgeInsets.fromLTRB(0, SwSpace.s4, 0, 120 + context.safe.bottom), children: [
      if (recent.isNotEmpty) ...[
        _Label(s('search.recent'), action: s('search.clearAll'), onAction: () => ref.read(_recentProvider.notifier).clear()),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          child: Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [for (final r in recent) ChoiceChipSw(label: r, selected: false, leading: Icon(Ic.history, size: 14, color: context.sw.muted), onTap: () => onSearch(r))]),
        ),
      ],
      if (trending.isNotEmpty) ...[
        _Label(s('search.trending')),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
          child: Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [for (final t in trending) ChoiceChipSw(label: t.str('term', t.str('q')), selected: false, leading: Icon(Ic.flame, size: 14, color: context.sw.accent), onTap: () => onSearch(t.str('term', t.str('q'))))]),
        ),
      ],
      _Label(s('filter.category')),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5),
        child: LayoutBuilder(builder: (context, box) {
          final w = (box.maxWidth - SwSpace.s3 * 2) / 3;
          return Wrap(spacing: SwSpace.s3, runSpacing: SwSpace.s5, children: [for (final c in cats) CategoryTile(category: c, size: w)]);
        }),
      ),
    ]);
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text, {this.action, this.onAction});
  final String text;
  final String? action;
  final VoidCallback? onAction;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, SwSpace.s3),
      child: Row(children: [
        Expanded(child: Text(caps(text), style: context.type.label.copyWith(color: context.sw.muted))),
        if (action != null) GestureDetector(onTap: onAction, child: Text(action!, style: context.type.caption.copyWith(decoration: TextDecoration.underline))),
      ]),
    );
  }
}

class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.sort, required this.filters, required this.onSort, required this.onFilters});
  final String? sort;
  final Map<String, List<String>> filters;
  final ValueChanged<String?> onSort;
  final ValueChanged<Map<String, List<String>>> onFilters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final active = [for (final e in filters.entries) for (final v in e.value) (e.key, v)];
    return SizedBox(
      height: 52,
      child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5, vertical: SwSpace.s1), children: [
        ChoiceChipSw(label: s('search.filters'), selected: filters.isNotEmpty, leading: Icon(Ic.slidersHorizontal, size: 14, color: filters.isNotEmpty ? context.sw.onInk : context.sw.ink), onTap: () => _openFilters(context, ref)),
        const SizedBox(width: SwSpace.s2),
        ChoiceChipSw(label: sort == null ? s('search.sort') : s('sort.$sort'), selected: sort != null, leading: Icon(Ic.arrowUpDown, size: 14, color: sort != null ? context.sw.onInk : context.sw.ink), onTap: () => _openSort(context, ref)),
        for (final (k, v) in active) ...[
          const SizedBox(width: SwSpace.s2),
          ChoiceChipSw(
            label: v,
            selected: true,
            leading: Icon(Ic.x, size: 12, color: context.sw.onInk),
            onTap: () => onFilters({...filters, k: [...filters[k]!]..remove(v)}..removeWhere((_, l) => l.isEmpty)),
          ),
        ],
      ]),
    );
  }

  void _openSort(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    showSwSheet<void>(context, title: s('search.sort'), builder: (ctx) {
      return Padding(
        padding: EdgeInsets.fromLTRB(SwSpace.s5, 0, SwSpace.s5, SwSpace.s6 + ctx.safe.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final k in ['relevance', 'newest', 'price_asc', 'price_desc', 'popular'])
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () {
                onSort(k == 'relevance' ? null : k);
                Navigator.pop(ctx);
              },
              child: SizedBox(
                height: 52,
                child: Row(children: [
                  Expanded(child: Text(s('sort.$k'), style: ctx.type.bodyM)),
                  if ((sort ?? 'relevance') == k) Icon(Ic.check, size: 18, color: ctx.sw.ink),
                ]),
              ),
            ),
        ]),
      );
    });
  }

  void _openFilters(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    var draft = {for (final e in filters.entries) e.key: [...e.value]};
    const sizes = ['XS', 'S', 'M', 'L', 'XL'];
    const colours = [('Ivory', '#F3EDE2'), ('Black', '#141414'), ('Red', '#B3122A'), ('Navy', '#1E2A4A'), ('Blush', '#E7B9A9'), ('Olive', '#4E5A3A'), ('Gold', '#C9A45C')];
    showSwSheet<void>(context, title: s('search.filters'), expand: true, builder: (ctx) {
      return StatefulBuilder(builder: (ctx, setS) {
        void toggle(String k, String v) => setS(() {
              final l = draft[k] ?? <String>[];
              l.contains(v) ? l.remove(v) : l.add(v);
              draft[k] = l;
            });
        bool on(String k, String v) => draft[k]?.contains(v) ?? false;
        return Column(mainAxisSize: MainAxisSize.min, children: [
          Flexible(
            child: ListView(shrinkWrap: true, padding: const EdgeInsets.symmetric(horizontal: SwSpace.s5), children: [
              _Label(s('filter.size')),
              Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [for (final z in sizes) ChoiceChipSw(label: z, selected: on('size', z), onTap: () => toggle('size', z))]),
              _Label(s('filter.color')),
              Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
                for (final (name, hex) in colours)
                  ChoiceChipSw(label: name, selected: on('color', name), leading: Container(width: 12, height: 12, decoration: BoxDecoration(shape: BoxShape.circle, color: hexColor(hex), border: Border.all(color: ctx.sw.hairline))), onTap: () => toggle('color', name)),
              ]),
              _Label(s('filter.availability')),
              Row(children: [
                Expanded(child: Text(s('filter.availability'), style: ctx.type.bodyM)),
                Switch.adaptive(value: on('inStock', 'true'), activeTrackColor: ctx.sw.ink, onChanged: (_) => toggle('inStock', 'true')),
              ]),
            ]),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s4 + ctx.safe.bottom),
            child: Row(children: [
              SwButton(label: s('search.clearAll'), variant: SwButtonVariant.ghost, onPressed: () => setS(() => draft = {})),
              const SizedBox(width: SwSpace.s3),
              Expanded(
                child: SwButton(
                  label: s('search.apply'),
                  large: true,
                  expand: true,
                  onPressed: () {
                    onFilters(draft..removeWhere((_, l) => l.isEmpty));
                    Navigator.pop(ctx);
                  },
                ),
              ),
            ]),
          ),
        ]);
      });
    });
  }
}
