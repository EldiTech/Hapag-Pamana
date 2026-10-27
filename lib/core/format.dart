/// Shared value formatting — the small conversions more than one screen needs
/// to agree on.
library;

/// Formats a peso amount with thousands separators, e.g. 1500 → "₱1,500".
///
/// Rounded to whole pesos: the business prices packages per head in round
/// figures, and centavos on a quotation or a downpayment read like a defect.
String peso(num value) {
  final digits = value.round().abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(',');
    buf.write(digits[i]);
  }
  return '₱$buf';
}
