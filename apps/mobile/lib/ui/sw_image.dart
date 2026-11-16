import 'dart:convert';
import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:thumbhash/thumbhash.dart' as th;

import '../core/api.dart';
import '../design/theme.dart';
import 'kit.dart';

/// How network images are loaded. The app uses a memory + disk cache; tests swap in NetworkImage.
ImageProvider Function(String url) swImageProvider = (url) => CachedNetworkImageProvider(url);

final Map<String, ImageProvider> _thumbCache = {};
final Set<String> _badThumbs = {};

/// ThumbHash → tiny blurred placeholder image, decoded once. Bad base64 / corrupt hashes yield null.
ImageProvider? thumbhashImage(String? hash) {
  if (hash == null || hash.isEmpty || _badThumbs.contains(hash)) return null;
  final hit = _thumbCache[hash];
  if (hit != null) return hit;
  try {
    final img = th.thumbHashToRGBA(Uint8List.fromList(base64.decode(base64.normalize(hash))));
    return _thumbCache[hash] = MemoryImage(th.rgbaToBmp(img));
  } catch (_) {
    _badThumbs.add(hash);
    return null;
  }
}

/// Pick the smallest rendition at least as wide as the box (in physical pixels). WebP first —
/// Flutter decodes it natively on both platforms; JPEG as the fallback.
String? pickSource(Json media, double physicalWidth) {
  final sources = media.obj('sources');
  final list = <Json>[...?sources?.list('webp')];
  if (list.isEmpty) list.addAll(sources?.list('jpeg') ?? const []);
  if (list.isEmpty) return media.strN('url');
  list.sort((a, b) => a.integer('width').compareTo(b.integer('width')));
  return (list.firstWhere((s) => s.integer('width') >= physicalWidth, orElse: () => list.last)).str('url');
}

/// Media the pipeline hasn't finished yet (show a shimmer, not a fallback).
bool mediaPending(Json m) => const {'UPLOADING', 'UPLOADED', 'PROCESSING'}.contains(m.strN('status'));

/// The still image to show for any media: the right image rendition, or a video's poster.
String? stillUrl(Json m, double physicalWidth) => switch (m.str('type')) {
      'IMAGE' => pickSource(m, physicalWidth),
      'VIDEO' => m.strN('posterUrl'),
      _ => null,
    };

/// A pipeline image: ThumbHash blur-up immediately, then the right-sized rendition fades in.
/// Videos show their poster. While media is still processing: the shared shimmer. Genuinely missing or
/// failed media: a neutral branded surface — never a grey box with an image icon.
/// Product imagery is 4:5 by default and is never overlaid with burned-in text.
class SwImage extends StatelessWidget {
  const SwImage(this.media, {super.key, this.aspectRatio = 4 / 5, this.radius = SwRadius.xs, this.fit = BoxFit.cover, this.semanticLabel, this.dark = false});

  final Json? media;
  final double? aspectRatio;
  final double radius;
  final BoxFit fit;
  final String? semanticLabel;

  /// Placeholders tuned for dark full-bleed surfaces (Discover, Welcome).
  final bool dark;

  @override
  Widget build(BuildContext context) {
    final m = media;
    Widget child = LayoutBuilder(builder: (context, box) {
      if (m == null) return MediaFallback(dark: dark);
      final dpr = MediaQuery.devicePixelRatioOf(context);
      final logicalW = box.hasBoundedWidth ? box.maxWidth : 400.0;
      final w = logicalW * dpr;
      final url = stillUrl(m, w);
      final blur = thumbhashImage(m.strN('thumbhash'));
      if (url == null || url.isEmpty) {
        if (mediaPending(m)) return Skeleton.expand(dark: dark);
        return blur != null ? Image(image: blur, fit: BoxFit.cover, width: double.infinity, height: double.infinity) : MediaFallback(dark: dark);
      }
      final focal = Alignment(m.dbl('focalX', 0.5) * 2 - 1, m.dbl('focalY', 0.5) * 2 - 1);
      // Decode at the size it is drawn, so long grids don't hold full-size bitmaps (OOM on low-end phones).
      final cacheW = w.isFinite && w > 0 ? w.round() : null;
      final Widget placeholder = blur == null ? Skeleton.expand(dark: dark) : const SizedBox.expand();
      return DecoratedBox(
        decoration: BoxDecoration(
          color: _hex(m.strN('dominantColor')) ?? (dark ? const Color(0xFF1C1A18) : context.sw.hairline),
          image: blur == null ? null : DecorationImage(image: blur, fit: BoxFit.cover),
        ),
        child: Image(
          image: cacheW == null ? swImageProvider(url) : ResizeImage.resizeIfNeeded(cacheW, null, swImageProvider(url)),
          fit: fit,
          alignment: focal,
          width: double.infinity,
          height: double.infinity,
          gaplessPlayback: true,
          semanticLabel: semanticLabel ?? m.strN('alt'),
          frameBuilder: (context, child, frame, sync) {
            if (sync) return child;
            return Stack(fit: StackFit.expand, children: [
              if (frame == null) placeholder,
              AnimatedOpacity(opacity: frame == null ? 0 : 1, duration: SwMotion.base, curve: SwMotion.atelier, child: child),
            ]);
          },
          errorBuilder: (context, error, stack) => MediaFallback(dark: dark),
        ),
      );
    });
    if (radius > 0) child = ClipRRect(borderRadius: BorderRadius.circular(radius), child: child);
    return aspectRatio == null ? child : AspectRatio(aspectRatio: aspectRatio!, child: child);
  }

  static Color? _hex(String? h) {
    if (h == null || h.length != 7) return null;
    return Color(int.parse('FF${h.substring(1)}', radix: 16));
  }
}
