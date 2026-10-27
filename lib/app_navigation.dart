import 'package:flutter/material.dart';

import 'screens/user/order_tracking_page.dart';
import 'widgets.dart';

/// App-wide navigation used by notification taps.
class AppNavigation {
  AppNavigation._();

  static final navigatorKey = GlobalKey<NavigatorState>();
  static final messengerKey = GlobalKey<ScaffoldMessengerState>();

  static void openBookingTracking(String bookingId) {
    final navigator = navigatorKey.currentState;
    if (navigator == null) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => openBookingTracking(bookingId),
      );
      return;
    }
    navigator.push(
      BrandPageRoute(
        builder: (_) => OrderTrackingPage(initialBookingId: bookingId),
      ),
    );
  }
}
