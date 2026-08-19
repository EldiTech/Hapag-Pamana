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

  /// The product `type` whose categories this package's inclusions name —
  /// the app-side mirror of the moderator's CAT_TYPE_FOR_PKG.
  String get productType => isFoodPack ? 'Food Packs' : 'Catering Food Trays';

  /// The courses this package actually buys, one per inclusion line, in the
  /// order the moderator listed them.
  ///
  /// The Content Moderator builds each inclusion out of *menu category* names
  /// joined by " or " ("Beef or Pork or Seafood"), so a line is exactly one
  /// course whose dish may come from any of the categories it names. Deriving
  /// the wizard's questions from these is what keeps the booking form asking
  /// for the food the package sells — no more (Soup on a package without one)
  /// and no less (Sandwich, which no fixed course list had).
  List<PackageCourse> get courses {
    final out = <PackageCourse>[];
    final seen = <String>{};
    for (final line in inclusions) {
      final course = PackageCourse.parse(line);
      if (course == null) continue;
      // Two identical lines would collide on one controller; keep the first.
      if (!seen.add(course.key)) continue;
      out.add(course);
    }
    return out;
  }

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

/// One question on the booking wizard, derived from a package inclusion line.
///
/// [label] is the moderator's line verbatim ("Beef or Seafood") so the form,
/// the saved booking and the admin sheets all read the same words. [categories]
/// are the menu categories a dish may be picked from.
class PackageCourse {
  const PackageCourse({
    required this.key,
    required this.label,
    required this.categories,
  });

  /// Stable Firestore field key for this course, derived from the label:
  /// "Soup or Pasta or Noodles" → "soupOrPastaOrNoodles". Deterministic, so
  /// re-opening a booking or reading it on the admin side finds the same key.
  final String key;

  /// The inclusion exactly as the moderator wrote it.
  final String label;

  /// Lowercased menu categories whose dishes satisfy this course.
  final List<String> categories;

  /// Splits an inclusion line into its alternatives. Returns null for a line
  /// that carries no letters (a stray separator), which can't name a course.
  static PackageCourse? parse(String line) {
    final text = line.trim();
    if (text.isEmpty || !RegExp('[A-Za-z]').hasMatch(text)) return null;
    final parts = text
        .split(RegExp(r'\s+or\s+', caseSensitive: false))
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    if (parts.isEmpty) return null;
    return PackageCourse(
      key: _keyFor(parts),
      label: text,
      categories: [for (final p in parts) p.toLowerCase()],
    );
  }

  /// camelCase key from the alternatives: ["Pasta", "Noodles"] → pastaOrNoodles.
  static String _keyFor(List<String> parts) {
    final words = <String>[];
    for (var i = 0; i < parts.length; i++) {
      if (i > 0) words.add('or');
      // Keep letters and digits only — category names are free text, and the
      // key has to be a legal Firestore field name.
      words.addAll(
        parts[i]
            .split(RegExp(r'[^A-Za-z0-9]+'))
            .where((w) => w.isNotEmpty)
            .map((w) => w.toLowerCase()),
      );
    }
    if (words.isEmpty) return 'course';
    final buffer = StringBuffer(words.first);
    for (final w in words.skip(1)) {
      buffer.write(w[0].toUpperCase());
      buffer.write(w.substring(1));
    }
    return buffer.toString();
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
