import 'package:flutter/material.dart';

import '../brand.dart';
import '../widgets.dart';

/// Full-screen "temporarily closed" notice, shown in place of the whole app
/// while the dashboard's Maintenance-mode switch is on ([AppSettings]).
///
/// Styled as a card left on the table: the brand emblem over the shared
/// parchment weave, an engraved kicker, and a short serif farewell — the same
/// editorial voice as the Home hero, so being closed still reads as
/// hospitality rather than an error state. The switch is live: when the
/// moderator turns it off, the shells rebuild and the app returns on its own.
class MaintenanceNotice extends StatelessWidget {
  const MaintenanceNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          SafeArea(
            child: Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.xxl,
                  vertical: AppSpacing.xxxl,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FadeSlideIn(
                      child: Image.asset(AppAssets.logo, height: 96),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    // Gold rule between emblem and word, like a menu divider.
                    FadeSlideIn(
                      delay: const Duration(milliseconds: 60),
                      child: Container(
                        width: 56,
                        height: 1,
                        color: AppColors.gold.withValues(alpha: 0.6),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),
                    FadeSlideIn(
                      delay: const Duration(milliseconds: 110),
                      child: Text(
                        'TEMPORARILY CLOSED',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.engraved(
                          size: 11,
                          color: AppColors.goldDeep,
                          spacing: 3,
                        ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    FadeSlideIn(
                      delay: const Duration(milliseconds: 160),
                      child: Text(
                        'The hapag rests,\nbut not for long.',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.display,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    FadeSlideIn(
                      delay: const Duration(milliseconds: 210),
                      child: Text(
                        'We’re taking a short pause. Please check back '
                        'soon — the table will be set again shortly.',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.body,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
