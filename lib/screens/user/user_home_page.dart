import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/announcement.dart';
import '../../data/announcement_repository.dart';
import '../../data/announcement_session.dart';
import '../../data/app_settings.dart';
import '../../data/customer_repository.dart';
import '../../data/member_preferences.dart';
import '../../data/notification_repository.dart';
import '../../data/product.dart';
import '../../data/product_repository.dart';
import '../../data/recommendation_repository.dart';
import '../../widgets.dart';
import '../home_sections.dart';
import 'announcement_popup_modal.dart';
import 'user_shell.dart';

/// Fallback clearance above the header when the platform reports no status-bar
/// inset, mirroring [HomePage].
const double _kMinStatusClearance = 24;

/// Signed-in ("member") home.
///
/// Shares the guest [HomePage]'s warm-parchment editorial layout so the app
/// reads as one continuous design across the guest → member boundary: the same
/// Featured carousel, Explore category strip, "From the Kitchen" run and
/// catering invitation (all from `home_sections.dart`). Two things are the
/// member's alone — the header (a personalised greeting and an avatar that jumps
/// to the Account tab, in place of the guest's brand + "Log In" chip), and the
/// "For You" strip, which needs a signed-in member to have recommendations for.
///
/// Products come from the shared [ProductRepository] via a manual subscription
/// (a stream re-emit must not rebuild the whole scroll view); recommendations
/// come from [RecommendationRepository] the same way, and are held apart so a
/// recomputed set repaints one strip rather than the page.
class UserHomePage extends StatefulWidget {
  const UserHomePage({super.key, required this.onNavigate});

  /// Switches the member shell to another tab (0 Home · 1 Menu · 2 Gabay ·
  /// 3 Packages · 4 Account).
  final void Function(int index) onNavigate;

  @override
  State<UserHomePage> createState() => _UserHomePageState();
}

class _UserHomePageState extends State<UserHomePage> {
  final ProductRepository _repo = ProductRepository();
  StreamSubscription<List<Product>>? _sub;

  List<Product> _all = const [];
  bool _loading = true;
  bool _error = false;

  StreamSubscription<RecommendationSet>? _recSub;
  RecommendationSet _recs = RecommendationSet.empty;
  bool _recsLoading = true;

  StreamSubscription<List<Announcement>>? _annSub;
  List<Announcement> _announcements = const [];
  bool _announcementsLoading = true;

  bool _hasUnread = false;
  StreamSubscription<bool>? _unreadSub;

