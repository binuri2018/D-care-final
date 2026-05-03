import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppColors {
  static const primary = Color(0xFF0B90E8);
  static const primaryDark = Color(0xFF0B6CCF);
  static const primaryDarkText = Colors.white;

  static const background = Color(0xFF0797E5);
  static const surface = Colors.white;
  static const text = Color(0xFF1A314B);
  static const mutedText = Color(0xFF6A7F97);
  static const outline = Color(0xFFDDEAF4);
  static const cardTopTint = Color(0xFFF6FBFF);

  static const info = Color(0xFF2A7FA9);
  static const warning = Color(0xFFF59E0B);
  static const success = Color(0xFF10B981);
  static const error = Color(0xFFEF4444);
}

ThemeData buildAppTheme() {
  final textTheme = GoogleFonts.spaceGroteskTextTheme().copyWith(
    headlineMedium: GoogleFonts.spaceGrotesk(
      fontSize: 34,
      fontWeight: FontWeight.w800,
      color: AppColors.text,
      letterSpacing: -0.4,
    ),
    headlineSmall: GoogleFonts.spaceGrotesk(
      fontSize: 26,
      fontWeight: FontWeight.w700,
      color: AppColors.text,
      letterSpacing: -0.5,
    ),
    titleLarge: GoogleFonts.spaceGrotesk(
      fontSize: 20,
      fontWeight: FontWeight.w600,
      color: AppColors.text,
    ),
    titleMedium: GoogleFonts.spaceGrotesk(
      fontSize: 18,
      fontWeight: FontWeight.w600,
      color: AppColors.text,
    ),
    bodyLarge: GoogleFonts.spaceGrotesk(fontSize: 16, color: AppColors.text),
    bodyMedium: GoogleFonts.spaceGrotesk(fontSize: 15, color: AppColors.text),
    labelLarge: GoogleFonts.spaceGrotesk(
      fontSize: 16,
      fontWeight: FontWeight.w600,
      color: AppColors.primaryDarkText,
    ),
  );

  const colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.primary,
    onPrimary: AppColors.primaryDarkText,
    secondary: Color(0xFFD9F0FF),
    onSecondary: AppColors.primary,
    error: AppColors.error,
    onError: Colors.white,
    surface: AppColors.surface,
    onSurface: AppColors.text,
  );

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    scaffoldBackgroundColor: Colors.transparent,
    colorScheme: colorScheme,
    textTheme: textTheme,
    dividerColor: AppColors.outline,
    appBarTheme: AppBarTheme(
      elevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: Colors.white,
      centerTitle: false,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      titleTextStyle: textTheme.titleLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
      labelStyle: const TextStyle(color: AppColors.mutedText, fontSize: 14),
      hintStyle: const TextStyle(color: AppColors.mutedText, fontSize: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.outline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.outline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.primary, width: 1.6),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: AppColors.error),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.primaryDarkText,
        textStyle: textTheme.labelLarge,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(54),
        foregroundColor: AppColors.primaryDark,
        side: const BorderSide(color: AppColors.outline, width: 1.5),
        textStyle: textTheme.labelLarge?.copyWith(color: AppColors.primaryDark),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(26),
        side: const BorderSide(color: AppColors.outline),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      height: 74,
      backgroundColor: const Color(0xB50B70C8),
      surfaceTintColor: Colors.transparent,
      indicatorColor: Colors.white.withValues(alpha: 0.2),
      labelTextStyle: WidgetStateProperty.resolveWith((states) {
        final isSelected = states.contains(WidgetState.selected);
        return TextStyle(
          fontSize: 12.5,
          fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
          color: isSelected ? Colors.white : Colors.white.withValues(alpha: 0.75),
        );
      }),
      iconTheme: WidgetStateProperty.resolveWith((states) {
        final isSelected = states.contains(WidgetState.selected);
        return IconThemeData(color: isSelected ? Colors.white : Colors.white.withValues(alpha: 0.75));
      }),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return AppColors.primaryDarkText;
          }
          return AppColors.text;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return AppColors.primary;
          }
          return AppColors.cardTopTint;
        }),
        side: WidgetStateProperty.all(const BorderSide(color: AppColors.outline)),
        shape: WidgetStateProperty.all(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
    ),
    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      side: const BorderSide(color: AppColors.outline),
      selectedColor: AppColors.primary.withValues(alpha: 0.1),
      backgroundColor: Colors.white,
      labelStyle: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.text),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: AppColors.primary,
      inactiveTrackColor: AppColors.outline,
      thumbColor: AppColors.primary,
      overlayColor: AppColors.primary.withValues(alpha: 0.1),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.all(Colors.white),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return AppColors.primary;
        return const Color(0xFFD1D5DB);
      }),
      trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: AppColors.text,
      contentTextStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
  );
}
