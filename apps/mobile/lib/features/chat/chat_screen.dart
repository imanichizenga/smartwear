import 'dart:async';
import 'dart:math' as math;

import 'package:emoji_picker_flutter/emoji_picker_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../brand/a_loader.dart';
import '../../core/api.dart';
import '../../core/money.dart';
import '../../core/realtime.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';
import '../orders/orders_screen.dart' show orderTone;
import 'chat_data.dart';

/// Opens (or reuses) the customer ↔ rider thread for an active delivery, then shows it.
Future<void> openOrderChat(BuildContext context, WidgetRef ref, String orderId) async {
  try {
    final t = await ref.read(apiProvider).post<Json>('/chat/threads', {'kind': 'order', 'orderId': orderId});
    if (context.mounted) await context.push('/chat/${t.str('id')}?title=${Uri.encodeComponent(t.str('subject', t.str('orderNumber')))}');
  } on ApiException catch (e) {
    if (context.mounted) showSwToast(context, e.message, error: true);
  }
}

String _clientId() {
  final r = math.Random.secure();
  return 'm-${DateTime.now().microsecondsSinceEpoch}-${r.nextInt(1 << 32)}';
}

/// Order chat (support or rider). Realtime over `thread.<id>`; polling only while the socket is down.
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.threadId, this.title});
  final String threadId;
  final String? title;
  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _text = TextEditingController();
  final _focus = FocusNode();
  final _scroll = ScrollController();

  /// Oldest → newest. Local (unsent) messages carry `_state`: pending | failed.
  List<Json> _items = const [];
  Json? _thread;
  String? _cursor;
  String _me = 'customer';
  DateTime? _otherReadAt;
  Json? _presence;
  bool _loading = true;
  bool _loadingOlder = false;
  Object? _error;
  bool _emoji = false;
  int _newBelow = 0;
  DateTime? _typingUntil;
  DateTime _lastTypingSent = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _typingTimer, _poll, _readDebounce;
  final List<void Function()> _unsubs = [];
  StreamSubscription<RtEvent>? _events;
  StreamSubscription<bool>? _conn;

  Realtime get _rt => ref.read(realtimeProvider);
  Api get _api => ref.read(apiProvider);
  bool get _support => _thread?.str('kind') == 'support';

  @override
  void initState() {
    super.initState();
    _unsubs.add(_rt.subscribe('thread.${widget.threadId}'));
    _events = _rt.events.listen(_onEvent);
    _conn = _rt.connected.listen((up) => _syncPolling(up));
    _syncPolling(_rt.isConnected);
    _scroll.addListener(_onScroll);
    _focus.addListener(() {
      if (_focus.hasFocus && _emoji) setState(() => _emoji = false);
    });
    _load();
  }

  @override
  void dispose() {
    for (final u in _unsubs) {
      u();
    }
    _events?.cancel();
    _conn?.cancel();
    _poll?.cancel();
    _typingTimer?.cancel();
    _readDebounce?.cancel();
    _text.dispose();
    _focus.dispose();
    _scroll.dispose();
    super.dispose();
  }

  /// Fallback only: poll every 8 s while the realtime socket is down.
  void _syncPolling(bool socketUp) {
    _poll?.cancel();
    _poll = socketUp ? null : Timer.periodic(const Duration(seconds: 8), (_) => _load(quiet: true));
    if (socketUp && !_loading) _load(quiet: true); // catch up on anything missed while offline
  }

  bool get _atBottom => !_scroll.hasClients || _scroll.offset < 80;

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_atBottom && _newBelow > 0) setState(() => _newBelow = 0);
    // reverse list: the top (oldest) is the far end
    if (_scroll.position.extentAfter < 400) _loadOlder();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final r = await _api.get<Json>('/chat/threads/${widget.threadId}/messages');
      if (!mounted) return;
      final t = r.obj('thread');
      final first = _thread == null;
      setState(() {
        _thread = t;
        _me = t?.obj('customer') == null ? 'customer' : 'rider';
        _otherReadAt = DateTime.tryParse(t?.str('otherReadAt') ?? '');
        _presence = t?.obj('presence') ?? _presence;
        _cursor = first ? r.strN('nextCursor') : _cursor;
        _items = _merge(r.list('items'), keepOlder: !first);
        _loading = false;
        _error = null;
      });
      if (first && t?.str('kind') == 'support') _unsubs.add(_rt.subscribe('support.presence'));
    } on ApiException catch (e) {
      if (mounted && !quiet) setState(() {
        _loading = false;
        _error = _thread == null ? e : null;
      });
    }
  }

  /// Merge server messages with what's on screen: server copies replace optimistic ones (by clientId),
  /// failed/pending local messages stay, older pages already loaded are kept.
  List<Json> _merge(List<Json> incoming, {bool keepOlder = true}) {
    final current = keepOlder ? _items : const <Json>[];
    final server = <String, Json>{};
    final delivered = <String>{};
    for (final m in [...current, ...incoming]) {
      if (m['id'] == null) continue;
      server['${m['id']}'] = m; // newer copy wins
      if (m['clientId'] != null) delivered.add('${m['clientId']}');
    }
    final locals = [for (final m in current) if (m['id'] == null && !delivered.contains('${m['clientId']}')) m];
    return [...server.values, ...locals]..sort((a, b) => a.str('at').compareTo(b.str('at')));
  }

  Future<void> _loadOlder() async {
    if (_loadingOlder || _cursor == null) return;
    setState(() => _loadingOlder = true);
    try {
      final r = await _api.get<Json>('/chat/threads/${widget.threadId}/messages', query: {'cursor': _cursor});
      if (!mounted) return;
      setState(() {
        _cursor = r.strN('nextCursor');
        _items = _merge(r.list('items'));
      });
    } on ApiException {
      // try again on the next scroll
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  void _onEvent(RtEvent e) {
    if (!mounted) return;
    final type = e['type'];
    if (type == 'presence.changed' && e['who'] == 'staff' && _support) {
      setState(() => _presence = {'online': e['online'] == true, 'lastSeenAt': e['lastSeenAt']});
      return;
    }
    if (e['threadId'] != widget.threadId) return;
    switch (type) {
      case 'chat.message':
        final m = Map<String, dynamic>.from(e['message'] as Map);
        final mine = m.str('sender') == _me;
        final wasAtBottom = _atBottom;
        setState(() {
          _items = _merge([m]);
          if (!mine) {
            _typingUntil = null;
            if (!wasAtBottom) _newBelow++;
          }
        });
        if (!mine) _markReadSoon();
      case 'chat.read':
        if (e['by'] != _me) setState(() => _otherReadAt = DateTime.tryParse('${e['at']}'));
      case 'chat.typing':
        if (e['by'] != _me) {
          setState(() => _typingUntil = DateTime.now().add(const Duration(seconds: 4)));
          _typingTimer?.cancel();
          _typingTimer = Timer(const Duration(seconds: 4), () {
            if (mounted) setState(() => _typingUntil = null);
          });
        }
    }
  }

  /// Visible + new message from the other side → tell the server we read it (debounced).
  void _markReadSoon() {
    _readDebounce?.cancel();
    _readDebounce = Timer(const Duration(milliseconds: 600), () {
      if (mounted && TickerMode.of(context)) _api.post<Json>('/chat/threads/${widget.threadId}/read').ignore();
    });
  }

  void _onTyping(String v) {
    if (v.trim().isEmpty) return;
    final now = DateTime.now();
    if (now.difference(_lastTypingSent) < const Duration(seconds: 2)) return;
    _lastTypingSent = now;
    _rt.emit({'type': 'chat.typing', 'threadId': widget.threadId});
  }

  Future<void> _send([Json? retry]) async {
    final body = retry?.str('body') ?? _text.text.trim();
    if (body.isEmpty) return;
    final clientId = retry?.str('clientId') ?? _clientId();
    if (retry == null) _text.clear();
    HapticFeedback.selectionClick();
    final local = <String, dynamic>{'clientId': clientId, 'sender': _me, 'body': body, 'at': DateTime.now().toUtc().toIso8601String(), '_state': 'pending'};
    setState(() {
      _items = [for (final m in _items) if (m['clientId'] != clientId || m['id'] != null) m, local];
      _newBelow = 0;
    });
    _jumpToBottom();
    try {
      final m = await _api.post<Json>('/chat/threads/${widget.threadId}/messages', {'body': body, 'clientId': clientId});
      if (!mounted) return;
      setState(() => _items = _merge([m]).where((x) => !(x['id'] == null && x['clientId'] == clientId)).toList());
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _items = [for (final x in _items) if (x['clientId'] == clientId && x['id'] == null) {...x, '_state': 'failed'} else x]);
      if (e.code == 'thread_closed') showSwToast(context, e.message, error: true);
    }
  }

  void _jumpToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(0, duration: SwMotion.base, curve: SwMotion.atelier);
    });
  }

  void _toggleEmoji() {
    if (_emoji) {
      setState(() => _emoji = false);
      _focus.requestFocus();
    } else {
      _focus.unfocus();
      SystemChannels.textInput.invokeMethod<void>('TextInput.hide');
      setState(() => _emoji = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final t = _thread;
    final canReply = t == null || t['canReply'] != false;
    final typing = _typingUntil != null && _typingUntil!.isAfter(DateTime.now());
    final title = _support ? s('chat.supportTitle') : (widget.title ?? s('track.chat'));
    final status = typing ? s('chat.typing') : (_support ? presenceLabel(context, _presence) : null);
    return PopScope(
      canPop: !_emoji,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop && _emoji) setState(() => _emoji = false);
      },
      child: Scaffold(
        appBar: AppBar(
          leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.canPop() ? context.pop() : context.go('/support')),
          titleSpacing: 0,
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            Text(title, style: context.type.titleM, maxLines: 1, overflow: TextOverflow.ellipsis),
            if (status != null && status.isNotEmpty)
              Row(mainAxisSize: MainAxisSize.min, children: [
                if (_support && !typing) ...[
                  Container(width: 7, height: 7, decoration: BoxDecoration(shape: BoxShape.circle, color: _presence?.flag('online') == true ? c.success : c.subtle)),
                  const SizedBox(width: SwSpace.s1_5),
                ],
                Flexible(child: Text(status, style: context.type.caption.copyWith(color: typing ? c.accent : c.muted), maxLines: 1, overflow: TextOverflow.ellipsis)),
              ]),
          ]),
        ),
        body: Column(children: [
          if (t?.obj('order') != null) _OrderBanner(order: t!.obj('order')!),
          Expanded(
            child: _loading
                ? const _ChatSkeleton()
                : _error != null
                    ? Center(child: LoadError(error: _error!, onRetry: () => _load()))
                    : Stack(children: [
                        GestureDetector(
                          onTap: () {
                            _focus.unfocus();
                            if (_emoji) setState(() => _emoji = false);
                          },
                          child: _items.isEmpty
                              ? Center(child: EmptyState(title: s('chat.empty.title'), body: s('chat.empty.body'), icon: Ic.messageCircle))
                              : _MessageList(
                                  controller: _scroll,
                                  items: _items,
                                  me: _me,
                                  otherReadAt: _otherReadAt,
                                  loadingOlder: _loadingOlder,
                                  typing: typing,
                                  onRetry: _send,
                                ),
                        ),
                        if (_newBelow > 0)
                          Positioned(
                            bottom: SwSpace.s3,
                            left: 0,
                            right: 0,
                            child: Center(
                              child: PressableLink(
                                loaderOverlay: false,
                                onTap: () {
                                  setState(() => _newBelow = 0);
                                  _jumpToBottom();
                                },
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s2),
                                  decoration: BoxDecoration(color: c.ink, borderRadius: BorderRadius.circular(SwRadius.full)),
                                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                                    Icon(Ic.chevronDown, size: 16, color: c.onInk),
                                    const SizedBox(width: SwSpace.s1),
                                    Text(s('chat.newMessages', {'count': _newBelow}), style: context.type.caption.copyWith(color: c.onInk, fontWeight: FontWeight.w600)),
                                  ]),
                                ),
                              ),
                            ),
                          ),
                      ]),
          ),
          if (!canReply)
            Container(
              width: double.infinity,
              padding: EdgeInsets.fromLTRB(SwSpace.s5, SwSpace.s4, SwSpace.s5, SwSpace.s4 + context.bottomInset),
              color: c.surface,
              child: Text(s('chat.readOnly'), style: context.type.bodyS.copyWith(color: c.muted), textAlign: TextAlign.center),
            )
          else
            _Composer(
              controller: _text,
              focus: _focus,
              emojiOpen: _emoji,
              onEmoji: _toggleEmoji,
              onSend: () => _send(),
              onChanged: _onTyping,
            ),
          if (_emoji && canReply)
            SizedBox(
              height: 280 + MediaQuery.paddingOf(context).bottom,
              child: Padding(
                padding: EdgeInsets.only(bottom: MediaQuery.paddingOf(context).bottom),
                child: EmojiPicker(
                  textEditingController: _text,
                  onEmojiSelected: (_, _) => setState(() {}),
                  config: Config(
                    height: 280,
                    checkPlatformCompatibility: true,
                    emojiViewConfig: EmojiViewConfig(columns: 8, emojiSizeMax: 28, backgroundColor: c.canvas),
                    categoryViewConfig: CategoryViewConfig(backgroundColor: c.surface, indicatorColor: c.accent, iconColorSelected: c.ink),
                    bottomActionBarConfig: BottomActionBarConfig(showBackspaceButton: true, showSearchViewButton: false, backgroundColor: c.surface),
                    searchViewConfig: SearchViewConfig(backgroundColor: c.surface),
                  ),
                ),
              ),
            ),
        ]),
      ),
    );
  }
}

