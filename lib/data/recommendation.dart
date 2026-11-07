import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'allergens.dart';
import 'catering.dart';
import 'member_preferences.dart';
import 'product.dart';
import 'taste_profile.dart';

/// Why a member is being shown what they're being shown.
///
/// The four sources are a fallback chain, strongest first: what other customers
/// ordered alongside this member's choices, then the member's own history, then
/// their taste-quiz answers, then the moderator's featured picks. Gabay names
/// the source on the panel — a recommendation that can't say why it's there is
/// just an advert.
///
/// Each label claims exactly as much as its tier can support, and no more. Only
/// [crowd] draws on other customers (through the `co_occurrences` tally the
/// Orders dashboard keeps), so only [crowd] may say so; [cf] is one member's own
/// orders reflected back, so it says "your".
enum RecommendationSource {
  /// Item-based collaborative filtering over the whole customer base's completed
  /// orders — the only tier that knows anything beyond this one member.
  crowd('crowd', 'Ordered with your favourites'),

  /// Content-based filtering over the member's own completed bookings.
  cf('cf', 'Based on your past orders'),

  /// From the sign-up quiz, before this member has ordered anything.
  tasteProfile('taste_profile', 'Based on your taste profile'),

  /// Nothing to go on yet — the moderator's featured dishes stand in.
  featured('featured', 'Featured by the kitchen');

  const RecommendationSource(this.wire, this.label);

  /// The value a stored set carries in
  /// `customers/{uid}.recommendations.source`. Kept stable so a future backend
  /// and this app agree on the vocabulary.
  final String wire;

  /// The badge shown beside the panel heading.
  final String label;

  /// Resolves a stored value, falling back to [featured] — the weakest claim,
  /// which is the right thing to say when we can't tell what produced the list.
  static RecommendationSource parse(Object? raw) {
    for (final v in values) {
      if (v.wire == raw) return v;
    }
    return RecommendationSource.featured;
  }
}

/// A recommendation set stored on `customers/{uid}.recommendations`.
///
/// Nothing writes this field today — recommendations are computed on the device
/// by [RecommendationEngine], and firestore.rules forbids a client to write here
/// at all. It is read anyway, and preferred over the local computation when
/// present, so that adding a server-side engine later is a deploy rather than a
/// refactor.
///
/// [items] are opaque ids — a `products` id or a `packages` id — since dishes
/// and packages are both recommendable. [RecommendationRepository.resolveItems]
/// turns them back into things with a name and a picture.
class Recommendations {
  const Recommendations({
    this.items = const <String>[],
    this.source = RecommendationSource.featured,
    this.computedAt,
  });

  factory Recommendations.fromMap(Object? raw) {
    if (raw is! Map) return const Recommendations();
    final items = raw['items'];
    final at = raw['computedAt'];
    return Recommendations(
      items: items is! List
          ? const <String>[]
          : [
              for (final e in items)
                if (e.toString().trim().isNotEmpty) e.toString().trim(),
            ],
      source: RecommendationSource.parse(raw['source']),
      computedAt: at is Timestamp ? at.toDate() : null,
    );
  }

  /// Top-N product / package ids, best first.
  final List<String> items;

  final RecommendationSource source;

  final DateTime? computedAt;

  bool get isEmpty => items.isEmpty;
}

/// One resolved recommendation — an id matched back to the live menu.
///
/// Exactly one of [product] / [package] is set. A sealed pair rather than a
/// common supertype because the two render differently (a dish opens its
/// quick-look sheet, a package opens the booking wizard) and the call sites need
/// to know which they hold.
class RecommendedItem {
  const RecommendedItem.dish(Product this.product) : package = null;
  const RecommendedItem.package(CateringPackage this.package) : product = null;

  final Product? product;
  final CateringPackage? package;

  bool get isPackage => package != null;

  String get id => product?.id ?? package!.id;

  String get name => product?.name ?? package!.name;

  /// The line under the name — a dish's menu category, a package's family.
  String get subtitle =>
      product?.category ??
      (package!.isFoodPack ? 'Food pack' : 'Catering package');

