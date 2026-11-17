import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/providers.dart';
import 'features/auth/auth_screens.dart';
import 'features/bag/bag_screen.dart';
import 'features/campaign/campaign_screen.dart';
import 'features/chat/chat_screen.dart';
import 'features/chat/support_screen.dart';
import 'features/checkout/checkout_screen.dart';
import 'features/checkout/payment_wait_screen.dart';
import 'features/orders/orders_screen.dart';
import 'features/orders/tracking_screen.dart';
import 'features/rider/rider_screens.dart';
import 'features/discover/discover_screen.dart';
import 'features/home/home_screen.dart';
import 'features/product/product_list_screen.dart';
import 'features/product/product_screen.dart';
import 'features/profile/edit_profile_screen.dart';
import 'features/profile/notifications_screen.dart';
import 'features/profile/payments_screen.dart';
import 'features/profile/places_screen.dart';
import 'features/profile/privacy_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/profile/wholesale_screen.dart';
import 'features/profile/wishlist_screen.dart';
import 'features/search/search_screen.dart';
import 'features/shell/shell.dart';
import 'features/shell/splash.dart';

/// Root navigator; also the context for app-level toasts (e.g. "you were signed out").
final rootNavigatorKey = GlobalKey<NavigatorState>();

/// Pages that need an account. Guests are redirected to Welcome with `from`, and land back here after signing in.
const _authOnlyPrefixes = ['/orders', '/checkout', '/chat/', '/wishlist', '/places', '/payments', '/wholesale', '/notifications', '/support', '/privacy', '/profile/edit', '/rider'];
bool isAuthOnly(String loc) => _authOnlyPrefixes.any((p) => loc == p || loc.startsWith(p.endsWith('/') ? p : '$p/'));

final routerProvider = Provider<GoRouter>((ref) {
  final session = ValueNotifier(ref.read(sessionProvider));
  ref.listen(sessionProvider, (_, n) => session.value = n);
  ref.onDispose(session.dispose);
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    refreshListenable: session,
    redirect: (context, state) {
      final s = session.value;
      final loc = state.matchedLocation;
      // Until the session is read, everything waits on the splash — but remember where we were going
      // (deep link / push tap) and continue there afterwards.
      if (!s.ready) {
        if (loc == '/splash') return null;
        return '/splash?next=${Uri.encodeComponent(state.uri.toString())}';
      }
      if (loc == '/splash') {
        final next = state.uri.queryParameters['next'];
        if (next != null && next.startsWith('/') && !next.startsWith('/splash')) return next;
        return s.signedIn || ref.read(prefsProvider).getBool('sw.welcomed') == true ? '/' : '/welcome';
      }
      final completing = ref.read(sessionProvider.notifier).completingSignIn;
      // Signed-in shoppers never see Welcome or the sign-in steps (the quiz is part of onboarding).
      if (s.signedIn && !completing && (loc == '/welcome' || (loc.startsWith('/auth/') && loc != '/auth/quiz'))) return '/';
      // Account-only pages send guests to sign in, then straight back.
      if (!s.signedIn && isAuthOnly(loc)) return '/welcome?from=${Uri.encodeComponent(state.uri.toString())}';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
      GoRoute(path: '/welcome', name: 'welcome', builder: (c, s) => const WelcomeScreen()),
      GoRoute(
        path: '/auth/phone',
        name: 'auth-phone',
        builder: (c, s) => PhoneScreen(initialPhone: s.uri.queryParameters['phone'], from: s.uri.queryParameters['from'], pushed: s.uri.queryParameters['return'] == '1'),
      ),
      GoRoute(
        path: '/auth/otp',
        name: 'auth-otp',
        builder: (c, s) => OtpScreen(phone: s.uri.queryParameters['phone'] ?? '', from: s.uri.queryParameters['from'], pushed: s.uri.queryParameters['return'] == '1'),
      ),
      GoRoute(path: '/auth/quiz', name: 'auth-quiz', builder: (c, s) => const StyleQuizScreen()),
      StatefulShellRoute.indexedStack(
        builder: (c, s, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (c, s) => const HomeScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/discover', builder: (c, s) => const DiscoverScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/search', builder: (c, s) => const SearchScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/bag', builder: (c, s) => const BagScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profile', builder: (c, s) => const ProfileScreen())]),
        ],
      ),
      GoRoute(
        path: '/p/:slug',
        parentNavigatorKey: rootNavigatorKey,
        pageBuilder: (c, s) => CustomTransitionPage(
          key: s.pageKey,
          child: ProductScreen(slug: s.pathParameters['slug']!),
          transitionDuration: const Duration(milliseconds: 380),
          transitionsBuilder: (c, a, _, child) => FadeTransition(opacity: CurvedAnimation(parent: a, curve: const Cubic(0.22, 0.61, 0.36, 1)), child: child),
        ),
      ),
      GoRoute(path: '/checkout', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const CheckoutScreen()),
      GoRoute(path: '/orders', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const OrdersScreen()),
      GoRoute(
        path: '/orders/:id/track',
        parentNavigatorKey: rootNavigatorKey,
        pageBuilder: (c, s) => CustomTransitionPage(
          key: s.pageKey,
          child: TrackingScreen(orderId: s.pathParameters['id']!),
          transitionDuration: const Duration(milliseconds: 420),
          transitionsBuilder: (c, a, _, child) => FadeTransition(opacity: CurvedAnimation(parent: a, curve: const Cubic(0.22, 0.61, 0.36, 1)), child: child),
        ),
      ),
      GoRoute(path: '/orders/:id/pay', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => PaymentWaitScreen(orderId: s.pathParameters['id']!)),
      GoRoute(path: '/chat/:id', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => ChatScreen(threadId: s.pathParameters['id']!, title: s.uri.queryParameters['title'])),
      // Profile sub-pages (account-only; guests are sent to sign in by the guard above).
      GoRoute(path: '/support', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const SupportScreen()),
      GoRoute(path: '/profile/edit', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const EditProfileScreen()),
      GoRoute(path: '/wishlist', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const WishlistScreen()),
      GoRoute(path: '/places', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const PlacesScreen()),
      GoRoute(path: '/payments', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const PaymentsScreen()),
      GoRoute(path: '/wholesale', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const WholesaleScreen()),
      GoRoute(path: '/notifications', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const NotificationsScreen()),
      GoRoute(path: '/privacy', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const PrivacyScreen()),
      GoRoute(path: '/privacy/delete', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const DeleteAccountScreen()),
      GoRoute(path: '/rider', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const RiderHomeScreen()),
      GoRoute(path: '/rider/earnings', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => const RiderEarningsScreen()),
      GoRoute(path: '/campaign/:id', parentNavigatorKey: rootNavigatorKey, builder: (c, s) => CampaignScreen(id: s.pathParameters['id']!)),
      GoRoute(
        path: '/c/:slug',
        parentNavigatorKey: rootNavigatorKey,
        builder: (c, s) => ProductListScreen(category: s.pathParameters['slug'], title: s.uri.queryParameters['title']),
      ),
      GoRoute(
        path: '/collection/:slug',
        parentNavigatorKey: rootNavigatorKey,
        builder: (c, s) => ProductListScreen(collection: s.pathParameters['slug'], title: s.uri.queryParameters['title']),
      ),
    ],
  );
});
