import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:just_audio/just_audio.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../home/home_screen.dart' show ProductRail;
import '../shared/nav.dart';

class ProductScreen extends ConsumerWidget {
  const ProductScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(productProvider(slug));
    return p.when(
      data: (d) => _ProductView(product: d),
      loading: () => const _ProductSkeleton(),
      error: (e, _) => Scaffold(
        appBar: AppBar(leading: const _Back()),
        body: EmptyState(title: ref.s('common.error.title'), body: e is ApiException ? e.message : ref.s('common.error.body'), action: SwButton(label: ref.s('common.retry'), onPressed: () => ref.refresh(productProvider(slug).future))),
      ),
    );
  }
}

class _ProductView extends ConsumerStatefulWidget {
  const _ProductView({required this.product});
  final Json product;
  @override
  ConsumerState<_ProductView> createState() => _ProductViewState();
}

class _ProductViewState extends ConsumerState<_ProductView> {
  final Map<String, String> _selected = {}; // optionTypeId → valueId
  int _qty = 1;
  final _bagKey = GlobalKey();
  final _galleryKey = GlobalKey();

  Json get p => widget.product;
  List<Json> get _types => p.list('optionTypes');
  Json? get _colourType => _types.where((t) => t.str('kind') == 'color' || t.str('kind') == 'shade').firstOrNull;
  Json? get _sizeType => _types.where((t) => t.str('kind') == 'size' || t.str('kind') == 'volume').firstOrNull;

  @override
  void initState() {
    super.initState();
    final c = _colourType;
    if (c != null) {
      final firstInStock = c.list('values').firstWhere((v) => _variantsWith(v.str('id')).any((x) => x.flag('inStock')), orElse: () => c.list('values').first);
      _selected[c.str('id')] = firstInStock.str('id');
    }
    for (final t in _types) {
      if (t.list('values').length == 1) _selected[t.str('id')] = t.list('values').first.str('id');
    }
  }

  Iterable<Json> _variantsWith(String valueId) => p.list('variants').where((v) => (v['optionValueIds'] as List).contains(valueId));

  Json? get _variant {
    if (_selected.length < _types.length) return null;
    final want = _selected.values.toSet();
    return p.list('variants').where((v) => (v['optionValueIds'] as List).map((e) => '$e').toSet().containsAll(want)).firstOrNull;
  }

  /// Size values that are sold out for the chosen colour.
  Set<String> get _unavailable {
    final st = _sizeType;
    if (st == null) return {};
    final colour = _colourType == null ? null : _selected[_colourType!.str('id')];
    return {
      for (final v in st.list('values'))
        if (!p.list('variants').any((x) {
          final ids = (x['optionValueIds'] as List).map((e) => '$e').toSet();
          return ids.contains(v.str('id')) && (colour == null || ids.contains(colour)) && x.flag('inStock');
        }))
          v.str('id'),
    };
  }

  List<Json> get _gallery {
    final colour = _colourType == null ? null : _selected[_colourType!.str('id')];
    final all = p.list('media').where((m) => m.str('type') == 'IMAGE' || m.str('type') == 'VIDEO').toList();
    if (colour == null) return all;
    final mine = all.where((m) => m.strN('optionValueId') == null || m.strN('optionValueId') == colour).toList();
    return mine.isEmpty ? all : mine;
  }

  Future<void> _addToBag() async {
    final v = _variant;
    if (v == null) {
      HapticFeedback.heavyImpact();
      showSwToast(context, ref.s('product.selectSize'), icon: Ic.ruler);
      return;
    }
    await requireSignIn(context, ref, () async {
      try {
        await ref.read(cartProvider.notifier).add(v.str('id'), _qty);
        HapticFeedback.mediumImpact();
        if (!mounted) return;
        _flyToBag();
        showSwToast(context, ref.s('product.added'), icon: Ic.shoppingBag);
      } on ApiException catch (e) {
        if (mounted) showSwToast(context, e.message, error: true);
      }
    });
  }

