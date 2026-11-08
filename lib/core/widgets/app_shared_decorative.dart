part of 'app_shared.dart';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• Decorative â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
  /// vignette â€” the mismatch shows as a seam at the boundary. Flat cream
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

/// Three gently pulsing gold dots â€” a low-key loading indicator.
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
