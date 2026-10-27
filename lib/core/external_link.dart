import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../brand.dart';

/// Opens [uri] in the matching external app (dialer, maps, mail, browser).
/// When nothing on the device can take it, copies [copyValue] instead and says
/// so — the row always does *something*.
///
/// Shared by the About story and the Settings module's Contact screen, so every
/// outbound link in the app succeeds the same way and fails the same useful way.
Future<void> openExternalLink(
  BuildContext context,
  Uri uri, {
  required String copyValue,
  required String copiedWhat,
}) async {
  var opened = false;
  try {
    opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  } catch (_) {
    opened = false;
  }
  if (opened || !context.mounted) return;

  await Clipboard.setData(ClipboardData(text: copyValue));
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.brown,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.mdAll),
        content: Text(
          '$copiedWhat copied to clipboard',
          style: AppTextStyles.sans(
            size: 12,
            weight: FontWeight.w600,
            color: AppColors.cream,
          ),
        ),
      ),
    );
}
