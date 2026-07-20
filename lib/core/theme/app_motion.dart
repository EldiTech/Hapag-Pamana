import 'package:flutter/material.dart';

/// Motion tokens — one rhythm for the whole app, the way [AppColors] is one
/// palette. The brand is heritage and warmth, so motion is deliberate and
/// *settling*: things ease in to rest, exits stay quiet, and nothing bounces.
/// Prefer these over ad-hoc [Duration]s / [Curve]s so timing stays consistent.
class Motion {
  Motion._();

  // ── Durations ───────────────────────────────────────────────────────────--
  /// Taps, toggles, press feedback — barely-there.
  static const Duration quick = Duration(milliseconds: 120);

  /// The default for most transitions (tab switches, container tweens).
  static const Duration base = Duration(milliseconds: 300);

  /// Section reveals and staggered entrances.
  static const Duration slow = Duration(milliseconds: 480);

  /// First-paint / hero moments — the logo settling into place.
  static const Duration entrance = Duration(milliseconds: 640);

  // ── Curves ────────────────────────────────────────────────────────────────
  /// Signature settle — arrivals, slides, content easing in to rest.
  static const Curve standard = Curves.easeOutCubic;

  /// Quiet departure — exits and dismissals never draw attention.
  static const Curve exit = Curves.easeIn;
}
