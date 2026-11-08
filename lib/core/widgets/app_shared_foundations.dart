part of 'app_shared.dart';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• Shimmer infrastructure â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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
    colors: const [
      AppColors.shimmerBase,
      AppColors.shimmerHi,
      AppColors.shimmerBase,
    ],
    stops: const [0.28, 0.5, 0.72],
  );
}

/// Shared skeleton surface â€” paints the shimmer (or a static fill if there is
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

/// An image slot â€” front-end placeholder standing in for a real picture.
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
  const SkeletonLine({
    super.key,
    this.width,
    this.height = 12,
    this.radius = 6,
  });

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
