import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/widgets/app_widgets.dart';
import '../data/product.dart';
import '../data/recommendation.dart';
import '../data/recommendation_repository.dart';
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
/// name. The representative is the category's most-ordered dish, falling back to
/// its featured one and then to the first encountered (the source list is
/// already alphabetised by the repository) — so a category whose tally is still
/// empty behaves exactly as it did before [Product.orderCount] existed.
List<(String, Product)> bestByCategory(List<Product> all) {
  final best = <String, Product>{};
  for (final p in all) {
    if (p.category.isEmpty) continue;
    final current = best[p.category];
    if (current == null ||
        p.orderCount > current.orderCount ||
        (p.orderCount == current.orderCount &&
            p.featured &&
            !current.featured)) {
      best[p.category] = p;
    }
  }
  return best.entries.map((e) => (e.key, e.value)).toList()
    ..sort((a, b) => a.$1.toLowerCase().compareTo(b.$1.toLowerCase()));
}

/// The dishes the most orders have actually included — the popularity tally the
/// Orders dashboard keeps (see [Product.orderCount]).
///
/// Empty until at least [minOrders] orders have been counted for something: a
/// "Most loved" strip topped by a dish ordered once is a claim the data doesn't
/// support, and it's better to show nothing than to invent a favourite.
List<Product> mostLoved(List<Product> all, {int take = 6, int minOrders = 2}) {
  final ranked =
      [
        for (final p in all)
          if (p.available && p.orderCount >= minOrders) p,
      ]..sort((a, b) {
        final byCount = b.orderCount.compareTo(a.orderCount);
        if (byCount != 0) return byCount;
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });
  return ranked.take(take).toList();
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
    // Every state stands the same height, so the run never has to resize —
    // the skeleton simply settles into the real cards through [SmoothSwap]
    // rather than being replaced between one frame and the next.
    return SizedBox(
      height: _height,
      child: SmoothSwap(alignment: Alignment.center, child: _state(context)),
    );
  }

  Widget _state(BuildContext context) {
    // Loading or nothing featured yet: a single full-width card (skeleton /
    // placeholder) that still falls back to opening the menu when tapped.
    if (loading || products.isEmpty) {
      return _single(
        key: ValueKey(loading ? 'featured-loading' : 'featured-empty'),
        child: _FeatureCard(product: null, loading: loading, onTap: onTap),
      );
    }

    // Exactly one featured dish: a single full-width card, no auto-advance.
    if (products.length == 1) {
      final product = products.first;
      return _single(
        key: const ValueKey('featured-one'),
        child: _FeatureCard(
          product: product,
          loading: false,
          onTap: () => showProductSheet(context, product),
        ),
      );
    }

    // Several: an auto-advancing, infinitely-looping carousel.
    return AutoCarousel(
      key: const ValueKey('featured-carousel'),
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
  Widget _single({required Key key, required Widget child}) {
    return Padding(
      key: key,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
      child: child,
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
    // Skeleton and real row are the same height, so the strip cross-fades in
    // place instead of the placeholders vanishing under the tiles.
    return SizedBox(
      height: 196,
      child: SmoothSwap(
        alignment: Alignment.center,
        child: loading
            ? ListView.separated(
                key: const ValueKey('categories-loading'),
                scrollDirection: Axis.horizontal,
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
                itemCount: 4,
                separatorBuilder: (_, _) => const SizedBox(width: 14),
                itemBuilder: (_, i) => FadeSlideIn(
                  delay: Duration(milliseconds: 60 * i),
                  child: const _DishCard.skeleton(),
                ),
              )
            : ListView.separated(
                key: const ValueKey('categories'),
                scrollDirection: Axis.horizontal,
                padding:
                    const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
                itemCount: categories.length,
                separatorBuilder: (_, _) => const SizedBox(width: 14),
                itemBuilder: (_, i) {
                  final (category, best) = categories[i];
                  return _CategoryTile(
                    category: category,
                    best: best,
                    onTap: onTap,
                  );
                },
              ),
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
    // The quiet note is shorter than a row of cards, so this swap tweens its
    // height too — everything below it slides rather than jumps.
    return SmoothSwap(resize: true, child: _state(context));
  }

  Widget _state(BuildContext context) {
    if (loading) {
      return SizedBox(
        key: const ValueKey('kitchen-loading'),
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
        key: ValueKey(error ? 'kitchen-error' : 'kitchen-empty'),
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
      key: const ValueKey('kitchen'),
      height: 196,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        itemCount: picks.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, i) => _DishCard(
          picks[i],
          onTap: () => showProductSheet(context, picks[i]),
        ),
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
          Text(text, textAlign: TextAlign.center, style: AppTextStyles.body),
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

// ════════════════════════════ For You ════════════════════════════
/// The member's recommendation strip — the front end of the collaborative
/// filtering engine, shown on the member home and again inside Gabay.
///
/// Member-only (a guest has no history and no profile to compute one from), but
/// it lives here beside the other strips because Gabay draws the same cards and
/// the two must not drift apart.
///
/// A recommendation is only worth as much as its provenance, so the strip always
/// says where its picks came from — see [RecommendationSource.label]. The
/// repository already guarantees a non-empty list where it can (featured dishes
/// stand in when nothing else resolves), so the empty state here is the genuine
/// one: a kitchen with nothing published at all.
class ForYouStrip extends StatelessWidget {
  const ForYouStrip({
    super.key,
    required this.loading,
    required this.set,
    required this.onOpenPackages,
  });

  final bool loading;
  final RecommendationSet set;

  /// Opens the Packages tab — where a recommended *package* is booked from.
  /// Dishes open their own quick-look sheet instead.
  final VoidCallback onOpenPackages;

  @override
  Widget build(BuildContext context) {
    // A one-row strip, a two-group column and the empty state are all
    // different heights, so this swap tweens the height as well as the fade.
    return SmoothSwap(resize: true, child: _state(context));
  }

  Widget _state(BuildContext context) {
    if (loading) {
      return SizedBox(
        key: const ValueKey('for-you-loading'),
        height: 196,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
          itemCount: 3,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, i) => FadeSlideIn(
            delay: Duration(milliseconds: 60 * i),
            child: const RecommendedCard.skeleton(),
          ),
        ),
      );
    }

    if (set.isEmpty) {
      return const SizedBox.shrink(key: ValueKey('for-you-empty'));
    }

    final packages = set.items.where((i) => i.isPackage).toList();
    final dishes = set.items.where((i) => !i.isPackage).toList();

    // Only worth a sub-heading once there's an actual split to explain — a
    // strip that's all dishes (or all packages) stays the single row it was.
    if (packages.isEmpty || dishes.isEmpty) {
      return _ForYouRow(
        key: const ValueKey('for-you-single'),
        items: set.items,
        onOpenPackages: onOpenPackages,
      );
    }

    return Column(
      key: const ValueKey('for-you-grouped'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _ForYouGroupLabel('RECOMMENDED PACKAGES'),
        const SizedBox(height: 10),
        _ForYouRow(items: packages, onOpenPackages: onOpenPackages),
        const SizedBox(height: AppSpacing.md),
        _ForYouGroupLabel('RECOMMENDED MENU'),
        const SizedBox(height: 10),
        _ForYouRow(items: dishes, onOpenPackages: onOpenPackages),
      ],
    );
  }
}

class _ForYouGroupLabel extends StatelessWidget {
  const _ForYouGroupLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
      child: Text(
        text,
        style: AppTextStyles.engraved(size: 10, color: AppColors.goldDeep),
      ),
    );
  }
}

class _ForYouRow extends StatelessWidget {
  const _ForYouRow({
    super.key,
    required this.items,
    required this.onOpenPackages,
  });

  final List<RecommendedItem> items;
  final VoidCallback onOpenPackages;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 196,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 14),
        itemBuilder: (context, i) {
          final item = items[i];
          return RecommendedCard(
            item,
            onTap: () => item.isPackage
                ? onOpenPackages()
                : showProductSheet(context, item.product!),
          );
        },
      ),
    );
  }
}

