import 'dart:async';

import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/format.dart';
import '../core/widgets/app_widgets.dart';
import '../data/catering.dart';
import '../data/catering_repository.dart';
import '../widgets.dart';
import 'detail_sheets.dart';

/// Booking channels shown in the "Book us now" sheet. Fill these with the
/// business's real details; empty values are hidden. (Tap-to-call / tap-to-mail
/// needs `url_launcher` — left out for now, so the values are copy-able text.)
const String _bookingPhone = '';
const String _bookingEmail = '';
const String _bookingFacebook = '';

/// Setups carousel cadence. 2s lets each setup rest long enough to read its
/// title while still feeling lively; the shared [AutoCarousel] handles the
/// slide and the seamless loop.
const Duration _kSetupAutoAdvance = Duration(seconds: 2);

/// Catering screen — a gallery of event setups up top, then the live `packages`
/// collection, closing on a "Book us now" call to action. Both lists stream
/// live from the [CateringRepository] (the moderator's Firestore content).
class CateringPage extends StatefulWidget {
  const CateringPage({super.key});

  @override
  State<CateringPage> createState() => _CateringPageState();
}

class _CateringPageState extends State<CateringPage> {
  final CateringRepository _repo = CateringRepository();
  StreamSubscription<List<CateringPackage>>? _pkgSub;
  StreamSubscription<List<EventSetup>>? _setupSub;

  List<CateringPackage> _packages = const [];
  bool _pkgLoading = true;
  bool _pkgError = false;

  List<EventSetup> _setups = const [];
  bool _setupLoading = true;

  /// Which package family the toggle is showing — catering by default.
  bool _showFoodPacks = false;

  @override
  void initState() {
    super.initState();
    _pkgSub = _repo.watchPackages().listen(
      (data) {
        if (!mounted) return;
        setState(() {
          _packages = data;
          _pkgLoading = false;
          _pkgError = false;
        });
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _pkgLoading = false;
          _pkgError = true;
        });
      },
    );
    _setupSub = _repo.watchSetups().listen(
      (data) {
        if (!mounted) return;
        setState(() {
          _setups = data;
          _setupLoading = false;
        });
      },
      onError: (_) {
        if (!mounted) return;
        setState(() => _setupLoading = false);
      },
    );
  }

  @override
  void dispose() {
    _pkgSub?.cancel();
    _setupSub?.cancel();
    super.dispose();
  }

  Duration _d(int ms) => Duration(milliseconds: ms);

  @override
  Widget build(BuildContext context) {
    final showSetups = _setupLoading || _setups.isNotEmpty;
    final catering = _packages.where((p) => !p.isFoodPack).toList();
    final foodPacks = _packages.where((p) => p.isFoodPack).toList();

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        0,
        AppSpacing.lg,
        0,
        AppSpacing.section,
      ),
      children: [
        // ── Event setups — a photo gallery up top ──────────────────────
        if (showSetups) ...[
          FadeSlideIn(
            child: const Padding(
              padding: EdgeInsets.symmetric(horizontal: AppSpacing.screen),
              child: SectionHeading('Our Setups'),
            ),
          ),
          const SizedBox(height: 14),
          FadeSlideIn(
            delay: _d(60),
            child: _SetupCarousel(loading: _setupLoading, setups: _setups),
          ),
          const SizedBox(height: AppSpacing.section),
        ],

        // ── Packages — one shelf with a family toggle ──────────────────
        FadeSlideIn(
          delay: _d(120),
          child: const Padding(
            padding: EdgeInsets.symmetric(horizontal: AppSpacing.screen),
            child: SectionHeading('Our Packages'),
          ),
        ),
        const SizedBox(height: 14),
        FadeSlideIn(
          delay: _d(150),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
            child: _FamilyToggle(
              foodPacks: _showFoodPacks,
              onChanged: (v) => setState(() => _showFoodPacks = v),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        _PackagesSection(
          loading: _pkgLoading,
          error: _pkgError,
          packages: _showFoodPacks ? foodPacks : catering,
          onView: _openPackage,
          emptyLabel: _showFoodPacks
              ? 'Food pack packages are on their way — check back soon.'
              : 'Catering packages are on their way — check back soon.',
        ),

        const SizedBox(height: AppSpacing.section),

        // ── Book us now ────────────────────────────────────────────────
        FadeSlideIn(
          delay: _d(200),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
            child: _BookCta(onBook: () => _openBooking(context)),
          ),
        ),
      ],
    );
  }

  void _openPackage(CateringPackage pkg) {
    showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => _PackageDetail(
        pkg: pkg,
        onBook: () {
          Navigator.of(dialogContext).pop();
          _openBooking(context);
        },
      ),
    );
  }

  void _openBooking(BuildContext context) {
    final contacts = <(IconData, String, String)>[
      if (_bookingPhone.isNotEmpty)
        (Icons.phone_outlined, 'Call or text', _bookingPhone),
      if (_bookingEmail.isNotEmpty)
        (Icons.mail_outline, 'Email', _bookingEmail),
      if (_bookingFacebook.isNotEmpty)
        (Icons.facebook_outlined, 'Facebook', _bookingFacebook),
    ];

    showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => AppDialogShell(
        footer: AppButton.primary(
          label: 'DONE',
          fullWidth: true,
          onPressed: () => Navigator.of(dialogContext).pop(),
        ),
        children: [
          Text('BOOK US NOW', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          Text("Let's plan your celebration", style: AppTextStyles.title),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Send us your date and headcount and we\'ll help you choose '
            'the right package — then take care of the feast.',
            style: AppTextStyles.body,
          ),
          if (contacts.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            for (final (icon, label, value) in contacts) ...[
              _ContactRow(icon: icon, label: label, value: value),
              const SizedBox(height: AppSpacing.md),
            ],
          ],
        ],
      ),
    );
  }
}

