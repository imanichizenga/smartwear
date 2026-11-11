import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:dio/dio.dart';
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
  bool get isNetwork => status == 0;
  @override
  String toString() => 'ApiException($status $code: $message)';
}

/// Secure token + device storage. Refresh tokens are device-bound on the server.
class TokenStore {
  TokenStore([FlutterSecureStorage? s]) : _s = s ?? const FlutterSecureStorage();
  final FlutterSecureStorage _s;
  String? _access, _refresh, _device;

  Future<void> load() async {
    _access = await _s.read(key: 'sw.access');
    _refresh = await _s.read(key: 'sw.refresh');
    _device = await _s.read(key: 'sw.device');
    if (_device == null) {
      final r = Random.secure();
      _device = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
      await _s.write(key: 'sw.device', value: _device);
    }
  }

  String? get access => _access;
  String? get refresh => _refresh;
  String get deviceId => _device ?? 'unknown';
  bool get signedIn => _refresh != null;

  Future<void> save(String access, String refresh) async {
    _access = access;
    _refresh = refresh;
    await _s.write(key: 'sw.access', value: access);
    await _s.write(key: 'sw.refresh', value: refresh);
  }

  Future<void> clear() async {
    _access = _refresh = null;
    await _s.delete(key: 'sw.access');
    await _s.delete(key: 'sw.refresh');
  }
}

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

/// Thin typed wrapper around Dio: auth header, device id, locale, one-at-a-time token refresh,
/// and the API's error envelope turned into [ApiException].
class Api {
  Api(this.tokens, {Dio? dio, this.onSignedOut}) : dio = dio ?? Dio(BaseOptions(baseUrl: '$apiUrl/v1', connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 20))) {
    this.dio.interceptors.add(InterceptorsWrapper(onRequest: (o, h) {
      o.headers['X-Device-Id'] = tokens.deviceId;
      o.headers['Accept-Language'] = locale;
      o.headers['X-App-Version'] = appVersion;
      if (tokens.access != null) o.headers['Authorization'] = 'Bearer ${tokens.access}';
      h.next(o);
    }));
  }

  final Dio dio;
  final TokenStore tokens;
  final void Function()? onSignedOut;
  String locale = 'en';
  Future<bool>? _refreshing;

  Future<T> get<T>(String path, {Map<String, dynamic>? query}) => _send<T>(() => dio.get(path, queryParameters: _clean(query)));
  Future<T> post<T>(String path, [Object? body, Map<String, String>? headers]) => _send<T>(() => dio.post(path, data: body ?? const {}, options: Options(headers: headers)));
  Future<T> patch<T>(String path, [Object? body]) => _send<T>(() => dio.patch(path, data: body ?? const {}));
  Future<T> put<T>(String path, [Object? body]) => _send<T>(() => dio.put(path, data: body ?? const {}));
  Future<T> delete<T>(String path) => _send<T>(() => dio.delete(path));

  Map<String, dynamic>? _clean(Map<String, dynamic>? q) => q == null ? null : (Map.of(q)..removeWhere((k, v) => v == null || v == '' || (v is List && v.isEmpty)));

  Future<T> _send<T>(Future<Response<dynamic>> Function() call, {bool retried = false}) async {
    try {
      final r = await call();
      return r.data as T;
    } on DioException catch (e) {
      final status = e.response?.statusCode ?? 0;
      if (status == 401 && !retried && tokens.refresh != null) {
        if (await _refresh()) return _send<T>(call, retried: true);
      }
      throw _toApiException(e);
    }
  }

  Future<bool> _refresh() {
    return _refreshing ??= () async {
      try {
        final r = await dio.post('/auth/refresh', data: {'refreshToken': tokens.refresh}, options: Options(headers: {'Authorization': null}));
        await tokens.save(r.data['accessToken'] as String, r.data['refreshToken'] as String);
        return true;
      } on DioException {
        await tokens.clear();
        onSignedOut?.call();
        return false;
      } finally {
        Future.microtask(() => _refreshing = null);
      }
    }();
  }

  static ApiException _toApiException(DioException e) {
    final data = e.response?.data;
    if (data is Map && data['message'] != null) {
      return ApiException(e.response!.statusCode ?? 0, '${data['code'] ?? 'error'}', '${data['message']}', Map<String, dynamic>.from((data['details'] as Map?) ?? const {}));
    }
    final offline = e.type == DioExceptionType.connectionError || e.type == DioExceptionType.connectionTimeout || e.error is SocketException;
    return ApiException(e.response?.statusCode ?? 0, offline ? 'offline' : 'error', offline ? 'You are offline' : 'Something went wrong');
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
