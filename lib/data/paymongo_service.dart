import 'dart:convert';

import 'package:http/http.dart' as http;

import 'paymongo_config.dart';

/// Talks to PayMongo's Checkout Sessions API — the one call the downpayment
/// gate needs, plus the read that tells us whether the member actually paid.
///
/// A *checkout session* is a hosted payment page PayMongo owns: we hand it an
/// amount and a reference, it hands back a URL, and the member settles up there
/// in their browser with GCash, Maya, GrabPay or a card. That keeps card numbers
/// out of this app entirely — a real advantage over collecting them ourselves.
///
/// What it does **not** do is tell us when the payment lands; PayMongo pushes
/// that to a webhook, and this app has no server to receive one. So
/// [fetchCheckout] re-reads the session and looks for a settled payment on it.
/// That read is authoritative (it's PayMongo's own record, not the member's word
/// for it), but it only happens while the app is open and looking — which is why
/// an unpaid booking stays resumable from Order Tracking rather than being
/// assumed dead.
///
/// A process-wide singleton, mirroring the app's repositories.
class PayMongoService {
  PayMongoService._();
  static final PayMongoService instance = PayMongoService._();
  factory PayMongoService() => instance;

  static const String _base = 'https://api.paymongo.com/v1';

  /// PayMongo authenticates with HTTP Basic: the key as the username, and an
  /// empty password (hence the bare trailing colon).
  static String get _auth =>
      'Basic ${base64Encode(utf8.encode('${PayMongoConfig.secretKey}:'))}';

  static Map<String, String> get _headers => {
        'Authorization': _auth,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

  /// How long to wait on PayMongo before giving up. Short enough that a dead
  /// connection doesn't leave the member staring at a spinner.
  static const Duration _timeout = Duration(seconds: 25);

  /// Opens a hosted checkout page for [amountPesos] and returns it.
  ///
  /// [reference] is the booking's Firestore id — it travels with the payment as
  /// PayMongo's `reference_number`, so a payment in the PayMongo dashboard can
  /// always be traced back to the order it was for (and vice versa, which is
  /// what makes a manual reconciliation possible if the app ever loses track).
  ///
  /// Throws [PayMongoException] on anything PayMongo refuses.
  Future<CheckoutSession> createCheckout({
    required String reference,
    required String description,
    required String lineItemName,
    required num amountPesos,
    String? email,
    String? name,
    String? phone,
  }) async {
    // PayMongo works in centavos, and refuses anything that isn't a whole one.
    final centavos = (amountPesos * 100).round();
    final body = <String, dynamic>{
      'data': {
        'attributes': {
          'line_items': [
            {
              'currency': 'PHP',
              'amount': centavos,
              'name': lineItemName,
              'quantity': 1,
              'description': description,
            },
          ],
          'payment_method_types': PayMongoConfig.paymentMethods,
          'description': description,
          'reference_number': reference,
          'send_email_receipt': false,
          'show_description': true,
          'show_line_items': true,
          'success_url': PayMongoConfig.successUrl,
          'cancel_url': PayMongoConfig.cancelUrl,
          // Prefills the checkout page. PayMongo rejects a malformed billing
          // block outright, so anything we're unsure of is simply left out.
          if ((email ?? '').trim().isNotEmpty ||
              (name ?? '').trim().isNotEmpty ||
              (phone ?? '').trim().isNotEmpty)
            'billing': {
              if ((name ?? '').trim().isNotEmpty) 'name': name!.trim(),
              if ((email ?? '').trim().isNotEmpty) 'email': email!.trim(),
              if ((phone ?? '').trim().isNotEmpty) 'phone': phone!.trim(),
            },
        },
      },
    };

    final json = await _send(
      () => http.post(
        Uri.parse('$_base/checkout_sessions'),
        headers: _headers,
        body: jsonEncode(body),
      ),
    );
    return CheckoutSession.fromJson(json);
  }

  /// Re-reads [sessionId] to see where the payment stands. This is the only
  /// thing that may mark a booking paid.
  Future<CheckoutSession> fetchCheckout(String sessionId) async {
    final json = await _send(
      () => http.get(
        Uri.parse('$_base/checkout_sessions/$sessionId'),
        headers: _headers,
      ),
    );
    return CheckoutSession.fromJson(json);
  }

  /// Runs [request], and turns everything that can go wrong — no connection, a
  /// PayMongo error body, a response that isn't the JSON we expect — into a
  /// [PayMongoException] carrying a line the member can actually read.
  Future<Map<String, dynamic>> _send(
    Future<http.Response> Function() request,
  ) async {
    final http.Response res;
    try {
      res = await request().timeout(_timeout);
    } catch (e) {
      throw const PayMongoException(
        'We couldn\'t reach the payment service. Please check your '
        'connection and try again.',
      );
    }

    Map<String, dynamic>? decoded;
    try {
      final raw = jsonDecode(res.body);
      if (raw is Map<String, dynamic>) decoded = raw;
    } catch (_) {
      // Left null — handled as an unreadable reply below.
    }

    if (res.statusCode >= 200 && res.statusCode < 300) {
      final data = decoded?['data'];
      if (data is Map<String, dynamic>) return data;
      throw const PayMongoException(
        'The payment service sent back something we couldn\'t read. '
        'Please try again.',
      );
    }

    // PayMongo's error shape: { "errors": [ { "detail": "…", "code": "…" } ] }.
    // Its details are written for developers, but they're specific ("amount
    // must be greater than…"), so the first one is worth surfacing.
    final errors = decoded?['errors'];
    if (errors is List && errors.isNotEmpty && errors.first is Map) {
      final detail = (errors.first as Map)['detail'];
      if (detail is String && detail.trim().isNotEmpty) {
        throw PayMongoException(detail.trim(), statusCode: res.statusCode);
      }
    }
    throw PayMongoException(
      res.statusCode == 401
          ? 'The payment service rejected our credentials. Please tell the '
              'team — this one is on our side.'
          : 'The payment service turned down the request. Please try again.',
      statusCode: res.statusCode,
    );
  }
}

/// A hosted checkout page, as PayMongo describes it back to us.
class CheckoutSession {
  const CheckoutSession({
    required this.id,
    required this.checkoutUrl,
    required this.paid,
    required this.amountPesos,
    this.paymentId,
    this.method,
  });

