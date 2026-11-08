part of 'app_shared.dart';

Future<T?> showCenterDialog<T>({
  required BuildContext context,
  required WidgetBuilder builder,
}) {
  return showGeneralDialog<T>(
    context: context,
    barrierDismissible: true,
    barrierLabel: MaterialLocalizations.of(context).modalBarrierDismissLabel,
    barrierColor: AppColors.brown.withValues(alpha: 0.46),
    transitionDuration: Motion.base,
    // ModalRoute caches the page widget, so the inset lookup must live under a
    // Builder â€” a dependency taken on the pageBuilder context itself would
    // never see the keyboard appear.
    pageBuilder: (context, _, _) => Builder(
      builder: (context) => AnimatedPadding(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: builder(context),
      ),
    ),
    transitionBuilder: (context, animation, _, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: Motion.standard,
        reverseCurve: Motion.exit,
      );
      return FadeTransition(
        opacity: curved,
        child: ScaleTransition(
          scale: Tween<double>(begin: 0.92, end: 1.0).animate(curved),
          child: child,
        ),
      );
    },
  );
}

/// The standard centered-dialog frame: a parchment card holding a scrolling body
/// and an optional pinned [footer], with a quiet close button in the corner.
/// Sized to sit comfortably in the middle of the screen on any device. Use it as
/// the [showCenterDialog] child so every popup shares one shape.
class AppDialogShell extends StatelessWidget {
  const AppDialogShell({
    super.key,
    required this.children,
    this.footer,
    this.maxWidth = 460,
  });

  final List<Widget> children;
  final Widget? footer;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final maxHeight = MediaQuery.sizeOf(context).height * 0.86;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth, maxHeight: maxHeight),
          child: Stack(
            children: [
              Material(
                color: AppColors.surface,
                clipBehavior: Clip.antiAlias,
                shape: RoundedRectangleBorder(
                  borderRadius: AppRadius.xlAll,
                  side: const BorderSide(color: AppColors.hairline),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(AppSpacing.xl),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: children,
                        ),
                      ),
                    ),
                    if (footer != null)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                          AppSpacing.xl,
                          0,
                          AppSpacing.xl,
                          AppSpacing.xl,
                        ),
                        child: footer!,
                      ),
                  ],
                ),
              ),
              const Positioned(
                top: AppSpacing.sm,
                right: AppSpacing.sm,
                child: _DialogCloseButton(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Quiet circular close affordance for [AppDialogShell] â€” sits over the card's
/// top-right corner and pops the dialog.
class _DialogCloseButton extends StatelessWidget {
  const _DialogCloseButton();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surface.withValues(alpha: 0.86),
      shape: const CircleBorder(side: BorderSide(color: AppColors.hairline)),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: () => Navigator.of(context).maybePop(),
        child: const Padding(
          padding: EdgeInsets.all(6),
          child: Icon(Icons.close, size: 18, color: AppColors.brown),
        ),
      ),
    );
  }
}

/// Notification bell icon button with an unread badge indicator.
/// Tapping opens the notifications modal dialog.
class NotificationIconButton extends StatelessWidget {
  const NotificationIconButton({super.key, this.hasUnread = true, this.onTap});

  final bool hasUnread;
  final VoidCallback? onTap;

  void _openNotifications(BuildContext context) {
    if (onTap != null) {
      onTap!();
      return;
    }
    showNotificationsModal(context);
  }

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: () => _openNotifications(context),
      child: Container(
        width: 38,
        height: 38,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: AppColors.surface,
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Badge(
          isLabelVisible: hasUnread,
          backgroundColor: AppColors.gold,
          smallSize: 7,
          offset: const Offset(1, -1),
          child: const Icon(
            Icons.notifications_outlined,
            size: 20,
            color: AppColors.brown,
          ),
        ),
      ),
    );
  }
}

