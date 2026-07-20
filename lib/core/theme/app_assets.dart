/// Asset paths and shared Hero tags for the brand.
///
/// Keeping these here (rather than as string literals across screens) means the
/// logo path / hero tag is declared once and can't drift between the splash,
/// the home header and the inner app bars.
class AppAssets {
  AppAssets._();

  /// The HapagPamana wordmark + crest.
  static const String logo = 'Assets/HapagPamana.png';

  /// Shared Hero tag so the logo carries across route transitions
  /// (splash → home) instead of cross-fading.
  static const String logoHeroTag = 'hapag-logo';
}