  /// The item's photo, in whichever form the moderator uploaded it. Empty when
  /// there isn't one.
  String get image => product?.image ?? package!.image;
}

/// A resolved recommendation strip — the items to draw and an honest account of
/// where they came from.
///
/// Lives here beside [RecommendationSource] rather than with the repository that
/// builds it, because both the engine that computes a set and the repository
/// that serves one need to name this type, and the repository already imports
/// the engine.
class RecommendationSet {
  const RecommendationSet({required this.items, required this.source});

  static const RecommendationSet empty = RecommendationSet(
    items: <RecommendedItem>[],
    source: RecommendationSource.featured,
  );

  final List<RecommendedItem> items;
  final RecommendationSource source;

  bool get isEmpty => items.isEmpty;
  bool get isNotEmpty => items.isNotEmpty;
}

/// The on-device, member-aware read Gabay uses when composing a reply.
///
/// Built from the member's own context only — preferences, taste profile, and
/// membership history if it exists — so the chat page never hands a personal
/// stream or a Firestore doc across the knowledge boundary. It intentionally
/// does **not** know about the recommendation strip; "why this?" stays the
/// job of [GabayExplanationKnowledge], which is the only class that should name
/// [RecommendationSet].
///
/// Every accessor returns a conservative default when there's nothing to go on,
/// rather than a guess. A member with no completed bookings and no finished quiz
/// is still a valid person here — they just have no stated group size, budget,
/// occasion types, or diet directive yet.
class GabayPersonalization {
  const GabayPersonalization({
    required this.prefs,
    this.groupSize,
    this.occasionTypes = const <OccasionType>{},
    this.dietDirective,
    this.healthierFirst = false,
    this.flavorNotes = const <FlavorNote>{},
  });

  /// The member's settings in force right now.
  final MemberPreferences prefs;

  /// The member's usual crowd, from their own orders if any, otherwise whatever
  /// the chat page parsed out of the incoming message.
  final GroupSize? groupSize;

  /// The occasions this member cares about, from their finished quiz, converted
  /// to the enum the rest of the app uses. Empty when the quiz is unfinished or
  /// absent — the chat page then falls back to message parsing.
  final Set<OccasionType> occasionTypes;

  /// A short phrase summarising any dietary direction the member has given us,
  /// for a single plain-English line in a reply. Null when there's nothing.
  final String? dietDirective;

  /// Whether healthier options should be led with. Comes from the member's own
  /// setting, not from a guess.
  final bool healthierFirst;

  /// Convenience: the member's avoid-allergen keys in force.
  Iterable<String> get avoidAllergens => prefs.avoidAllergens;

  /// Convenience: the dietary style the member picked, if any.
  DietStyle get diet => prefs.diet;

  /// The set of flavor notes the member leaned toward, if any — only present
  /// after they've finished the quiz.
  final Set<FlavorNote> flavorNotes;

  /// Builds a [GabayPersonalization] from the member's live context.
  ///
  /// Reads the member's own taste profile (the sign-up quiz) and their
  /// membership history if that repository is available. When neither exists,
  /// returns a personalization with no quiz answers and no history — the chat
  /// page then parses the incoming message instead.
  static Future<GabayPersonalization> fromContext({
    required MemberPreferences prefs,
    TasteProfile? profile,
    CustomerMembership? membership,
    GabayChatHistory? history,
  }) async {
    final occasionTypes = <OccasionType>{};
    for (final key in profile?.occasionTypes ?? const <String>{}) {
      final parsed = OccasionType.fromKey(key);
      if (parsed != null) occasionTypes.add(parsed);
    }
    if (membership != null) {
      for (final key in membership.occasionTypes) {
        final parsed = OccasionType.fromKey(key);
        if (parsed != null) occasionTypes.add(parsed);
      }
    }

    final dietDirective = _dietDirective(prefs);
    final groupSize = membership?.usualGroupSize ?? profile?.groupSize;

    return GabayPersonalization(
      prefs: prefs,
      groupSize: groupSize,
      occasionTypes: occasionTypes,
      dietDirective: dietDirective,
      healthierFirst: prefs.gabayHealthierFirst,
      flavorNotes:
          profile?.flavorProfile
              .map((k) => FlavorNote.fromKey(k))
              .whereType<FlavorNote>()
              .toSet() ??
          const {},
    );
  }