// ════════════════════════════ Setups carousel ════════════════════════════
/// Auto-advancing photo gallery of event setups. Delegates the looping, the
/// auto-advance and the pause-on-touch behaviour to the shared [AutoCarousel];
/// this wrapper just supplies the loading skeleton and the setup cards.
class _SetupCarousel extends StatelessWidget {
  const _SetupCarousel({required this.loading, required this.setups});

  final bool loading;
  final List<EventSetup> setups;

  static const double _height = 220;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return SizedBox(
        height: _height,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
          itemCount: 3,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, _) => const SizedBox(
            width: 280,
            child: PlaceholderBox(radius: AppRadius.xl),
          ),
        ),
      );
    }

    if (setups.isEmpty) return const SizedBox.shrink();

    return AutoCarousel(
      height: _height,
      itemCount: setups.length,
      viewportFraction: 0.82,
      interval: _kSetupAutoAdvance,
      itemBuilder: (context, i) => _SetupCard(
        setups[i],
        onTap: () => showSetupSheet(context, setups[i]),
      ),
    );
  }
}

class _SetupCard extends StatelessWidget {
  const _SetupCard(this.setup, {required this.onTap});

  final EventSetup setup;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      padding: EdgeInsets.zero,
      radius: AppRadius.xl,
      clip: true,
      child: Stack(
        fit: StackFit.expand,
        children: [
          SetupImage(setup),
          // Scrim so the title stays legible over any photo.
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.transparent,
                  AppColors.brown.withValues(alpha: 0.72),
                ],
                stops: const [0.45, 1.0],
              ),
            ),
          ),
          Positioned(
            left: 16,
            right: 16,
            bottom: 14,
            child: Text(
              setup.title,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.serif(
                size: 16,
                color: AppColors.cream,
                height: 1.15,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════ Packages ════════════════════════════
/// Two-button family filter — Catering Packages vs Food Packs. One segment is
/// always active; picking one swaps which family the grid below shows. Styled
/// after the menu tab's category chips: brown fill for the active segment,
/// quiet parchment for the resting one.
class _FamilyToggle extends StatelessWidget {
  const _FamilyToggle({required this.foodPacks, required this.onChanged});

  /// True when the Food Packs segment is active.
  final bool foodPacks;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget segment(String label, bool value) {
      final selected = foodPacks == value;
      return Expanded(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => onChanged(value),
          child: AnimatedContainer(
            duration: Motion.quick,
            height: 40,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? AppColors.brown : Colors.transparent,
              borderRadius: AppRadius.pillAll,
            ),
            child: Text(
              label,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                color: selected ? AppColors.onBrown : AppColors.brownSoft,
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(
        children: [
          segment('Catering Packages', false),
          segment('Food Packs', true),
        ],
      ),
    );
  }
}

/// The active family's packages as a two-column grid of compact medallion
/// tiles — emblem, name, price and minimum, with the full story one tap away.
class _PackagesSection extends StatelessWidget {
  const _PackagesSection({
    required this.loading,
    required this.error,
    required this.packages,
    required this.onView,
    required this.emptyLabel,
  });

  final bool loading;
  final bool error;
  final List<CateringPackage> packages;
  final void Function(CateringPackage) onView;

  /// Family-specific quiet copy for when this shelf has nothing published yet.
  final String emptyLabel;

  /// Fixed grid-tile height: card padding + medallion + two name lines +
  /// price block + minimum caption + optional eligibility line, with a little
  /// slack for font metrics.
  static const double _tileExtent = 228;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Expanded(child: FadeSlideIn(child: _PackageSkeleton())),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: FadeSlideIn(
                delay: const Duration(milliseconds: 80),
                child: const _PackageSkeleton(),
              ),
            ),
          ],
        ),
      );
    }

    if (error || packages.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
        child: AppCard(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.xxl - 2),
          child: Column(
            children: [
              Icon(
                error ? Icons.cloud_off_outlined : Icons.room_service_outlined,
                size: 32,
                color: AppColors.brown.withValues(alpha: 0.3),
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                error ? 'Couldn\'t load packages. Please try again.' : emptyLabel,
                textAlign: TextAlign.center,
                style: AppTextStyles.body,
              ),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screen),
      child: GridView.builder(
        // The page's outer ListView scrolls; the grid just lays out.
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: AppSpacing.md,
          mainAxisSpacing: AppSpacing.md,
          mainAxisExtent: _tileExtent,
        ),
        itemCount: packages.length,
        itemBuilder: (_, i) => FadeSlideIn(
          // Keyed by package so switching the family toggle replays the
          // entrance; staggered per row so long grids never feel sluggish.
          key: ValueKey(packages[i].id),
          delay: Duration(milliseconds: 60 * (i ~/ 2).clamp(0, 4)),
          child: _PackageCard(packages[i], onTap: () => onView(packages[i])),
        ),
      ),
    );
  }
}

