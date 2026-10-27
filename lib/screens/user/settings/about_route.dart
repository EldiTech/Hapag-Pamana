import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../widgets.dart';
import '../../about_page.dart';

/// The full Fill at Home story — the same [AboutPage] the guest About tab shows,
/// wrapped in its own parchment scaffold (with a back button) so the member side
/// can reach it from Settings.
///
/// [AboutPage] is a bare [ListView] meant to sit inside a shell, so it can't be
/// pushed as a route on its own; this is the frame that lets it be.
class SettingsAboutPage extends StatelessWidget {
  const SettingsAboutPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text('About', style: AppTextStyles.heading),
      ),
      body: const Stack(
        children: [
          ParchmentBackground(weave: true),
          SafeArea(top: false, child: AboutPage()),
        ],
      ),
    );
  }
}
