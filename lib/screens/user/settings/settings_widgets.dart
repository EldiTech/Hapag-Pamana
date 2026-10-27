/// The Settings module's shared chrome and row vocabulary.
///
/// Every screen under `settings/` is a full route pushed over the member shell,
/// so each one needs the same parchment scaffold and the same handful of row
/// shapes. Both live here rather than being re-cut per screen: one place decides
/// how a settings list looks, and a new screen is just a list of rows.
library;

import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../widgets.dart';

// ════════════════════════════ Screen shell ════════════════════════════
/// A Settings screen: the parchment app bar with its back button over the shared
/// weave, and [children] as a padded, scrolling list.
class SettingsScaffold extends StatelessWidget {
  const SettingsScaffold({
    super.key,
    required this.title,
    required this.children,
  });

  /// App-bar title, e.g. "Settings" or "Help & FAQ".
  final String title;

  /// The screen's content, laid out as a [ListView].
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text(title, style: AppTextStyles.heading),
      ),
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          SafeArea(
            top: false,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screen,
                AppSpacing.lg,
                AppSpacing.screen,
                AppSpacing.section,
              ),
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}

/// The line or two of orientation a settings screen opens on — a serif title
/// over a muted sentence saying what the screen is for. Mirrors the Order
/// Tracking header so the member-side detail screens all start the same way.
class SettingsLede extends StatelessWidget {
  const SettingsLede({super.key, required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: AppTextStyles.title),
        const SizedBox(height: AppSpacing.xs),
        Text(body, style: AppTextStyles.bodySmall),
      ],
    );
  }
}

// ════════════════════════════ Section ════════════════════════════
/// An eyebrow-titled group of rows in a single parchment card, the rows split
/// by hairline dividers, with an optional [footnote] beneath saying what the
/// group actually does.
class SettingsSection extends StatelessWidget {
  const SettingsSection({
    super.key,
    required this.title,
    required this.rows,
    this.footnote,
  });

  final String title;
  final List<Widget> rows;

  /// A quiet line under the card — where a group needs a word about how far its
  /// switches reach, it goes here rather than swelling every row's subtitle.
  final String? footnote;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: AppSpacing.sm + 2),
          child: Text(title, style: AppTextStyles.eyebrow),
        ),
        AppCard(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
          child: Column(
            children: [
              for (var i = 0; i < rows.length; i++) ...[
                if (i > 0) const Divider(height: 1),
                rows[i],
              ],
            ],
          ),
        ),
        if (footnote != null)
          Padding(
            padding: const EdgeInsets.only(
              left: 4,
              right: 4,
              top: AppSpacing.sm,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  Icons.info_outline,
                  size: 13,
                  color: AppColors.brownSoft.withValues(alpha: 0.7),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(footnote!, style: AppTextStyles.bodySmall),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

// ════════════════════════════ Rows ════════════════════════════
/// A row with a leading icon, a title (+ optional subtitle) and a trailing
/// [Switch]. Tapping anywhere on the row toggles it.
class SettingsSwitchRow extends StatelessWidget {
  const SettingsSwitchRow({
    super.key,
    required this.icon,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => onChanged(!value),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm + 2),
        child: Row(
          children: [
            Icon(icon, size: 20, color: AppColors.goldDeep),
            const SizedBox(width: 14),
            Expanded(child: _TitleBlock(title: title, subtitle: subtitle)),
            const SizedBox(width: AppSpacing.md),
            Switch(value: value, onChanged: onChanged),
          ],
        ),
      ),
    );
  }
}

/// A tappable row with a leading icon, a title (+ optional subtitle), an
/// optional trailing value and a chevron.
///
/// [trailing] shares the title's line, so it's for a word or two ("English") —
/// anything longer competes with the title for a narrow row and both end up
/// ellipsised. Put a longer answer in [subtitle], which has the row to itself.
class SettingsNavRow extends StatelessWidget {
  const SettingsNavRow({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final String? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            Icon(icon, size: 20, color: AppColors.goldDeep),
            const SizedBox(width: 14),
            Expanded(child: _TitleBlock(title: title, subtitle: subtitle)),
            if (trailing != null) ...[
              const SizedBox(width: AppSpacing.md),
              Text(
                trailing!,
                style: AppTextStyles.sans(size: 13, color: AppColors.brownSoft),
              ),
            ],
            const SizedBox(width: 6),
            Icon(
              Icons.chevron_right,
              size: 20,
              color: AppColors.brownSoft.withValues(alpha: 0.6),
            ),
          ],
        ),
      ),
    );
  }
}

