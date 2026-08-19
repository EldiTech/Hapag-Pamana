import 'booking.dart';
import 'catering.dart';
import 'co_occurrence_repository.dart';
import 'product.dart';
import 'recommendation.dart';
import 'taste_profile.dart';

/// Works out what to recommend a member, on the device.
///
/// ## The crowd signal, without a backend
///
/// Item-based collaborative filtering — "customers who ordered this also ordered
/// that" — needs to see across the whole customer base, and the Firestore rules
/// scope a member's read to their own bookings
/// (`resource.data.uid == request.auth.uid`). So the app cannot derive that
/// signal itself, and normally it would take a Cloud Function, which takes a
/// billing plan this project isn't on.
///
/// The way around it: the Orders dashboard already reads every booking, so it
/// keeps the tally. Completing an order there records `+1` against each pair of
/// items on it (`Admin/assets/hp-recommend.js`), into a `co_occurrences` table
/// that holds item ids and counts and never records who ordered them. The app
/// reads that table — [CoOccurrenceTable] — and does the scoring here.
///
/// The result is genuine collaborative filtering. What it isn't is instantaneous
/// or guaranteed: the tally moves when staff complete orders in the dashboard,
/// not on every database write, so it lags and can miss orders completed by
/// other means. Hence the tiers below — the crowd is preferred where it has
/// something to say, and the member's own history carries the strip where it
/// doesn't.
///
/// Everything here is a pure function over plain lists: no Firestore, no
/// singletons, no clock. [RecommendationRepository] supplies the data and this
/// decides the ranking, which is what makes the ranking testable.
///
/// ## Why this can be trusted from a client
///
/// The scoring runs on the member's own device, but the *evidence* doesn't come
/// from there: only an order manager may write `co_occurrences` (see
/// firestore.rules), so no member can inflate a pair to push their favourite
/// into everyone else's strip. A member gaming their own device only changes
/// what they themselves see, which harms nobody.
class RecommendationEngine {
  const RecommendationEngine._();