/// One package as a compact grid tile: the gold-ringed emblem medallion up
/// top, the name in full, then the price and minimum anchored to the bottom
/// so every tile in a row lines up. Tapping opens the detail sheet.
class _PackageCard extends StatelessWidget {
  const _PackageCard(this.pkg, {required this.onTap});

  final CateringPackage pkg;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final minLabel = pkg.minPax > 0
        ? (pkg.isFoodPack ? 'MIN ${pkg.minPax} ORDERS' : 'MIN ${pkg.minPax} PAX')
        : null;

    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.lg,
      ),
      child: Column(
        children: [
          _PackageMedallion(pkg: pkg, size: 68),
          const SizedBox(height: 10),
          Text(
            pkg.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: AppTextStyles.cardTitle,
          ),
          const Spacer(),
          if (pkg.price > 0) ...[
            Text(
              peso(pkg.price),
              style: AppTextStyles.serif(
                size: 18,
                weight: FontWeight.w700,
                color: AppColors.goldDeep,
              ),
            ),
            Text(
              _priceUnit(pkg),
              style: AppTextStyles.sans(size: 10, color: AppColors.brownSoft),
            ),
            const SizedBox(height: 6),
          ],
          if (minLabel != null) Text(minLabel, style: AppTextStyles.caption),
          if (pkg.isInstitutional) ...[
            const SizedBox(height: 4),
            // Scaled down if a narrow tile can't fit the full line.
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                'CHURCH · GOVERNMENT · SCHOOL',
                style: AppTextStyles.engraved(
                  size: 8,
                  spacing: 0.6,
                  color: AppColors.brownSoft,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The package artwork in a gold-ringed circular frame. The emblems the
/// moderator uploads are round seals on a square canvas, so a circle shows
/// them whole where a cover-fit banner used to crop them.
class _PackageMedallion extends StatelessWidget {
  const _PackageMedallion({required this.pkg, this.size = 84});

  final CateringPackage pkg;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: AppColors.surface,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
      ),
      child: ClipOval(child: PackageImage(pkg)),
    );
  }
}

/// Read-only detail sheet for a tapped package — the full picture, price,
/// inclusions and standard services that the card only teases.
class _PackageDetail extends StatelessWidget {
  const _PackageDetail({required this.pkg, required this.onBook});

  final CateringPackage pkg;
  final VoidCallback onBook;

  @override
  Widget build(BuildContext context) {
    return AppDialogShell(
      footer: AppButton.primary(
        label: 'BOOK US NOW',
        icon: Icons.event_available_outlined,
        fullWidth: true,
        onPressed: onBook,
      ),
      children: [
        // Centered medallion header — the same seal treatment as the cards,
        // so the emblem is never cropped by a wide banner.
        Center(child: _PackageMedallion(pkg: pkg, size: 124)),
        const SizedBox(height: AppSpacing.lg),
        Text(
          pkg.isFoodPack ? 'FOOD PACK' : 'CATERING PACKAGE',
          textAlign: TextAlign.center,
          style: AppTextStyles.caption,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(pkg.name, textAlign: TextAlign.center, style: AppTextStyles.heading),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          alignment: WrapAlignment.center,
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: AppSpacing.md,
          runSpacing: 4,
          children: [
            if (pkg.price > 0)
              Text(
                '${peso(pkg.price)} ${_priceUnit(pkg)}',
                style: AppTextStyles.sans(
                  size: 13,
                  weight: FontWeight.w600,
                  color: AppColors.goldDeep,
                ),
              ),
            if (pkg.minPax > 0)
              Text(
                pkg.isFoodPack
                    ? 'Minimum ${pkg.minPax} orders'
                    : 'Minimum ${pkg.minPax} pax',
                style: AppTextStyles.bodySmall,
              ),
          ],
        ),
        if (pkg.isInstitutional) ...[
          const SizedBox(height: AppSpacing.md),
          Text(
            'FOR CHURCH, GOVERNMENT & SCHOOL FUNCTIONS ONLY',
            textAlign: TextAlign.center,
            style: AppTextStyles.caption,
          ),
        ],
        if (pkg.inclusions.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xl),
          Text('INCLUSIONS', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.md),
          for (final item in pkg.inclusions) _CheckLine(text: item),
        ],
        if (pkg.standardServices.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xl),
          Text('STANDARD SERVICES', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.md),
          for (final item in pkg.standardServices)
            _CheckLine(text: item, muted: true),
        ],
      ],
    );
  }
}

