import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/theme/bottom_navigation_layout.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/app_modal_queue.dart';
import '../../data/app_settings.dart';
import '../../data/customer_repository.dart';
import '../../data/member_preferences.dart';
import '../../data/notification_repository.dart';
import '../../data/push_notification_service.dart';
import '../../data/booking_repository.dart';
import '../../data/catering.dart';
import '../../data/catering_repository.dart';
import '../../widgets.dart';
import '../banned_notice.dart';
import '../guest_shell.dart';
import '../maintenance_notice.dart';
import 'account_page.dart';
import 'booking_page.dart';
import 'user_catering_page.dart';
import 'user_gabay_page.dart';
import 'user_home_page.dart';
import 'user_menu_page.dart';

/// Signed-in ("member") shell — the counterpart to [GuestShell]. The member
/// [UserHomePage] is immersive (its own parchment hero, no app bar); the inner
/// tabs (Menu, Gabay, Packages, Account) reuse the shared parchment app bar.
/// Gabay (the AI catering companion) sits in the centre of the bottom nav.
///
/// Tabs are kept alive in an [IndexedStack] so scroll positions and stream
/// state survive a switch, and the active tab cross-fades/slides in via the
/// shared [TabTransition].
///
/// Like the guest shell, the tab set follows the dashboard's App-features
/// switches ([AppSettings]): Menu hides when ordering is off, Packages when
/// catering is off, and maintenance mode replaces the shell with the closed
/// notice. Tabs are addressed by stable logical ids ([tabHome]…[tabAccount])
/// so deep links keep working whichever tabs happen to be visible.
class UserShell extends StatefulWidget {
  const UserShell({super.key});

  /// Logical tab ids — stable regardless of which tabs the settings show.
  static const int tabHome = 0,
      tabMenu = 1,
      tabGabay = 2,
      tabPackages = 3,
      tabAccount = 4;

  @override
  State<UserShell> createState() => _UserShellState();
}

class _UserShellState extends State<UserShell> {
  int _index = UserShell.tabHome; // logical id of the active tab

  /// Flips when the dashboard bans this account mid-session; the shell then
  /// signs the member out and shows [BannedNotice] instead of the tabs.
  bool _banned = false;
  StreamSubscription<bool>? _banSub;