  /// A small thumbnail of the current photo glides from the gallery into the bag button.
  void _flyToBag() {
    if (context.reduceMotion) return;
    final overlay = Overlay.of(context);
    final from = (_galleryKey.currentContext?.findRenderObject() as RenderBox?)?.localToGlobal(Offset.zero);
    final to = (_bagKey.currentContext?.findRenderObject() as RenderBox?)?.localToGlobal(Offset.zero);
    if (from == null || to == null) return;
    late OverlayEntry entry;
    final media = _gallery.isEmpty ? null : _gallery.first;
    entry = OverlayEntry(
      builder: (context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: const Duration(milliseconds: 620),
        curve: SwMotion.atelier,
        onEnd: () => entry.remove(),
        builder: (context, t, _) {
          final start = from + const Offset(80, 120);
          final pos = Offset.lerp(start, to + const Offset(12, 0), t)!.translate(0, -120 * (1 - (2 * t - 1) * (2 * t - 1)) * (1 - t));
          return Positioned(
            left: pos.dx,
            top: pos.dy,
            child: IgnorePointer(child: Opacity(opacity: 1 - t * 0.6, child: SizedBox(width: 72 - 44 * t, child: SwImage(media, radius: SwRadius.sm)))),
          );
        },
      ),
    );
    overlay.insert(entry);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final s = ref.s;
    final v = _variant;
    final price = v?.obj('price') ?? p.obj('price');
    final colourType = _colourType, sizeType = _sizeType;
    final wished = ref.watch(wishlistProvider).value?.contains(p.str('id')) ?? false;
    final width = MediaQuery.sizeOf(context).width;
    return Scaffold(
      body: Stack(children: [
        CustomScrollView(slivers: [
          SliverToBoxAdapter(
            child: KeyedSubtree(key: _galleryKey, child: _Gallery(media: _gallery, heroTag: 'product-${p.str('id')}', width: width)),
          ),
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s6, SwSpace.s5, 0),
            sliver: SliverList.list(children: [
              if (p.obj('brand') != null) Text(caps(p.obj('brand')!.str('name')), style: context.type.label.copyWith(color: c.muted)),
              const SizedBox(height: SwSpace.s2),
              Text(p.str('title'), style: context.type.displayL),
              if (p.strN('tagline') != null && p.str('tagline').isNotEmpty) Padding(padding: const EdgeInsets.only(top: SwSpace.s2), child: Text(p.str('tagline'), style: context.type.bodyM.copyWith(color: c.muted))),
              const SizedBox(height: SwSpace.s4),
              Row(children: [
                Expanded(child: PriceTag(price, size: PriceSize.l, range: v == null ? p.obj('priceRange') : null)),
                if (p.integer('reviewCount') > 0) RatingStars(rating: p.obj('reviews')?.dbl('average') ?? 0, count: p.integer('reviewCount')),
              ]),
              if (p.list('badges').isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: SwSpace.s3),
                  child: Wrap(spacing: SwSpace.s2, children: [for (final b in p.list('badges')) SwChip(b.str('label'), tone: switch (b.str('tone')) { 'accent' => ChipTone.accent, 'blush' => ChipTone.blush, 'ink' => ChipTone.ink, _ => ChipTone.neutral })]),
                ),
              if ((price?.list('tiers') ?? const []).isNotEmpty && price!.flag('showWholesale')) ...[
                const SizedBox(height: SwSpace.s6),
                TierTable(price: price, qty: _qty),
              ],
              if (colourType != null && colourType.list('values').length > 1) ...[
                const SizedBox(height: SwSpace.s6),
                _OptionLabel(
                  label: colourType.str('kind') == 'shade' ? s('product.shade') : s('product.colour'),
                  value: colourType.list('values').firstWhere((x) => x.str('id') == _selected[colourType.str('id')], orElse: () => const {}).strN('label'),
                ),
                SwatchPicker(values: colourType.list('values'), selected: _selected[colourType.str('id')], onSelect: (id) => setState(() => _selected[colourType.str('id')] = id)),
              ],
              if (sizeType != null && sizeType.list('values').length > 1) ...[
                const SizedBox(height: SwSpace.s6),
                Row(children: [
                  Expanded(child: _OptionLabel(label: sizeType.str('kind') == 'volume' ? s('product.size') : s('product.size'), value: null)),
                  if (p.obj('sizeChart') != null)
                    PressableLink(
                      loaderOverlay: false,
                      onTap: () => _sizeGuide(context, p.obj('sizeChart')!),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: SwSpace.s2),
                        child: Row(children: [Icon(Ic.ruler, size: 16, color: c.ink), const SizedBox(width: SwSpace.s1_5), Text(s('product.sizeGuide'), style: context.type.titleS.copyWith(decoration: TextDecoration.underline, decorationColor: c.accent))]),
                      ),
                    ),
                ]),
                const SizedBox(height: SwSpace.s2),
                SizePicker(values: sizeType.list('values'), selected: _selected[sizeType.str('id')], unavailable: _unavailable, onSelect: (id) => setState(() => _selected[sizeType.str('id')] = id)),
                if (p.strN('fitNote') != null)
                  Padding(
                    padding: const EdgeInsets.only(top: SwSpace.s3),
                    child: Row(children: [
                      Icon(Ic.info, size: 14, color: c.muted),
                      const SizedBox(width: SwSpace.s1_5),
                      Text(s('product.fit.${switch (p.str('fitNote')) { 'small' => 'runs_small', 'large' => 'runs_large', _ => 'true_to_size' }}'), style: context.type.caption.copyWith(color: c.muted)),
                    ]),
                  ),
              ],
              if (v != null && v.flag('lowStock') && v.intN('stockLevel') != null)
                Padding(padding: const EdgeInsets.only(top: SwSpace.s3), child: Text(s('product.lowStock', {'count': v.integer('stockLevel')}), style: context.type.caption.copyWith(color: c.warning))),
              if (p.obj('audioNote') != null) ...[const SizedBox(height: SwSpace.s8), DesignerNote(media: p.obj('audioNote')!, title: s('product.designerNote'))],
              const SizedBox(height: SwSpace.s8),
              const Hairline(),
              _Accordion(title: s('product.description'), initiallyOpen: true, child: Text(htmlToText(p.str('descriptionHtml')), style: context.type.bodyM)),
              if (p.str('story').isNotEmpty) _Accordion(title: s('product.story'), child: Text(p.str('story'), style: context.type.bodyM)),
              if (p.str('materials').isNotEmpty && !p.flag('isBeauty')) _Accordion(title: s('product.materials'), child: _Facts(p: p)),
              if (p.flag('isBeauty') && p.obj('beauty') != null) _Accordion(title: s('product.ingredients'), child: _Beauty(b: p.obj('beauty')!)),
              if (p.str('care').isNotEmpty) _Accordion(title: s('product.care'), child: Text(p.str('care'), style: context.type.bodyM)),
            ]),
          ),
          if (p.list('completeTheLook').isNotEmpty) ...[
            SliverToBoxAdapter(child: SectionHeader(s('product.completeTheLook'))),
            SliverToBoxAdapter(child: ProductRail(items: p.list('completeTheLook'), cardWidth: 140)),
          ],
          if (p.list('pairsWellWith').isNotEmpty) ...[
            SliverToBoxAdapter(child: SectionHeader(s('product.pairsWellWith'))),
            SliverToBoxAdapter(child: ProductRail(items: p.list('pairsWellWith'), cardWidth: 140)),
          ],
          SliverToBoxAdapter(child: SizedBox(height: 132 + context.safe.bottom)),
        ]),
        // Floating chrome over the photo.
        Positioned(
          top: context.safe.top + SwSpace.s2,
          left: SwSpace.s3,
          right: SwSpace.s3,
          child: Row(children: [
            const _Back(),
            const Spacer(),
            SwIconButton(icon: Ic.share2, filled: true, semanticLabel: s('common.share'), onPressed: () => Clipboard.setData(ClipboardData(text: 'https://smartwear.co.tz/p/${p.str('slug')}'))),
            SwIconButton(
              icon: Ic.heart,
              activeIcon: Ic.heart,
              active: wished,
              filled: true,
              haptic: true,
              semanticLabel: s('wishlist.add'),
              onPressed: () => toggleWishlist(context, ref, p.str('id')),
            ),
          ]),
        ),
        // Sticky add-to-bag bar.
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: ClipRect(
            child: BackdropFilter(
              filter: ui.ImageFilter.blur(sigmaX: 16, sigmaY: 16),
              child: Container(
                padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s3, SwSpace.s5, SwSpace.s3 + context.safe.bottom),
                decoration: BoxDecoration(color: c.surface.withValues(alpha: 0.92), border: Border(top: BorderSide(color: c.hairline))),
                child: Row(children: [
                  _QtyStepper(qty: _qty, onChanged: (q) => setState(() => _qty = q)),
                  const SizedBox(width: SwSpace.s3),
                  Expanded(
                    child: KeyedSubtree(
                      key: _bagKey,
                      child: SwButton(
                        label: p.flag('inStock') ? s('product.addToBag') : s('product.outOfStock'),
                        icon: Ic.shoppingBag,
                        large: true,
                        expand: true,
                        onPressed: p.flag('inStock') ? _addToBag : null,
                      ),
                    ),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ]),
    );
  }

  void _sizeGuide(BuildContext context, Json chart) {
    showSwSheet<void>(context, title: ref.s('product.sizeGuide'), builder: (ctx) => SizeGuide(chart: chart));
  }
}

