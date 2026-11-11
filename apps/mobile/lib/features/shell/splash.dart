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
    Future.wait([
      ref.read(sessionProvider.notifier).restore(),
      ref.read(configProvider.future).catchError((_) => <String, dynamic>{}),
      Future<void>.delayed(const Duration(milliseconds: 1100)),
    ]);
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
