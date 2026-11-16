import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwear/design/theme.dart';
import 'package:smartwear/ui/kit.dart';

Widget _host(Widget child, {double width = 390}) => ProviderScope(
      child: MaterialApp(
        theme: buildTheme(Brightness.light),
        home: Scaffold(body: Center(child: SizedBox(width: width, child: child))),
      ),
    );

void main() {
  testWidgets('fires onCompleted once per distinct complete code', (t) async {
    final ctrl = TextEditingController();
    final fired = <String>[];
    await t.pumpWidget(_host(OtpInput(controller: ctrl, length: 6, onCompleted: fired.add)));
    await t.pump();

    ctrl.text = '123456';
    await t.pump();
    // Selection changes and rebuilds notify the controller again with the same value.
    ctrl.selection = const TextSelection.collapsed(offset: 3);
    ctrl.selection = const TextSelection.collapsed(offset: 6);
    await t.pump();
    expect(fired, ['123456']);

    ctrl.text = '12345';
    await t.pump();
    ctrl.text = '123457';
    await t.pump();
    expect(fired, ['123456', '123457']);
  });

  testWidgets('ignores input while disabled', (t) async {
    final ctrl = TextEditingController();
    final fired = <String>[];
    await t.pumpWidget(_host(OtpInput(controller: ctrl, length: 6, enabled: false, onCompleted: fired.add)));
    ctrl.text = '123456';
    await t.pump();
    expect(fired, isEmpty);
  });

  testWidgets('fits a 320 dp wide screen at 1.3× text without overflow', (t) async {
    final ctrl = TextEditingController(text: '12');
    await t.pumpWidget(MediaQuery(
      data: const MediaQueryData(size: Size(320, 640), textScaler: TextScaler.linear(1.3)),
      child: _host(OtpInput(controller: ctrl, length: 6, onCompleted: (_) {}), width: 320 - 48),
    ));
    await t.pump(const Duration(milliseconds: 300));
    expect(t.takeException(), isNull);
  });
}