String htmlToText(String html) => html
    .replaceAll(RegExp(r'<br\s*/?>|</p>|</li>', caseSensitive: false), '\n')
    .replaceAll(RegExp(r'<li[^>]*>', caseSensitive: false), '· ')
    .replaceAll(RegExp(r'<[^>]+>'), '')
    .replaceAll('&amp;', '&')
    .replaceAll('&nbsp;', ' ')
    .replaceAll(RegExp(r'\n{3,}'), '\n\n')
    .trim();

class _Back extends ConsumerWidget {
  const _Back();
  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      SwIconButton(icon: Ic.arrowLeft, filled: true, semanticLabel: ref.s('common.back'), onPressed: () => context.canPop() ? context.pop() : context.go('/'));
}

class _OptionLabel extends StatelessWidget {
  const _OptionLabel({required this.label, required this.value});
  final String label;
  final String? value;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: SwSpace.s1),
      child: Text.rich(TextSpan(children: [
        TextSpan(text: caps(label), style: context.type.label.copyWith(color: context.sw.muted)),
        if (value != null) TextSpan(text: '   $value', style: context.type.titleS),
      ])),
    );
  }
}

/* ------------------------------------------------------------------ gallery */
class _Gallery extends StatefulWidget {
  const _Gallery({required this.media, required this.heroTag, required this.width});
  final List<Json> media;
  final String heroTag;
  final double width;
  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  final _page = PageController();
  int _i = 0;