/// A non-interactive row showing a static value (e.g. the app version).
class SettingsInfoRow extends StatelessWidget {
  const SettingsInfoRow({
    super.key,
    required this.icon,
    required this.title,
    required this.value,
  });

  final IconData icon;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          Icon(icon, size: 20, color: AppColors.goldDeep),
          const SizedBox(width: 14),
          Expanded(child: _TitleBlock(title: title)),
          Text(
            value,
            style: AppTextStyles.sans(size: 13, color: AppColors.brownSoft),
          ),
        ],
      ),
    );
  }
}

/// A row that leaves the app — a way to reach the kitchen (dialer, mail, maps,
/// a social page). The engraved [label] sits over the [value] so a long address
/// has the row's full width, and the north-east arrow marks the row as going
/// somewhere outside; a row with no [onTap] (opening hours) simply doesn't get
/// one. Echoes the About story's contact card, which says the same things.
class SettingsLinkRow extends StatelessWidget {
  const SettingsLinkRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.placeholderFill,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
            ),
            child: Icon(icon, size: 18, color: AppColors.goldDeep),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppTextStyles.engraved(
                    size: 8,
                    color: AppColors.goldDeep,
                    spacing: 1.4,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                ),
              ],
            ),
          ),
          if (onTap != null)
            Icon(
              Icons.north_east,
              size: 14,
              color: AppColors.brownSoft.withValues(alpha: 0.7),
            ),
        ],
      ),
    );

    if (onTap == null) return row;
    return PressableScale(onTap: onTap, child: row);
  }
}

/// A row the member picks: title (+ optional subtitle) with a mark on the right
/// showing whether it's chosen. [multiple] swaps the radio for a check, so a
/// pick-one list and a pick-many list are visibly different kinds of choice.
///
/// [leading] replaces the usual icon slot — the allergen list passes a heat dot
/// so each allergen carries the same risk colour it wears on the heatmap.
class SettingsChoiceRow extends StatelessWidget {
  const SettingsChoiceRow({
    super.key,
    required this.title,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.leading,
    this.multiple = false,
  });

  final String title;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;
  final Widget? leading;
  final bool multiple;

  @override
  Widget build(BuildContext context) {
    final mark = multiple
        ? (selected ? Icons.check_circle_rounded : Icons.circle_outlined)
        : (selected ? Icons.radio_button_checked : Icons.radio_button_off);

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            if (leading != null) ...[
              leading!,
              const SizedBox(width: 14),
            ],
            Expanded(child: _TitleBlock(title: title, subtitle: subtitle)),
            const SizedBox(width: AppSpacing.md),
            // The mark cross-fades between its two states so a tap settles in
            // rather than snapping, matching the app's motion elsewhere.
            AnimatedSwitcher(
              duration: Motion.quick,
              switchInCurve: Motion.standard,
              switchOutCurve: Motion.exit,
              child: Icon(
                mark,
                key: ValueKey<bool>(selected),
                size: 22,
                color: selected
                    ? AppColors.goldDeep
                    : AppColors.brownSoft.withValues(alpha: 0.4),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A title with an optional muted subtitle beneath it — the common shape inside
/// every row above.
class _TitleBlock extends StatelessWidget {
  const _TitleBlock({required this.title, this.subtitle});

  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          title,
          style: AppTextStyles.sans(
            size: 14,
            weight: FontWeight.w600,
            color: AppColors.brown,
          ),
        ),
        if (subtitle != null) ...[
          const SizedBox(height: 2),
          Text(subtitle!, style: AppTextStyles.bodySmall),
        ],
      ],
    );
  }
}
