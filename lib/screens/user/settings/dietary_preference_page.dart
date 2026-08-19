import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../data/allergens.dart';
import '../../../data/member_preferences.dart';
import '../../../widgets.dart';
import 'settings_widgets.dart';

/// "Dietary preference" — how this member eats, in two parts.
///
/// **How you eat** is one choice from [DietStyle]; the menu carries no per-dish
/// diet tags, so this is recorded on the profile for the kitchen and Gabay to
/// work to rather than filtering anything on its own.
///
/// **Allergens to avoid** is a set of keys from the live taxonomy
/// ([kAllergens]) — and this half the app acts on: the Menu grid and the dish
/// quick-look flag every dish carrying one of them.
///
/// Each tap saves straight away (no SAVE button to forget), through
/// [MemberPreferencesScope] so a failed write rolls the row back and says so.
class DietaryPreferencePage extends StatefulWidget {
  const DietaryPreferencePage({super.key});

  @override
  State<DietaryPreferencePage> createState() => _DietaryPreferencePageState();
}

class _DietaryPreferencePageState extends State<DietaryPreferencePage> {
  Duration _d(int ms) => Duration(milliseconds: ms);

  Future<void> _apply(MemberPreferences next) async {
    final saved = await MemberPreferencesScope.save(next);
    if (saved || !mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text("Couldn't save that — check your connection."),
        ),
      );
  }

  /// Adds or removes one allergen from the avoid set. A fresh set is built each
  /// time (rather than mutating the held one) so the notifier's old and new
  /// values compare unequal and listeners actually rebuild.
  void _toggleAllergen(MemberPreferences prefs, String key) {
    final next = Set<String>.of(prefs.avoidAllergens);
    if (!next.remove(key)) next.add(key);
    _apply(prefs.copyWith(avoidAllergens: next));
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<MemberPreferences>(
      valueListenable: MemberPreferencesScope.notifier,
      builder: (context, prefs, _) {
        final allergens = kAllergens;
        return SettingsScaffold(
          title: 'Dietary preference',
          children: [
            FadeSlideIn(
              child: const SettingsLede(
                title: 'Tell us how you eat',
                body: 'We keep this on your profile so you don\'t have to '
                    'explain it with every booking.',
              ),
            ),
            const SizedBox(height: AppSpacing.xl),

            FadeSlideIn(
              delay: _d(60),
              child: SettingsSection(
                title: 'HOW YOU EAT',
                footnote: 'Shared with the kitchen when you book, so the team '
                    'can plan around it.',
                rows: [
                  for (final style in DietStyle.values)
                    SettingsChoiceRow(
                      title: style.label,
                      subtitle: style.blurb,
                      selected: prefs.diet == style,
                      onTap: () => _apply(prefs.copyWith(diet: style)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.xl),

            FadeSlideIn(
              delay: _d(120),
              child: allergens.isEmpty
                  // The taxonomy is fetched at start-up; an empty one means it
                  // hasn't landed yet (or a moderator cleared it). Say so —
                  // an empty card would read as "there are no allergens".
                  ? const SettingsSection(
                      title: 'ALLERGENS TO AVOID',
                      rows: [_TaxonomyUnavailable()],
                    )
                  : SettingsSection(
                      title: 'ALLERGENS TO AVOID',
                      footnote: 'Dishes on the Menu carrying one of these are '
                          'flagged for you.',
                      rows: [
                        for (final allergen in allergens)
                          SettingsChoiceRow(
                            title: allergen.label,
                            multiple: true,
                            leading: _HeatDot(allergen.severity),
                            selected:
                                prefs.avoidAllergens.contains(allergen.key),
                            onTap: () => _toggleAllergen(prefs, allergen.key),
                          ),
                      ],
                    ),
            ),
            const SizedBox(height: AppSpacing.xl),

            FadeSlideIn(delay: _d(180), child: const _KitchenNote()),
          ],
        );
      },
    );
  }
}

/// Stands in for the allergen list when the taxonomy hasn't loaded — a plain
/// note rather than a row, because there's nothing here to choose.
class _TaxonomyUnavailable extends StatelessWidget {
  const _TaxonomyUnavailable();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.cloud_off_outlined,
            size: 20,
            color: AppColors.brownSoft,
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Text(
              'We couldn\'t load the allergen list. Check your connection and '
              'come back — the rest of your choices are saved.',
              style: AppTextStyles.bodySmall,
            ),
          ),
        ],
      ),
    );
  }
}

/// The allergen's own risk colour, as a small disc — the same ramp the heatmap
/// and the "contains" chips use, so peanut reads hotter than soy here too.
class _HeatDot extends StatelessWidget {
  const _HeatDot(this.severity);

  final double severity;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 14,
      height: 14,
      margin: const EdgeInsets.symmetric(horizontal: 3),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: allergenHeatColor(severity),
        border: Border.all(color: AppColors.hairline),
      ),
    );
  }
}

/// The honest caveat. Fill at Home cooks in one kitchen on shared equipment, so
/// a flag is a warning and not a guarantee — saying so here is the difference
/// between a helpful setting and a dangerous one.
class _KitchenNote extends StatelessWidget {
  const _KitchenNote();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.gold.withValues(alpha: 0.08),
        borderRadius: AppRadius.lgAll,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
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
                Text('ONE KITCHEN, MANY DISHES', style: AppTextStyles.eyebrow),
                const SizedBox(height: 6),
                Text(
                  'We cook everything in the same kitchen, on shared '
                  'equipment, so we can\'t promise a dish is free of traces. '
                  'If an allergy is serious, please tell us in your booking '
                  'notes and call us as well — we\'d rather talk it through '
                  'than have you rely on a tag.',
                  style: AppTextStyles.body,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
