import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../data/announcement.dart';
import '../../widgets.dart';
import 'announcement_details_page.dart';

/// Heirloom editorial pop-up modal for single or multiple announcements, promos, and event bulletins.
/// Features an automatic swipeable carousel with timed auto-advance, backdrop blur, and interactive controls.
class AnnouncementPopupModal extends StatefulWidget {
  const AnnouncementPopupModal({
    super.key,
    required this.announcements,
    this.initialIndex = 0,
  });

  final List<Announcement> announcements;
  final int initialIndex;

  /// Singleton guard flag to ensure multiple dialogs never stack.
  static bool _isShowingDialog = false;

  /// Shows the announcement popup modal. If a popup is already active, this is ignored.
  static Future<void> show(
    BuildContext context, {
    required List<Announcement> announcements,
    int initialIndex = 0,
  }) async {
    if (_isShowingDialog || announcements.isEmpty || !context.mounted) return;
    _isShowingDialog = true;

    try {
      await showGeneralDialog<void>(
        context: context,
        barrierDismissible: true,
        barrierLabel: 'Announcement bulletin',
        barrierColor: AppColors.espresso.withValues(alpha: 0.65),
        transitionDuration: const Duration(milliseconds: 380),
        pageBuilder: (ctx, anim1, anim2) => AnnouncementPopupModal(
          announcements: announcements,
          initialIndex: initialIndex,
        ),
        transitionBuilder: (ctx, anim, secondaryAnim, child) {
          final curved = CurvedAnimation(
            parent: anim,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );

          return Stack(
            children: [
              // Glassmorphism Blur Backdrop
              Positioned.fill(
                child: BackdropFilter(
                  filter: ImageFilter.blur(
                    sigmaX: 8.0 * curved.value,
                    sigmaY: 8.0 * curved.value,
                  ),
                  child: const SizedBox.expand(),
                ),
              ),
              // Scaled + Slid + Faded Modal Card
              Center(
                child: SlideTransition(
                  position: Tween<Offset>(
                    begin: const Offset(0, 0.05),
                    end: Offset.zero,
                  ).animate(curved),
                  child: ScaleTransition(
                    scale: Tween<double>(begin: 0.90, end: 1.0).animate(curved),
                    child: FadeTransition(
                      opacity: curved,
                      child: child,
                    ),
                  ),
                ),
              ),
            ],
          );
        },
      );
    } finally {
      _isShowingDialog = false;
    }
  }

  /// Convenience method for showing a single announcement.
  static Future<void> showSingle(
    BuildContext context, {
    required Announcement announcement,
  }) =>
      show(context, announcements: [announcement]);

  @override
  State<AnnouncementPopupModal> createState() => _AnnouncementPopupModalState();
}

