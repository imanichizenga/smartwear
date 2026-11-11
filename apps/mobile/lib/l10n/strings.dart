import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'messages.g.dart';

/// Current UI language ('en' | 'sw'); persisted with the user's profile and on device.
final localeProvider = NotifierProvider<LocaleNotifier, String>(LocaleNotifier.new);

class LocaleNotifier extends Notifier<String> {
  @override
  String build() => 'en';
  void set(String l) => state = (l == 'sw') ? 'sw' : 'en';
}

/// Message lookup with {{var}} interpolation. Keys come from packages/shared/src/i18n.
class S {
  const S(this.locale);
  final String locale;

  String call(String key, [Map<String, Object?> vars = const {}]) {
    final raw = (locale == 'sw' ? messagesSw[key] : null) ?? messagesEn[key] ?? key;
    if (vars.isEmpty) return raw;
    return raw.replaceAllMapped(RegExp(r'\{\{(\w+)\}\}'), (m) => '${vars[m[1]] ?? ''}');
  }
}

extension StringsX on WidgetRef {
  S get s => S(watch(localeProvider));
}

extension StringsCtx on BuildContext {
  /// For widgets below a ProviderScope without a ref.
  S get s => S(ProviderScope.containerOf(this, listen: false).read(localeProvider));
}
