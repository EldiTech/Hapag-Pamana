import 'package:flutter/material.dart';

import '../../widgets.dart' show PressableScale;
import '../theme/app_colors.dart';
import '../theme/app_radius.dart';
import '../theme/app_spacing.dart';

/// The one card surface for the whole app.
///
/// Replaces the `Container(decoration: BoxDecoration(color: surface, border:
/// hairline, borderRadius: …))` block that was copy-pasted across the home,
/// menu, catering and about screens. By default it is a flat, paper-like
/// parchment surface defined by a hairline border (no shadow) — the heritage
/// look. Pass [onTap] to make it pressable (it wraps itself in a
/// [PressableScale]); pass [gradient] for the inverted brown/olive variant used
/// by the catering invitation; pass [elevated] for a soft lift when a card
/// genuinely needs to float.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.md),
    this.radius,
    this.color,
    this.gradient,
    this.border = true,
    this.elevated = false,
    this.clip = false,
    this.width,
    this.height,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;

  /// Corner radius; defaults to [AppRadius.lg] (the standard card curvature).
  final double? radius;

  /// Solid fill; defaults to [AppColors.surface]. Ignored when [gradient] is set.
  final Color? color;

  /// Optional gradient fill (e.g. the brown→olive catering invite). When set,
  /// the hairline border is dropped.
  final Gradient? gradient;

  /// Whether to draw the hairline border (only when [gradient] is null).
  final bool border;

  /// Adds a soft, warm shadow for cards that need to float above the parchment.
  final bool elevated;

  /// Clips the child to the rounded corners — needed when a child image bleeds
  /// to the card edges.
  final bool clip;

  final double? width;
  final double? height;

  /// When provided, the card becomes tappable with a subtle press-scale.
  final VoidCallback? onTap;

  static const List<BoxShadow> _softShadow = [
    BoxShadow(
      color: AppColors.shadow,
      blurRadius: 18,
      offset: Offset(0, 8),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final borderRadius = BorderRadius.circular(radius ?? AppRadius.lg);

    final card = Container(
      width: width,
      height: height,
      padding: padding,
      clipBehavior: clip ? Clip.antiAlias : Clip.none,
      decoration: BoxDecoration(
        color: gradient == null ? (color ?? AppColors.surface) : null,
        gradient: gradient,
        borderRadius: borderRadius,
        border: (border && gradient == null)
            ? Border.all(color: AppColors.hairline)
            : null,
        boxShadow: elevated ? _softShadow : null,
      ),
      child: child,
    );

    if (onTap == null) return card;
    return PressableScale(onTap: onTap, child: card);
  }
}
