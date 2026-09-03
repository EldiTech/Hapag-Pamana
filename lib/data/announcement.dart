import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

/// Announcement / Event / Promo model managed by Content Moderators and displayed to
/// users across the mobile application.
@immutable
class Announcement {
  const Announcement({
    required this.id,
    required this.title,
    required this.description,
    this.imageUrl = '',
    this.category = 'announcement', // promo, event, announcement, discount
    this.eventDate = '',
    this.endDate = '',
    this.eventTime = '',
    this.location = '',
    this.status = 'published',
    this.active = true,
    this.hasDiscount = false,
    this.discountPercent,
    this.discountAmount,
    this.discountType = 'percent',
    this.discountScope = 'all',
    this.targetPackages = const [],
    this.targetCategories = const [],
    this.discountAddOns = false,
    this.promoCode,
    required this.createdAt,
    this.updatedAt,
    this.publishedAt,
    this.createdBy,
  });

  final String id;
  final String title;
  final String description;
  final String imageUrl;
  final String category;
  final String eventDate;
  final String endDate;
  final String eventTime;
  final String location;
  final String status;
  final bool active;
  final bool hasDiscount;
  final num? discountPercent;
  final num? discountAmount;
  final String discountType; // 'percent' | 'fixed'
  final String discountScope; // 'all' | 'specific' | 'packages' | 'categories'
  final List<String> targetPackages;
  final List<String> targetCategories;
  final bool discountAddOns;
  final String? promoCode;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final DateTime? publishedAt;
  final String? createdBy;

  /// True when this announcement is published and eligible for public viewing.
  bool get isPublished => status == 'published' || (status.isEmpty && active);

  /// Checks if this announcement/promo is currently within valid date range.
  bool get isCurrentlyActive {
    if (!isPublished) return false;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    if (endDate.trim().isNotEmpty) {
      final end = DateTime.tryParse(endDate.trim());
      if (end != null && today.isAfter(DateTime(end.year, end.month, end.day, 23, 59, 59))) {
        return false;
      }
    }
    if (eventDate.trim().isNotEmpty) {
      final start = DateTime.tryParse(eventDate.trim());
      if (start != null && today.isBefore(DateTime(start.year, start.month, start.day))) {
        return false;
      }
    }
    return true;
  }



  /// Label summarizing the discount e.g. "20% OFF" or "₱50 OFF".
  String get discountBadgeLabel {
    final pct = discountPercent ?? computedDiscountPercent;
    if (pct != null && pct > 0) {
      final p = pct % 1 == 0 ? pct.toInt() : pct;
      return '$p% OFF';
    }
    if (discountAmount != null && discountAmount! > 0) {
      final a = discountAmount! % 1 == 0 ? discountAmount!.toInt() : discountAmount!;
      return '₱$a OFF';
    }
    if (isPromo) return 'PROMO';
    return 'DISCOUNT';
  }

  /// Automatically extracts percentage if specified in title / text (e.g. "20% off").
  num? get computedDiscountPercent {
    if (discountPercent != null && discountPercent! > 0) return discountPercent;
    final text = '$title $description';
    final match = RegExp(r'(\d+(?:\.\d+)?)\s*%').firstMatch(text);
    if (match != null) {
      final val = num.tryParse(match.group(1)!);
      if (val != null && val > 0 && val <= 100) return val;
    }
    return null;
  }

  /// Whether this announcement offers an active promotional discount.
  bool get offersDiscount =>
      isCurrentlyActive &&
      (hasDiscount ||
          (discountPercent != null && discountPercent! > 0) ||
          (discountAmount != null && discountAmount! > 0) ||
          (computedDiscountPercent != null && computedDiscountPercent! > 0) ||
          isPromo);

  /// Check if a package matches this promo discount.
  bool appliesToPackage(String packageName) {
    if (!offersDiscount) return false;
    if (discountScope == 'categories') return false;
    if (discountScope == 'all' || targetPackages.isEmpty) return true;
    final clean = packageName.trim().toLowerCase();
    return targetPackages.any((p) {
      final target = p.trim().toLowerCase();
      return clean == target || clean.contains(target) || target.contains(clean);
    });
  }

