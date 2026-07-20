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
