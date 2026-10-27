/// The Google Maps / Places API key the address picker runs on — the same
/// project key wired into the native Android manifest and iOS AppDelegate,
/// so all three (the embedded map, autocomplete, and reverse geocoding) draw
/// on one key and one quota.
///
/// Read from `.env` (`GOOGLE_MAPS_API_KEY` — see [Env]); a `--dart-define`
/// still overrides it the same way [PayMongoConfig]'s keys do, should the
/// key ever need to change without touching the bundled file:
/// ```
/// flutter build apk --dart-define=GOOGLE_MAPS_API_KEY=AIza…
/// ```
///
/// The native platform files (`AndroidManifest.xml`, `AppDelegate.swift`)
/// each hold their own copy of this key — Android and iOS read the Maps SDK
/// key before Flutter (and `.env`) ever starts, so those still need updating
/// by hand if the key changes.
library;

import '../env.dart';

class PlacesConfig {
  const PlacesConfig._();

  static String get apiKey => Env.googleMapsApiKey;

  /// Where the wizard centers the map before the member has picked or
  /// searched anything — Metro Manila, so the first pin drop is somewhere
  /// plausible for the business's delivery area rather than mid-ocean at
  /// (0, 0).
  static const double defaultLat = 14.5995;
  static const double defaultLng = 120.9842;
}
