import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/widgets/app_widgets.dart';
import '../data/app_settings.dart';
import '../data/product.dart';
import '../data/product_repository.dart';
import '../widgets.dart';
import 'guest_shell.dart';
import 'home_sections.dart';

/// Fallback clearance above the header when the platform reports no status-bar
/// inset, so the logo and Log In chip never collide with the system UI.
const double _kMinStatusClearance = 24;

/// Guest landing screen — immersive (no app bar; the shell hides it for tab 0).
///
/// A warm parchment header carries the logo, an engraved welcome and a quick
/// jump into the menu, then the page settles into an editorial run of sections:
/// a featured highlight, category shortcuts that deep-link the Menu tab, a
/// "From the Kitchen" run of live dishes, and a closing catering invitation.
///
/// Products are read from the shared [ProductRepository] via a manual
/// subscription (not a StreamBuilder) so a stream re-emit never rebuilds the
/// whole scroll view out from under the user.
class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.onNavigate});

  /// Switches the shell to another tab (0 Home · 1 Menu · 2 Catering · 3 About).
  final void Function(int index) onNavigate;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final ProductRepository _repo = ProductRepository();
  StreamSubscription<List<Product>>? _sub;

  List<Product> _all = const [];
  bool _loading = true;
  bool _error = false;

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
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Duration _d(int ms) => Duration(milliseconds: ms);

  @override
  Widget build(BuildContext context) {
    // The shell hides the app bar for Home, so the header must clear the
    // status bar / notch itself. The Scaffold still reserves an (empty) app-bar
    // slot for Home, which zeroes the body's `padding.top` — so reading
    // `padding.top` here always yields 0 and the logo crowds the system UI.
    // Read `viewPadding.top` instead: it reports the true status-bar / notch
    // inset and is left untouched by the Scaffold. Floor it to a sensible
    // minimum so the logo never sits flush against the system UI even where the
    // inset resolves to 0 (e.g. desktop). The header consumes this; everything
    // below scrolls under it normally.
    final topInset = math.max(
      MediaQuery.viewPaddingOf(context).top,
      _kMinStatusClearance,
    );

    final featured = _all.where((p) => p.featured).toList();
    // A short editorial run for "From the Kitchen": prefer featured, then fill
    // out with the rest, capped so the home page stays a teaser for the Menu.
    final picks = <Product>[
      ...featured,
      ..._all.where((p) => !p.featured),
    ].take(6).toList();

    // Explore tiles: one per category, each surfacing that category's "best
    // seller". The product schema carries no sales/quantity field, so the pick
    // is the category's featured item, else the first (the list is already
    // name-sorted by the repository).
    final categories = bestByCategory(_all);

    // The shared parchment backdrop now lives in GuestShell, so every tab sits
    // on the same weave; this page just lays out its scrolling content.
    // Strip the top inset the ListView would otherwise auto-apply — the header
    // owns the status-bar clearance, so this avoids doubling it.
    //
    // The section run follows the dashboard's App-features switches: the
    // Featured carousel obeys featuredOnHome, the menu teasers (browse button,
    // Explore, From the Kitchen and the see-all links) obey ordering, and the
    // catering invitation obeys catering.
    return ValueListenableBuilder<AppSettings>(
      valueListenable: AppSettingsScope.notifier,
      builder: (context, settings, _) => MediaQuery.removePadding(
        context: context,
        removeTop: true,
        child: ListView(
          padding: const EdgeInsets.only(bottom: AppSpacing.xxxl),
          children: [
            _Header(
              topInset: topInset,
              onBrowse: settings.ordering
                  ? () => widget.onNavigate(GuestShell.tabMenu)
                  : null,
            ),
            const SizedBox(height: AppSpacing.sm),

            // ── Featured highlight ─────────────────────────────────────────
            if (settings.featuredOnHome && (_loading || featured.isNotEmpty)) ...[
              FadeSlideIn(
                delay: _d(120),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
                  child: SectionHeading(
                    'Featured',
                    onSeeAll: settings.ordering
                        ? () => widget.onNavigate(GuestShell.tabMenu)
                        : null,
                  ),
                ),
              ),
              const SizedBox(height: 14),
              FadeSlideIn(
                delay: _d(160),
                child: FeaturedCarousel(
                  products: featured,
                  loading: _loading,
                  onTap: () => widget.onNavigate(GuestShell.tabMenu),
                ),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── Categories — each with its best seller ─────────────────────
            if (settings.ordering && (_loading || categories.isNotEmpty)) ...[
              FadeSlideIn(
                delay: _d(220),
                child: const Padding(
                  padding: EdgeInsets.symmetric(horizontal: AppSpacing.screen),
                  child: SectionHeading('Explore'),
                ),
              ),
              const SizedBox(height: 14),
              FadeSlideIn(
                delay: _d(260),
                child: CategoryStrip(
                  loading: _loading,
                  categories: categories,
                  onTap: () => widget.onNavigate(GuestShell.tabMenu),
                ),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── From the Kitchen (live dishes) ─────────────────────────────
            if (settings.ordering) ...[
              FadeSlideIn(
                delay: _d(320),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
                  child: SectionHeading(
                    'From the Kitchen',
                    onSeeAll: () => widget.onNavigate(GuestShell.tabMenu),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              KitchenStrip(
                loading: _loading,
                error: _error,
                picks: picks,
                onBrowse: () => widget.onNavigate(GuestShell.tabMenu),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── Catering invitation ────────────────────────────────────────
            if (settings.catering)
              FadeSlideIn(
                delay: _d(380),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
                  child: CateringInvite(
                    onTap: () => widget.onNavigate(GuestShell.tabCatering),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// ════════════════════════════ Header ════════════════════════════
class _Header extends StatelessWidget {
  const _Header({required this.topInset, required this.onBrowse});

  final double topInset;

  /// Null while ordering is switched off — the browse button is dropped so
  /// the hero never points at a Menu tab that isn't there.
  final VoidCallback? onBrowse;

  @override
  Widget build(BuildContext context) {
    return Container(
      // `topInset` already clears the status bar / notch; +14 adds an even
      // breathing gap below it. The screen inset keeps the brand off the edges
      // (well over the 16px minimum) on every device width.
      padding: EdgeInsets.fromLTRB(
        AppSpacing.screen,
        topInset + 14,
        AppSpacing.screen,
        26,
      ),
      // No fill and no divider: the hero is transparent over the shared
      // parchment ground so it flows straight into the content below instead
      // of reading as a separate, ruled-off block. Spacing alone separates the
      // hero from the first section.
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Logo row, mirroring the inner-tab app bar so the brand stays
          // anchored top-left across the whole app. Logging in is offered from
          // the shell's nav bar instead, so nothing competes with the brand
          // here. A fixed row height with centred children keeps the emblem and
          // wordmark on a shared baseline regardless of intrinsic heights.
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
                // Brand name beside the emblem, mirroring the inner-tab app
                // bar (logo · divider · title). FittedBox scales the wordmark
                // down rather than truncating it on narrow screens.
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
              ],
            ),
          ),
          const SizedBox(height: 22),

          FadeSlideIn(
            child: Text(
              'KUMUSTA, KAIBIGAN',
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
              'A taste of\nhome, handed down.',
              style: AppTextStyles.display,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          FadeSlideIn(
            delay: const Duration(milliseconds: 110),
            child: Text(
              'Filipino comfort food and catering, '
              'cooked the way it always has been.',
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