  /// Scores the live menu for one member and returns the best [limit] items.
  ///
  /// The four tiers, strongest first:
  ///
  ///  1. **Crowd** — item-based collaborative filtering over [table]: what other
  ///     customers ordered alongside the things this member has ordered. The
  ///     only tier that knows anything beyond this one member, and therefore the
  ///     only one that can surface a dish they'd never have found themselves.
  ///  2. **Own history** — the categories, packages and price band this member
  ///     orders from. Falls back here when the crowd has nothing to say about
  ///     their particular items yet.
  ///  3. **Taste profile** — the quiz answers, when there's no history at all.
  ///  4. **Featured** — the moderator's own picks, when we know nothing.
  ///
  /// The returned [RecommendationSet] names which tier actually produced the
  /// list and never overstates it — a set that came out of the quiz is labelled
  /// `taste_profile`, and only tier 1 may call itself `crowd`.
  static RecommendationSet compute({
    required List<Booking> history,
    required TasteProfile profile,
    required List<Product> products,
    required List<CateringPackage> packages,
    CoOccurrenceTable table = const CoOccurrenceTable.empty(),
    int limit = 5,
  }) {
    final completed = [
      for (final b in history)
        if (b.status == BookingStatus.completed) b,
    ];

    // Everything already ordered, so the strip never recommends back what the
    // member has just bought — the failure of this family of algorithm that a
    // member actually notices.
    final ordered = _orderedNames(completed);

    final scores = <String, double>{};
    final items = <String, RecommendedItem>{};

    void offer(String id, RecommendedItem item, double score) {
      if (score <= 0) return;
      items[id] = item;
      scores[id] = (scores[id] ?? 0) + score;
    }

    void clear() {
      scores.clear();
      items.clear();
    }

    final byProductId = {for (final p in products) p.id: p};
    final byPackageId = {for (final p in packages) p.id: p};

    // ── Tier 1: the crowd ────────────────────────────────────────────────────
    // The member's own basket, as ids, is the seed; every item the crowd has
    // ordered alongside any of it scores by how often.
    final seed = _seedIds(completed, products, packages);
    if (seed.isNotEmpty && table.isNotEmpty) {
      final crowd = <String, int>{};
      for (final id in seed) {
        table.neighboursOf(id).forEach((otherId, count) {
          if (seed.contains(otherId)) return; // already theirs
          crowd[otherId] = (crowd[otherId] ?? 0) + count;
        });
      }
      crowd.forEach((id, count) {
        final product = byProductId[id];
        if (product != null) {
          if (!product.available) return;
          if (ordered.contains(_normalise(product.name))) return;
          offer(id, RecommendedItem.dish(product), count.toDouble());
          return;
        }
        final package = byPackageId[id];
        if (package == null || !package.active) return;
        if (package.isInstitutional) return;
        offer(id, RecommendedItem.package(package), count.toDouble());
      });

      if (scores.isNotEmpty) {
        return RecommendationSet(
          items: _rank(scores, items, limit),
          source: RecommendationSource.crowd,
        );
      }
      // The crowd knew nothing about this member's items — fall through with a
      // clean slate rather than letting a stray partial score leak into tier 2.
      clear();
    }

    // ── Tier 2: the member's own history ─────────────────────────────────────
    final taste = _TasteSignal.from(completed, products, packages);
    for (final p in products) {
      if (!p.available) continue;
      if (ordered.contains(_normalise(p.name))) continue;
      offer(p.id, RecommendedItem.dish(p), taste.scoreProduct(p));
    }
    for (final pkg in packages) {
      if (!pkg.active) continue;
      offer(pkg.id, RecommendedItem.package(pkg), taste.scorePackage(pkg));
    }

    if (scores.isNotEmpty) {
      return RecommendationSet(
        items: _rank(scores, items, limit),
        source: RecommendationSource.cf,
      );
    }

    // ── Tier 3: the taste quiz ───────────────────────────────────────────────
    if (profile.isAnswered || profile.completed) {
      for (final p in products) {
        if (!p.available) continue;
        offer(p.id, RecommendedItem.dish(p), _scoreProductByTaste(p, profile));
      }
      for (final pkg in packages) {
        if (!pkg.active) continue;
        offer(
          pkg.id,
          RecommendedItem.package(pkg),
          _scorePackageByTaste(pkg, profile),
        );
      }
      if (scores.isNotEmpty) {
        return RecommendationSet(
          items: _rank(scores, items, limit),
          source: RecommendationSource.tasteProfile,
        );
      }
    }

    // ── Tier 4: the kitchen's own picks ──────────────────────────────────────
    return RecommendationSet(
      items: [
        for (final p
            in products.where((p) => p.available && p.featured).take(limit))
          RecommendedItem.dish(p),
      ],
      source: RecommendationSource.featured,
    );
  }

  /// Orders the scored ids into the final list: best first, ties broken by name
  /// so the same evidence always produces the same strip (a set that reshuffles
  /// itself on every rebuild reads as noise, not as a recommendation).
  static List<RecommendedItem> _rank(
    Map<String, double> scores,
    Map<String, RecommendedItem> items,
    int limit,
  ) {
    final ids = scores.keys.toList()
      ..sort((a, b) {
        final byScore = scores[b]!.compareTo(scores[a]!);
        if (byScore != 0) return byScore;
        return items[a]!.name.toLowerCase().compareTo(
          items[b]!.name.toLowerCase(),
        );
      });
    return [for (final id in ids.take(limit)) items[id]!];
  }

  /// The item ids the member's completed orders name — the seed the crowd tier
  /// is scored against.
  ///
  /// Bookings record what the member *chose*, by name, never by id (the wizards
  /// write the moderator's own words so the Orders board, the kitchen and the
  /// member all read the same line), so the names are resolved back against the
  /// live menu here. A name two dishes share resolves to neither: guessing
  /// between them would seed the crowd lookup off the wrong dish.
  static Set<String> _seedIds(
    List<Booking> completed,
    List<Product> products,
    List<CateringPackage> packages,
  ) {
    final byName = <String, String?>{};
    for (final p in products) {
      final key = _normalise(p.name);
      byName[key] = byName.containsKey(key) ? null : p.id;
    }

    final packageIds = {for (final p in packages) p.id};
    final ids = <String>{};
    for (final booking in completed) {
      for (final line in [
        ...booking.lines('menu'),
        ...booking.lines('menuAddOns'),
      ]) {
        final id = byName[_normalise(line)];
        if (id != null) ids.add(id);
      }
      final packageId = booking.value('packageId').isNotEmpty
          ? booking.value('packageId')
          : booking.draftPackageId;
      if (packageId.isNotEmpty && packageIds.contains(packageId)) {
        ids.add(packageId);
      }
    }
    return ids;
  }

