import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'brand.dart';
import 'data/allergens.dart';
import 'data/app_settings.dart';
import 'firebase_options.dart';
import 'screens/splash_screen.dart';
import 'widgets.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
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
    return MaterialApp(
      title: 'HapagPamana',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      // Provide a single shared shimmer clock to every skeleton in the app.
      builder: (context, child) =>
          ShimmerScope(child: child ?? const SizedBox.shrink()),
      home: const SplashScreen(),
    );
  }
}
