import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// The Help hub: the shopper's orders, each with its support conversation (`GET /chat/support`).
final supportHubProvider = FutureProvider.autoDispose<Json>((ref) => ref.read(apiProvider).get<Json>('/chat/support'));

/// Opens (or creates) the support conversation of an order, then shows it.
Future<void> openSupportChat(BuildContext context, WidgetRef ref, String orderId) async {
  try {
    final t = await ref.read(apiProvider).post<Json>('/chat/threads', {'orderId': orderId});
    ref.invalidate(supportHubProvider);
    if (context.mounted) await context.push('/chat/${t.str('id')}');
  } on ApiException catch (e) {
    if (context.mounted) showSwToast(context, e.isNetwork ? context.s('common.offlineAction') : e.message, error: true);
  }
}

/// "last seen 5 min ago" / "online".
String presenceLabel(BuildContext context, Json? p) {
  final s = context.s;
  if (p == null) return '';
  if (p.flag('online')) return s('chat.online');
  final at = DateTime.tryParse(p.str('lastSeenAt'))?.toLocal();
  if (at == null) return s('chat.replyTime');
  final d = DateTime.now().difference(at);
  if (d.inMinutes < 1) return s('chat.seenNow');
  if (d.inHours < 1) return s('chat.seenMinutes', {'count': d.inMinutes});
  if (d.inDays < 1) return s('chat.seenHours', {'count': d.inHours});
  return s('chat.seenDate', {'date': '${at.day}/${at.month}'});
}

/// Messages made only of emoji (≤ 3) are shown larger.
final _emojiOnly = RegExp(r'^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$', unicode: true);
bool isEmojiOnly(String body) {
  final t = body.trim();
  return t.isNotEmpty && t.runes.length <= 12 && _emojiOnly.hasMatch(t) && !RegExp(r'[0-9#*]').hasMatch(t);
}
