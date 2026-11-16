import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';

/* ------------------------------------------------------------------ device prefs */

/// SharedPreferences is opened once in main() and injected (tests inject an in-memory instance).
final prefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('prefsProvider must be overridden in main()'));

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);

class ThemeModeNotifier extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => switch (ref.read(prefsProvider).getString('sw.theme')) { 'light' => ThemeMode.light, 'dark' => ThemeMode.dark, _ => ThemeMode.system };
  void set(ThemeMode m) {
    state = m;
    ref.read(prefsProvider).setString('sw.theme', m.name);
  }
}

/* ------------------------------------------------------------------ public runtime config */

/// `GET /v1/config/public` — feature flags, branding, currency, checkout options, map style, min version.
/// Served from the last cached copy instantly, refreshed in the background.
final configProvider = AsyncNotifierProvider<ConfigNotifier, Json>(ConfigNotifier.new);

class ConfigNotifier extends AsyncNotifier<Json> {
  static const _key = 'sw.config';
  @override
  Future<Json> build() async {
    final prefs = ref.read(prefsProvider);
    final cached = prefs.getString(_key);
    final fresh = ref.read(apiProvider).get<Json>('/config/public').then((c) {
      prefs.setString(_key, jsonEncode(c));
      return c;
    });
    if (cached != null) {
      fresh.then((c) => state = AsyncData(c), onError: (_) {});
      try {
        return Map<String, dynamic>.from(jsonDecode(cached) as Map);
      } catch (_) {
        // Corrupt cache: fall through to the network copy.
      }
    }
    return fresh;
  }

  /// A fresher copy fetched elsewhere (e.g. checkout re-reads the location mode).
  void replace(Json c) {
    state = AsyncData(c);
    ref.read(prefsProvider).setString(_key, jsonEncode(c));
  }
}

extension ConfigX on Json {
  bool feature(String k) => obj('features')?[k] != false;
  String get currency => obj('localization')?.str('currency', 'TZS') ?? 'TZS';
}

/* ------------------------------------------------------------------ session */

/// SharedPreferences as a [KeyValueStore] — the token store mirrors the (non-secret) device id here.
class PrefsKv implements KeyValueStore {
  PrefsKv(this.prefs);
  final SharedPreferences prefs;
  @override
  Future<String?> read(String key) async => prefs.getString(key);
  @override
  Future<void> write(String key, String value) => prefs.setString(key, value);
  @override
  Future<void> delete(String key) => prefs.remove(key);
}

class SessionState {
  const SessionState({this.user, this.ready = false, bool? signedIn, this.endedBy}) : _signedIn = signedIn;
  final Json? user;
  final bool ready;
  final bool? _signedIn;

  /// Set when the server ended the session (admin block / revoke), so the UI can say why.
  final SignOutReason? endedBy;
  bool get signedIn => _signedIn ?? user != null;
  bool get isRider => user?['isRider'] == true || user?.obj('rider') != null;
}

final sessionProvider = NotifierProvider<SessionNotifier, SessionState>(SessionNotifier.new);

/// Sign-in persists until the user signs out or the server definitively ends the session. Restore never waits
/// for the network: a stored refresh token means "signed in" straight away (with the cached user), and `/me`
/// is revalidated in the background. Offline, timeouts and 5xx never sign anyone out.
class SessionNotifier extends Notifier<SessionState> {
  @override
  SessionState build() {
    final api = ref.read(apiProvider);
    api.onSignedOut = _ended;
    api.onRefreshed = (u) {
      if (state.signedIn) state = SessionState(user: u, ready: true);
    };
    return const SessionState();
  }

  Api get _api => ref.read(apiProvider);
  TokenStore get _tokens => ref.read(tokenStoreProvider);

  /// True from a successful sign-in until the auth screen has navigated on (quiz, Home or back to where the
  /// shopper started). The router's "signed-in users can't see auth screens" guard waits for it, so it can't
  /// race the screen's own navigation.
  bool completingSignIn = false;
  void finishSignIn() => completingSignIn = false;

  Future<void> restore() async {
    final tokens = _tokens;
    if (!tokens.loaded) await tokens.load();
    if (!tokens.signedIn) {
      state = const SessionState(ready: true);
      return;
    }
    state = SessionState(user: tokens.cachedUser, signedIn: true, ready: true);
    unawaited(revalidate());
  }

  /// Refresh the user from `/me`. Errors keep the current session; a real revocation arrives through
  /// [Api.onSignedOut] (the 401 → refresh → definitive failure path).
  Future<void> revalidate() async {
    if (!_tokens.signedIn) return;
    try {
      final me = await _api.get<Json>('/me');
      if (_tokens.signedIn) await _setUser(me.obj('user') ?? me);
    } on ApiException {
      // offline / server trouble: stay signed in with what we have
    }
  }

