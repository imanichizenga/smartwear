import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:smartwear/core/api.dart';
import 'package:smartwear/core/providers.dart';

/// Answers requests from a handler instead of the network.
class _Adapter implements HttpClientAdapter {
  _Adapter(this.handler);
  final Future<ResponseBody> Function(RequestOptions o) handler;
  final calls = <String>[];
  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) {
    calls.add('${o.method} ${o.path}');
    return handler(o);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody _json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });

Never _offline(RequestOptions o) => throw const SocketException('Failed host lookup: api.smartwear.test');

Dio _dio(_Adapter a) => Dio(BaseOptions(baseUrl: 'https://api.smartwear.test/v1'))..httpClientAdapter = a;

TokenStore _signedInStore({bool withUser = true}) => TokenStore(
      secure: MemoryKv({
        TokenStore.kRefresh: 'refresh-1',
        TokenStore.kAccess: 'access-1',
        TokenStore.kDevice: 'device-1',
        TokenStore.kSid: 'sid-1',
        if (withUser) TokenStore.kUser: jsonEncode({'id': 'u1', 'name': 'Neema Mushi', 'phone': '+255712345678'}),
      }),
    );

void main() {
  group('token refresh', () {
    test('offline refresh keeps the tokens and reports offline', () async {
      final tokens = _signedInStore();
      await tokens.load();
      final adapter = _Adapter((o) async => o.path == '/auth/refresh' ? _offline(o) : _json(401, {'code': 'token_expired', 'message': 'Session expired'}));
      var signedOut = false;
      final api = Api(tokens, dio: _dio(adapter), onSignedOut: (_) => signedOut = true);

      await expectLater(api.get<Json>('/me'), throwsA(isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true)));
      expect(tokens.refresh, 'refresh-1');
      expect(tokens.access, 'access-1');
      expect(signedOut, isFalse);
    });

    test('a 5xx during refresh keeps the tokens', () async {
      final tokens = _signedInStore();
      await tokens.load();
      final api = Api(tokens, dio: _dio(_Adapter((o) async => o.path == '/auth/refresh' ? _json(503, {'code': 'unavailable', 'message': 'down'}) : _json(401, {'code': 'token_expired', 'message': 'x'}))));
      expect(await api.refreshSession(), RefreshResult.offline);
      expect(tokens.signedIn, isTrue);
    });

    test('401 refresh_invalid clears the tokens and signs out once', () async {
      final tokens = _signedInStore();
      await tokens.load();
      final reasons = <SignOutReason>[];
      final adapter = _Adapter((o) async => o.path == '/auth/refresh' ? _json(401, {'code': 'refresh_invalid', 'message': 'Please sign in again'}) : _json(401, {'code': 'token_expired', 'message': 'x'}));
      final api = Api(tokens, dio: _dio(adapter), onSignedOut: reasons.add);

      await expectLater(api.get<Json>('/me'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
      expect(tokens.refresh, isNull);
      expect(tokens.access, isNull);
      expect(reasons, [SignOutReason.revoked]);
      expect(tokens.deviceId, 'device-1', reason: 'the device id survives sign-out');
    });

    test('403 on refresh (blocked account) signs out as blocked', () async {
      final tokens = _signedInStore();
      await tokens.load();
      final reasons = <SignOutReason>[];
      final api = Api(tokens, dio: _dio(_Adapter((o) async => _json(403, {'code': 'account_blocked', 'message': 'blocked'}))), onSignedOut: reasons.add);
      expect(await api.refreshSession(), RefreshResult.signedOut);
      expect(reasons, [SignOutReason.blocked]);
      expect(tokens.signedIn, isFalse);
    });

    test('concurrent 401s share a single refresh and both retry', () async {
      final tokens = _signedInStore();
      await tokens.load();
      late _Adapter adapter;
      adapter = _Adapter((o) async {
        if (o.path == '/auth/refresh') {
          await Future<void>.delayed(const Duration(milliseconds: 20));
          return _json(200, {'accessToken': 'access-2', 'refreshToken': 'refresh-2', 'sessionId': 'sid-1', 'user': {'id': 'u1', 'name': 'Neema'}});
        }
        return o.headers['Authorization'] == 'Bearer access-2' ? _json(200, {'ok': true}) : _json(401, {'code': 'token_expired', 'message': 'x'});
      });
      final api = Api(tokens, dio: _dio(adapter));
      final r = await Future.wait([api.get<Json>('/me'), api.get<Json>('/cart')]);
      expect(r.every((m) => m['ok'] == true), isTrue);
      expect(adapter.calls.where((c) => c == 'POST /auth/refresh').length, 1);
      expect(tokens.refresh, 'refresh-2');
      expect(tokens.cachedUser?['name'], 'Neema');
    });

    test('the refresh call never carries the (expired) access token', () async {
      final tokens = _signedInStore();
      await tokens.load();
      String? auth = 'unset';
      final api = Api(tokens, dio: _dio(_Adapter((o) async {
        auth = o.headers['Authorization'] as String?;
        return _json(200, {'accessToken': 'a', 'refreshToken': 'r'});
      })));
      await api.refreshSession();
      expect(auth, isNull);
    });
  });

  group('token store', () {
    test('never regenerates the device id while a refresh token exists', () async {
      final kv = MemoryKv({TokenStore.kRefresh: 'refresh-1'});
      final store = TokenStore(secure: kv);
      await store.load();
      expect(store.deviceId, isNull);
      expect(kv.data.containsKey(TokenStore.kDevice), isFalse);
    });

    test('falls back to the backup device id and survives storage errors', () async {
      final store = TokenStore(secure: _ThrowingKv(), backup: MemoryKv({TokenStore.kDevice: 'device-9'}));
      await store.load(); // must not throw
      expect(store.deviceId, 'device-9');
      expect(store.signedIn, isFalse);
    });

    test('an access token without a refresh token is ignored', () async {
      final store = TokenStore(secure: MemoryKv({TokenStore.kAccess: 'orphan'}));
      await store.load();
      expect(store.access, isNull);
      expect(store.deviceId, isNotNull);
    });
  });

  group('session restore', () {
    test('restore with a cached user and no network shows signed in', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final tokens = _signedInStore();
      final api = Api(tokens, dio: _dio(_Adapter((o) async => _offline(o))));
      final c = ProviderContainer(overrides: [
        prefsProvider.overrideWithValue(prefs),
        tokenStoreProvider.overrideWithValue(tokens),
        apiProvider.overrideWithValue(api),
      ]);
      addTearDown(c.dispose);

      await c.read(sessionProvider.notifier).restore();
      final s = c.read(sessionProvider);
      expect(s.ready, isTrue);
      expect(s.signedIn, isTrue);
      expect(s.user?['name'], 'Neema Mushi');

      await c.read(sessionProvider.notifier).revalidate(); // offline: nothing changes
      expect(c.read(sessionProvider).signedIn, isTrue);
      expect(tokens.refresh, 'refresh-1');
    });

    test('restore without a cached user is still signed in offline', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final tokens = _signedInStore(withUser: false);
      final c = ProviderContainer(overrides: [
        prefsProvider.overrideWithValue(prefs),
        tokenStoreProvider.overrideWithValue(tokens),
        apiProvider.overrideWithValue(Api(tokens, dio: _dio(_Adapter((o) async => _offline(o))))),
      ]);
      addTearDown(c.dispose);
      await c.read(sessionProvider.notifier).restore();
      expect(c.read(sessionProvider).signedIn, isTrue);
    });

    test('a definitive revocation signs the session out with a reason', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final tokens = _signedInStore();
      final api = Api(tokens, dio: _dio(_Adapter((o) async => o.path == '/auth/refresh'
          ? _json(401, {'code': 'session_revoked', 'message': 'Please sign in again'})
          : _json(401, {'code': 'session_revoked', 'message': 'Please sign in again'}))));
      final c = ProviderContainer(overrides: [
        prefsProvider.overrideWithValue(prefs),
        tokenStoreProvider.overrideWithValue(tokens),
        apiProvider.overrideWithValue(api),
      ]);
      addTearDown(c.dispose);
      await c.read(sessionProvider.notifier).restore();
      await c.read(sessionProvider.notifier).revalidate();
      final s = c.read(sessionProvider);
      expect(s.signedIn, isFalse);
      expect(s.endedBy, SignOutReason.revoked);
    });
  });
}

class _ThrowingKv implements KeyValueStore {
  @override
  Future<String?> read(String key) => throw Exception('keystore corrupted');
  @override
  Future<void> write(String key, String value) => throw Exception('keystore corrupted');
  @override
  Future<void> delete(String key) => throw Exception('keystore corrupted');
}
