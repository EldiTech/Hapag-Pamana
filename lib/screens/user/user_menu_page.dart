import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/theme/bottom_navigation_layout.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/allergens.dart';
import '../../data/member_preferences.dart';
import '../../data/product.dart';
import '../../data/product_repository.dart';
import '../../data/promo_discount_service.dart';
import '../../widgets.dart';
import '../detail_sheets.dart';
import 'settings/dietary_preference_page.dart';

/// Member-side Menu screen — live products from Firestore. A type tab bar (Food
/// Packs / Catering Food Trays), per-type category chips, a search box and a
/// grid of dish cards. Mirrors what the Content Moderator publishes; only
/// products marked "Visible in app" are shown.
///
/// Self-contained member-domain copy of the guest menu so the signed-in catalogue
/// can grow member-only touches (favourites, "order again") independently — the
/// first of those being the member's dietary preference: a dish carrying an
/// allergen they asked us to avoid wears a flag on its card ([_AvoidTag]), and a
/// note above the grid names what's being flagged and opens the setting.
class UserMenuPage extends StatefulWidget {
  const UserMenuPage({super.key});

  @override
  State<UserMenuPage> createState() => _UserMenuPageState();
}

class _UserMenuPageState extends State<UserMenuPage> {
  // The two product types, in the same order the moderator uses.
  static const List<String> _types = ['Food Packs', 'Catering Food Trays'];
  static const int _pageSize = 10;

  final ProductRepository _repo = ProductRepository();
  final ScrollController _scrollController = ScrollController();
  StreamSubscription<List<Product>>? _sub;

  List<Product> _all = const [];
  bool _loading = true;
  bool _error = false;

  String _type = _types.first;
  Set<String> _categories = const {}; // empty ⇒ "All"
  String _search = '';
  int _page = 0;

