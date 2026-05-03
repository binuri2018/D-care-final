import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:mobile_app/app.dart';

void main() {
  testWidgets('app boots with MaterialApp shell', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: DementiaApp()));

    expect(find.byType(DementiaApp), findsOneWidget);
    expect(find.byType(MaterialApp), findsOneWidget);
  });
}