  /// Every dish and package name the member has already ordered, normalised.
  static Set<String> _orderedNames(List<Booking> completed) {
    final names = <String>{};
    for (final booking in completed) {
      for (final line in [
        ...booking.lines('menu'),
        ...booking.lines('menuAddOns'),
      ]) {
        names.add(_normalise(line));
      }
    }
    return names;
  }

  /// Scores one dish against the quiz answers alone.
  ///
  /// The quiz records leanings, not categories, so the match is by keyword
  /// against the dish's category and name — imprecise by nature, which is why
  /// this tier is only reached when there's no history and why it's labelled
  /// honestly when it is.
  static double _scoreProductByTaste(Product p, TasteProfile profile) {
    var score = 0.0;
    final haystack = '${p.category} ${p.name}'.toLowerCase();

    for (final key in profile.flavorProfile) {
      final note = FlavorNote.fromKey(key);
      if (note == null) continue;
      // `no_pork` is a veto, not a preference: a member who asked to keep pork
      // off the table must not be recommended it however well it scores
      // otherwise.
      if (note == FlavorNote.noPork) {
        if (haystack.contains('pork') ||
            haystack.contains('lechon') ||
            haystack.contains('baboy')) {
          return 0;
        }
        continue;
      }
      for (final word in _flavorKeywords[note] ?? const <String>[]) {
        if (haystack.contains(word)) {
          score += 2;
          break;
        }
      }
    }

    // A featured dish is the kitchen's own recommendation — a mild nudge, not
    // enough to outrank a real flavour match.
    if (p.featured) score += 0.5;
    return score;
  }

  /// Scores a package against the quiz's budget and group-size answers — the two
  /// that actually constrain which packages a member can use.
  static double _scorePackageByTaste(
    CateringPackage pkg,
    TasteProfile profile,
  ) {
    var score = 0.0;

    final budget = profile.budgetRange;
    if (budget != null && _bandFor(pkg.price) == budget) score += 3;

    final group = profile.groupSize;
    if (group != null && _fitsGroup(pkg, group)) score += 3;

    // Never recommend the institutional package on taste alone — it's offered
    // strictly to church, government and school functions (see
    // [CateringPackage.isInstitutional]), so suggesting it to a household
    // planning a birthday is an offer we can't honour.
    if (pkg.isInstitutional) return 0;

    return score;
  }

  /// Which budget band a per-head price falls in — the app-side mirror of the
  /// bands the quiz asks about ([BudgetRange]).
  static BudgetRange _bandFor(num pricePerHead) {
    if (pricePerHead < 350) return BudgetRange.budget;
    if (pricePerHead <= 700) return BudgetRange.mid;
    return BudgetRange.premium;
  }

  /// Whether a package's minimum headcount suits the crowd the member feeds.
  /// A package whose minimum is above the band is simply out of reach; one well
  /// below it still works, so only the ceiling is enforced.
  static bool _fitsGroup(CateringPackage pkg, GroupSize group) =>
      switch (group) {
        GroupSize.small => pkg.minPax <= 30,
        GroupSize.medium => pkg.minPax <= 100,
        GroupSize.large => true,
      };

  /// The words that stand in for each flavour note on a Filipino menu. Matched
  /// against a dish's category and name, so a note lands whether the moderator
  /// filed it as a category ("Seafood") or only named it ("Inihaw na Liempo").
  static const Map<FlavorNote, List<String>> _flavorKeywords = {
    FlavorNote.savory: [
      'adobo',
      'caldereta',
      'menudo',
      'afritada',
      'beef',
      'chicken',
    ],
    FlavorNote.sweet: [
      'dessert',
      'sweet',
      'leche',
      'buko',
      'halo',
      'cake',
      'pandan',
    ],
    FlavorNote.sour: ['sinigang', 'paksiw', 'adobo', 'sour', 'kilawin', 'asim'],
    FlavorNote.spicy: ['bicol', 'spicy', 'chili', 'sili', 'maanghang'],
    FlavorNote.grilled: [
      'inihaw',
      'grill',
      'bbq',
      'barbecue',
      'liempo',
      'lechon',
    ],
    FlavorNote.seafood: [
      'seafood',
      'fish',
      'isda',
      'hipon',
      'shrimp',
      'squid',
      'bangus',
    ],
    FlavorNote.vegetables: [
      'vegetable',
      'gulay',
      'chopsuey',
      'pinakbet',
      'laing',
      'salad',
    ],
  };

