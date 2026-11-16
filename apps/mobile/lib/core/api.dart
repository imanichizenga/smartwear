import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// API base URL is a build-time value (`--dart-define=API_URL=…`); everything else comes from the
/// API's public config at runtime. 10.0.2.2 is the Android emulator's alias for the dev machine.
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:4000');
const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');

/// Consistent error envelope from the API: {code, message, details}.
class ApiException implements Exception {
  ApiException(this.status, this.code, this.message, [this.details = const {}]);
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic> details;
  bool get isNetwork => status == 0 && (code == 'offline' || code == 'timeout');
  @override
  String toString() => 'ApiException($status $code: $message)';
}

/* ------------------------------------------------------------------ storage */

/// Minimal key-value contract so the token store can be unit-tested without platform channels.
abstract class KeyValueStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class MemoryKv implements KeyValueStore {
  MemoryKv([Map<String, String>? seed]) : data = {...?seed};
  final Map<String, String> data;
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
  @override
  Future<void> delete(String key) async => data.remove(key);
}

/// Keychain / Android Keystore storage.
///  * Android: `resetOnError: false` — v10+ defaults to wiping *everything* when a value can't be decrypted
///    (keystore corruption after an OS update or backup restore), which would sign the user out silently.
///    We catch the error ourselves instead. (`encryptedSharedPreferences` no longer exists in v11.)
///  * iOS: `first_unlock` so background refreshes can read the token while the phone is locked.
///    Items written by older builds used the default accessibility; they are migrated on first read.
class SecureKv implements KeyValueStore {
  SecureKv([FlutterSecureStorage? storage]) : _s = storage ?? const FlutterSecureStorage(aOptions: _android, iOptions: _ios);
  static const _android = AndroidOptions(resetOnError: false);
  static const _ios = IOSOptions(accessibility: KeychainAccessibility.first_unlock);
  static const _legacyIos = FlutterSecureStorage(aOptions: _android);
  final FlutterSecureStorage _s;

  @override
  Future<String?> read(String key) async {
    final v = await _s.read(key: key);
    if (v != null || kIsWeb || !Platform.isIOS) return v;
    final old = await _legacyIos.read(key: key);
    if (old == null) return null;
    // Re-store with the new accessibility. Delete first: accessibility is not part of a keychain item's identity.
    try {
      await _legacyIos.delete(key: key);
      await _s.write(key: key, value: old);
    } catch (_) {
      try {
        await _legacyIos.write(key: key, value: old);
      } catch (_) {}
    }
    return old;
  }

  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);
  @override
  Future<void> delete(String key) => _s.delete(key: key);
}

/* ------------------------------------------------------------------ tokens */

/// Secure token + device storage. Refresh tokens are device-bound on the server, so the device id must stay
/// stable for as long as a refresh token exists. Every storage call is guarded: a keystore failure must never
/// throw on the splash screen.
class TokenStore {
  TokenStore({KeyValueStore? secure, KeyValueStore? backup})
      : _s = secure ?? SecureKv(),
        _backup = backup;
  final KeyValueStore _s;

  /// Optional non-secret mirror for the device id only (SharedPreferences), so a keystore hiccup can't
  /// change the device id the server bound the session to.
  final KeyValueStore? _backup;
  String? _access, _refresh, _device, _sid;
  Json? _user;
  bool _loaded = false;

  static const kAccess = 'sw.access', kRefresh = 'sw.refresh', kDevice = 'sw.device', kSid = 'sw.sid', kUser = 'sw.user';

  bool get loaded => _loaded;

  Future<String?> _read(KeyValueStore? s, String k) async {
    if (s == null) return null;
    try {
      return await s.read(k);
    } catch (e) {
      debugPrint('token store: cannot read $k ($e)');
      return null;
    }
  }

  Future<void> _write(KeyValueStore? s, String k, String v) async {
    if (s == null) return;
    try {
      await s.write(k, v);
    } catch (e) {
      debugPrint('token store: cannot write $k ($e)');
    }
  }

  Future<void> _delete(KeyValueStore? s, String k) async {
    if (s == null) return;
    try {
      await s.delete(k);
    } catch (_) {}
  }

  Future<void> load() async {
    _refresh = await _read(_s, kRefresh);
    // Never keep an access token without its refresh token (half-written state from an older build).
    _access = _refresh == null ? null : await _read(_s, kAccess);
    _sid = _refresh == null ? null : await _read(_s, kSid);
    _device = await _read(_s, kDevice) ?? await _read(_backup, kDevice);
    if (_device != null) {
      if (await _read(_backup, kDevice) == null) await _write(_backup, kDevice, _device!);
    } else if (_refresh == null) {
      await ensureDeviceId();
    }
    // With a refresh token but no device id we send none: the server then skips the device check instead of
    // seeing a *new* id and rejecting the session.
    final u = _refresh == null ? null : await _read(_s, kUser);
    try {
      _user = u == null ? null : Map<String, dynamic>.from(jsonDecode(u) as Map);
    } catch (_) {
      _user = null;
    }
    _loaded = true;
  }