  Future<void> _setUser(Json user) async {
    await _tokens.saveUser(user);
    state = SessionState(user: user, ready: true);
  }

  void _ended(SignOutReason reason) {
    if (!state.signedIn) return;
    state = SessionState(ready: true, endedBy: reason);
    ref.invalidate(cartProvider);
    ref.invalidate(wishlistProvider);
  }

  /// Returns the API's `isNewUser` so the caller can offer the (skippable) style quiz.
  Future<bool> completeLogin(Json payload) async {
    final tokens = _tokens;
    await tokens.save(payload.str('accessToken'), payload.str('refreshToken'), sessionId: payload.strN('sessionId'));
    final user = payload.obj('user');
    if (user != null) await tokens.saveUser(user);
    state = SessionState(user: user, signedIn: true, ready: true);
    ref.invalidate(cartProvider);
    ref.invalidate(wishlistProvider);
    return payload.flag('isNewUser');
  }

  Future<void> requestOtp(String phone) => _api.post<Json>('/auth/otp/request', {'phone': phone});

  Future<bool> verifyOtp(String phone, String code) async {
    final device = await _tokens.ensureDeviceId();
    final r = await _api.post<Json>('/auth/otp/verify', {'phone': phone, 'code': code, 'deviceId': device, 'platform': _platform, 'appVersion': appVersion});
    completingSignIn = true;
    return completeLogin(r);
  }

  Future<bool> google(String idToken) async {
    final device = await _tokens.ensureDeviceId();
    final r = await _api.post<Json>('/auth/google', {'idToken': idToken, 'deviceId': device, 'platform': _platform, 'appVersion': appVersion});
    completingSignIn = true;
    return completeLogin(r);
  }

  Future<void> signOut() async {
    try {
      await _api.post<Json>('/auth/logout');
    } on ApiException {
      // Signing out locally must always work, even offline.
    }
    await _tokens.clear();
    state = const SessionState(ready: true);
    ref.invalidate(cartProvider);
    ref.invalidate(wishlistProvider);
  }

  void updateUser(Json user) {
    state = SessionState(user: user, ready: true);
    unawaited(_tokens.saveUser(user));
  }

  static String get _platform => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
}

/* ------------------------------------------------------------------ catalog */

final homeProvider = FutureProvider<Json>((ref) {
  ref.watch(sessionProvider.select((s) => s.user?['id']));
  return ref.read(apiProvider).get<Json>('/home');
});

final categoriesProvider = FutureProvider<List<Json>>((ref) async {
  final r = await ref.read(apiProvider).get<Json>('/categories');
  return r.list('items');
});

final looksProvider = FutureProvider<List<Json>>((ref) async => (await ref.read(apiProvider).get<Json>('/looks')).list('items'));

final productProvider = FutureProvider.family<Json, String>((ref, slug) => ref.read(apiProvider).get<Json>('/products/$slug'));

/// Query for product lists & search (category, q, filters, sort).
class ProductQuery {
  const ProductQuery({this.category, this.q, this.sort, this.filters = const {}, this.collection, this.brand});
  final String? category, q, sort, collection, brand;
  final Map<String, List<String>> filters;

  Map<String, dynamic> toQuery(String? cursor) => {
        'category': category,
        'q': q,
        'sort': sort,
        'collection': collection,
        'brand': brand,
        'cursor': cursor,
        'limit': 20,
        for (final e in filters.entries) e.key: e.value.join(','),
      };

  ProductQuery copyWith({String? q, String? sort, Map<String, List<String>>? filters}) =>
      ProductQuery(category: category, q: q ?? this.q, sort: sort ?? this.sort, filters: filters ?? this.filters, collection: collection, brand: brand);

  @override
  bool operator ==(Object o) => o is ProductQuery && o.category == category && o.q == q && o.sort == sort && o.collection == collection && o.brand == brand && jsonEncode(o.filters) == jsonEncode(filters);
  @override
  int get hashCode => Object.hash(category, q, sort, collection, brand, jsonEncode(filters));
}

class ProductPage {
  const ProductPage({this.items = const [], this.nextCursor, this.loadingMore = false, this.loadMoreFailed = false, this.total, this.facets});
  final List<Json> items;
  final String? nextCursor;
  final bool loadingMore;

  /// The last "next page" request failed (offline): the grid offers a retry instead of spinning forever.
  final bool loadMoreFailed;
  final int? total;
  final Json? facets;
}

final productListProvider = AsyncNotifierProvider.family<ProductListNotifier, ProductPage, ProductQuery>(ProductListNotifier.new);

class ProductListNotifier extends AsyncNotifier<ProductPage> {
  ProductListNotifier(this.query);
  final ProductQuery query;