  @override
  void didUpdateWidget(_Gallery old) {
    super.didUpdateWidget(old);
    if (old.media.firstOrNull?['id'] != widget.media.firstOrNull?['id'] && _page.hasClients) {
      _page.jumpToPage(0);
      _i = 0;
    }
  }

  @override
  void dispose() {
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final h = widget.width * 5 / 4;
    final m = widget.media;
    return SizedBox(
      height: h,
      child: Stack(children: [
        PageView.builder(
          controller: _page,
          itemCount: m.isEmpty ? 1 : m.length,
          onPageChanged: (i) => setState(() => _i = i),
          itemBuilder: (context, i) {
            final img = SwImage(m.isEmpty ? null : m[i], aspectRatio: null, radius: 0);
            return GestureDetector(
              onTap: m.isEmpty ? null : () => _openZoom(context, i),
              child: i == 0 ? Hero(tag: widget.heroTag, child: img) : img,
            );
          },
        ),
        if (m.length > 1)
          Positioned(
            left: SwSpace.s5,
            right: SwSpace.s5,
            bottom: SwSpace.s4,
            child: Row(children: [
              for (var i = 0; i < m.length; i++)
                Expanded(child: AnimatedContainer(duration: SwMotion.base, height: 2, margin: const EdgeInsets.symmetric(horizontal: 2), color: SwColors.dark.ink.withValues(alpha: i == _i ? 0.95 : 0.35))),
            ]),
          ),
      ]),
    );
  }

