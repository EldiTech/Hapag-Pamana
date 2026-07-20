import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/widgets/app_widgets.dart';
import '../data/product.dart';
import '../widgets.dart';
import 'detail_sheets.dart';

/// Shared editorial sections for the home screens.
///
/// Both the guest [HomePage] and the signed-in member home lay out the same
/// run of sections — a Featured carousel, an Explore category strip, a "From
/// the Kitchen" run and a closing catering invitation — so they live here once
/// and are composed by each page. Only the page headers differ (guest brand +
/// Log In vs. the member's personalised greeting).

/// One representative ("best selling") dish per category, sorted by category
/// name. With no sales field in the schema, the representative is the
/// category's featured item, falling back to the first encountered (the source
/// list is already alphabetised by the repository).
List<(String, Product)> bestByCategory(List<Product> all) {
  final best = <String, Product>{};
  for (final p in all) {
    if (p.category.isEmpty) continue;
    final current = best[p.category];
    if (current == null || (p.featured && !current.featured)) {
      best[p.category] = p;
    }
  }
  return best.entries.map((e) => (e.key, e.value)).toList()
    ..sort((a, b) => a.$1.toLowerCase().compareTo(b.$1.toLowerCase()));
}

// ════════════════════════════ Featured ════════════════════════════
/// Cadence for the Featured carousel — a brisk 1s auto-advance that slides
/// smoothly and loops forever, pausing only while the guest is touching it.
const Duration _kFeaturedAutoAdvance = Duration(seconds: 1);

/// Run of the featured dishes. A single featured item (or the loading / empty
/// state) fills the screen width; with several featured, the cards auto-advance
/// in an infinite, self-pacing carousel (peeking the neighbours so the strip
/// reads as scrollable), pausing whenever the user takes hold of it.
class FeaturedCarousel extends StatelessWidget {
  const FeaturedCarousel({
    super.key,
    required this.products,
    required this.loading,
    required this.onTap,
  });

  final List<Product> products;
  final bool loading;
  final VoidCallback onTap;

  static const double _height = 296;

  @override
  Widget build(BuildContext context) {
    // Loading or nothing featured yet: a single full-width card (skeleton /
    // placeholder) that still falls back to opening the menu when tapped.
    if (loading || products.isEmpty) {
      return _single(
        child: _FeatureCard(product: null, loading: loading, onTap: onTap),
      );
    }

    // Exactly one featured dish: a single full-width card, no auto-advance.
    if (products.length == 1) {
      final product = products.first;
      return _single(
        child: _FeatureCard(
          product: product,
          loading: false,
          onTap: () => showProductSheet(context, product),
        ),
      );
    }

    // Several: an auto-advancing, infinitely-looping carousel.
    return AutoCarousel(
      height: _height,
      itemCount: products.length,
      viewportFraction: 0.9,
      interval: _kFeaturedAutoAdvance,
      itemBuilder: (context, i) {
        final product = products[i];
        return _FeatureCard(
          product: product,
          loading: false,
          onTap: () => showProductSheet(context, product),
        );
      },
    );
  }

  /// Wraps a lone card in the screen-edge inset the carousel gets for free.
  Widget _single({required Widget child}) {
    return SizedBox(
      height: _height,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        child: child,
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({
    required this.product,
    required this.loading,
    required this.onTap,
  });

  final Product? product;
  final bool loading;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      radius: AppRadius.xl,
      padding: EdgeInsets.zero,
      clip: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Flexes to fill whatever height the carousel allots the card.
          Expanded(
            child: SizedBox(
              width: double.infinity,
              child: loading
                  ? const PlaceholderBox(radius: 0, showIcon: false)
                  : product == null
                  ? const PlaceholderBox(
                      radius: 0,
                      icon: Icons.local_dining_outlined,
                    )
                  : ProductImage(product!),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, AppSpacing.lg, 18, 18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (loading)
                  const SkeletonLine(width: 180, height: 16)
                else
                  Text(
                    product?.name ?? 'A new favourite, soon',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.heading,
                  ),
                const SizedBox(height: 6),
                if (loading)
                  const SkeletonLine(width: 110, height: 11)
                else
                  Text(
                    product?.category ?? 'Freshly added to the menu',
                    style: AppTextStyles.bodySmall,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════ Explore (categories) ════════════════════════════
/// A horizontal run of categories, each tile fronted by that category's best
/// seller. Tapping a tile opens the Menu tab.
class CategoryStrip extends StatelessWidget {
  const CategoryStrip({
    super.key,
    required this.loading,
    required this.categories,
    required this.onTap,
  });

  final bool loading;
  final List<(String, Product)> categories;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return SizedBox(
        height: 196,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
          itemCount: 4,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, i) => FadeSlideIn(
            delay: Duration(milliseconds: 60 * i),
            child: const _DishCard.skeleton(),
          ),
        ),
      );
    }

    return SizedBox(
      height: 196,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        itemCount: categories.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (_, i) {
          final (category, best) = categories[i];
          return _CategoryTile(category: category, best: best, onTap: onTap);
        },
      ),
    );
  }
}

class _CategoryTile extends StatelessWidget {
  const _CategoryTile({
    required this.category,
    required this.best,
    required this.onTap,
  });

