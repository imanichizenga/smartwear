import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api.dart';

/// Push notifications through Firebase Cloud Messaging (Android + iOS).
///
///  * Registers this device's FCM token with the API while signed in (`POST /push-tokens`), again whenever FCM
///    rotates it, and unregisters on sign-out so the next person on the phone doesn't get the previous account's pushes.
///  * Pushes that arrive while the app is open are shown with flutter_local_notifications (same channels).
///  * A tap — cold start, from the background or in the foreground — goes to the push's `route` and, for campaigns,
///    reports the open (`POST /campaigns/<id>/opened`) so the admin sees who opened it.
///  * Without the Firebase config files the app runs normally with push switched off.
class PushService {
  PushService(this._api);
  final Api _api;

  bool _ready = false;
  bool _initialising = false;
  String? _token;
  StreamSubscription<String>? _refresh;
  final _local = FlutterLocalNotificationsPlugin();

  /// Taps waiting for the router (a cold start opens the app before the router is built).
  final _opens = StreamController<Map<String, dynamic>>.broadcast();
  Map<String, dynamic>? _pendingOpen;
  Stream<Map<String, dynamic>> get opens => _opens.stream;

  /// The tap that launched the app, once — the router consumes it after the splash.
  Map<String, dynamic>? takePendingOpen() {
    final p = _pendingOpen;
    _pendingOpen = null;
    return p;
  }

  static const _channels = [
    AndroidNotificationChannel('default', 'General', description: 'Account and app messages', importance: Importance.defaultImportance),
    AndroidNotificationChannel('orders', 'Orders', description: 'Order confirmations, rider and delivery updates', importance: Importance.high),
    AndroidNotificationChannel('marketing', 'New arrivals & offers', description: 'Drops, new products and offers', importance: Importance.defaultImportance),
    AndroidNotificationChannel('jobs', 'Delivery requests', description: 'New delivery jobs for riders', importance: Importance.max),
  ];

  static bool get _testing => !kIsWeb && Platform.environment['FLUTTER_TEST'] == 'true';

  Future<void> init() async {
    if (_ready || _initialising || _testing || kIsWeb) return;
    _initialising = true;
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('push: Firebase not configured ($e) — push disabled');
      _initialising = false;
      return;
    }
    await _local.initialize(
      const InitializationSettings(android: AndroidInitializationSettings('ic_notification'), iOS: DarwinInitializationSettings(requestAlertPermission: false, requestBadgePermission: false, requestSoundPermission: false)),
      onDidReceiveNotificationResponse: (r) {
        final p = r.payload;
        if (p == null || p.isEmpty) return;
        try {
          _handleOpen(Map<String, dynamic>.from(jsonDecode(p) as Map), 'push');
        } catch (_) {}
      },
    );
    final android = _local.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    for (final c in _channels) {
      await android?.createNotificationChannel(c);
    }
    final fm = FirebaseMessaging.instance;
    // iOS shows banners itself while the app is open; Android needs the local notification below.
    await fm.setForegroundNotificationPresentationOptions(alert: true, badge: true, sound: true);
    FirebaseMessaging.onMessage.listen(_onForeground);
    FirebaseMessaging.onMessageOpenedApp.listen((m) => _handleOpen(m.data, 'push'));
    final initial = await fm.getInitialMessage();
    if (initial != null) _handleOpen(initial.data, 'push');
    final launch = await _local.getNotificationAppLaunchDetails();
    if (launch?.didNotificationLaunchApp == true && (launch!.notificationResponse?.payload ?? '').isNotEmpty) {
      try {
        _handleOpen(Map<String, dynamic>.from(jsonDecode(launch.notificationResponse!.payload!) as Map), 'push');
      } catch (_) {}
    }
    _ready = true;
    _initialising = false;
  }

  /// Signed in: ask for permission (first time only on iOS / Android 13+) and register the token.
  Future<void> register({required String locale}) async {
    await init();
    if (!_ready) return;
    final fm = FirebaseMessaging.instance;
    final perm = await fm.requestPermission(alert: true, badge: true, sound: true);
    if (perm.authorizationStatus == AuthorizationStatus.denied) return;
    try {
      if (!kIsWeb && Platform.isIOS) await fm.getAPNSToken();
      final t = await fm.getToken();
      if (t != null) await _send(t, locale);
    } catch (e) {
      debugPrint('push: token unavailable ($e)');
    }
    _refresh ??= fm.onTokenRefresh.listen((t) => _send(t, locale));
  }

  Future<void> _send(String token, String locale) async {
    _token = token;
    try {
      await _api.post<Json>('/push-tokens', {'token': token, 'provider': 'fcm', 'platform': Platform.isIOS ? 'ios' : 'android', 'locale': locale});
    } on ApiException catch (e) {
      debugPrint('push: register failed ($e)');
    }
  }

  /// Before signing out (while still authenticated): stop pushes to this phone for this account.
  Future<void> unregister() async {
    final t = _token;
    if (!_ready || t == null) return;
    try {
      await _api.dio.delete<dynamic>('/push-tokens', data: {'token': t});
    } catch (_) {}
    try {
      await FirebaseMessaging.instance.deleteToken(); // a fresh token for whoever signs in next
    } catch (_) {}
    _token = null;
  }

  Future<void> _onForeground(RemoteMessage m) async {
    final n = m.notification;
    if (n == null || kIsWeb || !Platform.isAndroid) return; // iOS presents it natively (options above)
    final channel = m.notification?.android?.channelId ?? 'default';
    final c = _channels.firstWhere((x) => x.id == channel, orElse: () => _channels.first);
    await _local.show(
      m.messageId.hashCode,
      n.title,
      n.body,
      NotificationDetails(
        android: AndroidNotificationDetails(c.id, c.name, channelDescription: c.description, importance: c.importance, priority: Priority.high, icon: 'ic_notification', styleInformation: BigTextStyleInformation(n.body ?? '')),
      ),
      payload: jsonEncode(m.data),
    );
  }

  void _handleOpen(Map<String, dynamic> data, String source) {
    if (data.isEmpty) return;
    final id = data['campaignId']?.toString();
    if (id != null && id.isNotEmpty && data['test'] != '1') reportOpen(id, source);
    _pendingOpen = data;
    _opens.add(data);
  }

  /// Counts a campaign open for the admin report (unique per person; repeats add to the total).
  void reportOpen(String campaignId, String source) {
    _api.post<Json>('/campaigns/$campaignId/opened', {'source': source, 'platform': kIsWeb ? 'web' : (Platform.isIOS ? 'ios' : 'android')}).ignore();
  }

  /// Where a push / inbox entry leads (the API sends `route`; older pushes carry ids).
  static String? routeOf(Map<String, dynamic> data) {
    final r = data['route']?.toString();
    if (r != null && r.startsWith('/')) return r;
    if (data['threadId'] != null) return '/chat/${data['threadId']}';
    if (data['orderId'] != null) return '/orders/${data['orderId']}/track';
    if (data['productSlug'] != null) return '/p/${data['productSlug']}';
    if (data['campaignId'] != null) return '/campaign/${data['campaignId']}';
    return null;
  }

  void dispose() {
    _refresh?.cancel();
    _opens.close();
  }
}

final pushServiceProvider = Provider<PushService>((ref) {
  final p = PushService(ref.watch(apiProvider));
  ref.onDispose(p.dispose);
  return p;
});