  void _openZoom(BuildContext context, int start) {
    Navigator.of(context, rootNavigator: true).push(PageRouteBuilder(
      opaque: false,
      barrierColor: SwColors.dark.canvas,
      pageBuilder: (_, _, _) => _ZoomViewer(media: widget.media, start: start),
      transitionsBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: child),
    ));
  }
}

/// Pinch and double-tap zoom on the full-resolution rendition.
class _ZoomViewer extends StatefulWidget {
  const _ZoomViewer({required this.media, required this.start});
  final List<Json> media;
  final int start;
  @override
  State<_ZoomViewer> createState() => _ZoomViewerState();
}

class _ZoomViewerState extends State<_ZoomViewer> {
  late final _page = PageController(initialPage: widget.start);
  final _ctrl = <int, TransformationController>{};

  @override
  void dispose() {
    _page.dispose();
    for (final c in _ctrl.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: SwColors.dark.canvas,
      body: Stack(children: [
        PageView.builder(
          controller: _page,
          itemCount: widget.media.length,
          itemBuilder: (context, i) {
            final c = _ctrl.putIfAbsent(i, TransformationController.new);
            return GestureDetector(
              onDoubleTapDown: (d) {
                final zoomed = c.value.getMaxScaleOnAxis() > 1.01;
                final p = d.localPosition;
                c.value = zoomed ? Matrix4.identity() : (Matrix4.identity()..translateByDouble(-p.dx, -p.dy, 0, 1)..scaleByDouble(2.4, 2.4, 1, 1));
              },
              onDoubleTap: () {},
              child: InteractiveViewer(transformationController: c, minScale: 1, maxScale: 4, child: Center(child: SwImage(widget.media[i], radius: 0, fit: BoxFit.contain))),
            );
          },
        ),
        Positioned(top: context.safe.top + SwSpace.s2, right: SwSpace.s3, child: SwIconButton(icon: Ic.x, color: SwColors.dark.ink, semanticLabel: 'Close', onPressed: () => Navigator.of(context).pop())),
      ]),
    );
  }
}

/* ------------------------------------------------------------------ designer's note (audio) */
/// Plays the pipeline's AAC rendition with its waveform peaks; progress fills the bars.
class DesignerNote extends StatefulWidget {
  const DesignerNote({super.key, required this.media, required this.title});
  final Json media;
  final String title;
  @override
  State<DesignerNote> createState() => _DesignerNoteState();
}

class _DesignerNoteState extends State<DesignerNote> {
  AudioPlayer? _player;
  StreamSubscription<Duration>? _pos;
  double _progress = 0;
  bool _playing = false, _loading = false;