/* ------------------------------------------------------------------ pieces */

/// The order the conversation is about, always visible under the app bar. Tap → tracking.
class _OrderBanner extends ConsumerWidget {
  const _OrderBanner({required this.order});
  final Json order;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    final placed = DateTime.tryParse(order.str('placedAt'))?.toLocal();
    final sw = ref.watch(localeProvider) == 'sw';
    return PressableLink(
      loaderOverlay: false,
      scale: false,
      semanticLabel: '${s('chat.aboutOrder')} ${order.str('number')}',
      onTap: () => context.push('/orders/${order.str('id')}/track'),
      child: Container(
        padding: const EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s3, SwSpace.s3, SwSpace.s3),
        decoration: BoxDecoration(color: c.surface, border: Border(bottom: BorderSide(color: c.hairline))),
        child: Row(children: [
          SizedBox(width: 40, child: SwImage(order.obj('thumbnail'), radius: SwRadius.xs)),
          const SizedBox(width: SwSpace.s3),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text(order.str('number'), style: context.type.titleS, maxLines: 1, overflow: TextOverflow.ellipsis)),
                const SizedBox(width: SwSpace.s2),
                SwChip(sw ? order.str('statusLabelSw', order.str('statusLabel')) : order.str('statusLabel'), tone: orderTone(order.str('status'))),
              ]),
              const SizedBox(height: 2),
              Text(
                [if (placed != null) '${placed.day}/${placed.month}/${placed.year}', s('checkout.items', {'count': order.integer('itemCount')}), formatMoney(order.integer('total'), order.str('currency', 'TZS'))].join(' · '),
                style: context.type.caption.copyWith(color: c.muted),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ]),
          ),
          Icon(Ic.chevronRight, size: 18, color: c.subtle),
        ]),
      ),
    );
  }
}

