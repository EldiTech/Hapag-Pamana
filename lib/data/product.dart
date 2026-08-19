import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'allergens.dart';

/// A menu item published by the Content Moderator. Mirrors the `products`
/// collection documents:
/// { name, type, category, image, available, featured, allergens }.
///
/// `image` is either a remote URL (https://…) or an inline data URL
/// ("data:image/jpeg;base64,…") — the moderator compresses uploads to a data
/// URL so the photo travels inside the Firestore document. [imageBytes]
/// decodes the data-URL form; [imageUrl] returns the remote form.
class Product {
  const Product({
    required this.id,
    required this.name,
    required this.type,
    required this.category,
    required this.image,
    required this.available,
    required this.featured,
    this.allergens = const [],
    this.addOnPrice,
    this.orderCount = 0,
  });

  final String id;
  final String name;
  final String type; // "Food Packs" | "Catering Food Trays"
  final String category;
  final String image; // remote URL or data URL (may be empty)
  final bool available; // "Visible in app"
  final bool featured;

  /// Allergen keys this dish carries, from the fixed taxonomy (see
  /// [kAllergens]). Empty when the moderator hasn't tagged it yet.
  final List<String> allergens;

  /// What one head of this dish costs as a booking add-on, when the moderator
  /// has priced it apart from its category. Null — the normal case — means it
  /// charges its category's rate instead (see [MenuCategory.price]); resolve
  /// the two with [AddOnPricing.priceFor] rather than reading this directly.
  final num? addOnPrice;

  /// How many completed orders have included this dish — the popularity tally
  /// the Orders dashboard bumps when a manager completes an order (see
  /// `Admin/assets/hp-recommend.js`). 0 for a dish nobody has ordered yet, and
  /// for every dish until the first order completes after that tally shipped:
  /// there was no backfill, so this counts from then on, not from the beginning.
  final int orderCount;

  factory Product.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return Product(
      id: doc.id,
      name: (d['name'] ?? '') as String,
      type: (d['type'] ?? '') as String,
      category: (d['category'] ?? '') as String,
      image: (d['image'] ?? '') as String,
      available: d['available'] != false, // default visible when unset
      featured: d['featured'] == true,
      allergens: parseAllergens(d['allergens']),
      // Absent (the usual case) means "inherit the category's rate", so a
      // missing or malformed value must stay null rather than collapse to 0 —
      // a 0 here would advertise the dish as free.
      addOnPrice: d['addOnPrice'] is num && (d['addOnPrice'] as num) >= 0
          ? d['addOnPrice'] as num
          : null,
      orderCount: d['orderCount'] is num
          ? (d['orderCount'] as num).toInt().clamp(0, 1 << 31)
          : 0,
    );
  }

  bool get hasImage => image.isNotEmpty;

  /// True when [image] is an inline base64 data URL rather than a network URL.
  bool get isDataUrl => image.startsWith('data:');

  /// The remote image URL, or null when the image is inline / absent.
  String? get imageUrl => hasImage && !isDataUrl ? image : null;

  /// Decoded bytes for an inline data-URL image, or null otherwise.
  Uint8List? get imageBytes {
    if (!isDataUrl) return null;
    final comma = image.indexOf(',');
    if (comma == -1) return null;
    try {
      return base64Decode(image.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }
}
