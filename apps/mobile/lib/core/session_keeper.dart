import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';
import 'providers.dart';
import 'realtime.dart';

/// Keeps a signed-in session healthy for the app's lifetime:
///  * refreshes the access token ~60 s before it expires, and on resume from background;
///  * revalidates `/me` on resume (offline is fine — nothing is cleared);
///  * reacts to the server's `session.revoked` realtime event by asking the server (a refresh): if the
///    session really ended, [Api] signs the app out; a spoofed or stale event changes nothing;
///  * keeps the realtime socket connected while signed in and drops it on sign-out.
class SessionKeeper {
  SessionKeeper(this.ref) {
    _life = AppLifecycleListener(onResume: _onResume, onPause: () => _timer?.cancel());
    _events = ref.read(realtimeProvider).events.listen(_onEvent);
    ref.listen<SessionState>(sessionProvider, (prev, next) => _onSession(prev, next), fireImmediately: true);
  }

  final Ref ref;
  late final AppLifecycleListener _life;
  late final StreamSubscription<RtEvent> _events;
  Timer? _timer;

  Api get _api => ref.read(apiProvider);

  void _onSession(SessionState? prev, SessionState next) {
    if (next.signedIn) {
      _schedule();
      ref.read(realtimeProvider).ensure();
    } else if (prev?.signedIn == true) {
      _timer?.cancel();
      ref.read(realtimeProvider).reset();
    }
  }

  void _schedule() {
    _timer?.cancel();
    final exp = _api.tokens.accessExpiresAt;
    if (exp == null) return;
    var wait = exp.difference(DateTime.now()) - const Duration(seconds: 60);
    if (wait.isNegative) wait = Duration.zero;
    _timer = Timer(wait, () async {
      final r = await _api.refreshSession();
      if (r == RefreshResult.ok) {
        _schedule();
      } else if (r == RefreshResult.offline) {
        _timer = Timer(const Duration(seconds: 30), _schedule); // try again shortly; the session stays
      }
    });
  }

  Future<void> _onResume() async {
    if (!_api.tokens.signedIn) return;
    final r = await _api.refreshIfExpiring();
    if (r == RefreshResult.signedOut) return;
    _schedule();
    ref.read(realtimeProvider).ensure();
    unawaited(ref.read(sessionProvider.notifier).revalidate());
  }

  void _onEvent(RtEvent e) {
    if (e['type'] != 'session.revoked' || !_api.tokens.signedIn) return;
    final ids = ((e['sessionIds'] as List?) ?? const []).map((x) => '$x').toSet();
    final mine = _api.tokens.sessionId;
    // Only our own session matters; if we don't know our id (older login), let the server decide.
    if (mine != null && !ids.contains(mine)) return;
    unawaited(_api.refreshSession());
  }

  void dispose() {
    _timer?.cancel();
    _events.cancel();
    _life.dispose();
  }
}

final sessionKeeperProvider = Provider<SessionKeeper>((ref) {
  final k = SessionKeeper(ref);
  ref.onDispose(k.dispose);
  return k;
});
