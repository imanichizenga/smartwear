// Renders every customer screen from REAL API fixtures (tool/capture_fixtures.py) with the real
// fonts and photos, at iPhone size, light and dark → docs/screenshots/mobile/*.png.
//
// Run (see tool/run_tests.sh): compile with the frontend server, then run with flutter_tester.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:smartwear/app.dart';
import 'package:smartwear/core/api.dart';
import 'package:smartwear/core/geo.dart';
import 'package:smartwear/core/location.dart';
import 'package:smartwear/core/providers.dart';
import 'package:smartwear/l10n/strings.dart';
import 'package:smartwear/router.dart';
import 'package:smartwear/ui/sw_image.dart';

final _root = Directory.current.path; // apps/mobile
final _only = (Platform.environment['SHOTS'] ?? '').split(',').where((e) => e.isNotEmpty).toList();
final _out = Directory('$_root/../../docs/screenshots/mobile')..createSync(recursive: true);
Json _fx(String name) => Map<String, dynamic>.from(jsonDecode(File('$_root/test/fixtures/$name.json').readAsStringSync()) as Map);
final Map<String, String> _mediaIndex = Map<String, String>.from(jsonDecode(File('$_root/test/fixtures/media_index.json').readAsStringSync()) as Map);

/// Serves captured responses by path — the same JSON the live API returned.
class FixtureApi extends Api {
  FixtureApi(TokenStore t, {this.overrides = const {}}) : super(t, dio: Dio());
  final Map<String, Object Function()> overrides;

  static final _orders = {for (final n in ['track_searching', 'track_on_the_way', 'track_delivered', 'order_detail']) _fx(n)['id']: n};

  @override
  Future<T> get<T>(String path, {Map<String, dynamic>? query}) async {
    final q = query ?? const {};
    final o = overrides[path];
    if (o != null) return o() as T;
    final orderId = RegExp(r'^/me/orders/([0-9a-f-]{36})$').firstMatch(path)?.group(1);
    final Object body = switch (path) {
      _ when orderId != null && _orders[orderId] != null => _fx(_orders[orderId]!),
      '/rider/me' => _fx('rider_me_idle'),
      '/rider/history' || '/rider/earnings' => _fx('rider_history'),
      '/config/public' => _fx('config'),
      '/home' => _fx('home'),
      '/categories' => _fx('categories'),
      '/looks' => _fx('looks'),
      '/search/suggest' => _fx('suggest'),
      '/cart' => _fx('cart'),
      '/me' => _fx('me'),
      '/me/orders' => _fx('orders'),
      '/me/loyalty' => _fx('loyalty'),
      '/me/places' => _fx('places'),
      '/wishlist' => {'boards': <Object>[], 'productIds': [_fx('product_zuri')['id']]},
      '/products' => (q['q'] != null && '${q['q']}'.isNotEmpty) ? _fx('search_dress') : _fx('products_women'),
      '/products/velvet-matte-lipstick' => _fx('product_lipstick'),
      _ when path.startsWith('/products/') => _fx('product_zuri'),
      _ => <String, dynamic>{},
    };
    return body as T;
  }

  @override
  Future<T> post<T>(String path, [Object? body, Map<String, String>? headers]) async {
    final o = overrides['POST $path'];
    if (o != null) return o() as T;
    if (path == '/checkout/quote') return _fx('checkout_quote') as T;
    return <String, dynamic>{} as T;
  }
}

class _FixedLoc extends LocationService {
  _FixedLoc(this.fix);
  final LocFix fix;
  @override
  Stream<LocFix> fixes() => Stream.value(fix);
  @override
  Stream<LocFix> track({required String notificationTitle, required String notificationText}) => Stream.value(fix);
}

class _SignedIn extends SessionNotifier {
  _SignedIn(this.user);
  final Json? user;
  @override
  SessionState build() => SessionState(user: user, ready: true);
  @override
  Future<void> restore() async {}
}

