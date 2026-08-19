import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../core/app_info.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../data/member_preferences.dart';
import '../../../widgets.dart';
import '../order_tracking_page.dart';
import 'about_route.dart';
import 'contact_us_page.dart';
import 'dietary_preference_page.dart';
import 'help_faq_page.dart';
import 'language_page.dart';
import 'privacy_policy_page.dart';
import 'settings_widgets.dart';
import 'terms_of_service_page.dart';

/// Member Settings screen — pushed as a full route from the Account tab (so it
/// overlays the shell, with its own parchment app bar and back button).
///
/// Everything here is live. The switches and the two pickers read and write the
/// member's [MemberPreferences] on `customers/{uid}`, so a choice survives a
/// restart and follows them to another phone; the nav rows push the real
/// screens; log out is wired through from the shell.
///
/// Writes go through [MemberPreferencesScope], which flips the value locally
/// before it hits Firestore and rolls it back if the write fails — so a switch
/// never sits there looking saved when it isn't.
class UserSettingsPage extends StatefulWidget {
  const UserSettingsPage({super.key, required this.onLogout});

  /// Signs out and returns to the guest side (provided by the member shell).
  final VoidCallback onLogout;

  @override
  State<UserSettingsPage> createState() => _UserSettingsPageState();
}

class _UserSettingsPageState extends State<UserSettingsPage> {
  @override
  void initState() {
    super.initState();
    // The shell loads the member's preferences at sign-in, so the rows paint
    // from the set already in hand. This re-read only corrects them when the
    // profile moved elsewhere (another device) or that first load failed.
    MemberPreferencesScope.load();
  }

  Duration _d(int ms) => Duration(milliseconds: ms);

  /// Saves one changed preference, reporting a failed write rather than letting
  /// the silently rolled-back switch puzzle the member.
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

  void _push(Widget page) {
    Navigator.of(context).push(BrandPageRoute(builder: (_) => page));
  }

  @override
  Widget build(BuildContext context) {
    // Rebuilds on every saved change, so the dietary / language rows show their
    // new value the moment their picker writes it — no result plumbing needed.
    return ValueListenableBuilder<MemberPreferences>(
      valueListenable: MemberPreferencesScope.notifier,
      builder: (context, prefs, _) => SettingsScaffold(
        title: 'Settings',
        children: [
          FadeSlideIn(
            child: SettingsSection(
              title: 'MY ORDERS',
              rows: [
                SettingsNavRow(
                  icon: Icons.local_shipping_outlined,
                  title: 'Order tracking',
                  subtitle: 'Follow every booking you\'ve sent us.',
                  onTap: () => _push(const OrderTrackingPage()),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          FadeSlideIn(
            delay: _d(60),
            child: SettingsSection(
              title: 'NOTIFICATIONS',
              footnote: 'Saved to your profile — we follow these whenever we '
                  'reach out to you about your orders.',
              rows: [
                SettingsSwitchRow(
                  icon: Icons.receipt_long_outlined,
                  title: 'Order updates',
                  subtitle: 'Status of your orders and bookings.',
                  value: prefs.orderUpdates,
                  onChanged: (v) =>
                      _apply(prefs.copyWith(orderUpdates: v)),
                ),
                SettingsSwitchRow(
                  icon: Icons.local_offer_outlined,
                  title: 'Promotions & offers',
                  subtitle: 'Seasonal deals and new packages.',
                  value: prefs.promotions,
                  onChanged: (v) => _apply(prefs.copyWith(promotions: v)),
                ),
                SettingsSwitchRow(
                  icon: Icons.recommend_outlined,
                  title: 'Gabay suggestions',
                  subtitle: 'Personalised picks from your companion.',
                  value: prefs.gabaySuggestions,
                  onChanged: (v) =>
                      _apply(prefs.copyWith(gabaySuggestions: v)),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          FadeSlideIn(
            delay: _d(120),
            child: SettingsSection(
              title: 'PREFERENCES',
              rows: [
                SettingsSwitchRow(
                  icon: Icons.eco_outlined,
                  title: 'Healthier suggestions first',
                  subtitle: 'Let Gabay favour lighter, nutritious dishes.',
                  value: prefs.healthierFirst,
                  onChanged: (v) => _apply(prefs.copyWith(healthierFirst: v)),
                ),
                SettingsNavRow(
                  icon: Icons.restaurant_outlined,
                  title: 'Dietary preference',
                  // In the subtitle rather than trailing: the summary can run
                  // to "Vegetarian · avoiding 3 allergens", which would fight
                  // the title for a narrow row.
                  subtitle: prefs.dietarySummary,
                  onTap: () => _push(const DietaryPreferencePage()),
                ),
                SettingsNavRow(
                  icon: Icons.language_outlined,
                  title: 'Language',
                  trailing: prefs.language.label,
                  onTap: () => _push(const LanguagePage()),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          FadeSlideIn(
            delay: _d(200),
            child: SettingsSection(
              title: 'SUPPORT',
              rows: [
                SettingsNavRow(
                  icon: Icons.help_outline,
                  title: 'Help & FAQ',
                  onTap: () => _push(const HelpFaqPage()),
                ),
                SettingsNavRow(
                  icon: Icons.chat_bubble_outline,
                  title: 'Contact us',
                  onTap: () => _push(const ContactUsPage()),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          FadeSlideIn(
            delay: _d(280),
            child: SettingsSection(
              title: 'ABOUT',
              rows: [
                SettingsNavRow(
                  icon: Icons.info_outline,
                  title: 'About Hapag Pamana',
                  onTap: () => _push(const SettingsAboutPage()),
                ),
                SettingsNavRow(
                  icon: Icons.privacy_tip_outlined,
                  title: 'Privacy Policy',
                  onTap: () => _push(const PrivacyPolicyPage()),
                ),
                SettingsNavRow(
                  icon: Icons.description_outlined,
                  title: 'Terms of Service',
                  onTap: () => _push(const TermsOfServicePage()),
                ),
                const SettingsInfoRow(
                  icon: Icons.tag_outlined,
                  title: 'App version',
                  value: kAppVersion,
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          FadeSlideIn(
            delay: _d(360),
            child: AppButton.secondary(
              label: 'LOG OUT',
              icon: Icons.logout,
              fullWidth: true,
              onPressed: widget.onLogout,
            ),
          ),
        ],
      ),
    );
  }
}