class _MessageList extends StatelessWidget {
  const _MessageList({required this.controller, required this.items, required this.me, required this.otherReadAt, required this.loadingOlder, required this.typing, required this.onRetry});
  final ScrollController controller;
  final List<Json> items;
  final String me;
  final DateTime? otherReadAt;
  final bool loadingOlder, typing;
  final void Function(Json) onRetry;

  static DateTime _at(Json m) => DateTime.tryParse(m.str('at'))?.toLocal() ?? DateTime.now();
  static bool _sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  @override
  Widget build(BuildContext context) {
    // reverse: index 0 is the newest, at the bottom.
    final n = items.length;
    return ListView.builder(
      controller: controller,
      reverse: true,
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s3, SwSpace.s4, SwSpace.s3),
      itemCount: n + 2,
      itemBuilder: (context, i) {
        if (i == 0) return typing ? const _TypingBubble() : const SizedBox.shrink();
        if (i == n + 1) return loadingOlder ? const Padding(padding: EdgeInsets.all(SwSpace.s4), child: Center(child: ALoader(size: ALoaderSize.xs))) : const SizedBox.shrink();
        final idx = n - i; // oldest-first index
        final m = items[idx];
        final prev = idx > 0 ? items[idx - 1] : null;
        final next = idx < n - 1 ? items[idx + 1] : null;
        final at = _at(m);
        final newDay = prev == null || !_sameDay(_at(prev), at);
        final groupedWithPrev = !newDay && prev != null && prev.str('sender') == m.str('sender') && at.difference(_at(prev)).inMinutes < 5;
        final groupedWithNext = next != null && next.str('sender') == m.str('sender') && _sameDay(_at(next), at) && _at(next).difference(at).inMinutes < 5;
        return Column(children: [
          if (newDay) _DaySeparator(at: at),
          _Bubble(m: m, mine: m.str('sender') == me, showName: !groupedWithPrev, tailed: !groupedWithNext, read: otherReadAt != null && m['id'] != null && !_at(m).isAfter(otherReadAt!.toLocal()), onRetry: () => onRetry(m)),
        ]);
      },
    );
  }
}

