import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import '../brand.dart';
import '../core/widgets/app_shared.dart';
import '../data/member_preferences.dart';
import '../screens/splash_screen.dart';
import 'app_navigation.dart';

class HapagPamanaApp extends StatelessWidget {
  const HapagPamanaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<MemberPreferences>(
      valueListenable: MemberPreferencesScope.notifier,
      builder: (context, prefs, _) => MaterialApp(
        navigatorKey: AppNavigation.navigatorKey,
        scaffoldMessengerKey: AppNavigation.messengerKey,
        title: 'HapagPamana',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        locale: prefs.language.locale,
        supportedLocales: [
          for (final language in AppLanguage.values) language.locale,
        ],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) =>
            ShimmerScope(child: child ?? const SizedBox.shrink()),
        home: const SplashScreen(),
      ),
    );
  }
}
