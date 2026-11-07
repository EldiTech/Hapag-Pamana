/// Gabay's grounded knowledge layer — the business's own cleaned content,
/// exposed through a Firestore-backed derivation that the chat can read from
/// without opening every underlying collection on every reply.
///
/// The ground set is derived from the same cleaned content the rest of the app
/// already relies on: the published packages, the visible menu, and the FAQ the
/// settings screen exposes. Firestore is the backing read source for the derived
/// set, not a separate editable source of truth — editing the package, menu, or
/// FAQ content changes what the ground set reflects the next time it is derived.
library;

import 'catering.dart';
import 'product.dart';
import 'recommendation.dart';
import 'taste_profile.dart';

// ---------------------------------------------------------------------------
// Ground set
// ---------------------------------------------------------------------------

/// The business's cleaned content, arranged for Gabay to read when composing a
/// reply.
///
/// This is the Firestore-backed view the chat layer prefers once phase 5 lands.
/// It is derived from the existing cleaned content rather than edited as a
/// separate source of truth, so the same package, menu, and FAQ facts the
/// moderator publishes are the facts the assistant grounds on.
class GabayGroundSet {
  const GabayGroundSet({
    required this.faq,
    required this.packages,
    required this.menu,
    required this.explanations,
    this.context = const GabayReplyContext(),
  });

  /// FAQ content the assistant can answer from.
  final GabayFaq faq;

  /// Packages the assistant may talk about and match to a member's needs.
  final GabayPackageView packages;

  /// Menu the assistant may talk about and suggest healthier alternatives from.
  final GabayMenuView menu;

  /// Reply helpers built for this ground set.
  final GabayReplyView explanations;

  /// Optional context the chat layer is willing to share with the knowledge
  /// layer for this derivation only. When absent, personalization falls back
  /// to conservative defaults.
  final GabayReplyContext context;

  bool get isEmpty => faq.isEmpty && packages.isEmpty && menu.isEmpty;
}

/// FAQ view for the ground set — the same FAQ content, but packaged for the
/// assistant's matcher.
class GabayFaq {
  const GabayFaq({required this.items});

  final List<GabayFaqItem> items;

  static const List<GabayFaq> groups = [
    GabayFaq(
      items: [
        GabayFaqItem(
          question: 'How do I book catering?',
          answer: 'Open Packages, choose a package, then tap Book Us Now.',
          tags: ['book', 'catering'],
        ),
        GabayFaqItem(
          question: 'How do I order food packs?',
          answer: 'Open Packages and tap Book Us Now on a food pack.',
          tags: ['food pack', 'order'],
        ),
        GabayFaqItem(
          question: 'What do the order statuses mean?',
          answer:
              'Pending means we are reviewing it. Confirmed means your date is locked. Completed means the event is done.',
          tags: ['status', 'order'],
        ),
      ],
    ),
    GabayFaq(
      items: [
        GabayFaqItem(
          question: 'How much do I pay up front?',
          answer:
              'Half the order total holds your date. The balance is settled with the team on event day.',
          tags: ['downpayment', 'pay'],
        ),
      ],
    ),
    GabayFaq(
      items: [
        GabayFaqItem(
          question: 'Where do allergen tags come from?',
          answer: 'Our kitchen tags every published dish.',
          tags: ['allergen'],
        ),
        GabayFaqItem(
          question: 'Can you cook around an allergy?',
          answer:
              'Set allergens in Dietary preference and mention them in your booking. We use shared equipment, so traces cannot be guaranteed.',
          tags: ['allergy'],
        ),
      ],
    ),
    GabayFaq(
      items: [
        GabayFaqItem(
          question: 'How do I change my profile photo?',
          answer: 'Open Account and tap your picture.',
          tags: ['profile'],
        ),
      ],
    ),
    GabayFaq(
      items: [
        GabayFaqItem(
          question: 'What is Gabay?',
          answer:
              'Gabay is your catering companion for packages, menus, and planning questions.',
          tags: ['gabay'],
        ),
      ],
    ),
  ];

