import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../env.dart';

/// Asks the trusted Vercel endpoint to inspect a booking change and deliver
/// the matching notification. The endpoint rereads Firestore and authorizes
/// the caller, so no title, message, recipient, or status is trusted here.
class NotificationDeliveryService {
  NotificationDeliveryService._();

  static final instance = NotificationDeliveryService._();

  Future<void> deliver({
    required String action,
    required String bookingId,
  }) async {
    final endpoint = Env.notificationApiUrl.trim();
    if (endpoint.isEmpty) {
      debugPrint('Notification delivery skipped: NOTIFICATION_API_URL is blank.');
      return;
    }

    try {
      final user = FirebaseAuth.instance.currentUser;
      final token = await user?.getIdToken();
      if (token == null || token.isEmpty) return;

      final response = await http
          .post(
            Uri.parse(endpoint),
            headers: {
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode({'action': action, 'bookingId': bookingId}),
          )
          .timeout(const Duration(seconds: 15));

      if (response.statusCode < 200 || response.statusCode >= 300) {
        debugPrint(
          'Notification delivery failed (${response.statusCode}): '
          '${response.body}',
        );
      }
    } catch (error) {
      // A notification outage must never turn a successful booking/payment
      // write into a customer-visible failure.
      debugPrint('Notification delivery error: $error');
    }
  }
}
