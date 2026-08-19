import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Every secret and per-environment key the app needs, read from `.env`
/// (bundled as an asset, gitignored — see `.env.example` for the template).
///
/// [load] must run once, before anything below is read — see `main()`.
///
/// A `--dart-define` still wins over `.env` when one is passed, so a CI
/// release build can override a key without touching the bundled file (the
/// same mechanism [PayMongoConfig] and [PlacesConfig] used before this file
/// existed). Local development only needs `.env` filled in.
///
/// ⚠ **None of this actually keeps a key off the device.** `.env` ships
/// inside the app bundle as a plain asset, so a build still carries every
/// value below and someone who unzips the APK can read them — same as
/// before. What this buys is keeping secrets out of *source control*, so
/// they don't end up in git history, PRs, or anyone's editor tabs who
/// doesn't need them. The real fix for the PayMongo secret key is moving
/// checkout-session creation behind a server — see [PayMongoConfig]'s own
/// warning, which still applies.
class Env {
  const Env._();

  static bool _loaded = false;

  /// Loads `.env` into [dotenv]. Safe to call more than once — later calls
  /// are a no-op, so a screen that wants to guarantee it's loaded (tests, a
  /// hot-restart edge case) can call this without re-reading the file.
  static Future<void> load() async {
    if (_loaded) return;
    await dotenv.load(fileName: '.env');
    _loaded = true;
  }

  static String get googleMapsApiKey => const String.fromEnvironment(
        'GOOGLE_MAPS_API_KEY',
      ).isNotEmpty
      ? const String.fromEnvironment('GOOGLE_MAPS_API_KEY')
      : (dotenv.env['GOOGLE_MAPS_API_KEY'] ?? '');

  static String get paymongoSecretKey => const String.fromEnvironment(
        'PAYMONGO_SECRET_KEY',
      ).isNotEmpty
      ? const String.fromEnvironment('PAYMONGO_SECRET_KEY')
      : (dotenv.env['PAYMONGO_SECRET_KEY'] ?? '');

  static String get paymongoPublicKey => const String.fromEnvironment(
        'PAYMONGO_PUBLIC_KEY',
      ).isNotEmpty
      ? const String.fromEnvironment('PAYMONGO_PUBLIC_KEY')
      : (dotenv.env['PAYMONGO_PUBLIC_KEY'] ?? '');

  static String get firebaseAndroidApiKey => const String.fromEnvironment(
        'FIREBASE_ANDROID_API_KEY',
      ).isNotEmpty
      ? const String.fromEnvironment('FIREBASE_ANDROID_API_KEY')
      : (dotenv.env['FIREBASE_ANDROID_API_KEY'] ?? '');

  static String get firebaseWebApiKey => const String.fromEnvironment(
        'FIREBASE_WEB_API_KEY',
      ).isNotEmpty
      ? const String.fromEnvironment('FIREBASE_WEB_API_KEY')
      : (dotenv.env['FIREBASE_WEB_API_KEY'] ?? '');

  static String get firebaseIosApiKey => const String.fromEnvironment(
        'FIREBASE_IOS_API_KEY',
      ).isNotEmpty
      ? const String.fromEnvironment('FIREBASE_IOS_API_KEY')
      : (dotenv.env['FIREBASE_IOS_API_KEY'] ?? '');
}
