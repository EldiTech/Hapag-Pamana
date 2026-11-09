import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme/app_assets.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_motion.dart';
import '../../core/theme/app_radius.dart';
import '../../core/theme/app_spacing.dart';
import '../../core/theme/app_text_styles.dart';
import '../../core/widgets/app_shared.dart';
import 'taste_profile_page.dart';

/// Full-screen celebratory Welcome Screen shown right after account creation.
///
/// Replaces any bottom snackbar/popup with a dedicated, ceremonial welcome
/// screen ("Welcome to the hapag, [Name]!") that plays a smooth choreographed
/// entrance and then transitions seamlessly into [TasteProfilePage] (with the
/// brand crest flying via [Hero] into the quiz header).
class WelcomeHapagPage extends StatefulWidget {
  const WelcomeHapagPage({super.key, required this.name});

  final String name;

  @override
  State<WelcomeHapagPage> createState() => _WelcomeHapagPageState();
}

class _WelcomeHapagPageState extends State<WelcomeHapagPage>
    with TickerProviderStateMixin {
  static const Duration _autoAdvanceDelay = Duration(milliseconds: 3000);

  late final AnimationController _introController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1650),
  );

  late final AnimationController _ambientController = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 4200),
  )..repeat();

  late final AnimationController _progressController = AnimationController(
    vsync: this,
    duration: _autoAdvanceDelay,
  );

  // Staggered choreographed intervals
  late final Animation<double> _crestFade = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.00, 0.45, curve: Curves.easeOutCubic),
  );
  late final Animation<double> _crestScale = Tween<double>(
    begin: 0.84,
    end: 1.0,
  ).animate(_crestFade);

  late final Animation<double> _badgeScale = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.24, 0.62, curve: Curves.easeOutBack),
  );

  late final Animation<double> _eyebrowAnim = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.20, 0.58, curve: Curves.easeOutCubic),
  );

  late final Animation<double> _titleAnim = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.32, 0.74, curve: Curves.easeOutCubic),
  );

  late final Animation<double> _ornamentAnim = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.46, 0.84, curve: Curves.easeOutCubic),
  );

  late final Animation<double> _subtitleAnim = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.56, 0.92, curve: Curves.easeOutCubic),
  );

  late final Animation<double> _footerAnim = CurvedAnimation(
    parent: _introController,
    curve: const Interval(0.72, 1.00, curve: Curves.easeOut),
  );

  Timer? _advanceTimer;
  bool _navigated = false;

  @override
  void initState() {
    super.initState();
    _introController.forward();
    _progressController.forward();
    _advanceTimer = Timer(_autoAdvanceDelay, _proceed);
  }

  void _proceed() {
    if (_navigated || !mounted) return;
    _navigated = true;
    _advanceTimer?.cancel();

    Navigator.of(context).pushAndRemoveUntil(
      PageRouteBuilder<void>(
        transitionDuration: const Duration(milliseconds: 820),
        reverseTransitionDuration: Motion.base,
        pageBuilder: (_, _, _) => TasteProfilePage(name: widget.name),
        transitionsBuilder: (_, animation, secondaryAnimation, child) {
          final enter = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
          );
          final leave = CurvedAnimation(
            parent: secondaryAnimation,
            curve: Curves.easeInOutCubic,
          );

          return FadeTransition(
            opacity: enter,
            child: SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(0, 0.035),
                end: Offset.zero,
              ).animate(enter),
              child: ScaleTransition(
                scale: Tween<double>(begin: 0.97, end: 1.0).animate(enter),
                child: FadeTransition(
                  opacity: Tween<double>(begin: 1.0, end: 0.0).animate(leave),
                  child: ScaleTransition(
                    scale: Tween<double>(begin: 1.0, end: 1.03).animate(leave),
                    child: child,
                  ),
                ),
              ),
            ),
          );
        },
      ),
      (route) => route.isFirst,
    );
  }

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _introController.dispose();
    _ambientController.dispose();
    _progressController.dispose();
    super.dispose();
  }

  Widget _staggerSlide({
    required Animation<double> animation,
    required Widget child,
    double offsetY = 18,
  }) {
    final disable = MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    if (disable) return child;

    return AnimatedBuilder(
      animation: animation,
      builder: (context, _) => Opacity(
        opacity: animation.value.clamp(0.0, 1.0),
        child: Transform.translate(
          offset: Offset(0, (1.0 - animation.value) * offsetY),
          child: child,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final trimmed = widget.name.trim();
    final displayName = trimmed.isEmpty ? 'Kaibigan' : trimmed;
    final disable = MediaQuery.maybeOf(context)?.disableAnimations ?? false;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _proceed();
      },
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: _proceed,
        child: Scaffold(
          backgroundColor: AppColors.cream,
          body: Stack(
            children: [
              const ParchmentBackground(weave: true),

              // Warm ambient golden particles drifting gently upward
              if (!disable)
                Positioned.fill(
                  child: RepaintBoundary(
                    child: AnimatedBuilder(
                      animation: _ambientController,
                      builder: (context, _) => CustomPaint(
                        painter: _CelebrationMotesPainter(
                          progress: _ambientController.value,
                          fade: _crestFade.value,
                        ),
                      ),
                    ),
                  ),
                ),

              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.xxl,
                  ),
                  child: Column(
                    children: [
                      const Spacer(flex: 3),

                      // ── Central Heirloom Medallion + Hero Logo ─────────────
                      FadeTransition(
                        opacity: _crestFade,
                        child: ScaleTransition(
                          scale: _crestScale,
                          child: SizedBox(
                            width: 196,
                            height: 196,
                            child: AnimatedBuilder(
                              animation: _ambientController,
                              builder: (context, child) {
                                final pulse =
                                    0.5 +
                                    0.5 *
                                        math.sin(
                                          _ambientController.value *
                                              2 *
                                              math.pi,
                                        );
                                return Stack(
                                  alignment: Alignment.center,
                                  children: [
                                    // Soft radial golden glow
                                    Container(
                                      width: 176 + (pulse * 14),
                                      height: 176 + (pulse * 14),
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        gradient: RadialGradient(
                                          colors: [
                                            AppColors.gold.withValues(
                                              alpha: 0.22 + (pulse * 0.08),
                                            ),
                                            AppColors.cream.withValues(
                                              alpha: 0.0,
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                    // Outer heirloom ring
                                    Container(
                                      width: 146 + (pulse * 6),
                                      height: 146 + (pulse * 6),
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: AppColors.gold.withValues(
                                            alpha: 0.28,
                                          ),
                                          width: 1.2,
                                        ),
                                      ),
                                    ),
                                    // Inner decorative ring
                                    Container(
                                      width: 126,
                                      height: 126,
                                      decoration: BoxDecoration(
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: AppColors.goldDeep.withValues(
                                            alpha: 0.22,
                                          ),
                                          width: 1,
                                        ),
                                      ),
                                    ),
                                    ?child,
                                  ],
                                );
                              },
                              child: Stack(
                                alignment: Alignment.center,
                                clipBehavior: Clip.none,
                                children: [
                                  // Main parchment medallion
                                  Container(
                                    width: 108,
                                    height: 108,
                                    padding: const EdgeInsets.all(
                                      AppSpacing.md + 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: AppColors.surface,
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                        color: AppColors.gold,
                                        width: 1.8,
                                      ),
                                      boxShadow: [
                                        BoxShadow(
                                          color: AppColors.brown.withValues(
                                            alpha: 0.09,
                                          ),
                                          blurRadius: 22,
                                          offset: const Offset(0, 8),
                                        ),
                                        BoxShadow(
                                          color: AppColors.gold.withValues(
                                            alpha: 0.22,
                                          ),
                                          blurRadius: 28,
                                          spreadRadius: 2,
                                        ),
                                      ],
                                    ),
                                    child: Center(
                                      child: Hero(
                                        tag: AppAssets.logoHeroTag,
                                        child: Image.asset(
                                          AppAssets.logo,
                                          fit: BoxFit.contain,
                                        ),
                                      ),
                                    ),
                                  ),
                                  // Celebratory checkmark seal
                                  Positioned(
                                    bottom: 2,
                                    right: 2,
                                    child: ScaleTransition(
                                      scale: _badgeScale,
                                      child: Container(
                                        width: 32,
                                        height: 32,
                                        decoration: BoxDecoration(
                                          color: AppColors.brown,
                                          shape: BoxShape.circle,
                                          border: Border.all(
                                            color: AppColors.gold,
                                            width: 1.8,
                                          ),
                                          boxShadow: const [
                                            BoxShadow(
                                              color: AppColors.shadow,
                                              blurRadius: 8,
                                              offset: Offset(0, 3),
                                            ),
                                          ],
                                        ),
                                        child: const Icon(
                                          Icons.check_rounded,
                                          size: 18,
                                          color: AppColors.cream,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.xl),

                      // ── Engraved Eyebrow Pill ──────────────────────────────
                      _staggerSlide(
                        animation: _eyebrowAnim,
                        offsetY: 14,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.gold.withValues(alpha: 0.14),
                            borderRadius: AppRadius.pillAll,
                            border: Border.all(
                              color: AppColors.gold.withValues(alpha: 0.4),
                            ),
                          ),
                          child: Text(
                            'MALIGAYANG PAGDATING',
                            style: AppTextStyles.engraved(
                              size: 10.5,
                              color: AppColors.goldDeep,
                              spacing: 2.2,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),

                      // ── Main Display Greeting ──────────────────────────────
                      _staggerSlide(
                        animation: _titleAnim,
                        offsetY: 20,
                        child: Text(
                          'Welcome to the hapag,\n$displayName!',
                          textAlign: TextAlign.center,
                          style: AppTextStyles.display.copyWith(
                            fontSize: 30,
                            height: 1.18,
                            color: AppColors.brown,
                          ),
                        ),
                      ),
                      const SizedBox(height: AppSpacing.lg),

                      // ── Expanding Golden Ornament ──────────────────────────
                      AnimatedBuilder(
                        animation: _ornamentAnim,
                        builder: (context, _) {
                          final v = disable ? 1.0 : _ornamentAnim.value;
                          return Opacity(
                            opacity: v.clamp(0.0, 1.0),
                            child: _ExpandingGoldOrnament(progress: v),
                          );
                        },
                      ),
                      const SizedBox(height: AppSpacing.lg),

                      // ── Warm Editorial Subtitle ────────────────────────────
                      _staggerSlide(
                        animation: _subtitleAnim,
                        offsetY: 16,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.md,
                          ),
                          child: Text(
                            'Handa na ang iyong sariling upuan sa hapag.\n'
                            'Let\'s tailor the kitchen to your taste.',
                            textAlign: TextAlign.center,
                            style: AppTextStyles.body.copyWith(
                              fontSize: 14,
                              height: 1.55,
                              color: AppColors.brownSoft,
                            ),
                          ),
                        ),
                      ),

                      const Spacer(flex: 4),

                      // ── Smooth Progress & Continue Cue ─────────────────────
                      _staggerSlide(
                        animation: _footerAnim,
                        offsetY: 12,
                        child: Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.xl),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Smoothly filling golden progress bar
                              SizedBox(
                                width: 140,
                                height: 3,
                                child: ClipRRect(
                                  borderRadius: AppRadius.pillAll,
                                  child: AnimatedBuilder(
                                    animation: _progressController,
                                    builder: (context, _) =>
                                        LinearProgressIndicator(
                                          value: disable
                                              ? 1.0
                                              : _progressController.value,
                                          backgroundColor: AppColors.hairline,
                                          valueColor:
                                              const AlwaysStoppedAnimation<
                                                Color
                                              >(AppColors.gold),
                                        ),
                                  ),
                                ),
                              ),
                              const SizedBox(height: AppSpacing.md),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    'PREPARING YOUR TABLE',
                                    style: AppTextStyles.engraved(
                                      size: 9.5,
                                      color: AppColors.goldDeep,
                                      spacing: 2.0,
                                    ),
                                  ),
                                  const SizedBox(width: 6),
                                  const Icon(
                                    Icons.arrow_forward_rounded,
                                    size: 13,
                                    color: AppColors.goldDeep,
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Ornamental gold rule with a center diamond that draws outward as [progress]
/// goes from `0.0` to `1.0`.
class _ExpandingGoldOrnament extends StatelessWidget {
  const _ExpandingGoldOrnament({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    final lineWidth = 64.0 * progress;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: lineWidth,
          height: 1,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppColors.gold.withValues(alpha: 0.0),
                AppColors.gold.withValues(alpha: 0.75),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Transform.rotate(
            angle: math.pi / 4,
            child: Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: AppColors.gold,
                borderRadius: BorderRadius.circular(1),
              ),
            ),
          ),
        ),
        Container(
          width: lineWidth,
          height: 1,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppColors.gold.withValues(alpha: 0.75),
                AppColors.gold.withValues(alpha: 0.0),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Soft golden celebration motes that drift gently across the parchment.
class _CelebrationMotesPainter extends CustomPainter {
  const _CelebrationMotesPainter({
    required this.progress,
    required this.fade,
  });

  final double progress;
  final double fade;

  static final List<_Mote> _motes = List.generate(22, (index) {
    final rand = math.Random(index * 41 + 7);
    return _Mote(
      x: rand.nextDouble(),
      yOffset: rand.nextDouble(),
      speed: 0.35 + rand.nextDouble() * 0.55,
      size: 2.5 + rand.nextDouble() * 3.5,
      isDiamond: index.isEven,
      color: index % 3 == 0 ? AppColors.goldDeep : AppColors.gold,
    );
  });

  @override
  void paint(Canvas canvas, Size size) {
    if (fade <= 0) return;

    for (final mote in _motes) {
      // Drift gently upward with a soft horizontal sway
      final cycle = (1.0 - ((progress * mote.speed + mote.yOffset) % 1.0));
      final y = cycle * size.height;
      final x =
          (mote.x * size.width) +
          math.sin(progress * 2 * math.pi + mote.yOffset * 6) * 14;

      // Fade in at bottom, fade out near top
      final edgeAlpha = math.sin(cycle * math.pi).clamp(0.0, 1.0);
      final paint = Paint()
        ..color = mote.color.withValues(alpha: 0.32 * edgeAlpha * fade)
        ..style = PaintingStyle.fill;

      canvas.save();
      canvas.translate(x, y);
      if (mote.isDiamond) {
        canvas.rotate(math.pi / 4 + progress * math.pi);
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromCenter(
              center: Offset.zero,
              width: mote.size,
              height: mote.size,
            ),
            const Radius.circular(1),
          ),
          paint,
        );
      } else {
        canvas.drawCircle(Offset.zero, mote.size * 0.5, paint);
      }
      canvas.restore();
    }
  }

  @override
  bool shouldRepaint(covariant _CelebrationMotesPainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.fade != fade;
}

class _Mote {
  const _Mote({
    required this.x,
    required this.yOffset,
    required this.speed,
    required this.size,
    required this.isDiamond,
    required this.color,
  });

  final double x;
  final double yOffset;
  final double speed;
  final double size;
  final bool isDiamond;
  final Color color;
}
