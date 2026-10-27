import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart' show Locale;

import 'allergens.dart';
import 'customer_repository.dart';

/// The member's own settings, as edited on the Settings screens and stored in
/// the `preferences` map on `customers/{uid}`.
///
/// The counterpart to [AppSettings]: those are the moderator's switches over
/// the whole app, these are one member's choices over their own experience.
/// They live on the profile document (rather than on the device) so a member
/// who signs in on a new phone finds them already set — the Firestore rules
/// already let an owner write their own profile, so no new rule is needed.
///
/// Every field carries the permissive default a fresh account starts on, and
/// [fromMap] keeps that default for anything missing or malformed, so a
/// half-written map can never turn into a member who silently hears nothing.
@immutable
class MemberPreferences {
  const MemberPreferences({
    this.orderUpdates = true,
    this.promotions = true,
    this.gabaySuggestions = true,
    this.healthierFirst = false,
    this.diet = DietStyle.none,
    this.avoidAllergens = const <String>{},
    this.language = AppLanguage.english,
  });

  factory MemberPreferences.fromMap(Map<String, Object?>? data) {
    bool flag(String key, bool fallback) {
      final v = data?[key];
      return v is bool ? v : fallback;
    }

    final raw = data?['avoidAllergens'];
    return MemberPreferences(
      orderUpdates: flag('orderUpdates', true),
      promotions: flag('promotions', true),
      gabaySuggestions: flag('gabaySuggestions', true),
      healthierFirst: flag('healthierFirst', false),
      diet: DietStyle.fromKey(data?['diet']),
      avoidAllergens: raw is! List
          ? const <String>{}
          : {
              for (final e in raw)
                if (e.toString().trim().isNotEmpty) e.toString().trim(),
            },
      language: AppLanguage.fromCode(data?['language']),
    );
  }

  /// Tell me how my orders are getting on.
  final bool orderUpdates;

  /// Tell me about seasonal deals and new packages.
  final bool promotions;

  /// Let Gabay put suggestions in front of me.
  final bool gabaySuggestions;

  /// Ask Gabay to lead with the lighter, more nutritious dishes.
  final bool healthierFirst;

  /// How this member eats — recorded on the profile so the kitchen and Gabay
  /// can work to it. The menu carries no per-dish diet tags, so nothing is
  /// filtered on this alone (see [avoidAllergens], which the menu *does* act on).
  final DietStyle diet;

  /// Allergen keys ([Allergen.key]) the member has asked us to keep away from.
  /// The Menu and the dish quick-look flag anything carrying one of these.
  final Set<String> avoidAllergens;

  /// The language the app runs in.
  final AppLanguage language;

  /// True when the member has told us anything at all about how they eat.
  bool get hasDietaryNeeds =>
      diet != DietStyle.none || avoidAllergens.isNotEmpty;

  /// The dietary choice read back in a line, for the Settings row's subtitle —
  /// "Not set yet", "Vegetarian", "Avoiding 3 allergens",
  /// "Vegetarian · avoiding 3 allergens".
  String get dietarySummary {
    final count = avoidAllergens.length;
    final avoiding =
        count == 0 ? '' : 'avoiding $count allergen${count == 1 ? '' : 's'}';
    if (diet == DietStyle.none) {
      if (avoiding.isEmpty) return 'Not set yet';
      // Sentence-leading, since it stands alone here.
      return 'A${avoiding.substring(1)}';
    }
    return avoiding.isEmpty ? diet.label : '${diet.label} · $avoiding';
  }

  /// The allergens out of [keys] (a dish's tags) this member avoids, resolved
  /// against the taxonomy currently in force so a key an admin has since
  /// deleted quietly stops flagging dishes.
  List<Allergen> avoidedIn(Iterable<String> keys) => [
        for (final k in keys)
          if (avoidAllergens.contains(k) && kAllergenByKey[k] != null)
            kAllergenByKey[k]!,
      ];

  /// The payload written to `customers/{uid}.preferences`.
  Map<String, Object?> toMap() => {
        'orderUpdates': orderUpdates,
        'promotions': promotions,
        'gabaySuggestions': gabaySuggestions,
        'healthierFirst': healthierFirst,
        'diet': diet.key,
        // Sorted so an unchanged set always writes the same array and the
        // document doesn't churn on rewrite.
        'avoidAllergens': avoidAllergens.toList()..sort(),
        'language': language.code,
      };

