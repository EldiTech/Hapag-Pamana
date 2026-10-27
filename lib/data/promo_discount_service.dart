import 'dart:async';

import 'package:flutter/foundation.dart';

import 'announcement.dart';
import 'announcement_repository.dart';
import 'catering.dart';
import 'product.dart';

/// Resolved promo discount information for a package.
@immutable
class PackageDiscountInfo {
  const PackageDiscountInfo({
    required this.promo,
    required this.originalPrice,
    required this.discountedPrice,
    required this.discountSavings,
    required this.badgeLabel,
  });

  final Announcement promo;
  final num originalPrice;
  final num discountedPrice;
  final num discountSavings;
  final String badgeLabel;
}

/// Resolved promo discount information for a category or dish add-on.
@immutable
class CategoryDiscountInfo {
  const CategoryDiscountInfo({
    required this.promo,
    required this.categoryName,
    required this.originalPrice,
    required this.discountedPrice,
    required this.discountSavings,
    required this.badgeLabel,
  });

  final Announcement promo;
  final String categoryName;
  final num originalPrice;
  final num discountedPrice;
  final num discountSavings;
  final String badgeLabel;
}

/// Central service that matches live published promos to packages and food categories.
class PromoDiscountService extends ChangeNotifier {
  PromoDiscountService._() {
    _init();
  }

  static final PromoDiscountService instance = PromoDiscountService._();
  factory PromoDiscountService() => instance;

  final AnnouncementRepository _announcements = AnnouncementRepository.instance;
  StreamSubscription<List<Announcement>>? _sub;
  List<Announcement> _activePromos = const [];

  void _init() {
    _sub = _announcements.watchPublished().listen((list) {
      _activePromos = list.where((a) => a.offersDiscount).toList();
      notifyListeners();
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  /// All currently active published announcements that offer a discount.
  List<Announcement> get activePromos => _activePromos;

  /// Check and calculate discount on a package (e.g. "Hapag Kabataan").
  PackageDiscountInfo? getPackageDiscount(String packageName, num originalPrice) {
    if (originalPrice <= 0 || _activePromos.isEmpty) return null;

    Announcement? bestPromo;
    num bestSavings = 0;

    for (final promo in _activePromos) {
      if (promo.appliesToPackage(packageName)) {
        final savings = promo.computeDiscount(originalPrice);
        if (savings > bestSavings) {
          bestSavings = savings;
          bestPromo = promo;
        }
      }
    }

    if (bestPromo == null || bestSavings <= 0) return null;

    return PackageDiscountInfo(
      promo: bestPromo,
      originalPrice: originalPrice,
      discountedPrice: (originalPrice - bestSavings).clamp(0, originalPrice),
      discountSavings: bestSavings,
      badgeLabel: bestPromo.discountBadgeLabel,
    );
  }

  /// Check and calculate discount on a food category (e.g. "Seafood", "Beef").
  CategoryDiscountInfo? getCategoryDiscount(String categoryName, num originalPrice) {
    if (originalPrice <= 0 || _activePromos.isEmpty) return null;

    Announcement? bestPromo;
    num bestSavings = 0;

    for (final promo in _activePromos) {
      if (promo.appliesToCategory(categoryName)) {
        final savings = promo.computeDiscount(originalPrice);
        if (savings > bestSavings) {
          bestSavings = savings;
          bestPromo = promo;
        }
      }
    }

    if (bestPromo == null || bestSavings <= 0) return null;

    return CategoryDiscountInfo(
      promo: bestPromo,
      categoryName: categoryName,
      originalPrice: originalPrice,
      discountedPrice: (originalPrice - bestSavings).clamp(0, originalPrice),
      discountSavings: bestSavings,
      badgeLabel: bestPromo.discountBadgeLabel,
    );
  }

  /// Check discount for a dish given its category and base rate.
  CategoryDiscountInfo? getDishDiscount(Product dish, num originalPrice) {
    return getCategoryDiscount(dish.category, originalPrice);
  }

  /// Check and calculate discount for a custom dish add-on in event booking.
  CategoryDiscountInfo? getAddOnDiscount(Product dish, num originalPrice, {String? packageName}) {
    if (originalPrice <= 0 || _activePromos.isEmpty) return null;

    Announcement? bestPromo;
    num bestSavings = 0;

    for (final promo in _activePromos) {
      if (promo.appliesToAddOn(dish.category, packageName: packageName)) {
        final savings = promo.computeDiscount(originalPrice);
        if (savings > bestSavings) {
          bestSavings = savings;
          bestPromo = promo;
        }
      }
    }

    if (bestPromo == null || bestSavings <= 0) return null;

    return CategoryDiscountInfo(
      promo: bestPromo,
      categoryName: dish.category,
      originalPrice: originalPrice,
      discountedPrice: (originalPrice - bestSavings).clamp(0, originalPrice),
      discountSavings: bestSavings,
      badgeLabel: bestPromo.discountBadgeLabel,
    );
  }

  /// Helper for [CateringPackage].
  PackageDiscountInfo? discountForCateringPackage(CateringPackage package) {
    return getPackageDiscount(package.name, package.price);
  }
}