  /// Check if a food category matches this promo discount.
  bool appliesToCategory(String categoryName) {
    if (!offersDiscount) return false;
    if (discountScope == 'packages') return false;
    if (discountScope == 'all') return true;
    if (targetCategories.isEmpty) return true;
    final clean = categoryName.trim().toLowerCase();
    return targetCategories.any((c) {
      final target = c.trim().toLowerCase();
      return clean == target || clean.contains(target) || target.contains(clean);
    });
  }

  /// Check if an event booking custom add-on dish receives this promo discount.
  bool appliesToAddOn(String categoryName, {String? packageName}) {
    if (!offersDiscount) return false;
    if (discountAddOns) {
      if (discountScope == 'all') return true;
      if (discountScope == 'packages') {
        if (packageName != null && targetPackages.isNotEmpty) {
          return appliesToPackage(packageName);
        }
        return true;
      }
      if (discountScope == 'specific' || discountScope == 'categories') {
        if (targetCategories.isEmpty) return true;
        final clean = categoryName.trim().toLowerCase();
        final inTarget = targetCategories.any((c) {
          final target = c.trim().toLowerCase();
          return clean == target || clean.contains(target) || target.contains(clean);
        });
        if (inTarget) return true;
        if (packageName != null && appliesToPackage(packageName)) return true;
        return false;
      }
      return true;
    }
    // If discountAddOns is false, add-ons only get discounted if the promo
    // specifically targets food categories.
    if (discountScope == 'categories') {
      return appliesToCategory(categoryName);
    }
    return false;
  }

  /// Calculate savings amount on a given unit/head price.
  num computeDiscount(num originalPrice) {
    if (originalPrice <= 0 || !offersDiscount) return 0;
    if (discountType == 'fixed' && discountAmount != null && discountAmount! > 0) {
      return discountAmount!.clamp(0, originalPrice);
    }
    final pct = discountPercent ?? computedDiscountPercent ?? (isPromo ? 10 : 0);
    if (pct <= 0) return 0;
    return ((originalPrice * pct) / 100).clamp(0, originalPrice);
  }

  /// True when [imageUrl] is present.
  bool get hasImage => imageUrl.trim().isNotEmpty;

  /// True when [imageUrl] is an inline base64 data URL rather than a network URL.
  bool get isDataImage => imageUrl.startsWith('data:');

