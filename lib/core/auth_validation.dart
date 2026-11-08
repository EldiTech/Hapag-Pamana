/// Shared validation rules for customer authentication and contact numbers.
class AuthValidation {
  AuthValidation._();

  static const int minimumPasswordLength = 8;
  static const String phoneMessage =
      'Please enter a valid 11-digit Philippine mobile number (09XXXXXXXXX).';
  static const String passwordMessage =
      'Password must contain at least 8 characters.';

  static final RegExp _philippineMobile = RegExp(r'^09\d{9}$');

  static String? phoneError(String value) =>
      _philippineMobile.hasMatch(value) ? null : phoneMessage;

  static String? passwordError(String value) {
    if (value.isEmpty) return 'Please choose a password.';
    return value.length < minimumPasswordLength ? passwordMessage : null;
  }
}
