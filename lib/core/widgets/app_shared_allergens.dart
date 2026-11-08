part of 'app_shared.dart';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• Allergen heatmap â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/// The shared heat ramp for an allergen intensity (0â€“1): soft gold â†’ antique
/// gold â†’ brick red. Mirrors the Content Moderator's `HP.allergenHeat()` so a
/// dish reads the same warmth in the app and the dashboard.
Color allergenHeatColor(double intensity) {
  final t = intensity.clamp(0.0, 1.0);
  const low = Color(0xFFE6D2A6); // faint gold â€” barely present
  const mid = AppColors.gold; // 0xFFAF854A
  const high = Color(0xFF9B3B2E); // brick red â€” pervasive & high-risk
  return t <= 0.5
      ? Color.lerp(low, mid, t / 0.5)!
      : Color.lerp(mid, high, (t - 0.5) / 0.5)!;
}

/// Ink that stays legible on a heat cell of the given intensity (cream once the
/// fill darkens past mid-gold, brown below). Public because anything painting an
/// allergen its own colour â€” the heatmap, the "contains" chips, the Menu's
/// dietary flags â€” needs the matching foreground.
Color onAllergenHeat(double intensity) =>
    intensity >= 0.5 ? AppColors.cream : AppColors.brown;

/// Names [allergens] as a phrase that reads inside a sentence â€” "peanut",
/// "peanut and shellfish", "peanut, shellfish and soy". Shared by the Menu's
/// dietary note and the dish sheet's warning, which say the same thing at
/// different sizes.
String allergenSentence(List<Allergen> allergens) {
  final names = [for (final a in allergens) a.label.toLowerCase()];
  if (names.length <= 1) return names.isEmpty ? '' : names.first;
  return '${names.take(names.length - 1).join(', ')} and ${names.last}';
}

/// A heatmap of the allergens actually present in an aggregated set of dishes.
/// Each present allergen is a cell whose warmth reflects frequency Ã— severity;
/// allergens none of the dishes carry are omitted entirely, so the map only
/// ever names what a diner could actually encounter.
class AllergenHeatmap extends StatelessWidget {
  const AllergenHeatmap({
    super.key,
    required this.stats,
    this.showLegend = true,
  });

  final List<AllergenStat> stats;
  final bool showLegend;

  @override
  Widget build(BuildContext context) {
    final present = [
      for (final s in stats)
        if (s.present) s,
    ];
    if (present.isEmpty) return const SizedBox.shrink();

    const cols = 3;
    const gap = AppSpacing.sm;
    // Fixed rows of Expanded cells rather than a Wrap of measured widths: the
    // grid can never rag into 2+1 rows when rounding leaves the row a fraction
    // of a pixel short.
    final rows = [
      for (var i = 0; i < present.length; i += cols)
        present.sublist(
          i,
          i + cols > present.length ? present.length : i + cols,
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var r = 0; r < rows.length; r++) ...[
          if (r > 0) const SizedBox(height: gap),
          Row(
            children: [
              for (var i = 0; i < cols; i++) ...[
                if (i > 0) const SizedBox(width: gap),
                Expanded(
                  child: i < rows[r].length
                      ? _AllergenCell(rows[r][i])
                      : const SizedBox.shrink(),
                ),
              ],
            ],
          ),
        ],
        if (showLegend) ...[
          const SizedBox(height: AppSpacing.md),
          const _HeatLegend(),
        ],
      ],
    );
  }
}

/// One allergen tile: its label and "n of total" tally, painted by intensity.
/// Only present allergens reach here â€” [AllergenHeatmap] omits the rest.
class _AllergenCell extends StatelessWidget {
  const _AllergenCell(this.stat);

  final AllergenStat stat;

  @override
  Widget build(BuildContext context) {
    final intensity = stat.intensity;
    final fg = onAllergenHeat(intensity);

    return Tooltip(
      message:
          '${stat.allergen.label} â€” in ${stat.count} of ${stat.total} '
          'dishes in this menu view',
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
        decoration: BoxDecoration(
          color: allergenHeatColor(intensity),
          borderRadius: AppRadius.smAll,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              stat.allergen.short,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w700,
                color: fg,
                spacing: 0.2,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '${stat.count} of ${stat.total} dishes',
              style: AppTextStyles.sans(
                size: 10,
                weight: FontWeight.w600,
                color: fg.withValues(alpha: 0.85),
                spacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A slim "Less â†’ More" gradient key beneath the heatmap, naming what the
/// warmth means (prevalence weighted by risk).
class _HeatLegend extends StatelessWidget {
  const _HeatLegend();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          'LESS',
          style: AppTextStyles.engraved(
            size: 8,
            color: AppColors.brownSoft,
            spacing: 1.2,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Container(
            height: 6,
            decoration: BoxDecoration(
              borderRadius: AppRadius.pillAll,
              gradient: LinearGradient(
                colors: [
                  allergenHeatColor(0.05),
                  allergenHeatColor(0.5),
                  allergenHeatColor(1.0),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          'MORE',
          style: AppTextStyles.engraved(
            size: 8,
            color: AppColors.brownSoft,
            spacing: 1.2,
          ),
        ),
      ],
    );
  }
}

/// Solid chips naming exactly the allergens a single dish carries, each tinted
/// by its own risk weight (so a peanut chip reads hotter than a soy one). Used
/// in the dish detail sheet, above the category heatmap, so "what's in THIS
/// dish" is never confused with "what runs through the category".
class AllergenContainsChips extends StatelessWidget {
  const AllergenContainsChips({super.key, required this.keys});

  final List<String> keys;

  @override
  Widget build(BuildContext context) {
    final allergens = knownAllergens(keys);
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        for (final a in allergens)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
            decoration: BoxDecoration(
              color: allergenHeatColor(a.severity),
              borderRadius: AppRadius.pillAll,
            ),
            child: Text(
              a.label,
              style: AppTextStyles.sans(
                size: 11,
                weight: FontWeight.w600,
                color: onAllergenHeat(a.severity),
                spacing: 0.2,
              ),
            ),
          ),
      ],
    );
  }
}