  String? get access => _access;
  String? get refresh => _refresh;
  String? get deviceId => _device;
  String? get sessionId => _sid;
  bool get signedIn => _refresh != null;

  /// The last `/me` user, so a restart can show the signed-in app at once (even offline).
  Json? get cachedUser => _user;

  /// Generated only when signing in (no refresh token exists), never while a session is alive.
  Future<String> ensureDeviceId() async {
    if (_device != null) return _device!;
    final r = Random.secure();
    _device = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    await _write(_s, kDevice, _device!);
    await _write(_backup, kDevice, _device!);
    return _device!;
  }

  /// When the access token expires (from its JWT `exp`), for proactive refresh.
  DateTime? get accessExpiresAt {
    final t = _access;
    if (t == null) return null;
    try {
      final parts = t.split('.');
      if (parts.length != 3) return null;
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map;
      final exp = payload['exp'];
      return exp is num ? DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000) : null;
    } catch (_) {
      return null;
    }
  }

  /// Refresh token first, then access: an interrupted write can leave a stale access token next to a valid
  /// refresh token (harmless, refreshed on the next 401) but never an access token without a refresh token.
  Future<void> save(String access, String refresh, {String? sessionId}) async {
    _refresh = refresh;
    _access = access;
    if (sessionId != null && sessionId.isNotEmpty) _sid = sessionId;
    await _write(_s, kRefresh, refresh);
    await _write(_s, kAccess, access);
    if (_sid != null) await _write(_s, kSid, _sid!);
  }

  Future<void> saveUser(Json user) async {
    _user = user;
    if (_refresh != null) await _write(_s, kUser, jsonEncode(user));
  }

  /// Access first so the store is never "access without refresh". The device id stays.
  Future<void> clear() async {
    _access = _refresh = _sid = null;
    _user = null;
    await _delete(_s, kAccess);
    await _delete(_s, kRefresh);
    await _delete(_s, kSid);
    await _delete(_s, kUser);
  }
}

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

/* ------------------------------------------------------------------ api */

/// Why the app was signed out without the user asking.
enum SignOutReason { revoked, blocked }

/// Outcome of a token refresh.
enum RefreshResult { ok, offline, signedOut }

