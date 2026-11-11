import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartwear/brand/a_loader.dart';
import 'package:smartwear/design/theme.dart';
import 'package:smartwear/ui/kit.dart';

void main() {
  testWidgets('kit renders and the A loader animates', (t) async {
    await t.pumpWidget(ProviderScope(
      child: MaterialApp(
        theme: buildTheme(Brightness.light),
        home: const Scaffold(body: Column(children: [ALoader(size: ALoaderSize.xl), SwChip('New'), SwButton(label: 'Add to bag')])),
      ),
    ));
    await t.pump(const Duration(milliseconds: 800));
    expect(find.text('Add to bag'), findsOneWidget);
    expect(find.text('NEW'), findsOneWidget);
  });
}
