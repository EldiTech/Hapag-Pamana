import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'brand.dart';
import 'core/widgets/app_card.dart';
import 'data/allergens.dart';
import 'data/announcement.dart';
import 'data/announcement_repository.dart';
import 'data/catering.dart';
import 'data/notification.dart';
import 'data/notification_repository.dart';
import 'data/product.dart';
import 'screens/user/announcement_popup_modal.dart';

// ═══════════════════════════ Shimmer infrastructure ═══════════════════════════
// A single repeating controller is shared with all skeleton leaves below it so
// their highlight sweeps stay in sync and cheap.
class ShimmerScope extends StatefulWidget {
  const ShimmerScope({super.key, required this.child});

  final Widget child;

  static Animation<double>? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_ShimmerData>()?.animation;

  @override
  State<ShimmerScope> createState() => _ShimmerScopeState();
}

class _ShimmerScopeState extends State<ShimmerScope>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1500),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) =>
      _ShimmerData(animation: _c, child: widget.child);
}

class _ShimmerData extends InheritedWidget {
  const _ShimmerData({required this.animation, required super.child});

  final Animation<double> animation;

  @override
  bool updateShouldNotify(_ShimmerData oldWidget) => false;
}

LinearGradient _shimmerGradient(double t) {
  final dx = t * 3.0 - 1.5; // sweep the band fully across and off both edges
  return LinearGradient(
    begin: Alignment(dx - 0.6, -0.4),
    end: Alignment(dx + 0.6, 0.4),
    colors: const [AppColors.shimmerBase, AppColors.shimmerHi, AppColors.shimmerBase],
    stops: const [0.28, 0.5, 0.72],
  );
}

/// Shared skeleton surface — paints the shimmer (or a static fill if there is
/// no ShimmerScope ancestor).
class _SkeletonSurface extends StatelessWidget {
  const _SkeletonSurface({
    this.width,
    this.height,
    this.radius,
    this.border = false,
    this.child,
  });

  final double? width;
  final double? height;
  final BorderRadius? radius;
  final bool border;
  final Widget? child;

  @override
  Widget build(BuildContext context) {
    final anim = ShimmerScope.of(context);
    Widget surface(Gradient? gradient, Color? color) => Container(
      width: width,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color,
        gradient: gradient,
        borderRadius: radius ?? BorderRadius.circular(8),
        border: border ? Border.all(color: AppColors.hairline) : null,
      ),
      child: child,
    );
    if (anim == null) return surface(null, AppColors.shimmerBase);
    return AnimatedBuilder(
      animation: anim,
      builder: (_, _) => surface(_shimmerGradient(anim.value), null),
    );
  }
}

/// An image slot — front-end placeholder standing in for a real picture.
class PlaceholderBox extends StatelessWidget {
  const PlaceholderBox({
    super.key,
    this.width,
    this.height,
    this.radius = AppRadius.lg,
    this.icon = Icons.image_outlined,
    this.showIcon = true,
  });

  final double? width;
  final double? height;
  final double radius;
  final IconData icon;
  final bool showIcon;

  @override
  Widget build(BuildContext context) {
    return _SkeletonSurface(
      width: width,
      height: height,
      radius: BorderRadius.circular(radius),
      border: true,
      child: showIcon
          ? Icon(icon, color: AppColors.brown.withValues(alpha: 0.18), size: 30)
          : null,
    );
  }
}

/// A rounded bar representing a single (not-yet-loaded) line of text.
class SkeletonLine extends StatelessWidget {
  const SkeletonLine({super.key, this.width, this.height = 12, this.radius = 6});

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) => _SkeletonSurface(
    width: width,
    height: height,
    radius: BorderRadius.circular(radius),
  );
}

/// A stack of skeleton lines representing a paragraph of body copy.
class SkeletonParagraph extends StatelessWidget {
  const SkeletonParagraph({
    super.key,
    this.lines = 3,
    this.lastWidthFactor = 0.55,
  });

  final int lines;
  final double lastWidthFactor;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: List.generate(lines, (i) {
        final last = i == lines - 1;
        return Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: FractionallySizedBox(
            alignment: Alignment.centerLeft,
            widthFactor: last ? lastWidthFactor : 1.0,
            child: const SkeletonLine(height: 11),
          ),
        );
      }),
    );
  }
}

/// Pill placeholder used for category chips / filters.
class PillPlaceholder extends StatelessWidget {
  const PillPlaceholder({super.key, this.width = 76});

  final double width;

  @override
  Widget build(BuildContext context) => _SkeletonSurface(
    width: width,
    height: 34,
    radius: BorderRadius.circular(20),
    border: true,
  );
}

/// Section title with an optional trailing "See all" affordance.
class SectionHeading extends StatelessWidget {
  const SectionHeading(this.title, {super.key, this.onSeeAll});

