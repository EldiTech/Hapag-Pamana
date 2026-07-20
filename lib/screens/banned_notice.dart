import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/widgets/app_widgets.dart';
import '../widgets.dart';

/// Full-screen "account suspended" notice, shown in place of the member shell
/// the moment the dashboard bans the signed-in account (the shell has already
/// signed them out by the time this appears).
///
/// Same card-on-the-table language as [MaintenanceNotice] — emblem, gold rule,
/// engraved kicker, serif line — so even a suspension keeps the brand's
/// hospitable voice. [onLeave] returns the person to the guest side.
class BannedNotice extends StatelessWidget {
  const BannedNotice({super.key, required this.onLeave});

  final VoidCallback onLeave;

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
                        'ACCOUNT SUSPENDED',
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
                        'This seat is on hold.',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.display,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    FadeSlideIn(
                      delay: const Duration(milliseconds: 210),
                      child: Text(
                        'Your account has been suspended by the Fill at Home '
                        'team, so we’ve signed you out. If you believe '
                        'this is a mistake, please reach out to us and '
                        'we’ll make it right.',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.body,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xxl),
                    FadeSlideIn(
                      delay: const Duration(milliseconds: 260),
                      child: AppButton.secondary(
                        label: 'CONTINUE AS GUEST',
                        fullWidth: true,
                        onPressed: onLeave,
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
