import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Gabay's identity mark — a wayfinding star rising from an open menu book.
/// The mark stays intentionally simple so it remains legible in the nav bar,
/// the chat header, and the recommendation seals.
class GabayMark extends StatelessWidget {
  const GabayMark({super.key, this.size = 22, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      'Assets/Gabay.svg',
      width: size,
      height: size,
      colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
    );
  }
}