  /// Whether the bell should glow — updated live from Firestore.
  bool _hasUnread = false;
  StreamSubscription<bool>? _unreadSub;
  bool _checkedIncompleteBooking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkIncompleteBooking();
    });
    AppSettingsScope.notifier.addListener(_onSettings);
    // Fetch this member's own settings once, for the whole session: the
    // Settings screens read and write them, the Menu flags dishes against the
    // allergens they avoid, and the app's language follows the one they chose.
    // Fire-and-forget — a failed read leaves the defaults in force.
    MemberPreferencesScope.load().then(
      (_) => PushNotificationService.instance.syncForSignedInUser(),
    );
    // Live ban watch: the moment customers/{uid}.banned turns true, sign out
    // and swap the shell for the suspended notice. Errors are ignored — the
    // forced sign-out itself drops read permission on the profile doc.
    _banSub = CustomerRepository().watchBanned().listen((banned) {
      if (!banned || _banned || !mounted) return;
      setState(() => _banned = true);
      CustomerRepository().signOut();
      MemberPreferencesScope.reset();
    }, onError: (_) {});
    // Live unread badge — update the bell dot as notifications land.
    _unreadSub = NotificationRepository().watchHasUnread().listen((has) {
      if (!mounted) return;
      setState(() => _hasUnread = has);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _banSub?.cancel();
    _unreadSub?.cancel();
    AppSettingsScope.notifier.removeListener(_onSettings);
    super.dispose();
  }

  /// Automatically checks if the customer has an incomplete booking draft
  /// (e.g. phone turned off, closed app mid-booking) and offers to continue.
  Future<void> _checkIncompleteBooking() async {
    if (_checkedIncompleteBooking || !mounted) return;
    _checkedIncompleteBooking = true;

    // Small delay so splash screen transition / home intro settles smoothly
    await Future<void>.delayed(const Duration(milliseconds: 600));
    if (!mounted) return;

    final draft = await BookingRepository().fetchLatestDraft();
    if (draft == null || !mounted) return;

    final shouldResume = await AppModalQueue.instance.show<bool>(() async {
      if (!mounted) return null;
      return showCenterDialog<bool>(
        context: context,
        builder: (dialogContext) => AppDialogShell(
          footer: Row(
            children: [
              Expanded(
                child: AppButton.secondary(
                  label: 'DISCARD',
                  icon: Icons.delete_outline_rounded,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 14,
                  ),
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: AppButton.primary(
                  label: 'CONTINUE',
                  icon: Icons.arrow_forward_rounded,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 14,
                  ),
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                ),
              ),
            ],
          ),
          children: [
            Text('INCOMPLETE BOOKING', style: AppTextStyles.eyebrow),
            const SizedBox(height: AppSpacing.sm),
            Text('Continue your booking?', style: AppTextStyles.title),
            const SizedBox(height: AppSpacing.xs),
            Text(
              draft.headline.isNotEmpty
                  ? 'You were in the middle of booking ${draft.headline}. Would you like to continue where you left off?'
                  : 'You were in the middle of a catering booking. Would you like to continue where you left off?',
              style: AppTextStyles.bodySmall,
            ),
            if (draft.eventDate.isNotEmpty ||
                draft.value('venue').isNotEmpty ||
                draft.value('pax').isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.cream,
                  borderRadius: AppRadius.smAll,
                  border: Border.all(color: AppColors.hairline),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (draft.eventDate.isNotEmpty)
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Icon(
                              Icons.event_outlined,
                              size: 15,
                              color: AppColors.goldDeep,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              draft.eventDate,
                              style: AppTextStyles.sans(
                                size: 13,
                                weight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    if (draft.value('venue').isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: Icon(
                              Icons.place_outlined,
                              size: 15,
                              color: AppColors.goldDeep,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              draft.value('venue'),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppTextStyles.sans(
                                size: 12,
                                color: AppColors.brown,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                    if (draft.value('pax').isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(
                            Icons.groups_outlined,
                            size: 15,
                            color: AppColors.goldDeep,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              '${draft.value('pax')} pax',
                              style: AppTextStyles.sans(
                                size: 12,
                                color: AppColors.brown,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ],
        ),
      );
    });

    if (!mounted) return;
    if (shouldResume == true) {
      CateringPackage? package;
      final packageId = draft.draftPackageId;
      if (packageId.isNotEmpty) {
        try {
          package = await CateringRepository().fetchPackage(packageId);
        } catch (_) {}
      }
      if (!mounted) return;
      await Navigator.of(context).push<void>(
        BrandPageRoute<void>(
          builder: (_) => BookingPage(package: package, resumeFrom: draft),
        ),
      );
    } else if (shouldResume == false) {
      try {
        await BookingRepository().deleteDraft(draft.id);
      } catch (_) {}
    }
  }

  static List<int> _visibleIds(AppSettings s) => [
    UserShell.tabHome,
    if (s.ordering) UserShell.tabMenu,
    UserShell.tabGabay,
    if (s.catering) UserShell.tabPackages,
    UserShell.tabAccount,
  ];

  /// If the moderator switches off the tab the member is looking at, fall
  /// back to Home rather than stranding the stale index.
  void _onSettings() {
    if (!mounted) return;
    if (!_visibleIds(AppSettingsScope.value).contains(_index)) {
      setState(() => _index = UserShell.tabHome);
    }
  }

  void _go(int i) {
    if (i == _index) return;
    // Ignore deep links into a tab the settings currently hide.
    if (!_visibleIds(AppSettingsScope.value).contains(i)) return;
    setState(() => _index = i);
  }

  Future<void> _logout() async {
    await CustomerRepository().signOut();
    // One member's choices must never colour the guest side or the next account
    // to sign in — including the language the app is running in.
    MemberPreferencesScope.reset();
    if (!mounted) return;
    // Clear the whole stack back to a fresh guest shell.
    Navigator.of(context).pushAndRemoveUntil(
      BrandPageRoute(builder: (_) => const GuestShell()),
      (route) => false,
    );
  }

  static const _titles = {
    UserShell.tabHome: 'Home',
    UserShell.tabMenu: 'Menu',
    UserShell.tabGabay: 'Gabay',
    UserShell.tabPackages: 'Packages',
    UserShell.tabAccount: 'Account',
  };

  Widget _pageFor(int id) => switch (id) {
    UserShell.tabMenu => const UserMenuPage(),
    // Gabay takes the navigator so a recommended package can hand off to
    // the Packages tab, where it's actually booked.
    UserShell.tabGabay => UserGabayPage(onNavigate: _go),
    UserShell.tabPackages => const UserCateringPage(),
    UserShell.tabAccount => AccountPage(onLogout: _logout),
    _ => UserHomePage(onNavigate: _go),
  };

  /// Leaves the (already signed-out) banned session for a fresh guest shell.
  void _leaveBanned() {
    Navigator.of(context).pushAndRemoveUntil(
      BrandPageRoute(builder: (_) => const GuestShell()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_banned) return BannedNotice(onLeave: _leaveBanned);

    return ValueListenableBuilder<AppSettings>(
      valueListenable: AppSettingsScope.notifier,
      builder: (context, settings, _) {
        if (settings.maintenance) return const MaintenanceNotice();

        final ids = _visibleIds(settings);
        // Between _onSettings landing and this rebuild the stale id may still
        // be around for one frame — display Home for it.
        final pos = ids.contains(_index) ? ids.indexOf(_index) : 0;
        final active = ids[pos];
        final showAppBar = active != UserShell.tabHome;

        return Scaffold(
          extendBody: true,
          appBar: PreferredSize(
            preferredSize: Size.fromHeight(showAppBar ? 72 : 0),
            child: AnimatedSwitcher(
              duration: Motion.base,
              switchInCurve: Motion.standard,
              switchOutCurve: Motion.exit,
              transitionBuilder: (child, animation) => FadeTransition(
                opacity: animation,
                child: SizeTransition(
                  sizeFactor: animation,
                  alignment: const Alignment(0, -1),
                  child: child,
                ),
              ),
              child: showAppBar
                  ? _MemberAppBar(
                      key: ValueKey<int>(active),
                      title: _titles[active]!,
                      name: CustomerRepository().displayName,
                      hasUnread: _hasUnread,
                      onAccount: () => _go(UserShell.tabAccount),
                    )
                  : const SizedBox.shrink(key: ValueKey('home-no-bar')),
            ),
          ),
          body: Stack(
            children: [
              // Shared parchment backdrop for every tab, including the
              // immersive member home — so the whole member side rests on one
              // warm weave.
              const ParchmentBackground(weave: true),
              TabTransition(
                index: pos,
                child: IndexedStack(
                  index: pos,
                  children: [
                    // HeroMode gates hero flights to the visible tab, so
                    // pushing a page can never fly the logo out of a hidden
                    // sibling tab. Keyed by logical id so tab state survives
                    // the list reshaping when a settings switch flips.
                    for (final id in ids)
                      KeyedSubtree(
                        key: ValueKey('member-tab-$id'),
                        child: HeroMode(
                          enabled: id == active,
                          child: _pageFor(id),
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
          bottomNavigationBar: _MemberNavBar(
            ids: ids,
            activeId: active,
            onSelect: _go,
          ),
        );
      },
    );
  }
}

/// Member navigation: floating capsule pill matching the guest shell navigation,
/// with smooth icon transitions and distinct Gabay mark in the center.
class _MemberNavBar extends StatelessWidget {
  const _MemberNavBar({
    required this.ids,
    required this.activeId,
    required this.onSelect,
  });

  final List<int> ids;
  final int activeId;
  final ValueChanged<int> onSelect;

  static const Map<int, (IconData, IconData, String)> _items = {
    UserShell.tabHome: (Icons.home_outlined, Icons.home, 'Home'),
    UserShell.tabMenu: (
      Icons.restaurant_menu_outlined,
      Icons.restaurant_menu,
      'Menu',
    ),
    UserShell.tabGabay: (
      Icons.auto_awesome_outlined,
      Icons.auto_awesome,
      'Gabay',
    ),
    UserShell.tabPackages: (
      Icons.room_service_outlined,
      Icons.room_service,
      'Packages',
    ),
    UserShell.tabAccount: (Icons.person_outline, Icons.person, 'Account'),
  };

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      minimum: const EdgeInsets.fromLTRB(
        12,
        0,
        12,
        AppBottomNavigationLayout.guestBottomMinimum,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.hairline),
          boxShadow: const [
            BoxShadow(
              color: AppColors.shadow,
              blurRadius: 22,
              offset: Offset(0, 8),
            ),
          ],
        ),
        child: SizedBox(
          height: AppBottomNavigationLayout.guestBarHeight,
          child: Row(
            children: [
              for (final id in ids)
                Expanded(
                  child: _MemberDestination(
                    id: id,
                    item: _items[id]!,
                    selected: activeId == id,
                    onTap: () => onSelect(id),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MemberDestination extends StatelessWidget {
  const _MemberDestination({
    required this.id,
    required this.item,
    required this.selected,
    required this.onTap,
  });

  final int id;
  final (IconData, IconData, String) item;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isGabay = id == UserShell.tabGabay;

    return Semantics(
      button: true,
      selected: selected,
      label: item.$3,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3, vertical: 3),
        child: Material(
          color: Colors.transparent,
          borderRadius: AppRadius.pillAll,
          child: InkWell(
            borderRadius: AppRadius.pillAll,
            splashColor: AppColors.gold.withValues(alpha: 0.14),
            highlightColor: AppColors.gold.withValues(alpha: 0.08),
            onTap: onTap,
            child: AnimatedContainer(
              duration: Motion.quick,
              curve: Motion.standard,
              height: 58,
              decoration: const BoxDecoration(shape: BoxShape.circle),
              child: Center(
                child: AnimatedSwitcher(
                  duration: Motion.quick,
                  switchInCurve: Motion.standard,
                  switchOutCurve: Motion.exit,
                  child: isGabay
                      ? KeyedSubtree(
                          key: ValueKey<bool>(selected),
                          child: GabayMark(
                            size: selected ? 25 : 23,
                            color: selected
                                ? AppColors.brown
                                : AppColors.brownSoft.withValues(alpha: 0.72),
                          ),
                        )
                      : Icon(
                          selected ? item.$2 : item.$1,
                          key: ValueKey<bool>(selected),
                          size: selected ? 25 : 23,
                          color: selected
                              ? AppColors.brown
                              : AppColors.brownSoft.withValues(alpha: 0.72),
                        ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The inner-tab app bar for the member side — logo · divider · section title,
/// closing on a "Member" chip (a person icon + the member's first name) in
/// place of the guest bar's "Log In" action. The chip both signals that you're
/// signed in on the member side and opens the Account tab (where log-out lives).
class _MemberAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _MemberAppBar({
    super.key,
    required this.title,
    required this.name,
    required this.onAccount,
    this.hasUnread = false,
  });

  final String title;
  final String? name;
  final VoidCallback onAccount;
  final bool hasUnread;

  @override
  Size get preferredSize => const Size.fromHeight(72);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      backgroundColor: Colors.transparent,
      flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
      titleSpacing: 16,
      title: Row(
        children: [
          Image.asset(AppAssets.logo, height: 44),
          const SizedBox(width: AppSpacing.md),
          Container(width: 1, height: 26, color: AppColors.hairline),
          const SizedBox(width: AppSpacing.md),
          Flexible(
            child: Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.heading,
            ),
          ),
        ],
      ),
      actions: [
        NotificationIconButton(hasUnread: hasUnread),
        const SizedBox(width: 8),
        _MemberChip(name: name, onTap: onAccount),
      ],
    );
  }
}

/// Signed-in indicator for the member app bar: a gold-ringed person icon with
/// the member's first name (or "Member"). Tapping opens the Account tab.
class _MemberChip extends StatelessWidget {
  const _MemberChip({required this.name, required this.onTap});

  final String? name;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final trimmed = (name ?? '').trim();
    final label = trimmed.isEmpty ? 'Member' : trimmed.split(' ').first;

    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: PressableScale(
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
                label,
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
      ),
    );
  }
}