/// Thin typed wrapper around Dio: auth header, device id, locale, one-at-a-time token refresh,
/// and the API's error envelope turned into [ApiException].
///
/// Sign-in persistence rule: tokens are cleared only when the server *definitively* ends the session —
/// `/auth/refresh` answers 401 `refresh_invalid` / `refresh_device_mismatch` / `session_revoked`, or 403
/// (account blocked or deleted). Timeouts, no connectivity, DNS failures and 5xx keep the user signed in.
class Api {
  Api(this.tokens, {Dio? dio, this.onSignedOut}) : dio = dio ?? Dio(BaseOptions(baseUrl: '$apiUrl/v1', connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 20))) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      final device = tokens.deviceId;
      if (device != null) o.headers['X-Device-Id'] = device;
      o.headers['Accept-Language'] = locale;
      o.headers['X-App-Version'] = appVersion;
      // Sign-in / refresh endpoints never get the (possibly expired) access token.
      if (tokens.access != null && !_publicAuthPaths.contains(o.path) && o.extra['noAuth'] != true) o.headers['Authorization'] = 'Bearer ${tokens.access}';
      h.next(o);
    }));
  }

  final Dio dio;
  final TokenStore tokens;

  /// Called once when the server definitively ended the session (not when the user taps Sign out).
  void Function(SignOutReason reason)? onSignedOut;

  /// Called after every successful refresh with the fresh user, so the session can update its cache.
  void Function(Json user)? onRefreshed;

  /// Reachability: true after any response from the API, false when a request couldn't reach it.
  void Function(bool online)? onNetwork;
  String locale = 'en';
  Future<RefreshResult>? _refreshing;

  static const _publicAuthPaths = {'/auth/refresh', '/auth/otp/request', '/auth/otp/verify', '/auth/google'};
  static const definitiveRefreshCodes = {'refresh_invalid', 'refresh_device_mismatch', 'session_revoked'};

  /// True when a failed `/auth/refresh` means the session is really over.
  static bool isDefinitiveRefreshFailure(int status, String? code) => status == 403 || (status == 401 && definitiveRefreshCodes.contains(code));

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _send<T>(() => dio.get(path, queryParameters: _clean(query)), idempotent: true);
  Future<T> post<T>(String path, [Object? body, Map<String, String>? headers]) => _send<T>(() => dio.post(path, data: body ?? const {}, options: Options(headers: headers)));
  Future<T> patch<T>(String path, [Object? body]) => _send<T>(() => dio.patch(path, data: body ?? const {}));
  Future<T> put<T>(String path, [Object? body]) => _send<T>(() => dio.put(path, data: body ?? const {}));
  Future<T> delete<T>(String path) => _send<T>(() => dio.delete(path));

  Map<String, dynamic>? _clean(Map<String, dynamic>? q) => q == null ? null : (Map.of(q)..removeWhere((k, v) => v == null || v == '' || (v is List && v.isEmpty)));

  static String? _code(DioException e) {
    final d = e.response?.data;
    return d is Map ? d['code']?.toString() : null;
  }

  static bool _isTransient(DioException e) {
    final s = e.response?.statusCode ?? 0;
    return s == 0 || s == 502 || s == 503 || s == 504 || e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout;
  }

  Future<T> _send<T>(Future<Response<dynamic>> Function() call, {bool retried = false, bool idempotent = false, int attempt = 0}) async {
    try {
      final r = await call();
      onNetwork?.call(true);
      return r.data as T;
    } on DioException catch (e) {
      final status = e.response?.statusCode ?? 0;
      final code = _code(e);
      onNetwork?.call(e.response != null || !_isTransient(e));
      if (status == 401 && !retried && tokens.refresh != null) {
        final res = await refreshSession();
        if (res == RefreshResult.ok) return _send<T>(call, retried: true, idempotent: idempotent);
        // Still signed in but couldn't reach the server: report "offline", never "signed out".
        if (res == RefreshResult.offline) throw ApiException(0, 'offline', 'You are offline');
        throw _toApiException(e);
      }
      if (status == 403 && code == 'account_blocked' && tokens.signedIn) await _endSession(SignOutReason.blocked);
      // Safe GETs retry a couple of times with backoff on network blips and gateway errors.
      if (idempotent && attempt < 2 && _isTransient(e)) {
        await Future<void>.delayed(Duration(milliseconds: 400 * (1 << attempt)));
        return _send<T>(call, retried: retried, idempotent: true, attempt: attempt + 1);
      }
      throw _toApiException(e);
    }
  }

  /// Single-flight token refresh shared by HTTP calls, the realtime socket and app resume.
  Future<RefreshResult> refreshSession() {
    if (tokens.refresh == null) return Future.value(RefreshResult.signedOut);
    return _refreshing ??= () async {
      try {
        final r = await dio.post('/auth/refresh', data: {'refreshToken': tokens.refresh}, options: Options(extra: {'noAuth': true}));
        final d = Map<String, dynamic>.from(r.data as Map);
        await tokens.save('${d['accessToken']}', '${d['refreshToken']}', sessionId: d['sessionId']?.toString());
        final u = d['user'];
        if (u is Map) {
          final user = Map<String, dynamic>.from(u);
          await tokens.saveUser(user);
          onRefreshed?.call(user);
        }
        return RefreshResult.ok;
      } on DioException catch (e) {
        final status = e.response?.statusCode ?? 0;
        if (isDefinitiveRefreshFailure(status, _code(e))) {
          await _endSession(status == 403 ? SignOutReason.blocked : SignOutReason.revoked);
          return RefreshResult.signedOut;
        }
        return RefreshResult.offline;
      } catch (_) {
        return RefreshResult.offline; // malformed response: keep the session
      } finally {
        Future.microtask(() => _refreshing = null);
      }
    }();
  }

  /// Refresh ahead of time when the access token expires within [margin] (app resume, before a socket connects).
  Future<RefreshResult> refreshIfExpiring({Duration margin = const Duration(seconds: 60)}) async {
    if (!tokens.signedIn) return RefreshResult.signedOut;
    final exp = tokens.accessExpiresAt;
    if (tokens.access != null && exp != null && exp.isAfter(DateTime.now().add(margin))) return RefreshResult.ok;
    return refreshSession();
  }

  Future<void> _endSession(SignOutReason reason) async {
    if (!tokens.signedIn) return;
    await tokens.clear();
    onSignedOut?.call(reason);
  }

  static ApiException _toApiException(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['message'] != null) {
      return ApiException(e.response!.statusCode ?? 0, '${data['code'] ?? 'error'}', '${data['message']}', Map<String, dynamic>.from((data['details'] as Map?) ?? const {}));
    }
    final timeout = e.type == DioExceptionType.connectionTimeout || e.type == DioExceptionType.receiveTimeout || e.type == DioExceptionType.sendTimeout;
    final offline = e.type == DioExceptionType.connectionError || e.error is SocketException;
    if (offline || timeout) return ApiException(0, offline ? 'offline' : 'timeout', 'You are offline');
    return ApiException(e.response?.statusCode ?? 0, 'error', 'Something went wrong');
  }
}

final apiProvider = Provider<Api>((ref) => Api(ref.watch(tokenStoreProvider)));

/// Small typed accessors for JSON maps (the API is camelCase JSON; screens read it directly).
typedef Json = Map<String, dynamic>;

extension JsonX on Json {
  String str(String k, [String d = '']) => (this[k] as String?) ?? d;
  String? strN(String k) => this[k] as String?;
  int integer(String k, [int d = 0]) => (this[k] as num?)?.toInt() ?? d;
  int? intN(String k) => (this[k] as num?)?.toInt();
  double dbl(String k, [double d = 0]) => (this[k] as num?)?.toDouble() ?? d;
  bool flag(String k) => this[k] == true;
  Json? obj(String k) => this[k] is Map ? Map<String, dynamic>.from(this[k] as Map) : null;
  List<Json> list(String k) => ((this[k] as List?) ?? const []).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
}
