import 'dart:convert';
import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:thumbhash/thumbhash.dart' as th;

import '../core/api.dart';
import '../design/theme.dart';
import 'icons.dart';

/// How network images are loaded. The app uses a memory + disk cache; tests swap in NetworkImage.
ImageProvider Function(String url) swImageProvider = (url) => CachedNetworkImageProvider(url);

final Map<String, ImageProvider> _thumbCache = {};

/// ThumbHash → tiny blurred placeholder image, decoded once.
ImageProvider? thumbhashImage(String? hash) {
  if (hash == null || hash.isEmpty) return null;
  return _thumbCache.putIfAbsent(hash, () {
    final img = th.thumbHashToRGBA(Uint8List.fromList(base64.decode(hash)));
    return MemoryImage(th.rgbaToBmp(img));
  });
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

/// A pipeline image: ThumbHash blur-up immediately, then the right-sized rendition fades in.
/// Product imagery is 4:5 by default and is never overlaid with burned-in text.
class SwImage extends StatelessWidget {
  const SwImage(this.media, {super.key, this.aspectRatio = 4 / 5, this.radius = SwRadius.xs, this.fit = BoxFit.cover, this.semanticLabel});

  final Json? media;
  final double? aspectRatio;
  final double radius;
  final BoxFit fit;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final m = media;
    Widget child = LayoutBuilder(builder: (context, box) {
      if (m == null || m.str('type') != 'IMAGE') {
        return ColoredBox(color: context.sw.hairline, child: Center(child: Icon(Ic.image, size: 20, color: context.sw.subtle)));
      }
      final dpr = MediaQuery.devicePixelRatioOf(context);
      final w = (box.hasBoundedWidth ? box.maxWidth : 400) * dpr;
      final url = pickSource(m, w);
      final blur = thumbhashImage(m.strN('thumbhash'));
      final focal = Alignment(m.dbl('focalX', 0.5) * 2 - 1, m.dbl('focalY', 0.5) * 2 - 1);
      return DecoratedBox(
        decoration: BoxDecoration(
          color: _hex(m.strN('dominantColor')) ?? context.sw.hairline,
          image: blur == null ? null : DecorationImage(image: blur, fit: BoxFit.cover),
        ),
        child: url == null
            ? const SizedBox.expand()
            : Image(
                image: swImageProvider(url),
                fit: fit,
                alignment: focal,
                width: double.infinity,
                height: double.infinity,
                gaplessPlayback: true,
                semanticLabel: semanticLabel ?? m.strN('alt'),
                frameBuilder: (context, child, frame, sync) => sync
                    ? child
                    : AnimatedOpacity(opacity: frame == null ? 0 : 1, duration: SwMotion.base, curve: SwMotion.atelier, child: child),
                errorBuilder: (context, error, stack) => const SizedBox.expand(),
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