/// One recommended item — the [_DishCard] shape, but able to carry a package as
/// well as a dish, and sealed as a package when it is one, since the two are
/// booked from different places.
///
/// Public because Gabay's own panel draws the same card: the home strip and the
/// assistant must show one member the same picks in the same shape, or the
/// "why was this recommended?" answer stops matching what they're looking at.
class RecommendedCard extends StatelessWidget {
  const RecommendedCard(this.item, {super.key, this.onTap}) : skeleton = false;
  const RecommendedCard.skeleton({super.key})
    : item = null,
      skeleton = true,
      onTap = null;

  final RecommendedItem? item;
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
                  : Stack(
                      fit: StackFit.expand,
                      children: [
                        item!.isPackage
                            ? PackageImage(item!.package!)
                            : ProductImage(item!.product!),
                        // A package and a dish are booked in different places,
                        // so the card says which it is before it's tapped.
                        if (item!.isPackage)
                          const Positioned(
                            top: 6,
                            left: 6,
                            child: _PackageSeal(),
                          ),
                      ],
                    ),
            ),
          ),
          const SizedBox(height: 11),
          if (skeleton)
            const SkeletonLine(height: 12)
          else
            Text(
              item!.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.serif(size: 14, height: 1.2),
            ),
          const SizedBox(height: 6),
          if (skeleton)
            const SkeletonLine(width: 70, height: 10)
          else
            Text(
              item!.subtitle,
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

/// The small "PACKAGE" seal on a recommended package's photo.
class _PackageSeal extends StatelessWidget {
  const _PackageSeal();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.brown.withValues(alpha: 0.86),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.55)),
      ),
      child: Text(
        'PACKAGE',
        style: AppTextStyles.engraved(
          size: 7.5,
          color: AppColors.gold,
          spacing: 1.2,
        ),
      ),
    );
  }
}

/// The provenance badge that rides beside the "For You" heading — "From orders
/// like yours", "Based on your taste profile", "Featured by the kitchen".
class RecommendationSourceBadge extends StatelessWidget {
  const RecommendationSourceBadge(this.source, {super.key});

  final RecommendationSource source;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(
        color: AppColors.gold.withValues(alpha: 0.14),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.auto_awesome, size: 11, color: AppColors.goldDeep),
          const SizedBox(width: 5),
          Text(
            source.label,
            style: AppTextStyles.sans(
              size: 10,
              weight: FontWeight.w600,
              color: AppColors.goldDeep,
              spacing: 0.3,
            ),
          ),
        ],
      ),
    );
  }
}
