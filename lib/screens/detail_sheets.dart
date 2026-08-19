import 'package:flutter/material.dart';

import '../brand.dart';
import '../data/allergens.dart';
import '../data/catering.dart';
import '../data/member_preferences.dart';
import '../data/product.dart';
import '../data/product_repository.dart';
import '../widgets.dart';

/// A tap-to-view "quick look" sheet for a dish — its photo, category, name and
/// type, then its allergens: the dish's own (solid chips) and a heatmap of how
/// those allergens run across its whole category. (The product schema carries
/// no description or price.) Shared by the Menu grid and the Home featured /
/// kitchen cards.
Future<void> showProductSheet(BuildContext context, Product product) {
  return _show(
    context,
    children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: Stack(
          children: [
            // 16:9 keeps the whole quick look — photo through heatmap legend —
            // on screen without scrolling on typical phones.
            AspectRatio(aspectRatio: 16 / 9, child: ProductImage(product)),
            if (product.featured)
              const Positioned(top: 10, left: 10, child: FeaturedTag()),
          ],
        ),
      ),
      const SizedBox(height: AppSpacing.lg),
      if (product.category.isNotEmpty) ...[
        Text(product.category.toUpperCase(), style: AppTextStyles.eyebrow),
        const SizedBox(height: 6),
      ],
      Text(product.name, style: AppTextStyles.heading),
      if (product.type.isNotEmpty) ...[
        const SizedBox(height: AppSpacing.md),
        _Chip(product.type),
      ],
      ..._allergenSection(product),
    ],
  );
}

/// The allergen block for a viewed dish: the member's own warning if this dish
/// crosses their dietary preference, then what the dish contains, then a heatmap
/// aggregated across every visible dish in the same category.
///
/// The warning leads because it's the one part that's about the person reading:
/// the Menu card only had room to count the offenders, so this is where they're
/// named. A guest — or a member who's set no preference — sees none of it.
List<Widget> _allergenSection(Product product) {
  final siblings = ProductRepository.instance.latest
      .where((p) => p.category == product.category)
      .toList();
  final stats = aggregateAllergens(siblings);
  final categoryHasData = hasAnyAllergenData(stats);
  // Resolve the dish's tags against the current taxonomy — a tag whose
  // allergen the moderators have deleted shouldn't count as data.
  final contains = knownAllergens(product.allergens);

  // Nothing tagged anywhere in this corner of the menu — say so quietly rather
  // than imply an all-clear.
  if (contains.isEmpty && !categoryHasData) {
    return [
      const SizedBox(height: AppSpacing.lg),
      const _AllergenHairline(),
      const SizedBox(height: AppSpacing.lg),
      Text('ALLERGENS', style: AppTextStyles.eyebrow),
      const SizedBox(height: 6),
      Text(
        "Allergen information isn't available for this dish yet.",
        style: AppTextStyles.body,
      ),
    ];
  }

  // Only the allergens this member asked us to avoid, and only those this dish
  // actually carries.
  final avoided = MemberPreferencesScope.value.avoidedIn(product.allergens);

  return [
    const SizedBox(height: AppSpacing.lg),
    const _AllergenHairline(),
    const SizedBox(height: AppSpacing.lg),

    // ── Your preference ──
    if (avoided.isNotEmpty) ...[
      _AvoidNotice(avoided),
      const SizedBox(height: AppSpacing.lg),
    ],

    // ── This dish ──
    Text('THIS DISH CONTAINS', style: AppTextStyles.eyebrow),
    const SizedBox(height: AppSpacing.sm),
    if (contains.isNotEmpty)
      AllergenContainsChips(keys: product.allergens)
    else
      Text('No allergens recorded for this dish.', style: AppTextStyles.body),

    // ── Across the category ──
    if (categoryHasData) ...[
      const SizedBox(height: AppSpacing.xl),
      Text(
        'COMMON IN ${product.category.toUpperCase()}',
        style: AppTextStyles.eyebrow,
      ),
      const SizedBox(height: 4),
      Text(
        'Across the ${siblings.length} dish${siblings.length == 1 ? '' : 'es'} '
        'here — warmer means more common and higher-risk.',
        style: AppTextStyles.bodySmall,
      ),
      const SizedBox(height: AppSpacing.md),
      AllergenHeatmap(stats: stats),
    ],
  ];
}

/// "You asked us to avoid this" — the dish crosses the member's dietary
/// preference, named allergen by allergen.
///
/// Tinted by the worst offender's own severity (the same ramp the heatmap uses),
/// and it stops short of telling the member what to do: they set the preference,
/// so the sheet's job is to make sure they noticed, not to overrule them.
class _AvoidNotice extends StatelessWidget {
  const _AvoidNotice(this.avoided);

  final List<Allergen> avoided;

  @override
  Widget build(BuildContext context) {
    final severity = avoided.fold<double>(
      0,
      (worst, a) => a.severity > worst ? a.severity : worst,
    );
    final tint = allergenHeatColor(severity);

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.14),
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: tint.withValues(alpha: 0.55)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded, size: 18, color: tint),
          const SizedBox(width: AppSpacing.sm + 2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'HEADS UP',
                  style: AppTextStyles.engraved(
                    size: 9,
                    color: AppColors.brown,
                    spacing: 1.4,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'This dish carries ${allergenSentence(avoided)}, which you '
                  'asked us to avoid.',
                  style: AppTextStyles.sans(
                    size: 12,
                    weight: FontWeight.w600,
                    height: 1.35,
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

/// A faint gold-flecked rule separating the allergen block from the dish facts.
class _AllergenHairline extends StatelessWidget {
  const _AllergenHairline();

  @override
  Widget build(BuildContext context) =>
      const Divider(height: 1, color: AppColors.hairline);
}

/// A tap-to-view "lightbox" sheet for an event setup — its photo, shown larger,
/// with the title.
Future<void> showSetupSheet(BuildContext context, EventSetup setup) {
  return _show(
    context,
    children: [
      ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        child: AspectRatio(aspectRatio: 4 / 3, child: SetupImage(setup)),
      ),
      const SizedBox(height: AppSpacing.lg),
      Text('EVENT SETUP', style: AppTextStyles.eyebrow),
      const SizedBox(height: 6),
      Text(setup.title, style: AppTextStyles.heading),
    ],
  );
}

/// Opens a "quick look" as a centered dialog that scales + fades in from the
/// middle of the screen (via [showCenterDialog] / [AppDialogShell]) rather than
/// sliding up from an edge — the app's standard, premium popup entrance.
Future<void> _show(BuildContext context, {required List<Widget> children}) {
  return showCenterDialog<void>(
    context: context,
    builder: (_) => AppDialogShell(children: children),
  );
}

class _Chip extends StatelessWidget {
  const _Chip(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.gold.withValues(alpha: 0.14),
        borderRadius: AppRadius.pillAll,
      ),
      child: Text(
        label,
        style: AppTextStyles.sans(
          size: 11,
          weight: FontWeight.w600,
          color: AppColors.goldDeep,
          spacing: 0.4,
        ),
      ),
    );
  }
}

