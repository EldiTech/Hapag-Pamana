// The member Settings module: every screen paints, and the rows that used to
// say "coming soon" now go somewhere.
//
// These run without Firebase. `MemberPreferencesScope.load()` swallows the
// missing-Firebase failure by design (settings are a convenience — the shell has
// to come up regardless), so the screens render off the in-memory defaults. That
// also means nothing here writes: what's covered is the wiring and the copy, not
// the Firestore round-trip.
//
// As in `widget_test.dart`, entrances are advanced with a bounded `pump` rather
// than `pumpAndSettle` — the shimmer controllers repeat forever.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/brand.dart';
import 'package:hapag_pamana/data/allergens.dart';
import 'package:hapag_pamana/data/member_preferences.dart';
import 'package:hapag_pamana/screens/user/settings/settings.dart';
import 'package:hapag_pamana/widgets.dart';

/// Pumps [page] inside the real app theme, on a Navigator that can push.
///
/// The surface is made tall on purpose: every settings screen is a lazily-built
/// [ListView], so on a phone-sized viewport the rows below the fold are never
/// built and can't be found at all. Long documents are still scrolled to (see
/// the policy test) rather than assuming everything fits.
Future<void> _open(WidgetTester tester, Widget page) async {
  tester.view.physicalSize = const Size(1000, 3600);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(MaterialApp(theme: AppTheme.light(), home: page));
  await tester.pump(const Duration(milliseconds: 600));
}

/// Scrolls [finder] into view from wherever it is down the list.
Future<void> _scrollTo(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 400, maxScrolls: 60);
  await tester.pump();
}

