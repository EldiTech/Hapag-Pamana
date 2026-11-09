import 'dart:async';
import 'package:flutter/material.dart';

import '../../core/theme/app_assets.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_motion.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_text_styles.dart';
import '../../core/widgets/app_shared.dart';
import '../../data/customer_repository.dart';
import 'welcome_hapag_page.dart';

/// Full-screen branded loading transition shown while creating a customer account.
///
/// Features animated pulsing hospitality rings, breathing Hapag Pamana crest,
/// and sequential Filipino hospitality status messages, then transitions
/// smoothly into the full-screen [WelcomeHapagPage].
class AccountCreationLoadingPage extends StatefulWidget {
  const AccountCreationLoadingPage({
    super.key,
    required this.name,
    required this.email,
    required this.phone,
    required this.password,
  });

  final String name;
  final String email;
  final String phone;
  final String password;

  @override
  State<AccountCreationLoadingPage> createState() =>
      _AccountCreationLoadingPageState();
}

class _AccountCreationLoadingPageState
    extends State<AccountCreationLoadingPage>
    with TickerProviderStateMixin {
  late final AnimationController _pulseController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2200),
  )..repeat();

  late final AnimationController _spinController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 3200),
  )..repeat();

  Timer? _messageTimer;
  Timer? _dotsTimer;

  int _messageIndex = 0;
  int _dotCount = 1;

  static const List<String> _stages = [
    'Inihahanda ang iyong sariling upuan sa hapag...',
    'Inililista ang iyong mga detalye at kagustuhan...',
    'Kinukumpirma ang iyong rehistrasyon...',
    'Halos handa na, binubuksan ang pinto ng pamana...',
  ];

  @override
  void initState() {
    super.initState();
    _messageTimer = Timer.periodic(const Duration(milliseconds: 2200), (_) {
      if (mounted) {
        setState(() {
          _messageIndex = (_messageIndex + 1) % _stages.length;
        });
      }
    });

    _dotsTimer = Timer.periodic(const Duration(milliseconds: 450), (_) {
      if (mounted) {
        setState(() {
          _dotCount = (_dotCount % 3) + 1;
        });
      }
    });

    _performSignUp();
  }

  @override
  void dispose() {
    _messageTimer?.cancel();
    _dotsTimer?.cancel();
    _pulseController.dispose();
    _spinController.dispose();
    super.dispose();
  }

  Future<void> _performSignUp() async {
    // Keep the loading screen visible for a minimum polished window (1.4s)
    // so effects register gracefully even on fast network responses.
    final minDelay = Future<void>.delayed(const Duration(milliseconds: 1400));

    try {
      final signUpFuture = CustomerRepository().signUp(
        name: widget.name,
        email: widget.email,
        phone: widget.phone,
        password: widget.password,
      );

      await Future.wait([signUpFuture, minDelay]);

      if (!mounted) return;

      // Successfully created — transition smoothly into the full-screen Welcome screen.
      Navigator.of(context).pushReplacement(
        PageRouteBuilder<void>(
          transitionDuration: const Duration(milliseconds: 700),
          reverseTransitionDuration: Motion.base,
          pageBuilder: (_, _, _) => WelcomeHapagPage(name: widget.name),
          transitionsBuilder: (_, animation, secondaryAnimation, child) {
            final enter = CurvedAnimation(
              parent: animation,
              curve: Curves.easeOutCubic,
            );
            final leave = CurvedAnimation(
              parent: secondaryAnimation,
              curve: Curves.easeInCubic,
            );
            return FadeTransition(
              opacity: enter,
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.96, end: 1.0).animate(enter),
                child: FadeTransition(
                  opacity: Tween<double>(begin: 1.0, end: 0.0).animate(leave),
                  child: child,
                ),
              ),
            );
          },
        ),
      );
    } catch (error) {
      if (!mounted) return;
      // Pop back to SignUpPage with the exception so errors can be surfaced on fields
      Navigator.of(context).pop(error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final dots = '.' * _dotCount;

    return PopScope(
      canPop: false, // Prevent accidental dismissal during creation
      child: Scaffold(
        backgroundColor: AppColors.cream,
        body: Stack(
          children: [
            const ParchmentBackground(weave: true),
            SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.screen,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Animated pulsing rings + brand crest
                      SizedBox(
                        width: 200,
                        height: 200,
                        child: AnimatedBuilder(
                          animation: _pulseController,
                          builder: (context, _) {
                            final t1 = _pulseController.value;
                            final t2 = (t1 + 0.5) % 1.0;

                            return Stack(
                              alignment: Alignment.center,
                              children: [
                                // Outer wave 1
                                Container(
                                  width: 90 + (t1 * 100),
                                  height: 90 + (t1 * 100),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: AppColors.gold.withValues(
                                        alpha: (1.0 - t1) * 0.45,
                                      ),
                                      width: 2,
                                    ),
                                  ),
                                ),
                                // Outer wave 2
                                Container(
                                  width: 90 + (t2 * 90),
                                  height: 90 + (t2 * 90),
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(
                                      color: AppColors.goldDeep.withValues(
                                        alpha: (1.0 - t2) * 0.35,
                                      ),
                                      width: 1.5,
                                    ),
                                  ),
                                ),
                                // Rotating halo
                                RotationTransition(
                                  turns: _spinController,
                                  child: Container(
                                    width: 116,
                                    height: 116,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                        color: AppColors.gold.withValues(
                                          alpha: 0.35,
                                        ),
                                        width: 1.5,
                                      ),
                                    ),
                                  ),
                                ),
                                // Center branded badge
                                Container(
                                  width: 88,
                                  height: 88,
                                  padding: const EdgeInsets.all(AppSpacing.md),
                                  decoration: BoxDecoration(
                                    color: AppColors.surface,
                                    shape: BoxShape.circle,
                                    boxShadow: [
                                      BoxShadow(
                                        color: AppColors.brown.withValues(
                                          alpha: 0.08,
                                        ),
                                        blurRadius: 18,
                                        offset: const Offset(0, 6),
                                      ),
                                      BoxShadow(
                                        color: AppColors.gold.withValues(
                                          alpha: 0.15,
                                        ),
                                        blurRadius: 24,
                                        spreadRadius: 2,
                                      ),
                                    ],
                                    border: Border.all(
                                      color: AppColors.gold.withValues(
                                        alpha: 0.4,
                                      ),
                                      width: 1.5,
                                    ),
                                  ),
                                  child: Center(
                                    child: Hero(
                                      tag: AppAssets.logoHeroTag,
                                      child: Image.asset(
                                        AppAssets.logo,
                                        fit: BoxFit.contain,
                                        errorBuilder:
                                            (context, error, stackTrace) =>
                                                const Icon(
                                                  Icons.restaurant_rounded,
                                                  color: AppColors.goldDeep,
                                                  size: 38,
                                                ),
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xl),

                      // Brand Eyebrow
                      Text(
                        'HAPAG PAMANA',
                        style: AppTextStyles.eyebrow.copyWith(
                          color: AppColors.goldDeep,
                          letterSpacing: 2.2,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.sm),

                      // Main Title with animated trailing dots
                      Text(
                        'Creating account, please wait$dots',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.title.copyWith(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.brown,
                        ),
                      ),
                      const SizedBox(height: AppSpacing.md),

                      // Stage description with smooth cross-fade
                      SizedBox(
                        height: 38,
                        child: AnimatedSwitcher(
                          duration: Motion.base,
                          switchInCurve: Motion.standard,
                          switchOutCurve: Motion.exit,
                          child: Text(
                            _stages[_messageIndex],
                            key: ValueKey<int>(_messageIndex),
                            textAlign: TextAlign.center,
                            style: AppTextStyles.bodySmall.copyWith(
                              color: AppColors.brownSoft,
                              height: 1.4,
                              fontStyle: FontStyle.italic,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),

                      // Subtle progress track
                      Container(
                        width: 130,
                        height: 3,
                        decoration: BoxDecoration(
                          color: AppColors.hairline,
                          borderRadius: AppRadius.pillAll,
                        ),
                        child: ClipRRect(
                          borderRadius: AppRadius.pillAll,
                          child: const LinearProgressIndicator(
                            backgroundColor: Colors.transparent,
                            valueColor: AlwaysStoppedAnimation<Color>(
                              AppColors.goldDeep,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
