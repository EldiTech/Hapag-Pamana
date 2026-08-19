// Add-on pricing: what one head of an extra costs, resolved from the moderator's
// per-category rates and any per-dish override.
//
// These are pure-model tests — no Firebase, no widgets. What's covered is the
// resolution rule itself, because it decides real money: it feeds the booking
// wizard's running total, the order's `paymentTotal`, and therefore the 50%
// PayMongo downpayment. The case that matters most is the negative one — an
// unpriced extra must resolve to null (quoted by the team) and never to ₱0.

import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/data/menu_category.dart';
import 'package:hapag_pamana/data/product.dart';

/// A dish in [category] of [type], optionally priced apart from its category.
Product dish(
  String name, {
  required String category,
  String type = 'Catering Food Trays',
  num? addOnPrice,
}) =>
    Product(
      id: name.toLowerCase().replaceAll(' ', '_'),
      name: name,
      type: type,
      category: category,
      image: '',
      available: true,
      featured: false,
      addOnPrice: addOnPrice,
    );

MenuCategory category(String name, {required num? price, String type = 'Catering Food Trays'}) =>
    MenuCategory(id: name.toLowerCase(), name: name, type: type, price: price);

void main() {
  group('a dish inherits its category', () {
    final pricing = AddOnPricing.from([
      category('Beef', price: 150),
      category('Appetizer', price: 75),
      category('Dessert', price: 50),
    ]);

    test('every dish in a category charges the category rate', () {
      expect(pricing.priceFor(dish('Beef Caldereta', category: 'Beef')), 150);
      expect(pricing.priceFor(dish('Beef Salpicao', category: 'Beef')), 150);
      expect(pricing.priceFor(dish('Canape', category: 'Appetizer')), 75);
      expect(pricing.priceFor(dish('Buko Pandan', category: 'Dessert')), 50);
    });

    test('the match ignores case and surrounding space', () {
      expect(pricing.priceFor(dish('Roast Beef', category: '  beef ')), 150);
    });

    test('a dish in a category nobody priced is quoted, not free', () {
      expect(pricing.priceFor(dish('Lechon Belly', category: 'Pork')), isNull);
    });
  });

  group('a dish may be priced apart from its category', () {
    final pricing = AddOnPricing.from([category('Pasta', price: 120)]);

    test('its own rate wins over the category', () {
      final squidInk = dish('Squid Ink Pasta', category: 'Pasta', addOnPrice: 150);
      expect(pricing.priceFor(squidInk), 150);
    });

    test('its neighbours in the category are unaffected', () {
      expect(pricing.priceFor(dish('Carbonara', category: 'Pasta')), 120);
    });

    test('an override stands even where the category has no rate at all', () {
      const bare = AddOnPricing.empty();
      final salmon = dish('Baked Salmon', category: 'Fish', addOnPrice: 150);
      expect(bare.priceFor(salmon), 150);
    });
  });

  group('the two menus price separately', () {
    // "Pasta" exists under both product types and need not cost the same in
    // each, so a rate must never leak across the type boundary.
    final pricing = AddOnPricing.from([
      category('Pasta', price: 120, type: 'Catering Food Trays'),
      category('Pasta', price: 95, type: 'Food Packs'),
    ]);

    test('each type charges its own rate for the same category name', () {
      expect(
        pricing.priceFor(dish('Carbonara', category: 'Pasta', type: 'Catering Food Trays')),
        120,
      );
      expect(
        pricing.priceFor(dish('Carbonara', category: 'Pasta', type: 'Food Packs')),
        95,
      );
    });

    test('a type with no category of that name inherits nothing', () {
      expect(
        pricing.priceFor(dish('Carbonara', category: 'Pasta', type: 'Buffet')),
        isNull,
      );
    });
  });

  group('an unpriced category is quoted, never given away', () {
    test('a null price is not a zero price', () {
      final pricing = AddOnPricing.from([category('Beef', price: null)]);
      expect(pricing.priceFor(dish('Roast Beef', category: 'Beef')), isNull);
      expect(pricing.isEmpty, isTrue);
    });

    test('a deliberate zero IS a rate — the kitchen may throw one in', () {
      final pricing = AddOnPricing.from([category('Rice', price: 0)]);
      expect(pricing.priceFor(dish('Steamed Rice', category: 'Rice')), 0);
      expect(pricing.isEmpty, isFalse);
    });

    test('the empty table prices nothing', () {
      const pricing = AddOnPricing.empty();
      expect(pricing.priceFor(dish('Anything', category: 'Beef')), isNull);
      expect(pricing.isEmpty, isTrue);
    });
  });
}
