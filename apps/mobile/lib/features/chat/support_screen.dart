import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../orders/orders_screen.dart' show OrderCardSkeletonList, orderTone;
import '../profile/sub_page.dart';
import 'chat_data.dart';

/// Help & support: every conversation is about an order. Lists the shopper's orders with the last message
/// and unread count; tapping starts or continues that order's chat.
class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final hub = ref.watch(supportHubProvider);
    final branding = ref.watch(configProvider).value?.obj('branding') ?? const {};
    return SubPage(
      title: s('profile.help'),
      body: AsyncBody<Json>(
        value: hub,
        skeleton: const OrderCardSkeletonList(count: 4),
        onRefresh: () => ref.refresh(supportHubProvider.future),
        isEmpty: (d) => d.list('items').isEmpty,
        empty: EmptyState(
          title: s('support.empty.title'),
          body: s('support.empty.body'),
          icon: Ic.messageCircle,
          action: branding.strN('supportWhatsApp') != null && branding.str('supportWhatsApp').isNotEmpty
              ? SwButton(label: s('support.whatsapp'), icon: Ic.phone, variant: SwButtonVariant.secondary, onPressed: () => launchUrl(Uri.parse('https://wa.me/${branding.str('supportWhatsApp').replaceAll(RegExp(r'\D'), '')}'), mode: LaunchMode.externalApplication))
              : null,
        ),
        builder: (context, d) => [
          _PresenceLine(presence: d.obj('presence')),
          const SizedBox(height: SwSpace.s4),
          Text(caps(s('support.pickOrder')), style: context.type.label.copyWith(color: context.sw.muted)),
          const SizedBox(height: SwSpace.s3),
          for (final it in d.list('items')) _OrderThreadRow(order: it.obj('order') ?? const {}, thread: it.obj('thread')),
        ],
      ),
    );
  }
}

class _PresenceLine extends StatelessWidget {
  const _PresenceLine({required this.presence});
  final Json? presence;
  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final online = presence?.flag('online') == true;
    return Container(
      padding: const EdgeInsets.all(SwSpace.s4),
      decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: c.hairline)),
      child: Row(children: [
        Container(width: 40, height: 40, decoration: BoxDecoration(shape: BoxShape.circle, color: c.ink), child: Icon(Ic.messageCircle, size: 18, color: c.onInk)),
        const SizedBox(width: SwSpace.s3),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(context.s('chat.supportTitle'), style: context.type.titleS),
            Row(children: [
              Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, color: online ? c.success : c.subtle)),
              const SizedBox(width: SwSpace.s1_5),
              Flexible(child: Text(presenceLabel(context, presence), style: context.type.caption.copyWith(color: c.muted))),
            ]),
          ]),
        ),
      ]),
    );
  }
}

class _OrderThreadRow extends ConsumerWidget {
  const _OrderThreadRow({required this.order, required this.thread});
  final Json order;
  final Json? thread;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final last = thread?.obj('lastMessage');
    final unread = thread?.integer('unread') ?? 0;
    final sw = ref.watch(localeProvider) == 'sw';
    return Padding(
      padding: const EdgeInsets.only(bottom: SwSpace.s3),
      child: PressableLink(
        semanticLabel: '${order.str('number')}${unread > 0 ? ', $unread ${s('notifications.unread')}' : ''}',
        onTap: () => thread != null ? context.push('/chat/${thread!.str('id')}') : openSupportChat(context, ref, order.str('id')),
        child: Container(
          padding: const EdgeInsets.all(SwSpace.s4),
          decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(SwRadius.md), border: Border.all(color: unread > 0 ? c.ink.withValues(alpha: 0.6) : c.hairline)),
          child: Row(children: [
            SizedBox(width: 48, child: SwImage(order.obj('thumbnail'), radius: SwRadius.xs)),
            const SizedBox(width: SwSpace.s4),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(order.str('number'), style: context.type.titleS, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: SwSpace.s2),
                  SwChip(sw ? order.str('statusLabelSw', order.str('statusLabel')) : order.str('statusLabel'), tone: orderTone(order.str('status'))),
                ]),
                const SizedBox(height: SwSpace.s1),
                Text(
                  last != null ? '${last.str('sender') == 'customer' ? '${s('chat.you')}: ' : ''}${last.str('body')}' : '${formatMoney(order.integer('total'), order.str('currency', 'TZS'))} · ${s('support.ask')}',
                  style: context.type.caption.copyWith(color: unread > 0 ? c.ink : c.muted, fontWeight: unread > 0 ? FontWeight.w600 : null),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ]),
            ),
            const SizedBox(width: SwSpace.s2),
            if (unread > 0)
              Container(
                constraints: const BoxConstraints(minWidth: 20),
                height: 20,
                padding: const EdgeInsets.symmetric(horizontal: 6),
                alignment: Alignment.center,
                decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(10)),
                child: Text('$unread', style: context.type.caption.copyWith(fontSize: 11, color: c.onAccent, fontWeight: FontWeight.w700)),
              )
            else
              Icon(Ic.chevronRight, size: 18, color: c.subtle),
          ]),
        ),
      ),
    );
  }
}
