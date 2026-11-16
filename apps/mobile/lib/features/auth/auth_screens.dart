import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sms_autofill/sms_autofill.dart';

import '../../core/api.dart';
import '../../core/providers.dart';
import '../../design/theme.dart';
import '../../l10n/strings.dart';
import '../../ui/kit.dart';

/// Welcome: an editorial image, the wordmark and two ways in — never more than two steps.
class WelcomeScreen extends ConsumerWidget {
  const WelcomeScreen({super.key});

  Future<void> _google(BuildContext context, WidgetRef ref) async {
    final cfg = await ref.read(configProvider.future);
    final webClientId = cfg.obj('auth')?.strN('googleWebClientId');
    if (webClientId == null || webClientId.isEmpty) {
      if (context.mounted) showSwToast(context, ref.s('common.notConfigured'), error: true);
      return;
    }
    try {
      // The web client ID comes from the API at runtime (Admin → Settings → Sign-in).
      await GoogleSignIn.instance.initialize(serverClientId: webClientId);
      final acct = await GoogleSignIn.instance.authenticate();
      final idToken = acct.authentication.idToken;
      if (idToken == null) return;
      final isNew = await ref.read(sessionProvider.notifier).google(idToken);
      if (context.mounted) {
        final q = GoRouterState.of(context).uri.queryParameters;
        finishSignIn(context, ref, isNew: isNew, from: q['from'], pushed: q['return'] == '1');
      } else {
        ref.read(sessionProvider.notifier).finishSignIn();
      }
    } on GoogleSignInException catch (e) {
      if (e.code != GoogleSignInExceptionCode.canceled && context.mounted) showSwToast(context, e.description ?? ref.s('common.error.body'), error: true);
    } on ApiException catch (e) {
      if (context.mounted) showSwToast(context, e.message, error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.s;
    const on = SwColors.dark;
    final home = ref.watch(homeProvider).value;
    final hero = home?.list('sections').where((x) => x.str('type') == 'hero').firstOrNull?.list('items').firstOrNull?.obj('media');
    final cfg = ref.watch(configProvider).value ?? const {};
    final q = GoRouterState.of(context).uri.queryParameters;
    final returning = q['return'] == '1';
    final from = q['from'];
    final authQuery = authFlowQuery(from: from, pushed: returning);
    return Scaffold(
      backgroundColor: on.canvas,
      body: Stack(fit: StackFit.expand, children: [
        if (hero != null) SwImage(hero, aspectRatio: null, radius: 0),
        DecoratedBox(decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, stops: const [0, 0.35, 1], colors: [on.canvas.withValues(alpha: 0.2), on.canvas.withValues(alpha: 0.1), on.canvas.withValues(alpha: 0.92)]))),
        SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(SwSpace.s6, SwSpace.s4, SwSpace.s6, SwSpace.s6),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Text('SMARTWEAR', style: context.type.titleS.copyWith(color: on.ink, letterSpacing: 13 * 0.32, fontSize: 13, fontWeight: FontWeight.w700)),
                const Spacer(),
                if (returning || from != null)
                  SwIconButton(icon: Ic.x, color: on.ink, semanticLabel: s('common.close'), onPressed: () => context.canPop() ? context.pop() : context.go('/')),
              ]),
              const Spacer(),
              Text(s('auth.welcome.title'), style: context.type.displayXL.copyWith(color: on.ink)),
              const SizedBox(height: SwSpace.s3),
              Text(s('auth.welcome.subtitle'), style: context.type.bodyL.copyWith(color: on.ink.withValues(alpha: 0.8))),
              const SizedBox(height: SwSpace.s8),
              _OnDarkButton(label: s('auth.google'), icon: Ic.globe, primary: true, onPressed: () => _google(context, ref)),
              const SizedBox(height: SwSpace.s3),
              _OnDarkButton(label: s('auth.phone'), icon: Ic.smartphone, onPressed: () => context.push('/auth/phone${authQuery.isEmpty ? '' : '?$authQuery'}')),
              if (!returning && from == null && cfg.feature('guestBrowsing'))
                Center(
                  child: PressableLink(
                    loaderOverlay: false,
                    onTap: () {
                      ref.read(prefsProvider).setBool('sw.welcomed', true);
                      context.go('/');
                    },
                    child: Padding(padding: const EdgeInsets.all(SwSpace.s4), child: Text(s('auth.guest'), style: context.type.titleS.copyWith(color: on.ink, decoration: TextDecoration.underline, decorationColor: on.accent))),
                  ),
                ),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// Buttons on the always-dark welcome photograph (tokens from the dark scheme).
class _OnDarkButton extends StatelessWidget {
  const _OnDarkButton({required this.label, required this.icon, required this.onPressed, this.primary = false});
  final String label;
  final IconData icon;
  final FutureOr<void> Function() onPressed;
  final bool primary;
  @override
  Widget build(BuildContext context) {
    return Theme(
      data: buildTheme(primary ? Brightness.dark : Brightness.light),
      child: Builder(builder: (context) => SwButton(label: label, icon: icon, large: true, expand: true, variant: primary ? SwButtonVariant.primary : SwButtonVariant.secondary, onPressed: onPressed)),
    );
  }
}

/// Query string that carries the sign-in context through Welcome → Phone → OTP.
///  * `from`: where the shopper was going (an auth-only page, or the page of a gated action);
///  * `return=1`: Welcome was *pushed* over that page by [requireSignIn], so finishing pops back to it and
///    the waiting action (add to bag, wishlist…) resumes.
String authFlowQuery({String? from, bool pushed = false}) => [
      if (pushed) 'return=1',
      if (from != null && from.isNotEmpty) 'from=${Uri.encodeComponent(from)}',
    ].join('&');

bool _isAuthLocation(String l) => l == '/welcome' || l.startsWith('/auth/');

/// After a successful sign-in, navigate explicitly — never by guessing how many pages to pop:
///  * pushed over a page (gated action): pop the auth pages; the page underneath is the origin;
///  * redirected from an auth-only page: go there;
///  * new shopper with the style quiz on: the quiz;
///  * otherwise Home.
void finishSignIn(BuildContext context, WidgetRef ref, {required bool isNew, String? from, bool pushed = false}) {
  ref.read(prefsProvider).setBool('sw.welcomed', true);
  final session = ref.read(sessionProvider.notifier);
  final cfg = ref.read(configProvider).value ?? const {};
  final router = GoRouter.of(context);
  if (pushed) {
    // Count the auth pages on top of the router's own match list (Welcome → Phone → OTP) and pop exactly those.
    final matches = router.routerDelegate.currentConfiguration.matches;
    var n = 0;
    for (final m in matches.reversed) {
      if (!_isAuthLocation(m.matchedLocation)) break;
      n++;
    }
    if (n > 0 && n < matches.length) {
      for (var i = 0; i < n; i++) {
        router.pop();
      }
      session.finishSignIn();
      return;
    }
  }
  if (from != null && from.startsWith('/') && !from.startsWith('/auth') && !from.startsWith('/welcome')) {
    router.go(from);
  } else if (isNew && cfg.feature('styleQuiz')) {
    router.go('/auth/quiz');
  } else {
    router.go('/');
  }
  session.finishSignIn();
}

/// Phone: +255 pre-filled, live formatting, Send code.
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key, this.initialPhone, this.from, this.pushed = false});