  MemberPreferences copyWith({
    bool? orderUpdates,
    bool? promotions,
    bool? gabaySuggestions,
    bool? healthierFirst,
    DietStyle? diet,
    Set<String>? avoidAllergens,
    AppLanguage? language,
  }) {
    return MemberPreferences(
      orderUpdates: orderUpdates ?? this.orderUpdates,
      promotions: promotions ?? this.promotions,
      gabaySuggestions: gabaySuggestions ?? this.gabaySuggestions,
      healthierFirst: healthierFirst ?? this.healthierFirst,
      diet: diet ?? this.diet,
      avoidAllergens: avoidAllergens ?? this.avoidAllergens,
      language: language ?? this.language,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is MemberPreferences &&
      other.orderUpdates == orderUpdates &&
      other.promotions == promotions &&
      other.gabaySuggestions == gabaySuggestions &&
      other.healthierFirst == healthierFirst &&
      other.diet == diet &&
      other.language == language &&
      setEquals(other.avoidAllergens, avoidAllergens);

  @override
  int get hashCode => Object.hash(
        orderUpdates,
        promotions,
        gabaySuggestions,
        healthierFirst,
        diet,
        language,
        Object.hashAllUnordered(avoidAllergens),
      );
}

/// How a member eats, as one choice. Deliberately a short list of the patterns
/// a Filipino kitchen actually cooks around — the picker is a decision, not a
/// questionnaire.
///
/// [key] is what's stored; never localise or renumber it.
enum DietStyle {
  none('none', 'No restrictions', 'Everything on the menu is fair game.'),
  vegetarian(
    'vegetarian',
    'Vegetarian',
    'No meat or fish — dairy and eggs are fine.',
  ),
  vegan('vegan', 'Vegan', 'Nothing that comes from an animal at all.'),
  pescatarian(
    'pescatarian',
    'Pescatarian',
    'Fish and seafood, but no other meat.',
  ),
  noPork('no_pork', 'No pork', 'Anything but pork and its by-products.'),
  halal('halal', 'Halal-friendly', 'No pork, and no alcohol in the cooking.');

  const DietStyle(this.key, this.label, this.blurb);

  /// Stable key stored in Firestore.
  final String key;

  /// Display label.
  final String label;

  /// One line saying what the choice means, shown under the label.
  final String blurb;

  /// Resolves a stored key, falling back to [none] for anything unrecognised.
  static DietStyle fromKey(Object? raw) => values.firstWhere(
        (d) => d.key == raw,
        orElse: () => DietStyle.none,
      );
}

/// The languages the app can run in.
///
/// [code] is an ISO language code that Flutter's own localisations understand,
/// so choosing one turns over everything the framework supplies — date pickers,
/// dialog buttons, text-selection menus — in that language. The app's own
/// writing is translated separately.
enum AppLanguage {
  english('en', 'English', 'The app\'s original language.'),
  filipino('fil', 'Filipino', 'Wikang Filipino — Tagalog.');

  const AppLanguage(this.code, this.label, this.blurb);

  final String code;
  final String label;
  final String blurb;

  Locale get locale => Locale(code);

  /// Resolves a stored code, falling back to [english].
  static AppLanguage fromCode(Object? raw) => values.firstWhere(
        (l) => l.code == raw,
        orElse: () => AppLanguage.english,
      );
}

/// The preferences currently in force, and the one place they're read and
/// written.
///
/// Mirrors [AppSettingsScope]: a [ValueNotifier] anything can listen to, so the
/// Settings switches, the Menu's dietary flags and the app's locale all follow
/// one source. Unlike that scope this isn't a live Firestore stream — a member's
/// own choices only change from this device, so [load] reads them once at
/// sign-in and [save] keeps the notifier and the document in step from there.
class MemberPreferencesScope {
  MemberPreferencesScope._();

  /// [ValueNotifier] only notifies on an actual change (see
  /// [MemberPreferences.==]), so listeners don't rebuild on a no-op save.
  static final ValueNotifier<MemberPreferences> notifier =
      ValueNotifier(const MemberPreferences());

  static MemberPreferences get value => notifier.value;

  /// Reads the signed-in member's saved preferences into [notifier]. A guest has
  /// none, and a failed read leaves the defaults standing — so this is safe to
  /// call whenever the member side comes up, and safe to call twice.
  ///
  /// Nothing here is allowed to throw: settings are a convenience, and the
  /// member shell must come up whether or not they could be fetched. That covers
  /// being offline, a profile written before preferences existed, and a Firebase
  /// that never initialised (which is also what lets the settings screens be
  /// pumped in a widget test).
  static Future<void> load() async {
    try {
      final repo = CustomerRepository();
      if (!repo.isSignedIn) return;
      notifier.value = MemberPreferences.fromMap(await repo.fetchPreferences());
    } catch (_) {
      // The defaults — or the last set we did load — stand.
    }
  }

  /// Persists [next], returning false when the write failed.
  ///
  /// The notifier moves first so a switch never lags the thumb; a failed write
  /// rolls it back, which is what stops a setting from *looking* saved when it
  /// isn't. Callers surface the false — see the Settings screens.
  static Future<bool> save(MemberPreferences next) async {
    final previous = notifier.value;
    if (next == previous) return true;
    notifier.value = next;
    try {
      await CustomerRepository().savePreferences(next.toMap());
      return true;
    } catch (_) {
      notifier.value = previous;
      return false;
    }
  }

  /// Drops back to the defaults — called on log-out so one member's choices
  /// never colour the guest side or the next account to sign in.
  static void reset() => notifier.value = const MemberPreferences();
}
