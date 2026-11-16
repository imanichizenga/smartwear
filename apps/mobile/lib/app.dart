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
        return MediaQuery(
          data: mq.copyWith(textScaler: mq.textScaler.clamp(maxScaleFactor: 1.3)),
          child: SkeletonScope(child: Stack(fit: StackFit.expand, children: [child!, const _OfflineBanner()])),
        );
      },
    );
  }
}

/// "You are offline. Showing saved content." — slides in under the status bar while the API can't be
/// reached, and away again as soon as a request (or the realtime socket) gets through.
class _OfflineBanner extends ConsumerWidget {
  const _OfflineBanner();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final offline = !ref.watch(onlineProvider);
    final c = context.sw;
    return Positioned(
      top: MediaQuery.paddingOf(context).top + SwSpace.s2,
      left: SwSpace.s5,
      right: SwSpace.s5,
      child: IgnorePointer(
        child: AnimatedSlide(
          offset: offline ? Offset.zero : const Offset(0, -2),
          duration: context.reduceMotion ? Duration.zero : SwMotion.base,
          curve: SwMotion.atelier,
          child: AnimatedOpacity(
            opacity: offline ? 1 : 0,
            duration: SwMotion.base,
            child: Center(
              child: Semantics(
                liveRegion: true,
                child: Material(
                  type: MaterialType.transparency,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s2),
                    decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.full)),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Ic.wifiOff, size: 14, color: c.onInk),
                      const SizedBox(width: SwSpace.s2),
                      Flexible(child: Text(S(ref.watch(localeProvider))('common.offline'), style: context.type.caption.copyWith(color: c.onInk), maxLines: 2, textAlign: TextAlign.center)),
                    ]),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
