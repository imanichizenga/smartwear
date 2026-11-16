import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api.dart';
import '../../core/providers.dart';

/// Saved products as cards (`GET /wishlist?expand=products`), newest first.
final wishlistProductsProvider = FutureProvider.autoDispose<List<Json>>((ref) async {
  ref.watch(sessionProvider.select((s) => s.user?['id']));
  return (await ref.read(apiProvider).get<Json>('/wishlist', query: {'expand': 'products'})).list('products');
});

final savedPlacesProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(apiProvider).get<Json>('/me/places'));
final paymentMethodsProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(apiProvider).get<Json>('/me/payment-methods'));
final paymentHistoryProvider = FutureProvider.autoDispose<List<Json>>((ref) async => (await ref.read(apiProvider).get<Json>('/me/payments')).list('items'));
final wholesaleStatusProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(apiProvider).get<Json>('/me/wholesale'));
final sessionsListProvider = FutureProvider.autoDispose<List<Json>>((ref) async => (await ref.read(apiProvider).get<Json>('/me/sessions')).list('items'));

/// Inbox (`GET /me/notifications`) with optimistic mark-read.
final inboxProvider = AsyncNotifierProvider.autoDispose<InboxNotifier, Json>(InboxNotifier.new);

class InboxNotifier extends AsyncNotifier<Json> {
  @override
  Future<Json> build() => ref.read(apiProvider).get<Json>('/me/notifications');

  Future<void> markRead({List<String>? ids}) async {
    final cur = state.value;
    if (cur != null) {
      final now = DateTime.now().toUtc().toIso8601String();
      state = AsyncData({
        ...cur,
        'items': [for (final n in cur.list('items')) if (ids == null || ids.contains(n.str('id'))) {...n, 'readAt': n['readAt'] ?? now} else n],
        'unread': ids == null ? 0 : (cur.integer('unread') - ids.length).clamp(0, 1 << 30),
      });
    }
    try {
      await ref.read(apiProvider).post<Json>('/me/notifications', ids == null ? {'all': true} : {'ids': ids});
    } on ApiException {
      if (cur != null) state = AsyncData(cur);
      rethrow;
    }
  }
}

/// Notification categories the API honours (`user.notification_prefs`; missing = on).
const notificationChannels = ['order', 'chat', 'drop', 'wishlist', 'marketing', 'sms'];
