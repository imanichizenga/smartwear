import 'package:flutter/cupertino.dart' show CupertinoPageTransitionsBuilder;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'tokens.g.dart';

export 'tokens.g.dart';

/// SmartWear Atelier theme. Screens read colours and type ONLY through `context.sw` / `context.type`
/// (enforced by analysis_options: no Color(…) literals or raw TextStyle in lib/features).
@immutable
class SwTheme extends ThemeExtension<SwTheme> {
  const SwTheme(this.colors, this.brightness);
  final SwColors colors;
  final Brightness brightness;

  bool get isDark => brightness == Brightness.dark;

  @override
  SwTheme copyWith({SwColors? colors, Brightness? brightness}) => SwTheme(colors ?? this.colors, brightness ?? this.brightness);

  @override
  SwTheme lerp(ThemeExtension<SwTheme>? other, double t) {
    if (other is! SwTheme) return this;
    return SwTheme(SwColors.lerp(colors, other.colors, t), t < 0.5 ? brightness : other.brightness);
  }
}

/// Typography built from the generated text specs: Fraunces for display & prices, Manrope for UI.
class SwType {
  SwType(this._ink);
  final Color _ink;

  static TextStyle fromSpec(SwTextSpec s, Color color) => TextStyle(
        fontFamily: s.display ? 'Fraunces' : 'Manrope',
        fontSize: s.size,
        fontWeight: FontWeight.values[(s.weight ~/ 100) - 1],
        letterSpacing: s.trackingEm * s.size,
        height: s.lineHeight / s.size,
        color: color,
        leadingDistribution: TextLeadingDistribution.even,
      );

  TextStyle _s(SwTextSpec s) => fromSpec(s, _ink);

  late final TextStyle displayXL = _s(SwTextSpecs.displayXL);
  late final TextStyle displayL = _s(SwTextSpecs.displayL);
  late final TextStyle displayM = _s(SwTextSpecs.displayM);
  late final TextStyle displayS = _s(SwTextSpecs.displayS);
  late final TextStyle titleL = _s(SwTextSpecs.titleL);
  late final TextStyle titleM = _s(SwTextSpecs.titleM);
  late final TextStyle titleS = _s(SwTextSpecs.titleS);
  late final TextStyle bodyL = _s(SwTextSpecs.bodyL);
  late final TextStyle bodyM = _s(SwTextSpecs.bodyM);
  late final TextStyle bodyS = _s(SwTextSpecs.bodyS);
  late final TextStyle caption = _s(SwTextSpecs.caption);
  late final TextStyle label = _s(SwTextSpecs.label);
  late final TextStyle labelS = _s(SwTextSpecs.labelS);
  late final TextStyle priceL = _s(SwTextSpecs.priceL);
  late final TextStyle priceM = _s(SwTextSpecs.priceM);
  late final TextStyle priceS = _s(SwTextSpecs.priceS);
}

extension SwContext on BuildContext {
  SwColors get sw => Theme.of(this).extension<SwTheme>()!.colors;
  bool get isDark => Theme.of(this).extension<SwTheme>()!.isDark;
  SwType get type => SwType(sw.ink);
  EdgeInsets get safe => MediaQuery.paddingOf(this);
  bool get reduceMotion => MediaQuery.of(this).disableAnimations;
}

/// Upper-cased label text helper (labels are uppercase by spec).
String caps(String s) => s.toUpperCase();

ThemeData buildTheme(Brightness b) {
  final c = b == Brightness.dark ? SwColors.dark : SwColors.light;
  final type = SwType(c.ink);
  final scheme = ColorScheme(
    brightness: b,
    primary: c.ink,
    onPrimary: c.onInk,
    secondary: c.accent,
    onSecondary: c.onAccent,
    error: c.danger,
    onError: c.onInk,
    surface: c.surface,
    onSurface: c.ink,
  );
  return ThemeData(
    useMaterial3: true,
    brightness: b,
    colorScheme: scheme,
    scaffoldBackgroundColor: c.canvas,
    canvasColor: c.canvas,
    fontFamily: 'Manrope',
    splashFactory: NoSplash.splashFactory,
    highlightColor: Colors.transparent,
    hoverColor: c.ink.withValues(alpha: 0.04),
    dividerColor: c.hairline,
    dividerTheme: DividerThemeData(color: c.hairline, thickness: 1, space: 1),
    textTheme: TextTheme(
      displayLarge: type.displayXL,
      displayMedium: type.displayL,
      displaySmall: type.displayM,
      headlineMedium: type.displayS,
      titleLarge: type.titleL,
      titleMedium: type.titleM,
      titleSmall: type.titleS,
      bodyLarge: type.bodyL,
      bodyMedium: type.bodyM,
      bodySmall: type.bodyS,
      labelLarge: type.titleS,
      labelSmall: type.caption,
    ),
    textSelectionTheme: TextSelectionThemeData(cursorColor: c.ink, selectionColor: c.accentSoft, selectionHandleColor: c.accent),
    appBarTheme: AppBarTheme(
      backgroundColor: c.canvas,
      foregroundColor: c.ink,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
      titleTextStyle: type.titleM,
      systemOverlayStyle: b == Brightness.dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      modalBackgroundColor: c.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(SwRadius.lg))),
      showDragHandle: false,
    ),
    pageTransitionsTheme: const PageTransitionsTheme(builders: {
      TargetPlatform.android: FadeForwardsPageTransitionsBuilder(),
      TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
    }),
    extensions: [SwTheme(c, b)],
  );
}