class _DaySeparator extends StatelessWidget {
  const _DaySeparator({required this.at});
  final DateTime at;
  @override
  Widget build(BuildContext context) {
    final s = context.s;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final day = DateTime(at.year, at.month, at.day);
    final diff = today.difference(day).inDays;
    final label = diff == 0 ? s('chat.today') : diff == 1 ? s('chat.yesterday') : '${at.day}/${at.month}/${at.year}';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: SwSpace.s4),
      child: Row(children: [
        const Expanded(child: Hairline()),
        Padding(padding: const EdgeInsets.symmetric(horizontal: SwSpace.s3), child: Text(caps(label), style: context.type.labelS.copyWith(color: context.sw.subtle))),
        const Expanded(child: Hairline()),
      ]),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.m, required this.mine, required this.showName, required this.tailed, required this.read, required this.onRetry});
  final Json m;
  final bool mine, showName, tailed, read;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    final s = context.s;
    final state = m.strN('_state');
    final failed = state == 'failed';
    final body = m.str('body');
    final emoji = isEmojiOnly(body);
    final at = DateTime.tryParse(m.str('at'))?.toLocal();
    final time = at == null ? '' : '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
    final meta = Row(mainAxisSize: MainAxisSize.min, children: [
      Text(time, style: context.type.caption.copyWith(fontSize: 11, color: mine && !emoji ? c.onInk.withValues(alpha: 0.7) : c.subtle)),
      if (mine) ...[
        const SizedBox(width: 4),
        if (failed)
          Icon(Ic.circleAlert, size: 13, color: c.danger)
        else if (state == 'pending')
          Icon(Ic.clock, size: 12, color: emoji ? c.subtle : c.onInk.withValues(alpha: 0.7))
        else
          _Ticks(read: read, color: emoji ? c.subtle : c.onInk.withValues(alpha: read ? 1 : 0.7), accent: c.accent),
      ],
    ]);
    final radius = BorderRadius.only(
      topLeft: const Radius.circular(16),
      topRight: const Radius.circular(16),
      bottomLeft: Radius.circular(mine || !tailed ? 16 : 4),
      bottomRight: Radius.circular(!mine || !tailed ? 16 : 4),
    );
    Widget bubble = emoji
        ? Padding(
            padding: const EdgeInsets.symmetric(vertical: SwSpace.s1),
            child: Column(crossAxisAlignment: mine ? CrossAxisAlignment.end : CrossAxisAlignment.start, children: [Text(body, style: const TextStyle(fontSize: 40, height: 1.15)), meta]),
          )
        : Container(
            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.76),
            padding: const EdgeInsets.fromLTRB(SwSpace.s4, SwSpace.s2, SwSpace.s3, SwSpace.s2),
            decoration: BoxDecoration(color: mine ? c.ink : c.surface, border: mine ? null : Border.all(color: c.hairline), borderRadius: radius),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              if (!mine && showName) Padding(padding: const EdgeInsets.only(bottom: 2), child: Text(m.str('name'), style: context.type.labelS.copyWith(color: c.muted))),
              Wrap(alignment: WrapAlignment.end, crossAxisAlignment: WrapCrossAlignment.end, spacing: SwSpace.s2, children: [
                Text(body, style: context.type.bodyM.copyWith(color: mine ? c.onInk : c.ink)),
                Padding(padding: const EdgeInsets.only(top: 4), child: meta),
              ]),
            ]),
          );
    if (failed) {
      bubble = PressableLink(
        loaderOverlay: false,
        semanticLabel: s('chat.retry'),
        onTap: onRetry,
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Opacity(opacity: 0.7, child: bubble),
          Padding(padding: const EdgeInsets.only(top: 2), child: Text(s('chat.failedTapRetry'), style: context.type.caption.copyWith(color: c.danger))),
        ]),
      );
    }
    return Padding(
      padding: EdgeInsets.only(top: showName ? SwSpace.s2 : 2),
      child: Align(alignment: mine ? Alignment.centerRight : Alignment.centerLeft, child: AnimatedOpacity(opacity: state == 'pending' ? 0.75 : 1, duration: SwMotion.fast, child: bubble)),
    );
  }
}