  /// Prefilled when coming back via "Change number" (E.164, e.g. +255712345678).
  final String? initialPhone;
  final String? from;
  final bool pushed;
  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _ctrl = TextEditingController();
  String? _error;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    final p = widget.initialPhone?.replaceAll(RegExp(r'\D'), '') ?? '';
    // +255712345678 → 712345678 → "712 345 678"
    final local = p.length > 9 ? p.substring(p.length - 9) : p;
    if (local.isNotEmpty) _ctrl.value = _TzPhoneFormatter().formatEditUpdate(TextEditingValue.empty, TextEditingValue(text: local));
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  String get _dial => ref.read(configProvider).value?.obj('auth')?.str('defaultDialCode', '+255') ?? '+255';
  String get _digits => _ctrl.text.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp(r'^0'), '');
  bool get _valid => _digits.length == 9;

  Future<void> _send() async {
    if (_sending) return;
    if (!_valid) return setState(() => _error = ref.s('auth.phone.invalid'));
    final phone = '$_dial$_digits';
    setState(() => _sending = true);
    try {
      await ref.read(sessionProvider.notifier).requestOtp(phone);
      final q = authFlowQuery(from: widget.from, pushed: widget.pushed);
      if (mounted) context.push('/auth/otp?phone=${Uri.encodeComponent(phone)}${q.isEmpty ? '' : '&$q'}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.isNetwork ? ref.s('common.offlineAction') : e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    return Scaffold(
      appBar: AppBar(leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.canPop() ? context.pop() : context.go('/welcome'))),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(SwSpace.s6, SwSpace.s4, SwSpace.s6, SwSpace.s6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s('auth.phone.title'), style: context.type.displayL),
            const SizedBox(height: SwSpace.s2),
            Text(s('auth.phone.subtitle'), style: context.type.bodyM.copyWith(color: context.sw.muted)),
            const SizedBox(height: SwSpace.s8),
            SwTextField(
              controller: _ctrl,
              autofocus: true,
              hint: s('auth.phone.placeholder'),
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumberNational],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(10), _TzPhoneFormatter()],
              prefix: Padding(padding: const EdgeInsets.only(left: SwSpace.s4, right: SwSpace.s2), child: Align(widthFactor: 1, child: Text('TZ  $_dial', style: context.type.bodyM.copyWith(fontWeight: FontWeight.w600)))),
              error: _error,
              onChanged: (_) => setState(() => _error = null),
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => _send(),
            ),
            const Spacer(),
            SwButton(label: s('auth.phone.send'), large: true, expand: true, onPressed: _valid && !_sending ? _send : null),
          ]),
        ),
      ),
    );
  }
}

