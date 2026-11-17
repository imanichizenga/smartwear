import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:video_player/video_player.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../home/home_screen.dart' show ProductRail;
import '../shared/nav.dart';

/* ------------------------------------------------------------------ feed */

class LooksFeed {
  const LooksFeed({this.items = const [], this.nextCursor, this.loadingMore = false});
  final List<Json> items;
  final String? nextCursor;
  final bool loadingMore;
  bool get hasMore => nextCursor != null;
}

/// Looks feed with cursor paging. Looks without media are dropped (the server only sends ready media).
final looksFeedProvider = AsyncNotifierProvider<LooksFeedNotifier, LooksFeed>(LooksFeedNotifier.new);

class LooksFeedNotifier extends AsyncNotifier<LooksFeed> {
  static List<Json> _usable(List<Json> items) => [for (final l in items) if (l.obj('media') != null && l.obj('media')!.str('type').isNotEmpty) l];

  @override
  Future<LooksFeed> build() async {
    final r = await ref.read(apiProvider).get<Json>('/looks');
    return LooksFeed(items: _usable(r.list('items')), nextCursor: r.strN('nextCursor'));
  }

  Future<void> loadMore() async {
    final cur = state.value;
    if (cur == null || !cur.hasMore || cur.loadingMore) return;
    state = AsyncData(LooksFeed(items: cur.items, nextCursor: cur.nextCursor, loadingMore: true));
    try {
      final r = await ref.read(apiProvider).get<Json>('/looks', query: {'cursor': cur.nextCursor});
      state = AsyncData(LooksFeed(items: [...cur.items, ..._usable(r.list('items'))], nextCursor: r.strN('nextCursor')));
    } on ApiException {
      state = AsyncData(LooksFeed(items: cur.items, nextCursor: cur.nextCursor));
    }
  }
}

/// Muted by default; one switch for the whole feed.
final ValueNotifier<bool> _muted = ValueNotifier(true);

/* ------------------------------------------------------------------ screen */

/// Full-screen, vertically swiped Looks. Double-tap to like (heart burst); tags open the products.
/// Only the visible page plays video; everything pauses when the tab or the app goes to the background.
class DiscoverScreen extends ConsumerStatefulWidget {
  const DiscoverScreen({super.key});
  @override
  ConsumerState<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends ConsumerState<DiscoverScreen> {
  final _pages = PageController();
  late final AppLifecycleListener _life;
  int _index = 0;
  bool _foreground = true;
  bool _jumped = false;

  @override
  void initState() {
    super.initState();
    _life = AppLifecycleListener(
      onResume: () => setState(() => _foreground = true),
      onInactive: () => setState(() => _foreground = false),
      onHide: () => setState(() => _foreground = false),
    );
  }

  @override
  void dispose() {
    _life.dispose();
    _pages.dispose();
    super.dispose();
  }

  void _onPage(int i, LooksFeed feed) {
    setState(() => _index = i);
    if (i >= feed.items.length - 3) ref.read(looksFeedProvider.notifier).loadMore();
    _precache(feed, i + 1);
  }

  /// Warm the next look's still image so swiping never shows a blank frame.
  void _precache(LooksFeed feed, int i) {
    if (i < 0 || i >= feed.items.length) return;
    final m = feed.items[i].obj('media');
    if (m == null) return;
    final size = MediaQuery.sizeOf(context);
    final url = stillUrl(m, size.width * MediaQuery.devicePixelRatioOf(context));
    if (url != null && url.isNotEmpty) precacheImage(swImageProvider(url), context).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    // Discover follows the shopper's theme like every tab; only the text and controls drawn over a look's
    // photo/video stay light-on-dark (on their own gradient scrim) so they read on any media.
    final c = context.sw;
    final looks = ref.watch(looksFeedProvider);
    // The tab shell keeps Discover alive offstage with tickers disabled: that's our "tab not visible" signal.
    final visible = TickerMode.of(context) && _foreground;
    return Scaffold(
      backgroundColor: c.canvas,
      body: looks.when(
        skipLoadingOnRefresh: true,
        skipLoadingOnReload: true,
        loading: () => const _DiscoverSkeleton(),
        error: (e, _) => Center(child: LoadError(error: e, onRetry: () => ref.invalidate(looksFeedProvider))),
        data: (feed) {
          if (feed.items.isEmpty) {
            return RefreshIndicator(
              color: c.ink,
              backgroundColor: c.surface,
              onRefresh: () => ref.refresh(looksFeedProvider.future),
              child: LayoutBuilder(builder: (context, box) => SingleChildScrollView(physics: const AlwaysScrollableScrollPhysics(), child: SizedBox(height: box.maxHeight, child: Center(child: EmptyState(title: ref.s('looks.empty'), icon: Ic.compass))))),
            );
          }
          // Deep link: /discover?look=<id> opens that look.
          final want = GoRouterState.of(context).uri.queryParameters['look'];
          if (want != null && !_jumped) {
            _jumped = true;
            final i = feed.items.indexWhere((l) => l.str('id') == want);
            if (i > 0) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (_pages.hasClients) _pages.jumpToPage(i);
              });
            }
          }
          final count = feed.items.length + 1; // + end-of-feed page
          return RefreshIndicator(
            color: c.ink,
            backgroundColor: c.surface,
            onRefresh: () async {
              await ref.refresh(looksFeedProvider.future);
              if (_pages.hasClients) _pages.jumpToPage(0);
            },
            child: PageView.builder(
              controller: _pages,
              scrollDirection: Axis.vertical,
              // Builds the neighbouring look too: its video initialises (paused, buffering) so a swipe starts at once.
              allowImplicitScrolling: true,
              itemCount: count,
              onPageChanged: (i) => _onPage(i, feed),
              itemBuilder: (context, i) => i == feed.items.length
                  ? _EndOfFeed(loading: feed.loadingMore || feed.hasMore, onTop: () => _pages.animateToPage(0, duration: SwMotion.slow, curve: SwMotion.atelier))
                  : LookPage(key: ValueKey(feed.items[i].str('id')), look: feed.items[i], active: visible && i == _index),
            ),
          );
        },
      ),
    );
  }
}