/// ✓ sent, ✓✓ read (accent).
class _Ticks extends StatelessWidget {
  const _Ticks({required this.read, required this.color, required this.accent});
  final bool read;
  final Color color, accent;
  @override
  Widget build(BuildContext context) {
    final col = read ? accent : color;
    return Semantics(
      label: read ? context.s('chat.read') : context.s('chat.sent'),
      child: SizedBox(
        width: read ? 18 : 12,
        height: 12,
        child: Stack(children: [
          Positioned(left: 0, child: Icon(Ic.check, size: 12, color: col)),
          if (read) Positioned(left: 6, child: Icon(Ic.check, size: 12, color: col)),
        ]),
      ),
    );
  }
}

class _TypingBubble extends StatefulWidget {
  const _TypingBubble();
  @override
  State<_TypingBubble> createState() => _TypingBubbleState();
}

class _TypingBubbleState extends State<_TypingBubble> with SingleTickerProviderStateMixin {
  late final AnimationController _a = AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat();
  @override
  void dispose() {
    _a.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sw;
    return Padding(
      padding: const EdgeInsets.only(top: SwSpace.s2),
      child: Align(
        alignment: Alignment.centerLeft,
        child: Semantics(
          label: context.s('chat.typing'),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
            decoration: BoxDecoration(color: c.surface, border: Border.all(color: c.hairline), borderRadius: BorderRadius.circular(16)),
            child: AnimatedBuilder(
              animation: _a,
              builder: (context, _) => Row(mainAxisSize: MainAxisSize.min, children: [
                for (var i = 0; i < 3; i++)
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: Opacity(
                      opacity: context.reduceMotion ? 0.6 : 0.3 + 0.7 * (0.5 + 0.5 * math.sin((_a.value * 2 * math.pi) - i * 0.9)).clamp(0, 1),
                      child: Container(width: 6, height: 6, decoration: BoxDecoration(color: c.muted, shape: BoxShape.circle)),
                    ),
                  ),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

class _Composer extends ConsumerWidget {
  const _Composer({required this.controller, required this.focus, required this.emojiOpen, required this.onEmoji, required this.onSend, required this.onChanged});
  final TextEditingController controller;
  final FocusNode focus;
  final bool emojiOpen;
  final VoidCallback onEmoji, onSend;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    final c = context.sw;
    return Container(
      padding: EdgeInsets.fromLTRB(SwSpace.s2, SwSpace.s2, SwSpace.s3, SwSpace.s2 + (emojiOpen ? 0 : context.bottomInset)),
      decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.hairline))),
      child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        // The Lucide subset has no smiley; Material's outline emoji icon matches the thin style.
        Semantics(
          button: true,
          label: emojiOpen ? s('chat.keyboard') : s('chat.emoji'),
          child: IconButton(
            onPressed: onEmoji,
            iconSize: 24,
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            icon: Icon(emojiOpen ? Icons.keyboard_outlined : Icons.emoji_emotions_outlined, color: c.muted),
          ),
        ),
        Expanded(
          child: TextField(
            controller: controller,
            focusNode: focus,
            minLines: 1,
            maxLines: 5,
            maxLength: 4000,
            textCapitalization: TextCapitalization.sentences,
            keyboardType: TextInputType.multiline,
            onChanged: onChanged,
            style: context.type.bodyM,
            cursorColor: c.ink,
            decoration: InputDecoration(
              isDense: true,
              counterText: '',
              hintText: s('chat.placeholder'),
              hintStyle: context.type.bodyM.copyWith(color: c.subtle),
              filled: true,
              fillColor: c.canvas,
              contentPadding: const EdgeInsets.symmetric(horizontal: SwSpace.s4, vertical: SwSpace.s3),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide(color: c.hairline)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide(color: c.hairline)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide(color: c.ink, width: 1.2)),
            ),
          ),
        ),
        const SizedBox(width: SwSpace.s2),
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: controller,
          builder: (context, v, _) => SwIconButton(icon: Ic.send, semanticLabel: s('chat.send'), filled: true, onPressed: v.text.trim().isEmpty ? null : onSend),
        ),
      ]),
    );
  }
}

/// Alternating left/right bubbles (the order banner is real, above it).
class _ChatSkeleton extends StatelessWidget {
  const _ChatSkeleton();
  @override
  Widget build(BuildContext context) {
    const widths = [180.0, 120.0, 220.0, 90.0, 160.0, 200.0];
    return SkeletonList(
      count: widths.length,
      gap: SwSpace.s3,
      itemBuilder: (context, i) => Align(
        alignment: i.isEven ? Alignment.centerLeft : Alignment.centerRight,
        child: SkeletonBox(width: widths[i], height: i % 3 == 2 ? 56 : 40, radius: 16),
      ),
    );
  }
}
