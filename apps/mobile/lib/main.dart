import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'core/api.dart';
import 'core/providers.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
  final prefs = await SharedPreferences.getInstance();
  runApp(ProviderScope(
    overrides: [
      prefsProvider.overrideWithValue(prefs),
      // The device id is mirrored to prefs so a keystore hiccup can never change it under a live session.
      tokenStoreProvider.overrideWithValue(TokenStore(backup: PrefsKv(prefs))),
    ],
    child: const SmartWearApp(),
  ));
}
