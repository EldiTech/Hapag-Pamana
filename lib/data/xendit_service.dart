import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../env.dart';

/// Client for the app's server-side Xendit adapter.
///
/// The Xendit secret key never enters Flutter. The adapter creates sessions,
/// reads their status, and records completed payments with Firebase Admin.
class XenditService {
  XenditService._();
  static final instance = XenditService._();
  factory XenditService() => instance;

  static const _timeout = Duration(seconds: 25);

  Future<XenditCheckout> createCheckout({
    required String bookingId,
    required String reference,
    required String description,
    required String lineItemName,
    required num amountPesos,
    String? email,
    String? name,
    String? phone,
  }) async {
    final headers = await _headers();
    final json = await _send(
      () => http.post(
        _uri,
        headers: headers,
        body: jsonEncode({
          'action': 'create',
          'bookingId': bookingId,
          'reference': reference,
          'description': description,
          'lineItemName': lineItemName,
          'amountPesos': amountPesos,
          if ((email ?? '').trim().isNotEmpty) 'email': email!.trim(),
          if ((name ?? '').trim().isNotEmpty) 'name': name!.trim(),
          if ((phone ?? '').trim().isNotEmpty) 'phone': phone!.trim(),
        }),
      ),
    );
    return XenditCheckout.fromJson(json);
  }

  Future<XenditCheckout> fetchCheckout({
    required String bookingId,
    required String sessionId,
  }) async {
    final headers = await _headers();
    final json = await _send(
      () => http.post(
        _uri,
        headers: headers,
        body: jsonEncode({
          'action': 'status',
          'bookingId': bookingId,
          'sessionId': sessionId,
        }),
      ),
    );
    return XenditCheckout.fromJson(json);
  }

  Uri get _uri {
    final endpoint = Env.xenditApiUrl.trim();
    if (endpoint.isEmpty) {
      throw const XenditException(
        'Xendit is not connected yet. Set XENDIT_API_URL to the deployed '
        'payment endpoint.',
      );
    }
    return Uri.parse(endpoint);
  }

  Future<Map<String, String>> _headers() async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) {
      throw const XenditException('Please sign in again before paying.');
    }
    return {
      'authorization': 'Bearer $token',
      'content-type': 'application/json',
      'accept': 'application/json',
    };
  }

  Future<Map<String, dynamic>> _send(
    Future<http.Response> Function() request,
  ) async {
    final http.Response response;
    try {
      response = await request().timeout(_timeout);
    } catch (error) {
      if (error is XenditException) rethrow;
      throw const XenditException(
        'We couldn\'t reach Xendit. Check your connection and try again.',
      );
    }

    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode >= 200 && response.statusCode < 300) return body;
    final message = body['error'];
    if (message is String && message.trim().isNotEmpty) {
      throw XenditException(message.trim(), statusCode: response.statusCode);
    }
    throw XenditException(
      response.statusCode == 401
          ? 'Your session expired. Please sign in again.'
          : 'Xendit rejected the payment request. Please try again.',
      statusCode: response.statusCode,
    );
  }
}

class XenditCheckout {
  const XenditCheckout({
    required this.id,
    required this.checkoutUrl,
    required this.paid,
    required this.amountPesos,
    this.paymentId,
    this.method,
  });

  final String id;
  final String checkoutUrl;
  final bool paid;
  final num amountPesos;
  final String? paymentId;
  final String? method;

  factory XenditCheckout.fromJson(Map<String, dynamic> json) {
    final amount = json['amount'];
    final status = '${json['status'] ?? ''}'.toUpperCase();
    return XenditCheckout(
      id: '${json['id'] ?? json['payment_session_id'] ?? ''}',
      checkoutUrl: '${json['checkoutUrl'] ?? json['payment_link_url'] ?? ''}',
      paid: json['paid'] == true || status == 'COMPLETED',
      amountPesos: amount is num ? amount : 0,
      paymentId: json['paymentId']?.toString(),
      method: json['method']?.toString(),
    );
  }
}

class XenditException implements Exception {
  const XenditException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'XenditException($statusCode): $message';
}
