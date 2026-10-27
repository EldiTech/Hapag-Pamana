import 'dart:async';

import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/widgets/app_widgets.dart';
import '../data/allergens.dart';
import '../data/product.dart';
import '../data/product_repository.dart';
import '../data/promo_discount_service.dart';
import '../widgets.dart';
import 'detail_sheets.dart';

/// Menu screen — live products from Firestore. A type tab bar (Food Packs /
/// Catering Food Trays), per-type category chips, a search box and a grid of
/// dish cards. Mirrors what the Content Moderator publishes; only products
/// marked "Visible in app" are shown.
class MenuPage extends StatefulWidget {
  const MenuPage({super.key});

  @override
  State<MenuPage> createState() => _MenuPageState();
}

class _MenuPageState extends State<MenuPage> {
  // The two product types, in the same order the moderator uses.
  static const List<String> _types = ['Food Packs', 'Catering Food Trays'];

  final ProductRepository _repo = ProductRepository();
  StreamSubscription<List<Product>>? _sub;

  List<Product> _all = const [];
  bool _loading = true;
  bool _error = false;

  String _type = _types.first;
  String? _category; // null ⇒ "All"
  String _search = '';

  @override
  void initState() {
    super.initState();
    _sub = _repo.watchVisible().listen(
      (products) {
        if (mounted) {
          setState(() {
            _all = products;
            _loading = false;
            _error = false;
          });
        }
      },
      onError: (_) {
        if (mounted) {
          setState(() {
            _loading = false;
            _error = true;
          });
        }
      },
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final loading = _loading;
    final error = _error;
    final all = _all;

    // Products for the active type — drives the category chips.
    final ofType = all.where((p) => p.type == _type).toList();
    final categories = <String>{for (final p in ofType) p.category}.toList()
      ..sort();

    // Apply category + search filters for the grid. Featured dishes lead the
    // grid so their tag actually earns them a spot up front; each group stays
    // alphabetical underneath.
    final term = _search.trim().toLowerCase();
    final shown = ofType.where((p) {
      if (_category != null && p.category != _category) return false;
      if (term.isNotEmpty && !p.name.toLowerCase().contains(term)) {
        return false;
      }
      return true;
    }).toList()
      ..sort((a, b) {
        if (a.featured != b.featured) return a.featured ? -1 : 1;
        return a.name.toLowerCase().compareTo(b.name.toLowerCase());
      });

    // Allergen heatmap over the dishes currently in view — hidden until at
    // least one of them carries allergen data.
    final allergenStats = aggregateAllergens(shown);
    final showAllergens =
        !loading && !error && shown.isNotEmpty && hasAnyAllergenData(allergenStats);

    return CustomScrollView(
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.lg,
            AppSpacing.screen,
            AppSpacing.md,
          ),
          sliver: SliverList.list(
            children: [
              FadeSlideIn(
                child: AppTextField(
                  hint: 'Search dishes',
                  prefixIcon: Icons.search,
                  onChanged: (v) => setState(() => _search = v),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              FadeSlideIn(
                delay: const Duration(milliseconds: 100),
                child: _TypeTabs(
                  types: _types,
                  active: _type,
                  countFor: (t) => all.where((p) => p.type == t).length,
                  onSelect: (t) => setState(() {
                    _type = t;
                    _category = null;
                  }),
                ),
              ),
              const SizedBox(height: 14),
              SmoothSwap(
                resize: true,
                child: loading
                    ? const SizedBox(
                        key: ValueKey('chips-loading'),
                        height: 36,
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: PillPlaceholder(width: 140),
                        ),
                      )
                    : categories.isEmpty
                        ? const SizedBox.shrink(key: ValueKey('chips-none'))
                        : SingleChildScrollView(
                            key: const ValueKey('filter-row'),
                            scrollDirection: Axis.horizontal,
                            clipBehavior: Clip.none,
                            child: Row(
                              children: [
                                _CategoryFilterButton(
                                  categories: categories,
                                  active: _category,
                                  totalCount: ofType.length,
                                  countFor: (c) => ofType.where((p) => p.category == c).length,
                                  onSelect: (c) => setState(() => _category = c),
                                ),
                                if (showAllergens) ...[
                                  const SizedBox(width: 8),
                                  _AllergenButton(
                                    stats: allergenStats,
                                    count: shown.length,
                                  ),
                                ],
                              ],
                            ),
                          ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
          ),
        ),

        // ── Body: skeletons → error → empty → grid ──
        if (loading)
          _gridSliver(
            childCount: 8,
            builder: (i) => FadeSlideIn(
              delay: Duration(milliseconds: 180 + i * 60),
              child: const _MenuCardSkeleton(),
            ),
          )
        else if (error)
          const SliverFillRemaining(
            hasScrollBody: false,
            child: _MenuMessage(
              icon: Icons.cloud_off_outlined,
              title: 'Couldn\'t load the menu',
              body: 'Check your connection and try again.',
            ),
          )
        else if (shown.isEmpty)
          SliverFillRemaining(
            hasScrollBody: false,
            child: _MenuMessage(
              icon: Icons.restaurant_outlined,
              title: term.isNotEmpty || _category != null
                  ? 'No dishes match'
                  : 'No dishes yet',
              body: term.isNotEmpty || _category != null
                  ? 'Try a different search or category.'
                  : 'New dishes will appear here once published.',
            ),
          )
        else
          _gridSliver(
            childCount: shown.length,
            // Cards settle in with a gentle staggered fade + rise as the grid
            // appears; the delay is capped so a long menu never feels slow.
            // Keyed by dish: changing the search or the category rebuilds the
            // grid with different children, and the key is what makes those
            // fade + rise into place instead of swapping contents in a frame.
            builder: (i) => FadeSlideIn(
              key: ValueKey(shown[i].id),
              delay: Duration(milliseconds: 40 * (i % 8)),
              child: _MenuItemCard(
                shown[i],
                onTap: () => showProductSheet(context, shown[i]),
              ),
            ),
          ),
      ],
    );
  }

  SliverPadding _gridSliver({
    required int childCount,
    required Widget Function(int) builder,
  }) {
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        0,
        AppSpacing.screen,
        AppSpacing.section,
      ),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: AppSpacing.md,
          mainAxisSpacing: AppSpacing.md,
          // Equal cells; the card reserves a constant two-line title block so
          // every photo lands at the same height and the gallery aligns.
          childAspectRatio: 0.70,
        ),
        delegate: SliverChildBuilderDelegate(
          (_, i) => builder(i),
          childCount: childCount,
        ),
      ),
    );
  }
}