  /// Packages worth surfacing to this member when they've named a budget and/or
  /// a guest count in their message.
  ///
  /// Skips anything whose minimum headcount the member's usual crowd can't
  /// satisfy, and prefers packages whose inclusions the member's occasion types
  /// touch on. It does **not** invent a price or an inclusion — it only filters
  /// the published catalog.
  List<CateringPackage> packagesFitting(
    List<CateringPackage> all, {
    BudgetRange? budget,
    GroupSize? group,
  }) {
    final groupToTest = group ?? groupSize ?? GroupSize.medium;
    final budgetToTest = budget ?? _budgetFromPrefs();

    final fitting = all.where((pkg) {
      if (pkg.minPax > _maxPax(groupToTest)) return false;
      if (budgetToTest != null && pkg.price > _maxPerHead(budgetToTest)) {
        return false;
      }
      if (budgetToTest != null && pkg.price < _minPerHead(budgetToTest)) {
        return false;
      }
      return true;
    }).toList();

    if (fitting.isEmpty) return fitting;
    if (occasionTypes.isEmpty || !prefs.gabaySuggestions) return fitting;

    final ordered = <CateringPackage>[];
    final skipped = <CateringPackage>[];
    for (final pkg in fitting) {
      if (_packageSuitsOccasions(pkg)) {
        ordered.add(pkg);
      } else {
        skipped.add(pkg);
      }
    }
    return [...ordered, ...skipped];
  }

  /// A personalized package reply for a member, grounded in their own context.
  ///
  /// This is the "match my budget and guest count" capability, personalized: it
  /// uses the member's own budget band, group size, occasion types, and past
  /// orders when they exist, and says so honestly when they don't.
  String packageReply(
    List<CateringPackage> fitting, {
    required BudgetRange? budget,
    required GroupSize? group,
  }) {
    final shown = fitting.take(3).toList();
    final names = shown.map((p) => p.name).join(', ');
    final parts = <String>[];

    if (budget != null || _budgetFromPrefs() != null) {
      final band = budget ?? _budgetFromPrefs()!;
      parts.add('At around ${_budgetText(band)} a head, ');
    } else {
      parts.add('For your budget, ');
    }

    if (group != null || groupSize != null) {
      final size = group ?? groupSize!;
      parts.add('for ${_groupText(size)}, ');
    }

    parts.add(
      'the packages that fit are $names. '
      'Tap one to see what it includes and book it. '
      'Each one lists its own inclusions and minimum guest count, so you can check it '
      'against your event before you commit.',
    );

    final why = _whyThesePackages(shown, budget: budget, group: group);
    if (why.isNotEmpty) {
      parts.add(why);
    }

    return parts.join();
  }

  /// A short, honest note about why these packages were chosen for this member.
  ///
  /// Only says as much as the member's own context supports. Never invents a
  /// "because you ordered X" when there's no order history to back it.
  String _whyThesePackages(
    List<CateringPackage> shown, {
    required BudgetRange? budget,
    required GroupSize? group,
  }) {
    final parts = <String>[];

    if (occasionTypes.isNotEmpty) {
      final labels = occasionTypes.map((o) => o.label).take(2).join(' and ');
      parts.add('I leaned toward packages that suit $labels.');
    }

    if (prefs.avoidAllergens.isNotEmpty) {
      parts.add(
        ' I also kept your ${prefs.avoidAllergens.length} avoided allergen${prefs.avoidAllergens.length == 1 ? '' : 's'} in mind — but the kitchen is the final word on that.',
      );
    }

    if (parts.isEmpty) {
      return '';
    }

    return ' ${parts.join()}';
  }

