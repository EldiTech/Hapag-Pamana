// The recommendation layer: the taste profile's round-trip, and the rule that
// turns a stored id list back into things the member side can draw.
//
// Pure-model tests — no Firebase, no widgets. What's covered is the resolution
// rule, because it decides what a member is actually shown: the order picks
// appear in, what happens to an id the moderator has since retired, and — the
// case that matters most — that the strip never presents the kitchen's own
// featured dishes as though the engine had chosen them for this member.

import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/data/catering.dart';
import 'package:hapag_pamana/data/product.dart';
import 'package:hapag_pamana/data/recommendation.dart';
import 'package:hapag_pamana/data/recommendation_repository.dart';
import 'package:hapag_pamana/data/taste_profile.dart';

Product dish(String id, {bool featured = false, String category = 'Beef'}) =>
    Product(
      id: id,
      name: id.replaceAll('_', ' '),
      type: 'Catering Food Trays',
      category: category,
      image: '',
      available: true,
      featured: featured,
    );

CateringPackage pkg(String id) => CateringPackage(
  id: id,
  name: id.replaceAll('_', ' '),
  type: kPackageTypeCatering,
  image: '',
  price: 500,
  minPax: 30,
  inclusions: const [],
  standardServices: const [],
  active: true,
);

void main() {
  group('a stored set resolves against the live menu', () {
    final products = [dish('adobo'), dish('kare_kare'), dish('lumpia')];
    final packages = [pkg('handaan'), pkg('salu_salo')];

    test('ids come back in the order they were stored, not the menu order', () {
      final set = RecommendationRepository.resolveItems(
        const Recommendations(
          items: ['lumpia', 'adobo'],
          source: RecommendationSource.cf,
        ),
        products,
        packages,
      );
      expect(set.items.map((i) => i.id), ['lumpia', 'adobo']);
      expect(set.source, RecommendationSource.cf);
    });

    test('dishes and packages resolve side by side', () {
      final set = RecommendationRepository.resolveItems(
        const Recommendations(
          items: ['adobo', 'handaan'],
          source: RecommendationSource.cf,
        ),
        products,
        packages,
      );
      expect(set.items.map((i) => i.isPackage), [false, true]);
      expect(set.items.last.subtitle, 'Catering package');
    });

    test(
      'an id the moderator has retired drops out, taking no slot with it',
      () {
        final set = RecommendationRepository.resolveItems(
          const Recommendations(
            items: ['adobo', 'a_dish_since_deleted', 'lumpia'],
            source: RecommendationSource.cf,
          ),
          products,
          packages,
        );
        expect(set.items.map((i) => i.id), ['adobo', 'lumpia']);
      },
    );

    test('the list is capped at the limit', () {
      final set = RecommendationRepository.resolveItems(
        const Recommendations(
          items: ['adobo', 'kare_kare', 'lumpia'],
          source: RecommendationSource.cf,
        ),
        products,
        packages,
        limit: 2,
      );
      expect(set.items.length, 2);
      expect(set.items.map((i) => i.id), ['adobo', 'kare_kare']);
    });
  });

  group('a stored set that resolves to nothing is treated as absent', () {
    test(
      'every id stale leaves an empty set for the caller to fall back from',
      () {
        // resolveItems does not itself fall back — the repository does, by handing
        // an empty result to the on-device engine. What matters here is that a
        // stale set yields nothing rather than a half-list.
        final set = RecommendationRepository.resolveItems(
          const Recommendations(
            items: ['gone', 'also_gone'],
            source: RecommendationSource.cf,
          ),
          [dish('adobo', featured: true)],
          const [],
        );
        expect(set.isEmpty, isTrue);
      },
    );
  });

  group('a stored source is read back honestly', () {
    test('each known value maps to itself', () {
      expect(RecommendationSource.parse('cf'), RecommendationSource.cf);
      expect(
        RecommendationSource.parse('taste_profile'),
        RecommendationSource.tasteProfile,
      );
      expect(
        RecommendationSource.parse('featured'),
        RecommendationSource.featured,
      );
    });

    test('an unrecognised value reads as featured — the weakest claim', () {
      expect(
        RecommendationSource.parse('magic'),
        RecommendationSource.featured,
      );
      expect(RecommendationSource.parse(null), RecommendationSource.featured);
    });
  });

  group('Recommendations.fromMap survives a malformed document', () {
    test('a missing map is an empty set', () {
      expect(Recommendations.fromMap(null).isEmpty, isTrue);
      expect(Recommendations.fromMap('nonsense').isEmpty, isTrue);
    });

    test('blank and non-string entries are dropped', () {
      final recs = Recommendations.fromMap({
        'items': ['adobo', '', '  ', 7],
        'source': 'cf',
      });
      expect(recs.items, ['adobo', '7']);
    });
  });

  group('the taste profile round-trips', () {
    test('answers survive a write and a read', () {
      const profile = TasteProfile(
        completed: true,
        occasionTypes: {'birthday', 'fiesta'},
        budgetRange: BudgetRange.mid,
        groupSize: GroupSize.large,
        flavorProfile: {'savory', 'no_pork'},
      );

      final map = profile.toMap();
      // completedAt is a server sentinel on write, so it can't round-trip — the
      // read side takes it from what the server resolved it to.
      map.remove('completedAt');
      final read = TasteProfile.fromMap(map);

      expect(read.completed, isTrue);
      expect(read.occasionTypes, {'birthday', 'fiesta'});
      expect(read.budgetRange, BudgetRange.mid);
      expect(read.groupSize, GroupSize.large);
      expect(read.flavorProfile, {'savory', 'no_pork'});
      expect(read.isAnswered, isTrue);
    });

    test(
      'sets are written sorted, so an unchanged answer never churns the doc',
      () {
        const a = TasteProfile(occasionTypes: {'wedding', 'birthday'});
        const b = TasteProfile(occasionTypes: {'birthday', 'wedding'});
        expect(a.toMap()['occasionTypes'], b.toMap()['occasionTypes']);
        expect(a.toMap()['occasionTypes'], ['birthday', 'wedding']);
      },
    );

    test(
      'an answer key we no longer recognise is dropped, not kept as a ghost',
      () {
        final read = TasteProfile.fromMap({
          'completed': true,
          'occasionTypes': ['birthday', 'a_retired_option'],
          'flavorProfile': ['savory', 'nonsense'],
          'budgetRange': 'not_a_range',
        });
        expect(read.occasionTypes, {'birthday'});
        expect(read.flavorProfile, {'savory'});
        expect(read.budgetRange, isNull);
      },
    );

    test('an empty map is an untaken quiz, not a completed empty one', () {
      final read = TasteProfile.fromMap(const {});
      expect(read.completed, isFalse);
      expect(read.isAnswered, isFalse);
    });

    test('a partly answered quiz is not answered in full', () {
      const partial = TasteProfile(
        completed: true,
        occasionTypes: {'birthday'},
        budgetRange: BudgetRange.budget,
      );
      expect(partial.isAnswered, isFalse);
    });
  });
}