ImageProvider _fixtureImage(String url) {
  final folder = (Uri.parse(url).path.split('/')..removeLast()).join('/');
  final f = _mediaIndex[folder];
  if (f != null) return FileImage(File('$_root/test/fixtures/media/$f'));
  return MemoryImage(base64Decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X6N2cAAAAASUVORK5CYII='));
}

Future<void> _loadFonts() async {
  Future<void> family(String name, List<String> files) async {
    final l = FontLoader(name);
    for (final f in files) {
      l.addFont(Future.value(ByteData.view(File('$_root/assets/fonts/$f').readAsBytesSync().buffer)));
    }
    await l.load();
  }

  await family('Fraunces', ['Fraunces-300.ttf', 'Fraunces-400.ttf', 'Fraunces-500.ttf', 'Fraunces-600.ttf', 'Fraunces-300-italic.ttf']);
  await family('Manrope', ['Manrope-400.ttf', 'Manrope-500.ttf', 'Manrope-600.ttf', 'Manrope-700.ttf']);
  await family('Lucide300', ['Lucide300.ttf']);
}

class Shot {
  const Shot(this.name, this.path, {this.signedIn = true, this.height = 844, this.scroll = 0, this.locale = 'en', this.after, this.overrides = const {}, this.rounds = 8, this.fix});
  final LocFix? fix;
  final Map<String, Object Function()> overrides;
  final int rounds;
  final String name, path;
  final bool signedIn;
  final double height;
  final double scroll;
  final String locale;
  final Future<void> Function(WidgetTester t)? after;
}

final shots = <Shot>[
  const Shot('01-welcome', '/welcome', signedIn: false),
  const Shot('02-phone', '/auth/phone', signedIn: false),
  const Shot('03-otp', '/auth/otp?phone=%2B255712345678', signedIn: false),
  const Shot('04-style-quiz', '/auth/quiz'),
  const Shot('10-home', '/'),
  const Shot('11-home-full', '/', height: 4200),
  const Shot('12-home-sw', '/', locale: 'sw'),
  const Shot('20-discover', '/discover'),
  const Shot('30-search', '/search'),
  const Shot('40-category-women', '/c/women?title=Women'),
  const Shot('50-product', '/p/zuri-linen-maxi-dress'),
  const Shot('51-product-full', '/p/zuri-linen-maxi-dress', height: 2600),
  const Shot('52-product-beauty', '/p/velvet-matte-lipstick', height: 1900),
  const Shot('60-bag', '/bag'),
  const Shot('70-profile', '/profile', height: 1300),
  const Shot('71-profile-guest', '/profile', signedIn: false),
  const Shot('80-checkout', '/checkout'),
  const Shot('81-checkout-full', '/checkout', height: 1500),
  const Shot('82-place-search', '/checkout', after: _openPlaces),
  const Shot('85-orders', '/orders'),
  const Shot('90-track-searching', '/orders/0ba88df8-8e15-4efc-8dab-2004964a992c/track'),
  const Shot('91-track-on-the-way', '/orders/8d8c66a8-36c1-4e04-af56-0939f5a07585/track'),
  const Shot('92-track-delivered', '/orders/a0900983-b389-4416-87ea-7aedc07199c1/track'),
  const Shot('95-rider-offline', '/rider'),
  Shot('96-rider-offer', '/rider', overrides: {'/rider/me': () => {..._fx('rider_me_idle'), 'rider': {...?_fx('rider_me_idle').obj('rider'), 'presence': 'ONLINE'}, 'pendingOffer': _fx('rider_offer')}}),
  Shot('97-rider-job', '/rider', overrides: {'/rider/me': () => _fx('rider_me_job')}, fix: const LocFix(LatLngD(-6.7738, 39.2302), heading: 75, precise: true)),
  const Shot('98-rider-earnings', '/rider/earnings'),
];

Future<void> _openPlaces(WidgetTester t) async {
  final f = find.bySemanticsLabel(RegExp('Deliver to|Change delivery', caseSensitive: false));
  if (f.evaluate().isNotEmpty) await t.tap(f.first, warnIfMissed: false);
}

Future<void> _settle(WidgetTester t, {int rounds = 8}) async {
  for (var i = 0; i < rounds; i++) {
    await t.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 120)));
    await t.pump(const Duration(milliseconds: 120));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  swImageProvider = _fixtureImage;

  setUpAll(_loadFonts);
  tearDownAll(() => Future<void>.delayed(const Duration(milliseconds: 100), () => exit(0)));

  for (final theme in [ThemeMode.light, ThemeMode.dark]) {
    for (final s in shots.where((s) => _only.isEmpty || _only.any(s.name.startsWith))) {
      testWidgets('${s.name} ${theme.name}', (t) async {
        t.view.physicalSize = Size(390 * 3, s.height * 3);
        t.view.devicePixelRatio = 3;
        t.view.padding = const FakeViewPadding(top: 47 * 3, bottom: 34 * 3);
        t.view.viewPadding = const FakeViewPadding(top: 47 * 3, bottom: 34 * 3);
        addTearDown(t.view.reset);
        SharedPreferences.setMockInitialValues({'sw.theme': theme.name, 'sw.welcomed': true});
        final prefs = await SharedPreferences.getInstance();
        final tokens = TokenStore();
        final me = _fx('me');
        final key = GlobalKey();
        final container = ProviderContainer(overrides: [
          prefsProvider.overrideWithValue(prefs),
          apiProvider.overrideWithValue(FixtureApi(tokens, overrides: s.overrides)),
          if (s.fix != null) locationServiceProvider.overrideWithValue(_FixedLoc(s.fix!)),
          sessionProvider.overrideWith(() => _SignedIn(s.signedIn ? (me.obj('user') ?? me) : null)),
        ]);
        container.read(localeProvider.notifier).set(s.locale);
        await t.pumpWidget(UncontrolledProviderScope(container: container, child: RepaintBoundary(key: key, child: const SmartWearApp())));
        await t.pump();
        container.read(routerProvider).go(s.path);
        await _settle(t);
        await s.after?.call(t);
        await _settle(t, rounds: 6);
        final boundary = t.renderObject<RenderRepaintBoundary>(find.byKey(key));
        await t.runAsync(() async {
          final ui.Image img = await boundary.toImage(pixelRatio: 2);
          final bytes = await img.toByteData(format: ui.ImageByteFormat.png);
          File('${_out.path}/${s.name}-${theme.name}.png').writeAsBytesSync(bytes!.buffer.asUint8List());
        });
        // Tear the tree down so repeating animations and timers stop before the test ends.
        await t.pumpWidget(const SizedBox());
        container.dispose();
        await t.pump(const Duration(seconds: 1));
      });
    }
  }
}