void main() {
  setUp(MemberPreferencesScope.reset);

  group('Settings list', () {
    testWidgets('shows every group and its rows', (tester) async {
      await _open(tester, UserSettingsPage(onLogout: () {}));

      for (final group in [
        'MY ORDERS',
        'NOTIFICATIONS',
        'PREFERENCES',
        'SUPPORT',
        'ABOUT',
      ]) {
        expect(find.text(group), findsOneWidget, reason: 'group $group');
      }
      for (final row in [
        'Order tracking',
        'Order updates',
        'Promotions & offers',
        'Gabay suggestions',
        'Healthier suggestions first',
        'Dietary preference',
        'Language',
        'Help & FAQ',
        'Contact us',
        'About Hapag Pamana',
        'Privacy Policy',
        'Terms of Service',
        'App version',
      ]) {
        expect(find.text(row), findsOneWidget, reason: 'row $row');
      }
    });

    testWidgets('switches show the preferences in force', (tester) async {
      MemberPreferencesScope.notifier.value = const MemberPreferences(
        promotions: false,
        healthierFirst: true,
      );
      await _open(tester, UserSettingsPage(onLogout: () {}));

      final switches = tester.widgetList<Switch>(find.byType(Switch)).toList();
      // Order updates, Promotions, Gabay suggestions, Healthier first.
      expect(switches.map((s) => s.value).toList(), [true, false, true, true]);
    });

    testWidgets('the dietary row summarises the choice', (tester) async {
      MemberPreferencesScope.notifier.value = const MemberPreferences(
        diet: DietStyle.vegetarian,
        avoidAllergens: {'peanut', 'shellfish'},
      );
      await _open(tester, UserSettingsPage(onLogout: () {}));

      expect(
        find.text('Vegetarian · avoiding 2 allergens'),
        findsOneWidget,
      );
    });

    testWidgets('log out is wired to the shell', (tester) async {
      var loggedOut = false;
      await _open(
        tester,
        UserSettingsPage(onLogout: () => loggedOut = true),
      );

      await tester.tap(find.text('LOG OUT'));
      expect(loggedOut, isTrue);
    });
  });

  group('Destinations', () {
    testWidgets('Dietary preference opens its picker', (tester) async {
      await _open(tester, UserSettingsPage(onLogout: () {}));

      await tester.tap(find.text('Dietary preference'));
      // One frame to start the push, then past the end of the transition.
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      expect(find.text('HOW YOU EAT'), findsOneWidget);
      expect(find.text('ALLERGENS TO AVOID'), findsOneWidget);
      // Every diet style, and the live allergen taxonomy, are offered.
      expect(find.text('Vegetarian'), findsOneWidget);
      expect(find.text('Peanut'), findsOneWidget);
    });

    testWidgets('Language offers both languages', (tester) async {
      await _open(tester, const LanguagePage());

      expect(find.text('English'), findsOneWidget);
      expect(find.text('Filipino'), findsOneWidget);
      // What switching does today is stated rather than implied.
      expect(find.text('WHAT CHANGES TODAY'), findsOneWidget);
    });

    testWidgets('Help & FAQ answers open on tap', (tester) async {
      await _open(tester, const HelpFaqPage());

      const question = 'How much do I pay up front?';
      const answer = 'Half the order total holds your date. The balance is '
          'settled with the team on the day of the event.';

      expect(find.text(question), findsOneWidget);
      expect(find.text(answer), findsNothing);

      await tester.tap(find.text(question));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.text(answer), findsOneWidget);
    });

    testWidgets('the policies render their clauses', (tester) async {
      await _open(tester, const PrivacyPolicyPage());
      expect(find.textContaining('LAST UPDATED'), findsOneWidget);
      expect(find.text('WHAT WE KEEP'), findsOneWidget);
      await _scrollTo(tester, find.text('WHEN THIS CHANGES'));

      await _open(tester, const TermsOfServicePage());
      expect(find.text('THE AGREEMENT'), findsOneWidget);
      await _scrollTo(tester, find.text('THE DOWNPAYMENT'));
      await _scrollTo(tester, find.text('CHANGES AND CANCELLATIONS'));
    });

    testWidgets('Contact us lists live ways to reach the kitchen',
        (tester) async {
      await _open(tester, const ContactUsPage());

      expect(find.text('CALL OR TEXT'), findsOneWidget);
      expect(find.text('E-MAIL US'), findsOneWidget);
      expect(find.text('KITCHEN HOURS'), findsOneWidget);
      expect(find.text('Facebook'), findsOneWidget);
    });
  });

  group('MemberPreferences', () {
    test('round-trips through its map', () {
      const prefs = MemberPreferences(
        promotions: false,
        healthierFirst: true,
        diet: DietStyle.halal,
        avoidAllergens: {'peanut', 'milk'},
        language: AppLanguage.filipino,
      );

      expect(MemberPreferences.fromMap(prefs.toMap()), prefs);
    });

    test('keeps its defaults for a missing or malformed map', () {
      const fresh = MemberPreferences();

      expect(MemberPreferences.fromMap(null), fresh);
      expect(MemberPreferences.fromMap(const {}), fresh);
      expect(
        MemberPreferences.fromMap(const {
          'orderUpdates': 'yes', // wrong type
          'diet': 'carnivore', // unknown key
          'avoidAllergens': 'peanut', // not a list
          'language': 'de', // unsupported
        }),
        fresh,
      );
    });

    test('summarises the dietary choice for the settings row', () {
      expect(const MemberPreferences().dietarySummary, 'Not set yet');
      expect(
        const MemberPreferences(avoidAllergens: {'peanut'}).dietarySummary,
        'Avoiding 1 allergen',
      );
      expect(
        const MemberPreferences(diet: DietStyle.vegan).dietarySummary,
        'Vegan',
      );
      expect(
        const MemberPreferences(
          diet: DietStyle.halal,
          avoidAllergens: {'peanut', 'soy'},
        ).dietarySummary,
        'Halal-friendly · avoiding 2 allergens',
      );
    });

    test('only reports avoided allergens the dish actually carries', () {
      const prefs = MemberPreferences(avoidAllergens: {'peanut', 'soy'});

      expect(
        prefs.avoidedIn(['peanut', 'milk']).map((a) => a.key).toList(),
        ['peanut'],
      );
      expect(prefs.avoidedIn(['milk']), isEmpty);
      // A key that isn't in the taxonomy can't flag anything.
      expect(
        const MemberPreferences(avoidAllergens: {'unicorn'})
            .avoidedIn(['unicorn']),
        isEmpty,
      );
    });
  });

  group('Dietary flags', () {
    test('name the offending allergens as a sentence', () {
      List<Allergen> of(List<String> keys) =>
          const MemberPreferences(avoidAllergens: {
            'peanut',
            'shellfish',
            'soy',
          }).avoidedIn(keys);

      expect(allergenSentence(of(const [])), '');
      expect(allergenSentence(of(const ['peanut'])), 'peanut');
      expect(
        allergenSentence(of(const ['peanut', 'shellfish'])),
        'peanut and shellfish',
      );
      expect(
        allergenSentence(of(const ['peanut', 'shellfish', 'soy'])),
        'peanut, shellfish and soy',
      );
    });
  });
}
