import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/booking.dart';
import '../../data/booking_repository.dart';
import '../../data/catering.dart';
import '../../data/catering_repository.dart';
import '../../widgets.dart';
import 'booking_page.dart';
import 'layout_preview_page.dart';
import 'payment_page.dart';

/// "Order Tracking" — where a member follows every order they've filed, from
/// the moment it's sent to the day it's done. Pushed as a full route from
/// Settings.
///
/// Orders stream live from [BookingRepository.watchMine], so a move the Orders
/// dashboard makes (pending → confirmed → completed, or declined) lands here
/// without a refresh. Nothing on this screen writes: a booking's shape is the
/// team's to change once it's filed, and the member's move is to call.
///
/// Both wizards write into the same collection but fill different blanks — the
/// catering wizard a dish per course, the food-pack one `menu` lines — so the
/// detail sheet renders whatever the order actually carries rather than a fixed
/// list of rows (see [_OrderSheet]).
class OrderTrackingPage extends StatefulWidget {
  const OrderTrackingPage({super.key});

  @override
  State<OrderTrackingPage> createState() => _OrderTrackingPageState();
}

class _OrderTrackingPageState extends State<OrderTrackingPage> {
  StreamSubscription<List<Booking>>? _sub;

  List<Booking> _orders = const [];
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _sub = BookingRepository().watchMine().listen(
      (orders) {
        if (!mounted) return;
        setState(() {
          _orders = orders;
          _loading = false;
          _error = false;
        });
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

  Duration _d(int ms) => Duration(milliseconds: ms);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text('Order Tracking', style: AppTextStyles.heading),
      ),
      body: Stack(
        children: [
          const ParchmentBackground(weave: true),
          SafeArea(top: false, child: _buildBody()),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const _TrackingSkeleton();
    if (_error) return const _TrackingNotice.error();
    if (_orders.isEmpty) return const _TrackingNotice.empty();

    // Drafts aren't orders yet — they never reached the team — so they sit in
    // their own row above everything else, in their own quieter card. Of what
    // remains, anything still open sits above the closed ones, so the order a
    // member is actually waiting on is the one they land on. Each group keeps
    // the stream's newest-first order.
    final drafts = _orders.where((o) => o.isDraft).toList();
    bool isOpen(Booking o) =>
        o.status == BookingStatus.pending ||
        o.status == BookingStatus.confirmed;
    final open = _orders.where((o) => !o.isDraft && isOpen(o)).toList();
    final closed = _orders.where((o) => !o.isDraft && !isOpen(o)).toList();

    if (drafts.isNotEmpty && open.isEmpty && closed.isEmpty) {
      return _buildDraftsOnly(drafts);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        AppSpacing.lg,
        AppSpacing.screen,
        AppSpacing.section,
      ),
      children: [
        FadeSlideIn(
          child: Text(
            open.isEmpty
                ? 'Your past orders'
                : 'You have ${open.length} order${open.length == 1 ? '' : 's'} '
                    'with us',
            style: AppTextStyles.title,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        FadeSlideIn(
          delay: _d(40),
          child: Text(
            'Tap any order to see everything you sent us, and where it stands.',
            style: AppTextStyles.bodySmall,
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        if (drafts.isNotEmpty) ...[
          FadeSlideIn(
            child: Text('SAVED FOR LATER', style: AppTextStyles.eyebrow),
          ),
          const SizedBox(height: AppSpacing.md),
          for (final (i, draft) in drafts.indexed) ...[
            FadeSlideIn(
              delay: _d(40 + 60 * i),
              child: _DraftCard(
                draft: draft,
                onContinue: () => _resumeDraft(draft),
                onDiscard: () => _discardDraft(draft),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          const SizedBox(height: AppSpacing.lg),
        ],
        for (final (i, order) in open.indexed) ...[
          FadeSlideIn(
            delay: _d(80 + 60 * i),
            child: _OrderCard(order: order, onTap: () => _openSheet(order)),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
        if (closed.isNotEmpty) ...[
          if (open.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            FadeSlideIn(
              delay: _d(80 + 60 * open.length),
              child: Text('EARLIER', style: AppTextStyles.eyebrow),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          for (final (i, order) in closed.indexed) ...[
            FadeSlideIn(
              delay: _d(120 + 60 * (open.length + i)),
              child: _OrderCard(order: order, onTap: () => _openSheet(order)),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ],
      ],
    );
  }

  /// The whole list when every booking the member has is an unsent draft — its
  /// own layout rather than reusing the "past orders" header above, which
  /// would otherwise claim there are zero orders while a draft sits right
  /// there waiting to be finished.
  Widget _buildDraftsOnly(List<Booking> drafts) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        AppSpacing.lg,
        AppSpacing.screen,
        AppSpacing.section,
      ),
      children: [
        FadeSlideIn(
          child: Text(
            drafts.length == 1
                ? 'You have a booking saved for later'
                : 'You have ${drafts.length} bookings saved for later',
            style: AppTextStyles.title,
          ),
        ),
        const SizedBox(height: AppSpacing.xs),
        FadeSlideIn(
          delay: _d(40),
          child: Text(
            'Pick up where you left off, whenever you\'re ready.',
            style: AppTextStyles.bodySmall,
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        for (final (i, draft) in drafts.indexed) ...[
          FadeSlideIn(
            delay: _d(80 + 60 * i),
            child: _DraftCard(
              draft: draft,
              onContinue: () => _resumeDraft(draft),
              onDiscard: () => _discardDraft(draft),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
      ],
    );
  }

  void _openSheet(Booking order) {
    showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => _OrderSheet(
        order: order,
        // Only offered on an order that actually still owes its downpayment.
        onPay: order.needsDownpayment
            ? () {
                Navigator.of(dialogContext).pop();
                _pay(order);
              }
            : null,
      ),
    );
  }

  /// Picks a stalled downpayment back up. The order was filed the moment the
  /// member finished the wizard, so this is a return trip, not a new booking:
  /// the checkout page it already opened is handed back rather than a second one
  /// (see [PaymentPage.existingSessionId]).
  ///
  /// Nothing is done with the result — the order list streams from Firestore, so
  /// a settled payment lands here on its own.
  Future<void> _pay(Booking order) async {
    await Navigator.of(context).push<bool>(
      BrandPageRoute<bool>(
        builder: (_) => PaymentPage(
          bookingId: order.id,
          reference: order.reference,
          total: order.paymentTotal,
          due: order.paymentDue,
          orderKind: order.type,
          summary: order.headline,
          existingSessionId: order.checkoutSessionId,
          existingCheckoutUrl: order.checkoutUrl,
          clientName: order.value('clientName'),
          phone: order.value('contactNumber'),
          email: order.value('email'),
        ),
      ),
    );
  }

  /// Reopens the catering wizard on a saved draft. The draft names the
  /// package it was booked against ([Booking.draftPackageId]); that package
  /// has to be resolved and handed to [BookingPage] BEFORE it's pushed,
  /// because the wizard's menu steps are built from that specific package's
  /// inclusions (see [BookingPage.resumeFrom]).
  ///
  /// A draft saved before any package was picked (or one whose package has
  /// since been deleted outright) resumes with no package behind it — the
  /// same shape as the wizard's own "describe one" path, so the fixed steps
  /// still work and only the menu steps are unavailable.
  Future<void> _resumeDraft(Booking draft) async {
    CateringPackage? package;
    final packageId = draft.draftPackageId;
    if (packageId.isNotEmpty) {
      try {
        package = await CateringRepository().fetchPackage(packageId);
      } catch (_) {
        // Offline — resume anyway rather than stranding the member on a
        // spinner; the menu steps just won't have a package to draw from.
      }
    }
    if (!mounted) return;
    await Navigator.of(context).push<void>(
      BrandPageRoute<void>(
        builder: (_) => BookingPage(package: package, resumeFrom: draft),
      ),
    );
    // The order list streams from Firestore, so continuing to a real send (or
    // saving the draft again) reflects here on its own — nothing to do.
  }

  /// Deletes a saved draft outright, after the member confirms — this is the
  /// one place on this screen anything is actually thrown away, so it asks
  /// first rather than treating a stray tap as consent.
  Future<void> _discardDraft(Booking draft) async {
    final confirmed = await showCenterDialog<bool>(
      context: context,
      builder: (dialogContext) => AppDialogShell(
        footer: Row(
          children: [
            Expanded(
              child: AppButton.secondary(
                label: 'KEEP IT',
                onPressed: () => Navigator.of(dialogContext).pop(false),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: AppButton.primary(
                label: 'DISCARD',
                icon: Icons.delete_outline_rounded,
                onPressed: () => Navigator.of(dialogContext).pop(true),
              ),
            ),
          ],
        ),
        children: [
          Text('SAVED FOR LATER', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          Text('Discard this draft?', style: AppTextStyles.title),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Everything you filled in — ${draft.headline} — will be gone for '
            'good.',
            style: AppTextStyles.bodySmall,
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await BookingRepository().deleteDraft(draft.id);
    } catch (_) {
      if (!mounted) return;
      showCenterDialog<void>(
        context: context,
        builder: (dialogContext) => AppDialogShell(
          footer: AppButton.primary(
            label: 'GOT IT',
            fullWidth: true,
            onPressed: () => Navigator.of(dialogContext).pop(),
          ),
          children: [
            Text('COULDN\'T DISCARD', style: AppTextStyles.eyebrow),
            const SizedBox(height: AppSpacing.sm),
            Text('That didn\'t go through', style: AppTextStyles.title),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Please check your connection and try again.',
              style: AppTextStyles.bodySmall,
            ),
          ],
        ),
      );
    }
    // On success the stream drops it on its own — nothing else to do.
  }
}

// ════════════════════════════ Status vocabulary ════════════════════════════
/// How a status reads to the member: the badge word, and the sentence under it
/// saying what's actually happening. The dashboard's own labels are staff-facing
/// ("Pending"); these speak to the person waiting.
extension on BookingStatus {
  // [draft] never reaches any of these — [_buildBody] routes it to
  // [_DraftCard] before [_OrderCard]/[_StatusBadge]/[_StatusTrack] ever see
  // one — but the switch has to stay exhaustive, so it carries a placeholder
  // rather than a wildcard that would silently swallow a real future status.
  String get label => switch (this) {
        BookingStatus.draft => 'Draft',
        BookingStatus.pending => 'Pending',
        BookingStatus.confirmed => 'Confirmed',
        BookingStatus.completed => 'Completed',
        BookingStatus.declined => 'Declined',
      };

  /// [fulfilment] narrows the [confirmed] line once the kitchen has actually
  /// started — null on every other status, and on a confirmed order that
  /// hasn't reached the Team Leader desk yet.
  String story([FulfilmentStage? fulfilment]) => switch (this) {
        BookingStatus.draft => 'Saved, not yet sent.',
        BookingStatus.pending =>
          'We have your order and are going through it. We\'ll call your '
              'contact number to confirm the details.',
        BookingStatus.confirmed => switch (fulfilment) {
            null || FulfilmentStage.preparing =>
              'Your date is locked in and the kitchen is planning for it. '
                  'We\'ll be in touch again before the day.',
            FulfilmentStage.ready =>
              'Cooked and packed — waiting to be sent your way.',
            FulfilmentStage.released =>
              'On its way to you now.',
            FulfilmentStage.delivered =>
              'Delivered — enjoy! We hope everything went well.',
          },
        BookingStatus.completed =>
          'This one\'s done — maraming salamat for letting us cook for you.',
        BookingStatus.declined =>
          'We couldn\'t take this one on. Please message us and we\'ll see '
              'what we can arrange.',
      };

  Color get tint => switch (this) {
        BookingStatus.draft => AppColors.brownSoft,
        BookingStatus.pending => AppColors.goldDeep,
        BookingStatus.confirmed => AppColors.olive,
        BookingStatus.completed => AppColors.brown,
        BookingStatus.declined => const Color(0xFF8C2F1F),
      };

  IconData get icon => switch (this) {
        BookingStatus.draft => Icons.edit_note_rounded,
        BookingStatus.pending => Icons.hourglass_top_rounded,
        BookingStatus.confirmed => Icons.event_available_rounded,
        BookingStatus.completed => Icons.check_circle_rounded,
        BookingStatus.declined => Icons.do_not_disturb_on_outlined,
      };
}

/// How an order's downpayment reads to the member. [PaymentState.none] — an
/// order filed before the downpayment gate existed — says nothing at all, since
/// asking for a payment the team already settled by hand would be wrong.
extension on PaymentState {
  String? get note => switch (this) {
        PaymentState.awaiting =>
          'We hold your date once the downpayment lands.',
        PaymentState.paid => 'Downpayment received — thank you.',
        PaymentState.quoteNeeded =>
          'We\'ll send you a quotation, then arrange the downpayment with you.',
        PaymentState.none => null,
      };

  IconData get icon => switch (this) {
        PaymentState.awaiting => Icons.lock_outline_rounded,
        PaymentState.paid => Icons.verified_outlined,
        PaymentState.quoteNeeded => Icons.request_quote_outlined,
        PaymentState.none => Icons.receipt_long_outlined,
      };

  Color get tint => switch (this) {
        PaymentState.awaiting => AppColors.goldDeep,
        PaymentState.paid => AppColors.olive,
        _ => AppColors.brownSoft,
      };
}

// ════════════════════════════ The order card ════════════════════════════
/// One order in the list: what it's for, when it happens, where it stands, and
/// a rule showing how far along the workflow it is.
class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order, required this.onTap});

  final Booking order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final filed = order.createdAt;
    return PressableScale(
      onTap: onTap,
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    '${order.type.toUpperCase()} · NO. ${order.reference}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.eyebrow,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                _StatusBadge(status: order.status),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              order.headline,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.sans(size: 15, weight: FontWeight.w700),
            ),
            const SizedBox(height: AppSpacing.md),
            if (order.eventDate.isNotEmpty)
              _MetaLine(icon: Icons.event_outlined, text: order.eventDate),
            if (order.value('venue').isNotEmpty)
              _MetaLine(
                icon: Icons.place_outlined,
                text: order.value('venue'),
              ),
            if (order.value('pax').isNotEmpty)
              _MetaLine(
                icon: Icons.groups_outlined,
                text: '${order.value('pax')} pax',
              ),
            const SizedBox(height: AppSpacing.md),
            _StatusTrack(status: order.status),
            if (order.status == BookingStatus.confirmed &&
                order.fulfilment != null) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  const Icon(
                    Icons.local_shipping_outlined,
                    size: 13,
                    color: AppColors.brownSoft,
                  ),
                  const SizedBox(width: 5),
                  Text(
                    order.fulfilment!.stage.label,
                    style: AppTextStyles.sans(
                      size: 11,
                      weight: FontWeight.w600,
                      color: AppColors.brownSoft,
                    ),
                  ),
                ],
              ),
            ],
            // An unpaid downpayment is the one thing on this card the member can
            // act on, so it's called out above the quiet footer rather than
            // buried in the detail sheet.
            if (order.needsDownpayment) ...[
              const SizedBox(height: AppSpacing.md),
              _DownpaymentStrip(order: order),
            ],
            const SizedBox(height: AppSpacing.sm + 2),
            Row(
              children: [
                Expanded(
                  child: Text(
                    filed == null ? 'Just sent' : 'Sent ${_shortDate(filed)}',
                    style: AppTextStyles.bodySmall,
                  ),
                ),
                Text(
                  'DETAILS',
                  style: AppTextStyles.engraved(
                    size: 9,
                    color: AppColors.brownSoft,
                    spacing: 1.2,
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  size: 18,
                  color: AppColors.brownSoft.withValues(alpha: 0.6),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// A "Continue later" draft on the list — quieter than [_OrderCard] (no status
/// track, no reference number: it isn't an order the team has seen) and with
/// two actions instead of one tap, since a draft is something the member might
/// as easily discard as pick back up.
class _DraftCard extends StatelessWidget {
  const _DraftCard({
    required this.draft,
    required this.onContinue,
    required this.onDiscard,
  });

  final Booking draft;
  final VoidCallback onContinue;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  'CATERING · SAVED DRAFT',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.eyebrow,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              IconButton(
                onPressed: onDiscard,
                tooltip: 'Discard draft',
                visualDensity: VisualDensity.compact,
                icon: Icon(
                  Icons.delete_outline_rounded,
                  size: 20,
                  color: AppColors.brown.withValues(alpha: 0.45),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            draft.headline,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.sans(size: 15, weight: FontWeight.w700),
          ),
          const SizedBox(height: AppSpacing.md),
          if (draft.eventDate.isNotEmpty)
            _MetaLine(icon: Icons.event_outlined, text: draft.eventDate),
          if (draft.value('venue').isNotEmpty)
            _MetaLine(
              icon: Icons.place_outlined,
              text: draft.value('venue'),
            ),
          if (draft.value('pax').isNotEmpty)
            _MetaLine(
              icon: Icons.groups_outlined,
              text: '${draft.value('pax')} pax',
            ),
          const SizedBox(height: AppSpacing.md),
          AppButton.secondary(
            label: 'CONTINUE BOOKING',
            icon: Icons.arrow_forward_rounded,
            fullWidth: true,
            onPressed: onContinue,
          ),
        ],
      ),
    );
  }
}

/// The status word in a tinted pill.
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final BookingStatus status;

  @override
  Widget build(BuildContext context) {
    final tint = status.tint;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.10),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: tint.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(status.icon, size: 13, color: tint),
          const SizedBox(width: 5),
          Text(
            status.label.toUpperCase(),
            style: AppTextStyles.sans(
              size: 10,
              weight: FontWeight.w700,
              color: tint,
              spacing: 0.6,
            ),
          ),
        ],
      ),
    );
  }
}

/// Received → Confirmed → Completed as three segments of a thin rule, filled as
/// far as the order has travelled. A declined order left the track, so it reads
/// as one flat rule in the decline tint instead of a part-filled one.
class _StatusTrack extends StatelessWidget {
  const _StatusTrack({required this.status});

  final BookingStatus status;

  @override
  Widget build(BuildContext context) {
    final declined = status == BookingStatus.declined;
    final done = status.stagesDone;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            for (var i = 0; i < 3; i++) ...[
              if (i > 0) const SizedBox(width: 4),
              Expanded(
                child: AnimatedContainer(
                  duration: Motion.base,
                  curve: Motion.standard,
                  height: 3,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(2),
                    color: declined
                        ? status.tint.withValues(alpha: i == 0 ? 0.55 : 0.16)
                        : i < done
                            ? AppColors.gold
                            : AppColors.hairline,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 6),
        Text(
          declined
              ? 'Received · not taken on'
              : switch (status) {
                  BookingStatus.pending => 'Received · awaiting confirmation',
                  BookingStatus.confirmed => 'Confirmed · on the calendar',
                  _ => 'Completed · thank you',
                },
          style: AppTextStyles.bodySmall,
        ),
      ],
    );
  }
}

/// The kitchen → delivery rail: Preparing → Ready → Released → Delivered,
/// filled as far as the order has travelled. Only ever shown on a confirmed
/// order that the Team Leader desk has actually started — mirrors the same
/// four stages the dashboards themselves show (see `hp-fulfilment.js`).
class _FulfilmentRail extends StatelessWidget {
  const _FulfilmentRail({required this.fulfilment});

  final Fulfilment fulfilment;

  @override
  Widget build(BuildContext context) {
    final at = fulfilment.stage.index;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            for (final stage in FulfilmentStage.values) ...[
              if (stage.index > 0) const SizedBox(width: 4),
              Expanded(
                child: Column(
                  children: [
                    AnimatedContainer(
                      duration: Motion.base,
                      curve: Motion.standard,
                      height: 3,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(2),
                        color: stage.index <= at
                            ? AppColors.gold
                            : AppColors.hairline,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      stage.label,
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.sans(
                        size: 9.5,
                        weight: stage.index == at
                            ? FontWeight.w700
                            : FontWeight.w500,
                        color: stage.index <= at
                            ? AppColors.brown
                            : AppColors.brownSoft,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ],
    );
  }
}

/// The "downpayment due" call-out on an order card: the amount still owed, and a
/// nudge that tapping through settles it. Only drawn for an order in
/// [PaymentState.awaiting] — the whole card opens the detail sheet, which is
/// where the actual PAY button lives, so this stays a label rather than becoming
/// a second tap target competing with its own row.
class _DownpaymentStrip extends StatelessWidget {
  const _DownpaymentStrip({required this.order});

  final Booking order;

  @override
  Widget build(BuildContext context) {
    const tint = AppColors.goldDeep;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.07),
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: tint.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.lock_outline_rounded, size: 16, color: tint),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Downpayment due',
                  style: AppTextStyles.sans(
                    size: 12,
                    weight: FontWeight.w700,
                    color: tint,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  'Tap to pay the 50% that holds your date.',
                  style: AppTextStyles.sans(
                    size: 11,
                    color: AppColors.brownSoft,
                  ),
                ),
              ],
            ),
          ),
          if (order.paymentDue > 0)
            Text(
              peso(order.paymentDue),
              style: AppTextStyles.sans(
                size: 15,
                weight: FontWeight.w700,
                color: tint,
              ),
            ),
        ],
      ),
    );
  }
}

/// A quiet icon + text line of order metadata.
class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: AppColors.brownSoft),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.sans(size: 12, color: AppColors.brownSoft),
            ),
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════ The detail sheet ════════════════════════════
/// Everything the member sent, read back: where the order stands, the event, the
/// menu they chose, and the order's paper trail.
///
/// Only blanks the order actually carries are drawn — the wizards drop empty
/// answers on submit, and an older order predates the newer required fields, so
/// a missing key means "not on this booking" rather than a gap to show.
class _OrderSheet extends StatelessWidget {
  const _OrderSheet({required this.order, this.onPay});

  final Booking order;

  /// Settles the order's outstanding downpayment. Null on every order that
  /// doesn't owe one, which is what keeps the footer off orders where paying
  /// would make no sense.
  final VoidCallback? onPay;

  /// Every field on an order that isn't a menu course — the fixed questions
  /// both wizards ask, plus the bookkeeping keys [BookingRepository] and the
  /// payment flow stamp on. Whatever's left in [Booking.data] is a course the
  /// *booked package* asked for, keyed by [PackageCourse]'s camelCase (see
  /// `booking_page.dart`), so it's read back generically instead of against a
  /// fixed list — a package's courses vary, and a fixed list either shows the
  /// wrong count or nothing at all for a package that doesn't match it.
  static const Set<String> _nonCourseKeys = {
    'kindOfFunction', 'functionDate', 'venue', 'pax',
    'clientName', 'contactNumber', 'email', 'address',
    'ingress', 'egress', 'functionStart', 'foodServing', 'programEnd',
    'deliveryTime', 'package', 'notes',
    'menu', 'menuAddOns', 'bookingType',
    'uid', 'status', 'createdAt', 'statusUpdatedAt', 'history', 'deleted',
    'paymentStatus', 'paymentTotal', 'paymentDue', 'paymentPaid', 'paidAt',
    'paymentRef', 'paymentMethod', 'checkoutUrl', 'checkoutSessionId',
    'fulfilment',
  };

  /// A course field's camelCase key turned back into words: "beefOrPork" →
  /// "Beef Or Pork" → "Beef / Pork", matching how [PackageCourse.label] would
  /// have read had it been kept alongside the answer.
  static String _labelFor(String key) {
    final spaced = key.replaceAllMapped(
      RegExp('([a-z0-9])([A-Z])'),
      (m) => '${m[1]} ${m[2]}',
    );
    final words = spaced.split(' ');
    return [
      for (final w in words)
        if (w.isNotEmpty)
          w.toLowerCase() == 'or' ? '/' : w[0].toUpperCase() + w.substring(1),
    ].join(' ');
  }

  /// The event day as it unfolds — set-up through pack-out.
  static const List<(String, String)> _timeline = [
    ('ingress', 'Set-up begins'),
    ('functionStart', 'Function starts'),
    ('foodServing', 'Food is served'),
    ('programEnd', 'Program ends'),
    ('egress', 'Pack out by'),
    ('deliveryTime', 'Delivery time'),
  ];

  @override
  Widget build(BuildContext context) {
    final courses = [
      for (final key in order.data.keys)
        if (!_nonCourseKeys.contains(key) && order.value(key).isNotEmpty)
          (_labelFor(key), order.value(key)),
    ];
    final times = [
      for (final (key, label) in _timeline)
        if (order.value(key).isNotEmpty) (label, order.value(key)),
    ];
    final menu = order.lines('menu');
    final addOns = order.lines('menuAddOns');

    return AppDialogShell(
      footer: onPay == null
          ? null
          : AppButton.primary(
              label: order.paymentDue > 0
                  ? 'PAY ${peso(order.paymentDue)} NOW'
                  : 'PAY THE DOWNPAYMENT',
              icon: Icons.lock_outline_rounded,
              fullWidth: true,
              onPressed: onPay,
            ),
      children: [
        Text(
          '${order.type.toUpperCase()} ORDER · NO. ${order.reference}',
          style: AppTextStyles.eyebrow,
        ),
        const SizedBox(height: AppSpacing.sm),
        Text(order.headline, style: AppTextStyles.title),
        const SizedBox(height: AppSpacing.md),
        _StatusBadge(status: order.status),
        const SizedBox(height: AppSpacing.sm),
        Text(
          order.status.story(order.fulfilment?.stage),
          style: AppTextStyles.bodySmall,
        ),
        if (order.status == BookingStatus.confirmed &&
            order.fulfilment != null) ...[
          const SizedBox(height: AppSpacing.md),
          _FulfilmentRail(fulfilment: order.fulfilment!),
        ],
        const SizedBox(height: AppSpacing.lg),

        _MoneySection(order: order),
        _SheetSection(
          title: 'THE EVENT',
          rows: [
            if (order.eventDate.isNotEmpty) ('Date', order.eventDate),
            if (order.value('venue').isNotEmpty) ('Venue', order.value('venue')),
            if (order.value('pax').isNotEmpty) ('Pax', order.value('pax')),
            if (order.value('package').isNotEmpty)
              ('Package', order.value('package')),
            ...times,
          ],
        ),
        if (order.hasLayout) ...[
          const SizedBox(height: AppSpacing.md),
          AppButton.secondary(
            label: 'VIEW 3D LAYOUT',
            icon: Icons.view_in_ar_outlined,
            fullWidth: true,
            onPressed: () => Navigator.of(context).push(
              BrandPageRoute<void>(
                builder: (_) => LayoutPreviewPage(
                  booking: order.data,
                  eventName: order.headline,
                ),
              ),
            ),
          ),
        ],
        _SheetSection(
          title: 'YOU',
          rows: [
            if (order.value('clientName').isNotEmpty)
              ('Name', order.value('clientName')),
            if (order.value('contactNumber').isNotEmpty)
              ('Contact', order.value('contactNumber')),
            if (order.value('email').isNotEmpty) ('Email', order.value('email')),
            if (order.value('address').isNotEmpty)
              ('Address', order.value('address')),
          ],
        ),
        _SheetSection(title: 'THE MENU', rows: courses),
        if (menu.isNotEmpty) _SheetList(title: 'THE MENU', lines: menu),
        if (addOns.isNotEmpty) _SheetList(title: 'ADD-ONS', lines: addOns),
        if (order.value('notes').isNotEmpty)
          _SheetSection(
            title: 'YOUR NOTES',
            rows: [('Notes', order.value('notes'))],
          ),
        _PaperTrail(order: order),
      ],
    );
  }
}

/// The money on an order: what it comes to, what the downpayment was, and where
/// that payment stands. Drawn from the figures stamped on the order when it was
/// filed, so it reads the same later even if the package's price has since moved.
///
/// Silent on an order that predates the downpayment gate — it has no figures to
/// show, and a blank ledger would only puzzle the member.
class _MoneySection extends StatelessWidget {
  const _MoneySection({required this.order});

  final Booking order;

  @override
  Widget build(BuildContext context) {
    final state = order.payment;
    if (state == PaymentState.none) return const SizedBox.shrink();

    final paid = state == PaymentState.paid;
    final settled = paid ? (order.paymentPaid > 0 ? order.paymentPaid : order.paymentDue) : 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('THE DOWNPAYMENT', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(state.icon, size: 16, color: state.tint),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  state.note ?? '',
                  style: AppTextStyles.sans(
                    size: 12,
                    color: AppColors.brownSoft,
                  ),
                ),
              ),
            ],
          ),
          if (order.paymentTotal > 0) ...[
            const SizedBox(height: AppSpacing.sm),
            _MoneyRow(label: 'Order total', value: peso(order.paymentTotal)),
            if (order.paymentDue > 0)
              _MoneyRow(
                label: paid ? 'Paid' : 'Due now (50%)',
                value: peso(paid ? settled : order.paymentDue),
                strong: true,
              ),
            _MoneyRow(
              label: paid ? 'Balance on the day' : 'Balance after',
              value: peso(order.paymentTotal - (paid ? settled : order.paymentDue)),
            ),
            if (paid && order.paidAt != null)
              _MoneyRow(label: 'Settled', value: _longDate(order.paidAt!)),
            if (paid && order.paymentMethod.isNotEmpty)
              _MoneyRow(label: 'Paid with', value: order.paymentMethod),
            if (paid && order.paymentRef.isNotEmpty)
              _MoneyRow(label: 'Reference', value: order.paymentRef),
          ],
        ],
      ),
    );
  }
}