class _CheckLine extends StatelessWidget {
  const _CheckLine({required this.text, this.muted = false});

  final String text;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Icon(
              Icons.check,
              size: 15,
              color: muted ? AppColors.brownSoft : AppColors.goldDeep,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: muted ? AppTextStyles.bodySmall : AppTextStyles.body,
            ),
          ),
        ],
      ),
    );
  }
}

class _PackageSkeleton extends StatelessWidget {
  const _PackageSkeleton();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.lg,
      ),
      child: Column(
        children: const [
          PlaceholderBox(width: 68, height: 68, radius: 34, showIcon: false),
          SizedBox(height: 12),
          SkeletonLine(width: 110, height: 14),
          SizedBox(height: 10),
          SkeletonLine(width: 70, height: 14),
        ],
      ),
    );
  }
}

// ════════════════════════════ Book us now ════════════════════════════
class _BookCta extends StatelessWidget {
  const _BookCta({required this.onBook});

  final VoidCallback onBook;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xxl - 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('READY WHEN YOU ARE', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          Text("Let's make it memorable.", style: AppTextStyles.heading),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Tell us the date and the headcount — we\'ll handle the rest.',
            style: AppTextStyles.body,
          ),
          const SizedBox(height: AppSpacing.lg),
          AppButton.primary(
            label: 'BOOK US NOW',
            icon: Icons.event_available_outlined,
            fullWidth: true,
            onPressed: onBook,
          ),
        ],
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.gold.withValues(alpha: 0.14),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, size: 19, color: AppColors.goldDeep),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: AppTextStyles.label),
              const SizedBox(height: 2),
              SelectableText(value, style: AppTextStyles.body),
            ],
          ),
        ),
      ],
    );
  }
}

/// What a package's price buys — food packs are priced per pack, catering
/// packages per head.
String _priceUnit(CateringPackage pkg) =>
    pkg.isFoodPack ? 'per pack' : 'per head';