  final String title;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(title, style: AppTextStyles.heading),
        if (onSeeAll != null)
          TextButton(
            onPressed: onSeeAll,
            child: Text(
              'See all',
              style: AppTextStyles.sans(
                size: 11,
                weight: FontWeight.w600,
                color: AppColors.goldDeep,
                spacing: 0.5,
              ),
            ),
          ),
      ],
    );
  }
}

// ═══════════════════════════ Motion primitives ═══════════════════════════

/// A branded push transition: the incoming page fades + settles up a touch
/// while scaling from 0.96, the outgoing page eases back and dims slightly.
/// Quieter and warmer than the default platform slide — matches [Motion].
///
/// The transition itself lives in [brandPageTransition] so this route and the
/// theme's `pageTransitionsTheme` play exactly the same motion; a page pushed
/// either way looks identical.
class BrandPageRoute<T> extends PageRouteBuilder<T> {
  BrandPageRoute({required WidgetBuilder builder})
      : super(
          transitionDuration: Motion.entrance,
          reverseTransitionDuration: Motion.base,
          pageBuilder: (context, _, _) => builder(context),
          transitionsBuilder: (context, animation, secondary, child) =>
              brandPageTransition(animation, secondary, child),
        );
}

/// Cross-fades between the states of one slot — a skeleton settling into real
/// content, an error notice giving way to a list, a value being replaced.
///
/// Wraps [AnimatedSwitcher] with the app's motion tokens (fade + a whisper of
/// scale, [Motion.standard] in, [Motion.exit] out) so state changes across the
/// app read the same instead of every screen hand-rolling its own switcher.
/// Give each state a distinct `key` — that is what tells the switcher a swap
/// happened.
///
/// [resize] tweens the slot's height so a taller replacement grows into place;
/// leave it off inside an [Expanded]/sliver, where the slot's height is decided
/// by the parent and an [AnimatedSize] would fight it.
class SmoothSwap extends StatelessWidget {
  const SmoothSwap({
    super.key,
    required this.child,
    this.duration = Motion.base,
    this.alignment = Alignment.topCenter,
    this.resize = false,
    this.scaleFrom = 0.98,
  });

  final Widget child;
  final Duration duration;

  /// Where the outgoing and incoming states line up while they overlap.
  final AlignmentGeometry alignment;

  /// Tween the slot's height between states. See the class doc.
  final bool resize;

  /// How far the incoming state scales up from. 1.0 is a pure cross-fade.
  final double scaleFrom;

  @override
  Widget build(BuildContext context) {
    final switcher = AnimatedSwitcher(
      duration: duration,
      switchInCurve: Motion.standard,
      switchOutCurve: Motion.exit,
      layoutBuilder: (current, previous) => Stack(
        alignment: alignment,
        children: [
          ...previous,
          ?current,
        ],
      ),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: scaleFrom == 1.0
            ? child
            : ScaleTransition(
                scale: Tween<double>(begin: scaleFrom, end: 1.0)
                    .animate(animation),
                child: child,
              ),
      ),
      child: child,
    );

    if (!resize) return switcher;
    return AnimatedSize(
      duration: duration,
      curve: Motion.standard,
      alignment: alignment,
      child: switcher,
    );
  }
}

/// Fades and grows [child] into place when [visible] turns true, and collapses
/// it quietly away when it turns false — for the sections a screen shows
/// conditionally (a recommendation panel that only appears once there is
/// something to recommend, a filter row that depends on the data).
///
/// Use it in place of a bare `if (…) child`, which pops the section in and out
/// and jerks everything below it. The child stays built while hidden, so keep
/// it cheap — for an expensive subtree, guard it with the `if` instead.
class SmoothReveal extends StatelessWidget {
  const SmoothReveal({
    super.key,
    required this.visible,
    required this.child,
    this.duration = Motion.base,
    this.alignment = Alignment.topCenter,
  });

  final bool visible;
  final Widget child;
  final Duration duration;
  final AlignmentGeometry alignment;

  @override
  Widget build(BuildContext context) {
    return AnimatedCrossFade(
      duration: duration,
      sizeCurve: Motion.standard,
      firstCurve: Motion.exit,
      secondCurve: Motion.standard,
      alignment: alignment,
      crossFadeState:
          visible ? CrossFadeState.showSecond : CrossFadeState.showFirst,
      firstChild: const SizedBox(width: double.infinity, height: 0),
      secondChild: child,
    );
  }
}

/// The step-to-step transition for the booking wizards: the arriving step
/// fades in from the side it came from, so moving forward and stepping back
/// feel like different directions rather than the same blink.
///
/// Mirrors [TabTransition]'s language (a small horizontal travel, no bounce)
/// one level down, on the form inside a page.
class StepTransition extends StatelessWidget {
  const StepTransition({
    super.key,
    required this.step,
    required this.forward,
    required this.child,
  });

  /// The index of the step being shown — also the switcher's key.
  final int step;

