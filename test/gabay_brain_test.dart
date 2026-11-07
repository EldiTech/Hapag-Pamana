import 'package:flutter_test/flutter_test.dart';
import 'package:hapag_pamana/data/catering.dart';
import 'package:hapag_pamana/data/gabay_brain.dart';
import 'package:hapag_pamana/data/gabay_corpus.dart';
import 'package:hapag_pamana/data/gabay_sales_insights.dart';
import 'package:hapag_pamana/data/gabay_user_model.dart';
import 'package:hapag_pamana/data/member_preferences.dart';
import 'package:hapag_pamana/data/product.dart';
import 'package:hapag_pamana/data/recommendation.dart';

/// A small, fixed catalogue so the assistant's answers can be asserted exactly.
const _fiesta = CateringPackage(
  id: 'fiesta',
  name: 'Hapag Fiesta',
  type: kPackageTypeCatering,
  image: '',
  price: 450,
  minPax: 50,
  inclusions: ['Beef or Pork or Seafood', 'Rice or Pasta'],
  standardServices: ['Buffet set-up', 'Uniformed crew'],
  active: true,
);

const _premium = CateringPackage(
  id: 'premium',
  name: 'Hapag Premium',
  type: kPackageTypeCatering,
  image: '',
  price: 850,
  minPax: 100,
  inclusions: ['Beef or Seafood', 'Dessert'],
  standardServices: ['Buffet set-up'],
  active: true,
);

const _serbisyo = CateringPackage(
  id: 'serbisyo',
  name: 'Hapag Serbisyo',
  type: kPackageTypeCatering,
  image: '',
  price: 400,
  minPax: 30,
  inclusions: ['Chicken or Pork', 'Rice'],
  standardServices: ['Institutional service'],
  active: true,
);

const _dishes = [
  Product(
    id: 'hipon',
    name: 'Sinigang na Hipon',
    type: 'Catering Food Trays',
    category: 'Seafood',
    image: '',
    available: true,
    featured: false,
    allergens: ['shellfish'],
  ),
  Product(
    id: 'chopsuey',
    name: 'Chopsuey',
    type: 'Catering Food Trays',
    category: 'Vegetables',
    image: '',
    available: true,
    featured: false,
    allergens: [],
  ),
  Product(
    id: 'lechon',
    name: 'Lechon Kawali',
    type: 'Catering Food Trays',
    category: 'Pork',
    image: '',
    available: true,
    featured: false,
    allergens: [],
  ),
];

GabayBrain _brain({
  MemberPreferences prefs = const MemberPreferences(),
  GabayUserModel user = const GabayUserModel(firstName: 'Ana'),
  GabaySlots? slots,
}) {
  const packages = [_fiesta, _premium, _serbisyo];
  return GabayBrain(
    corpus: GabayCorpus.build(packages: packages, menu: _dishes),
    packages: packages,
    menu: _dishes,
    user: user,
    prefs: prefs,
    recs: RecommendationSet.empty,
    slots: slots,
  );
}

void main() {
  group('sales grounding', () {
    test('the bundled 2025 figures add up to the workbook total', () {
      final total = GabaySalesInsights.bundled.totalOf(2025);
      expect(total, closeTo(14362963.37, 0.01));
    });

    test('the busiest months come from the recorded books', () {
      final peak = GabaySalesInsights.bundled.peakMonths;
      expect(peak, contains(11));
      expect(peak, contains(12));
      expect(peak, contains(8));
    });
  });

  group('GabayBrain', () {
    test('matches a package to a stated headcount and budget', () {
      final reply = _brain().respond(
        'Recommend a package for 50 pax, budget 25,000',
      );
      expect(reply, contains('Hapag Fiesta'));
      expect(reply, isNot(contains('Hapag Premium')));
      expect(reply, contains('₱500.00'));
    });

    test('keeps its question open so a follow-up completes the match', () {
      final brain = _brain();
      final first = brain.respond('Recommend a package');
      expect(first, contains('How many guests'));

      final second = brain.respond('80 pax');
      expect(second, contains('Hapag Fiesta'));

      final third = brain.respond('my budget is 40,000');
      expect(third, contains('Hapag Fiesta'));
      expect(third, contains('₱500.00'));
    });

    test('hides the institutional package unless the occasion allows it', () {
      final reply = _brain().respond(
        'Recommend a package for 40 pax, budget 20,000',
      );
      expect(reply, isNot(contains('Hapag Serbisyo')));
    });

    test('answers peak season from the uploaded sales data', () {
      final reply = _brain().respond('when is your busiest season?');
      expect(reply, contains('November'));
      expect(reply, contains('December'));
      expect(reply, contains('2025'));
    });

    test('leaves out dishes carrying an avoided allergen', () {
      const prefs = MemberPreferences(avoidAllergens: {'shellfish'});
      final reply = _brain(prefs: prefs).respond(
        'suggest healthier meal options',
      );
      expect(reply, isNot(contains('Sinigang na Hipon')));
      expect(reply, contains('Chopsuey'));
    });

    test('builds a planning checklist from the stated event', () {
      final reply = _brain().respond(
        'make me a planning checklist for 50 pax wedding in December',
      );
      expect(reply, contains('BEFORE BOOKING'));
      expect(reply, contains('Half the total holds the date'));
      expect(reply, contains('December 1'));
    });

    test('answers a policy question from the business\'s own copy', () {
      final reply = _brain().respond('how much is the downpayment?');
      expect(reply, contains('Half the order total'));
      expect(reply, contains('Xendit'));
    });

    test('says so plainly when nothing grounded fits', () {
      final reply = _brain().respond('who won the 2010 world cup');
      expect(reply, contains('invent an answer'));
    });
  });

  group('GabayUserModel', () {
    test('claims no history for a member who has not ordered', () {
      final user = GabayUserModel.build(
        displayName: 'Ana Cruz',
        bookings: const [],
        menu: _dishes,
      );
      expect(user.firstName, 'Ana');
      expect(user.hasHistory, isFalse);
      expect(user.summary(), isEmpty);
    });

    test('reads the booking date the wizard writes', () {
      final date = parseBookingDate('December 12, 2026');
      expect(date, isNotNull);
      expect(date!.month, 12);
      expect(date.day, 12);
      expect(date.year, 2026);
    });
  });
}
