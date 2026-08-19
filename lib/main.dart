import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'brand.dart';
import 'data/allergens.dart';
import 'data/app_settings.dart';
import 'data/member_preferences.dart';
import 'env.dart';
import 'firebase_options.dart';
import 'screens/splash_screen.dart';
import 'widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Every API key the app needs comes from .env from here on — load it
  // before anything that reads one (Firebase's options included).
  await Env.load();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  // Refresh the allergen taxonomy from the moderator-edited config without
  // holding up first paint — the built-in defaults stand until it lands.
  unawaited(AllergenTaxonomy.load());
  // Follow the dashboard's App-features switches (ordering / catering /
  // featured / maintenance) live for the whole session.
  AppSettingsScope.start();
  runApp(const HapagPamanaApp());
}

class HapagPamanaApp extends StatelessWidget {
  const HapagPamanaApp({super.key});

  @override
  Widget build(BuildContext context) {
    // The app runs in the language the signed-in member chose (Settings →
    // Language), so everything Flutter itself supplies — the booking wizards'
    // date and time pickers, dialog buttons, the text-selection menu, date
    // formatting — follows it. A guest, and a member who hasn't chosen, gets
    // the English default; log-out resets it.
    return ValueListenableBuilder<MemberPreferences>(
      valueListenable: MemberPreferencesScope.notifier,
      builder: (context, prefs, _) => MaterialApp(
        title: 'HapagPamana',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        locale: prefs.language.locale,
        supportedLocales: [
          for (final language in AppLanguage.values) language.locale,
        ],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        // Provide a single shared shimmer clock to every skeleton in the app.
        builder: (context, child) =>
            ShimmerScope(child: child ?? const SizedBox.shrink()),
        home: const SplashScreen(),
      ),
    );
  }
}