  static GabayFaqItem? findAnswer(String query) {
    final words = query.toLowerCase().split(RegExp(r'\s+'));
    GabayFaqItem? best;
    var score = 0;
    for (final item in groups.expand((group) => group.items)) {
      final hay = '${item.question} ${item.tags.join(' ')}'.toLowerCase();
      final matches = words
          .where((word) => word.length > 2 && hay.contains(word))
          .length;
      if (matches > score) {
        score = matches;
        best = item;
      }
    }
    return best;
  }

  bool get isEmpty => items.isEmpty;
}

class GabayFaqItem {
  const GabayFaqItem({
    required this.question,
    required this.answer,
    required this.tags,
  });

  final String question;
  final String answer;
  final List<String> tags;
}

/// Package view for the ground set.
class GabayPackageView {
  const GabayPackageView({required this.all, required this.recommendable});

  final List<GabayPackageDoc> all;
  final List<GabayPackageDoc> recommendable;

  bool get isEmpty => all.isEmpty;
}

class GabayPackageDoc {
  const GabayPackageDoc({
    required this.id,
    required this.name,
    required this.type,
    required this.price,
    required this.minPax,
    required this.isInstitutional,
    required this.isFoodPack,
    required this.inclusions,
    required this.standardServices,
  });

  final String id;
  final String name;
  final String type;
  final num price;
  final int minPax;
  final bool isInstitutional;
  final bool isFoodPack;
  final List<String> inclusions;
  final List<String> standardServices;
}

/// Menu view for the ground set.
class GabayMenuView {
  const GabayMenuView({required this.all});

  final List<GabayMenuDoc> all;

  bool get isEmpty => all.isEmpty;
}

class GabayMenuDoc {
  const GabayMenuDoc({
    required this.id,
    required this.name,
    required this.category,
    required this.type,
    required this.allergens,
    required this.featured,
    required this.available,
  });

  final String id;
  final String name;
  final String category;
  final String type;
  final List<String> allergens;
  final bool featured;
  final bool available;
}

/// Reply helpers built for a ground set.
class GabayReplyView {
  const GabayReplyView({required this.explain, required this.leadIn});

  final GabayExplanation explain;
  final GabayLeadIn leadIn;
}

class GabayExplanation {
  const GabayExplanation({required this.recommendation});

  final GabayRecommendationExplanation recommendation;
}

class GabayRecommendationExplanation {
  const GabayRecommendationExplanation({
    required this.sourceLabel,
    required this.emptyReason,
  });

  final String sourceLabel;
  final String emptyReason;
}

class GabayLeadIn {
  const GabayLeadIn({required this.emptyHint, required this.hasPicksHint});

  final String emptyHint;
  final String hasPicksHint;
}

// ---------------------------------------------------------------------------
// Reply context
// ---------------------------------------------------------------------------

/// The narrow, read-only context the chat layer shares with the knowledge layer
/// for a single reply.
class GabayReplyContext {
  const GabayReplyContext({
    this.groupSize,
    this.occasionTypes = const <OccasionType>{},
    this.dietDirective,
    this.healthierFirst = false,
    this.budget,
    this.recs = const GabayContextRecommendations(),
  });

  final GroupSize? groupSize;
  final Set<OccasionType> occasionTypes;
  final String? dietDirective;
  final bool healthierFirst;
  final BudgetRange? budget;
  final GabayContextRecommendations recs;
}

class GabayContextRecommendations {
  const GabayContextRecommendations({
    this.sourceLabel = '',
    this.itemCount = 0,
    this.emptyReason = '',
    this.hasPicksHint = '',
  });