/// One label → figure line in [_MoneySection], shaped like [_SheetSection]'s rows
/// so the sheet reads as one document.
class _MoneyRow extends StatelessWidget {
  const _MoneyRow({
    required this.label,
    required this.value,
    this.strong = false,
  });

  final String label;
  final String value;
  final bool strong;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 104,
            child: Text(
              label,
              style: AppTextStyles.sans(size: 12, color: AppColors.brownSoft),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: AppTextStyles.sans(
                size: strong ? 13 : 12,
                weight: FontWeight.w700,
                color: strong ? AppColors.goldDeep : AppColors.brown,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A titled block of label → value rows; draws nothing when [rows] is empty.
class _SheetSection extends StatelessWidget {
  const _SheetSection({required this.title, required this.rows});

  final String title;
  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 104,
                    child: Text(
                      label,
                      style: AppTextStyles.sans(
                        size: 12,
                        color: AppColors.brownSoft,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      value,
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w600,
                      ),
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

/// A titled block of plain lines — the food-pack menu and the add-ons, which
/// arrive as one newline-joined field rather than label → value pairs.
class _SheetList extends StatelessWidget {
  const _SheetList({required this.title, required this.lines});

  final String title;
  final List<String> lines;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          for (final line in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                '· $line',
                style: AppTextStyles.sans(size: 12, weight: FontWeight.w600),
              ),
            ),
        ],
      ),
    );
  }
}

