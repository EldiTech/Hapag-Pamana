import 'package:flutter/material.dart';

/// Gabay's identity mark — the brand fleuron (the same pinched four-point
/// ornament used across the seals and the dashboard) with a small companion
/// spark, in place of Material's generic `auto_awesome` AI sparkle. Drawn
/// with a painter so it scales crisply anywhere an [Icon] would sit.
class GabayMark extends StatelessWidget {
  const GabayMark({super.key, this.size = 22, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return CustomPaint(
      size: Size.square(size),
      painter: _GabayMarkPainter(color),
    );
  }
}

class _GabayMarkPainter extends CustomPainter {
  const _GabayMarkPainter(this.color);

  final Color color;

  /// The fleuron path (24-unit design grid), scaled to [s] at offset [o].
  static Path _fleuron(double s, Offset o) {
    double x(double v) => o.dx + v / 24 * s;
    double y(double v) => o.dy + v / 24 * s;
    return Path()
      ..moveTo(x(12), y(1.4))
      ..cubicTo(x(13.1), y(6.5), x(17.5), y(10.9), x(22.6), y(12))
      ..cubicTo(x(17.5), y(13.1), x(13.1), y(17.5), x(12), y(22.6))
      ..cubicTo(x(10.9), y(17.5), x(6.5), y(13.1), x(1.4), y(12))
      ..cubicTo(x(6.5), y(10.9), x(10.9), y(6.5), x(12), y(1.4))
      ..close();
  }

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.fill
      ..isAntiAlias = true;
    final s = size.shortestSide;
    // Main star sits bottom-left; the companion spark fills the top-right void.
    canvas.drawPath(_fleuron(s * 0.82, Offset(0, s * 0.18)), paint);
    canvas.drawPath(_fleuron(s * 0.38, Offset(s * 0.62, 0)), paint);
  }

  @override
  bool shouldRepaint(_GabayMarkPainter oldDelegate) =>
      oldDelegate.color != color;
}
