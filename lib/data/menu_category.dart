import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'product.dart';

/// A menu filter category published by the Content Moderator. Mirrors the
/// `categories` collection documents: { name, type, icon, price }.
///
/// `price` is the per-head rate every dish in the category carries as a booking
/// add-on — the printed menu prices add-ons by category (Appetizer ₱75/pax,
/// Beef ₱150/pax…), not dish by dish. A single dish may be priced apart from
/// its category; see [Product.addOnPrice] and [AddOnPricing].
class MenuCategory {
  const MenuCategory({
    required this.id,
    required this.name,
    required this.type,
    required this.price,
  });

  final String id;
  final String name;
  final String type; // "Food Packs" | "Catering Food Trays"

  /// The per-head add-on rate, or null when the moderator hasn't priced this
  /// category yet. Null is never 0: an unpriced category is quoted by the team,
  /// not given away.
  final num? price;

  factory MenuCategory.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final raw = d['price'];
    return MenuCategory(
      id: doc.id,
      name: (d['name'] ?? '') as String,
      type: (d['type'] ?? '') as String,
      price: raw is num && raw >= 0 ? raw : null,
    );
  }
}

/// Resolves what a dish costs per head as an add-on, given the live category
/// rates. A dish's own [Product.addOnPrice] wins; otherwise it inherits the
/// rate of the category it is filed under, matched on name *and* product type
/// (the two menus keep separate categories that share names — "Pasta" exists in
/// both, at its own rate).
class AddOnPricing {
  const AddOnPricing(this._byKey);

  /// An empty table — nothing is priced, so every dish quotes as "on request".
  /// What the booking wizard uses until the categories have loaded.
  const AddOnPricing.empty() : _byKey = const {};

  factory AddOnPricing.from(Iterable<MenuCategory> categories) {
    final byKey = <String, num>{};
    for (final c in categories) {
      final price = c.price;
      if (price != null) byKey[_key(c.type, c.name)] = price;
    }
    return AddOnPricing(byKey);
  }

  final Map<String, num> _byKey;

  static String _key(String type, String name) =>
      '${type.trim().toLowerCase()}|${name.trim().toLowerCase()}';

  /// The per-head price of [dish] as an add-on, or null when neither the dish
  /// nor its category has been priced — which the wizard shows as an extra the
  /// team will quote, and leaves out of the order total.
  num? priceFor(Product dish) =>
      dish.addOnPrice ?? _byKey[_key(dish.type, dish.category)];

  /// True when nothing at all is priced (categories still loading, or a menu
  /// the moderator hasn't priced yet).
  bool get isEmpty => _byKey.isEmpty;
}

/// Reads the live `categories` collection — the menu's filter categories and,
/// with them, the per-head rates add-ons are charged at.
///
/// A process-wide singleton over a single broadcast stream, like
/// [ProductRepository]. The documents are tiny (no images), but every screen
/// that prices an add-on wants the same table, so they share one listener and
/// new subscribers get the cached copy replayed immediately.
class MenuCategoryRepository {
  MenuCategoryRepository._();
  static final MenuCategoryRepository instance = MenuCategoryRepository._();

  /// Kept for call-site compatibility — always returns the shared singleton.
  factory MenuCategoryRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;

  StreamController<AddOnPricing>? _controller;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _source;
  AddOnPricing? _latest;

  /// The most recently loaded rate table (empty before the first load).
  AddOnPricing get latest => _latest ?? const AddOnPricing.empty();

  /// The live add-on rate table. Trashed categories are dropped: a category in
  /// the moderator's Trash no longer prices anything.
  Stream<AddOnPricing> watchPricing() {
    _controller ??= StreamController<AddOnPricing>.broadcast(
      onListen: _startSourceIfNeeded,
    );
    final stream = _controller!.stream;
    final cached = _latest;
    if (cached != null) return stream.startWith(cached);
    return stream;
  }

  void _startSourceIfNeeded() {
    if (_source != null) return;
    _source = _db.collection('categories').snapshots().listen(
      (snap) {
        final table = AddOnPricing.from(
          snap.docs
              .where((d) => (d.data()['deleted'] as Object?) != true)
              .map(MenuCategory.fromDoc),
        );
        _latest = table;
        _controller?.add(table);
      },
      onError: (Object e, StackTrace st) => _controller?.addError(e, st),
    );
  }
}

extension _StartWith<T> on Stream<T> {
  /// Emits [value] first, then the events of this stream.
  Stream<T> startWith(T value) async* {
    yield value;
    yield* this;
  }
}
