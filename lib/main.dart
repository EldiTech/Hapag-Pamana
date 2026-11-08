import 'dart:async';

import 'package:flutter/widgets.dart';

import 'app/app.dart';
import 'app/app_startup.dart';

export 'app/app.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Every API key the app needs comes from .env from here on — load it
  // before anything that reads one (Firebase's options included).
  // Refresh the allergen taxonomy from the moderator-edited config without
  // holding up first paint — the built-in defaults stand until it lands.
  // Follow the dashboard's App-features switches (ordering / catering /
  // featured / maintenance) live for the whole session.
  runApp(const HapagPamanaApp());
  unawaited(AppStartup.initialize());
}
