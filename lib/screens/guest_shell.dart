import 'package:flutter/material.dart';

import '../brand.dart';
import '../data/app_settings.dart';
import '../widgets.dart';
import 'about_page.dart';
import 'catering_page.dart';
import 'home_page.dart';
import 'account_creation/login_page.dart';
import 'maintenance_notice.dart';
import 'menu_page.dart';

/// Guest-facing shell. Home is immersive (its own large logo header); the
/// inner tabs use a standard app bar with a larger logo + section title.
///
/// Tabs are kept alive in an [IndexedStack] so scroll positions survive a
/// switch, and the active tab cross-fades/slides in over the one it replaces.
///
/// The tab set follows the dashboard's App-features switches ([AppSettings]):
/// Menu hides when ordering is off, Catering when catering is off, and
/// maintenance mode replaces the whole shell with the closed notice. Tabs are
/// addressed by stable logical ids (the [tabHome]…[tabAbout] constants) so
/// deep links from Home keep working whichever tabs happen to be visible.
///
/// The nav bar also carries a Log In slot in the middle. It is not a tab — it
/// pushes the login page and never becomes the selection — so it lives only in
/// the bar's slot list, not in the tab list that drives the body.
class GuestShell extends StatefulWidget {
  const GuestShell({super.key});

  /// Logical tab ids — stable regardless of which tabs the settings show.
  static const int tabHome = 0, tabMenu = 1, tabCatering = 2, tabAbout = 3;

  @override
  State<GuestShell> createState() => _GuestShellState();
}

class _GuestShellState extends State<GuestShell> {
  /// Nav-bar slot that pushes login instead of selecting a tab. Negative so it
  /// can never collide with a logical tab id.
  static const int _loginSlot = -1;

  int _index = GuestShell.tabHome; // logical id of the active tab

  @override
  void initState() {
    super.initState();
    AppSettingsScope.notifier.addListener(_onSettings);
  }

  @override
  void dispose() {
    AppSettingsScope.notifier.removeListener(_onSettings);
    super.dispose();
  }

  static List<int> _visibleIds(AppSettings s) => [
        GuestShell.tabHome,
        if (s.ordering) GuestShell.tabMenu,
        if (s.catering) GuestShell.tabCatering,
        GuestShell.tabAbout,
      ];

  /// If the moderator switches off the tab the guest is looking at, fall back
  /// to Home rather than stranding the stale index.
  void _onSettings() {
    if (!mounted) return;
    if (!_visibleIds(AppSettingsScope.value).contains(_index)) {
      setState(() => _index = GuestShell.tabHome);
    }
  }

  void _openLogin() {
    Navigator.of(
      context,
    ).push(BrandPageRoute(builder: (_) => const LoginPage()));
  }

  void _go(int i) {
    if (i == _index) return;
    // Ignore deep links into a tab the settings currently hide.
    if (!_visibleIds(AppSettingsScope.value).contains(i)) return;
    setState(() => _index = i);
  }

  static const _titles = {
    GuestShell.tabHome: 'Home',
    GuestShell.tabMenu: 'Menu',
    GuestShell.tabCatering: 'Catering',
    GuestShell.tabAbout: 'About',
  };

  Widget _pageFor(int id) => switch (id) {
        GuestShell.tabMenu => const MenuPage(),
        GuestShell.tabCatering => const CateringPage(),
        GuestShell.tabAbout => const AboutPage(),
        _ => HomePage(onNavigate: _go),
      };

  static const _destinations = {
    GuestShell.tabHome: NavigationDestination(
      icon: Icon(Icons.home_outlined),
      selectedIcon: Icon(Icons.home),
      label: 'Home',
    ),
    GuestShell.tabMenu: NavigationDestination(
      icon: Icon(Icons.restaurant_menu_outlined),
      selectedIcon: Icon(Icons.restaurant_menu),
      label: 'Menu',
    ),
    GuestShell.tabCatering: NavigationDestination(
      icon: Icon(Icons.room_service_outlined),
      selectedIcon: Icon(Icons.room_service),
      label: 'Catering',
    ),
    GuestShell.tabAbout: NavigationDestination(
      icon: Icon(Icons.info_outline),
      selectedIcon: Icon(Icons.info),
      label: 'About',
    ),
    _loginSlot: NavigationDestination(
      icon: Icon(Icons.person_outline),
      label: 'Log In',
    ),
  };

  /// The visible tabs with the Log In slot dropped into the middle, so with the
  /// full four tabs it sits dead centre and stays near-centre when a settings
  /// switch hides one.
  static List<int> _slots(List<int> ids) =>
      [...ids]..insert((ids.length + 1) ~/ 2, _loginSlot);

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AppSettings>(
      valueListenable: AppSettingsScope.notifier,
      builder: (context, settings, _) {
        if (settings.maintenance) return const MaintenanceNotice();

        final ids = _visibleIds(settings);
        // Between _onSettings landing and this rebuild the stale id may still
        // be around for one frame — display Home for it.
        final pos = ids.contains(_index) ? ids.indexOf(_index) : 0;
        final active = ids[pos];
        final slots = _slots(ids);
        final showAppBar = active != GuestShell.tabHome;

        return Scaffold(
          // The app bar fades/slides in for inner tabs and out for Home,
          // instead of snapping the whole layout up and down.
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
                  ? _ShellAppBar(
                      key: ValueKey<int>(active),
                      title: _titles[active]!,
                    )
                  : const SizedBox.shrink(key: ValueKey('home-no-bar')),
            ),
          ),
          body: Stack(
            children: [
              // Shared parchment backdrop for every tab, matching the immersive
              // Home header so Menu, Catering and About rest on the same warm
              // weave instead of flat cream. It sits behind the tab transition
              // so each tab's content fades/slides in over a static background.
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
                        key: ValueKey('guest-tab-$id'),
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
          bottomNavigationBar: NavigationBar(
            selectedIndex: slots.indexOf(active),
            onDestinationSelected: (i) {
              final slot = slots[i];
              if (slot == _loginSlot) {
                _openLogin();
                return;
              }
              _go(slot);
            },
            destinations: [for (final id in slots) _destinations[id]!],
          ),
        );
      },
    );
  }
}

class _ShellAppBar extends StatelessWidget implements PreferredSizeWidget {
  const _ShellAppBar({super.key, required this.title});

  final String title;

  @override
  Size get preferredSize => const Size.fromHeight(72);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      // Transparent bar over a flat-cream parchment flexibleSpace so the weave
      // runs continuously behind the app bar and status bar — matching Home's
      // immersive hero. Flat (vignette-free) cream is used here so the bar's
      // ground lines up with the body vignette's pure-cream top edge instead of
      // computing its own radial centre and leaving a seam under the bar. The
      // fill is opaque, so scrolled content still hides behind the bar.
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
    );
  }
}
