import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/customer.dart';
import '../../data/customer_repository.dart';
import '../../widgets.dart';
import 'settings/settings_page.dart';

/// Member account tab — shows the signed-in customer's profile (from
/// `customers/{uid}`, falling back to the auth record), lets them set a profile
/// photo, and carries the Settings entry and log-out action. A standard
/// parchment inner-tab page, so it sits on the shell's shared background like
/// Menu / Catering.
class AccountPage extends StatefulWidget {
  const AccountPage({super.key, required this.onLogout});

  /// Signs out and returns to the guest side.
  final VoidCallback onLogout;

  @override
  State<AccountPage> createState() => _AccountPageState();
}

class _AccountPageState extends State<AccountPage> {
  final CustomerRepository _repo = CustomerRepository();

  Customer? _customer;
  bool _loading = true;

  /// Resolved profile photo (data URL or remote URL); '' when none. Held
  /// separately from [_customer] so an upload reflects instantly.
  String _photo = '';

  /// True while an upload / removal is in flight (shows a spinner over the
  /// avatar and blocks re-tapping).
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final c = await _repo.fetchCurrentCustomer();
      if (!mounted) return;
      setState(() {
        _customer = c;
        _photo = c?.photo ?? '';
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  Duration _d(int ms) => Duration(milliseconds: ms);

  void _openSettings() {
    Navigator.of(context).push(
      BrandPageRoute(
        builder: (_) => UserSettingsPage(onLogout: widget.onLogout),
      ),
    );
  }

  // ── Profile photo ─────────────────────────────────────────────────────────
  Future<void> _editPhoto() async {
    final choice = await showCenterDialog<String>(
      context: context,
      builder: (dialogContext) => AppDialogShell(
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: AppSpacing.sm),
            child: Text('PROFILE PHOTO', style: AppTextStyles.eyebrow),
          ),
          _SheetAction(
            icon: Icons.photo_library_outlined,
            label: 'Choose from gallery',
            onTap: () => Navigator.of(dialogContext).pop('gallery'),
          ),
          if (_photo.isNotEmpty)
            _SheetAction(
              icon: Icons.delete_outline,
              label: 'Remove photo',
              destructive: true,
              onTap: () => Navigator.of(dialogContext).pop('remove'),
            ),
        ],
      ),
    );

