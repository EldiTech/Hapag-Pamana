import 'package:cloud_firestore/cloud_firestore.dart';

import 'product.dart';

/// The allergen taxonomy — shared with the Content Moderator, which publishes
/// the same entries (see `core.js` → `HP.ALLERGENS`) so a product's stored
/// `allergens` array maps cleanly onto these on both sides.
///
/// Moderators edit the taxonomy on the dashboard's Settings page; it lives in
/// Firestore at `settings/allergens` (public read). [AllergenTaxonomy.load]
/// fetches it at startup; until then — and whenever the fetch fails — the
/// built-in [kDefaultAllergens] stand in.
///
/// `severity` is a 0–1 anaphylaxis-risk weight: the allergens most associated
/// with severe reactions (peanut, tree nuts, shellfish) sit near 1.0, the
/// milder-but-common ones (soy, gluten, milk) lower. It scales the heatmap so a
/// rarely-fatal allergen that happens to be everywhere never reads as alarming
/// as a high-risk one.
class Allergen {
  const Allergen(this.key, this.label, this.short, this.severity);

  /// Stable key stored in Firestore (never localise this).
  final String key;

  /// Full display label, e.g. "Tree nuts".
  final String label;

  /// Compact label for tight heatmap cells, e.g. "Nuts".
  final String short;

  /// Anaphylaxis-risk weight, 0–1. Caps a fully-present allergen's intensity.
  final double severity;
}

/// The built-in taxonomy — the app's fallback, and what the dashboard seeds
/// `settings/allergens` with on its first run.
const List<Allergen> kDefaultAllergens = [
  Allergen('milk', 'Milk', 'Milk', 0.60),
  Allergen('egg', 'Egg', 'Egg', 0.65),
  Allergen('fish', 'Fish', 'Fish', 0.85),
  Allergen('shellfish', 'Shellfish', 'Shellfish', 0.95),
  Allergen('tree_nuts', 'Tree nuts', 'Nuts', 1.00),
  Allergen('peanut', 'Peanut', 'Peanut', 1.00),
  Allergen('gluten', 'Wheat / gluten', 'Gluten', 0.60),
  Allergen('soy', 'Soy', 'Soy', 0.55),
  Allergen('sesame', 'Sesame', 'Sesame', 0.75),
];

/// Holds the taxonomy currently in force and refreshes it from Firestore.
class AllergenTaxonomy {
  AllergenTaxonomy._();

  static List<Allergen> _list = kDefaultAllergens;
  static Map<String, Allergen> _byKey = {
    for (final a in kDefaultAllergens) a.key: a,
  };

  /// Fetches the moderator-edited taxonomy. Fire-and-forget from `main()`:
  /// any failure (offline, missing doc) simply leaves the defaults in force.
  static Future<void> load() async {
    try {
      final snap = await FirebaseFirestore.instance
          .collection('settings')
          .doc('allergens')
          .get();
      final parsed = _parse(snap.data()?['list']);
      // A malformed doc keeps the defaults; a deliberately emptied taxonomy
      // (a valid, empty list) is honoured.
      if (parsed == null) return;
      _list = parsed;
      _byKey = {for (final a in parsed) a.key: a};
    } catch (_) {
      // Offline or unreadable — the built-in taxonomy stands.
    }
  }

  /// Coerces the stored `list` into well-formed entries (drops blank or
  /// duplicate keys, clamps severity). Null when [raw] isn't a list at all.
  static List<Allergen>? _parse(Object? raw) {
    if (raw is! List) return null;
    final out = <Allergen>[];
    final seen = <String>{};
    for (final e in raw) {
      if (e is! Map) continue;
      final key = e['key']?.toString().trim() ?? '';
      final label = e['label']?.toString().trim() ?? '';
      if (key.isEmpty || label.isEmpty || !seen.add(key)) continue;
      final short = e['short']?.toString().trim() ?? '';
      final sev = e['severity'];
      out.add(Allergen(
        key,
        label,
        short.isEmpty ? label : short,
        sev is num ? sev.toDouble().clamp(0.0, 1.0) : 0.6,
      ));
    }
    return out;
  }
}

/// The taxonomy currently in force, in display order.
List<Allergen> get kAllergens => AllergenTaxonomy._list;

/// Key → [Allergen], for resolving a stored key back to its definition.
Map<String, Allergen> get kAllergenByKey => AllergenTaxonomy._byKey;

/// Sanitises a raw Firestore `allergens` value into a clean key list (trimmed,
/// de-duplicated). Unknown keys are kept — the taxonomy may still be loading,
/// or the tag may predate a taxonomy edit — and are filtered out at display
/// time by [knownAllergens] / [kAllergenByKey] lookups instead.
List<String> parseAllergens(Object? raw) {
  if (raw is! List) return const [];
  final out = <String>[];
  for (final e in raw) {
    final key = e.toString().trim();
    if (key.isNotEmpty && !out.contains(key)) out.add(key);
  }
  return out;
}

/// Resolves stored keys against the current taxonomy, dropping any an admin
/// has since deleted (or that haven't loaded), in taxonomy-agnostic tag order.
List<Allergen> knownAllergens(Iterable<String> keys) => [
      for (final k in keys)
        if (kAllergenByKey[k] != null) kAllergenByKey[k]!,
    ];

/// One allergen's standing across an aggregated set of products: how many of
/// them list it ([count] of [total]) and the resulting heat [intensity].
class AllergenStat {
  const AllergenStat(this.allergen, this.count, this.total);

  final Allergen allergen;
  final int count; // products in the set that list this allergen
  final int total; // products in the set

  /// Share of the set that lists this allergen, 0–1.
  double get frequency => total == 0 ? 0 : count / total;

  /// Heat value driving the cell colour: prevalence scaled by risk, 0–1.
  double get intensity => frequency * allergen.severity;

  bool get present => count > 0;
}

/// Aggregates the current taxonomy across [products], one [AllergenStat] per
/// allergen, in taxonomy order. Absent allergens carry count 0 — the heatmap
/// only renders the present ones.
List<AllergenStat> aggregateAllergens(List<Product> products) {
  final total = products.length;
  return [
    for (final a in kAllergens)
      AllergenStat(
        a,
        products.where((p) => p.allergens.contains(a.key)).length,
        total,
      ),
  ];
}

/// Whether any product in [stats] actually carries allergen data — used to hide
/// the heatmap entirely (rather than show an all-clear that might mislead) when
/// a category simply hasn't been tagged yet.
bool hasAnyAllergenData(List<AllergenStat> stats) =>
    stats.any((s) => s.present);
