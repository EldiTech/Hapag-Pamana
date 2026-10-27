/// Design-system barrel.
///
/// The canonical definitions now live in `lib/core/theme/`:
///   • [AppColors]      — the palette          (core/theme/app_colors.dart)
///   • [AppTextStyles]  — typography           (core/theme/app_text_styles.dart)
///   • [AppSpacing]     — spacing scale        (core/theme/app_spacing.dart)
///   • [AppRadius]      — corner-radius scale  (core/theme/app_radius.dart)
///   • [Motion]         — duration / curves    (core/theme/app_motion.dart)
///   • page transitions — the one push / pop  (core/theme/app_page_transitions.dart)
///   • [AppAssets]      — logo / hero tags     (core/theme/app_assets.dart)
///   • [AppTheme]       — the ThemeData        (core/theme/app_theme.dart)
///
/// This file re-exports them so the long-standing `import '../brand.dart';`
/// sites keep resolving without churn. New code may import the specific token
/// file it needs directly.
library;

export 'core/theme/app_assets.dart';
export 'core/theme/app_colors.dart';
export 'core/theme/app_motion.dart';
export 'core/theme/app_page_transitions.dart';
export 'core/theme/app_radius.dart';
export 'core/theme/app_spacing.dart';
export 'core/theme/app_text_styles.dart';
export 'core/theme/app_theme.dart';
