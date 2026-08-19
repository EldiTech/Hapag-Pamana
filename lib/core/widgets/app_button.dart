import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/app_motion.dart';

/// A single, consistent call-to-action.
///
/// The button *styling* lives in [AppTheme] (the elevated/outlined button
/// themes); this widget packages the recurring conveniences so screens don't
/// reinvent them: an optional leading [icon], a [fullWidth] CTA, and a [busy]
/// state that crossfades the label into a small spinner while an async action
/// (sign-in, account creation, …) is in flight. Label / icon changes also
/// crossfade, so a CTA can settle into a success state ("LOG IN" → ✓ "WELCOME
/// BACK") without snapping.
enum AppButtonVariant {
  /// Solid coffee-brown CTA — the primary action on a screen.
  primary,

  /// Outlined, quieter action — secondary to a [primary].
  secondary,
}

class AppButton extends StatelessWidget {
  const AppButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.variant = AppButtonVariant.primary,
    this.fullWidth = false,
    this.busy = false,
  });

  /// Convenience constructor for the solid primary CTA.
  const AppButton.primary({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.fullWidth = false,
    this.busy = false,
  }) : variant = AppButtonVariant.primary;

  /// Convenience constructor for the outlined secondary action.
  const AppButton.secondary({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.fullWidth = false,
    this.busy = false,
  }) : variant = AppButtonVariant.secondary;

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final AppButtonVariant variant;
  final bool fullWidth;

  /// While true the label crossfades into a small spinner and taps are
  /// ignored; the theme's disabled colors signal the wait.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final spinnerColor = variant == AppButtonVariant.primary
        ? AppColors.onBrown
        : AppColors.brown;

    final Widget content = busy
        ? SizedBox(
            key: const ValueKey('busy'),
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2.2,
              color: spinnerColor,
            ),
          )
        : Row(
            key: ValueKey('label-$label-$icon'),
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 18),
                const SizedBox(width: 8),
              ],
              // Flexible + ellipsis: on a narrow screen (e.g. the wizard's
              // BACK + primary pair) a long label like "ACCOUNT CREATED"
              // would otherwise overflow the button's Row and paint the
              // yellow/black overflow stripes instead of just eliding.
              Flexible(
                child: Text(label, overflow: TextOverflow.ellipsis),
              ),
            ],
          );

    // AnimatedSize keeps the stadium from snapping wider/narrower as the
    // content swaps; the switcher fades + settles the new content in.
    final child = AnimatedSize(
      duration: Motion.base,
      curve: Motion.standard,
      child: AnimatedSwitcher(
        duration: Motion.base,
        switchInCurve: Motion.standard,
        switchOutCurve: Motion.exit,
        transitionBuilder: (child, animation) => FadeTransition(
          opacity: animation,
          child: ScaleTransition(
            scale: Tween<double>(begin: 0.9, end: 1.0).animate(animation),
            child: child,
          ),
        ),
        child: content,
      ),
    );

    final onTap = busy ? null : onPressed;
    final Widget button = switch (variant) {
      AppButtonVariant.primary => ElevatedButton(onPressed: onTap, child: child),
      AppButtonVariant.secondary =>
        OutlinedButton(onPressed: onTap, child: child),
    };

    if (!fullWidth) return button;
    return SizedBox(width: double.infinity, child: button);
  }
}