  final String category;
  final Product best;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      width: 158,
      padding: const EdgeInsets.all(AppSpacing.sm + 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: AppRadius.smAll,
              child: ProductImage(best),
            ),
          ),
          const SizedBox(height: 11),
          Text(
            category.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.engraved(
              size: 9,
              color: AppColors.goldDeep,
              spacing: 1.2,
            ),
          ),
          const SizedBox(height: 5),
          // The category's best seller (featured / representative pick).
          Row(
            children: [
              const Icon(
                Icons.local_fire_department_outlined,
                size: 13,
                color: AppColors.brownSoft,
              ),
              const SizedBox(width: 5),
              Expanded(
                child: Text(
                  best.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.serif(size: 13, height: 1.2),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════ From the Kitchen ════════════════════════════
class KitchenStrip extends StatelessWidget {
  const KitchenStrip({
    super.key,
    required this.loading,
    required this.error,
    required this.picks,
    required this.onBrowse,
  });

  final bool loading;
  final bool error;
  final List<Product> picks;
  final VoidCallback onBrowse;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return SizedBox(
        height: 196,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
          itemCount: 4,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, i) => FadeSlideIn(
            delay: Duration(milliseconds: 60 * i),
            child: const _DishCard.skeleton(),
          ),
        ),
      );
    }

    if (error || picks.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        child: _QuietNote(
          icon: error ? Icons.cloud_off_outlined : Icons.restaurant_outlined,
          text: error
              ? 'Couldn\'t reach the kitchen. Pull up the menu to retry.'
              : 'Fresh dishes are on their way to the menu.',
          onBrowse: onBrowse,
        ),
      );
    }

    return SizedBox(
      height: 196,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        itemCount: picks.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, i) =>
            _DishCard(picks[i], onTap: () => showProductSheet(context, picks[i])),
      ),
    );
  }
}

class _DishCard extends StatelessWidget {
  const _DishCard(this.product, {this.onTap}) : skeleton = false;
  const _DishCard.skeleton() : product = null, skeleton = true, onTap = null;

  final Product? product;
  final bool skeleton;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      width: 150,
      padding: const EdgeInsets.all(AppSpacing.sm + 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: AppRadius.smAll,
              child: skeleton
                  ? const PlaceholderBox(radius: AppRadius.sm)
                  : ProductImage(product!),
            ),
          ),
          const SizedBox(height: 11),
          if (skeleton)
            const SkeletonLine(height: 12)
          else
            Text(
              product!.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.serif(size: 14, height: 1.2),
            ),
          const SizedBox(height: 6),
          if (skeleton)
            const SkeletonLine(width: 70, height: 10)
          else
            Text(
              product!.category,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.engraved(
                size: 9,
                color: AppColors.goldDeep,
                spacing: 1.2,
              ),
            ),
        ],
      ),
    );
  }
}

class _QuietNote extends StatelessWidget {
  const _QuietNote({
    required this.icon,
    required this.text,
    required this.onBrowse,
  });

  final IconData icon;
  final String text;
  final VoidCallback onBrowse;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.xxl - 2),
      child: Column(
        children: [
          Icon(icon, size: 32, color: AppColors.brown.withValues(alpha: 0.3)),
          const SizedBox(height: AppSpacing.md),
          Text(
            text,
            textAlign: TextAlign.center,
            style: AppTextStyles.body,
          ),
          const SizedBox(height: 14),
          AppButton.secondary(label: 'OPEN THE MENU', onPressed: onBrowse),
        ],
      ),
    );
  }
}

// ════════════════════════════ Catering invite ════════════════════════════
class CateringInvite extends StatelessWidget {
  const CateringInvite({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      radius: AppRadius.xl,
      padding: const EdgeInsets.all(AppSpacing.xxl - 2),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [AppColors.brown, AppColors.olive],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'HOSTING SOMETHING SPECIAL?',
                  style: AppTextStyles.engraved(
                    size: 10,
                    color: AppColors.gold,
                    spacing: 2,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm + 2),
                Text(
                  'Let us cater\nyour celebration.',
                  style: AppTextStyles.serif(
                    size: 21,
                    color: AppColors.cream,
                    height: 1.15,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Text(
                      'Make an inquiry',
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w600,
                        color: AppColors.gold,
                        spacing: 0.5,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Icon(
                      Icons.arrow_forward,
                      size: 16,
                      color: AppColors.gold,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppColors.cream.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.room_service_outlined,
              color: AppColors.cream,
              size: 26,
            ),
          ),
        ],
      ),
    );
  }
}