// ─────────────────────────── Type tabs ───────────────────────────
class _TypeTabs extends StatelessWidget {
  const _TypeTabs({
    required this.types,
    required this.active,
    required this.countFor,
    required this.onSelect,
  });

  final List<String> types;
  final String active;
  final int Function(String) countFor;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xs),
      radius: AppRadius.md,
      child: Row(
        children: [
          for (var i = 0; i < types.length; i++) ...[
            // Breathing room between the two segments so the active brown pill
            // never butts up against its neighbour.
            if (i > 0) const SizedBox(width: AppSpacing.xs),
            Expanded(
              child: _TypeSegment(
                label: types[i],
                count: countFor(types[i]),
                selected: types[i] == active,
                onTap: () => onSelect(types[i]),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One segment of the type control. The count sits *under* the label rather
/// than beside it, so a long label like "Catering Food Trays" gets the segment's
/// full width and never feels crammed against the number.
class _TypeSegment extends StatelessWidget {
  const _TypeSegment({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedContainer(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.brown : Colors.transparent,
          borderRadius: AppRadius.xsAll,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                color: selected ? AppColors.cream : AppColors.brownSoft,
                spacing: 0.2,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              '$count item${count == 1 ? '' : 's'}',
              style: AppTextStyles.sans(
                size: 10,
                weight: FontWeight.w600,
                color: selected
                    ? AppColors.gold
                    : AppColors.brownSoft.withValues(alpha: 0.7),
                spacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────── Category modal picker ───────────────────────────
class _CategoryFilterButton extends StatelessWidget {
  const _CategoryFilterButton({
    required this.categories,
    required this.active,
    required this.countFor,
    required this.totalCount,
    required this.onSelect,
  });

  final List<String> categories;
  final String? active; // null ⇒ All
  final int Function(String) countFor;
  final int totalCount;
  final ValueChanged<String?> onSelect;

  void _openModal(BuildContext context) {
    showCenterDialog<void>(
      context: context,
      builder: (dialogContext) {
        final allOptions = <Widget>[
          _CategoryModalOption(
            label: 'All Categories',
            count: totalCount,
            selected: active == null,
            onTap: () {
              Navigator.of(dialogContext).pop();
              onSelect(null);
            },
          ),
          for (final cat in categories)
            _CategoryModalOption(
              label: cat,
              count: countFor(cat),
              selected: active == cat,
              onTap: () {
                Navigator.of(dialogContext).pop();
                onSelect(cat);
              },
            ),
        ];

        return AppDialogShell(
          children: [
            Text('MENU FILTER', style: AppTextStyles.eyebrow),
            const SizedBox(height: AppSpacing.xs),
            Text('Select Category', style: AppTextStyles.title),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Filter dishes by their category.',
              style: AppTextStyles.bodySmall,
            ),
            const SizedBox(height: AppSpacing.lg),
            for (var i = 0; i < allOptions.length; i += 2) ...[
              Row(
                children: [
                  Expanded(child: allOptions[i]),
                  const SizedBox(width: 8),
                  if (i + 1 < allOptions.length)
                    Expanded(child: allOptions[i + 1])
                  else
                    const Expanded(child: SizedBox.shrink()),
                ],
              ),
              if (i + 2 < allOptions.length) const SizedBox(height: 8),
            ],
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isFiltered = active != null;
    final activeCount = isFiltered ? countFor(active!) : totalCount;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: () => _openModal(context),
          child: AnimatedContainer(
            duration: Motion.quick,
            padding: const EdgeInsets.symmetric(
              horizontal: 10,
              vertical: 7,
            ),
            decoration: BoxDecoration(
              color: isFiltered ? AppColors.brown : AppColors.surface,
              borderRadius: AppRadius.pillAll,
              border: Border.all(
                color: isFiltered ? AppColors.brown : AppColors.hairline,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.tune_rounded,
                  size: 14,
                  color: isFiltered ? AppColors.cream : AppColors.brownSoft,
                ),
                const SizedBox(width: 5),
                Text(
                  isFiltered ? active! : 'All Categories',
                  style: AppTextStyles.sans(
                    size: 12,
                    weight: FontWeight.w600,
                    color: isFiltered ? AppColors.cream : AppColors.brown,
                    spacing: 0.2,
                  ),
                ),
                const SizedBox(width: 5),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
                  decoration: BoxDecoration(
                    color: isFiltered
                        ? AppColors.cream.withValues(alpha: 0.2)
                        : AppColors.placeholderFill,
                    borderRadius: AppRadius.pillAll,
                  ),
                  child: Text(
                    '$activeCount',
                    style: AppTextStyles.sans(
                      size: 9.5,
                      weight: FontWeight.w700,
                      color: isFiltered ? AppColors.cream : AppColors.brownSoft,
                    ),
                  ),
                ),
                const SizedBox(width: 3),
                Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 15,
                  color: isFiltered
                      ? AppColors.cream.withValues(alpha: 0.8)
                      : AppColors.brownSoft,
                ),
              ],
            ),
          ),
        ),
        if (isFiltered) ...[
          const SizedBox(width: 6),
          GestureDetector(
            onTap: () => onSelect(null),
            child: Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.hairline),
              ),
              child: const Icon(
                Icons.close_rounded,
                size: 13,
                color: AppColors.brownSoft,
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _CategoryModalOption extends StatelessWidget {
  const _CategoryModalOption({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: 10,
        vertical: 10,
      ),
      color: selected ? AppColors.brown : AppColors.surface,
      border: !selected,
      radius: AppRadius.md,
      child: Row(
        children: [
          Container(
            width: 18,
            height: 18,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected
                  ? AppColors.cream.withValues(alpha: 0.2)
                  : AppColors.placeholderFill,
              border: Border.all(
                color: selected ? AppColors.cream : AppColors.hairline,
                width: 1.5,
              ),
            ),
            child: selected
                ? const Icon(
                    Icons.check_rounded,
                    size: 12,
                    color: AppColors.cream,
                  )
                : null,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.sans(
                    size: 13,
                    weight: selected ? FontWeight.w700 : FontWeight.w600,
                    color: selected ? AppColors.cream : AppColors.brown,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '$count ${count == 1 ? 'dish' : 'dishes'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.sans(
                    size: 11,
                    weight: FontWeight.w500,
                    color: selected
                        ? AppColors.cream.withValues(alpha: 0.82)
                        : AppColors.brownSoft,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────── Allergen modal button ───────────────────────────
class _AllergenButton extends StatelessWidget {
  const _AllergenButton({
    required this.stats,
    required this.count,
  });

  final List<AllergenStat> stats;
  final int count;

  void _openModal(BuildContext context) {
    showCenterDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AppDialogShell(
          children: [
            Text('ALLERGEN MAP', style: AppTextStyles.eyebrow),
            const SizedBox(height: AppSpacing.xs),
            Text('Allergen Summary', style: AppTextStyles.title),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Across the $count dish${count == 1 ? '' : 'es'} shown in this view.',
              style: AppTextStyles.bodySmall,
            ),
            const SizedBox(height: AppSpacing.lg),
            AllergenHeatmap(stats: stats),
          ],
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _openModal(context),
      child: AnimatedContainer(
        duration: Motion.quick,
        padding: const EdgeInsets.symmetric(
          horizontal: 10,
          vertical: 7,
        ),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.health_and_safety_outlined,
              size: 14,
              color: AppColors.goldDeep,
            ),
            const SizedBox(width: 5),
            Text(
              'Allergen Map',
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                color: AppColors.brown,
                spacing: 0.2,
              ),
            ),
            const SizedBox(width: 3),
            const Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 15,
              color: AppColors.brownSoft,
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────── Product card ───────────────────────────
/// cardTitle is 15px serif at 1.2 line-height ⇒ an 18px line. Reserving two
/// lines keeps the title block a constant height across every card, so the
/// [Expanded] photos all resolve to the same size and the grid stays aligned
/// whether a dish name is one line or two.
const double _kTitleBlock = 18.0 * 2;

class _MenuItemCard extends StatelessWidget {
  const _MenuItemCard(this.product, {required this.onTap});

  final Product product;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final disc = PromoDiscountService.instance.getDishDiscount(product, 100);

    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: AppRadius.smAll,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductImage(product),
                  if (product.featured)
                    const Positioned(top: 8, left: 8, child: FeaturedTag()),
                  if (disc != null)
                    Positioned(
                      bottom: 8,
                      right: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.gold,
                          borderRadius: AppRadius.pillAll,
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.brown.withValues(alpha: 0.25),
                              blurRadius: 3,
                              offset: const Offset(0, 1),
                            ),
                          ],
                        ),
                        child: Text(
                          disc.badgeLabel,
                          style: AppTextStyles.sans(
                            size: 9,
                            weight: FontWeight.w800,
                            color: AppColors.cream,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm + 2),
          SizedBox(
            height: _kTitleBlock,
            child: Text(
              product.name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.cardTitle,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            product.category,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.caption,
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────── Loading / empty states ───────────────────────────
class _MenuCardSkeleton extends StatelessWidget {
  const _MenuCardSkeleton();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Expanded(child: PlaceholderBox(radius: AppRadius.sm)),
          const SizedBox(height: AppSpacing.sm + 2),
          // Mirror the live card's two-line title block so photos don't resize
          // when real data replaces the skeletons.
          SizedBox(
            height: _kTitleBlock,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SkeletonLine(height: 12),
                const SizedBox(height: 7),
                FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: 0.7,
                  child: const SkeletonLine(height: 12),
                ),
              ],
            ),
          ),
          const SizedBox(height: 4),
          FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: 0.5,
            child: const SkeletonLine(height: 10),
          ),
        ],
      ),
    );
  }
}

class _MenuMessage extends StatelessWidget {
  const _MenuMessage({
    required this.icon,
    required this.title,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(40, 0, 40, 60),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: AppColors.brown.withValues(alpha: 0.3)),
            const SizedBox(height: AppSpacing.lg),
            Text(title, textAlign: TextAlign.center, style: AppTextStyles.title),
            const SizedBox(height: AppSpacing.sm),
            Text(
              body,
              textAlign: TextAlign.center,
              style: AppTextStyles.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