  /// True when the wizard advanced to [step], false when it went back.
  final bool forward;

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final dx = forward ? 0.06 : -0.06;
    return AnimatedSwitcher(
      duration: Motion.base,
      switchInCurve: Motion.standard,
      switchOutCurve: Motion.exit,
      transitionBuilder: (child, animation) {
        // The outgoing step is the one whose animation is running backwards;
        // it leaves the way the incoming one arrives from, so the pair reads
        // as a single slide rather than two.
        return FadeTransition(
          opacity: animation,
          child: SlideTransition(
            position: Tween<Offset>(
              begin: Offset(dx, 0),
              end: Offset.zero,
            ).animate(animation),
            child: child,
          ),
        );
      },
      child: KeyedSubtree(key: ValueKey<int>(step), child: child),
    );
  }
}

/// Fades + slides its child up on mount, after an optional [delay]. Used to
/// stagger a screen's sections into view.
class FadeSlideIn extends StatefulWidget {
  const FadeSlideIn({
    super.key,
    required this.child,
    this.delay = Duration.zero,
    this.duration = Motion.slow,
    this.offsetY = 18,
  });

  final Widget child;
  final Duration delay;
  final Duration duration;
  final double offsetY;

  @override
  State<FadeSlideIn> createState() => _FadeSlideInState();
}

class _FadeSlideInState extends State<FadeSlideIn>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: widget.duration,
  );
  late final Animation<double> _a = CurvedAnimation(
    parent: _c,
    curve: Motion.standard,
  );
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    if (widget.delay == Duration.zero) {
      _c.forward();
    } else {
      _timer = Timer(widget.delay, () {
        if (mounted) _c.forward();
      });
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _a,
      builder: (_, child) => Opacity(
        opacity: _a.value,
        child: Transform.translate(
          offset: Offset(0, (1 - _a.value) * widget.offsetY),
          child: child,
        ),
      ),
      child: widget.child,
    );
  }
}

/// Plays a short fade + directional slide whenever the active tab [index]
/// changes. Wraps a live [IndexedStack] (passed as [child]) so the entrance
/// animates while every tab underneath stays mounted, preserving scroll offsets
/// and stream state. Shared by the guest and member shells.
class TabTransition extends StatefulWidget {
  const TabTransition({super.key, required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<TabTransition> createState() => _TabTransitionState();
}

class _TabTransitionState extends State<TabTransition>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: Motion.base,
  )..forward();

  late int _previous = widget.index;
  late Animation<double> _fade = _buildFade();
  late Animation<Offset> _slide = _buildSlide(forward: true);

  Animation<double> _buildFade() =>
      CurvedAnimation(parent: _c, curve: Motion.standard);

  Animation<Offset> _buildSlide({required bool forward}) {
    final dx = forward ? 0.06 : -0.06;
    return Tween<Offset>(
      begin: Offset(dx, 0),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _c, curve: Motion.standard));
  }

  @override
  void didUpdateWidget(TabTransition old) {
    super.didUpdateWidget(old);
    if (old.index != widget.index) {
      final forward = widget.index > _previous;
      _previous = widget.index;
      _fade = _buildFade();
      _slide = _buildSlide(forward: forward);
      _c
        ..reset()
        ..forward();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(position: _slide, child: widget.child),
    );
  }
}

/// An auto-advancing, infinitely-looping carousel.
///
/// The page slides forward on a fixed [interval], wrapping seamlessly (the
/// controller starts far from zero and only ever moves forward) and pausing
/// while the user is touching it — resuming on release. A single item shows
/// statically (no timer); an empty set collapses. Shared by the home Featured
/// strip and the catering Setups gallery so every auto-carousel in the app moves
/// to one rhythm.
class AutoCarousel extends StatefulWidget {
  const AutoCarousel({
    super.key,
    required this.itemCount,
    required this.itemBuilder,
    required this.height,
    this.viewportFraction = 0.85,
    this.itemPadding = 6,
    this.interval = const Duration(seconds: 3),
    this.slideDuration = const Duration(milliseconds: 600),
  });

  final int itemCount;

  /// Builds the item at a real index in `[0, itemCount)`.
  final Widget Function(BuildContext context, int index) itemBuilder;

  final double height;
  final double viewportFraction;
  final double itemPadding;

  /// How long each page rests before the next slides in.
  final Duration interval;

  /// How long the slide between pages takes.
  final Duration slideDuration;

  @override
  State<AutoCarousel> createState() => _AutoCarouselState();
}

class _AutoCarouselState extends State<AutoCarousel> {
  // Start far from 0 so the loop has room to run without ever hitting an edge.
  static const int _origin = 100000;

  PageController? _controller;
  Timer? _timer;

  bool get _canLoop => widget.itemCount > 1;

  @override
  void initState() {
    super.initState();
    _setUp();
  }

  @override
  void didUpdateWidget(covariant AutoCarousel old) {
    super.didUpdateWidget(old);
    // Rebuild the controller/timer when the count or cadence changes whether and
    // how the carousel can loop.
    if (old.itemCount != widget.itemCount ||
        old.viewportFraction != widget.viewportFraction ||
        old.interval != widget.interval) {
      _tearDown();
      _setUp();
    }
  }