  /// PayMongo's session id (`cs_…`) — kept on the booking so a member who backs
  /// out can be handed the same page again instead of a second charge.
  final String id;

  final String checkoutUrl;

  /// True once a payment on this session has actually settled — by any of the
  /// ways PayMongo reports that (see [CheckoutSession.fromJson]).
  final bool paid;

  /// What the session was opened for, in pesos.
  final num amountPesos;

  /// The settled payment's id (`pay_…`), for the team's reconciliation.
  final String? paymentId;

  /// How it was paid — "gcash", "card", … — as PayMongo reports it.
  final String? method;

  factory CheckoutSession.fromJson(Map<String, dynamic> data) {
    final attrs = data['attributes'];
    final a = attrs is Map<String, dynamic> ? attrs : const <String, dynamic>{};

    // A card payment settles through a *payment intent* while an e-wallet one
    // doesn't, and the session reports each in its own place — so both are read.
    // Missing a settled payment here is the expensive way to be wrong: it sends
    // a member who has already paid back to PayMongo for a second charge.
    final intent = a['payment_intent'];
    final intentAttrs = intent is Map ? intent['attributes'] : null;
    final ia = intentAttrs is Map ? intentAttrs : const {};

    // A session carries every payment attempted on it. Only a settled one
    // counts: an attempt that failed or is still awaiting the wallet's
    // confirmation leaves the booking unpaid.
    Map<String, dynamic>? settled;
    for (final payments in [a['payments'], ia['payments']]) {
      if (settled != null) break;
      if (payments is! List) continue;
      for (final p in payments) {
        if (p is! Map) continue;
        final pa = p['attributes'];
        final status = pa is Map ? pa['status'] : null;
        if (status == 'paid') {
          settled = {'id': p['id'], 'attributes': pa};
          break;
        }
      }
    }

    final settledAttrs = settled?['attributes'];
    final sa = settledAttrs is Map ? settledAttrs : const {};

    // Two more ways PayMongo says the same thing, for a reply whose payment list
    // hasn't caught up with it: the session stamps `paid_at` when it settles,
    // and its payment intent reads `succeeded`. Either alone is enough — this
    // flag's whole job is to stop a second charge, and both mean money moved.
    final paid = settled != null ||
        a['paid_at'] != null ||
        ia['status'] == 'succeeded';

    // The amount lives on the line item we sent, in centavos.
    num pesos = 0;
    final items = a['line_items'];
    if (items is List && items.isNotEmpty && items.first is Map) {
      final amount = (items.first as Map)['amount'];
      if (amount is num) pesos = amount / 100;
    }
    if (pesos == 0 && sa['amount'] is num) pesos = (sa['amount'] as num) / 100;
    if (pesos == 0 && ia['amount'] is num) pesos = (ia['amount'] as num) / 100;

    // `source.type` names the wallet on an e-wallet payment; a card payment
    // reports it on the payment method instead — on the payment itself, or
    // failing that on the session.
    String? method;
    final source = sa['source'];
    if (source is Map && source['type'] is String) {
      method = source['type'] as String;
    }
    method ??= sa['payment_method_used'] is String
        ? sa['payment_method_used'] as String
        : null;
    method ??= a['payment_method_used'] is String
        ? a['payment_method_used'] as String
        : null;

    return CheckoutSession(
      id: (data['id'] ?? '').toString(),
      checkoutUrl: (a['checkout_url'] ?? '').toString(),
      paid: paid,
      amountPesos: pesos,
      // The payment's own id where we have it. A session that reported itself
      // settled without one still leaves the team something to reconcile
      // against: the payment intent is searchable in PayMongo's dashboard too.
      paymentId: settled?['id']?.toString() ??
          (paid && intent is Map && intent['id'] != null
              ? intent['id'].toString()
              : null),
      method: method,
    );
  }
}

/// Anything PayMongo wouldn't do, with a [message] already fit to show.
class PayMongoException implements Exception {
  const PayMongoException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => 'PayMongoException($statusCode): $message';
}
