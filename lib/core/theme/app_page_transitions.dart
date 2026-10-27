import 'package:flutter/material.dart';

import 'app_motion.dart';

/// The app's single push/pop transition, in one place.
///
/// The incoming page fades and settles up a touch while scaling from 0.96; the
/// page it covers eases back and dims. Quieter and warmer than the platform
/// slide or Android's zoom — it matches [Motion]'s "arrive and settle" rhythm.
///
/// Two things consume it, so a route gets the same motion whichever way it was
/// pushed: [BrandPageTransitionsBuilder] (wired into
/// [AppTheme.light]'s `pageTransitionsTheme`, so *any* route that doesn't bring
/// its own transition — a [MaterialPageRoute], a framework-pushed page — picks
/// it up), and `BrandPageRoute`, which screens push directly.
Widget brandPageTransition(
  Animation<double> animation,
  Animation<double> secondaryAnimation,
  Widget child,
) {
  final enter = CurvedAnimation(
    parent: animation,
    curve: Motion.standard,
    reverseCurve: Motion.exit,
  );
  // The page being covered eases back and dims a little.
  final leave = CurvedAnimation(
    parent: secondaryAnimation,
    curve: Motion.standard,
    reverseCurve: Motion.exit,
  );

  return FadeTransition(
    opacity: enter,
    child: SlideTransition(
      position: Tween<Offset>(
        begin: const Offset(0, 0.04),
        end: Offset.zero,
      ).animate(enter),
      child: ScaleTransition(
        scale: Tween<double>(begin: 0.96, end: 1.0).animate(enter),
        child: FadeTransition(
          opacity: Tween<double>(begin: 1.0, end: 0.0).animate(leave),
          child: ScaleTransition(
            scale: Tween<double>(begin: 1.0, end: 1.04).animate(leave),
            child: child,
          ),
        ),
      ),
    ),
  );
}

/// Makes [brandPageTransition] the default for every platform, so no route in
/// the app can fall back to a stock Material/Cupertino page animation.
class BrandPageTransitionsBuilder extends PageTransitionsBuilder {
  const BrandPageTransitionsBuilder();

  @override
  Widget buildTransitions<T>(
    PageRoute<T>? route,
    BuildContext? context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
    Widget child,
  ) =>
      brandPageTransition(animation, secondaryAnimation, child);
}