  void _setUp() {
    if (widget.itemCount <= 0) return;
    _controller = PageController(
      initialPage: _canLoop ? _origin : 0,
      viewportFraction: widget.viewportFraction,
    );
    if (_canLoop) _startTimer();
  }

  void _startTimer() {
    _timer ??= Timer.periodic(widget.interval, (_) {
      final c = _controller;
      if (c != null && c.hasClients) {
        c.nextPage(duration: widget.slideDuration, curve: Curves.easeInOut);
      }
    });
  }

  void _pause() {
    _timer?.cancel();
    _timer = null;
  }

  void _resume() {
    if (_canLoop) _startTimer();
  }

  void _tearDown() {
    _timer?.cancel();
    _timer = null;
    _controller?.dispose();
    _controller = null;
  }

  @override
  void dispose() {
    _tearDown();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.itemCount <= 0) return const SizedBox.shrink();
    return SizedBox(
      height: widget.height,
      child: Listener(
        onPointerDown: (_) => _pause(),
        onPointerUp: (_) => _resume(),
        onPointerCancel: (_) => _resume(),
        child: PageView.builder(
          controller: _controller,
          itemCount: _canLoop ? null : widget.itemCount,
          itemBuilder: (context, index) {
            final real = index % widget.itemCount;
            return Padding(
              padding: EdgeInsets.symmetric(horizontal: widget.itemPadding),
              child: widget.itemBuilder(context, real),
            );
          },
        ),
      ),
    );
  }
}

/// Presents [builder]'s widget as a centered overlay that scales + fades up from
/// the middle of the screen — the app's one popup entrance, so dialogs read the
/// same whether opened from a menu card, a catering package or the account page.
/// Pair it with [AppDialogShell] for the standard framed, scrollable card.
///
/// Keyboard-safe: unlike Scaffold bodies, general-dialog routes don't avoid the
/// keyboard on their own, so the route pads itself by the view insets and the
/// dialog animates up whenever a field inside it summons the keyboard.
Future<T?> showCenterDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: AppColors.brown.withValues(alpha: 0.46),
    transitionDuration: Motion.base,
    // ModalRoute caches the page widget, so the inset lookup must live under a
    // Builder — a dependency taken on the pageBuilder context itself would
    // never see the keyboard appear.
    pageBuilder: (context, _, _) => Builder(
      builder: (context) => AnimatedPadding(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: builder(context),
      ),
    ),
    transitionBuilder: (context, animation, _, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: Motion.standard,
        reverseCurve: Motion.exit,
      );
      return FadeTransition(
        opacity: curved,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.92, end: 1.0).animate(curved),
          child: child,
        ),
      );
    },
  );
}

/// The standard centered-dialog frame: a parchment card holding a scrolling body
/// and an optional pinned [footer], with a quiet close button in the corner.
/// Sized to sit comfortably in the middle of the screen on any device. Use it as
/// the [showCenterDialog] child so every popup shares one shape.
class AppDialogShell extends StatelessWidget {
  const AppDialogShell({
    super.key,
    required this.children,
    this.footer,
    this.maxWidth = 460,
  });

  final List<Widget> children;
  final Widget? footer;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final maxHeight = MediaQuery.sizeOf(context).height * 0.86;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: maxHeight),
          child: Stack(
            children: [
              Material(
                color: AppColors.surface,
                clipBehavior: Clip.antiAlias,
                shape: RoundedRectangleBorder(
                  borderRadius: AppRadius.xlAll,
                  side: const BorderSide(color: AppColors.hairline),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(AppSpacing.xl),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: children,
                        ),
                      ),
                    ),
                    if (footer != null)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                          AppSpacing.xl,
                          0,
                          AppSpacing.xl,
                          AppSpacing.xl,
                        ),
                        child: footer!,
                      ),
                  ],
                ),
              ),
              const Positioned(
                top: AppSpacing.sm,
                right: AppSpacing.sm,
                child: _DialogCloseButton(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Quiet circular close affordance for [AppDialogShell] — sits over the card's
/// top-right corner and pops the dialog.
class _DialogCloseButton extends StatelessWidget {
  const _DialogCloseButton();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface.withValues(alpha: 0.86),
      shape: const CircleBorder(
        side: BorderSide(color: AppColors.hairline),
      ),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: () => Navigator.of(context).maybePop(),
        child: const Padding(
          padding: EdgeInsets.all(6),
          child: Icon(Icons.close, size: 18, color: AppColors.brown),
        ),
      ),
    );
  }
}

/// Notification bell icon button with an unread badge indicator.
/// Tapping opens the notifications modal dialog.
class NotificationIconButton extends StatelessWidget {
  const NotificationIconButton({
    super.key,
    this.hasUnread = true,
    this.onTap,
  });

  final bool hasUnread;
  final VoidCallback? onTap;