  /// Decoded bytes when [imageUrl] is an inline base64 string, null otherwise.
  Uint8List? get imageBytes {
    if (!isDataImage) return null;
    final comma = imageUrl.indexOf(',');
    if (comma == -1) return null;
    try {
      return base64Decode(imageUrl.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }

  /// True if this announcement is a promotion or discount.
  bool get isPromo {
    if (hasDiscount || discountPercent != null || discountAmount != null) return true;
    final cat = category.toLowerCase();
    if (cat == 'promo' || cat == 'discount' || cat == 'offer') return true;
    final combined = '$title $description'.toLowerCase();
    return combined.contains('discount') ||
        combined.contains('promo') ||
        combined.contains('%') ||
        combined.contains('off') ||
        combined.contains('sale') ||
        combined.contains('free');
  }

  /// Category tag label for cards and detail headers.
  String get tagLabel {
    if (isPromo) return 'SPECIAL PROMO';
    if (location.isNotEmpty || eventTime.isNotEmpty) return 'EVENT BULLETIN';
    if (category.trim().isNotEmpty && category != 'announcement') {
      return category.toUpperCase();
    }
    return 'ANNOUNCEMENT';
  }

  static String _formatDateString(String dateStr) {
    final parsed = DateTime.tryParse(dateStr.trim());
    if (parsed == null) return dateStr.trim();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return '${months[parsed.month - 1]} ${parsed.day}, ${parsed.year}';
  }

  /// Display date or date range to show on cards / badges:
  /// Handles "Start Date – End Date", "Until End Date", or single dates.
  String get displayDate {
    final start = eventDate.trim();
    final end = endDate.trim();

    if (start.isNotEmpty && end.isNotEmpty && start != end) {
      final s = _formatDateString(start);
      final e = _formatDateString(end);
      return '$s – $e';
    } else if (start.isNotEmpty) {
      return _formatDateString(start);
    } else if (end.isNotEmpty) {
      return 'Until ${_formatDateString(end)}';
    }

    return formattedPublishedDate;
  }

  /// Formatted date when this announcement was published / created.
  String get formattedPublishedDate {
    final dt = publishedAt ?? createdAt;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }

  factory Announcement.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final createdTs = d['createdAt'];
    final updatedTs = d['updatedAt'];
    final pubTs = d['publishedAt'];

    List<String> parseStringList(Object? val) {
      if (val is List) {
        return val.map((e) => e.toString().trim()).where((s) => s.isNotEmpty).toList();
      }
      return const [];
    }

    num? parseNum(Object? val) {
      if (val is num) return val;
      if (val is String) return num.tryParse(val.trim());
      return null;
    }

    final parsedDiscountPercent = parseNum(d['discountPercent']) ?? parseNum(d['discountPercentage']);
    final parsedDiscountAmount = parseNum(d['discountAmount']) ?? parseNum(d['discountValue']);
    final hasDisc = d['hasDiscount'] == true ||
        (parsedDiscountPercent != null && parsedDiscountPercent > 0) ||
        (parsedDiscountAmount != null && parsedDiscountAmount > 0);

    return Announcement(
      id: doc.id,
      title: (d['title'] as String?)?.trim() ?? '',
      description: (d['description'] as String?)?.trim() ?? '',
      imageUrl: (d['imageUrl'] as String?)?.trim() ?? (d['image'] as String?)?.trim() ?? '',
      category: (d['category'] as String?)?.trim() ?? (d['type'] as String?)?.trim() ?? 'announcement',
      eventDate: (d['eventDate'] as String?)?.trim() ?? (d['startDate'] as String?)?.trim() ?? '',
      endDate: (d['endDate'] as String?)?.trim() ?? (d['validUntil'] as String?)?.trim() ?? '',
      eventTime: (d['eventTime'] as String?)?.trim() ?? '',
      location: (d['location'] as String?)?.trim() ?? '',
      status: (d['status'] as String?)?.trim().toLowerCase() ?? 'published',
      active: d['active'] != false,
      hasDiscount: hasDisc,
      discountPercent: parsedDiscountPercent,
      discountAmount: parsedDiscountAmount,
      discountType: (d['discountType'] as String?)?.trim().toLowerCase() ?? 'percent',
      discountScope: (d['discountScope'] as String?)?.trim().toLowerCase() ?? 'all',
      targetPackages: parseStringList(d['targetPackages']),
      targetCategories: parseStringList(d['targetCategories']),
      discountAddOns: d['discountAddOns'] == true || d['includeAddOns'] == true,
      promoCode: (d['promoCode'] as String?)?.trim(),
      createdAt: createdTs is Timestamp
          ? createdTs.toDate()
          : (createdTs is String ? DateTime.tryParse(createdTs) : null) ?? DateTime.now(),
      updatedAt: updatedTs is Timestamp
          ? updatedTs.toDate()
          : (updatedTs is String ? DateTime.tryParse(updatedTs) : null),
      publishedAt: pubTs is Timestamp
          ? pubTs.toDate()
          : (pubTs is String ? DateTime.tryParse(pubTs) : null),
      createdBy: d['createdBy'] as String?,
    );
  }

  Map<String, Object?> toMap() => {
        'title': title,
        'description': description,
        'imageUrl': imageUrl,
        'category': category,
        'eventDate': eventDate,
        'endDate': endDate,
        'eventTime': eventTime,
        'location': location,
        'status': status,
        'active': isPublished,
        'hasDiscount': hasDiscount,
        if (discountPercent != null) 'discountPercent': discountPercent,
        if (discountAmount != null) 'discountAmount': discountAmount,
        'discountType': discountType,
        'discountScope': discountScope,
        'targetPackages': targetPackages,
        'targetCategories': targetCategories,
        'discountAddOns': discountAddOns,
        if (promoCode != null) 'promoCode': promoCode,
        'createdAt': createdAt,
        if (updatedAt != null) 'updatedAt': updatedAt,
        if (publishedAt != null) 'publishedAt': publishedAt,
        if (createdBy != null) 'createdBy': createdBy,
      };
}
