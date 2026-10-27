import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

/// App-wide feature switches, set by moderators on the dashboard's Settings
/// page ("App features") and stored in Firestore at `settings/app` — the same
/// document the Content Moderator writes (see Admin `core.js` → SETTINGS_REF).
/// Public read, so the customer app follows the switches live.
@immutable
class AppSettings {
  const AppSettings({
    this.ordering = true,
    this.catering = true,
    this.featuredOnHome = true,
    this.maintenance = false,
  });

  /// Maps the raw settings document, keeping the permissive default for any
  /// missing or malformed field so a partial doc can never lock the app down.
  factory AppSettings.fromMap(Map<String, Object?>? data) {
    bool flag(String key, bool fallback) {
      final v = data?[key];
      return v is bool ? v : fallback;
    }

    return AppSettings(
      ordering: flag('ordering', true),
      catering: flag('catering', true),
      featuredOnHome: flag('featuredOnHome', true),
      maintenance: flag('maintenance', false),
    );
  }

  /// Show the Menu tab and the menu-teaser sections that deep-link it.
  final bool ordering;

  /// Show the Catering/Packages tab and the catering invitations.
  final bool catering;

  /// Surface the Featured carousel on the Home screens.
  final bool featuredOnHome;

  /// Replace the whole app with a "temporarily closed" notice.
  final bool maintenance;

  @override
  bool operator ==(Object other) =>
      other is AppSettings &&
      other.ordering == ordering &&
      other.catering == catering &&
      other.featuredOnHome == featuredOnHome &&
      other.maintenance == maintenance;

  @override
  int get hashCode =>
      Object.hash(ordering, catering, featuredOnHome, maintenance);
}

/// Live view of the moderator-controlled switches.
///
/// [start] is called once from `main()` and keeps [notifier] in step with the
/// `settings/app` document for the app's whole lifetime — flipping a switch on
/// the dashboard reshapes the running app within a snapshot. Until the first
/// snapshot lands (and whenever the stream errors, e.g. offline) the last
/// known — initially permissive — settings stand, so the app never locks
/// itself out for want of a connection.
class AppSettingsScope {
  AppSettingsScope._();

  /// The settings currently in force. [ValueNotifier] only notifies on an
  /// actual change (see [AppSettings.==]), so listeners don't rebuild on
  /// every unrelated snapshot re-emit.
  static final ValueNotifier<AppSettings> notifier =
      ValueNotifier(const AppSettings());

  static AppSettings get value => notifier.value;

  static bool _started = false;

  static void start() {
    if (_started) return;
    _started = true;
    FirebaseFirestore.instance
        .collection('settings')
        .doc('app')
        .snapshots()
        .listen(
          (snap) => notifier.value = AppSettings.fromMap(snap.data()),
          onError: (Object _) {
            // Offline or unreadable — the last known settings stand.
          },
        );
  }
}