/// "712345678" → "712 345 678" as you type.
class _TzPhoneFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final d = newValue.text.replaceAll(' ', '');
    final b = StringBuffer();
    for (var i = 0; i < d.length; i++) {
      if (i == 3 || i == 6) b.write(' ');
      b.write(d[i]);
    }
    return TextEditingValue(text: b.toString(), selection: TextSelection.collapsed(offset: b.length));
  }
}

/// OTP: responsive boxes, SMS autofill (Android) / one-time-code autofill (iOS), paste, auto-submit once on the
/// last digit, success state, resend with the configured cooldown, change number.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, required this.phone, this.from, this.pushed = false});
  final String phone;
  final String? from;
  final bool pushed;
  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _ctrl = TextEditingController();
  Timer? _timer;
  StreamSubscription<String>? _sms;
  int _left = 30;
  bool _busy = false, _success = false, _resending = false;
  String? _error;

  int get _cooldown => ref.read(configProvider).value?.obj('auth')?.integer('otpResendCooldownSeconds', 30) ?? 30;

  @override
  void initState() {
    super.initState();
    _left = _cooldown;
    _tick();
    _listenForSms();
  }

  /// Android SMS Retriever: the OTP SMS ends with the app hash (Admin → Settings → SMS), so the code fills in
  /// without any permission prompt. iOS uses the one-time-code autofill hint on the field.
  Future<void> _listenForSms() async {
    if (!Platform.isAndroid) return;
    try {
      _sms = SmsAutoFill().code.listen((code) {
        if (!mounted || _busy || _success) return;
        final d = code.replaceAll(RegExp(r'\D'), '');
        if (d.isNotEmpty) _ctrl.value = TextEditingValue(text: d, selection: TextSelection.collapsed(offset: d.length));
      });
      await SmsAutoFill().listenForCode();
    } catch (_) {
      // Autofill is a convenience; typing and paste still work.
    }
  }

  void _tick() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return t.cancel();
      if (_left <= 1) t.cancel();
      setState(() => _left = (_left - 1).clamp(0, 999));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _sms?.cancel();
    if (Platform.isAndroid) {
      SmsAutoFill().unregisterListener().catchError((_) {});
    }
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _verify(String code) async {
    if (_busy || _success) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final isNew = await ref.read(sessionProvider.notifier).verifyOtp(widget.phone, code);
      HapticFeedback.mediumImpact();
      if (!mounted) {
        ref.read(sessionProvider.notifier).finishSignIn();
        return;
      }
      // A brief success state before moving on.
      setState(() {
        _busy = false;
        _success = true;
      });
      await Future<void>.delayed(Duration(milliseconds: context.reduceMotion ? 120 : 420));
      if (mounted) {
        finishSignIn(context, ref, isNew: isNew, from: widget.from, pushed: widget.pushed);
      } else {
        ref.read(sessionProvider.notifier).finishSignIn();
      }
    } on ApiException catch (e) {
      HapticFeedback.heavyImpact();
      if (!mounted) return;
      _ctrl.clear();
      setState(() {
        _busy = false;
        _error = switch (e.code) {
          'otp_expired' => ref.s('auth.otp.expired'),
          'otp_too_many' || 'rate_limited' => ref.s('auth.otp.tooMany'),
          'account_blocked' => ref.s('auth.signedOut.blocked'),
          _ when e.isNetwork => ref.s('common.offlineAction'),
          _ => ref.s('auth.otp.invalid'),
        };
      });
    }
  }

  Future<void> _resend() async {
    if (_resending || _left > 0) return;
    setState(() => _resending = true);
    try {
      await ref.read(sessionProvider.notifier).requestOtp(widget.phone);
      if (!mounted) return;
      _ctrl.clear();
      setState(() {
        _error = null;
        _left = _cooldown;
      });
      _tick();
      showSwToast(context, ref.s('auth.otp.resent'));
    } on ApiException catch (e) {
      if (mounted) showSwToast(context, e.isNetwork ? ref.s('common.offlineAction') : e.message, error: true);
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  void _changeNumber() {
    // Back to the phone screen with the number still filled in.
    if (context.canPop()) {
      context.pop();
    } else {
      final q = authFlowQuery(from: widget.from, pushed: widget.pushed);
      context.go('/auth/phone?phone=${Uri.encodeComponent(widget.phone)}${q.isEmpty ? '' : '&$q'}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final c = context.sw;
    final len = ref.watch(configProvider).value?.obj('auth')?.integer('otpLength', 6) ?? 6;
    return Scaffold(
      appBar: AppBar(leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: _changeNumber)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(SwSpace.s6, SwSpace.s4, SwSpace.s6, SwSpace.s6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s('auth.otp.title'), style: context.type.displayL),
            const SizedBox(height: SwSpace.s2),
            Text(s('auth.otp.subtitle', {'phone': widget.phone}), style: context.type.bodyM.copyWith(color: c.muted)),
            const SizedBox(height: SwSpace.s8),
            OtpInput(controller: _ctrl, length: len, error: _error != null, enabled: !_busy && !_success, success: _success, pasteLabel: s('auth.otp.paste'), onCompleted: _verify),
            const SizedBox(height: SwSpace.s4),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 24),
              child: _success
                  ? Row(children: [Icon(Ic.check, size: 18, color: c.success), const SizedBox(width: SwSpace.s2), Text(s('auth.otp.verified'), style: context.type.caption.copyWith(color: c.success))])
                  : _busy
                      ? Row(children: [const PendingSwap(pending: true, child: SizedBox(width: 20, height: 20)), const SizedBox(width: SwSpace.s2), Text(s('common.loading'), style: context.type.caption)])
                      : _error != null
                          ? Text(_error!, style: context.type.caption.copyWith(color: c.danger))
                          : Text(s('auth.otp.pasteHint'), style: context.type.caption.copyWith(color: c.subtle)),
            ),
            const SizedBox(height: SwSpace.s4),
            Wrap(alignment: WrapAlignment.spaceBetween, crossAxisAlignment: WrapCrossAlignment.center, spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
              SwButton(
                label: _left > 0 ? s('auth.otp.resendIn', {'seconds': _left}) : s('auth.otp.resend'),
                variant: SwButtonVariant.ghost,
                onPressed: _left > 0 || _resending || _success ? null : _resend,
              ),
              SwButton(label: s('auth.otp.change'), variant: SwButtonVariant.ghost, onPressed: _success ? null : _changeNumber),
            ]),
          ]),
        ),
      ),
    );
  }
}

