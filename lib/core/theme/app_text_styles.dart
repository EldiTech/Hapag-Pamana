import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';

/// Typography for the brand — one type system for the whole app.
///
/// Three families, each with a job:
///  • **Playfair Display** (serif) — headings, dish names, hero lines.
///  • **Montserrat** (sans) — body copy, labels and all UI text.
///  • **Cinzel** (engraved Roman small-caps) — eyebrow / accent labels that echo
///    the logo's "FOOD INDUSTRY" ring.
///
/// Use the named ramp ([display], [heading], [body], [eyebrow], …) for common
/// roles; fall back to the [serif] / [sans] / [engraved] builders for one-off
/// sizes so font sizes are never invented inline without intent.
class AppTextStyles {
  AppTextStyles._();

  // ── Builders ──────────────────────────────────────────────────────────────
  static TextStyle serif({
    double size = 20,
    FontWeight weight = FontWeight.w600,
    Color color = AppColors.brown,
    bool italic = false,
    double height = 1.15,
    double spacing = 0,
  }) => GoogleFonts.playfairDisplay(
    fontSize: size,
    fontWeight: weight,
    color: color,
    fontStyle: italic ? FontStyle.italic : FontStyle.normal,
    height: height,
    letterSpacing: spacing,
  );

  static TextStyle sans({
    double size = 13,
    FontWeight weight = FontWeight.w500,
    Color color = AppColors.brown,
    double spacing = 0.2,
    double height = 1.3,
  }) => GoogleFonts.montserrat(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: spacing,
    height: height,
  );

  static TextStyle engraved({
    double size = 11,
    FontWeight weight = FontWeight.w600,
    Color color = AppColors.brown,
    double spacing = 2,
  }) => GoogleFonts.cinzel(
    fontSize: size,
    fontWeight: weight,
    color: color,
    letterSpacing: spacing,
  );

  // ── Named ramp ──────────────────────────────────────────────────────────--
  /// Hero display line (e.g. the home header).
  static TextStyle get display => serif(size: 30, height: 1.12);

  /// Large screen title (e.g. the Log In screen heading).
  static TextStyle get displaySmall => serif(size: 26);

  /// Section headings and app-bar titles.
  static TextStyle get heading => serif(size: 20);

  /// Empty-state / message titles.
  static TextStyle get title => serif(size: 18);

  /// Card titles (dish names in the menu grid).
  static TextStyle get cardTitle => serif(size: 15, height: 1.2);

  /// Default body copy (muted ink, comfortable line-height).
  static TextStyle get body =>
      sans(size: 13, color: AppColors.brownSoft, height: 1.45);

  /// Smaller secondary copy.
  static TextStyle get bodySmall =>
      sans(size: 12, color: AppColors.brownSoft, height: 1.4);

  /// Form / field labels.
  static TextStyle get label =>
      sans(size: 12, weight: FontWeight.w600, color: AppColors.brownSoft);

  /// Engraved eyebrow above a heading.
  static TextStyle get eyebrow =>
      engraved(size: 11, color: AppColors.goldDeep, spacing: 2);

  /// Small engraved caption (e.g. category labels on cards).
  static TextStyle get caption =>
      engraved(size: 10, color: AppColors.goldDeep, spacing: 1.2);
}
