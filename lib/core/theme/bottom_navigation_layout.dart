import 'package:flutter/material.dart';

/// Shared bottom-navigation geometry and content clearance.
class AppBottomNavigationLayout {
  AppBottomNavigationLayout._();

  static const double guestBarHeight = 64;
  static const double guestBottomMinimum = 6;

  static const double memberBarHeight = 62;
  static const double memberTopPadding = 7;
  static const double memberBottomPadding = 4;

  static const double contentGap = 16;

  static double _safeBottom(BuildContext context) =>
      MediaQuery.of(context).viewPadding.bottom;

  static double guestContentClearance(BuildContext context) {
    final bottomInset = _safeBottom(context);
    final navBottom = bottomInset > guestBottomMinimum
        ? bottomInset
        : guestBottomMinimum;
    return guestBarHeight + navBottom + contentGap;
  }

  static double memberContentClearance(BuildContext context) =>
      memberTopPadding +
      memberBarHeight +
      memberBottomPadding +
      _safeBottom(context) +
      contentGap;
}