  @override
  void initState() {
    super.initState();
    _sub = _repo.watchVisible().listen(
      (products) {
        if (!mounted) return;
        setState(() {
          _all = products;
          _loading = false;
          _error = false;
        });
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = true;
        });
      },
    );
    // Announcements & Events live stream.
    _annSub = AnnouncementRepository.instance.watchPublished().listen(
      (items) {
        if (!mounted) return;
        setState(() {
          _announcements = items;
          _announcementsLoading = false;
        });
        _maybeShowAnnouncementPopup(items);
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _announcementsLoading = false;
        });
      },
    );
    // The strip is a bonus, never a blocker: a failed read just settles it into
    // its empty state, which the build drops from the page entirely.
    _recSub = RecommendationRepository().watchRecommended().listen(
      (set) {
        if (!mounted) return;
        setState(() {
          _recs = set;
          _recsLoading = false;
        });
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _recs = RecommendationSet.empty;
          _recsLoading = false;
        });
      },
    );
    // Live unread badge for the home header's bell.
    _unreadSub = NotificationRepository().watchHasUnread().listen(
      (has) {
        if (!mounted) return;
        setState(() => _hasUnread = has);
      },
      onError: (_) {},
    );
  }

  void _maybeShowAnnouncementPopup(List<Announcement> items) {
    if (items.isEmpty || !mounted) return;
    final ids = items.map((e) => e.id).toList();
    if (!AnnouncementSession.shouldShowForSession(ids)) return;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      AnnouncementPopupModal.show(
        context,
        announcements: items,
      );
    });
  }

  @override
  void dispose() {
    _sub?.cancel();
    _annSub?.cancel();
    _recSub?.cancel();
    _unreadSub?.cancel();
    super.dispose();
  }

  Duration _d(int ms) => Duration(milliseconds: ms);

  @override
  Widget build(BuildContext context) {
    // The shell hides the app bar for Home, so the header clears the status bar
    // itself via the true notch inset (see [HomePage] for the full rationale).
    final topInset = math.max(
      MediaQuery.viewPaddingOf(context).top,
      _kMinStatusClearance,
    );

    final featured = _all.where((p) => p.featured).toList();
    // A short editorial run for "From the Kitchen": prefer featured, then fill
    // out with the rest, capped so the home stays a teaser for the Menu.
    final picks = <Product>[
      ...featured,
      ..._all.where((p) => !p.featured),
    ].take(6).toList();

    // One tile per category, each fronted by that category's representative
    // ("best seller") dish.
    final categories = bestByCategory(_all);

    // The house's genuinely most-ordered dishes. Empty until the order tally has
    // enough in it to mean anything.
    final loved = mostLoved(_all);

    // Sits on the shell's shared parchment backdrop (no own ground), so the
    // member home rests on the same warm weave as every other tab.
    //
    // The section run follows the dashboard's App-features switches, exactly
    // like the guest [HomePage]: Featured obeys featuredOnHome, the menu
    // teasers obey ordering, and the catering invitation obeys catering.
    //
    // The "For You" strip answers to the member's own switch instead — the
    // moderator has no say over whether one member wants suggestions, so it
    // reads [MemberPreferences.gabaySuggestions] from the inner builder.
    return ValueListenableBuilder<AppSettings>(
      valueListenable: AppSettingsScope.notifier,
      builder: (context, settings, _) => ValueListenableBuilder<MemberPreferences>(
        valueListenable: MemberPreferencesScope.notifier,
        builder: (context, prefs, _) => MediaQuery.removePadding(
          context: context,
          removeTop: true,
          child: ListView(
            padding: const EdgeInsets.only(bottom: AppSpacing.xxxl),
            children: [
              _MemberHeader(
                topInset: topInset,
                name: CustomerRepository().displayName,
                hasUnread: _hasUnread,
                onAccount: () => widget.onNavigate(UserShell.tabAccount),
                onBrowse: settings.ordering
                    ? () => widget.onNavigate(UserShell.tabMenu)
                    : null,
              ),
              const SizedBox(height: AppSpacing.sm),

              // ── Announcements & Promos ────────────────────────────────────
              if (_announcementsLoading || _announcements.isNotEmpty) ...[
                FadeSlideIn(
                  delay: _d(80),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: SectionHeading('Announcements & Promos'),
                  ),
                ),
                const SizedBox(height: 14),
                FadeSlideIn(
                  delay: _d(120),
                  child: _AnnouncementsStrip(
                    loading: _announcementsLoading,
                    announcements: _announcements.take(5).toList(),
                    onTap: (ann, index) => AnnouncementPopupModal.show(
                      context,
                      announcements: _announcements,
                      initialIndex: index,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.section),
              ],

              // ── Picks just for you ─────────────────────────────────────────
              // Ahead of Featured: a pick made for this member outranks the
              // house's own. Hidden while the member has switched Gabay's
              // suggestions off in Settings, and while the set is genuinely
              // empty (nothing published to recommend at all).
              if (prefs.gabaySuggestions &&
                  (_recsLoading || _recs.isNotEmpty)) ...[
                FadeSlideIn(
                  delay: _d(140),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: SectionHeading(
                      'For You',
                      onSeeAll: () => widget.onNavigate(UserShell.tabGabay),
                    ),
                  ),
                ),
                // The provenance badge sits under the heading rather than beside
                // it — "From orders like yours" is too long to share the row with
                // a title and a "See all".
                if (!_recsLoading)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: RecommendationSourceBadge(_recs.source),
                    ),
                  ),
                const SizedBox(height: 14),
                FadeSlideIn(
                  delay: _d(170),
                  child: ForYouStrip(
                    loading: _recsLoading,
                    set: _recs,
                    onOpenPackages: () =>
                        widget.onNavigate(UserShell.tabPackages),
                  ),
                ),
                const SizedBox(height: AppSpacing.section),
              ],

              // ── Featured highlight ─────────────────────────────────────────
              if (settings.featuredOnHome && (_loading || featured.isNotEmpty)) ...[
                FadeSlideIn(
                  delay: _d(200),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: SectionHeading(
                      'Featured',
                      onSeeAll: settings.ordering
                          ? () => widget.onNavigate(UserShell.tabMenu)
                          : null,
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                FadeSlideIn(
                  delay: _d(230),
                  child: FeaturedCarousel(
                    products: featured,
                    loading: _loading,
                    onTap: () => widget.onNavigate(UserShell.tabMenu),
                  ),
                ),
                const SizedBox(height: AppSpacing.section),
              ],

              // ── Categories — each with its best seller ─────────────────────
              if (settings.ordering && (_loading || categories.isNotEmpty)) ...[
                FadeSlideIn(
                  delay: _d(220),
                  child: const Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: SectionHeading('Explore'),
                  ),
                ),
                const SizedBox(height: 14),
                FadeSlideIn(
                  delay: _d(260),
                  child: CategoryStrip(
                    loading: _loading,
                    categories: categories,
                    onTap: () => widget.onNavigate(UserShell.tabMenu),
                  ),
                ),
                const SizedBox(height: AppSpacing.section),
              ],

              // ── From the Kitchen (live dishes) ─────────────────────────────
              if (settings.ordering) ...[
                FadeSlideIn(
                  delay: _d(320),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: SectionHeading(
                      'From the Kitchen',
                      onSeeAll: () => widget.onNavigate(UserShell.tabMenu),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                KitchenStrip(
                  loading: _loading,
                  error: _error,
                  picks: picks,
                  onBrowse: () => widget.onNavigate(UserShell.tabMenu),
                ),
                const SizedBox(height: AppSpacing.section),
              ],

              // ── Most loved (the house's real order tally) ──────────────────
              // Distinct from "For You" above: that's personal, this is the
              // whole house's verdict. Drops out entirely until enough orders
              // have been counted to make the claim honest (see [mostLoved]),
              // which is also why it never shows a loading skeleton — an empty
              // tally isn't loading, it's just empty.
              if (settings.ordering && loved.isNotEmpty) ...[
                FadeSlideIn(
                  delay: _d(350),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: SectionHeading(
                      'Most Loved',
                      onSeeAll: () => widget.onNavigate(UserShell.tabMenu),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                KitchenStrip(
                  loading: false,
                  error: false,
                  picks: loved,
                  onBrowse: () => widget.onNavigate(UserShell.tabMenu),
                ),
                const SizedBox(height: AppSpacing.section),
              ],

              // ── Catering invitation ────────────────────────────────────────
              if (settings.catering)
                FadeSlideIn(
                  delay: _d(380),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.screen,
                    ),
                    child: CateringInvite(
                      onTap: () => widget.onNavigate(UserShell.tabPackages),
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

// ════════════════════════════ Header ════════════════════════════
/// Personalised counterpart to the guest [HomePage]'s header: same parchment
/// hero (logo · divider · wordmark), but with a member greeting and an avatar
/// chip that opens the Account tab in place of the guest's "Log In" chip.
class _MemberHeader extends StatelessWidget {
  const _MemberHeader({
    required this.topInset,
    required this.name,
    required this.onAccount,
    required this.onBrowse,
    this.hasUnread = false,
  });

  final double topInset;
  final String? name;
  final VoidCallback onAccount;
  final bool hasUnread;

  /// Null while ordering is switched off.
  final VoidCallback? onBrowse;

  @override
  Widget build(BuildContext context) {
    final trimmed = (name ?? '').trim();
    final first = trimmed.isEmpty ? 'Kaibigan' : trimmed.split(' ').first;

    return Container(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.screen,
        topInset + 14,
        AppSpacing.screen,
        26,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Logo row + avatar, mirroring the guest hero and the inner-tab app
          // bar so the brand stays anchored top-left across the whole app.
          SizedBox(
            height: 52,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Hero(
                  tag: AppAssets.logoHeroTag,
                  child: Image.asset(AppAssets.logo, height: 52),
                ),
                const SizedBox(width: AppSpacing.md),
                Container(width: 1, height: 30, color: AppColors.hairline),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        'Hapag Pamana',
                        maxLines: 1,
                        style: AppTextStyles.heading,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                NotificationIconButton(hasUnread: hasUnread),
                const SizedBox(width: 8),
                _AvatarChip(first: first, onTap: onAccount),
              ],
            ),
          ),
          const SizedBox(height: 22),

          FadeSlideIn(
            child: Text(
              'MALIGAYANG PAGBALIK',
              style: AppTextStyles.engraved(
                size: 11,
                color: AppColors.goldDeep,
                spacing: 3,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm + 2),
          FadeSlideIn(
            delay: const Duration(milliseconds: 60),
            child: Text(
              'Kumusta,\n$first!',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.display,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          FadeSlideIn(
            delay: const Duration(milliseconds: 110),
            child: Text(
              'Browse today\'s kitchen and plan '
              'your next handaan with us.',
              style: AppTextStyles.body,
            ),
          ),
          if (onBrowse != null) ...[
            const SizedBox(height: AppSpacing.xl),
            FadeSlideIn(
              delay: const Duration(milliseconds: 160),
              child: AppButton.primary(
                label: 'BROWSE THE MENU',
                icon: Icons.restaurant_menu,
                onPressed: onBrowse,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Signed-in member chip — a gold-ringed person icon with the member's first
/// name, matching the member app bar's chip so the signed-in cue reads the same
/// across Home, Menu and Catering. Tapping opens the Account tab (where log-out
/// also lives).
class _AvatarChip extends StatelessWidget {
  const _AvatarChip({required this.first, required this.onTap});

  final String first;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.gold.withValues(alpha: 0.12),
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.gold.withValues(alpha: 0.5)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.person, size: 16, color: AppColors.goldDeep),
            const SizedBox(width: 7),
            Text(
              first,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                color: AppColors.goldDeep,
                spacing: 0.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ════════════════════════ Announcements Strip ════════════════════════
class _AnnouncementsStrip extends StatelessWidget {
  const _AnnouncementsStrip({
    required this.loading,
    required this.announcements,
    required this.onTap,
  });

  final bool loading;
  final List<Announcement> announcements;
  final void Function(Announcement, int) onTap;

  static const double _cardWidth = 270;
  static const double _height = 250;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return SizedBox(
        height: _height,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
          scrollDirection: Axis.horizontal,
          itemCount: 3,
          separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
          itemBuilder: (_, _) => const _AnnouncementSkeleton(width: _cardWidth),
        ),
      );
    }

    if (announcements.isEmpty) {
      return const SizedBox.shrink();
    }

    return SizedBox(
      height: _height,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        scrollDirection: Axis.horizontal,
        itemCount: announcements.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.md),
        itemBuilder: (context, index) {
          final ann = announcements[index];
          return _AnnouncementCard(
            width: _cardWidth,
            announcement: ann,
            onTap: () => onTap(ann, index),
          );
        },
      ),
    );
  }
}

class _AnnouncementCard extends StatelessWidget {
  const _AnnouncementCard({
    required this.width,
    required this.announcement,
    required this.onTap,
  });

  final double width;
  final Announcement announcement;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final imageBytes = announcement.imageBytes;
    final isPromo = announcement.isPromo;

    return PressableScale(
      onTap: onTap,
      child: Container(
        width: width,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.md),
          border: Border.all(color: AppColors.hairline),
          boxShadow: const [
            BoxShadow(
              color: Color.fromRGBO(42, 26, 8, 0.06),
              blurRadius: 10,
              offset: Offset(0, 4),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Banner Image with Tag
            Stack(
              children: [
                Container(
                  height: 120,
                  width: double.infinity,
                  color: AppColors.creamEdge.withValues(alpha: 0.5),
                  alignment: Alignment.center,
                  child: announcement.hasImage
                      ? (imageBytes != null
                          ? Image.memory(
                              imageBytes,
                              fit: BoxFit.contain,
                              errorBuilder: (_, _, _) => _fallbackThumb(isPromo),
                            )
                          : Image.network(
                              announcement.imageUrl,
                              fit: BoxFit.contain,
                              errorBuilder: (_, _, _) => _fallbackThumb(isPromo),
                            ))
                      : _fallbackThumb(isPromo),
                ),
                Positioned(
                  top: 8,
                  left: 8,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                    decoration: BoxDecoration(
                      color: isPromo ? AppColors.brown : AppColors.surface.withValues(alpha: 0.9),
                      borderRadius: BorderRadius.circular(4),
                      border: Border.all(
                        color: isPromo ? AppColors.gold : AppColors.hairline,
                      ),
                    ),
                    child: Text(
                      announcement.tagLabel,
                      style: AppTextStyles.engraved(
                        size: 9,
                        color: isPromo ? AppColors.cream : AppColors.brown,
                        spacing: 1,
                      ),
                    ),
                  ),
                ),
              ],
            ),

            // Content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      announcement.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.cardTitle.copyWith(
                        color: AppColors.brown,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 6),
                    if (announcement.displayDate.isNotEmpty ||
                        announcement.location.isNotEmpty) ...[
                      Row(
                        children: [
                          Icon(
                            isPromo ? Icons.local_offer_outlined : Icons.calendar_today_outlined,
                            size: 12,
                            color: AppColors.goldDeep,
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              announcement.displayDate.isNotEmpty
                                  ? announcement.displayDate
                                  : announcement.location,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.caption.copyWith(
                                color: AppColors.brownSoft,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    const Spacer(),
                    Row(
                      children: [
                        Text(
                          'View Details',
                          style: AppTextStyles.sans(
                            size: 11,
                            weight: FontWeight.w600,
                            color: AppColors.brown,
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.arrow_forward,
                          size: 12,
                          color: AppColors.brown,
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
    );
  }

  Widget _fallbackThumb(bool isPromo) {
    return Container(
      color: AppColors.creamEdge,
      alignment: Alignment.center,
      child: Icon(
        isPromo ? Icons.local_offer_outlined : Icons.campaign_outlined,
        size: 36,
        color: AppColors.gold,
      ),
    );
  }
}

class _AnnouncementSkeleton extends StatelessWidget {
  const _AnnouncementSkeleton({required this.width});

  final double width;

  @override
  Widget build(BuildContext context) {
    final shimmerAnim = ShimmerScope.of(context);

    Widget shimmerBox({
      required double height,
      double? width,
      BorderRadius? radius,
    }) {
      if (shimmerAnim == null) {
        return Container(
          height: height,
          width: width,
          decoration: BoxDecoration(
            color: AppColors.shimmerBase,
            borderRadius: radius ?? BorderRadius.circular(4),
          ),
        );
      }

      return AnimatedBuilder(
        animation: shimmerAnim,
        builder: (context, _) {
          final t = shimmerAnim.value;
          final dx = t * 3.0 - 1.5;
          return Container(
            height: height,
            width: width,
            decoration: BoxDecoration(
              borderRadius: radius ?? BorderRadius.circular(4),
              gradient: LinearGradient(
                begin: Alignment(dx - 0.6, -0.4),
                end: Alignment(dx + 0.6, 0.4),
                colors: const [
                  AppColors.shimmerBase,
                  AppColors.shimmerHi,
                  AppColors.shimmerBase,
                ],
                stops: const [0.28, 0.5, 0.72],
              ),
            ),
          );
        },
      );
    }

    return Container(
      width: width,
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.hairline),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          shimmerBox(
            height: 120,
            width: double.infinity,
            radius: BorderRadius.zero,
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                shimmerBox(
                  height: 16,
                  width: width * 0.75,
                ),
                const SizedBox(height: 8),
                shimmerBox(
                  height: 12,
                  width: width * 0.5,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}


