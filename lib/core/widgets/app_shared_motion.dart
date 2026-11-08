part of 'app_shared.dart';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• Motion primitives â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

/// A branded push transition: the incoming page fades + settles up a touch
/// while scaling from 0.96, the outgoing page eases back and dims slightly.
/// Quieter and warmer than the default platform slide â€” matches [Motion].
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

/// Cross-fades between the states of one slot â€” a skeleton settling into real
/// content, an error notice giving way to a list, a value being replaced.
///
/// Wraps [AnimatedSwitcher] with the app's motion tokens (fade + a whisper of
/// scale, [Motion.standard] in, [Motion.exit] out) so state changes across the
/// app read the same instead of every screen hand-rolling its own switcher.
/// Give each state a distinct `key` â€” that is what tells the switcher a swap
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
      layoutBuilder: (current, previous) =>
          Stack(alignment: alignment, children: [...previous, ?current]),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: scaleFrom == 1.0
            ? child
            : ScaleTransition(
                scale: Tween<double>(
                  begin: scaleFrom,
                  end: 1.0,
                ).animate(animation),
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
/// it quietly away when it turns false â€” for the sections a screen shows
/// conditionally (a recommendation panel that only appears once there is
/// something to recommend, a filter row that depends on the data).
///
/// Use it in place of a bare `if (â€¦) child`, which pops the section in and out
/// and jerks everything below it. The child stays built while hidden, so keep
/// it cheap â€” for an expensive subtree, guard it with the `if` instead.
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
      crossFadeState: visible
          ? CrossFadeState.showSecond
          : CrossFadeState.showFirst,
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

  /// The index of the step being shown â€” also the switcher's key.
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
/// while the user is touching it â€” resuming on release. A single item shows
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
/// the middle of the screen â€” the app's one popup entrance, so dialogs read the
/// same whether opened from a menu card, a catering package or the account page.
/// Pair it with [AppDialogShell] for the standard framed, scrollable card.
///
/// Keyboard-safe: unlike Scaffold bodies, general-dialog routes don't avoid the
/// keyboard on their own, so the route pads itself by the view insets and the
/// dialog animates up whenever a field inside it summons the keyboard.
