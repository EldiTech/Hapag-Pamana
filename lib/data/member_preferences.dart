import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart' show Locale;

import 'allergens.dart';
import 'customer_repository.dart';
import 'product.dart';
import 'taste_profile.dart';

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
    this.diets = const <DietStyle>{},
    this.avoidAllergens = const <String>{},
    this.language = AppLanguage.english,
    this.tasteProfile,
  });

  factory MemberPreferences.fromMap(Map<String, Object?>? data) {
    bool flag(String key, bool fallback) {
      final v = data?[key];
      return v is bool ? v : fallback;
    }

    final rawAllergens = data?['avoidAllergens'];
    final rawDiets = data?['diets'];
    Set<DietStyle> parsedDiets = const <DietStyle>{};
    if (rawDiets is List) {
      parsedDiets = {
        for (final e in rawDiets)
          if (DietStyle.fromKey(e) != DietStyle.none) DietStyle.fromKey(e),
      };
    }
    final singleDiet = DietStyle.fromKey(data?['diet']);
    if (parsedDiets.isEmpty && singleDiet != DietStyle.none) {
      parsedDiets = {singleDiet};
    }

    return MemberPreferences(
      orderUpdates: flag('orderUpdates', true),
      promotions: flag('promotions', true),
      gabaySuggestions: flag('gabaySuggestions', true),
      healthierFirst: flag('healthierFirst', false),
      diet: parsedDiets.isEmpty ? singleDiet : parsedDiets.first,
      diets: parsedDiets,
      avoidAllergens: rawAllergens is! List
          ? const <String>{}
          : {
              for (final e in rawAllergens)
                if (e.toString().trim().isNotEmpty) e.toString().trim(),
            },
      language: AppLanguage.fromCode(data?['language']),
      tasteProfile: data?['tasteProfile'] is Map
          ? TasteProfile.fromMap(data?['tasteProfile'] as Map<String, Object?>?)
          : null,
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

  /// How this member eats — multiple styles can be chosen at once (e.g. Vegetarian
  /// and Pescatarian, or Vegetarian and No Pork).
  final Set<DietStyle> diets;

  /// Single diet, kept for backwards compatibility with single-diet callers.
  final DietStyle diet;

  /// All selected diets. If [diets] is populated, returns [diets]; otherwise
  /// wraps [diet] if it is not [DietStyle.none].
  Set<DietStyle> get allDiets {
    if (diets.isNotEmpty) return diets;
    if (diet != DietStyle.none) return {diet};
    return const <DietStyle>{};
  }

  /// Allergen keys ([Allergen.key]) the member has asked us to keep away from.
  /// The Menu and the dish quick-look flag anything carrying one of these.
  final Set<String> avoidAllergens;

  /// The language the app runs in.
  final AppLanguage language;

  final TasteProfile? tasteProfile;

  TasteProfile? get person => tasteProfile;

  bool get gabayHealthierFirst => healthierFirst;

  /// True when the member has told us anything at all about how they eat.
  bool get hasDietaryNeeds =>
      allDiets.isNotEmpty || avoidAllergens.isNotEmpty;

  /// The dietary choice read back in a line, for the Settings row's subtitle —
  /// "Not set yet", "Vegetarian", "Vegetarian, Pescatarian",
  /// "Vegetarian · avoiding 3 allergens".
  String get dietarySummary {
    final count = avoidAllergens.length;
    final avoiding = count == 0
        ? ''
        : 'avoiding $count allergen${count == 1 ? '' : 's'}';
    final dietLabels = [for (final d in allDiets) d.label].join(', ');
    if (dietLabels.isEmpty) {
      if (avoiding.isEmpty) return 'Not set yet';
      // Sentence-leading, since it stands alone here.
      return 'A${avoiding.substring(1)}';
    }
    return avoiding.isEmpty ? dietLabels : '$dietLabels · $avoiding';
  }

  /// The allergens out of [keys] (a dish's tags) this member avoids, resolved
  /// against the taxonomy currently in force so a key an admin has since
  /// deleted quietly stops flagging dishes.
  List<Allergen> avoidedIn(Iterable<String> keys) => [
    for (final k in keys)
      if (avoidAllergens.contains(k) && kAllergenByKey[k] != null)
        kAllergenByKey[k]!,
  ];

  /// Evaluates whether a dish violates any of this member's selected diets.
  /// Returns a list of concise reason phrases (e.g. `["Contains pork"]`), or empty.
  List<String> dietaryConflictsFor({
    required String name,
    required String category,
    List<String> allergens = const [],
  }) {
    if (allDiets.isEmpty) return const [];
    final lowerName = name.toLowerCase();
    final lowerCat = category.toLowerCase();
    final combined = '$lowerCat $lowerName';

    final isPork = lowerCat.contains('pork') ||
        combined.contains('pork') ||
        combined.contains('lechon') ||
        combined.contains('bagnet') ||
        combined.contains('bacon') ||
        combined.contains('ribs') ||
        combined.contains('embutido') ||
        combined.contains('longganisa') ||
        combined.contains('tocino') ||
        combined.contains('siomai') ||
        combined.contains('baboy') ||
        combined.contains('liempo') ||
        combined.contains('chicharon');

    final isBeef = lowerCat.contains('beef') ||
        combined.contains('beef') ||
        combined.contains('baka') ||
        combined.contains('bulalo') ||
        combined.contains('kaldereta') ||
        combined.contains('bistek') ||
        combined.contains('salpicao') ||
        combined.contains('brisket') ||
        combined.contains('mechado');

    final isChicken = lowerCat.contains('chicken') ||
        combined.contains('chicken') ||
        combined.contains('manok') ||
        combined.contains('tinola') ||
        combined.contains('inasal') ||
        combined.contains('afritada') ||
        combined.contains('wings');

    final isFish = lowerCat.contains('fish') ||
        allergens.contains('fish') ||
        combined.contains('fish') ||
        combined.contains('bangus') ||
        combined.contains('tilapia') ||
        combined.contains('salmon') ||
        combined.contains('tuna') ||
        combined.contains('isda') ||
        combined.contains('lapu-lapu') ||
        combined.contains('daing');

    final isSeafood = lowerCat.contains('seafood') ||
        allergens.contains('crustacean') ||
        allergens.contains('shellfish') ||
        combined.contains('seafood') ||
        combined.contains('shrimp') ||
        combined.contains('crab') ||
        combined.contains('squid') ||
        combined.contains('pusit') ||
        combined.contains('hipon') ||
        combined.contains('tahong') ||
        combined.contains('talaba') ||
        combined.contains('aligue') ||
        combined.contains('prawn');

    final isGeneralMeat = isPork ||
        isBeef ||
        isChicken ||
        combined.contains('meat') ||
        combined.contains('carne') ||
        combined.contains('karne') ||
        combined.contains('sausage') ||
        combined.contains('hotdog');

    final hasAlcohol = combined.contains('wine') ||
        combined.contains('beer') ||
        combined.contains('rum') ||
        combined.contains('bourbon') ||
        combined.contains('alcohol');

    final isDairyOrEgg = allergens.contains('milk') ||
        allergens.contains('dairy') ||
        allergens.contains('egg');

    final conflicts = <String>{};

    for (final d in allDiets) {
      switch (d) {
        case DietStyle.none:
          break;
        case DietStyle.noPork:
          if (isPork) conflicts.add('Contains pork');
          break;
        case DietStyle.halal:
          if (isPork) conflicts.add('Not Halal (pork)');
          if (hasAlcohol) conflicts.add('Not Halal (alcohol)');
          break;
        case DietStyle.pescatarian:
          if (isGeneralMeat) conflicts.add('Contains meat (not pescatarian)');
          break;
        case DietStyle.vegetarian:
          if (isGeneralMeat) conflicts.add('Contains meat');
          // If the user also selected Pescatarian, seafood is intentionally allowed.
          if (!allDiets.contains(DietStyle.pescatarian) && (isFish || isSeafood)) {
            conflicts.add('Contains seafood');
          }
          break;
        case DietStyle.vegan:
          if (isGeneralMeat) conflicts.add('Contains meat');
          if (isFish || isSeafood) conflicts.add('Contains seafood');
          if (isDairyOrEgg) conflicts.add('Contains dairy/egg');
          break;
      }
    }
    return conflicts.toList();
  }

  /// Evaluates whether [product] conflicts with this member's active diets.
  List<String> dietaryConflicts(Product product) => dietaryConflictsFor(
    name: product.name,
    category: product.category,
    allergens: product.allergens,
  );

  /// True if this dish carries an allergen the member avoids or conflicts with
  /// one of their chosen diets.
  bool dishConflicts(Product product) =>
      avoidedIn(product.allergens).isNotEmpty ||
      dietaryConflicts(product).isNotEmpty;

  /// The payload written to `customers/{uid}.preferences`.
  Map<String, Object?> toMap() => {
    'orderUpdates': orderUpdates,
    'promotions': promotions,
    'gabaySuggestions': gabaySuggestions,
    'healthierFirst': healthierFirst,
    'diet': (allDiets.isEmpty ? DietStyle.none : allDiets.first).key,
    'diets': [for (final d in allDiets) d.key]..sort(),
    // Sorted so an unchanged set always writes the same array and the
    // document doesn't churn on rewrite.
    'avoidAllergens': avoidAllergens.toList()..sort(),
    'language': language.code,
    if (tasteProfile != null) 'tasteProfile': tasteProfile!.toMap(),
  };

  MemberPreferences copyWith({
    bool? orderUpdates,
    bool? promotions,
    bool? gabaySuggestions,
    bool? healthierFirst,
    DietStyle? diet,
    Set<DietStyle>? diets,
    Set<String>? avoidAllergens,
    AppLanguage? language,
    TasteProfile? tasteProfile,
  }) {
    final nextDiets = diets ??
        (diet != null
            ? (diet == DietStyle.none ? const <DietStyle>{} : {diet})
            : allDiets);
    return MemberPreferences(
      orderUpdates: orderUpdates ?? this.orderUpdates,
      promotions: promotions ?? this.promotions,
      gabaySuggestions: gabaySuggestions ?? this.gabaySuggestions,
      healthierFirst: healthierFirst ?? this.healthierFirst,
      diet: nextDiets.isEmpty ? DietStyle.none : nextDiets.first,
      diets: nextDiets,
      avoidAllergens: avoidAllergens ?? this.avoidAllergens,
      language: language ?? this.language,
      tasteProfile: tasteProfile ?? this.tasteProfile,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is MemberPreferences &&
      other.orderUpdates == orderUpdates &&
      other.promotions == promotions &&
      other.gabaySuggestions == gabaySuggestions &&
      other.healthierFirst == healthierFirst &&
      setEquals(other.allDiets, allDiets) &&
      other.language == language &&
      setEquals(other.avoidAllergens, avoidAllergens) &&
      other.tasteProfile == tasteProfile;

  @override
  int get hashCode => Object.hash(
    orderUpdates,
    promotions,
    gabaySuggestions,
    healthierFirst,
    Object.hashAllUnordered(allDiets),
    language,
    Object.hashAllUnordered(avoidAllergens),
    tasteProfile,
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
  static DietStyle fromKey(Object? raw) =>
      values.firstWhere((d) => d.key == raw, orElse: () => DietStyle.none);
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
  static final ValueNotifier<MemberPreferences> notifier = ValueNotifier(
    const MemberPreferences(),
  );

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
