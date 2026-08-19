// The on-device recommendation engine: what a member gets shown, and — the part
// that actually matters — whether the strip's badge tells the truth about where
// the picks came from.
//
// Pure-model tests: no Firebase, no widgets. The engine is a plain function over
// lists, which is the whole reason the ranking can be pinned down here rather
// than eyeballed in a running app.
//
// The four tiers are tested at their boundaries, because that's where an
// overclaim would happen: only a set the crowd tally actually produced may call
// itself `crowd`, a member with orders but no crowd signal gets `cf`, a member
// with only quiz answers gets `taste_profile`, and a member with nothing gets
// `featured`. The badge is a promise to the member about where a pick came
// from, so a tier that mislabels itself is a bug even when the picks are good.

import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/data/booking.dart';
import 'package:hapag_pamana/data/catering.dart';
import 'package:hapag_pamana/data/co_occurrence_repository.dart';
import 'package:hapag_pamana/data/product.dart';
import 'package:hapag_pamana/data/recommendation.dart';
import 'package:hapag_pamana/data/recommendation_engine.dart';
import 'package:hapag_pamana/data/taste_profile.dart';
import 'package:hapag_pamana/screens/home_sections.dart';

Product dish(
  String name, {
  String category = 'Beef',
  bool featured = false,
  bool available = true,
  int orderCount = 0,
}) => Product(
  id: name.toLowerCase().replaceAll(' ', '_'),
  name: name,
  type: 'Catering Food Trays',
  category: category,
  image: '',
  available: available,
  featured: featured,
  orderCount: orderCount,
);

/// A co-occurrence tally, written the way the Orders dashboard writes it:
/// `{'a__b': count}` keyed on the sorted pair.
CoOccurrenceTable tally(Map<String, int> pairs) {
  final neighbours = <String, Map<String, int>>{};
  pairs.forEach((key, count) {
    final parts = key.split('__');
    (neighbours[parts[0]] ??= {})[parts[1]] = count;
    (neighbours[parts[1]] ??= {})[parts[0]] = count;
  });
  return CoOccurrenceTable(neighbours);
}

CateringPackage pkg(
  String name, {
  num price = 500,
  int minPax = 30,
  bool active = true,
}) => CateringPackage(
  id: name.toLowerCase().replaceAll(' ', '_'),
  name: name,
  type: kPackageTypeCatering,
  image: '',
  price: price,
  minPax: minPax,
  inclusions: const [],
  standardServices: const [],
  active: active,
);

/// A completed order naming [menu] (one dish per line, as the wizards write it).
Booking order({
  List<String> menu = const [],
  String? packageId,
  num? total,
  int? pax,
  BookingStatus status = BookingStatus.completed,
}) => Booking(
  id: 'b_${menu.join()}_${packageId ?? ''}',
  data: {
    if (menu.isNotEmpty) 'menu': menu.join('\n'),
    'packageId': ?packageId,
    'paymentTotal': ?total,
    if (pax != null) 'pax': '$pax',
  },
  status: status,
  type: 'Catering',
  createdAt: null,
  statusUpdatedAt: null,
  deleted: false,
  history: const [],
);

