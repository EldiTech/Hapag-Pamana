import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/core/auth_validation.dart';

void main() {
  group('Philippine mobile validation', () {
    test('accepts valid 09XXXXXXXXX numbers', () {
      expect(AuthValidation.phoneError('09123456789'), isNull);
      expect(AuthValidation.phoneError('09987654321'), isNull);
    });

    test(
      'rejects incomplete, oversized, wrong-prefix, and non-digit values',
      () {
        for (final value in [
          '0912345',
          '091234567890',
          '08123456789',
          '12345678901',
          'abc12345678',
        ]) {
          expect(AuthValidation.phoneError(value), AuthValidation.phoneMessage);
        }
      },
    );
  });

  group('password validation', () {
    test('requires eight characters', () {
      expect(AuthValidation.passwordError('1234'), isNotNull);
      expect(AuthValidation.passwordError('123456'), isNotNull);
      expect(AuthValidation.passwordError('12345678'), isNull);
      expect(AuthValidation.passwordError('StrongPass2026'), isNull);
      expect(AuthValidation.passwordError('Password123!'), isNull);
    });
  });
}