    if (!mounted || choice == null) return;
    if (choice == 'remove') {
      await _setPhoto(null);
    } else {
      await _pickFromGallery();
    }
  }

  Future<void> _pickFromGallery() async {
    try {
      final XFile? file = await ImagePicker().pickImage(
        source: ImageSource.gallery,
        // Downscale + compress so the inline data URL stays well under the 1MB
        // Firestore document limit.
        maxWidth: 512,
        maxHeight: 512,
        imageQuality: 72,
      );
      if (file == null) return;
      final bytes = await file.readAsBytes();
      final mime =
          file.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      await _setPhoto('data:$mime;base64,${base64Encode(bytes)}');
    } catch (_) {
      if (mounted) _snack("Couldn't open the gallery. Please try again.");
    }
  }

  Future<void> _setPhoto(String? dataUrl) async {
    setState(() => _busy = true);
    try {
      await _repo.updatePhoto(dataUrl);
      if (!mounted) return;
      setState(() {
        _photo = dataUrl ?? '';
        _busy = false;
      });
      _snack(dataUrl == null ? 'Photo removed.' : 'Profile photo updated.');
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      _snack("Couldn't update your photo. Please try again.");
    }
  }

  void _snack(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  static Uint8List? _decode(String dataUrl) {
    final comma = dataUrl.indexOf(',');
    if (comma == -1) return null;
    try {
      return base64Decode(dataUrl.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }

  @override
  Widget build(BuildContext context) {
    // Prefer the Firestore profile; fall back to the auth record so the screen
    // is still useful if the doc read fails.
    final name = (_customer?.name.isNotEmpty ?? false)
        ? _customer!.name
        : (_repo.displayName ?? '');
    final email = (_customer?.email.isNotEmpty ?? false)
        ? _customer!.email
        : (_repo.email ?? '');
    final phone = _customer?.phone ?? '';
    final initial = name.trim().isEmpty ? 'K' : name.trim()[0].toUpperCase();
    final joined = _customer?.createdAt;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        AppSpacing.xl,
        AppSpacing.screen,
        AppSpacing.section,
      ),
      children: [
        FadeSlideIn(child: Center(child: _Avatar(
          photo: _photo,
          initial: initial,
          busy: _busy,
          onTap: _busy ? null : _editPhoto,
        ))),
        const SizedBox(height: AppSpacing.lg),
        FadeSlideIn(
          delay: _d(80),
          child: Center(
            child: _loading
                ? const SkeletonLine(width: 160, height: 18)
                : Text(
                    name.isEmpty ? 'Member' : name,
                    textAlign: TextAlign.center,
                    style: AppTextStyles.displaySmall,
                  ),
          ),
        ),
        const SizedBox(height: 6),
        FadeSlideIn(
          delay: _d(110),
          child: Center(
            child: Text(
              'MEMBER',
              style: AppTextStyles.engraved(
                size: 10,
                color: AppColors.goldDeep,
                spacing: 2.5,
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.section),

        FadeSlideIn(
          delay: _d(160),
          child: AppCard(
            padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.xs,
              horizontal: AppSpacing.lg,
            ),
            child: Column(
              children: [
                _InfoRow(
                  icon: Icons.mail_outline,
                  label: 'Email',
                  value: email,
                  loading: _loading,
                ),
                const Divider(height: 1),
                _InfoRow(
                  icon: Icons.phone_outlined,
                  label: 'Phone',
                  value: phone,
                  loading: _loading,
                ),
                const Divider(height: 1),
                _InfoRow(
                  icon: Icons.event_outlined,
                  label: 'Member since',
                  value: joined == null ? '' : _formatDate(joined),
                  loading: _loading,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.section),

        FadeSlideIn(
          delay: _d(200),
          child: AppCard(
            onTap: _openSettings,
            padding: const EdgeInsets.symmetric(
              vertical: AppSpacing.md,
              horizontal: AppSpacing.lg,
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.settings_outlined,
                  size: 20,
                  color: AppColors.goldDeep,
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Text(
                    'Settings',
                    style: AppTextStyles.sans(
                      size: 14,
                      weight: FontWeight.w600,
                      color: AppColors.brown,
                    ),
                  ),
                ),
                Icon(
                  Icons.chevron_right,
                  size: 20,
                  color: AppColors.brownSoft.withValues(alpha: 0.6),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),

        FadeSlideIn(
          delay: _d(260),
          child: AppButton.secondary(
            label: 'LOG OUT',
            icon: Icons.logout,
            fullWidth: true,
            onPressed: widget.onLogout,
          ),
        ),
      ],
    );
  }

  static String _formatDate(DateTime d) {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${months[d.month - 1]} ${d.day}, ${d.year}';
  }
}

// ════════════════════════════ Avatar ════════════════════════════
/// The profile avatar — the member's photo (or their initial) in a gold-ringed
/// circle, with a small camera badge inviting a change. Shows a spinner while a
/// photo is being uploaded.
class _Avatar extends StatelessWidget {
  const _Avatar({
    required this.photo,
    required this.initial,
    required this.busy,
    required this.onTap,
  });

  final String photo;
  final String initial;
  final bool busy;
  final VoidCallback? onTap;

  static const double _size = 96;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: SizedBox(
        width: _size,
        height: _size,
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: _size,
              height: _size,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.placeholderFill,
                border: Border.all(
                  color: AppColors.gold.withValues(alpha: 0.5),
                  width: 1.6,
                ),
              ),
              child: ClipOval(child: _image()),
            ),
            if (busy)
              Positioned.fill(
                child: ClipOval(
                  child: ColoredBox(
                    color: AppColors.espresso.withValues(alpha: 0.45),
                    child: const Center(
                      child: SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.4,
                          color: AppColors.cream,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            // Camera badge bottom-right.
            Positioned(
              right: -2,
              bottom: -2,
              child: Container(
                width: 32,
                height: 32,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.brown,
                  border: Border.all(color: AppColors.cream, width: 2),
                ),
                child: const Icon(
                  Icons.photo_camera_outlined,
                  size: 15,
                  color: AppColors.cream,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _image() {
    if (photo.startsWith('data:')) {
      final bytes = _AccountPageState._decode(photo);
      if (bytes != null) {
        return Image.memory(
          bytes,
          width: _size,
          height: _size,
          fit: BoxFit.cover,
          errorBuilder: (_, _, _) => _letter(),
        );
      }
    } else if (photo.startsWith('http')) {
      return Image.network(
        photo,
        width: _size,
        height: _size,
        fit: BoxFit.cover,
        errorBuilder: (_, _, _) => _letter(),
      );
    }
    return _letter();
  }

  Widget _letter() => Center(
    child: Text(
      initial,
      style: AppTextStyles.serif(
        size: 40,
        color: AppColors.gold,
        weight: FontWeight.w700,
      ),
    ),
  );
}

// ════════════════════════════ Info row ════════════════════════════
/// One profile line: a leading icon with the label above its value, stacked so
/// a long value (e.g. an email) never collides with the label.
class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    required this.loading,
  });

  final IconData icon;
  final String label;
  final String value;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(icon, size: 20, color: AppColors.goldDeep),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label, style: AppTextStyles.label),
                const SizedBox(height: 3),
                if (loading)
                  const SkeletonLine(width: 140, height: 12)
                else
                  Text(
                    value.isEmpty ? 'Not set' : value,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.sans(
                      size: 14,
                      color: value.isEmpty
                          ? AppColors.brownSoft.withValues(alpha: 0.6)
                          : AppColors.brown,
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

// ════════════════════════════ Sheet action ════════════════════════════
/// A tappable row in the profile-photo bottom sheet.
class _SheetAction extends StatelessWidget {
  const _SheetAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.destructive = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final color = destructive ? const Color(0xFF9B3B2E) : AppColors.brown;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            Icon(icon, size: 22, color: color),
            const SizedBox(width: AppSpacing.md),
            Text(
              label,
              style: AppTextStyles.sans(
                size: 14,
                weight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
