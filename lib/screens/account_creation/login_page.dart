import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/customer_repository.dart';
import '../../widgets.dart';
import 'signup_page.dart';
import '../user/user_shell.dart';

/// Shared by the login form and the reset-password dialog.
final RegExp _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

/// Guest Log In screen. Signs an existing customer in via [CustomerRepository]
/// and, on success, replaces itself with the member-side [UserShell]. Content
/// fades-slides in with a stagger.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  String? _emailErr;
  String? _passwordErr;

  bool _obscure = true;
  bool _submitting = false;
  bool _success = false;

  Duration _d(int ms) => Duration(milliseconds: ms);

  void _forgotPassword() {
    showCenterDialog<void>(
      context: context,
      builder: (_) => _ResetPasswordDialog(initialEmail: _email.text.trim()),
    );
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _email.text.trim();
    final pw = _password.text;

    setState(() {
      _emailErr = email.isEmpty
          ? 'Please enter your email'
          : (!_emailRe.hasMatch(email) ? 'Enter a valid email address' : null);
      _passwordErr = pw.isEmpty ? 'Please enter your password' : null;
    });
    if (_emailErr != null || _passwordErr != null) return;

    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);

    setState(() => _submitting = true);
    try {
      await CustomerRepository().signIn(email: email, password: pw);
      if (!mounted) return;
      // Let the CTA settle into its ✓ WELCOME BACK state before the page
      // hands off — the moment of success is seen, not skipped.
      setState(() => _success = true);
      await Future<void>.delayed(const Duration(milliseconds: 700));
      if (!mounted) return;
      navigator.pushReplacement(
        BrandPageRoute(builder: (_) => const UserShell()),
      );
    } on AccountBannedException {
      // Right credentials, banned account — say so plainly rather than
      // pretending the password was wrong.
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _emailErr = 'This account has been suspended';
      });
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Your account has been suspended. Please contact Fill at Home '
            'if you believe this is a mistake.',
          ),
        ),
      );
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        switch (e.code) {
          case 'invalid-email':
            _emailErr = 'Enter a valid email address';
          case 'user-not-found':
            _emailErr = 'No account found for that email';
          case 'wrong-password':
          case 'invalid-credential':
            _passwordErr = 'Incorrect email or password';
          case 'user-disabled':
            _emailErr = 'This account has been disabled';
        }
      });
      const fieldCodes = {
        'invalid-email',
        'user-not-found',
        'wrong-password',
        'invalid-credential',
        'user-disabled',
      };
      if (!fieldCodes.contains(e.code)) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              switch (e.code) {
                'too-many-requests' =>
                  'Too many attempts. Please try again later.',
                'operation-not-allowed' =>
                  'Email sign-in isn\'t enabled yet. Please try again later.',
                _ => e.message ?? 'Sign-in failed. Please try again.',
              },
            ),
          ),
        );
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      messenger.showSnackBar(
        const SnackBar(content: Text('Something went wrong. Please try again.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        leading: const BackButton(color: AppColors.brown),
      ),
      extendBodyBehindAppBar: true,
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.xxl,
                AppSpacing.sm,
                AppSpacing.xxl,
                AppSpacing.section,
              ),
              children: [
                const SizedBox(height: AppSpacing.sm),
                FadeSlideIn(
                  offsetY: 0,
                  // Shared Hero: the logo flies here from the home header and
                  // onward to the member home when sign-in succeeds.
                  child: Hero(
                    tag: AppAssets.logoHeroTag,
                    child: Image.asset(AppAssets.logo, height: 110),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg + 2),
                FadeSlideIn(
                  delay: _d(80),
                  child: Center(
                    child: Text('Log In', style: AppTextStyles.displaySmall),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                FadeSlideIn(
                  delay: _d(120),
                  child: Center(
                    child: Text(
                      'Maligayang pagbalik sa hapag.',
                      style: AppTextStyles.sans(
                        size: 12.5,
                        color: AppColors.brownSoft,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.xxl + 4),

                FadeSlideIn(
                  delay: _d(180),
                  child: AppTextField(
                    label: 'Email',
                    hint: 'you@email.com',
                    controller: _email,
                    errorText: _emailErr,
                    prefixIcon: Icons.mail_outline,
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    autofillHints: const [AutofillHints.email],
                    onChanged: (_) {
                      if (_emailErr != null) setState(() => _emailErr = null);
                    },
                  ),
                ),
                const SizedBox(height: AppSpacing.lg + 2),

                FadeSlideIn(
                  delay: _d(240),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AppTextField(
                        label: 'Password',
                        hint: '••••••••',
                        controller: _password,
                        errorText: _passwordErr,
                        prefixIcon: Icons.lock_outline,
                        obscureText: _obscure,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.password],
                        onChanged: (_) {
                          if (_passwordErr != null) {
                            setState(() => _passwordErr = null);
                          }
                        },
                        suffixIcon: IconButton(
                          icon: AnimatedSwitcher(
                            duration: Motion.quick,
                            transitionBuilder: (child, animation) =>
                                FadeTransition(
                              opacity: animation,
                              child: ScaleTransition(
                                scale: animation,
                                child: child,
                              ),
                            ),
                            child: Icon(
                              _obscure
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                              key: ValueKey(_obscure),
                              size: 20,
                            ),
                          ),
                          onPressed: () => setState(() => _obscure = !_obscure),
                        ),
                      ),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: _submitting ? null : _forgotPassword,
                          child: Text(
                            'Forgot password?',
                            style: AppTextStyles.sans(
                              size: 11.5,
                              weight: FontWeight.w600,
                              color: AppColors.goldDeep,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),

                FadeSlideIn(
                  delay: _d(300),
                  child: AppButton.primary(
                    label: _success ? 'WELCOME BACK' : 'LOG IN',
                    icon: _success ? Icons.check_rounded : null,
                    busy: _submitting && !_success,
                    fullWidth: true,
                    // A no-op keeps the success state in the full brand color
                    // (a null handler would dim it) for its brief hold.
                    onPressed: _success
                        ? () {}
                        : (_submitting ? null : _submit),
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                FadeSlideIn(
                  delay: _d(340),
                  child: AppButton.secondary(
                    label: 'CONTINUE AS GUEST',
                    fullWidth: true,
                    onPressed:
                        _submitting ? null : () => Navigator.of(context).pop(),
                  ),
                ),
                const SizedBox(height: AppSpacing.xxl + 4),

                FadeSlideIn(
                  delay: _d(500),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        "Don't have an account?",
                        style: AppTextStyles.bodySmall,
                      ),
                      TextButton(
                        onPressed: _submitting
                            ? null
                            : () => Navigator.of(context).push(
                                BrandPageRoute(
                                  builder: (_) => const SignUpPage(),
                                ),
                              ),
                        child: Text(
                          'Sign Up',
                          style: AppTextStyles.sans(
                            size: 12,
                            weight: FontWeight.w700,
                            color: AppColors.goldDeep,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The "Forgot password?" dialog: one email field and a send CTA, presented in
/// the app's standard centered shell. Sends a Firebase reset link, then settles
/// into a sent state. An unknown email reads exactly like success so the form
/// can't be used to probe which addresses have accounts.
class _ResetPasswordDialog extends StatefulWidget {
  const _ResetPasswordDialog({required this.initialEmail});

  /// Prefill carried over from the login form so the common case is one tap.
  final String initialEmail;

  @override
  State<_ResetPasswordDialog> createState() => _ResetPasswordDialogState();
}

class _ResetPasswordDialogState extends State<_ResetPasswordDialog> {
  late final TextEditingController _email =
      TextEditingController(text: widget.initialEmail);

  String? _err;
  bool _sending = false;
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final email = _email.text.trim();
    setState(() {
      _err = email.isEmpty
          ? 'Please enter your email'
          : (!_emailRe.hasMatch(email) ? 'Enter a valid email address' : null);
    });
    if (_err != null) return;

    setState(() => _sending = true);
    try {
      await CustomerRepository().sendPasswordReset(email);
      if (!mounted) return;
      setState(() {
        _sending = false;
        _sent = true;
      });
    } on FirebaseAuthException catch (e) {
      if (!mounted) return;
      if (e.code == 'user-not-found') {
        // Present exactly like success — see the class doc.
        setState(() {
          _sending = false;
          _sent = true;
        });
        return;
      }
      setState(() {
        _sending = false;
        _err = switch (e.code) {
          'invalid-email' => 'Enter a valid email address',
          'too-many-requests' => 'Too many attempts. Please try again later.',
          _ => "Couldn't send the link. Please try again.",
        };
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _err = "Couldn't send the link. Please try again.";
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AppDialogShell(
      footer: AppButton.primary(
        label: _sent ? 'DONE' : 'SEND RESET LINK',
        icon: _sent ? Icons.check_rounded : null,
        busy: _sending,
        fullWidth: true,
        onPressed: _sending
            ? null
            : (_sent ? () => Navigator.of(context).maybePop() : _send),
      ),
      children: [
        Text(
          'ACCOUNT HELP',
          style: AppTextStyles.engraved(
            size: 10,
            color: AppColors.goldDeep,
            spacing: 2,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Text('Reset your password', style: AppTextStyles.serif(size: 22)),
        const SizedBox(height: AppSpacing.sm),
        AnimatedSize(
          duration: Motion.base,
          curve: Motion.standard,
          alignment: Alignment.topCenter,
          child: AnimatedSwitcher(
            duration: Motion.base,
            switchInCurve: Motion.standard,
            switchOutCurve: Motion.exit,
            transitionBuilder: (child, animation) =>
                FadeTransition(opacity: animation, child: child),
            child: _sent ? _sentState() : _formState(),
          ),
        ),
      ],
    );
  }

  Widget _formState() {
    return Column(
      key: const ValueKey('reset-form'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          "Enter your account's email and we'll send you a link to choose "
          'a new password.',
          style: AppTextStyles.body,
        ),
        const SizedBox(height: AppSpacing.lg),
        AppTextField(
          label: 'Email',
          hint: 'you@email.com',
          controller: _email,
          errorText: _err,
          prefixIcon: Icons.mail_outline,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.email],
          onChanged: (_) {
            if (_err != null) setState(() => _err = null);
          },
        ),
      ],
    );
  }

  Widget _sentState() {
    return Column(
      key: const ValueKey('reset-sent'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.sm),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.gold.withValues(alpha: 0.14),
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.gold.withValues(alpha: 0.5),
                ),
              ),
              child: const Icon(
                Icons.mark_email_read_outlined,
                size: 20,
                color: AppColors.goldDeep,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                'Check your inbox — if ${_email.text.trim()} has an account, '
                'a password reset link is on its way.',
                style: AppTextStyles.body,
              ),
            ),
          ],
        ),
      ],
    );
  }
}
