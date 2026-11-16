import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/api.dart';
import 'core/providers.dart';
import 'core/session_keeper.dart';
import 'design/theme.dart';
import 'l10n/strings.dart';
import 'router.dart';
import 'ui/kit.dart';

class SmartWearApp extends ConsumerWidget {
  const SmartWearApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final locale = ref.watch(localeProvider);
    ref.watch(sessionKeeperProvider);
    // The server ended the session (admin block / revoke / account deleted): go to Welcome and say why.
    ref.listen<SessionState>(sessionProvider, (prev, next) {
      if (prev?.signedIn != true || next.signedIn || next.endedBy == null) return;
      router.go('/welcome');
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = rootNavigatorKey.currentContext;
        if (ctx == null || !ctx.mounted) return;
        final s = S(ref.read(localeProvider));
        showSwToast(ctx, s(next.endedBy == SignOutReason.blocked ? 'auth.signedOut.blocked' : 'auth.signedOut.revoked'), error: true);
      });
    });
    return MaterialApp.router(
      title: 'SmartWear',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      themeMode: ref.watch(themeModeProvider),
      locale: Locale(locale),
      supportedLocales: const [Locale('en'), Locale('sw')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      // Dynamic Type: honour the user's text size up to 130% (layouts are tested at that scale).
      builder: (context, child) {
        final mq = MediaQuery.of(context);
        // One shared shimmer clock for every skeleton on screen.
        return MediaQuery(data: mq.copyWith(textScaler: mq.textScaler.clamp(maxScaleFactor: 1.3)), child: SkeletonScope(child: child!));
      },
    );
  }
}
