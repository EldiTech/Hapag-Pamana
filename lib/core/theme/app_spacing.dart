import 'package:flutter/material.dart';

/// Spacing scale — one rhythm for margins, paddings and gaps.
///
/// Built on a roughly 4pt grid. Prefer these tokens over raw numbers so the
/// whole app breathes at the same cadence. The [screen] and [section] semantic
/// tokens capture the two most-repeated layout measures.
class AppSpacing {
  AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;

  /// Horizontal inset at the edge of every screen's content.
  static const double screen = 20;

  /// Vertical gap between major page sections.
  static const double section = 28;

  // ── Gap helpers ───────────────────────────────────────────────────────────
  /// A vertical [SizedBox] of [height].
  static SizedBox vGap(double height) => SizedBox(height: height);

  /// A horizontal [SizedBox] of [width].
  static SizedBox hGap(double width) => SizedBox(width: width);
}
