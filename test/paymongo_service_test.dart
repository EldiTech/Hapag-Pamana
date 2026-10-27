import 'package:flutter_test/flutter_test.dart';
import 'package:hapag_pamana/data/paymongo_service.dart';

/// [CheckoutSession.fromJson] is the only thing standing between a member who
/// has already paid and a second charge: the app has no webhook, so a session it
/// reads as unpaid sends them back to PayMongo. PayMongo reports a settled
/// payment in more than one place — a card payment goes through a payment
/// intent, an e-wallet payment doesn't — so each shape is pinned here.
void main() {
  /// A checkout session reply, shaped as [PayMongoService] receives it (the
  /// `data` object, already unwrapped from the envelope).
  Map<String, dynamic> session(Map<String, dynamic> attributes) => {
        'id': 'cs_test',
        'type': 'checkout_session',
        'attributes': {
          'checkout_url': 'https://pm.link/test',
          'reference_number': 'booking123',
          'line_items': [
            {'amount': 250000, 'currency': 'PHP', 'name': 'downpayment'},
          ],
          ...attributes,
        },
      };

  Map<String, dynamic> payment(
    String id,
    String status, {
    Map<String, dynamic>? extra,
  }) =>
      {
        'id': id,
        'type': 'payment',
        'attributes': {'status': status, 'amount': 250000, ...?extra},
      };

  group('an unsettled session', () {
    test('a page just opened is not paid', () {
      final s = CheckoutSession.fromJson(session({}));
      expect(s.paid, isFalse);
      expect(s.id, 'cs_test');
      expect(s.checkoutUrl, 'https://pm.link/test');
      // The amount comes off the line item we sent, in centavos.
      expect(s.amountPesos, 2500);
    });

    test('an attempt that failed leaves it unpaid', () {
      final s = CheckoutSession.fromJson(session({
        'payments': [payment('pay_1', 'failed')],
        'payment_intent': {
          'id': 'pi_1',
          'attributes': {'status': 'awaiting_payment_method'},
        },
      }));
      expect(s.paid, isFalse);
      expect(s.paymentId, isNull);
    });

    test('an e-wallet still awaiting the wallet leaves it unpaid', () {
      final s = CheckoutSession.fromJson(session({
        'payments': [payment('pay_1', 'pending')],
      }));
      expect(s.paid, isFalse);
    });
  });

  group('a settled session', () {
    test('an e-wallet payment on the session itself', () {
      final s = CheckoutSession.fromJson(session({
        'payments': [
          payment('pay_1', 'failed'),
          payment('pay_2', 'paid', extra: {
            'source': {'type': 'gcash'},
          }),
        ],
      }));
      expect(s.paid, isTrue);
      expect(s.paymentId, 'pay_2');
      expect(s.method, 'gcash');
      expect(s.amountPesos, 2500);
    });

    test('a card payment reported only under the payment intent', () {
      final s = CheckoutSession.fromJson(session({
        'payments': const [],
        'payment_method_used': 'card',
        'payment_intent': {
          'id': 'pi_1',
          'attributes': {
            'status': 'succeeded',
            'amount': 250000,
            'payments': [payment('pay_1', 'paid')],
          },
        },
      }));
      expect(s.paid, isTrue);
      expect(s.paymentId, 'pay_1');
      expect(s.method, 'card');
    });

    test('a payment intent that succeeded, with no payment listed yet', () {
      final s = CheckoutSession.fromJson(session({
        'payment_intent': {
          'id': 'pi_1',
          'attributes': {'status': 'succeeded', 'amount': 250000},
        },
      }));
      expect(s.paid, isTrue);
      // Nothing better to reconcile against, but the intent is searchable in
      // PayMongo's dashboard.
      expect(s.paymentId, 'pi_1');
    });

    test('a session stamped paid_at, with no payment listed yet', () {
      final s = CheckoutSession.fromJson(session({
        'paid_at': 1750000000,
        'payments': const [],
      }));
      expect(s.paid, isTrue);
      expect(s.amountPesos, 2500);
    });
  });

  group('malformed replies', () {
    test('a reply with no attributes reads as unpaid rather than throwing', () {
      final s = CheckoutSession.fromJson({'id': 'cs_test'});
      expect(s.paid, isFalse);
      expect(s.checkoutUrl, isEmpty);
      expect(s.amountPesos, 0);
    });

    test('payments and payment_intent of the wrong type are ignored', () {
      final s = CheckoutSession.fromJson(session({
        'payments': 'nonsense',
        'payment_intent': 'nonsense',
      }));
      expect(s.paid, isFalse);
      expect(s.amountPesos, 2500);
    });
  });
}
