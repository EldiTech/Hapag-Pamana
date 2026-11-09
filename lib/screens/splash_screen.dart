import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../app/app_startup.dart';
import '../brand.dart';
import '../data/customer_repository.dart';
import '../widgets.dart';
import 'guest_shell.dart';
import 'user/user_shell.dart';

// How long the splash holds (after first frame) before advancing.
const int _holdMs = 1600;

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _intro;
  late final Animation<double> _logoAnim;
  late final Animation<double> _scaleAnim;
  late final Animation<double> _footerAnim;
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
      duration: const Duration(milliseconds: 1500),
    );

    _logoAnim = CurvedAnimation(
      parent: _intro,
      curve: const Interval(0.00, 0.65, curve: Curves.easeOutCubic),
    );

    _scaleAnim = Tween<double>(begin: 0.90, end: 1.00).animate(_logoAnim);

    _footerAnim = CurvedAnimation(
      parent: _intro,
      curve: const Interval(0.55, 1.00, curve: Curves.easeOut),
    );

    _intro.forward();
    _advanceTimer = Timer(const Duration(milliseconds: _holdMs), _goHome);
  }

  Future<void> _goHome() async {
    await AppStartup.ready;
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

  @override
  Widget build(BuildContext context) {
    final logoWidth = MediaQuery.of(context).size.width * 0.66;

    return Scaffold(
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          Center(
            child: FadeTransition(
              opacity: _logoAnim,
              child: ScaleTransition(
                scale: _scaleAnim,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 40),
                  child: Hero(
                    tag: AppAssets.logoHeroTag,
                    child: Image.asset(AppAssets.logo, width: logoWidth),
                  ),
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.only(bottom: 56),
              child: FadeTransition(
                opacity: _footerAnim,
                child: const LoadingDots(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