  /// Strips a booking line down to a comparable name — the quantity and pax
  /// annotations the wizards append ("Lechon Belly × 2", "Fish Fillet (5 pax)")
  /// aren't part of the dish's identity.
  static String _normalise(String raw) => raw
      .replaceAll(RegExp(r'\s*[×x]\s*\d+\s*$', caseSensitive: false), '')
      .replaceAll(RegExp(r'\s*\([^)]*\)\s*$'), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim()
      .toLowerCase();
}

/// What a member's completed orders say about their taste — the categories they
/// order from, the packages they book, and what they spend a head.
///
/// This is the content-based stand-in for a co-occurrence tally: instead of
/// "items that appear alongside yours across the customer base", it's "items
/// like the ones you keep coming back to". One member's evidence only.
class _TasteSignal {
  const _TasteSignal({
    required this.categoryWeights,
    required this.packageIds,
    required this.orderCount,
    required this.averagePerHead,
  });

  /// How often each menu category appears across the member's orders, so a
  /// category ordered three times outranks one ordered once.
  final Map<String, int> categoryWeights;

  /// Packages already booked — used to prefer their siblings, and to avoid
  /// re-recommending the same one.
  final Set<String> packageIds;

  final int orderCount;

  /// What the member typically pays per head, or null when no order carried a
  /// figure we can divide.
  final double? averagePerHead;

  static _TasteSignal from(
    List<Booking> completed,
    List<Product> products,
    List<CateringPackage> packages,
  ) {
    final byName = <String, Product>{
      for (final p in products) RecommendationEngine._normalise(p.name): p,
    };

    final weights = <String, int>{};
    final bookedPackages = <String>{};
    final perHead = <double>[];

    for (final booking in completed) {
      for (final line in [
        ...booking.lines('menu'),
        ...booking.lines('menuAddOns'),
      ]) {
        final dish = byName[RecommendationEngine._normalise(line)];
        if (dish == null || dish.category.isEmpty) continue;
        final key = dish.category.toLowerCase();
        weights[key] = (weights[key] ?? 0) + 1;
      }

      final packageId = booking.value('packageId').isNotEmpty
          ? booking.value('packageId')
          : booking.draftPackageId;
      if (packageId.isNotEmpty) bookedPackages.add(packageId);

      final total = booking.paymentTotal;
      final pax = num.tryParse(booking.value('pax')) ?? 0;
      if (total > 0 && pax > 0) perHead.add(total / pax);
    }

    return _TasteSignal(
      categoryWeights: weights,
      packageIds: bookedPackages,
      orderCount: completed.length,
      averagePerHead: perHead.isEmpty
          ? null
          : perHead.reduce((a, b) => a + b) / perHead.length,
    );
  }

  /// True when the member has ordered nothing we could learn from — an empty
  /// signal scores nothing, which is what drops the caller through to the quiz.
  bool get isEmpty => categoryWeights.isEmpty && packageIds.isEmpty;

  double scoreProduct(Product p) {
    if (isEmpty) return 0;
    final weight = categoryWeights[p.category.toLowerCase()] ?? 0;
    if (weight == 0) return 0;
    // Repeated evidence counts for more, but with diminishing returns — one
    // heavily-ordered category shouldn't crowd every other pick out of a
    // five-item strip.
    var score = 2.0 + weight.clamp(0, 4);
    if (p.featured) score += 0.5;
    return score;
  }

  double scorePackage(CateringPackage pkg) {
    if (isEmpty) return 0;
    // A package already booked isn't a discovery.
    if (packageIds.contains(pkg.id)) return 0;
    if (pkg.isInstitutional) return 0;

    var score = 0.0;
    // Someone who books packages at all is a candidate for another one.
    if (packageIds.isNotEmpty) score += 2;

    final average = averagePerHead;
    if (average != null && average > 0) {
      // Within half a band of what they usually pay — close enough to be a real
      // option rather than an upsell.
      final ratio = pkg.price / average;
      if (ratio >= 0.6 && ratio <= 1.5) score += 3;
    }
    return score;
  }
}