  @override
  void initState() {
    super.initState();
    // Follow the member's dietary preference, so setting an allergen in
    // Settings has the grid flagged the moment they come back to this tab
    // (which is kept alive by the shell, and so never rebuilt on its own).
    MemberPreferencesScope.notifier.addListener(_onPreferences);
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
    MemberPreferencesScope.notifier.removeListener(_onPreferences);
    _sub?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  void _onPreferences() {
    if (mounted) setState(() {});
  }

  void _setPage(int newPage) {
    if (_page == newPage) return;
    setState(() => _page = newPage);
    _scrollToTop();
  }

  void _resetFilter({VoidCallback? update}) {
    setState(() {
      update?.call();
      _page = 0;
    });
    _scrollToTop();
  }

  void _scrollToTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          0,
          duration: Motion.base,
          curve: Motion.standard,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final loading = _loading;
    final error = _error;
    final all = _all;
    final prefs = MemberPreferencesScope.value;

    // Products for the active type — drives the category chips.
    final ofType = uniqueProductsByIdentity(all.where((p) => p.type == _type));
    final categories = <String>{for (final p in ofType) p.category}.toList()
      ..sort();

    // Apply category + search filters for the grid. Featured dishes lead the
    // grid so their tag actually earns them a spot up front; each group stays
    // alphabetical underneath.
    final term = _search.trim().toLowerCase();
    final shown =
        ofType.where((p) {
          if (_categories.isNotEmpty && !_categories.contains(p.category)) {
            return false;
          }
          if (term.isNotEmpty && !p.name.toLowerCase().contains(term)) {
            return false;
          }
          return true;
        }).toList()..sort((a, b) {
          if (a.featured != b.featured) return a.featured ? -1 : 1;
          return a.name.toLowerCase().compareTo(b.name.toLowerCase());
        });

    // Allergen heatmap over the dishes currently in view — hidden until at
    // least one of them carries allergen data.
    final pageCount = shown.isEmpty
        ? 1
        : (shown.length + _pageSize - 1) ~/ _pageSize;
    final pageIndex = _page >= pageCount ? pageCount - 1 : _page;
    final pageShown = shown
        .skip(pageIndex * _pageSize)
        .take(_pageSize)
        .toList();

    final allergenStats = aggregateAllergens(shown);
    final showAllergens =
        !loading &&
        !error &&
        shown.isNotEmpty &&
        hasAnyAllergenData(allergenStats);

    return CustomScrollView(
      controller: _scrollController,
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
                  onChanged: (v) => setState(() {
                    _search = v;
                    _page = 0;
                  }),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              FadeSlideIn(
                delay: const Duration(milliseconds: 100),
                child: _TypeTabs(
                  types: _types,
                  active: _type,
                  countFor: (t) => all.where((p) => p.type == t).length,
                  onSelect: (t) => _resetFilter(
                    update: () {
                      _type = t;
                      _categories = const {};
                    },
                  ),
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
                              active: _categories,
                              totalCount: ofType.length,
                              countFor: (c) =>
                                  ofType.where((p) => p.category == c).length,
                              onSelect: (cats) => _resetFilter(
                                update: () {
                                  _categories = cats;
                                },
                              ),
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
              // Above the allergen map, because it's about *this member* rather
              // than about the menu: it says which flags they'll see and where
              // the setting behind them lives. It grows in and collapses away
              // as the member edits their preference, so turning the setting on
              // or off never snaps the grid up the screen.
              SmoothReveal(
                visible: prefs.hasDietaryNeeds,
                child: Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.lg),
                  child: _DietNote(
                    prefs: prefs,
                    onTap: () => Navigator.of(context).push(
                      BrandPageRoute(
                        builder: (_) => const DietaryPreferencePage(),
                      ),
                    ),
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
              title: term.isNotEmpty || _categories.isNotEmpty
                  ? 'No dishes match'
                  : 'No dishes yet',
              body: term.isNotEmpty || _categories.isNotEmpty
                  ? 'Try a different search or category.'
                  : 'New dishes will appear here once published.',
            ),
          )
        else ...[
          if (pageCount > 1)
            SliverToBoxAdapter(
              child: _MenuPagination(
                page: pageIndex,
                pageCount: pageCount,
                total: shown.length,
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screen,
                  0,
                  AppSpacing.screen,
                  AppSpacing.md,
                ),
                onPrevious: pageIndex == 0
                    ? null
                    : () => _setPage(pageIndex - 1),
                onNext: pageIndex == pageCount - 1
                    ? null
                    : () => _setPage(pageIndex + 1),
              ),
            ),
          _gridSliver(
            childCount: pageShown.length,
            // Cards settle in with a gentle staggered fade + rise as the grid
            // appears; the delay is capped so a long menu never feels slow.
            // Keyed by dish: changing the search or the category rebuilds the
            // grid with different children, and the key is what makes those
            // fade + rise into place instead of swapping contents in a frame.
            builder: (i) => FadeSlideIn(
              key: ValueKey(pageShown[i].id),
              delay: Duration(milliseconds: 40 * (i % 8)),
              child: _MenuItemCard(
                pageShown[i],
                avoided: prefs.avoidedIn(pageShown[i].allergens),
                dietaryConflicts: prefs.dietaryConflicts(pageShown[i]),
                onTap: () => showProductSheet(context, pageShown[i]),
              ),
            ),
          ),
        ],
        if (!loading && !error && shown.isNotEmpty)
          SliverToBoxAdapter(
            child: _MenuPagination(
              page: pageIndex,
              pageCount: pageCount,
              total: shown.length,
              onPrevious: pageIndex == 0
                  ? null
                  : () => _setPage(pageIndex - 1),
              onNext: pageIndex == pageCount - 1
                  ? null
                  : () => _setPage(pageIndex + 1),
            ),
          ),
        SliverToBoxAdapter(
          child: SizedBox(
            height: AppBottomNavigationLayout.memberContentClearance(context),
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
  final Set<String> active; // empty ⇒ All
  final int Function(String) countFor;
  final int totalCount;
  final ValueChanged<Set<String>> onSelect;

  void _openModal(BuildContext context) {
    final chosen = Set<String>.of(active);
    showCenterDialog<void>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setModalState) {
            final catOptions = <Widget>[
              for (final cat in categories)
                _CategoryModalOption(
                  label: cat,
                  count: countFor(cat),
                  selected: chosen.contains(cat),
                  onTap: () {
                    setModalState(() {
                      if (!chosen.remove(cat)) {
                        chosen.add(cat);
                      }
                    });
                  },
                ),
            ];

            return AppDialogShell(
              children: [
                Text('MENU FILTER', style: AppTextStyles.eyebrow),
                const SizedBox(height: AppSpacing.xs),
                Text('Select Categories', style: AppTextStyles.title),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  'Select one or more categories to filter dishes.',
                  style: AppTextStyles.bodySmall,
                ),
                const SizedBox(height: AppSpacing.lg),
                _AllCategoriesModalOption(
                  count: totalCount,
                  selected: chosen.isEmpty,
                  onTap: () {
                    setModalState(() {
                      chosen.clear();
                    });
                  },
                ),
                if (catOptions.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  for (var i = 0; i < catOptions.length; i += 2) ...[
                    IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: catOptions[i]),
                          const SizedBox(width: 8),
                          if (i + 1 < catOptions.length)
                            Expanded(child: catOptions[i + 1])
                          else
                            const Expanded(child: SizedBox.shrink()),
                        ],
                      ),
                    ),
                    if (i + 2 < catOptions.length) const SizedBox(height: 8),
                  ],
                ],
                const SizedBox(height: AppSpacing.md),
                AppButton(
                  label: chosen.isEmpty
                      ? 'SHOW ALL CATEGORIES'
                      : 'KEEP ${chosen.length} CATEGOR${chosen.length == 1 ? 'Y' : 'IES'}',
                  fullWidth: true,
                  onPressed: () {
                    Navigator.of(dialogContext).pop();
                    onSelect(chosen);
                  },
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isFiltered = active.isNotEmpty;
    final int activeCount;
    final String label;
    if (active.isEmpty) {
      activeCount = totalCount;
      label = 'All Categories';
    } else if (active.length == 1) {
      activeCount = countFor(active.first);
      label = active.first;
    } else {
      activeCount = active.fold<int>(0, (sum, cat) => sum + countFor(cat));
      label = '${active.length} Categories';
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        GestureDetector(
          onTap: () => _openModal(context),
          child: AnimatedContainer(
            duration: Motion.quick,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
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
                  label,
                  style: AppTextStyles.sans(
                    size: 12,
                    weight: FontWeight.w600,
                    color: isFiltered ? AppColors.cream : AppColors.brown,
                    spacing: 0.2,
                  ),
                ),
                const SizedBox(width: 5),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 5,
                    vertical: 1,
                  ),
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
            onTap: () => onSelect(const {}),
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

class _SelectionIndicator extends StatelessWidget {
  const _SelectionIndicator({required this.selected});

  final bool selected;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 18,
      height: 18,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: selected
            ? AppColors.cream.withValues(alpha: 0.22)
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
    );
  }
}

class _AllCategoriesModalOption extends StatelessWidget {
  const _AllCategoriesModalOption({
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      color: selected ? AppColors.brown : AppColors.surface,
      border: !selected,
      radius: AppRadius.md,
      child: Row(
        children: [
          _SelectionIndicator(selected: selected),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'All Categories',
                  style: AppTextStyles.sans(
                    size: 13.5,
                    weight: selected ? FontWeight.w700 : FontWeight.w600,
                    color: selected ? AppColors.cream : AppColors.brown,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'View complete menu catalog',
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
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: selected
                  ? AppColors.cream.withValues(alpha: 0.2)
                  : AppColors.placeholderFill,
              borderRadius: AppRadius.pillAll,
            ),
            child: Text(
              '$count dishes',
              style: AppTextStyles.sans(
                size: 10.5,
                weight: FontWeight.w700,
                color: selected ? AppColors.cream : AppColors.brownSoft,
              ),
            ),
          ),
        ],
      ),
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
    final disc = PromoDiscountService.instance.getCategoryDiscount(label, 100);

    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 11),
      color: selected ? AppColors.brown : AppColors.surface,
      border: !selected,
      radius: AppRadius.md,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _SelectionIndicator(selected: selected),
              if (disc != null)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: selected
                        ? AppColors.cream.withValues(alpha: 0.22)
                        : AppColors.gold.withValues(alpha: 0.18),
                    borderRadius: AppRadius.pillAll,
                    border: Border.all(
                      color: selected
                          ? AppColors.cream.withValues(alpha: 0.5)
                          : AppColors.goldDeep.withValues(alpha: 0.4),
                      width: 1,
                    ),
                  ),
                  child: Text(
                    disc.badgeLabel,
                    style: AppTextStyles.sans(
                      size: 9,
                      weight: FontWeight.w700,
                      color: selected ? AppColors.cream : AppColors.goldDeep,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
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
    );
  }
}

// ─────────────────────────── Allergen modal button ───────────────────────────
class _AllergenButton extends StatelessWidget {
  const _AllergenButton({required this.stats, required this.count});

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
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
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
  const _MenuItemCard(
    this.product, {
    required this.onTap,
    this.avoided = const [],
    this.dietaryConflicts = const [],
  });

  final Product product;

  /// The allergens on this dish that the member asked us to avoid. Empty for a
  /// member who's set no preference — and the card then looks exactly as before.
  final List<Allergen> avoided;

  /// Any dietary conflicts (e.g. Vegetarian, Pescatarian, No pork) for this dish.
  final List<String> dietaryConflicts;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final disc = PromoDiscountService.instance.getDishDiscount(product, 100);
    final hasAvoid = avoided.isNotEmpty || dietaryConflicts.isNotEmpty;

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
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
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
                  // Opposite corner from the Featured tag, so a dish can carry
                  // both without them colliding.
                  if (hasAvoid)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: _AvoidTag(
                        avoided: avoided,
                        dietaryConflicts: dietaryConflicts,
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
          Row(
            children: [
              Expanded(
                child: Text(
                  product.category,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.caption,
                ),
              ),
              if (disc != null) ...[
                const SizedBox(width: 4),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 5,
                    vertical: 1,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.15),
                    borderRadius: AppRadius.pillAll,
                    border: Border.all(
                      color: AppColors.goldDeep.withValues(alpha: 0.4),
                    ),
                  ),
                  child: Text(
                    disc.badgeLabel,
                    style: AppTextStyles.sans(
                      size: 8.5,
                      weight: FontWeight.w700,
                      color: AppColors.goldDeep,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────── Dietary flags ───────────────────────────
/// Why the flags are here, and how to change them: names the dietary choices and
/// allergens the member is avoiding and opens the setting. Shown only once they've
/// set one, so a member with no preference never sees a word about it.
class _DietNote extends StatelessWidget {
  const _DietNote({required this.prefs, required this.onTap});

  final MemberPreferences prefs;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final avoided = prefs.avoidedIn(prefs.avoidAllergens);
    final dietLabels = [for (final d in prefs.diets) d.label].join(', ');
    final String message;
    if (dietLabels.isNotEmpty && avoided.isNotEmpty) {
      message =
          'Flagging $dietLabels dishes and dishes carrying ${allergenSentence(avoided)}.';
    } else if (dietLabels.isNotEmpty) {
      message =
          'Flagging dishes conflicting with your $dietLabels preference.';
    } else {
      message = 'Flagging dishes with ${allergenSentence(avoided)}.';
    }

    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          const Icon(
            Icons.health_and_safety_outlined,
            size: 18,
            color: AppColors.goldDeep,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('YOUR DIETARY PREFERENCE', style: AppTextStyles.eyebrow),
                const SizedBox(height: 3),
                Text(
                  message,
                  style: AppTextStyles.bodySmall,
                ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right,
            size: 20,
            color: AppColors.brownSoft.withValues(alpha: 0.6),
          ),
        ],
      ),
    );
  }
}

/// The flag on a dish the member asked us to keep away from. Painted in the
/// hottest of the offending allergens' own heat colours, so the tag carries the
/// same risk language as the heatmap and the "contains" chips rather than
/// inventing a warning colour of its own.
class _AvoidTag extends StatelessWidget {
  const _AvoidTag({
    this.avoided = const [],
    this.dietaryConflicts = const [],
  });

  final List<Allergen> avoided;
  final List<String> dietaryConflicts;

  @override
  Widget build(BuildContext context) {
    final severity = avoided.fold<double>(
      dietaryConflicts.isNotEmpty ? 1.0 : 0.0,
      (worst, a) => a.severity > worst ? a.severity : worst,
    );
    final fill = allergenHeatColor(severity);
    final ink = onAllergenHeat(severity);

    final String label;
    if (avoided.isNotEmpty && dietaryConflicts.isEmpty) {
      label = avoided.length == 1
          ? avoided.first.short.toUpperCase()
          : '${avoided.length} TO AVOID';
    } else if (dietaryConflicts.isNotEmpty && avoided.isEmpty) {
      if (dietaryConflicts.length == 1) {
        final c = dietaryConflicts.first.toUpperCase();
        if (c.contains('PORK')) {
          label = 'PORK';
        } else if (c.contains('SEAFOOD')) {
          label = 'SEAFOOD';
        } else if (c.contains('MEAT')) {
          label = 'MEAT';
        } else if (c.contains('HALAL')) {
          label = 'NOT HALAL';
        } else {
          label = 'DIET';
        }
      } else {
        label = 'TO AVOID';
      }
    } else {
      label = 'TO AVOID';
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(7, 4, 9, 4),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: ink.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.warning_amber_rounded, size: 12, color: ink),
          const SizedBox(width: 4),
          Text(
            label,
            style: AppTextStyles.engraved(size: 8, color: ink, spacing: 1.2),
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

class _MenuPagination extends StatelessWidget {
  const _MenuPagination({
    required this.page,
    required this.pageCount,
    required this.total,
    required this.onPrevious,
    required this.onNext,
    this.padding,
  });

  final int page;
  final int pageCount;
  final int total;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final first = page * _UserMenuPageState._pageSize + 1;
    final last = ((page + 1) * _UserMenuPageState._pageSize).clamp(0, total);

    return Padding(
      padding: padding ??
          const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            0,
            AppSpacing.screen,
            AppSpacing.section,
          ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          _MenuPageButton(
            icon: Icons.chevron_left_rounded,
            label: 'Previous page',
            onTap: onPrevious,
          ),
          Text(
            'Page ${page + 1} of $pageCount',
            style: AppTextStyles.sans(
              size: 11,
              weight: FontWeight.w700,
              color: AppColors.brown,
            ),
          ),
          Text('$first–$last of $total', style: AppTextStyles.bodySmall),
          _MenuPageButton(
            icon: Icons.chevron_right_rounded,
            label: 'Next page',
            onTap: onNext,
          ),
        ],
      ),
    );
  }
}

class _MenuPageButton extends StatelessWidget {
  const _MenuPageButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: onTap,
      tooltip: label,
      icon: Icon(icon),
      style: IconButton.styleFrom(
        foregroundColor: AppColors.brown,
        disabledForegroundColor: AppColors.brownSoft.withValues(alpha: 0.3),
        backgroundColor: AppColors.surface,
        disabledBackgroundColor: AppColors.placeholderFill,
        shape: const CircleBorder(),
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
            Text(
              title,
              textAlign: TextAlign.center,
              style: AppTextStyles.title,
            ),
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