  final String sourceLabel;
  final int itemCount;
  final String emptyReason;
  final String hasPicksHint;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

class GabayKnowledge {
  /// Builds a [GabayGroundSet] from the cleaned content the app already has.
  static GabayGroundSet derive({
    required List<CateringPackage> packages,
    required List<Product> menu,
    required List<GabayFaqItem> faq,
    GabayReplyContext? context,
  }) {
    final pkgView = GabayPackageView(
      all: packages.map(_packageDoc).toList(),
      recommendable: _recommendable(packages).map(_packageDoc).toList(),
    );

    return GabayGroundSet(
      faq: GabayFaq(items: faq),
      packages: pkgView,
      menu: GabayMenuView(all: menu.map(_menuDoc).toList()),
      explanations: _replyView(packages: pkgView, menu: menu, context: context),
      context: context ?? const GabayReplyContext(),
    );
  }

  static GabayPackageDoc _packageDoc(CateringPackage p) {
    return GabayPackageDoc(
      id: p.id,
      name: p.name,
      type: p.type,
      price: p.price,
      minPax: p.minPax,
      isInstitutional: p.isInstitutional,
      isFoodPack: p.isFoodPack,
      inclusions: p.inclusions,
      standardServices: p.standardServices,
    );
  }

  static GabayMenuDoc _menuDoc(Product p) {
    return GabayMenuDoc(
      id: p.id,
      name: p.name,
      category: p.category,
      type: p.type,
      allergens: p.allergens,
      featured: p.featured,
      available: p.available,
    );
  }

  static Iterable<CateringPackage> _recommendable(List<CateringPackage> all) {
    return all.where((p) => p.active && !p.isInstitutional);
  }

  static GabayReplyView _replyView({
    required GabayPackageView packages,
    required List<Product> menu,
    GabayReplyContext? context,
  }) {
    final ctx = context ?? const GabayReplyContext();
    return GabayReplyView(
      explain: GabayExplanation(
        recommendation: GabayRecommendationExplanation(
          sourceLabel: ctx.recs.sourceLabel.isEmpty
              ? 'a recommendation'
              : ctx.recs.sourceLabel,
          emptyReason: ctx.recs.emptyReason.isEmpty
              ? 'Nothing to recommend right now — the kitchen may not have published '
                    'anything yet.'
              : ctx.recs.emptyReason,
        ),
      ),
      leadIn: GabayLeadIn(
        emptyHint:
            'I don\'t have any picks for you just yet — try asking me about packages '
            'or menus.',
        hasPicksHint: _hasPicksHint(ctx.recs.itemCount),
      ),
    );
  }

  static String _hasPicksHint(int count) {
    if (count == 0) return 'I don\'t have any picks for you just yet.';
    if (count == 1) return 'Here\'s a pick for you.';
    return 'Here are $count picks for you.';
  }

  // ---------------------------------------------------------------------------
  // FAQ matching
  // ---------------------------------------------------------------------------

  /// Best-matching FAQ item for a member's question, or null when nothing fits
  /// well.
  ///
  /// Matching is intentionally simple and on-device: we look for the item whose
  /// question shares the most meaningful words with what the member typed. This
  /// is enough for a bounded FAQ assistant, and it keeps the answers grounded in
  /// the business's own copy rather than rephrasing it into something it might
  /// get wrong.
  static GabayFaqItem? findAnswer(GabayGroundSet set, String query) {
    final needle = query.toLowerCase().trim();
    if (needle.isEmpty) return null;

    final stopwords = <String>{
      'how',
      'do',
      'i',
      'can',
      'what',
      'is',
      'are',
      'the',
      'my',
      'a',
      'an',
      'and',
      'or',
      'to',
      'for',
      'in',
      'on',
      'of',
      'with',
    };

    String? best;
    int bestScore = 0;

    for (final item in set.faq.items) {
      final hay = item.question.toLowerCase();
      final terms = needle
          .split(RegExp(r'\s+'))
          .where((w) => w.isNotEmpty && !stopwords.contains(w))
          .toSet();

      int score = 0;
      for (final term in terms) {
        if (hay.contains(term)) score++;
      }
      if (item.question.toLowerCase().contains(needle)) score += 2;

      if (score > bestScore) {
        best = item.question;
        bestScore = score;
      }
    }

    return bestScore > 0 ? _itemByQuestion(set.faq.items, best!) : null;
  }

