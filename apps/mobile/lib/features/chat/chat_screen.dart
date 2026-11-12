import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api.dart';
import '../../core/realtime.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// Opens (or reuses) the customer ↔ rider thread for an active delivery, then shows it.
Future<void> openOrderChat(BuildContext context, WidgetRef ref, String orderId) async {
  try {
    final t = await ref.read(apiProvider).post<Json>('/chat/threads', {'kind': 'order', 'orderId': orderId});
    if (context.mounted) await context.push('/chat/${t.str('id')}?title=${Uri.encodeComponent(t.str('subject', t.str('orderNumber')))}');
  } on ApiException catch (e) {
    if (context.mounted) showSwToast(context, e.message, error: true);
  }
}

/// Messages as calm bubbles; "me" in ink, the other side on surface. Live via `thread.<id>`.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.threadId, this.title});
  final String threadId;
  final String? title;
  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();
  List<Json> _items = const [];
  String? _me;
  bool _loading = true;
  void Function()? _unsub;
  StreamSubscription<RtEvent>? _sub;
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    final rt = ref.read(realtimeProvider);
    _unsub = rt.subscribe('thread.${widget.threadId}');
    _sub = rt.events.where((e) => '${e['type']}'.startsWith('chat.')).listen((_) => _load());
    _poll = Timer.periodic(const Duration(seconds: 8), (_) => _load());
    _load();
  }

  @override
  void dispose() {
    _unsub?.call();
    _sub?.cancel();
    _poll?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final r = await ref.read(apiProvider).get<Json>('/chat/threads/${widget.threadId}/messages');
      final t = r.obj('thread');
      if (!mounted) return;
      setState(() {
        _items = r.list('items');
        _me = t?.obj('customer') == null ? 'customer' : 'rider';
        _loading = false;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: SwMotion.base, curve: SwMotion.atelier);
      });
    } on ApiException {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty) return;
    _text.clear();
    setState(() => _items = [..._items, {'sender': _me, 'body': body, 'at': DateTime.now().toIso8601String(), 'pending': true}]);
    try {
      await ref.read(apiProvider).post<Json>('/chat/threads/${widget.threadId}/messages', {'body': body});
      await _load();
    } on ApiException catch (e) {
      if (mounted) showSwToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    return Scaffold(
      appBar: AppBar(
        leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.pop()),
        title: Text(widget.title ?? s('track.chat'), style: context.type.titleM),
      ),
      body: Column(children: [
        Expanded(
          child: _loading
              ? const Center(child: Skeleton(width: 220, height: 40))
              : ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s4, SwSpace.s4, SwSpace.s4),
                  itemCount: _items.length,
                  itemBuilder: (_, i) {
                    final m = _items[i];
                    final mine = m.str('sender') == _me;
                    return Align(
                      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: AnimatedOpacity(
                        opacity: m.flag('pending') ? 0.6 : 1,
                        duration: SwMotion.fast,
                        child: Container(
                          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.74),
                          margin: const EdgeInsets.only(bottom: SwSpace.s2),
                          padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
                          decoration: BoxDecoration(
                            color: mine ? c.ink : c.surface,
                            border: mine ? null : Border.all(color: c.hairline),
                            borderRadius: BorderRadius.only(topLeft: const Radius.circular(16), topRight: const Radius.circular(16), bottomLeft: Radius.circular(mine ? 16 : 4), bottomRight: Radius.circular(mine ? 4 : 16)),
                          ),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            if (!mine) Text(m.str('name'), style: context.type.labelS.copyWith(color: c.muted)),
                            Text(m.str('body'), style: context.type.bodyM.copyWith(color: mine ? c.onInk : c.ink)),
                          ]),
                        ),
                      ),
                    );
                  },
                ),
        ),
        Container(
          padding: EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s3, SwSpace.s3, SwSpace.s3 + context.safe.bottom),
          decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.hairline))),
          child: Row(children: [
            Expanded(child: SwTextField(controller: _text, hint: s('track.chat'), textInputAction: TextInputAction.send, onSubmitted: (_) => _send())),
            const SizedBox(width: SwSpace.s2),
            SwIconButton(icon: Ic.send, semanticLabel: s('track.chat'), filled: true, onPressed: _send),
          ]),
        ),
      ]),
    );
  }
}
