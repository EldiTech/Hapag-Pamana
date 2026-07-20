// Smoke test: the app boots to the splash screen and paints the brand logo.
//
// Note: the splash schedules a navigation Timer and the shimmer / loading-dots
// controllers repeat forever, so we use a bounded `pump` rather than
// `pumpAndSettle` (which would never settle).

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/brand.dart';
import 'package:hapag_pamana/main.dart';

void main() {
  testWidgets('App boots and shows the branded logo', (tester) async {
    await tester.pumpWidget(const HapagPamanaApp());

    // Let the splash intro run a few frames (without waiting for the
    // never-ending shimmer/loading controllers to settle).
    await tester.pump(const Duration(milliseconds: 300));

    final logo = find.image(const AssetImage(AppAssets.logo));
    expect(logo, findsOneWidget);

    // The logo participates in the splash → home Hero transition.
    expect(find.byType(Hero), findsWidgets);
  });
}