  static GabayFaqItem? _itemByQuestion(
    List<GabayFaqItem> items,
    String question,
  ) {
    for (final item in items) {
      if (item.question.toLowerCase() == question.toLowerCase()) return item;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Package matching
  // ---------------------------------------------------------------------------

  /// Packages that plausibly fit a member's stated budget and guest count.
  static List<GabayPackageDoc> fitting(
    GabayGroundSet set, {
    required BudgetRange? budget,
    required GroupSize? group,
  }) {
    return set.packages.recommendable
        .where((p) => _fits(p, budget: budget, group: group))
        .toList();
  }

  static bool _fits(
    GabayPackageDoc pkg, {
    BudgetRange? budget,
    GroupSize? group,
  }) {
    if (budget != null && _bandFor(pkg.price) != budget) return false;
    if (group != null && !_fitsGroup(pkg, group)) return false;
    return true;
  }

  static BudgetRange _bandFor(num pricePerHead) {
    if (pricePerHead < 350) return BudgetRange.budget;
    if (pricePerHead <= 700) return BudgetRange.mid;
    return BudgetRange.premium;
  }

  static bool _fitsGroup(GabayPackageDoc pkg, GroupSize group) {
    switch (group) {
      case GroupSize.small:
        return pkg.minPax <= 30;
      case GroupSize.medium:
        return pkg.minPax <= 100;
      case GroupSize.large:
        return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Package description
  // ---------------------------------------------------------------------------

  /// Plain-language explanation of what a package includes, in the business's own
  /// words where it has them.
  static String describe(GabayPackageDoc pkg) {
    final parts = <String>[];

    if (pkg.standardServices.isNotEmpty) {
      parts.add('Standard: ${pkg.standardServices.join(", ")}.');
    }
    if (pkg.inclusions.isNotEmpty) {
      parts.add('Includes: ${pkg.inclusions.join(", ")}.');
    }
    if (pkg.minPax > 0) {
      parts.add(
        pkg.isFoodPack
            ? 'Minimum ${pkg.minPax} servings.'
            : 'Minimum ${pkg.minPax} guests.',
      );
    }

    if (parts.isEmpty) {
      return 'A ${pkg.type.toLowerCase()} package from HapagPamana.';
    }

    return parts.join(' ');
  }

  // ---------------------------------------------------------------------------
  // Healthier alternatives
  // ---------------------------------------------------------------------------

  /// Healthier alternatives to a dish, drawn from the same published menu.
  ///
  /// "Healthier" here is a menu-grounded heuristic, not a medical claim: dishes
  /// in lighter-leaning categories (vegetables, seafood, grilled protein) are
  /// treated as lighter options than heavy fried/richer courses. The assistant
  /// should present these as suggestions the member can ask the kitchen about, not
  /// as guaranteed nutritional facts.
  ///
  /// The member's own preferences are the business's settings the assistant should
  /// respect; this helper returns candidates, and the caller filters by those
  /// preferences before showing them.
  static List<GabayMenuDoc> healthierAlternatives(
    GabayGroundSet set,
    String currentCategory,
  ) {
    final others = set.menu.all
        .where(
          (p) => p.available && !_sameCategory(p.category, currentCategory),
        )
        .toList();

    final scored = others.map((p) => (_lighterScore(p.category), p)).toList()
      ..sort((a, b) => b.$1.compareTo(a.$1));

    return scored.map((e) => e.$2).toList();
  }

  static bool _sameCategory(String a, String b) {
    return a.toLowerCase() == b.toLowerCase();
  }

  static double _lighterScore(String category) {
    final key = category.toLowerCase();
    if (key.contains('vegetable') || key.contains('gulay')) return 0.9;
    if (key.contains('salad')) return 0.85;
    if (key.contains('seafood') ||
        key.contains('fish') ||
        key.contains('isda')) {
      return 0.75;
    }
    if (key.contains('grilled') || key.contains('inihaw')) {
      return 0.65;
    }
    if (key.contains('chicken') || key.contains('manok')) {
      return 0.55;
    }
    if (key.contains('dessert') ||
        key.contains('sweet') ||
        key.contains('cake')) {
      return 0.5;
    }
    if (key.contains('soup') ||
        key.contains('sabaw') ||
        key.contains('sinigang')) {
      return 0.5;
    }
    if (key.contains('pasta') ||
        key.contains('noodle') ||
        key.contains('canton')) {
      return 0.45;
    }
    if (key.contains('pork') ||
        key.contains('baboy') ||
        key.contains('beef') ||
        key.contains('baka')) {
      return 0.4;
    }
    return 0.5;
  }

  // ---------------------------------------------------------------------------
  // Explanation
  // ---------------------------------------------------------------------------

  static String explainRecommendation(GabayGroundSet set) {
    final recs = set.context.recs;
    if (recs.itemCount == 0) return recs.emptyReason;

    final count = recs.itemCount;
    final source = recs.sourceLabel;
    return 'These $count pick${count == 1 ? '' : 's'} are from $source.';
  }

  static String leadIn(GabayGroundSet set) {
    final recs = set.context.recs;
    if (recs.itemCount == 0) {
      return recs.hasPicksHint.isEmpty
          ? set.explanations.leadIn.emptyHint
          : recs.hasPicksHint;
    }
    return recs.hasPicksHint.isEmpty
        ? set.explanations.leadIn.hasPicksHint
        : recs.hasPicksHint;
  }

  // ---------------------------------------------------------------------------
  // Capability helpers
  // ---------------------------------------------------------------------------

  /// Whether a dish carries any allergen the member has asked us to avoid.
  static bool crossoversAvoided(GabayMenuDoc dish, Set<String> avoided) {
    if (avoided.isEmpty) return false;
    for (final tag in dish.allergens) {
      if (avoided.contains(tag)) return true;
    }
    return false;
  }

  /// Whether a dish carries any allergen the member has asked us to avoid.
  static bool crossesAvoided(GabayMenuDoc dish, Set<String> avoided) {
    return crossoversAvoided(dish, avoided);
  }
}

class GabayPackageKnowledge {
  static List<CateringPackage> recommendable(List<CateringPackage> all) =>
      all.where((p) => p.active && !p.isInstitutional).toList();

  static List<CateringPackage> fitting(
    List<CateringPackage> all, {
    required BudgetRange? budget,
    required GroupSize? group,
  }) => recommendable(all).where((p) {
    if (group == GroupSize.small && p.minPax > 30) return false;
    if (group == GroupSize.medium && p.minPax > 100) return false;
    if (budget == BudgetRange.budget && p.price >= 350) return false;
    if (budget == BudgetRange.mid && (p.price < 350 || p.price > 700)) {
      return false;
    }
    if (budget == BudgetRange.premium && p.price <= 700) return false;
    return true;
  }).toList();
}

class GabayPackagePersonalization {
  static String reason(
    GabayPersonalization person,
    List<CateringPackage> packages,
  ) {
    final names = packages.take(3).map((p) => p.name).join(', ');
    return 'These packages fit your request: $names.';
  }
}

class GabayMenuKnowledge {
  static List<Product> visible(List<Product> all) =>
      all.where((p) => p.available).toList();

  static List<Product> inCategory(List<Product> all, String category) =>
      visible(all)
          .where(
            (p) => p.category.toLowerCase().contains(category.toLowerCase()),
          )
          .toList();

  static List<Product> healthierAlternatives(
    List<Product> all,
    String currentCategory,
  ) => visible(all)
      .where((p) => p.category.toLowerCase() != currentCategory.toLowerCase())
      .toList();
}

class GabayExplanationKnowledge {
  static String explain(RecommendationSet recs) {
    if (recs.isEmpty) return 'No recommendations yet.';
    return 'These picks come from ${recs.source.label.toLowerCase()}.';
  }

  static String leadIn(RecommendationSet recs) => explain(recs);
}