/// Presents the live notifications modal dialog in a centered [AppDialogShell].
/// Streams all notifications from Firestore (personal + announcements) and
/// marks everything as read the moment the modal opens.
Future<void> showNotificationsModal(BuildContext context) {
  return showCenterDialog<void>(
    context: context,
    builder: (dialogContext) => const _NotificationsModalBody(),
  );
}

/// The stateful body of the notifications modal â€” owns the StreamBuilder so
/// mark-as-read can run once when the first list arrives.
class _NotificationsModalBody extends StatefulWidget {
  const _NotificationsModalBody();

  @override
  State<_NotificationsModalBody> createState() =>
      _NotificationsModalBodyState();
}

class _NotificationsModalBodyState extends State<_NotificationsModalBody> {
  bool _marked = false;

  @override
  Widget build(BuildContext context) {
    final repo = NotificationRepository();
    return StreamBuilder<List<AppNotification>>(
      stream: repo.watchAll(),
      builder: (context, snap) {
        final items = snap.data ?? [];
        final unread = items.where((n) => !n.isRead).length;

        // Mark all as read once on the first non-empty emission.
        if (items.isNotEmpty && !_marked) {
          _marked = true;
          WidgetsBinding.instance.addPostFrameCallback(
            (_) => repo.markAllRead(items),
          );
        }

        return AppDialogShell(
          children: [
            // â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            _NotifHeader(unread: unread),
            const SizedBox(height: AppSpacing.lg),

            // â”€â”€ Content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
            if (snap.connectionState == ConnectionState.waiting &&
                items.isEmpty)
              const _NotifLoading()
            else if (items.isEmpty)
              const _NotifEmpty()
            else
              Column(
                children: [
                  for (int i = 0; i < items.length; i++) ...[
                    _NotificationItem(notification: items[i]),
                    if (i < items.length - 1)
                      const SizedBox(height: AppSpacing.sm),
                  ],
                ],
              ),
          ],
        );
      },
    );
  }
}

/// Styled header section for the notifications modal.
class _NotifHeader extends StatelessWidget {
  const _NotifHeader({required this.unread});
  final int unread;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Eyebrow + unread pill on the same row
        Row(
          children: [
            Text('NOTIFICATIONS', style: AppTextStyles.eyebrow),
            const Spacer(),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 300),
              transitionBuilder: (child, anim) => FadeTransition(
                opacity: anim,
                child: ScaleTransition(scale: anim, child: child),
              ),
              child: unread > 0
                  ? Container(
                      key: ValueKey(unread),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.goldDeep,
                        borderRadius: BorderRadius.circular(99),
                      ),
                      child: Text(
                        '$unread unread',
                        style: AppTextStyles.sans(
                          size: 10,
                          weight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    )
                  : const SizedBox.shrink(key: ValueKey(0)),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text('Activity & Updates', style: AppTextStyles.title),
        const SizedBox(height: 6),
        Text(
          'Stay up to date with your kitchen orders and announcements.',
          style: AppTextStyles.bodySmall,
        ),
        const SizedBox(height: AppSpacing.md),
        // Warm gold gradient divider
        Container(
          height: 2,
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.gold, Colors.transparent],
              stops: [0.0, 1.0],
            ),
          ),
        ),
      ],
    );
  }
}

class _NotifLoading extends StatelessWidget {
  const _NotifLoading();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
    child: Center(
      child: SizedBox(
        width: 24,
        height: 24,
        child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.gold),
      ),
    ),
  );
}

