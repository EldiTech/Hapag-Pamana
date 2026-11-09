import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../brand.dart';
import '../../core/auth_validation.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/customer_repository.dart';
import '../../widgets.dart';
import 'account_creation_loading_page.dart';
import 'taste_profile_page.dart';
import 'welcome_hapag_page.dart';

/// Guest Sign-Up — a three-step wizard (Name · Contact · Security). Each step
/// validates before advancing; the final step creates a Firebase Auth account
/// and a matching `customers/{uid}` profile via [CustomerRepository] on
/// [AccountCreationLoadingPage], transitions to the celebratory
/// [WelcomeHapagPage], and then hands off to [TasteProfilePage].
class SignUpPage extends StatefulWidget {
  const SignUpPage({super.key});

  @override
  State<SignUpPage> createState() => _SignUpPageState();
}

class _SignUpPageState extends State<SignUpPage> {
  static const int _stepCount = 3;

  final PageController _pager = PageController();
  int _step = 0;

  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  String? _nameErr;
  String? _emailErr;
  String? _phoneErr;
  String? _passwordErr;
  String? _confirmErr;

  bool _obscurePw = true;
  bool _obscureConfirm = true;
  bool _submitting = false;

  static final RegExp _emailRe = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');

  @override
  void dispose() {
    _pager.dispose();
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  /// Validates the current step's fields, setting inline errors. Returns true
  /// when the step is complete.
  bool _validateStep(int step) {
    switch (step) {
      case 0:
        final name = _name.text.trim();
        setState(
          () => _nameErr = name.isEmpty ? 'Please enter your name' : null,
        );
        return _nameErr == null;
      case 1:
        final email = _email.text.trim();
        final phone = _phone.text.trim();
        setState(() {
          _emailErr = email.isEmpty
              ? 'Please enter your email'
              : (!_emailRe.hasMatch(email)
                    ? 'Enter a valid email address'
                    : null);
          _phoneErr = AuthValidation.phoneError(phone);
        });
        return _emailErr == null && _phoneErr == null;
      case 2:
        final pw = _password.text;
        final confirm = _confirm.text;
        setState(() {
          _passwordErr = AuthValidation.passwordError(pw);
          _confirmErr = confirm != pw ? "Passwords don't match" : null;
        });
        return _passwordErr == null && _confirmErr == null;
    }
    return true;
  }

  void _next() {
    if (_submitting) return;
    if (!_validateStep(_step)) return;
    if (_step < _stepCount - 1) {
      _pager.nextPage(duration: Motion.base, curve: Motion.standard);
    } else {
      _submit();
    }
  }

  void _back() {
    if (_submitting) return;
    if (_step == 0) {
      Navigator.of(context).pop();
      return;
    }
    _pager.previousPage(duration: Motion.base, curve: Motion.standard);
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    final email = _email.text.trim();
    final phone = _phone.text.trim();
    final pw = _password.text;

    final messenger = ScaffoldMessenger.of(context);

    setState(() => _submitting = true);

    // Prompt to the animated loading screen while account creation takes place
    final error = await Navigator.of(context).push<dynamic>(
      BrandPageRoute(
        builder: (_) => AccountCreationLoadingPage(
          name: name,
          email: email,
          phone: phone,
          password: pw,
        ),
      ),
    );

    if (mounted) {
      setState(() => _submitting = false);
    }

    // If null, account creation succeeded and AccountCreationLoadingPage
    // already transitioned to WelcomeHapagPage.
    if (error == null) return;
    if (!mounted) return;

    if (error is AuthInputException) {
      setState(() {
        if (error.field == 'phone') {
          _phoneErr = error.message;
        } else {
          _passwordErr = error.message;
        }
      });
      if (error.field == 'phone') {
        _pager.animateToPage(1, duration: Motion.base, curve: Motion.standard);
      }
    } else if (error is DuplicateAccountException) {
      setState(() {
        if (error.field == 'email') {
          _emailErr = error.message;
        } else {
          _phoneErr = 'That phone number is already registered';
        }
      });
      // Email and phone both live on the Contact step — jump there so the
      // duplication message is visible.
      _pager.animateToPage(1, duration: Motion.base, curve: Motion.standard);
    } else if (error is FirebaseAuthException) {
      setState(() {
        switch (error.code) {
          case 'email-already-in-use':
            _emailErr = 'That email already has an account';
          case 'invalid-email':
            _emailErr = 'Enter a valid email address';
          case 'weak-password':
          case 'password-does-not-meet-requirements':
            _passwordErr =
                'That password does not meet the security requirements.';
        }
      });
      // An email problem surfaces on the Contact step — jump back to it so the
      // message is visible (the user is on the Security step at submit time).
      if (error.code == 'email-already-in-use' || error.code == 'invalid-email') {
        _pager.animateToPage(1, duration: Motion.base, curve: Motion.standard);
      }
      const fieldCodes = {
        'email-already-in-use',
        'invalid-email',
        'weak-password',
        'password-does-not-meet-requirements',
      };
      if (!fieldCodes.contains(error.code)) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              error.code == 'operation-not-allowed'
                  ? 'Email sign-up isn\'t enabled yet. Please try again later.'
                  : (error.message ?? 'Sign-up failed. Please try again.'),
            ),
          ),
        );
      }
    } else if (error is FirebaseException) {
      // Firestore-side failure — most often `permission-denied` because the
      // security rules for `customers` / `customer_phones` haven't been
      // published yet, so the profile + phone-index writes are rejected.
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            error.code == 'permission-denied'
                ? "Couldn't save your account — the server rejected the request. Please try again shortly."
                : (error.message ?? 'Sign-up failed. Please try again.'),
          ),
        ),
      );
    } else {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Something went wrong. Please try again.'),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isLast = _step == _stepCount - 1;
    final primaryLabel = isLast ? 'CREATE ACCOUNT' : 'CONTINUE';

    final primary = AppButton.primary(
      label: primaryLabel,
      busy: _submitting,
      onPressed: _submitting ? null : _next,
      fullWidth: _step == 0,
    );

    // Intercept system / gesture back so it steps the wizard rather than
    // abandoning sign-up; only the first step pops the route.
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          leading: BackButton(color: AppColors.brown, onPressed: _back),
        ),
        extendBodyBehindAppBar: true,
        body: Stack(
          children: [
            const ParchmentBackground(weave: true),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: AppSpacing.sm),
                    Center(
                      // Shared Hero: the logo flies in from the login page and
                      // onward to the member home once the account is created.
                      child: Hero(
                        tag: AppAssets.logoHeroTag,
                        child: Image.asset(AppAssets.logo, height: 72),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.xl),

                    // Progress bar + step counter.
                    _WizardProgress(step: _step, total: _stepCount),
                    const SizedBox(height: 10),
                    Text(
                      'STEP ${_step + 1} OF $_stepCount',
                      style: AppTextStyles.engraved(
                        size: 9.5,
                        color: AppColors.goldDeep,
                        spacing: 2,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    // The steps. Swiping is disabled — navigation is driven by
                    // the Back / Continue buttons so each step is validated.
                    Expanded(
                      child: PageView(
                        controller: _pager,
                        physics: const NeverScrollableScrollPhysics(),
                        onPageChanged: (i) => setState(() => _step = i),
                        children: [
                          _nameStep(),
                          _contactStep(),
                          _securityStep(),
                        ],
                      ),
                    ),

                    // Footer: Back (after step 0) + Continue / Create Account.
                    // AnimatedSize + AnimatedSwitcher morph between the two
                    // layouts (lone CTA + "Log In" row vs. Back·Continue pair)
                    // instead of snapping as the wizard advances.
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
                        child: _step == 0
                            ? Column(
                                key: const ValueKey('footer-first'),
                                children: [
                                  primary,
                                  const SizedBox(height: AppSpacing.md),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      Text(
                                        'Already have an account?',
                                        style: AppTextStyles.bodySmall,
                                      ),
                                      TextButton(
                                        onPressed: _submitting
                                            ? null
                                            : () => Navigator.of(context).pop(),
                                        child: Text(
                                          'Log In',
                                          style: AppTextStyles.sans(
                                            size: 12,
                                            weight: FontWeight.w700,
                                            color: AppColors.goldDeep,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              )
                            // Back sizes to its own content (so "BACK" never
                            // wraps); the primary CTA fills the rest.
                            // IntrinsicHeight keeps both buttons the same
                            // height.
                            : IntrinsicHeight(
                                key: const ValueKey('footer-rest'),
                                child: Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    AppButton.secondary(
                                      label: 'BACK',
                                      icon: Icons.arrow_back_rounded,
                                      onPressed: _submitting ? null : _back,
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(child: primary),
                                  ],
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  Widget _nameStep() {
    return _WizardStep(
      eyebrow: "LET'S BEGIN",
      title: 'What should we\ncall you?',
      subtitle: "The name we'll greet you with at the hapag.",
      children: [
        AppTextField(
          label: 'Full name',
          hint: 'Juan dela Cruz',
          controller: _name,
          errorText: _nameErr,
          prefixIcon: Icons.person_outline,
          textInputAction: TextInputAction.next,
          keyboardType: TextInputType.name,
          autofillHints: const [AutofillHints.name],
          onChanged: (_) {
            if (_nameErr != null) setState(() => _nameErr = null);
          },
        ),
      ],
    );
  }

  Widget _contactStep() {
    return _WizardStep(
      eyebrow: 'STAY IN TOUCH',
      title: 'How can we\nreach you?',
      subtitle: 'For order updates and catering replies.',
      children: [
        AppTextField(
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
        const SizedBox(height: AppSpacing.lg),
        AppTextField(
          label: 'Phone',
          hint: '09XXXXXXXXX',
          controller: _phone,
          errorText: _phoneErr,
          prefixIcon: Icons.phone_outlined,
          keyboardType: TextInputType.phone,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.telephoneNumber],
          onChanged: (_) {
            if (_phoneErr != null) setState(() => _phoneErr = null);
          },
        ),
      ],
    );
  }

  Widget _securityStep() {
    return _WizardStep(
      eyebrow: 'ALMOST THERE',
      title: 'Secure your\naccount.',
      subtitle: AuthValidation.passwordMessage,
      children: [
        AppTextField(
          label: 'Password',
          hint: '••••••••',
          controller: _password,
          errorText: _passwordErr,
          prefixIcon: Icons.lock_outline,
          obscureText: _obscurePw,
          autofillHints: const [AutofillHints.newPassword],
          onChanged: (_) {
            if (_passwordErr != null) setState(() => _passwordErr = null);
          },
          suffixIcon: _VisibilityToggle(
            obscured: _obscurePw,
            onPressed: () => setState(() => _obscurePw = !_obscurePw),
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        AppTextField(
          label: 'Confirm password',
          hint: '••••••••',
          controller: _confirm,
          errorText: _confirmErr,
          prefixIcon: Icons.lock_outline,
          obscureText: _obscureConfirm,
          textInputAction: TextInputAction.done,
          autofillHints: const [AutofillHints.newPassword],
          onChanged: (_) {
            if (_confirmErr != null) setState(() => _confirmErr = null);
          },
          suffixIcon: _VisibilityToggle(
            obscured: _obscureConfirm,
            onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
          ),
        ),
      ],
    );
  }
}

/// One wizard step: an engraved eyebrow, a serif heading, a line of guidance,
/// then the step's fields. Scrolls so the keyboard never clips a field.
class _WizardStep extends StatelessWidget {
  const _WizardStep({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      // Key by title so the content fades/slides in as the page changes.
      child: FadeSlideIn(
        key: ValueKey(title),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              eyebrow,
              style: AppTextStyles.engraved(
                size: 11,
                color: AppColors.goldDeep,
                spacing: 2.5,
              ),
            ),
            const SizedBox(height: AppSpacing.sm + 2),
            Text(title, style: AppTextStyles.serif(size: 27, height: 1.12)),
            const SizedBox(height: AppSpacing.sm),
            Text(subtitle, style: AppTextStyles.body),
            const SizedBox(height: AppSpacing.xxl),
            ...children,
          ],
        ),
      ),
    );
  }
}

/// A segmented progress bar — one bar per step, gold for completed/current,
/// hairline for upcoming, with a brief fill animation as steps advance.
class _WizardProgress extends StatelessWidget {
  const _WizardProgress({required this.step, required this.total});

  final int step;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(total, (i) {
        final done = i <= step;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: i < total - 1 ? 8 : 0),
            child: AnimatedContainer(
              duration: Motion.base,
              curve: Motion.standard,
              height: 5,
              decoration: BoxDecoration(
                color: done ? AppColors.gold : AppColors.hairline,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
        );
      }),
    );
  }
}

/// The show/hide-password eye button shared by both password fields.
class _VisibilityToggle extends StatelessWidget {
  const _VisibilityToggle({required this.obscured, required this.onPressed});

  final bool obscured;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: AnimatedSwitcher(
        duration: Motion.quick,
        transitionBuilder: (child, animation) => FadeTransition(
          opacity: animation,
          child: ScaleTransition(scale: animation, child: child),
        ),
        child: Icon(
          obscured ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          key: ValueKey(obscured),
          size: 20,
        ),
      ),
      onPressed: onPressed,
    );
  }
}
