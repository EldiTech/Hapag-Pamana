import 'package:flutter_test/flutter_test.dart';
import 'package:hapag_pamana/data/product.dart';

Product _product({
  required String id,
  required String name,
  String type = 'Food Packs',
  String category = 'Pasta',
}) => Product(
  id: id,
  name: name,
  type: type,
  category: category,
  image: '',
  available: true,
  featured: false,
);

void main() {
  test('duplicate menu records collapse within the same menu identity', () {
    final products = [
      _product(id: 'one', name: 'Aglio e Olio Pasta'),
      _product(id: 'two', name: '  AGLIO   E OLIO PASTA '),
      _product(id: 'three', name: 'Aglio e Olio Pasta', category: 'Sides'),
    ];

    expect(uniqueProductsByIdentity(products).map((p) => p.id), [
      'one',
      'three',
    ]);
  });

  test('home teasers show a dish name once across menu types', () {
    final products = [
      _product(id: 'one', name: 'Aglio e Olio Pasta'),
      _product(
        id: 'two',
        name: 'aglio e olio pasta',
        type: 'Catering Food Trays',
      ),
    ];

    expect(uniqueProductsByName(products).map((p) => p.id), ['one']);
  });
}