  /// Leaner / healthier alternatives for a dish, from the same publisher menu.
  ///
  /// This is a menu-similarity helper, not a nutrition engine: it prefers dishes
  /// in lighter categories and dishes the member's profile would likely enjoy,
  /// and it avoids the allergens the member asked us to avoid when possible.
  /// When the menu hasn't tagged a dish's allergens yet, the result is still
  /// returned — the chat page adds the shared-equipment caveat.
  List<Product> leanAlternativesFor(Product dish, List<Product> all) {
    final pool = all.where((p) {
      if (p.id == dish.id) return false;
      if (p.category == dish.category) return false;
      if (p.allergens.any((key) => avoidAllergens.contains(key))) return false;
      return true;
    }).toList();

    if (pool.isEmpty) return pool;

    pool.sort((a, b) {
      final aLight = _lighterCategoryScore(a.category);
      final bLight = _lighterCategoryScore(b.category);
      final aLikely = _likelyFor(a) ? 1 : 0;
      final bLikely = _likelyFor(b) ? 1 : 0;
      final aAvoid = a.allergens.any((k) => avoidAllergens.contains(k)) ? 1 : 0;
      final bAvoid = b.allergens.any((k) => avoidAllergens.contains(k)) ? 1 : 0;
      return (aLight + aLikely - aAvoid).compareTo(bLight + bLikely - bAvoid);
    });

    return pool.take(4).toList();
  }

  /// A plain-English note to append when suggesting a leaner dish to this member,
  /// when their avoided allergens overlap with the dish we're swapping away from.
  String noteHealthierCrossAllergens(Product dish, {Product? alternative}) {
    final dishOverlap = dish.allergens
        .where((k) => avoidAllergens.contains(k))
        .toList();
    if (dishOverlap.isEmpty) return '';

    final avoided = dishOverlap
        .map((k) => _allergenLabel(k))
        .take(2)
        .join(' and ');
    if (prefs.avoidAllergens.length > 2) {
      return ' A couple of these still carry something you asked us to keep away from ($avoided, among others), so double-check with the kitchen — especially if it\'s a serious allergy.';
    }
    return ' Some of these still carry something you asked us to keep away from ($avoided), so double-check with the kitchen — especially if it\'s a serious allergy.';
  }

  /// Whether this member's allergen list has any overlap with a dish's.
  bool allergensOverlap(Product dish) {
    return dish.allergens.any((k) => avoidAllergens.contains(k));
  }

  /// A short label for an allergen key, for in-line mentions.
  String _allergenLabel(String key) {
    final known = kAllergenByKey[key];
    return known?.short ?? key;
  }

  /// A rough ordering signal for a category name — higher means "leaner-leaning".
  int _lighterCategoryScore(String category) {
    final lower = category.toLowerCase();
    if (lower.contains('salad') ||
        lower.contains('vegetable') ||
        lower.contains('grilled') ||
        lower.contains('seafood') ||
        lower.contains('fish')) {
      return 3;
    }
    if (lower.contains('soup') ||
        lower.contains('sandwich') ||
        lower.contains('snack')) {
      return 2;
    }
    return 1;
  }

  /// Whether the member's profile suggests they'd likely enjoy this dish.
  bool _likelyFor(Product dish) {
    if (flavorNotes.isNotEmpty) {
      final lower = dish.category.toLowerCase();
      for (final note in flavorNotes) {
        if (_flavorNoteCovers(note, lower)) return true;
      }
    }
    return false;
  }

  bool _flavorNoteCovers(FlavorNote note, String lower) {
    return switch (note) {
      FlavorNote.seafood => lower.contains('seafood') || lower.contains('fish'),
      FlavorNote.vegetables =>
        lower.contains('vegetable') || lower.contains('salad'),
      FlavorNote.grilled =>
        lower.contains('grilled') || lower.contains('inihaw'),
      _ => false,
    };
  }

  BudgetRange? _budgetFromPrefs() => prefs.tasteProfile?.budgetRange;

  static int _maxPax(GroupSize group) => switch (group) {
    GroupSize.small => 30,
    GroupSize.medium => 100,
    GroupSize.large => 1000000,
  };