/// Full-screen dark shimmer with the action column and caption/button placeholders where they really sit.
class _DiscoverSkeleton extends StatelessWidget {
  const _DiscoverSkeleton();
  @override
  Widget build(BuildContext context) {
    final bottom = context.bottomInset + SwSpace.s6;
    return Stack(fit: StackFit.expand, children: [
      const Skeleton.expand(),
      Positioned(
        right: SwSpace.s3,
        bottom: bottom,
        child: const Column(children: [
          SkeletonAvatar(size: 44),
          SizedBox(height: SwSpace.s5),
          SkeletonAvatar(size: 44),
          SizedBox(height: SwSpace.s5),
          SkeletonAvatar(size: 44),
        ]),
      ),
      Positioned(
        left: SwSpace.s5,
        right: 88,
        bottom: bottom,
        child: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          SkeletonLine(width: 220, height: 22),
          SizedBox(height: SwSpace.s2),
          SkeletonLine(width: 150, height: 22),
          SizedBox(height: SwSpace.s4),
          SkeletonBox(width: 200, height: 48, radius: SwRadius.full),
        ]),
      ),
    ]);
  }
}

class _EndOfFeed extends ConsumerWidget {
  const _EndOfFeed({required this.loading, required this.onTop});
  final bool loading;
  final VoidCallback onTop;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    return Center(
      child: loading
          ? const ALoader(size: ALoaderSize.lg)
          : EmptyState(
              title: s('looks.end.title'),
              body: s('looks.end.body'),
              icon: Ic.sparkles,
              action: SwButton(label: s('looks.end.top'), icon: Ic.chevronUp, variant: SwButtonVariant.secondary, onPressed: onTop),
            ),
    );
  }
}

/* ------------------------------------------------------------------ one look */

class LookPage extends ConsumerStatefulWidget {
  const LookPage({super.key, required this.look, this.active = true});
  final Json look;

  /// On screen, tab visible, app in the foreground → may play.
  final bool active;
  @override
  ConsumerState<LookPage> createState() => _LookPageState();
}

class _LookPageState extends ConsumerState<LookPage> with SingleTickerProviderStateMixin {
  late bool _liked = widget.look.flag('liked');
  late bool _saved = widget.look.flag('saved');
  late int _likes = widget.look.integer('likes');
  late final AnimationController _burst = AnimationController(vsync: this, duration: const Duration(milliseconds: 700));
  VideoPlayerController? _video;
  bool _videoFailed = false;

  Json get _media => widget.look.obj('media') ?? const {};
  bool get _isVideo => _media.str('type') == 'VIDEO';

  /// Adaptive stream first (360p → 1080p as the network allows, light first frame), progressive MP4 as fallback.
  String? get _hlsUrl {
    final h = _media.strN('hlsUrl');
    return (h != null && h.isNotEmpty) ? h : null;
  }

  String? get _mp4Url {
    final u = _media.strN('url');
    return (u != null && u.isNotEmpty) ? u : null;
  }

  @override
  void initState() {
    super.initState();
    if (_isVideo) _initVideo();
  }

  Future<void> _initVideo() async {
    final hls = _hlsUrl, mp4 = _mp4Url;
    if (hls == null && mp4 == null) {
      setState(() => _videoFailed = true);
      return;
    }
    if (hls != null && await _open(hls, VideoFormat.hls)) return;
    if (!mounted) return;
    if (mp4 == null || !await _open(mp4, null)) {
      if (mounted) setState(() => _videoFailed = true);
    }
  }