  @override
  void dispose() {
    _pos?.cancel();
    _player?.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_player == null) {
      setState(() => _loading = true);
      final p = AudioPlayer();
      _player = p;
      await p.setUrl(widget.media.str('url'));
      _pos = p.positionStream.listen((d) {
        final total = p.duration?.inMilliseconds ?? widget.media.integer('durationMs', 1);
        setState(() => _progress = (d.inMilliseconds / total).clamp(0, 1));
      });
      p.playerStateStream.listen((s) {
        if (s.processingState == ProcessingState.completed) {
          p.seek(Duration.zero);
          p.pause();
        }
        if (mounted) setState(() => _playing = s.playing && s.processingState != ProcessingState.completed);
      });
      setState(() => _loading = false);
    }
    _playing ? await _player!.pause() : await _player!.play();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final peaks = ((widget.media['waveform'] as List?) ?? const []).map((e) => (e as num).toDouble()).toList();
    final secs = (widget.media.integer('durationMs') / 1000).round();
    return Container(
      padding: const EdgeInsets.all(SwSpace.s4),
      decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(SwRadius.md)),
      child: Row(children: [
        GestureDetector(
          onTap: _loading ? null : _toggle,
          child: Semantics(
            button: true,
            label: _playing ? 'Pause ${widget.title}' : 'Play ${widget.title}',
            child: Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(color: c.ink, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: PendingSwap(pending: _loading, color: c.onInk, child: Icon(_playing ? Ic.pause : Ic.play, size: 20, color: c.onInk)),
            ),
          ),
        ),
        const SizedBox(width: SwSpace.s4),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(widget.title, style: context.type.titleS),
            const SizedBox(height: SwSpace.s2),
            SizedBox(height: 28, child: CustomPaint(size: Size.infinite, painter: _WavePainter(peaks, _progress, c.ink, c.ink.withValues(alpha: 0.25)))),
          ]),
        ),
        const SizedBox(width: SwSpace.s3),
        Text('${secs ~/ 60}:${(secs % 60).toString().padLeft(2, '0')}', style: context.type.caption.copyWith(color: c.muted, fontFeatures: const [ui.FontFeature.tabularFigures()])),
      ]),
    );
  }
}

class _WavePainter extends CustomPainter {
  _WavePainter(this.peaks, this.progress, this.on, this.off);
  final List<double> peaks;
  final double progress;
  final Color on, off;
  @override
  void paint(Canvas canvas, Size s) {
    final n = peaks.isEmpty ? 48 : peaks.length;
    final w = s.width / n;
    for (var i = 0; i < n; i++) {
      final v = peaks.isEmpty ? 0.3 : peaks[i].clamp(0.08, 1.0);
      final h = s.height * v;
      final paint = Paint()
        ..color = i / n <= progress ? on : off
        ..strokeCap = StrokeCap.round
        ..strokeWidth = (w * 0.55).clamp(1.5, 3);
      final x = i * w + w / 2;
      canvas.drawLine(Offset(x, (s.height - h) / 2), Offset(x, (s.height + h) / 2), paint);
    }
  }

  @override
  bool shouldRepaint(_WavePainter o) => o.progress != progress || o.on != on;
}

/* ------------------------------------------------------------------ details */
class _Accordion extends StatefulWidget {
  const _Accordion({required this.title, required this.child, this.initiallyOpen = false});
  final String title;
  final Widget child;
  final bool initiallyOpen;
  @override
  State<_Accordion> createState() => _AccordionState();
}

class _AccordionState extends State<_Accordion> {
  late bool _open = widget.initiallyOpen;
  @override
  Widget build(BuildContext context) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Semantics(
        button: true,
        expanded: _open,
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => setState(() => _open = !_open),
          child: SizedBox(
            height: 56,
            child: Row(children: [
              Expanded(child: Text(widget.title, style: context.type.titleM)),
              AnimatedRotation(turns: _open ? 0.5 : 0, duration: SwMotion.base, child: Icon(Ic.chevronDown, size: 18, color: context.sw.ink)),
            ]),
          ),
        ),
      ),
      AnimatedSize(
        duration: SwMotion.base,
        curve: SwMotion.atelier,
        alignment: Alignment.topCenter,
        child: _open ? Padding(padding: const EdgeInsets.only(bottom: SwSpace.s5), child: widget.child) : const SizedBox(width: double.infinity),
      ),
      const Hairline(),
    ]);
  }
}

class _Facts extends StatelessWidget {
  const _Facts({required this.p});
  final Json p;
  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      ('Composition', p.str('materials')),
      if (p.str('countryOfOrigin').isNotEmpty) ('Made in', p.str('countryOfOrigin')),
      for (final e in (p.obj('attributes') ?? const {}).entries) (e.key, '${e.value}'),
    ];
    return Column(children: [
      for (final (k, v) in rows)
        Padding(
          padding: const EdgeInsets.symmetric(vertical: SwSpace.s1_5),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            SizedBox(width: 120, child: Text(k, style: context.type.bodyS.copyWith(color: context.sw.muted))),
            Expanded(child: Text(v, style: context.type.bodyS)),
          ]),
        ),
    ]);
  }
}