class _NotifEmpty extends StatelessWidget {
  const _NotifEmpty();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xl),
      child: Column(
        children: [
          // Warm circle with bell icon
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.10),
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.gold.withValues(alpha: 0.25),
                width: 1.5,
              ),
            ),
            child: const Icon(
              Icons.notifications_none_outlined,
              size: 30,
              color: AppColors.goldDeep,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            'All caught up!',
            style: AppTextStyles.sans(
              size: 15,
              weight: FontWeight.w700,
              color: AppColors.brown,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Order updates and announcements will appear here.',
            textAlign: TextAlign.center,
            style: AppTextStyles.sans(
              size: 12,
              color: AppColors.brownSoft,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

class _NotificationItem extends StatelessWidget {
  const _NotificationItem({required this.notification});

  final AppNotification notification;

  IconData get _icon => switch (notification.type) {
    NotificationType.orderUpdate => Icons.receipt_long_outlined,
    NotificationType.promotion => Icons.local_offer_outlined,
    NotificationType.gabay => Icons.recommend_outlined,
  };

  String get _relativeTime {
    final diff = DateTime.now().difference(notification.createdAt);
    if (diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'Yesterday';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final isNew = !notification.isRead;
    return AppCard(
      onTap: () {
        if (notification.id.startsWith('ann-')) {
          final annId = notification.id.substring(4);
          final ann = AnnouncementRepository.instance.latest
              .cast<Announcement?>()
              .firstWhere((a) => a?.id == annId, orElse: () => null);
          if (ann != null) {
            Navigator.of(context).pop();
            AnnouncementPopupModal.show(context, announcements: [ann]);
          }
        }
      },
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: isNew
                  ? AppColors.gold.withValues(alpha: 0.16)
                  : AppColors.placeholderFill,
              shape: BoxShape.circle,
            ),
            child: Icon(
              _icon,
              size: 18,
              color: isNew ? AppColors.goldDeep : AppColors.brownSoft,
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        notification.title,
                        style: AppTextStyles.sans(
                          size: 13,
                          weight: FontWeight.w700,
                          color: AppColors.brown,
                        ),
                      ),
                    ),
                    if (isNew)
                      Container(
                        margin: const EdgeInsets.only(left: 6),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.gold.withValues(alpha: 0.2),
                          borderRadius: AppRadius.pillAll,
                        ),
                        child: Text(
                          'NEW',
                          style: AppTextStyles.sans(
                            size: 9,
                            weight: FontWeight.w700,
                            color: AppColors.goldDeep,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  notification.body,
                  style: AppTextStyles.sans(
                    size: 12,
                    color: AppColors.brownSoft,
                    height: 1.3,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  _relativeTime,
                  style: AppTextStyles.sans(
                    size: 10,
                    weight: FontWeight.w500,
                    color: AppColors.brownSoft.withValues(alpha: 0.6),
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

/// A small "Featured" pill laid over a dish photo â€” a clear, labelled mark
/// (star + engraved wordmark) rather than a bare icon that could read as a
/// favourite or rating. Shared by the Menu grid and the tap-to-view sheets.
class FeaturedTag extends StatelessWidget {
  const FeaturedTag({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(7, 4, 9, 4),
      decoration: BoxDecoration(
        color: AppColors.brown.withValues(alpha: 0.82),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.star_rounded, size: 12, color: AppColors.gold),
          const SizedBox(width: 4),
          Text(
            'FEATURED',
            style: AppTextStyles.engraved(
              size: 8,
              color: AppColors.cream,
              spacing: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}

/// Adds a subtle press-scale to any tappable surface.
class PressableScale extends StatefulWidget {
  const PressableScale({super.key, required this.child, this.onTap});

  final Widget child;
  final VoidCallback? onTap;

  @override
  State<PressableScale> createState() => _PressableScaleState();
}

class _PressableScaleState extends State<PressableScale> {
  bool _down = false;

  void _set(bool v) {
    if (_down != v) setState(() => _down = v);
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _set(true),
      onTapCancel: () => _set(false),
      onTapUp: (_) {
        _set(false);
        widget.onTap?.call();
      },
      child: AnimatedScale(
        scale: _down ? 0.97 : 1.0,
        duration: Motion.quick,
        curve: Motion.standard,
        child: widget.child,
      ),
    );
  }
}
