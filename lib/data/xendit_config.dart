import '../env.dart';

/// Public client settings for the server-backed Xendit checkout.
class XenditConfig {
  const XenditConfig._();

  static String get apiUrl => Env.xenditApiUrl;

  static const double downpaymentShare = 0.5;
  static const num minChargeablePesos = 100;

  static const String successUrl =
      'https://hapagpamana-39687.web.app/payment/success';
  static const String cancelUrl =
      'https://hapagpamana-39687.web.app/payment/cancelled';

  static num downpaymentOn(num total) =>
      (total * downpaymentShare).roundToDouble();

  static bool isChargeable(num total) =>
      total > 0 && downpaymentOn(total) >= minChargeablePesos;
}
