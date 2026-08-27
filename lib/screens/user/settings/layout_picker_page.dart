import 'dart:async';

import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../data/booking.dart';
import '../../../data/booking_repository.dart';
import '../../../widgets.dart';
import '../layout_preview_page.dart';
import 'settings_widgets.dart';

/// "3D Layout" — a dedicated Settings entry for jumping straight to a room
/// preview, rather than requiring the member to first open Order Tracking and
/// find the right booking.
///
/// Streams the same [BookingRepository.watchMine] as Order Tracking and keeps
/// only the orders with a drawn floor plan ([Booking.hasLayout]) — most
/// members have at most one, so this skips straight to [LayoutPreviewPage]
/// when exactly one qualifies rather than making them pick from a list of one.
class LayoutPickerPage extends StatefulWidget {
  const LayoutPickerPage({super.key});

  @override
  State<LayoutPickerPage> createState() => _LayoutPickerPageState();
}

class _LayoutPickerPageState extends State<LayoutPickerPage> {
  StreamSubscription<List<Booking>>? _sub;

  List<Booking> _withLayout = const [];
  bool _loading = true;
  bool _error = false;

  // Skips to the single match automatically at most once — if the member
  // navigates back from the preview, the list underneath is what they land
  // on rather than an inescapable loop back into the same preview.
  bool _autoOpened = false;

  @override
  void initState() {
    super.initState();
    _sub = BookingRepository().watchMine().listen(
      (orders) {
        if (!mounted) return;
        final withLayout = orders.where((o) => o.hasLayout).toList();
        setState(() {
          _withLayout = withLayout;
          _loading = false;
          _error = false;
        });
        if (!_autoOpened && withLayout.length == 1) {
          _autoOpened = true;
          WidgetsBinding.instance
              .addPostFrameCallback((_) => _open(withLayout.first));
        }
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _loading = false;
          _error = true;
        });
      },
    );
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  void _open(Booking order) {
    Navigator.of(context).push(
      BrandPageRoute<void>(
        builder: (_) => LayoutPreviewPage(
          booking: order.data,
          eventName: order.headline,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SettingsScaffold(
      title: '3D Layout',
      children: [
        const SettingsLede(
          title: 'Your room, in 3D',
          body: 'Walk through the table and venue set-up the team drew '
              'for your event.',
        ),
        const SizedBox(height: AppSpacing.lg),
        SmoothSwap(child: _buildBody()),
      ],
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Padding(
        key: ValueKey('loading'),
        padding: EdgeInsets.only(top: AppSpacing.xl),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_error) {
      return const _LayoutPickerNotice(
        key: ValueKey('error'),
        icon: Icons.wifi_off_rounded,
        message: "Couldn't load your orders — check your connection.",
      );
    }
    if (_withLayout.isEmpty) {
      return const _LayoutPickerNotice(
        key: ValueKey('empty'),
        icon: Icons.view_in_ar_outlined,
        message: 'No room layout has been drawn for any of your orders yet — '
            'the team draws one once your event is confirmed.',
      );
    }
    // The single-match case auto-opens the preview (see initState); this list
    // is still what's underneath it, and what's shown to a member with more
    // than one order carrying a plan.
    return SettingsSection(
      key: const ValueKey('list'),
      title: 'PICK AN EVENT',
      rows: [
        for (final order in _withLayout)
          SettingsNavRow(
            icon: Icons.view_in_ar_outlined,
            title: order.headline,
            subtitle: order.eventDate.isNotEmpty ? order.eventDate : null,
            onTap: () => _open(order),
          ),
      ],
    );
  }
}

class _LayoutPickerNotice extends StatelessWidget {
  const _LayoutPickerNotice({
    super.key,
    required this.icon,
    required this.message,
  });

  final IconData icon;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xl),
      child: Column(
        children: [
          Icon(icon, size: 36, color: AppColors.brownSoft),
          const SizedBox(height: AppSpacing.md),
          Text(
            message,
            textAlign: TextAlign.center,
            style: AppTextStyles.body,
          ),
        ],
      ),
    );
  }
}
