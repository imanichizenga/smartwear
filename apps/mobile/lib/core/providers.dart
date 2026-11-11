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
      return Map<String, dynamic>.from(jsonDecode(cached) as Map);
    }
    return fresh;
  }
}

extension ConfigX on Json {
  bool feature(String k) => obj('features')?[k] != false;
  String get currency => obj('localization')?.str('currency', 'TZS') ?? 'TZS';
}

/* ------------------------------------------------------------------ session */

class SessionState {
  const SessionState({this.user, this.ready = false});
  final Json? user;
  final bool ready;
  bool get signedIn => user != null;
  bool get isRider => user?['isRider'] == true || user?.obj('rider') != null;
}

final sessionProvider = NotifierProvider<SessionNotifier, SessionState>(SessionNotifier.new);

class SessionNotifier extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState();

  Api get _api => ref.read(apiProvider);

  Future<void> restore() async {
    final tokens = ref.read(tokenStoreProvider);
    await tokens.load();
    if (!tokens.signedIn) {
      state = const SessionState(ready: true);
      return;
    }
    try {
      final me = await _api.get<Json>('/me');
      state = SessionState(user: me.obj('user') ?? me, ready: true);
    } on ApiException catch (e) {
      if (e.status == 401) await tokens.clear();
      state = SessionState(ready: true, user: e.isNetwork ? const {'offline': true} : null);
    }
  }

  /// Returns the API's `isNewUser` so the caller can offer the (skippable) style quiz.
  Future<bool> completeLogin(Json payload) async {
    await ref.read(tokenStoreProvider).save(payload.str('accessToken'), payload.str('refreshToken'));
    state = SessionState(user: payload.obj('user'), ready: true);
    ref.invalidate(cartProvider);
    ref.invalidate(wishlistProvider);
    return payload.flag('isNewUser');
  }

  Future<void> requestOtp(String phone) => _api.post<Json>('/auth/otp/request', {'phone': phone});

  Future<bool> verifyOtp(String phone, String code) async {
    final t = ref.read(tokenStoreProvider);
    final r = await _api.post<Json>('/auth/otp/verify', {'phone': phone, 'code': code, 'deviceId': t.deviceId, 'platform': _platform, 'appVersion': appVersion});
    return completeLogin(r);
  }

  Future<bool> google(String idToken) async {
    final t = ref.read(tokenStoreProvider);
    final r = await _api.post<Json>('/auth/google', {'idToken': idToken, 'deviceId': t.deviceId, 'platform': _platform, 'appVersion': appVersion});
    return completeLogin(r);
  }

  Future<void> signOut() async {
    try {
      await _api.post<Json>('/auth/logout');
    } on ApiException {
      // Signing out locally must always work, even offline.
    }
    await ref.read(tokenStoreProvider).clear();
    state = const SessionState(ready: true);
    ref.invalidate(cartProvider);
    ref.invalidate(wishlistProvider);
  }

  void updateUser(Json user) => state = SessionState(user: user, ready: true);

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
  const ProductPage({this.items = const [], this.nextCursor, this.loadingMore = false, this.total, this.facets});
  final List<Json> items;
  final String? nextCursor;
  final bool loadingMore;
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

  /// Infinite scroll: append the next cursor page.
  Future<void> loadMore() async {
    final cur = state.value;
    if (cur == null || cur.nextCursor == null || cur.loadingMore) return;
    state = AsyncData(ProductPage(items: cur.items, nextCursor: cur.nextCursor, loadingMore: true, total: cur.total, facets: cur.facets));
    final r = await ref.read(apiProvider).get<Json>('/products', query: query.toQuery(cur.nextCursor));
    state = AsyncData(ProductPage(items: [...cur.items, ...r.list('items')], nextCursor: r.strN('nextCursor'), total: cur.total, facets: cur.facets));
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

  /// Optimistic quantity change; the server's re-priced cart (tiers, savings) replaces it.
  Future<void> setQty(int itemId, int qty) async {
    final prev = state.value;
    if (prev != null) {
      state = AsyncData({...prev, 'items': [for (final i in prev.list('items')) if (i.integer('id') == itemId) {...i, 'qty': qty} else i]});
    }
    try {
      state = AsyncData(qty <= 0 ? await _api.delete<Json>('/cart/items/$itemId') : await _api.patch<Json>('/cart/items/$itemId', {'qty': qty}));
    } on ApiException {
      if (prev != null) state = AsyncData(prev);
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