  void _openNotifications(BuildContext context) {
    if (onTap != null) {
      onTap!();
      return;
    }
    showNotificationsModal(context);
  }

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: () => _openNotifications(context),
      child: Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.surface,
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Badge(
          isLabelVisible: hasUnread,
          backgroundColor: AppColors.gold,
          smallSize: 7,
          offset: const Offset(1, -1),
          child: const Icon(
            Icons.notifications_outlined,
            size: 20,
            color: AppColors.brown,
          ),
        ),
      ),
    );
  }
}

/// Presents the live notifications modal dialog in a centered [AppDialogShell].
/// Streams all notifications from Firestore (personal + announcements) and
/// marks everything as read the moment the modal opens.
Future<void> showNotificationsModal(BuildContext context) {
  return showCenterDialog<void>(
    context: context,
    builder: (dialogContext) => const _NotificationsModalBody(),
  );
}

/// The stateful body of the notifications modal — owns the StreamBuilder so
/// mark-as-read can run once when the first list arrives.
class _NotificationsModalBody extends StatefulWidget {
  const _NotificationsModalBody();

  @override
  State<_NotificationsModalBody> createState() =>
      _NotificationsModalBodyState();
}

class _NotificationsModalBodyState extends State<_NotificationsModalBody> {
  bool _marked = false;

  @override
  Widget build(BuildContext context) {
    final repo = NotificationRepository();
    return StreamBuilder<List<AppNotification>>(
      stream: repo.watchAll(),
      builder: (context, snap) {
        final items = snap.data ?? [];
        final unread = items.where((n) => !n.isRead).length;

        // Mark all as read once on the first non-empty emission.
        if (items.isNotEmpty && !_marked) {
          _marked = true;
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => repo.markAllRead(items),
          );
        }

        return AppDialogShell(
          children: [
            // ── Header ───────────────────────────────────────────────────
            _NotifHeader(unread: unread),
            const SizedBox(height: AppSpacing.lg),

            // ── Content ───────────────────────────────────────────────────
            if (snap.connectionState == ConnectionState.waiting && items.isEmpty)
              const _NotifLoading()
            else if (items.isEmpty)
              const _NotifEmpty()
            else
              Column(
                children: [
                  for (int i = 0; i < items.length; i++) ...[
                    _NotificationItem(notification: items[i]),
                    if (i < items.length - 1)
                      const SizedBox(height: AppSpacing.sm),
                  ],
                ],
              ),
          ],
        );
      },
    );
  }
}

/// Styled header section for the notifications modal.
class _NotifHeader extends StatelessWidget {
  const _NotifHeader({required this.unread});
  final int unread;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Eyebrow + unread pill on the same row
        Row(
          children: [
            Text('NOTIFICATIONS', style: AppTextStyles.eyebrow),
            const Spacer(),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 300),
              transitionBuilder: (child, anim) => FadeTransition(
                opacity: anim,
                child: ScaleTransition(scale: anim, child: child),
              ),
              child: unread > 0
                  ? Container(
                      key: ValueKey(unread),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.goldDeep,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        '$unread unread',
                        style: AppTextStyles.sans(
                          size: 10,
                          weight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    )
                  : const SizedBox.shrink(key: ValueKey(0)),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text('Activity & Updates', style: AppTextStyles.title),
        const SizedBox(height: 6),
        Text(
          'Stay up to date with your kitchen orders and announcements.',
          style: AppTextStyles.bodySmall,
        ),
        const SizedBox(height: AppSpacing.md),
        // Warm gold gradient divider
        Container(
          height: 2,
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.gold, Colors.transparent],
              stops: [0.0, 1.0],
            ),
          ),
        ),
      ],
    );
  }
}

class _NotifLoading extends StatelessWidget {
  const _NotifLoading();
  @override
  Widget build(BuildContext context) => const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
        child: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.gold,
            ),
          ),
        ),
      );
}

