import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../widgets.dart';
import '../about_page.dart';

/// Member Settings screen — pushed as a full route from the Account tab (so it
/// overlays the shell, with its own parchment app bar and back button).
///
/// The notification / preference switches flip locally for now; persistence
/// (writing to `customers/{uid}` or local prefs) and the nav rows' real
/// destinations are still to be wired — those rows surface a "coming soon" note.
/// Log out is wired through from the shell.
class UserSettingsPage extends StatefulWidget {
  const UserSettingsPage({super.key, required this.onLogout});

  /// Signs out and returns to the guest side (provided by the member shell).
  final VoidCallback onLogout;

  @override
  State<UserSettingsPage> createState() => _UserSettingsPageState();
}

class _UserSettingsPageState extends State<UserSettingsPage> {
  // Local-only toggle state (not persisted yet).
  bool _orderUpdates = true;
  bool _promotions = true;
  bool _gabaySuggestions = true;
  bool _healthierFirst = false;

  Duration _d(int ms) => Duration(milliseconds: ms);

  void _comingSoon() {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(content: Text('This is coming soon.')),
      );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text('Settings', style: AppTextStyles.heading),
      ),
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screen,
              AppSpacing.lg,
              AppSpacing.screen,
              AppSpacing.section,
            ),
            children: [
              FadeSlideIn(
                child: _Section(
                  title: 'NOTIFICATIONS',
                  rows: [
                    _SwitchRow(
                      icon: Icons.receipt_long_outlined,
                      title: 'Order updates',
                      subtitle: 'Status of your orders and bookings.',
                      value: _orderUpdates,
                      onChanged: (v) => setState(() => _orderUpdates = v),
                    ),
                    _SwitchRow(
                      icon: Icons.local_offer_outlined,
                      title: 'Promotions & offers',
                      subtitle: 'Seasonal deals and new packages.',
                      value: _promotions,
                      onChanged: (v) => setState(() => _promotions = v),
                    ),
                    _SwitchRow(
                      icon: Icons.recommend_outlined,
                      title: 'Gabay suggestions',
                      subtitle: 'Personalised picks from your companion.',
                      value: _gabaySuggestions,
                      onChanged: (v) => setState(() => _gabaySuggestions = v),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              FadeSlideIn(
                delay: _d(80),
                child: _Section(
                  title: 'PREFERENCES',
                  rows: [
                    _SwitchRow(
                      icon: Icons.eco_outlined,
                      title: 'Healthier suggestions first',
                      subtitle: 'Let Gabay favour lighter, nutritious dishes.',
                      value: _healthierFirst,
                      onChanged: (v) => setState(() => _healthierFirst = v),
                    ),
                    _NavRow(
                      icon: Icons.restaurant_outlined,
                      title: 'Dietary preference',
                      trailing: 'None',
                      onTap: _comingSoon,
                    ),
                    _NavRow(
                      icon: Icons.language_outlined,
                      title: 'Language',
                      trailing: 'English',
                      onTap: _comingSoon,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              FadeSlideIn(
                delay: _d(160),
                child: _Section(
                  title: 'SUPPORT',
                  rows: [
                    _NavRow(
                      icon: Icons.help_outline,
                      title: 'Help & FAQ',
                      onTap: _comingSoon,
                    ),
                    _NavRow(
                      icon: Icons.chat_bubble_outline,
                      title: 'Contact us',
                      onTap: _comingSoon,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.xl),

              FadeSlideIn(
                delay: _d(240),
                child: _Section(
                  title: 'ABOUT',
                  rows: [
                    _NavRow(
                      icon: Icons.info_outline,
                      title: 'About Hapag Pamana',
                      onTap: () => Navigator.of(context).push(
                        BrandPageRoute(builder: (_) => const _AboutRoute()),
                      ),
                    ),
                    _NavRow(
                      icon: Icons.privacy_tip_outlined,
                      title: 'Privacy Policy',
                      onTap: _comingSoon,
                    ),
                    _NavRow(
                      icon: Icons.description_outlined,
                      title: 'Terms of Service',
                      onTap: _comingSoon,
                    ),
                    const _InfoRow(
                      icon: Icons.tag_outlined,
                      title: 'App version',
                      value: '1.0.0',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              FadeSlideIn(
                delay: _d(320),
                child: AppButton.secondary(
                  label: 'LOG OUT',
                  icon: Icons.logout,
                  fullWidth: true,
                  onPressed: widget.onLogout,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The full Fill at Home story — the same [AboutPage] the guest About tab
/// shows, wrapped in its own parchment scaffold (with a back button) so the
/// member side can reach it from Settings.
class _AboutRoute extends StatelessWidget {
  const _AboutRoute();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text('About', style: AppTextStyles.heading),
      ),
      body: const Stack(
        children: [
          ParchmentBackground(weave: true),
          AboutPage(),
        ],
      ),
    );
  }
}

// ════════════════════════════ Section ════════════════════════════
/// An eyebrow-titled group of rows in a single parchment card, the rows split
/// by hairline dividers.
class _Section extends StatelessWidget {
  const _Section({required this.title, required this.rows});

  final String title;
  final List<Widget> rows;

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
      ],
    );
  }
}

// ════════════════════════════ Rows ════════════════════════════
/// A row with a leading icon, a title (+ optional subtitle) and a trailing
/// [Switch]. Tapping anywhere on the row toggles it.
class _SwitchRow extends StatelessWidget {
  const _SwitchRow({
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
class _NavRow extends StatelessWidget {
  const _NavRow({
    required this.icon,
    required this.title,
    required this.onTap,
    this.trailing,
  });

  final IconData icon;
  final String title;
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
            Expanded(child: _TitleBlock(title: title)),
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
class _InfoRow extends StatelessWidget {
  const _InfoRow({
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

/// A title with an optional muted subtitle beneath it.
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
