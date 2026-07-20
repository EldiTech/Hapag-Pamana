import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

/// The two package families the app's Packages screen is divided into. A
/// package belongs to exactly one; the value is stored verbatim in its `type`
/// field (the Content Moderator's package form offers the same two). Legacy
/// documents without a type count as catering.
const String kPackageTypeCatering = 'Catering Package';
const String kPackageTypeFoodPack = 'Food Pack Package';

/// A service package the Content Moderator publishes to the `packages`
/// collection: { name, type, price, minPax, desc, inclusions, active }.
///
/// `price` is per head in the app's currency. `desc` is the newline-separated
/// list of *standard* services every package carries; `inclusions` are the
/// items specific to this package (e.g. its menu). Only packages flagged
/// `active` are shown in the app.
class CateringPackage {
  const CateringPackage({
    required this.id,
    required this.name,
    required this.type,
    required this.image,
    required this.price,
    required this.minPax,
    required this.inclusions,
    required this.standardServices,
    required this.active,
  });

  final String id;
  final String name;
  final String type; // kPackageTypeCatering | kPackageTypeFoodPack
  final String image; // remote URL or inline data URL (may be empty)
  final num price;
  final int minPax;
  final List<String> inclusions;
  final List<String> standardServices;
  final bool active;

  bool get isFoodPack => type == kPackageTypeFoodPack;

  /// True for the institutional-service package ("Hapag Serbisyo"), which the
  /// business offers strictly for church, government and school functions.
  /// Matched by name because the moderator's package schema has no
  /// eligibility field.
  bool get isInstitutional => name.toLowerCase().contains('serbisyo');

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

  factory CateringPackage.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    List<String> lines(Object? v) => v is List
        ? v.map((e) => e.toString().trim()).where((s) => s.isNotEmpty).toList()
        : const [];
    final desc = (d['desc'] ?? '') as String;
    return CateringPackage(
      id: doc.id,
      name: (d['name'] ?? '') as String,
      type: (d['type'] ?? '').toString().trim() == kPackageTypeFoodPack
          ? kPackageTypeFoodPack
          : kPackageTypeCatering,
      image: (d['image'] ?? '') as String,
      price: d['price'] is num ? d['price'] as num : 0,
      minPax: d['minPax'] is num ? (d['minPax'] as num).toInt() : 0,
      inclusions: lines(d['inclusions']),
      standardServices: lines(desc.split('\n')),
      active: d['active'] != false, // default visible when unset
    );
  }
}

/// An event setup photo the moderator publishes to the `setups` collection:
/// { title, image, visible, createdAt }. `image` is a remote URL or an inline
/// base64 data URL (the moderator compresses uploads). Only `visible` setups
/// are shown in the app.
class EventSetup {
  const EventSetup({
    required this.id,
    required this.title,
    required this.image,
    required this.visible,
    required this.createdAt,
  });

  final String id;
  final String title;
  final String image;
  final bool visible;
  final int createdAt;

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

  factory EventSetup.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    return EventSetup(
      id: doc.id,
      title: (d['title'] ?? '') as String,
      image: (d['image'] ?? '') as String,
      visible: d['visible'] != false,
      createdAt: d['createdAt'] is num ? (d['createdAt'] as num).toInt() : 0,
    );
  }
}
