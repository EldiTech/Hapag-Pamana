import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'app_colors.dart';
import 'app_radius.dart';
import 'app_text_styles.dart';

/// The application [ThemeData], assembled entirely from the design tokens
/// ([AppColors], [AppTextStyles], [AppRadius]).
///
/// Every component theme below is the *default* look for that widget — screens
/// should rely on these rather than re-styling buttons, fields, app bars or the
/// navigation bar inline. That keeps a single, consistent visual language and
/// means a palette or radius change propagates everywhere at once.
class AppTheme {
  AppTheme._();

  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brown,
      brightness: Brightness.light,
    ).copyWith(
      surface: AppColors.cream,
      primary: AppColors.brown,
      onPrimary: AppColors.onBrown,
      secondary: AppColors.gold,
      error: const Color(0xFF9B3B2E),
    );

    return ThemeData(
      useMaterial3: true,
      scaffoldBackgroundColor: AppColors.cream,
      colorScheme: scheme,
      splashColor: AppColors.gold.withValues(alpha: 0.10),
      highlightColor: AppColors.gold.withValues(alpha: 0.06),
      textTheme: GoogleFonts.montserratTextTheme().apply(
        bodyColor: AppColors.brown,
        displayColor: AppColors.brown,
      ),

      // ── App bar ───────────────────────────────────────────────────────────
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.cream,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        toolbarHeight: 72,
        foregroundColor: AppColors.brown,
        titleTextStyle: AppTextStyles.heading,
      ),

      // ── Inputs ────────────────────────────────────────────────────────────
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        hintStyle: AppTextStyles.sans(
          color: AppColors.brownSoft.withValues(alpha: 0.6),
        ),
        labelStyle: AppTextStyles.sans(color: AppColors.brownSoft),
        prefixIconColor: AppColors.brownSoft,
        suffixIconColor: AppColors.brownSoft,
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: const BorderSide(color: AppColors.hairline),
        ),
        border: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: const BorderSide(color: AppColors.hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: const BorderSide(color: AppColors.gold, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: BorderSide(color: scheme.error.withValues(alpha: 0.7)),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppRadius.mdAll,
          borderSide: BorderSide(color: scheme.error, width: 1.6),
        ),
      ),

      // ── Buttons ───────────────────────────────────────────────────────────
      // Primary CTA: a stadium of coffee brown lifted off the parchment by a
      // soft, warm shadow so the main action reads as premium and tappable.
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.brown,
          foregroundColor: AppColors.onBrown,
          disabledBackgroundColor: AppColors.brown.withValues(alpha: 0.4),
          disabledForegroundColor: AppColors.onBrown.withValues(alpha: 0.7),
          elevation: 3,
          shadowColor: AppColors.shadow,
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 24),
          minimumSize: const Size(0, 52),
          shape: const StadiumBorder(),
          textStyle: AppTextStyles.sans(
            size: 12,
            weight: FontWeight.w600,
            spacing: 1.5,
            color: AppColors.onBrown,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.brown,
          side: const BorderSide(color: AppColors.hairline),
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 20),
          minimumSize: const Size(0, 48),
          shape: const StadiumBorder(),
          textStyle: AppTextStyles.sans(
            size: 12,
            weight: FontWeight.w600,
            spacing: 1,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: AppColors.goldDeep),
      ),

      // ── Misc components ───────────────────────────────────────────────────
      dividerTheme: const DividerThemeData(
        color: AppColors.hairline,
        thickness: 1,
        space: 1,
      ),
      iconTheme: const IconThemeData(color: AppColors.brown),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.brown,
        contentTextStyle: AppTextStyles.sans(color: AppColors.onBrown),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
      ),

      // ── Bottom navigation ─────────────────────────────────────────────────
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        height: 66,
        indicatorColor: AppColors.gold.withValues(alpha: 0.22),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected)
                ? AppColors.brown
                : AppColors.brownSoft,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => AppTextStyles.sans(
            size: 11,
            spacing: 0.4,
            weight: states.contains(WidgetState.selected)
                ? FontWeight.w600
                : FontWeight.w500,
            color: states.contains(WidgetState.selected)
                ? AppColors.brown
                : AppColors.brownSoft,
          ),
        ),
      ),
    );
  }
}