/// The order's paper trail — filed, then every move the team made, oldest
/// first, as a vertical rail. Orders filed before the dashboard started
/// stamping a history show just the day they were sent.
///
/// Once the order is confirmed, the kitchen's own movements (cooked, packed,
/// released, delivered — plus any release ask/refusal) are folded in too, so
/// the trail reads as one continuous record the way the dashboards' own
/// history does.
class _PaperTrail extends StatelessWidget {
  const _PaperTrail({required this.order});

  final Booking order;

  @override
  Widget build(BuildContext context) {
    final steps = <(String, DateTime?)>[
      ('Sent from the app', order.createdAt),
      for (final step in order.history)
        if (step.status != BookingStatus.pending) (step.status.label, step.at),
    ];
    // No history stamped, but the status has clearly moved on — show where it
    // got to, dated by the last status change.
    if (order.history.isEmpty && order.status != BookingStatus.pending) {
      steps.add((order.status.label, order.statusUpdatedAt));
    }
    for (final move in order.fulfilment?.movements ?? const []) {
      steps.add((move.title, move.at));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('THE PAPER TRAIL', style: AppTextStyles.eyebrow),
        const SizedBox(height: AppSpacing.sm),
        for (final (i, (label, at)) in steps.indexed)
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Column(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    margin: const EdgeInsets.only(top: 5),
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: i == steps.length - 1
                          ? AppColors.gold
                          : AppColors.brownSoft.withValues(alpha: 0.5),
                    ),
                  ),
                  if (i < steps.length - 1)
                    Container(
                      width: 1,
                      height: 22,
                      color: AppColors.hairline,
                    ),
                ],
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text.rich(
                    TextSpan(
                      text: label,
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w600,
                      ),
                      children: [
                        TextSpan(
                          text: at == null ? '' : '  ${_longDate(at)}',
                          style: AppTextStyles.sans(
                            size: 11,
                            color: AppColors.brownSoft,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
      ],
    );
  }
}

// ════════════════════════════ Loading / empty / error ════════════════════════
/// Two order-card silhouettes while the first snapshot lands.
class _TrackingSkeleton extends StatelessWidget {
  const _TrackingSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        AppSpacing.lg,
        AppSpacing.screen,
        AppSpacing.section,
      ),
      children: [
        const SkeletonLine(width: 200, height: 20),
        const SizedBox(height: AppSpacing.xl),
        for (var i = 0; i < 2; i++) ...[
          AppCard(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: const [
                SkeletonLine(width: 130, height: 10),
                SizedBox(height: AppSpacing.md),
                SkeletonLine(height: 15),
                SizedBox(height: AppSpacing.md),
                SkeletonLine(width: 150, height: 11),
                SizedBox(height: 8),
                SkeletonLine(width: 110, height: 11),
                SizedBox(height: AppSpacing.lg),
                SkeletonLine(height: 3, radius: 2),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
      ],
    );
  }
}

/// The centred note shown when there's nothing to track, or when the orders
/// couldn't be read.
class _TrackingNotice extends StatelessWidget {
  const _TrackingNotice.empty()
      : icon = Icons.receipt_long_outlined,
        eyebrow = 'NOTHING TO TRACK YET',
        title = 'No orders yet',
        message = 'Book us from the Catering tab and your order appears here '
            'the moment it\'s sent — with its status as we work through it.';

  const _TrackingNotice.error()
      : icon = Icons.cloud_off_outlined,
        eyebrow = 'COULDN\'T LOAD',
        title = 'We couldn\'t reach your orders',
        message = 'Check your connection and come back in a moment. Nothing is '
            'lost — your orders are safe with us.';

  final IconData icon;
  final String eyebrow;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: FadeSlideIn(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 40, color: AppColors.gold),
              const SizedBox(height: AppSpacing.lg),
              Text(eyebrow, style: AppTextStyles.eyebrow),
              const SizedBox(height: AppSpacing.sm),
              Text(
                title,
                textAlign: TextAlign.center,
                style: AppTextStyles.title,
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                message,
                textAlign: TextAlign.center,
                style: AppTextStyles.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ════════════════════════════ Dates ════════════════════════════
const List<String> _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/// "3 Aug 2026" — for the "Sent …" line.
String _shortDate(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';

/// "3 Aug 2026 · 2:45 PM" — for the paper trail, where the hour matters.
String _longDate(DateTime d) {
  final hour = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final minute = d.minute.toString().padLeft(2, '0');
  final meridiem = d.hour < 12 ? 'AM' : 'PM';
  return '${_shortDate(d)} · $hour:$minute $meridiem';
}