  static num _minPerHead(BudgetRange budget) => switch (budget) {
    BudgetRange.budget => 0,
    BudgetRange.mid => 350,
    BudgetRange.premium => 700,
  };

  static num _maxPerHead(BudgetRange budget) => switch (budget) {
    BudgetRange.budget => 350,
    BudgetRange.mid => 700,
    BudgetRange.premium => 1000000000,
  };

  static String? _dietDirective(MemberPreferences prefs) {
    if (prefs.diet != DietStyle.none) return prefs.diet.label;
    final avoid = prefs.avoidAllergens.toList()..sort();
    if (avoid.isEmpty) return null;
    final joined = avoid
        .map((k) => kAllergenByKey[k]?.label ?? k)
        .join(' and ');
    return 'avoiding $joined';
  }

  static String _budgetText(BudgetRange budget) {
    return switch (budget) {
      BudgetRange.budget => '₱350',
      BudgetRange.mid => '₱350–₱700',
      BudgetRange.premium => '₱700',
    };
  }

  static String _groupText(GroupSize size) {
    return switch (size) {
      GroupSize.small => 'up to 30 guests',
      GroupSize.medium => '30–100 guests',
      GroupSize.large => 'more than 100 guests',
    };
  }

  static bool _packageSuitsOccasions(CateringPackage pkg) {
    final lower = '${pkg.name} ${pkg.inclusions.join(' ')}'.toLowerCase();
    for (final occasion in OccasionType.values) {
      if (_occasionPhrases(occasion).any((p) => lower.contains(p))) {
        return true;
      }
    }
    return false;
  }

  static Iterable<String> _occasionPhrases(OccasionType occasion) {
    return switch (occasion) {
      OccasionType.birthday => ['birthday', 'birthday', 'kids', 'cake'],
      OccasionType.wedding => ['wedding', 'wedding', 'bridal', 'wedding'],
      OccasionType.fiesta => ['fiesta', 'fiesta', 'party', 'merienda'],
      OccasionType.corporate => ['corporate', 'company', 'office'],
      OccasionType.reunion => ['reunion', 'family', 'pamilya'],
      OccasionType.funeral => ['funeral', 'lamay', 'burol'],
      OccasionType.religious => ['baptism', 'binyag', 'kumpil', 'confirmation'],
      OccasionType.everyday => ['everyday', 'daily', 'meal'],
    };
  }
}

/// A short-lived scratch object used only while Gabay is composing a reply.
///
/// Lives in this library because [GabayPersonalization.fromContext] needs it,
/// and it stays deliberately thin: it holds only the bits of membership and
/// history the chat layer is willing to share with the knowledge layer for a
/// single reply. It is not a domain model for the rest of the app.
class GabayPersonalizationSnapshot {
  const GabayPersonalizationSnapshot({this.membership, this.history});

  final CustomerMembership? membership;
  final GabayChatHistory? history;
}

/// The bits of a member's profile the chat layer may share with the knowledge
/// layer for a single reply.
///
/// Kept separate from [Customer] and [Booking] so the knowledge layer never
/// imports the wider customer/booking domain — it only gets the narrow,
/// read-only context it needs.
class CustomerMembership {
  const CustomerMembership({
    this.occasionTypes = const <String>{},
    this.usualGroupSize,
  });

  final Set<String> occasionTypes;
  final GroupSize? usualGroupSize;
}

/// A tiny read-only view of the member's recent bookings, exposed only so the
/// chat layer can pass a little context to [GabayPersonalization.fromContext].
///
/// Does not expose booking ids, venue addresses, dates, payments, or kit — just
/// the aggregate bits a personalized reply might reasonably use.
class GabayChatHistory {
  const GabayChatHistory({
    this.mostCommonHeadcount,
    this.occasionTypes = const <String>{},
    this.favoriteDishIds = const <String>{},
  });

  /// The headcount this member orders for most often, or null when they have no
  /// completed orders.
  final GroupSize? mostCommonHeadcount;

