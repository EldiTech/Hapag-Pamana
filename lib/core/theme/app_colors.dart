import 'package:flutter/material.dart';

/// HapagPamana brand palette — the "Heirloom Editorial" system.
///
/// Warm parchment grounds, coffee-brown ink and antique-gold accents, sampled
/// from `Assets/HapagPamana.png`. This is the single source of truth for colour
/// across the whole app; never hard-code a `Color(0x…)` in a screen — add it
/// here (or reference an existing token) so the palette stays consistent.
class AppColors {
  AppColors._();

  // ── Grounds & surfaces ────────────────────────────────────────────────────
  /// Parchment ground — the default scaffold background.
  static const Color cream = Color(0xFFF6EFDF);

  /// Edge vignette for the parchment radial background.
  static const Color creamEdge = Color(0xFFEADFC8);

  /// Card / input-field surface — a touch lighter than the ground.
  static const Color surface = Color(0xFFFCF8EF);

  /// Deep espresso — the grounded backdrop for the signed-in ("member") home,
  /// the dark counterpart to [cream]. Pairs with [brown]/[olive] for the warm,
  /// premium dark hero and reads cream/gold text cleanly.
  static const Color espresso = Color(0xFF2A1A0B);

  // ── Ink (text & primary brand) ────────────────────────────────────────────
  /// Coffee brown — primary brand colour and primary ink.
  static const Color brown = Color(0xFF503413);

  /// Secondary text / muted ink.
  static const Color brownSoft = Color(0xFF7A5630);

  /// Olive-green accent (values, catering gradient partner).
  static const Color olive = Color(0xFF44462B);

  // ── Accents ───────────────────────────────────────────────────────────────
  /// Antique gold — large / decorative use (not AA on cream for small text).
  static const Color gold = Color(0xFFAF854A);

  /// Deeper gold that meets AA contrast for text and icons on cream.
  static const Color goldDeep = Color(0xFF7E5E2B);

  // ── Lines, fills & skeletons ──────────────────────────────────────────────
  /// ~10% brown — hairline borders that define cards without a heavy shadow.
  static const Color hairline = Color(0x1A503413);

  /// ~8% brown — quiet placeholder fills (e.g. value-card icon discs).
  static const Color placeholderFill = Color(0x14503413);

  /// Skeleton base tone.
  static const Color shimmerBase = Color(0xFFEBE1CE);

  /// Skeleton highlight sweep.
  static const Color shimmerHi = Color(0xFFF8F2E4);

  // ── On-colour & effects ───────────────────────────────────────────────────
  /// Text/icon colour to sit on top of [brown] surfaces.
  static const Color onBrown = cream;

  /// Warm, low-opacity shadow used to lift premium CTAs off the parchment.
  static const Color shadow = Color(0x33503413);
}