class _NotifEmpty extends StatelessWidget {
  const _NotifEmpty();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      child: Column(
        children: [
          // Warm circle with bell icon
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.10),
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.gold.withValues(alpha: 0.25),
                width: 1.5,
              ),
            ),
            child: const Icon(
              Icons.notifications_none_outlined,
              size: 30,
              color: AppColors.goldDeep,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'All caught up!',
            style: AppTextStyles.sans(
              size: 15,
              weight: FontWeight.w700,
              color: AppColors.brown,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Order updates and announcements will appear here.',
            textAlign: TextAlign.center,
            style: AppTextStyles.sans(
              size: 12,
              color: AppColors.brownSoft,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}


class _NotificationItem extends StatelessWidget {
  const _NotificationItem({required this.notification});

  final AppNotification notification;

  IconData get _icon => switch (notification.type) {
        NotificationType.orderUpdate => Icons.receipt_long_outlined,
        NotificationType.promotion => Icons.local_offer_outlined,
        NotificationType.gabay => Icons.recommend_outlined,
      };

  String get _relativeTime {
    final diff = DateTime.now().difference(notification.createdAt);
    if (diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'Yesterday';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final isNew = !notification.isRead;
    return AppCard(
      onTap: () {
        if (notification.id.startsWith('ann-')) {
          final annId = notification.id.substring(4);
          final ann = AnnouncementRepository.instance.latest
              .cast<Announcement?>()
              .firstWhere(
                (a) => a?.id == annId,
                orElse: () => null,
              );
          if (ann != null) {
            Navigator.of(context).pop();
            AnnouncementPopupModal.show(context, announcements: [ann]);
          }
        }
      },
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isNew
                  ? AppColors.gold.withValues(alpha: 0.16)
                  : AppColors.placeholderFill,
              shape: BoxShape.circle,
            ),
            child: Icon(
              _icon,
              size: 18,
              color: isNew ? AppColors.goldDeep : AppColors.brownSoft,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        notification.title,
                        style: AppTextStyles.sans(
                          size: 13,
                          weight: FontWeight.w700,
                          color: AppColors.brown,
                        ),
                      ),
                    ),
                    if (isNew)
                      Container(
                        margin: const EdgeInsets.only(left: 6),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.gold.withValues(alpha: 0.2),
                          borderRadius: AppRadius.pillAll,
                        ),
                        child: Text(
                          'NEW',
                          style: AppTextStyles.sans(
                            size: 9,
                            weight: FontWeight.w700,
                            color: AppColors.goldDeep,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  notification.body,
                  style: AppTextStyles.sans(
                    size: 12,
                    color: AppColors.brownSoft,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  _relativeTime,
                  style: AppTextStyles.sans(
                    size: 10,
                    weight: FontWeight.w500,
                    color: AppColors.brownSoft.withValues(alpha: 0.6),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A small "Featured" pill laid over a dish photo — a clear, labelled mark
/// (star + engraved wordmark) rather than a bare icon that could read as a
/// favourite or rating. Shared by the Menu grid and the tap-to-view sheets.
class FeaturedTag extends StatelessWidget {
  const FeaturedTag({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(7, 4, 9, 4),
      decoration: BoxDecoration(
        color: AppColors.brown.withValues(alpha: 0.82),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.star_rounded, size: 12, color: AppColors.gold),
          const SizedBox(width: 4),
          Text(
            'FEATURED',
            style: AppTextStyles.engraved(
              size: 8,
              color: AppColors.cream,
              spacing: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// Adds a subtle press-scale to any tappable surface.
class PressableScale extends StatefulWidget {
  const PressableScale({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _set(true),
      onTapCancel: () => _set(false),
      onTapUp: (_) {
        _set(false);
        widget.onTap?.call();
      },
      child: AnimatedScale(
        scale: _down ? 0.97 : 1.0,
        duration: Motion.quick,
        curve: Motion.standard,
        child: widget.child,
      ),
    );
  }
}

// ═══════════════════════════ Product imagery ═══════════════════════════

/// Renders a product photo from either a network URL or an inline data URL,
/// falling back to a lettered tile when there's no image. Shared by the Menu
/// grid and the Home page's featured / kitchen cards so image handling stays
/// in one place.
class ProductImage extends StatelessWidget {
  const ProductImage(this.product, {super.key});

  final Product product;

  @override
  Widget build(BuildContext context) {
    final url = product.imageUrl;
    final bytes = product.imageBytes;

    Widget fallback() => _LetterTile(name: product.name);

    if (url != null) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const PlaceholderBox(radius: 12),
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return fallback();
  }
}

/// Opens [product]'s photo full-screen over a dimmed backdrop, pinch/drag
/// zoomable via [InteractiveViewer]. Tapping the backdrop or the image
/// dismisses it. No-ops when the product has no photo to show.
void showProductImageViewer(BuildContext context, Product product) {
  if (product.imageUrl == null && product.imageBytes == null) return;
  Navigator.of(context).push(
    PageRouteBuilder(
      opaque: false,
      barrierColor: Colors.black87,
      pageBuilder: (context, animation, secondaryAnimation) {
        return FadeTransition(
          opacity: animation,
          child: GestureDetector(
            onTap: () => Navigator.of(context).pop(),
            child: Scaffold(
              backgroundColor: Colors.transparent,
              body: SafeArea(
                child: Stack(
                  children: [
                    Center(
                      child: InteractiveViewer(
                        maxScale: 4,
                        child: ProductImage(product),
                      ),
                    ),
                    Positioned(
                      top: AppSpacing.sm,
                      right: AppSpacing.sm,
                      child: IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(Icons.close_rounded, color: Colors.white),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    ),
  );
}

/// Cover-fit image for a [CateringPackage] (remote URL or inline data URL),
/// with a branded letter-tile fallback. Mirrors [ProductImage].
class PackageImage extends StatelessWidget {
  const PackageImage(this.package, {super.key});

  final CateringPackage package;

  @override
  Widget build(BuildContext context) {
    final url = package.imageUrl;
    final bytes = package.imageBytes;

    Widget fallback() => _LetterTile(name: package.name);

    if (url != null) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const PlaceholderBox(radius: 12),
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return fallback();
  }
}

/// Cover-fit image for an [EventSetup] (remote URL or inline data URL), with a
/// branded letter-tile fallback. Mirrors [ProductImage].
class SetupImage extends StatelessWidget {
  const SetupImage(this.setup, {super.key});

  final EventSetup setup;

  @override
  Widget build(BuildContext context) {
    final url = setup.imageUrl;
    final bytes = setup.imageBytes;

    Widget fallback() => _LetterTile(name: setup.title);

    if (url != null) {
      return Image.network(
        url,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        loadingBuilder: (context, child, progress) =>
            progress == null ? child : const PlaceholderBox(radius: 12),
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    if (bytes != null) {
      return Image.memory(
        bytes,
        fit: BoxFit.cover,
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, _, _) => fallback(),
      );
    }
    return fallback();
  }
}

class _LetterTile extends StatelessWidget {
  const _LetterTile({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    final letter = (name.trim().isEmpty ? '?' : name.trim()[0]).toUpperCase();
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: const RadialGradient(
          center: Alignment(-0.2, -0.3),
          radius: 1.1,
          colors: [AppColors.surface, AppColors.creamEdge],
        ),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Text(
        letter,
        style: AppTextStyles.serif(
          size: 40,
          color: AppColors.gold,
          weight: FontWeight.w700,
        ),
      ),
    );
  }
}

// ═══════════════════════════ Decorative ═══════════════════════════

/// Soft parchment vignette used as a screen background.
class ParchmentBackground extends StatelessWidget {
  const ParchmentBackground({
    super.key,
    this.weave = false,
    this.vignette = true,
  });

  final bool weave;

  /// When false the ground is flat [AppColors.cream] instead of the radial
  /// vignette. Use it where the backdrop sits in a small box (e.g. an app bar)
  /// whose own radial centre would not line up with the full-screen body
  /// vignette — the mismatch shows as a seam at the boundary. Flat cream
  /// matches the body vignette's (pure-cream) top edge, so app bar and body
  /// read as one continuous ground.
  final bool vignette;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        DecoratedBox(
          // Near-uniform parchment: hold pure cream across most of the field
          // and let only the extreme corners darken. A stronger vignette made
          // the (static, non-scrolling) ground read brightest at the top, so
          // the immersive hero looked like a lighter colour block than the
          // content scrolling below it. Keeping the falloff to the edges lets
          // the hero and content sit on one continuous paper tone.
          decoration: vignette
              ? const BoxDecoration(
                  gradient: RadialGradient(
                    center: Alignment(0, -0.2),
                    radius: 1.2,
                    colors: [AppColors.cream, AppColors.creamEdge],
                    stops: [0.82, 1.0],
                  ),
                )
              : const BoxDecoration(color: AppColors.cream),
          child: const SizedBox.expand(),
        ),
        if (weave)
          const Positioned.fill(child: CustomPaint(painter: WeavePainter())),
      ],
    );
  }
}

/// Faint woven (banig) lattice texture.
class WeavePainter extends CustomPainter {
  const WeavePainter();

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = AppColors.brown.withValues(alpha: 0.028)
      ..strokeWidth = 1;
    const gap = 30.0;
    for (double x = -size.height; x < size.width; x += gap) {
      canvas.drawLine(Offset(x, 0), Offset(x + size.height, size.height), p);
      canvas.drawLine(Offset(x, size.height), Offset(x + size.height, 0), p);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// Three gently pulsing gold dots — a low-key loading indicator.
class LoadingDots extends StatefulWidget {
  const LoadingDots({super.key});

  @override
  State<LoadingDots> createState() => _LoadingDotsState();
}

class _LoadingDotsState extends State<LoadingDots>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  )..repeat();

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(3, (i) {
            final phase = _c.value * 2 * math.pi - i * 0.9;
            final t = (0.5 + 0.5 * math.sin(phase)).clamp(0.0, 1.0);
            return Container(
              margin: const EdgeInsets.symmetric(horizontal: 4),
              width: 7,
              height: 7,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.gold.withValues(alpha: 0.30 + 0.70 * t),
              ),
            );
          }),
        );
      },
    );
  }
}

// ═══════════════════════════ Allergen heatmap ═══════════════════════════

/// The shared heat ramp for an allergen intensity (0–1): soft gold → antique
/// gold → brick red. Mirrors the Content Moderator's `HP.allergenHeat()` so a
/// dish reads the same warmth in the app and the dashboard.
Color allergenHeatColor(double intensity) {
  final t = intensity.clamp(0.0, 1.0);
  const low = Color(0xFFE6D2A6); // faint gold — barely present
  const mid = AppColors.gold; // 0xFFAF854A
  const high = Color(0xFF9B3B2E); // brick red — pervasive & high-risk
  return t <= 0.5
      ? Color.lerp(low, mid, t / 0.5)!
      : Color.lerp(mid, high, (t - 0.5) / 0.5)!;
}

/// Ink that stays legible on a heat cell of the given intensity (cream once the
/// fill darkens past mid-gold, brown below). Public because anything painting an
/// allergen its own colour — the heatmap, the "contains" chips, the Menu's
/// dietary flags — needs the matching foreground.
Color onAllergenHeat(double intensity) =>
    intensity >= 0.5 ? AppColors.cream : AppColors.brown;

/// Names [allergens] as a phrase that reads inside a sentence — "peanut",
/// "peanut and shellfish", "peanut, shellfish and soy". Shared by the Menu's
/// dietary note and the dish sheet's warning, which say the same thing at
/// different sizes.
String allergenSentence(List<Allergen> allergens) {
  final names = [for (final a in allergens) a.label.toLowerCase()];
  if (names.length <= 1) return names.isEmpty ? '' : names.first;
  return '${names.take(names.length - 1).join(', ')} and ${names.last}';
}

/// A heatmap of the allergens actually present in an aggregated set of dishes.
/// Each present allergen is a cell whose warmth reflects frequency × severity;
/// allergens none of the dishes carry are omitted entirely, so the map only
/// ever names what a diner could actually encounter.
class AllergenHeatmap extends StatelessWidget {
  const AllergenHeatmap({super.key, required this.stats, this.showLegend = true});

  final List<AllergenStat> stats;
  final bool showLegend;

  @override
  Widget build(BuildContext context) {
    final present = [
      for (final s in stats)
        if (s.present) s,
    ];
    if (present.isEmpty) return const SizedBox.shrink();

    const cols = 3;
    const gap = AppSpacing.sm;
    // Fixed rows of Expanded cells rather than a Wrap of measured widths: the
    // grid can never rag into 2+1 rows when rounding leaves the row a fraction
    // of a pixel short.
    final rows = [
      for (var i = 0; i < present.length; i += cols)
        present.sublist(
          i,
          i + cols > present.length ? present.length : i + cols,
        ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var r = 0; r < rows.length; r++) ...[
          if (r > 0) const SizedBox(height: gap),
          Row(
            children: [
              for (var i = 0; i < cols; i++) ...[
                if (i > 0) const SizedBox(width: gap),
                Expanded(
                  child: i < rows[r].length
                      ? _AllergenCell(rows[r][i])
                      : const SizedBox.shrink(),
                ),
              ],
            ],
          ),
        ],
        if (showLegend) ...[
          const SizedBox(height: AppSpacing.md),
          const _HeatLegend(),
        ],
      ],
    );
  }
}

/// One allergen tile: its label and "n of total" tally, painted by intensity.
/// Only present allergens reach here — [AllergenHeatmap] omits the rest.
class _AllergenCell extends StatelessWidget {
  const _AllergenCell(this.stat);

  final AllergenStat stat;

  @override
  Widget build(BuildContext context) {
    final intensity = stat.intensity;
    final fg = onAllergenHeat(intensity);

    return Tooltip(
      message: '${stat.allergen.label} — in ${stat.count} of ${stat.total} '
          'dishes here',
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
        decoration: BoxDecoration(
          color: allergenHeatColor(intensity),
          borderRadius: AppRadius.smAll,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              stat.allergen.short,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w700,
                color: fg,
                spacing: 0.2,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              '${stat.count}/${stat.total}',
              style: AppTextStyles.sans(
                size: 10,
                weight: FontWeight.w600,
                color: fg.withValues(alpha: 0.85),
                spacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A slim "Less → More" gradient key beneath the heatmap, naming what the
/// warmth means (prevalence weighted by risk).
class _HeatLegend extends StatelessWidget {
  const _HeatLegend();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          'LESS',
          style: AppTextStyles.engraved(
            size: 8,
            color: AppColors.brownSoft,
            spacing: 1.2,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Container(
            height: 6,
            decoration: BoxDecoration(
              borderRadius: AppRadius.pillAll,
              gradient: LinearGradient(
                colors: [
                  allergenHeatColor(0.05),
                  allergenHeatColor(0.5),
                  allergenHeatColor(1.0),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text(
          'MORE',
          style: AppTextStyles.engraved(
            size: 8,
            color: AppColors.brownSoft,
            spacing: 1.2,
          ),
        ),
      ],
    );
  }
}

/// Solid chips naming exactly the allergens a single dish carries, each tinted
/// by its own risk weight (so a peanut chip reads hotter than a soy one). Used
/// in the dish detail sheet, above the category heatmap, so "what's in THIS
/// dish" is never confused with "what runs through the category".
class AllergenContainsChips extends StatelessWidget {
  const AllergenContainsChips({super.key, required this.keys});

  final List<String> keys;

  @override
  Widget build(BuildContext context) {
    final allergens = knownAllergens(keys);
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        for (final a in allergens)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
            decoration: BoxDecoration(
              color: allergenHeatColor(a.severity),
              borderRadius: AppRadius.pillAll,
            ),
            child: Text(
              a.label,
              style: AppTextStyles.sans(
                size: 11,
                weight: FontWeight.w600,
                color: onAllergenHeat(a.severity),
                spacing: 0.2,
              ),
            ),
          ),
      ],
    );
  }
}