  /// Occasion types this member has ordered for, if any.
  final Set<String> occasionTypes;

  /// Product ids this member has ordered most often, if any — only used as a
  /// weak signal, never as a hard rule.
  final Set<String> favoriteDishIds;
}

/// The taste profile currently in force for the signed-in member, if any.
///
/// This is the member-facing mirror of [MemberPreferences.tasteProfile]: the
/// preferences object owns the stream and the cache, and exposes this only so
/// the rest of the app can read the quiz answers without reconstructing them
/// from the raw map.
class GabayPreferenceCompat {
  const GabayPreferenceCompat({
    this.orderUpdates = true,
    this.promotions = true,
    this.gabaySuggestions = true,
    this.healthierFirst = false,
    this.diet = DietStyle.none,
    this.avoidAllergens = const <String>{},
    this.language = AppLanguage.english,
    this.tasteProfile,
  });

  factory GabayPreferenceCompat.fromMap(Map<String, Object?>? data) {
    bool flag(String key, bool fallback) {
      final v = data?[key];
      return v is bool ? v : fallback;
    }

    final raw = data?['avoidAllergens'];
    return GabayPreferenceCompat(
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

  /// How this member eats — recorded on the profile so the kitchen and Gabay
  /// can work to it. The menu carries no per-dish diet tags, so nothing is
  /// filtered on this alone (see [avoidAllergens], which the menu *does* act on).
  final DietStyle diet;

  /// Allergen keys ([Allergen.key]) the member has asked us to keep away from.
  /// The Menu and the dish quick-look flag anything carrying one of these.
  final Set<String> avoidAllergens;

  /// The language the app runs in.
  final AppLanguage language;

  /// The signed-in member's taste profile, if we have one loaded already.
  final TasteProfile? tasteProfile;

  /// True when the member has told us anything at all about how they eat.
  bool get hasDietaryNeeds =>
      diet != DietStyle.none || avoidAllergens.isNotEmpty;

  /// The dietary choice read back in a line, for the Settings row's subtitle —
  /// "Not set yet", "Vegetarian", "Avoiding 3 allergens",
  /// "Vegetarian · avoiding 3 allergens".
  String get dietarySummary {
    final count = avoidAllergens.length;
    final avoiding = count == 0
        ? ''
        : 'avoiding $count allergen${count == 1 ? '' : 's'}';
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
    if (tasteProfile != null) 'tasteProfile': tasteProfile!.toMap(),
  };

  GabayPreferenceCompat copyWith({
    bool? orderUpdates,
    bool? promotions,
    bool? gabaySuggestions,
    bool? healthierFirst,
    DietStyle? diet,
    Set<String>? avoidAllergens,
    AppLanguage? language,
    TasteProfile? tasteProfile,
  }) {
    return GabayPreferenceCompat(
      orderUpdates: orderUpdates ?? this.orderUpdates,
      promotions: promotions ?? this.promotions,
      gabaySuggestions: gabaySuggestions ?? this.gabaySuggestions,
      healthierFirst: healthierFirst ?? this.healthierFirst,
      diet: diet ?? this.diet,
      avoidAllergens: avoidAllergens ?? this.avoidAllergens,
      language: language ?? this.language,
      tasteProfile: tasteProfile ?? this.tasteProfile,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is GabayPreferenceCompat &&
      other.orderUpdates == orderUpdates &&
      other.promotions == promotions &&
      other.gabaySuggestions == gabaySuggestions &&
      other.healthierFirst == healthierFirst &&
      other.diet == diet &&
      other.language == language &&
      setEquals(other.avoidAllergens, avoidAllergens) &&
      other.tasteProfile == tasteProfile;

  @override
  int get hashCode => Object.hash(
    orderUpdates,
    promotions,
    gabaySuggestions,
    healthierFirst,
    diet,
    language,
    Object.hashAllUnordered(avoidAllergens),
    tasteProfile,
  );

  /// The taste profile currently in force, if any.
  TasteProfile? get person => tasteProfile;
}