/// Optional 3-card style quiz; one tap to skip.
class StyleQuizScreen extends ConsumerStatefulWidget {
  const StyleQuizScreen({super.key});
  @override
  ConsumerState<StyleQuizScreen> createState() => _StyleQuizScreenState();
}

class _StyleQuizScreenState extends ConsumerState<StyleQuizScreen> {
  final _page = PageController();
  int _i = 0;
  final _departments = <String>{};
  final _styles = <String>{};
  final _sizes = <String, String>{};

  static const _styleOptions = ['Minimal', 'Classic', 'Bold prints', 'Streetwear', 'Modest', 'Occasion', 'Kitenge', 'Clean beauty'];

  Future<void> _done({bool skipped = false}) async {
    try {
      await ref.read(apiProvider).put<Json>('/me/style-profile', skipped
          ? {'quizCompleted': true}
          : {'departments': _departments.toList(), 'styles': _styles.toList(), 'sizes': _sizes, 'quizCompleted': true});
    } on ApiException {
      // The quiz is optional — never block the shopper on it.
    }
    ref.invalidate(homeProvider);
    if (mounted) context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final cards = [
      (s('auth.quiz.department'), Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
        for (final (k, l) in [('women', 'Women'), ('men', 'Men'), ('kids', 'Kids'), ('unisex', 'Beauty')])
          ChoiceChipSw(label: l, selected: _departments.contains(k), onTap: () => setState(() => _departments.contains(k) ? _departments.remove(k) : _departments.add(k))),
      ])),
      (s('auth.quiz.styles'), Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [
        for (final st in _styleOptions) ChoiceChipSw(label: st, selected: _styles.contains(st), onTap: () => setState(() => _styles.contains(st) ? _styles.remove(st) : _styles.add(st))),
      ])),
      (s('auth.quiz.sizes'), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        for (final (k, opts) in [('tops', ['XS', 'S', 'M', 'L', 'XL']), ('shoes', ['37', '38', '39', '40', '41', '42', '43'])]) ...[
          Text(caps(k), style: context.type.labelS.copyWith(color: context.sw.muted)),
          const SizedBox(height: SwSpace.s2),
          Wrap(spacing: SwSpace.s2, runSpacing: SwSpace.s2, children: [for (final o in opts) ChoiceChipSw(label: o, selected: _sizes[k] == o, onTap: () => setState(() => _sizes[k] = o))]),
          const SizedBox(height: SwSpace.s5),
        ],
      ])),
    ];
    return Scaffold(
      appBar: AppBar(
        automaticallyImplyLeading: false,
        title: Row(mainAxisSize: MainAxisSize.min, children: [for (var i = 0; i < 3; i++) Container(width: i == _i ? 20 : 6, height: 2, margin: const EdgeInsets.symmetric(horizontal: 3), color: i <= _i ? context.sw.ink : context.sw.hairline)]),
        actions: [SwButton(label: s('common.skip'), variant: SwButtonVariant.ghost, onPressed: () => _done(skipped: true))],
      ),
      body: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(SwSpace.s6, SwSpace.s4, SwSpace.s6, 0),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(s('auth.quiz.title'), style: context.type.displayL),
              const SizedBox(height: SwSpace.s2),
              Text(s('auth.quiz.subtitle'), style: context.type.bodyS.copyWith(color: context.sw.muted)),
            ]),
          ),
          Expanded(
            child: PageView(
              controller: _page,
              onPageChanged: (i) => setState(() => _i = i),
              children: [
                for (final (title, body) in cards)
                  Padding(
                    padding: const EdgeInsets.all(SwSpace.s6),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: context.type.displayS), const SizedBox(height: SwSpace.s5), body]),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(SwSpace.s6),
            child: SwButton(
              label: _i < 2 ? s('common.next') : s('auth.quiz.finish'),
              large: true,
              expand: true,
              onPressed: () => _i < 2 ? _page.nextPage(duration: SwMotion.slow, curve: SwMotion.atelier) : _done(),
            ),
          ),
        ]),
      ),
    );
  }
}
