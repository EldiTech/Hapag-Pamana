import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../core/app_info.dart';
import '../../../core/external_link.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../data/customer_repository.dart';
import '../../../widgets.dart';
import 'settings_widgets.dart';

/// "Contact us" — every way to reach the kitchen, and all of them live.
///
/// Each row hands the device a real link ([openExternalLink]): the dialer, the
/// mail app, Google Maps, the social pages. When nothing on the phone can take
/// one, the value is copied to the clipboard and the member is told — so a row
/// never dead-ends.
///
/// The e-mail row goes further and pre-fills the message with who's writing
/// (from the signed-in account) and the app version, which is what turns "the
/// app did something odd" into a report the team can actually act on.
class ContactUsPage extends StatelessWidget {
  const ContactUsPage({super.key});

  // The published details, the same ones the About story carries.
  static const String _phoneDisplay = '0917 123 4567';
  static const String _phoneDial = '+639171234567';
  static const String _phonePlain = '09171234567';
  static const String _email = 'hello@fillathome.ph';
  static const String _mapsQuery =
      'https://www.google.com/maps/search/?api=1&query=Fill+at+Home+Catering';

  static const List<(IconData, String, String)> _socials = [
    (Icons.facebook, 'Facebook', 'https://www.facebook.com/fillathome'),
    (
      Icons.photo_camera_outlined,
      'Instagram',
      'https://www.instagram.com/fillathome',
    ),
    (Icons.music_note_outlined, 'TikTok', 'https://www.tiktok.com/@fillathome'),
  ];

  /// A `mailto:` with the subject and sign-off already written. The member's
  /// name and address come from the auth record (no Firestore read), and the
  /// version is stamped in so a bug report arrives with its build attached.
  static Uri _supportMail() {
    final repo = CustomerRepository();
    final name = (repo.displayName ?? '').trim();
    final email = (repo.email ?? '').trim();
    final signature = [
      if (name.isNotEmpty) name,
      if (email.isNotEmpty) email,
      'Hapag Pamana app v$kAppVersion',
    ].join('\n');

    return Uri(
      scheme: 'mailto',
      path: _email,
      queryParameters: {
        'subject': 'Hapag Pamana app — I need a hand',
        'body': '\n\n—\n$signature',
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    Duration d(int ms) => Duration(milliseconds: ms);

    return SettingsScaffold(
      title: 'Contact us',
      children: [
        FadeSlideIn(
          child: const SettingsLede(
            title: 'Let\'s talk',
            body: 'Call, message or write — whichever suits you. Someone from '
                'the family is always around during kitchen hours.',
          ),
        ),
        const SizedBox(height: AppSpacing.xl),

        FadeSlideIn(
          delay: d(60),
          child: SettingsSection(
            title: 'REACH US',
            rows: [
              SettingsLinkRow(
                icon: Icons.phone_outlined,
                label: 'CALL OR TEXT',
                value: _phoneDisplay,
                onTap: () => openExternalLink(
                  context,
                  Uri.parse('tel:$_phoneDial'),
                  copyValue: _phonePlain,
                  copiedWhat: 'Phone number',
                ),
              ),
              SettingsLinkRow(
                icon: Icons.mail_outline,
                label: 'E-MAIL US',
                value: _email,
                onTap: () => openExternalLink(
                  context,
                  _supportMail(),
                  copyValue: _email,
                  copiedWhat: 'E-mail address',
                ),
              ),
              const SettingsLinkRow(
                icon: Icons.access_time,
                label: 'KITCHEN HOURS',
                value: 'Monday – Sunday · 8:00 AM – 8:00 PM',
              ),
              SettingsLinkRow(
                icon: Icons.location_on_outlined,
                label: 'FIND US',
                value: 'The Kitchen · Metro Manila, Philippines',
                onTap: () => openExternalLink(
                  context,
                  Uri.parse(_mapsQuery),
                  copyValue: 'Fill at Home Catering, Metro Manila',
                  copiedWhat: 'Our address',
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),

        FadeSlideIn(
          delay: d(120),
          child: Padding(
            padding: const EdgeInsets.only(left: 4, bottom: AppSpacing.sm + 2),
            child: Text('FOLLOW US', style: AppTextStyles.eyebrow),
          ),
        ),
        FadeSlideIn(
          delay: d(150),
          child: Wrap(
            spacing: AppSpacing.sm + 2,
            runSpacing: AppSpacing.sm + 2,
            children: [
              for (final (icon, label, url) in _socials)
                _SocialPill(
                  icon: icon,
                  label: label,
                  onTap: () => openExternalLink(
                    context,
                    Uri.parse(url),
                    copyValue: url,
                    copiedWhat: '$label link',
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xl),

        FadeSlideIn(delay: d(210), child: const _OrderNote()),
      ],
    );
  }
}

/// One social page as a labelled pill — a named destination rather than a bare
/// glyph, so it's clear where the tap goes.
class _SocialPill extends StatelessWidget {
  const _SocialPill({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: AppColors.goldDeep),
            const SizedBox(width: AppSpacing.sm),
            Text(
              label,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                spacing: 0.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// What to have to hand when the message is about an order — the reference
/// number saves the first two replies of every support thread.
class _OrderNote extends StatelessWidget {
  const _OrderNote();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.receipt_long_outlined,
            size: 18,
            color: AppColors.goldDeep,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('WRITING ABOUT AN ORDER?', style: AppTextStyles.eyebrow),
                const SizedBox(height: 6),
                Text(
                  'Have its number with you — you\'ll find it on the order in '
                  'Settings → Order tracking, printed as "NO. …" across the '
                  'top of the card. With that we can pull your event up right '
                  'away.',
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