class _Beauty extends ConsumerWidget {
  const _Beauty({required this.b});
  final Json b;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
        if (b.flag('crueltyFree')) SwChip(ref.s('product.crueltyFree'), tone: ChipTone.blush, icon: Ic.heartHandshake),
        if (b.flag('vegan')) SwChip(ref.s('product.vegan'), tone: ChipTone.success, icon: Ic.leaf),
        if (b.strN('volume') != null) SwChip(b.str('volume')),
        if (b.intN('paoMonths') != null) SwChip('${b.integer('paoMonths')}M PAO'),
      ]),
      const SizedBox(height: SwSpace.s3),
      Text(b.str('ingredients'), style: context.type.bodyS.copyWith(color: context.sw.muted)),
    ]);
  }
}

class SizeGuide extends StatelessWidget {
  const SizeGuide({super.key, required this.chart});
  final Json chart;
  @override
  Widget build(BuildContext context) {
    final cols = (chart['columns'] as List? ?? const []).map((e) => '$e').toList();
    final c = context.sw;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s2, SwSpace.s5, SwSpace.s8 + context.safe.bottom),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('${chart.str('name')} · ${chart.str('unit')}', style: context.type.bodyS.copyWith(color: c.muted)),
        const SizedBox(height: SwSpace.s4),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            headingRowHeight: 40,
            dataRowMinHeight: 44,
            dataRowMaxHeight: 44,
            horizontalMargin: 0,
            columnSpacing: SwSpace.s6,
            dividerThickness: 1,
            headingTextStyle: context.type.labelS.copyWith(color: c.muted),
            dataTextStyle: context.type.bodyS,
            columns: [const DataColumn(label: Text('SIZE')), for (final col in cols) DataColumn(label: Text(col.toUpperCase()))],
            rows: [
              for (final r in chart.list('rows'))
                DataRow(cells: [DataCell(Text(r.str('label'), style: context.type.titleS)), for (final v in (r['values'] as List)) DataCell(Text('$v'))]),
            ],
          ),
        ),
        if (chart.str('note').isNotEmpty) Padding(padding: const EdgeInsets.only(top: SwSpace.s4), child: Text(chart.str('note'), style: context.type.caption.copyWith(color: c.muted))),
      ]),
    );
  }
}

class _QtyStepper extends StatelessWidget {
  const _QtyStepper({required this.qty, required this.onChanged});
  final int qty;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Container(
      height: 52,
      decoration: BoxDecoration(border: Border.all(color: c.hairline), borderRadius: BorderRadius.circular(SwRadius.sm)),
      child: Row(children: [
        SwIconButton(icon: Ic.minus, semanticLabel: 'Decrease quantity', size: 40, onPressed: qty > 1 ? () => onChanged(qty - 1) : null),
        SizedBox(width: 24, child: Text('$qty', textAlign: TextAlign.center, style: context.type.titleM)),
        SwIconButton(icon: Ic.plus, semanticLabel: 'Increase quantity', size: 40, onPressed: () => onChanged(qty + 1)),
      ]),
    );
  }
}

class _ProductSkeleton extends StatelessWidget {
  const _ProductSkeleton();
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ListView(padding: EdgeInsets.zero, children: const [
        Skeleton(aspectRatio: 4 / 5, radius: 0),
        Padding(
          padding: EdgeInsets.all(SwSpace.s5),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Skeleton(width: 90, height: 12),
            SizedBox(height: SwSpace.s3),
            Skeleton(width: 260, height: 32),
            SizedBox(height: SwSpace.s4),
            Skeleton(width: 120, height: 22),
          ]),
        ),
      ]),
    );
  }
}
