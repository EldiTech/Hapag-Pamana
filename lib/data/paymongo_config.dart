/// PayMongo credentials, and the terms of the downpayment gate the booking
/// wizards put in front of a new order.
///
/// The keys come from `.env` (see [Env]) — `PAYMONGO_SECRET_KEY` /
/// `PAYMONGO_PUBLIC_KEY` — which is where local development sets them to the
/// business's **test** keys. A `--dart-define` still overrides `.env` when
/// passed, which is how a release build should supply live keys without
/// touching the bundled file:
///
/// ```
/// flutter build apk --dart-define=PAYMONGO_SECRET_KEY=sk_live_… \
///                   --dart-define=PAYMONGO_PUBLIC_KEY=pk_live_…
/// ```
///
/// ⚠ **The secret key is compiled into the binary either way.** Anyone who
/// unzips the APK can read it — `.env` only keeps it out of source control,
/// not out of the shipped app (see the warning on [Env]) — and on a live key
/// that means they can charge cards, issue refunds and read every payment on
/// the account. Payment confirmation is also client-asserted here: the app
/// checks the checkout session itself and then writes `paymentStatus: 'paid'`
/// on its own booking, so a modified build could claim an order was paid
/// for. Both problems have the same fix — move [createCheckout] behind a
/// server (a Firebase Cloud Function) and confirm with a PayMongo webhook,
/// leaving only [publicKey] in the app.
///
/// Until that server exists, keep this on `sk_test_` keys.
library;

import '../env.dart';

/// Everything configurable about the downpayment flow, in one place.
class PayMongoConfig {
  const PayMongoConfig._();

  static String get secretKey => Env.paymongoSecretKey;

  static String get publicKey => Env.paymongoPublicKey;

  /// True once real keys are in play — the payment screen drops its "no real
  /// money moves" note, and this is the point at which shipping the secret key
  /// stops being merely untidy and becomes dangerous (see the library note).
  static bool get isLive => secretKey.startsWith('sk_live_');

  /// The share of the order's total collected up front to hold the date. The
  /// balance is settled with the team on the day.
  static const double downpaymentShare = 0.5;

  /// PayMongo will not open a checkout session under ₱100.00, so an order whose
  /// half falls below this can't be gated online at all — those file as
  /// `quote_needed` and the team arranges the downpayment directly.
  static const num minChargeablePesos = 100;

  /// What the hosted checkout page offers. `card` covers Visa/Mastercard;
  /// the rest are the e-wallets PayMongo settles in PHP.
  static const List<String> paymentMethods = [
    'gcash',
    'paymaya',
    'grab_pay',
    'card',
  ];

  /// Where the browser lands once checkout closes. These are only the redirect
  /// targets for the *browser* — the app never reads them, because it confirms
  /// by re-reading the checkout session itself. A page that 404s costs nothing
  /// but looks careless, so point these at real pages once hosting is up.
  static const String successUrl =
      'https://hapagpamana-39687.web.app/payment/success';
  static const String cancelUrl =
      'https://hapagpamana-39687.web.app/payment/cancelled';

  /// The downpayment on [total], rounded to whole pesos (PayMongo takes
  /// centavos, and a half-peso downpayment reads like a bug on the receipt).
  static num downpaymentOn(num total) =>
      (total * downpaymentShare).roundToDouble();

  /// True when [total] is big enough for its half to clear PayMongo's floor.
  static bool isChargeable(num total) =>
      total > 0 && downpaymentOn(total) >= minChargeablePesos;
}
