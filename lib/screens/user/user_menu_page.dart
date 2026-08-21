import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/allergens.dart';
import '../../data/member_preferences.dart';
import '../../data/product.dart';
import '../../data/product_repository.dart';
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
    super.dispose();
  }

  void _onPreferences() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final loading = _loading;
    final error = _error;
    final all = _all;
    final prefs = MemberPreferencesScope.value;

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
              // Placeholder pills → the real chips → nothing (a type with no
              // categories): one cross-fade, with the row's height tweened so
              // the grid below settles rather than jumps.
              SmoothSwap(
                resize: true,
                child: loading
                    ? SizedBox(
                        key: const ValueKey('chips-loading'),
                        height: 34,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          itemCount: 6,
                          separatorBuilder: (_, _) => const SizedBox(width: 10),
                          itemBuilder: (_, i) =>
                              PillPlaceholder(width: 64 + (i.isEven ? 30 : 0)),
                        ),
                      )
                    : categories.isEmpty
                        ? const SizedBox.shrink(key: ValueKey('chips-none'))
                        : _CategoryChips(
                            key: const ValueKey('chips'),
                            categories: categories,
                            active: _category,
                            onSelect: (c) => setState(() => _category = c),
                          ),
              ),
              // Above the allergen map, because it's about *this member* rather
              // than about the menu: it says which flags they'll see and where
              // the setting behind them lives. It grows in and collapses away
              // as the member edits their preference, so turning the setting on
              // or off never snaps the grid up the screen.
              SmoothReveal(
                visible: prefs.avoidAllergens.isNotEmpty,
                child: Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.lg),
                  child: _DietNote(
                    avoided: knownAllergens(prefs.avoidAllergens),
                    onTap: () => Navigator.of(context).push(
                      BrandPageRoute(
                        builder: (_) => const DietaryPreferencePage(),
                      ),
                    ),
                  ),
                ),
              ),
              // The summary comes and goes as the filters change what's in
              // view, so it grows and fades rather than popping the grid down.
              SmoothReveal(
                visible: showAllergens,
                child: Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.lg),
                  child: _AllergenSummary(
                    stats: allergenStats,
                    count: shown.length,
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
                avoided: prefs.avoidedIn(shown[i].allergens),
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

// ─────────────────────────── Category chips ───────────────────────────
class _CategoryChips extends StatelessWidget {
  const _CategoryChips({
    super.key,
    required this.categories,
    required this.active,
    required this.onSelect,
  });

  final List<String> categories;
  final String? active; // null ⇒ All
  final ValueChanged<String?> onSelect;

  @override
  Widget build(BuildContext context) {
    final items = <String?>[null, ...categories];
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final c = items[i];
          final selected = c == active;
          return GestureDetector(
            onTap: () => onSelect(c),
            child: AnimatedContainer(
              duration: Motion.quick,
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? AppColors.brown : AppColors.surface,
                borderRadius: AppRadius.pillAll,
                border: Border.all(
                  color: selected ? AppColors.brown : AppColors.hairline,
                ),
              ),
              child: Text(
                c ?? 'All',
                style: AppTextStyles.sans(
                  size: 12,
                  weight: FontWeight.w600,
                  color: selected ? AppColors.cream : AppColors.brownSoft,
                  spacing: 0.3,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

// ─────────────────────────── Allergen summary ───────────────────────────
/// A card-bound heatmap of the allergens running through the dishes currently
/// shown, so the menu's collection view surfaces the same allergen read-out a
/// single dish does. Tracks the active type / category / search filter.
class _AllergenSummary extends StatelessWidget {
  const _AllergenSummary({required this.stats, required this.count});

  final List<AllergenStat> stats;
  final int count;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.health_and_safety_outlined,
                size: 16,
                color: AppColors.goldDeep,
              ),
              const SizedBox(width: 8),
              Text('ALLERGEN MAP', style: AppTextStyles.eyebrow),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Across the $count dish${count == 1 ? '' : 'es'} shown',
            style: AppTextStyles.bodySmall,
          ),
          const SizedBox(height: AppSpacing.md),
          AllergenHeatmap(stats: stats),
        ],
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
  });

  final Product product;

  /// The allergens on this dish that the member asked us to avoid. Empty for a
  /// member who's set no preference — and the card then looks exactly as before.
  final List<Allergen> avoided;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
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
                  // Opposite corner from the Featured tag, so a dish can carry
                  // both without them colliding.
                  if (avoided.isNotEmpty)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: _AvoidTag(avoided),
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

// ─────────────────────────── Dietary flags ───────────────────────────
/// Why the flags are here, and how to change them: names the allergens the
/// member is avoiding and opens the setting. Shown only once they've set one, so
/// a member with no preference never sees a word about it.
class _DietNote extends StatelessWidget {
  const _DietNote({required this.avoided, required this.onTap});

  /// The avoided allergens, already resolved against the live taxonomy.
  final List<Allergen> avoided;

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
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
                  'Flagging dishes with ${allergenSentence(avoided)}.',
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
  const _AvoidTag(this.avoided);

  final List<Allergen> avoided;

  @override
  Widget build(BuildContext context) {
    final severity = avoided.fold<double>(
      0,
      (worst, a) => a.severity > worst ? a.severity : worst,
    );
    final fill = allergenHeatColor(severity);
    final ink = onAllergenHeat(severity);
    // One offender is worth naming; several would crowd the corner, so they're
    // counted instead and the sheet spells them out.
    final label = avoided.length == 1
        ? avoided.first.short.toUpperCase()
        : '${avoided.length} TO AVOID';

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
