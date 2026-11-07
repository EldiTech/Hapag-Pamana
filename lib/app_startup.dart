import 'dart:async';

import 'package:firebase_core/firebase_core.dart';

import 'data/about_content.dart';
import 'data/allergens.dart';
import 'data/app_settings.dart';
import 'data/push_notification_service.dart';
import 'env.dart';
import 'firebase_options.dart';

/// Starts the app immediately, then finishes service setup in the background.
class AppStartup {
  AppStartup._();

  static Future<void>? _ready;

  static Future<void> initialize() => _ready ??= _initialize();

  static Future<void> get ready => initialize();

  static Future<void> _initialize() async {
    await Env.load();
    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );
    PushNotificationService.registerBackgroundHandler();
    unawaited(AllergenTaxonomy.load());
    AppSettingsScope.start();
    AboutContentScope.start();
    unawaited(PushNotificationService.instance.start());
  }
}
