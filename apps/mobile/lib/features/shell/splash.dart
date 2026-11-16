import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../brand/a_loader.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';

/// First launch: the xl Atelier A plays while the session and runtime config load, then hands off.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});
  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen> {
  @override
  void initState() {
    super.initState();
    // Never block on the network: the session restores from secure storage (cached user, no /me wait) and the
    // config comes from its cache or safe defaults. The router leaves the splash as soon as the session is
    // ready; if storage is unusually slow, we stop waiting after 1.2 s.
    final session = ref.read(sessionProvider.notifier);
    session.restore().timeout(const Duration(milliseconds: 1200), onTimeout: session.markReady).catchError((_) => session.markReady());
    ref.read(configProvider.future).ignore();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const ALoader(size: ALoaderSize.xl, semanticLabel: 'SmartWear'),
          const SizedBox(height: SwSpace.s8),
          Text('SMARTWEAR', style: context.type.titleS.copyWith(letterSpacing: 13 * 0.28 * 1, fontSize: 13)),
        ]),
      ),
    );
  }
}