  @override
  Future<ProductPage> build() async {
    final r = await ref.read(apiProvider).get<Json>('/products', query: query.toQuery(null));
    return ProductPage(items: r.list('items'), nextCursor: r.strN('nextCursor'), total: r.intN('total'), facets: r.obj('facets'));
  }

  /// Infinite scroll: append the next cursor page. After a failure only an explicit [retry] tries again,
  /// so scrolling while offline doesn't fire a request per scroll tick.
  Future<void> loadMore({bool retry = false}) async {
    final cur = state.value;
    if (cur == null || cur.nextCursor == null || cur.loadingMore || (cur.loadMoreFailed && !retry)) return;
    state = AsyncData(ProductPage(items: cur.items, nextCursor: cur.nextCursor, loadingMore: true, total: cur.total, facets: cur.facets));
    try {
      final r = await ref.read(apiProvider).get<Json>('/products', query: query.toQuery(cur.nextCursor));
      state = AsyncData(ProductPage(items: [...cur.items, ...r.list('items')], nextCursor: r.strN('nextCursor'), total: cur.total, facets: cur.facets));
    } on ApiException {
      state = AsyncData(ProductPage(items: cur.items, nextCursor: cur.nextCursor, loadMoreFailed: true, total: cur.total, facets: cur.facets));
    }
  }
}

/* ------------------------------------------------------------------ cart (server-priced) */

final cartProvider = AsyncNotifierProvider<CartNotifier, Json>(CartNotifier.new);

class CartNotifier extends AsyncNotifier<Json> {
  Api get _api => ref.read(apiProvider);

  @override
  Future<Json> build() async {
    if (!ref.watch(sessionProvider.select((s) => s.signedIn))) return const {'items': <Json>[], 'itemCount': 0};
    return _api.get<Json>('/cart');
  }

  int get count => state.value?.integer('itemCount') ?? 0;

  Future<void> add(String variantId, int qty) async {
    state = AsyncData(await _api.post<Json>('/cart/items', {'variantId': variantId, 'qty': qty}));
  }

  /// Latest request per line wins: a slow earlier response can never overwrite a newer quantity.
  final Map<int, int> _qtySeq = {};

  /// Optimistic quantity change; the server's re-priced cart (tiers, savings) replaces it.
  Future<void> setQty(int itemId, int qty) async {
    final seq = (_qtySeq[itemId] ?? 0) + 1;
    _qtySeq[itemId] = seq;
    final prev = state.value;
    if (prev != null) {
      state = AsyncData({
        ...prev,
        'items': [for (final i in prev.list('items')) if (i.integer('id') != itemId || qty > 0) (i.integer('id') == itemId ? {...i, 'qty': qty} : i)],
      });
    }
    try {
      final next = qty <= 0 ? await _api.delete<Json>('/cart/items/$itemId') : await _api.patch<Json>('/cart/items/$itemId', {'qty': qty});
      if (_qtySeq[itemId] == seq) state = AsyncData(next);
    } on ApiException {
      if (prev != null && _qtySeq[itemId] == seq) state = AsyncData(prev);
      rethrow;
    }
  }

  Future<void> saveForLater(int itemId, bool saved) async => state = AsyncData(await _api.patch<Json>('/cart/items/$itemId', {'savedForLater': saved}));
  Future<void> applyPromo(String code) async => state = AsyncData(await _api.post<Json>('/cart/promo', {'code': code}));
}

/* ------------------------------------------------------------------ wishlist (optimistic) */

final wishlistProvider = AsyncNotifierProvider<WishlistNotifier, Set<String>>(WishlistNotifier.new);

class WishlistNotifier extends AsyncNotifier<Set<String>> {
  @override
  Future<Set<String>> build() async {
    if (!ref.watch(sessionProvider.select((s) => s.signedIn))) return <String>{};
    final r = await ref.read(apiProvider).get<Json>('/wishlist');
    return {for (final id in (r['productIds'] as List? ?? const [])) '$id'};
  }

  Future<void> toggle(String productId) async {
    final cur = {...?state.value};
    final on = !cur.contains(productId);
    state = AsyncData(on ? ({...cur, productId}) : ({...cur}..remove(productId)));
    try {
      if (on) {
        await ref.read(apiProvider).post<Json>('/wishlist', {'productId': productId});
      } else {
        await ref.read(apiProvider).delete<Json>('/wishlist?productId=$productId');
      }
    } on ApiException {
      state = AsyncData(cur);
      rethrow;
    }
  }
}

final ordersProvider = FutureProvider<List<Json>>((ref) async => (await ref.read(apiProvider).get<Json>('/me/orders')).list('items'));
final orderProvider = FutureProvider.family<Json, String>((ref, id) => ref.read(apiProvider).get<Json>('/me/orders/$id'));
final loyaltyProvider = FutureProvider<Json>((ref) => ref.read(apiProvider).get<Json>('/me/loyalty'));
