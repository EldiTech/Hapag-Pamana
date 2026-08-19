import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Gabay's identity mark — the tour-guide figure from `Assets/Gabay.svg`,
/// tinted to whatever [color] the call site needs (the seals, the dashboard
/// entry point, the chat header).
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