class _AnnouncementPopupModalState extends State<AnnouncementPopupModal>
    with SingleTickerProviderStateMixin {
  late final PageController _pageController;
  late int _currentIndex;
  Timer? _autoPlayTimer;
  bool _userInteracting = false;

  late final AnimationController _staggerController;
  late final Animation<double> _contentFade;
  late final Animation<Offset> _contentSlide;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex.clamp(0, widget.announcements.length - 1);
    _pageController = PageController(initialPage: _currentIndex);

    _staggerController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 450),
    );

    _contentFade = CurvedAnimation(
      parent: _staggerController,
      curve: const Interval(0.2, 1.0, curve: Curves.easeOut),
    );

    _contentSlide = Tween<Offset>(
      begin: const Offset(0, 0.08),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(
        parent: _staggerController,
        curve: const Interval(0.2, 1.0, curve: Curves.easeOutCubic),
      ),
    );

    _staggerController.forward();
    _startAutoPlay();
  }

  void _startAutoPlay() {
    _autoPlayTimer?.cancel();
    if (widget.announcements.length <= 1) return;

    _autoPlayTimer = Timer.periodic(const Duration(milliseconds: 4500), (_) {
      if (!mounted || _userInteracting || !_pageController.hasClients) return;
      final next = (_currentIndex + 1) % widget.announcements.length;
      _pageController.animateToPage(
        next,
        duration: const Duration(milliseconds: 550),
        curve: Curves.easeInOutCubic,
      );
    });
  }

  @override
  void dispose() {
    _autoPlayTimer?.cancel();
    _pageController.dispose();
    _staggerController.dispose();
    super.dispose();
  }

  void _nextPage() {
    if (_currentIndex < widget.announcements.length - 1) {
      _pageController.nextPage(
        duration: Motion.base,
        curve: Motion.standard,
      );
    } else {
      _pageController.animateToPage(
        0,
        duration: Motion.base,
        curve: Motion.standard,
      );
    }
  }

  void _prevPage() {
    if (_currentIndex > 0) {
      _pageController.previousPage(
        duration: Motion.base,
        curve: Motion.standard,
      );
    } else {
      _pageController.animateToPage(
        widget.announcements.length - 1,
        duration: Motion.base,
        curve: Motion.standard,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final list = widget.announcements;
    final count = list.length;
    final current = list[_currentIndex.clamp(0, count - 1)];
    final size = MediaQuery.sizeOf(context);
    final maxDialogWidth = size.width > 440 ? 390.0 : size.width - 32.0;

    return Material(
      color: Colors.transparent,
      child: Listener(
        onPointerDown: (_) => _userInteracting = true,
        onPointerUp: (_) {
          _userInteracting = false;
          _startAutoPlay();
        },
        child: Container(
          width: maxDialogWidth,
          constraints: BoxConstraints(
            maxHeight: size.height * 0.85,
          ),
          margin: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: AppColors.cream,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(
              color: current.isPromo
                  ? AppColors.gold.withValues(alpha: 0.55)
                  : AppColors.hairline,
              width: 1.5,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.espresso.withValues(alpha: 0.35),
                blurRadius: 36,
                spreadRadius: 2,
                offset: const Offset(0, 16),
              ),
            ],
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // ── Top Navigation Bar (Shown when multiple announcements) ───
              if (count > 1)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  color: AppColors.surface,
                  child: Row(
                    children: [
                      Text(
                        'ANNOUNCEMENTS',
                        style: AppTextStyles.engraved(
                          size: 9.5,
                          color: AppColors.brownSoft,
                          spacing: 1.2,
                        ),
                      ),
                      const Spacer(),
                      // Animated Count Badge
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.cream,
                          borderRadius: BorderRadius.circular(99),
                          border: Border.all(color: AppColors.hairline),
                        ),
                        child: Text(
                          '${_currentIndex + 1} of $count',
                          style: AppTextStyles.caption.copyWith(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: AppColors.brown,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Prev Button
                      InkWell(
                        onTap: _prevPage,
                        borderRadius: BorderRadius.circular(99),
                        child: const Padding(
                          padding: EdgeInsets.all(4),
                          child: Icon(
                            Icons.chevron_left,
                            size: 18,
                            color: AppColors.brown,
                          ),
                        ),
                      ),
                      // Next Button
                      InkWell(
                        onTap: _nextPage,
                        borderRadius: BorderRadius.circular(99),
                        child: const Padding(
                          padding: EdgeInsets.all(4),
                          child: Icon(
                            Icons.chevron_right,
                            size: 18,
                            color: AppColors.brown,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

              // ── Content Area: Single card hugs height, multi-card uses PageView ──
              if (count == 1)
                Flexible(
                  child: SingleChildScrollView(
                    child: _AnnouncementPageCard(
                      announcement: current,
                      fadeAnimation: _contentFade,
                      slideAnimation: _contentSlide,
                    ),
                  ),
                )
              else ...[
                Flexible(
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: count,
                    onPageChanged: (idx) {
                      setState(() => _currentIndex = idx);
                    },
                    itemBuilder: (ctx, index) {
                      return _AnnouncementPageCard(
                        announcement: list[index],
                        fadeAnimation: _contentFade,
                        slideAnimation: _contentSlide,
                      );
                    },
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: List.generate(count, (i) {
                    final isActive = i == _currentIndex;
                    return AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeOutCubic,
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      height: 5,
                      width: isActive ? 20 : 6,
                      decoration: BoxDecoration(
                        color: isActive
                            ? AppColors.brown
                            : AppColors.brown.withValues(alpha: 0.25),
                        borderRadius: BorderRadius.circular(99),
                      ),
                    );
                  }),
                ),
              ],

              // ── Footer Action Buttons ────────────────────────────────────
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screen,
                  AppSpacing.md,
                  AppSpacing.screen,
                  AppSpacing.md,
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: PressableScale(
                        onTap: () => Navigator.of(context).pop(),
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            border: Border.all(color: AppColors.hairline),
                          ),
                          child: Text(
                            count > 1 ? 'Dismiss All' : 'Dismiss',
                            style: AppTextStyles.sans(
                              size: 12,
                              weight: FontWeight.w600,
                              color: AppColors.brownSoft,
                            ),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: PressableScale(
                        onTap: () {
                          Navigator.of(context).pop();
                          Navigator.of(context).push(
                            AnnouncementDetailsPage.route(current),
                          );
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.brown,
                            borderRadius: BorderRadius.circular(AppRadius.sm),
                            boxShadow: const [
                              BoxShadow(
                                color: Color.fromRGBO(80, 52, 19, 0.25),
                                blurRadius: 8,
                                offset: Offset(0, 3),
                              ),
                            ],
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                'View Details',
                                style: AppTextStyles.sans(
                                  size: 12,
                                  weight: FontWeight.w600,
                                  color: AppColors.cream,
                                ),
                              ),
                              const SizedBox(width: 5),
                              const Icon(
                                Icons.arrow_forward,
                                size: 13,
                                color: AppColors.cream,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AnnouncementPageCard extends StatelessWidget {
  const _AnnouncementPageCard({
    required this.announcement,
    required this.fadeAnimation,
    required this.slideAnimation,
  });

  final Announcement announcement;
  final Animation<double> fadeAnimation;
  final Animation<Offset> slideAnimation;

  @override
  Widget build(BuildContext context) {
    final imageBytes = announcement.imageBytes;
    final isPromo = announcement.isPromo;

    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // ── Hero Banner Stack ────────────────────────────────────────────
          Stack(
            children: [
              if (announcement.hasImage)
                Container(
                  width: double.infinity,
                  constraints: const BoxConstraints(
                    maxHeight: 220,
                    minHeight: 140,
                  ),
                  color: AppColors.surface,
                  alignment: Alignment.center,
                  child: imageBytes != null
                      ? Image.memory(
                          imageBytes,
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) => _fallbackBanner(isPromo),
                        )
                      : Image.network(
                          announcement.imageUrl,
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) => _fallbackBanner(isPromo),
                        ),
                )
              else
                Container(
                  height: 100,
                  decoration: const BoxDecoration(
                    color: AppColors.creamEdge,
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        AppColors.surface,
                        AppColors.creamEdge,
                      ],
                    ),
                  ),
                  alignment: Alignment.center,
                  child: Icon(
                    isPromo ? Icons.local_offer_outlined : Icons.campaign_outlined,
                    size: 44,
                    color: AppColors.gold,
                  ),
                ),

              // Close Button (X)
              Positioned(
                top: 8,
                right: 8,
                child: Material(
                  color: AppColors.surface.withValues(alpha: 0.90),
                  shape: const CircleBorder(),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => Navigator.of(context).pop(),
                    child: const Padding(
                      padding: EdgeInsets.all(6),
                      child: Icon(
                        Icons.close,
                        size: 15,
                        color: AppColors.brown,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),

          // ── Staggered Body Content ───────────────────────────────────────
          FadeTransition(
            opacity: fadeAnimation,
            child: SlideTransition(
              position: slideAnimation,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screen,
                  AppSpacing.md,
                  AppSpacing.screen,
                  AppSpacing.xs,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Eyebrow Tag + Date Row
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3.5,
                          ),
                          decoration: BoxDecoration(
                            color: isPromo
                                ? AppColors.olive.withValues(alpha: 0.15)
                                : AppColors.gold.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(99),
                            border: Border.all(
                              color: isPromo
                                  ? AppColors.olive.withValues(alpha: 0.35)
                                  : AppColors.gold.withValues(alpha: 0.3),
                            ),
                          ),
                          child: Text(
                            announcement.tagLabel,
                            style: AppTextStyles.eyebrow.copyWith(
                              fontSize: 9,
                              color: isPromo ? AppColors.olive : AppColors.brown,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Align(
                            alignment: Alignment.centerRight,
                            child: Text(
                              announcement.displayDate,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.caption.copyWith(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w600,
                                color: AppColors.brownSoft,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),

                    // Title
                    Text(
                      announcement.title,
                      style: AppTextStyles.displaySmall.copyWith(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.brown,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 8),

                    // Location (if present)
                    if (announcement.location.isNotEmpty) ...[
                      Row(
                        children: [
                          const Icon(
                            Icons.place_outlined,
                            size: 14,
                            color: AppColors.goldDeep,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              announcement.location,
                              style: AppTextStyles.bodySmall.copyWith(
                                color: AppColors.brownSoft,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                    ],

                    // Description
                    Text(
                      announcement.description,
                      style: AppTextStyles.body.copyWith(
                        fontSize: 13.5,
                        height: 1.5,
                        color: AppColors.brown,
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

  Widget _fallbackBanner(bool isPromo) {
    return Container(
      color: AppColors.creamEdge,
      alignment: Alignment.center,
      child: Icon(
        isPromo ? Icons.local_offer_outlined : Icons.campaign_outlined,
        size: 44,
        color: AppColors.gold,
      ),
    );
  }
}
