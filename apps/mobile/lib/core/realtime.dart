import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import 'api.dart';

typedef RtEvent = Map<String, dynamic>;

/// One WebSocket per app session to Django Channels (`/realtime/?token=<access>`).
/// Rooms: `user.<id>` and `rider.<id>` are joined by the server; screens subscribe to `order.<id>`.
/// Reconnects with backoff, re-subscribes, and exposes [connected] so screens can show
/// "updating…" and fall back to polling while offline.
class Realtime {
  Realtime(this._tokens);
  final TokenStore _tokens;
  WebSocketChannel? _ch;
  StreamSubscription<dynamic>? _sub;
  final _events = StreamController<RtEvent>.broadcast();
  final _connected = StreamController<bool>.broadcast();
  final _rooms = <String, int>{};
  Timer? _retry, _ping;
  int _attempt = 0;
  bool _up = false;
  bool _disposed = false;

  Stream<RtEvent> get events => _events.stream;
  Stream<bool> get connected => _connected.stream;
  bool get isConnected => _up;

  static bool get _testing => Platform.environment['FLUTTER_TEST'] == 'true';

  void ensure() {
    if (_testing || _disposed || _ch != null || _tokens.access == null) return;
    final base = apiUrl.replaceFirst(RegExp('^http'), 'ws');
    try {
      final ch = WebSocketChannel.connect(Uri.parse('$base/realtime/?token=${Uri.encodeComponent(_tokens.access!)}'));
      _ch = ch;
      _sub = ch.stream.listen(_onMessage, onDone: _onClosed, onError: (_) => _onClosed());
      ch.ready.then((_) {
        _attempt = 0;
        _setUp(true);
        for (final r in _rooms.keys) {
          _send({'type': 'subscribe', 'channel': r});
        }
        _ping?.cancel();
        _ping = Timer.periodic(const Duration(seconds: 25), (_) => _send({'type': 'ping'}));
      }, onError: (_) => _onClosed());
    } catch (_) {
      _onClosed();
    }
  }

  /// Subscribe to a room; returns an unsubscribe callback (ref-counted across screens).
  void Function() subscribe(String room) {
    _rooms[room] = (_rooms[room] ?? 0) + 1;
    ensure();
    if (_up) _send({'type': 'subscribe', 'channel': room});
    return () {
      final n = (_rooms[room] ?? 1) - 1;
      if (n <= 0) {
        _rooms.remove(room);
        if (_up) _send({'type': 'unsubscribe', 'channel': room});
      } else {
        _rooms[room] = n;
      }
    };
  }

  /// Low-latency rider location path (falls back to HTTP batches when the socket is down).
  bool sendLocation(Map<String, dynamic> fix) {
    if (!_up) return false;
    _send({'type': 'rider.location', ...fix});
    return true;
  }

  void _send(Map<String, dynamic> m) {
    try {
      _ch?.sink.add(jsonEncode(m));
    } catch (_) {}
  }

  void _onMessage(dynamic raw) {
    try {
      final e = Map<String, dynamic>.from(jsonDecode(raw as String) as Map);
      if (e['type'] != 'pong' && e['type'] != 'subscribed' && e['type'] != 'hello') _events.add(e);
    } catch (_) {}
  }

  void _onClosed() {
    _sub?.cancel();
    _ch = null;
    _ping?.cancel();
    _setUp(false);
    if (_disposed) return;
    _retry?.cancel();
    _attempt = math.min(_attempt + 1, 6);
    _retry = Timer(Duration(milliseconds: 600 * (1 << _attempt)), ensure);
  }

  void _setUp(bool v) {
    if (_up == v) return;
    _up = v;
    _connected.add(v);
  }

  void close() {
    _retry?.cancel();
    _ping?.cancel();
    _sub?.cancel();
    _ch?.sink.close();
    _ch = null;
    _setUp(false);
  }

  void dispose() {
    _disposed = true;
    close();
    _events.close();
    _connected.close();
  }
}

final realtimeProvider = Provider<Realtime>((ref) {
  final rt = Realtime(ref.watch(tokenStoreProvider));
  ref.onDispose(rt.dispose);
  return rt;
});
