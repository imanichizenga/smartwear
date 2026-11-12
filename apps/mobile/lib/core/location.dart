import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import 'geo.dart';

enum LocPermission { unknown, granted, denied, deniedForever, serviceOff }

class LocFix {
  const LocFix(this.point, {this.accuracy, this.heading, this.speed, this.precise = false});
  final LatLngD point;
  final double? accuracy, heading, speed;
  final bool precise;
}

bool get _testing => Platform.environment['FLUTTER_TEST'] == 'true';

/// One place for location: permission state, a fast coarse fix (last known) refined to high
/// accuracy, and a battery-aware stream for Rider Mode. Tests get a fixed fix in Mikocheni.
class LocationService {
  static const testFix = LocFix(LatLngD(-6.7712, 39.2399), accuracy: 12, precise: true);

  Future<LocPermission> permission() async {
    if (_testing) return LocPermission.granted;
    if (!await Geolocator.isLocationServiceEnabled()) return LocPermission.serviceOff;
    return _map(await Geolocator.checkPermission());
  }

  Future<LocPermission> request() async {
    if (_testing) return LocPermission.granted;
    if (!await Geolocator.isLocationServiceEnabled()) return LocPermission.serviceOff;
    return _map(await Geolocator.requestPermission());
  }

  /// Emits the last-known position at once (coarse), then a fresh high-accuracy fix.
  Stream<LocFix> fixes() async* {
    if (_testing) {
      yield testFix;
      return;
    }
    final last = await Geolocator.getLastKnownPosition();
    if (last != null) yield _fix(last, precise: false);
    try {
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best, timeLimit: Duration(seconds: 12)));
      yield _fix(p, precise: true);
    } on TimeoutException {
      // Keep the coarse fix; the UI shows its accuracy.
    }
  }

  /// Rider Mode: updates every ~10 m moved (or every few seconds via the OS), as an Android
  /// foreground service with a persistent notification / iOS background location.
  Stream<LocFix> track({required String notificationTitle, required String notificationText}) {
    if (_testing) return Stream.value(testFix);
    final LocationSettings settings = Platform.isAndroid
        ? AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 10,
            intervalDuration: const Duration(seconds: 4),
            foregroundNotificationConfig: ForegroundNotificationConfig(notificationTitle: notificationTitle, notificationText: notificationText, enableWakeLock: true, setOngoing: true),
          )
        : AppleSettings(accuracy: LocationAccuracy.best, distanceFilter: 10, activityType: ActivityType.otherNavigation, pauseLocationUpdatesAutomatically: false, showBackgroundLocationIndicator: true, allowBackgroundLocationUpdates: true);
    return Geolocator.getPositionStream(locationSettings: settings).map((p) => _fix(p, precise: true));
  }

  Future<void> openSettings() => Geolocator.openAppSettings();

  static LocFix _fix(Position p, {required bool precise}) => LocFix(LatLngD(p.latitude, p.longitude), accuracy: p.accuracy, heading: p.heading >= 0 ? p.heading : null, speed: p.speed, precise: precise);

  static LocPermission _map(LocationPermission p) => switch (p) {
        LocationPermission.always || LocationPermission.whileInUse => LocPermission.granted,
        LocationPermission.denied => LocPermission.denied,
        LocationPermission.deniedForever => LocPermission.deniedForever,
        LocationPermission.unableToDetermine => LocPermission.unknown,
      };
}

final locationServiceProvider = Provider<LocationService>((ref) => LocationService());
