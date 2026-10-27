import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../brand.dart';
import '../data/customer_repository.dart';
import '../widgets.dart';
import 'guest_shell.dart';
import 'user/user_shell.dart';

// How long the splash holds (after first frame) before advancing.
const int _holdMs = 3200;

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _intro;
  Timer? _advanceTimer;

  @override
  void initState() {
    super.initState();

    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        systemNavigationBarColor: AppColors.surface,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );

    _intro = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1700),
    )..forward();

    _advanceTimer = Timer(const Duration(milliseconds: _holdMs), _goHome);
  }

  void _goHome() {
    if (!mounted) return;
    // A returning, signed-in customer lands straight on the member side; guests
    // get the public shell.
    final signedIn = CustomerRepository().isSignedIn;
    Navigator.of(context).pushReplacement(
      PageRouteBuilder(
        transitionDuration: Motion.entrance,
        pageBuilder: (_, _, _) =>
            signedIn ? const UserShell() : const GuestShell(),
        // Parchment cross-fades while the logo Hero flies into the home header.
        transitionsBuilder: (_, anim, _, child) =>
            FadeTransition(opacity: anim, child: child),
      ),
    );
  }

  @override
  void dispose() {
    _advanceTimer?.cancel();
    _intro.dispose();
    super.dispose();
  }

  Animation<double> _stage(double begin, double end, Curve curve) =>
      CurvedAnimation(parent: _intro, curve: Interval(begin, end, curve: curve));

  @override
  Widget build(BuildContext context) {
    final logo = _stage(0.00, 0.62, Curves.easeOutCubic);
    final footer = _stage(0.55, 1.00, Curves.easeOut);
    final logoWidth = MediaQuery.of(context).size.width * 0.66;

    return Scaffold(
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          Center(
            child: AnimatedBuilder(
              animation: _intro,
              builder: (context, _) {
                return Opacity(
                  opacity: logo.value,
                  child: Transform.scale(
                    scale: 0.90 + 0.10 * logo.value,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 40),
                      child: Hero(
                        tag: AppAssets.logoHeroTag,
                        child: Image.asset(AppAssets.logo, width: logoWidth),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 56),
              child: AnimatedBuilder(
                animation: _intro,
                builder: (context, _) =>
                    Opacity(opacity: footer.value, child: const LoadingDots()),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
