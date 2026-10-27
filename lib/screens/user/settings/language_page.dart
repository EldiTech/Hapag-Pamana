import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../data/member_preferences.dart';
import '../../../widgets.dart';
import 'settings_widgets.dart';

/// "Language" — which language the app runs in.
///
/// The choice is saved to the member's profile and drives [MaterialApp.locale]
/// (see `main.dart`), so everything Flutter itself supplies changes over at
/// once: the date and time pickers the booking wizards open, dialog buttons,
/// the text-selection menu, and how dates are formatted.
///
/// Hapag Pamana's own writing — these screens, the dish names, the package copy
/// — is still English while it's being translated, and [_TranslationNote] says
/// so plainly rather than letting the switch over-promise.
class LanguagePage extends StatefulWidget {
  const LanguagePage({super.key});

  @override
  State<LanguagePage> createState() => _LanguagePageState();
}

class _LanguagePageState extends State<LanguagePage> {
  Duration _d(int ms) => Duration(milliseconds: ms);

  Future<void> _choose(MemberPreferences prefs, AppLanguage language) async {
    final saved =
        await MemberPreferencesScope.save(prefs.copyWith(language: language));
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            saved
                ? 'Language set to ${language.label}.'
                : "Couldn't save that — check your connection.",
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<MemberPreferences>(
      valueListenable: MemberPreferencesScope.notifier,
      builder: (context, prefs, _) => SettingsScaffold(
        title: 'Language',
        children: [
          FadeSlideIn(
            child: const SettingsLede(
              title: 'Choose your language',
              body: 'Your choice is saved to your profile, so it follows you '
                  'to any phone you sign in on.',
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          FadeSlideIn(
            delay: _d(60),
            child: SettingsSection(
              title: 'LANGUAGE',
              rows: [
                for (final language in AppLanguage.values)
                  SettingsChoiceRow(
                    title: language.label,
                    subtitle: language.blurb,
                    selected: prefs.language == language,
                    onTap: () => _choose(prefs, language),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),

          FadeSlideIn(delay: _d(120), child: const _TranslationNote()),
        ],
      ),
    );
  }
}

/// What switching language does today, said outright — the calendars, buttons
/// and dates the phone supplies turn over immediately; the kitchen's own words
/// are still on their way.
class _TranslationNote extends StatelessWidget {
  const _TranslationNote();

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
            Icons.translate_outlined,
            size: 18,
            color: AppColors.goldDeep,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('WHAT CHANGES TODAY', style: AppTextStyles.eyebrow),
                const SizedBox(height: 6),
                Text(
                  'Filipino turns over the date and time pickers, the dialog '
                  'buttons and the way dates are written. Our own writing — '
                  'these screens, the dish names and the package details — is '
                  'still in English while we translate it.',
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
