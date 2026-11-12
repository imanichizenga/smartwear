import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/providers.dart';
import 'features/auth/auth_screens.dart';
import 'features/bag/bag_screen.dart';
import 'features/chat/chat_screen.dart';
import 'features/checkout/checkout_screen.dart';
import 'features/checkout/payment_wait_screen.dart';
import 'features/orders/orders_screen.dart';
import 'features/orders/tracking_screen.dart';
import 'features/rider/rider_screens.dart';
import 'features/discover/discover_screen.dart';
import 'features/home/home_screen.dart';
import 'features/product/product_list_screen.dart';
import 'features/product/product_screen.dart';
import 'features/profile/profile_screen.dart';
import 'features/search/search_screen.dart';
import 'features/shell/shell.dart';
import 'features/shell/splash.dart';

final _rootKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final session = ValueNotifier(ref.read(sessionProvider));
  ref.listen(sessionProvider, (_, n) => session.value = n);
  ref.onDispose(session.dispose);
  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: session,
    redirect: (context, state) {
      final s = session.value;
      final loc = state.matchedLocation;
      if (!s.ready) return loc == '/splash' ? null : '/splash';
      if (loc == '/splash') return s.signedIn || ref.read(prefsProvider).getBool('sw.welcomed') == true ? '/' : '/welcome';
      return null;
    },
    routes: [
      GoRoute(path: '/splash', builder: (c, s) => const SplashScreen()),
      GoRoute(path: '/welcome', builder: (c, s) => const WelcomeScreen()),
      GoRoute(path: '/auth/phone', builder: (c, s) => const PhoneScreen()),
      GoRoute(path: '/auth/otp', builder: (c, s) => OtpScreen(phone: s.uri.queryParameters['phone'] ?? '')),
      GoRoute(path: '/auth/quiz', builder: (c, s) => const StyleQuizScreen()),
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
        parentNavigatorKey: _rootKey,
        pageBuilder: (c, s) => CustomTransitionPage(
          key: s.pageKey,
          child: ProductScreen(slug: s.pathParameters['slug']!),
          transitionDuration: const Duration(milliseconds: 380),
          transitionsBuilder: (c, a, _, child) => FadeTransition(opacity: CurvedAnimation(parent: a, curve: const Cubic(0.22, 0.61, 0.36, 1)), child: child),
        ),
      ),
      GoRoute(path: '/checkout', parentNavigatorKey: _rootKey, builder: (c, s) => const CheckoutScreen()),
      GoRoute(path: '/orders', parentNavigatorKey: _rootKey, builder: (c, s) => const OrdersScreen()),
      GoRoute(
        path: '/orders/:id/track',
        parentNavigatorKey: _rootKey,
        pageBuilder: (c, s) => CustomTransitionPage(
          key: s.pageKey,
          child: TrackingScreen(orderId: s.pathParameters['id']!),
          transitionDuration: const Duration(milliseconds: 420),
          transitionsBuilder: (c, a, _, child) => FadeTransition(opacity: CurvedAnimation(parent: a, curve: const Cubic(0.22, 0.61, 0.36, 1)), child: child),
        ),
      ),
      GoRoute(path: '/orders/:id/pay', parentNavigatorKey: _rootKey, builder: (c, s) => PaymentWaitScreen(orderId: s.pathParameters['id']!)),
      GoRoute(path: '/chat/:id', parentNavigatorKey: _rootKey, builder: (c, s) => ChatScreen(threadId: s.pathParameters['id']!, title: s.uri.queryParameters['title'])),
      GoRoute(path: '/rider', parentNavigatorKey: _rootKey, builder: (c, s) => const RiderHomeScreen()),
      GoRoute(path: '/rider/earnings', parentNavigatorKey: _rootKey, builder: (c, s) => const RiderEarningsScreen()),
      GoRoute(
        path: '/c/:slug',
        parentNavigatorKey: _rootKey,
        builder: (c, s) => ProductListScreen(category: s.pathParameters['slug'], title: s.uri.queryParameters['title']),
      ),
      GoRoute(
        path: '/collection/:slug',
        parentNavigatorKey: _rootKey,
        builder: (c, s) => ProductListScreen(collection: s.pathParameters['slug'], title: s.uri.queryParameters['title']),
      ),
    ],
  );
});