  /// Opens one source; false when it can't be played (the caller falls back).
  Future<bool> _open(String url, VideoFormat? hint) async {
    final old = _video;
    old?.removeListener(_onVideo);
    await old?.dispose();
    final c = VideoPlayerController.networkUrl(Uri.parse(url), formatHint: hint, videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true));
    _video = c;
    c.addListener(_onVideo);
    try {
      await c.initialize();
      await c.setLooping(true);
      await c.setVolume(_muted.value ? 0 : 1);
      if (!mounted) return true;
      setState(() {});
      _sync();
      return true;
    } catch (_) {
      c.removeListener(_onVideo);
      if (identical(_video, c)) _video = null;
      await c.dispose();
      return false;
    }
  }

  void _onVideo() {
    final v = _video?.value;
    if (v == null || !mounted) return;
    if (v.hasError && !_videoFailed) setState(() => _videoFailed = true);
  }

  void _onMute() {
    _video?.setVolume(_muted.value ? 0 : 1);
    if (mounted) setState(() {});
  }

  /// Play only while active; pause otherwise.
  void _sync() {
    final c = _video;
    if (c == null || !c.value.isInitialized || _videoFailed) return;
    if (widget.active && !c.value.isPlaying) {
      c.play();
    } else if (!widget.active && c.value.isPlaying) {
      c.pause();
    }
  }

  @override
  void didUpdateWidget(LookPage old) {
    super.didUpdateWidget(old);
    if (old.active != widget.active) _sync();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _muted.removeListener(_onMute);
    _muted.addListener(_onMute);
  }

  @override
  void dispose() {
    _muted.removeListener(_onMute);
    _video?.removeListener(_onVideo);
    _video?.dispose();
    _burst.dispose();
    super.dispose();
  }

  Future<void> _react(String kind, {bool? force}) async {
    await requireSignIn(context, ref, () async {
      if (!mounted) return; // signed in on another page and this look was scrolled away
      final on = force ?? !(kind == 'like' ? _liked : _saved);
      setState(() {
        if (kind == 'like') {
          if (on != _liked) _likes += on ? 1 : -1;
          _liked = on;
        } else {
          _saved = on;
        }
      });
      HapticFeedback.lightImpact();
      try {
        await ref.read(apiProvider).post<Json>('/looks/${widget.look.str('id')}/react/$kind', {'on': on});
      } on ApiException {
        // Optimistic; the next feed load reconciles.
      }
    });
  }

  Future<void> _share() async {
    await Clipboard.setData(ClipboardData(text: 'https://smartwear.co.tz/looks/${widget.look.str('id')}'));
    HapticFeedback.selectionClick();
    if (mounted) showSwToast(context, ref.s('looks.linkCopied'), icon: Ic.share2);
  }

  @override
  Widget build(BuildContext context) {
    const on = SwColors.dark;
    final s = ref.s;
    final tags = widget.look.list('tags');
    final products = [for (final t in tags) if (t.obj('product') != null) t.obj('product')!];
    final v = _video;
    final playing = v != null && v.value.isInitialized && !_videoFailed;
    final buffering = _isVideo && !_videoFailed && widget.active && (v == null || !v.value.isInitialized || v.value.isBuffering);
    final bottom = context.bottomInset + SwSpace.s6;
    final top = context.safe.top + SwSpace.s4;
    return GestureDetector(
      onDoubleTap: () {
        if (!context.reduceMotion) _burst.forward(from: 0);
        _react('like', force: true);
      },
      child: Stack(fit: StackFit.expand, children: [
        // The still (image, or the video's poster / thumbhash) is always underneath: it shows while the video
        // buffers and stays if the video fails or has no source.
        SwImage(widget.look.obj('media'), aspectRatio: null, radius: 0, dark: context.isDark),
        if (playing)
          FittedBox(
            fit: BoxFit.cover,
            clipBehavior: Clip.hardEdge,
            child: SizedBox(width: v.value.size.width, height: v.value.size.height, child: VideoPlayer(v)),
          ),
        DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, stops: const [0, 0.25, 0.6, 1], colors: [on.canvas.withValues(alpha: 0.35), on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0), on.canvas.withValues(alpha: 0.75)]))),
        // Product tag pins at their x/y, clamped so they never sit off-screen or under the bars.
        LayoutBuilder(builder: (context, box) {
          // Keep pins clear of the action column (right), the top bar and the caption area (bottom).
          double clampTo(double v, double lo, double hi) => v < lo ? lo : (v > (hi < lo ? lo : hi) ? (hi < lo ? lo : hi) : v);
          double clampX(double x) => clampTo(x * box.maxWidth - 22, SwSpace.s2, box.maxWidth - 44 - 72);
          double clampY(double y) => clampTo(y * box.maxHeight - 22, top + 48, box.maxHeight - bottom - 140);
          return Stack(children: [
            for (final t in tags)
              if (t.obj('product') != null)
                Positioned(
                  left: clampX(t.dbl('x', 0.5)),
                  top: clampY(t.dbl('y', 0.5)),
                  child: Semantics(
                    button: true,
                    label: t.obj('product')!.str('title'),
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () => openProduct(context, ref, t.obj('product')!),
                      child: SizedBox(
                        width: 44,
                        height: 44,
                        child: Center(child: Container(width: 28, height: 28, decoration: BoxDecoration(shape: BoxShape.circle, color: on.ink.withValues(alpha: 0.9), border: Border.all(color: on.canvas.withValues(alpha: 0.2), width: 6)))),
                      ),
                    ),
                  ),
                ),
          ]);
        }),
        Center(
          child: AnimatedBuilder(
            animation: _burst,
            builder: (_, _) {
              final t = _burst.value;
              if (t == 0 || t == 1) return const SizedBox.shrink();
              return Opacity(opacity: (1 - t).clamp(0, 1), child: Transform.scale(scale: 0.6 + t * 0.9, child: HeartIcon(filled: true, size: 96, color: on.ink)));
            },
          ),
        ),
        if (buffering) Positioned(top: top, left: 0, right: 0, child: const Center(child: ALoader(size: ALoaderSize.xs))),
        if (_isVideo && playing)
          Positioned(
            top: top - SwSpace.s2,
            right: SwSpace.s3,
            child: ValueListenableBuilder<bool>(
              valueListenable: _muted,
              builder: (context, muted, _) => _ScrimButton(
                child: SwIconButton(icon: muted ? Ic.volumeX : Ic.volume2, color: on.ink, size: 48, semanticLabel: muted ? s('looks.unmute') : s('looks.mute'), onPressed: () => _muted.value = !muted),
              ),
            ),
          ),
        // Actions: fixed 48×48 targets on a soft scrim so they read on light and dark media.
        Positioned(
          right: SwSpace.s2,
          bottom: bottom,
          child: _ScrimButton(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              _Action(icon: HeartIcon(filled: _liked, color: on.ink, size: 26), label: '$_likes', semantic: _liked ? s('looks.liked') : s('looks.like'), onTap: () => _react('like')),
              _Action(icon: Icon(_saved ? Ic.bookmarkCheck : Ic.bookmark, color: on.ink, size: 26), label: _saved ? s('looks.saved') : s('looks.save'), onTap: () => _react('save')),
              _Action(icon: Icon(Ic.share2, color: on.ink, size: 26), label: s('common.share'), onTap: _share),
            ]),
          ),
        ),
        Positioned(
          left: SwSpace.s5,
          right: 88,
          bottom: bottom,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            if (widget.look.strN('caption') != null) Text(widget.look.str('caption'), style: context.type.displayS.copyWith(color: on.ink), maxLines: 3, overflow: TextOverflow.ellipsis),
            if (widget.look.strN('credit') != null) Padding(padding: const EdgeInsets.only(top: SwSpace.s1), child: Text(widget.look.str('credit'), style: context.type.caption.copyWith(color: on.muted))),
            if (products.isNotEmpty) ...[
              const SizedBox(height: SwSpace.s4),
              SwButton(
                label: '${s('looks.shopThisLook')} · ${products.length}',
                icon: Ic.shoppingBag,
                variant: SwButtonVariant.premium,
                onPressed: () => showSwSheet<void>(context, title: s('looks.shopThisLook'), builder: (ctx) => Padding(padding: EdgeInsets.only(bottom: SwSpace.s6 + MediaQuery.paddingOf(ctx).bottom), child: ProductRail(items: products))),
              ),
            ],
          ]),
        ),
      ]),
    );
  }
}

class _ScrimButton extends StatelessWidget {
  const _ScrimButton({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.22), borderRadius: BorderRadius.circular(SwRadius.full)),
      child: Padding(padding: const EdgeInsets.symmetric(vertical: SwSpace.s1), child: child),
    );
  }
}

class _Action extends StatelessWidget {
  const _Action({required this.icon, required this.label, required this.onTap, this.semantic});
  final Widget icon;
  final String label;
  final String? semantic;
  final FutureOr<void> Function() onTap;
  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semantic ?? label,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: SizedBox(
          width: 56,
          height: 68,
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            SizedBox(width: 48, height: 40, child: Center(child: icon)),
            // Labels never wrap: they shrink to fit instead.
            SizedBox(width: 52, child: FittedBox(fit: BoxFit.scaleDown, child: Text(label, maxLines: 1, style: context.type.caption.copyWith(color: SwColors.dark.ink)))),
          ]),
        ),
      ),
    );
  }
}