void main() {
  final menu = [
    dish('Beef Caldereta', category: 'Beef'),
    dish('Beef Salpicao', category: 'Beef'),
    dish('Roast Beef', category: 'Beef'),
    dish('Buko Pandan', category: 'Dessert', featured: true),
    dish('Grilled Bangus', category: 'Seafood'),
    dish('Lechon Belly', category: 'Pork'),
  ];

  group('with nothing at all to go on', () {
    test('featured dishes stand in, and the badge says so', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
      );
      expect(set.source, RecommendationSource.featured);
      expect(set.items.single.name, 'Buko Pandan');
    });

    test('a kitchen with nothing featured yields empty, not broken', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: const TasteProfile(),
        products: [dish('Beef Caldereta')],
        packages: const [],
      );
      expect(set.isEmpty, isTrue);
      expect(set.source, RecommendationSource.featured);
    });
  });

  group('from the taste profile alone', () {
    const profile = TasteProfile(
      completed: true,
      occasionTypes: {'birthday'},
      budgetRange: BudgetRange.mid,
      groupSize: GroupSize.small,
      flavorProfile: {'seafood'},
    );

    test('a matching flavour outranks the kitchen’s featured nudge', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: profile,
        products: menu,
        packages: const [],
      );
      expect(set.source, RecommendationSource.tasteProfile);
      expect(set.items.first.name, 'Grilled Bangus');
    });

    test('it never claims to be based on past orders', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: profile,
        products: menu,
        packages: const [],
      );
      expect(set.source, isNot(RecommendationSource.cf));
    });

    test('"walang baboy" is a veto, not merely a low score', () {
      const noPork = TasteProfile(
        completed: true,
        flavorProfile: {'grilled', 'no_pork'},
      );
      final set = RecommendationEngine.compute(
        history: const [],
        profile: noPork,
        products: menu,
        packages: const [],
      );
      // "Lechon Belly" matches the `grilled` keywords, so without the veto it
      // would rank — the whole point is that it must not.
      expect(set.items.map((i) => i.name), isNot(contains('Lechon Belly')));
    });

    test('a package outside the budget band loses to one inside it', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: profile, // mid: ₱350–₱700, small: ≤30 pax
        products: const [],
        packages: [
          pkg('Bongga Package', price: 1200, minPax: 20),
          pkg('Tamang Package', price: 500, minPax: 20),
        ],
      );
      expect(set.items.first.name, 'Tamang Package');
    });

    test('a package the member could never book on size is outranked', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: profile, // small: up to 30 guests
        products: const [],
        packages: [
          pkg('Barangay Package', price: 500, minPax: 200),
          pkg('Maliit Package', price: 500, minPax: 20),
        ],
      );
      expect(set.items.first.name, 'Maliit Package');
    });

    test('the institutional package is never offered on taste alone', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: profile,
        products: const [],
        packages: [pkg('Hapag Serbisyo', price: 500, minPax: 20)],
      );
      expect(set.items, isEmpty);
    });
  });

  group('from the member’s own orders', () {
    test('a category they keep ordering brings its siblings forward', () {
      final set = RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta (10 pax)']),
        ],
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
      );
      expect(set.source, RecommendationSource.cf);
      expect(
        set.items.map((i) => i.name),
        containsAll(['Beef Salpicao', 'Roast Beef']),
      );
    });

    test('what they already ordered is not recommended back to them', () {
      final set = RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta (10 pax)']),
        ],
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
      );
      expect(set.items.map((i) => i.name), isNot(contains('Beef Caldereta')));
    });

    test(
      'history outranks the quiz — real evidence beats a stated leaning',
      () {
        final set = RecommendationEngine.compute(
          history: [
            order(menu: ['Beef Caldereta']),
          ],
          profile: const TasteProfile(
            completed: true,
            flavorProfile: {'seafood'},
          ),
          products: menu,
          packages: const [],
        );
        expect(set.source, RecommendationSource.cf);
        expect(set.items.first.name, anyOf('Beef Salpicao', 'Roast Beef'));
      },
    );

    test('an order still pending is not evidence of anything', () {
      final set = RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta'], status: BookingStatus.pending),
        ],
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
      );
      // Falls all the way through to featured — the pending order taught us
      // nothing, and there is no quiz.
      expect(set.source, RecommendationSource.featured);
    });

    test('a package already booked is not a discovery', () {
      final set = RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta'], packageId: 'handaan_package'),
        ],
        profile: const TasteProfile(),
        products: menu,
        packages: [pkg('Handaan Package')],
      );
      expect(set.items.map((i) => i.id), isNot(contains('handaan_package')));
    });

    test('a hidden dish is never recommended', () {
      final set = RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta']),
        ],
        profile: const TasteProfile(),
        products: [
          dish('Beef Caldereta', category: 'Beef'),
          dish('Beef Salpicao', category: 'Beef', available: false),
        ],
        packages: const [],
      );
      expect(set.items, isEmpty);
    });
  });

  group('from the crowd', () {
    // The member ordered Beef Caldereta. Across the customer base, that has
    // been ordered with Buko Pandan 9 times and Grilled Bangus twice.
    final crowd = tally({
      'beef_caldereta__buko_pandan': 9,
      'beef_caldereta__grilled_bangus': 2,
      'buko_pandan__grilled_bangus': 5,
    });

    final ordered = [
      order(menu: ['Beef Caldereta (10 pax)']),
    ];

    test('what others ordered alongside theirs comes first, by weight', () {
      final set = RecommendationEngine.compute(
        history: ordered,
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
        table: crowd,
      );
      expect(set.source, RecommendationSource.crowd);
      expect(set.items.map((i) => i.name), ['Buko Pandan', 'Grilled Bangus']);
    });

    test('the crowd outranks the member’s own category habit', () {
      // Content-based scoring would push the other Beef dishes; the crowd says
      // dessert and fish, and the crowd wins.
      final set = RecommendationEngine.compute(
        history: ordered,
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
        table: crowd,
      );
      expect(set.items.map((i) => i.name), isNot(contains('Beef Salpicao')));
    });

    test('an empty tally falls through to the member’s own history', () {
      final set = RecommendationEngine.compute(
        history: ordered,
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
        table: const CoOccurrenceTable.empty(),
      );
      expect(set.source, RecommendationSource.cf);
    });

    test(
      'a tally that knows nothing about their items falls through cleanly',
      () {
        final set = RecommendationEngine.compute(
          history: ordered,
          profile: const TasteProfile(),
          products: menu,
          packages: const [],
          table: tally({'grilled_bangus__buko_pandan': 4}),
        );
        // Nothing pairs with Beef Caldereta, so this must land on the member's own
        // history — and must not leak a stray crowd score into that tier.
        expect(set.source, RecommendationSource.cf);
        expect(
          set.items.map((i) => i.name),
          containsAll(['Beef Salpicao', 'Roast Beef']),
        );
      },
    );

    test('it never recommends back what the member already ordered', () {
      final set = RecommendationEngine.compute(
        history: ordered,
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
        table: crowd,
      );
      expect(set.items.map((i) => i.name), isNot(contains('Beef Caldereta')));
    });

    test('a dish the moderator has hidden is never surfaced by the crowd', () {
      final set = RecommendationEngine.compute(
        history: ordered,
        profile: const TasteProfile(),
        products: [
          dish('Beef Caldereta', category: 'Beef'),
          dish('Buko Pandan', category: 'Dessert', available: false),
        ],
        packages: const [],
        table: crowd,
      );
      expect(set.items.map((i) => i.name), isNot(contains('Buko Pandan')));
    });

    test('a member with no history has no seed, so no crowd tier', () {
      final set = RecommendationEngine.compute(
        history: const [],
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
        table: crowd,
      );
      expect(set.source, RecommendationSource.featured);
    });
  });

  group('most loved reads the house tally honestly', () {
    test('it ranks by real order count', () {
      final loved = mostLoved([
        dish('Rarely', orderCount: 2),
        dish('Often', orderCount: 40),
        dish('Sometimes', orderCount: 9),
      ]);
      expect(loved.map((p) => p.name), ['Often', 'Sometimes', 'Rarely']);
    });

    test('a single order is not a favourite', () {
      expect(mostLoved([dish('Once', orderCount: 1)]), isEmpty);
    });

    test('an untallied menu claims nothing at all', () {
      expect(mostLoved([dish('Adobo'), dish('Lumpia')]), isEmpty);
    });

    test('a hidden dish is never "most loved"', () {
      final loved = mostLoved([
        dish('Hidden', orderCount: 99, available: false),
        dish('Shown', orderCount: 3),
      ]);
      expect(loved.map((p) => p.name), ['Shown']);
    });
  });

  group('the strip is stable and bounded', () {
    test('it honours the limit', () {
      final set = RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta']),
        ],
        profile: const TasteProfile(),
        products: [
          ...menu,
          dish('Beef Kare-Kare', category: 'Beef'),
          dish('Beef Mechado', category: 'Beef'),
        ],
        packages: const [],
        limit: 2,
      );
      expect(set.items.length, 2);
    });

    test('the same evidence always produces the same order', () {
      List<String> run() => RecommendationEngine.compute(
        history: [
          order(menu: ['Beef Caldereta']),
        ],
        profile: const TasteProfile(),
        products: menu,
        packages: const [],
      ).items.map((i) => i.name).toList();

      expect(run(), run());
      // Tied scores break by name, so the pair comes back alphabetised.
      expect(run(), ['Beef Salpicao', 'Roast Beef']);
    });
  });
}
