import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';

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
      if (context.mounted) _finish(context, ref, isNew);
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
    final returning = GoRouterState.of(context).uri.queryParameters['return'] == '1';
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
                if (returning) SwIconButton(icon: Ic.x, color: on.ink, semanticLabel: s('common.close'), onPressed: () => context.pop()),
              ]),
              const Spacer(),
              Text(s('auth.welcome.title'), style: context.type.displayXL.copyWith(color: on.ink)),
              const SizedBox(height: SwSpace.s3),
              Text(s('auth.welcome.subtitle'), style: context.type.bodyL.copyWith(color: on.ink.withValues(alpha: 0.8))),
              const SizedBox(height: SwSpace.s8),
              _OnDarkButton(label: s('auth.google'), icon: Ic.globe, primary: true, onPressed: () => _google(context, ref)),
              const SizedBox(height: SwSpace.s3),
              _OnDarkButton(label: s('auth.phone'), icon: Ic.smartphone, onPressed: () => context.push('/auth/phone${returning ? '?return=1' : ''}')),
              if (!returning && cfg.feature('guestBrowsing'))
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

void _finish(BuildContext context, WidgetRef ref, bool isNew) {
  ref.read(prefsProvider).setBool('sw.welcomed', true);
  final cfg = ref.read(configProvider).value ?? const {};
  if (isNew && cfg.feature('styleQuiz')) {
    context.go('/auth/quiz');
  } else if (GoRouter.of(context).canPop()) {
    while (GoRouter.of(context).canPop()) {
      GoRouter.of(context).pop();
    }
  } else {
    context.go('/');
  }
}

/// Phone: +255 pre-filled, live formatting, Send code.
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});
  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _ctrl = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  String get _dial => ref.read(configProvider).value?.obj('auth')?.str('defaultDialCode', '+255') ?? '+255';
  String get _digits => _ctrl.text.replaceAll(RegExp(r'\D'), '').replaceFirst(RegExp(r'^0'), '');
  bool get _valid => _digits.length == 9;

  Future<void> _send() async {
    if (!_valid) return setState(() => _error = ref.s('auth.phone.invalid'));
    final phone = '$_dial$_digits';
    try {
      await ref.read(sessionProvider.notifier).requestOtp(phone);
      if (mounted) context.push('/auth/otp?phone=${Uri.encodeComponent(phone)}');
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    return Scaffold(
      appBar: AppBar(leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.pop())),
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
              onSubmitted: (_) => _send(),
            ),
            const Spacer(),
            SwButton(label: s('auth.phone.send'), large: true, expand: true, onPressed: _valid ? _send : null),
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

/// OTP: six boxes, autofill, auto-submit on the 6th digit, resend countdown, change number.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({super.key, required this.phone});
  final String phone;
  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _ctrl = TextEditingController();
  Timer? _timer;
  int _left = 30;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _left = ref.read(configProvider).value?.obj('auth')?.integer('otpResendCooldownSeconds', 30) ?? 30;
    _tick();
  }

  void _tick() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (_left <= 1) t.cancel();
      setState(() => _left = (_left - 1).clamp(0, 999));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _verify(String code) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final isNew = await ref.read(sessionProvider.notifier).verifyOtp(widget.phone, code);
      HapticFeedback.mediumImpact();
      if (mounted) _finish(context, ref, isNew);
    } on ApiException catch (e) {
      HapticFeedback.heavyImpact();
      _ctrl.clear();
      setState(() => _error = switch (e.code) { 'otp_expired' => ref.s('auth.otp.expired'), 'otp_too_many' || 'rate_limited' => ref.s('auth.otp.tooMany'), _ => ref.s('auth.otp.invalid') });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.s;
    final len = ref.watch(configProvider).value?.obj('auth')?.integer('otpLength', 6) ?? 6;
    return Scaffold(
      appBar: AppBar(leading: SwIconButton(icon: Ic.arrowLeft, semanticLabel: s('common.back'), onPressed: () => context.pop())),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(SwSpace.s6, SwSpace.s4, SwSpace.s6, SwSpace.s6),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(s('auth.otp.title'), style: context.type.displayL),
            const SizedBox(height: SwSpace.s2),
            Text(s('auth.otp.subtitle', {'phone': widget.phone}), style: context.type.bodyM.copyWith(color: context.sw.muted)),
            const SizedBox(height: SwSpace.s8),
            OtpInput(controller: _ctrl, length: len, error: _error != null, enabled: !_busy, onCompleted: _verify),
            const SizedBox(height: SwSpace.s4),
            SizedBox(
              height: 24,
              child: _busy
                  ? Row(children: [const PendingSwap(pending: true, child: SizedBox(width: 20, height: 20)), const SizedBox(width: SwSpace.s2), Text(s('common.loading'), style: context.type.caption)])
                  : _error != null
                      ? Text(_error!, style: context.type.caption.copyWith(color: context.sw.danger))
                      : null,
            ),
            const SizedBox(height: SwSpace.s4),
            Row(children: [
              SwButton(
                label: _left > 0 ? s('auth.otp.resendIn', {'seconds': _left}) : s('auth.otp.resend'),
                variant: SwButtonVariant.ghost,
                onPressed: _left > 0
                    ? null
                    : () async {
                        await ref.read(sessionProvider.notifier).requestOtp(widget.phone);
                        setState(() => _left = 30);
                        _tick();
                      },
              ),
              const Spacer(),
              SwButton(label: s('auth.otp.change'), variant: SwButtonVariant.ghost, onPressed: () => context.pop()),
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
