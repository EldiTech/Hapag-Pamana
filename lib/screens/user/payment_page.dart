import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../brand.dart';
import '../../core/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/booking_repository.dart';
import '../../data/paymongo_config.dart';
import '../../data/paymongo_service.dart';
import '../../widgets.dart';

/// The downpayment gate: half the order's total, settled through PayMongo before
/// the team will confirm a date.
///
/// Reached two ways, and it behaves the same from both:
///   • straight off a booking wizard, as the last thing between the member and
///     a confirmed order;
///   • from Order Tracking, when a member left a booking unpaid and came back.
///
/// The booking is already filed by the time this screen opens — as `pending`
/// with `paymentStatus: 'awaiting'` — so nothing the member typed can be lost to
/// a payment they abandon. That shapes the whole screen: leaving is a real
/// option ("PAY LATER"), not a failure state, and the order simply waits.
///
/// ## How payment is confirmed
///
/// PayMongo hosts the payment page; the member settles up in their browser. It
/// announces the result to a webhook, which this app has no server to receive —
/// so instead the app re-reads the checkout session ([PayMongoService.fetchCheckout])
/// and looks for a settled payment on it. That read happens when the member comes
/// back to the app, and on demand from the "I'VE PAID" button. The *check* is
/// authoritative — it's PayMongo's own record — but the write that follows is
/// this app's, which is why the class-level warning on [PayMongoConfig] matters:
/// a modified build could claim an order was paid for.
///
/// Pops `true` once the downpayment has cleared, `false` when the member leaves
/// it for later.
class PaymentPage extends StatefulWidget {
  const PaymentPage({
    super.key,
    required this.bookingId,
    required this.reference,
    required this.total,
    required this.due,
    required this.orderKind,
    required this.summary,
    this.priceLine,
    this.existingSessionId,
    this.existingCheckoutUrl,
    this.onCheckoutOpened,
    this.clientName,
    this.email,
    this.phone,
  });

  /// The filed booking this pays for. Travels to PayMongo as the checkout's
  /// reference number, so a payment can always be traced back to its order.
  final String bookingId;

  /// The short reference the member sees and can quote to the team.
  final String reference;

  /// The order's full amount, and the half being collected now.
  final num total;
  final num due;

  /// "Catering" / "Food Pack" — for the eyebrow and PayMongo's description.
  final String orderKind;

  /// One line naming what's being paid for (the occasion, or the first dish).
  final String summary;

  /// How the total was arrived at — "₱850 per head × 120 pax". Shown so the
  /// member can check the arithmetic rather than take the figure on trust.
  final String? priceLine;

  /// A checkout page already opened for this booking. Reusing it is the point:
  /// a member who backed out gets the same page rather than a second charge.
  final String? existingSessionId;
  final String? existingCheckoutUrl;

  /// Called with the session the moment one is opened, so a caller that may show
  /// this screen a second time — the wizard's thank-you state, whose "PAY THE
  /// DOWNPAYMENT" button reopens it — can hand back the same page instead of
  /// opening another. The booking carries the same pair, but a caller already
  /// holding it needn't re-read the document.
  final void Function(String sessionId, String checkoutUrl)? onCheckoutOpened;

  /// Prefills PayMongo's billing details, so the member doesn't retype them.
  final String? clientName;
  final String? email;
  final String? phone;

  @override
  State<PaymentPage> createState() => _PaymentPageState();
}

/// Which face the screen is showing.
enum _Face {
  /// The terms, and the button that opens PayMongo.
  review,

  /// Checkout is open in the browser; we're waiting to hear it went through.
  waiting,

  /// The downpayment cleared.
  done,
}

class _PaymentPageState extends State<PaymentPage>
    with WidgetsBindingObserver {
  _Face _face = _Face.review;

  /// True while a PayMongo call is in flight, so the CTA shows its spinner and
  /// can't be double-tapped into two checkout sessions.
  bool _busy = false;

  /// Set when a check came back with the payment still unsettled — the member
  /// needs telling that nothing has landed *yet*, which is different from an
  /// error.
  bool _checkedAndUnpaid = false;

  String? _error;

  String? _sessionId;
  String? _checkoutUrl;

  /// What actually cleared, per PayMongo — shown on the done face.
  num _paidAmount = 0;
  String? _paidMethod;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _sessionId = widget.existingSessionId?.trim().isEmpty ?? true
        ? null
        : widget.existingSessionId!.trim();
    _checkoutUrl = widget.existingCheckoutUrl?.trim().isEmpty ?? true
        ? null
        : widget.existingCheckoutUrl!.trim();
    // Arriving from Order Tracking with a session already open means the member
    // may well have paid on a previous visit — so the first thing to do is ask
    // PayMongo, rather than invite a second payment.
    if (_sessionId != null) {
      _face = _Face.waiting;
      WidgetsBinding.instance.addPostFrameCallback((_) => _check(quiet: true));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  /// Coming back from the browser is the moment a payment is most likely to have
  /// just landed, so the screen checks on its own rather than waiting to be
  /// asked. Quietly: a member who came back *without* paying shouldn't be met
  /// with a complaint.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        _face == _Face.waiting &&
        !_busy) {
      _check(quiet: true);
    }
  }

  // ── PayMongo ──────────────────────────────────────────────────────────────
  /// Opens the hosted checkout page — reusing the one already on the booking, or
  /// asking PayMongo for a new one.
  Future<void> _pay() async {
    setState(() {
      _busy = true;
      _error = null;
      _checkedAndUnpaid = false;
    });
    try {
      if (_sessionId == null || _checkoutUrl == null) {
        final session = await PayMongoService().createCheckout(
          reference: widget.bookingId,
          description:
              '${widget.orderKind} downpayment · No. ${widget.reference}',
          lineItemName: '50% downpayment — ${widget.summary}',
          amountPesos: widget.due,
          name: widget.clientName,
          email: widget.email,
          phone: widget.phone,
        );
        if (session.checkoutUrl.isEmpty) {
          throw const PayMongoException(
            'The payment service didn\'t give us a page to open. Please try '
            'again.',
          );
        }
        _sessionId = session.id;
        _checkoutUrl = session.checkoutUrl;
        widget.onCheckoutOpened?.call(session.id, session.checkoutUrl);
        // Stored before the browser opens: if the app dies on the handoff, the
        // member still comes back to the same page instead of a second charge.
        // A failure here isn't fatal to *this* attempt — the URL is in memory —
        // so it must not block the payment.
        try {
          await BookingRepository().attachCheckout(
            widget.bookingId,
            sessionId: session.id,
            url: session.checkoutUrl,
          );
        } catch (e) {
          // Paying now still works — the URL is in memory. But the session is
          // then only on this screen: a member who leaves and comes back gets a
          // *new* checkout page, which is how someone pays twice. So this is
          // logged rather than shrugged off; a permission-denied here means the
          // Firestore rules haven't been published (see firestore.rules).
          debugPrint('HapagPamana: couldn\'t attach the checkout session — $e');
        }
      }

      if (!mounted) return;
      final opened = await _open(_checkoutUrl!);
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (opened) _face = _Face.waiting;
      });
    } on PayMongoException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'Something interrupted the handoff to the payment service. '
            'Your booking is saved — please try again.';
      });
    }
  }

  /// Asks PayMongo whether the downpayment has settled, and records it if so.
  /// [quiet] suppresses the "nothing yet" line, for the automatic checks.
  Future<void> _check({bool quiet = false}) async {
    final id = _sessionId;
    if (id == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _checkedAndUnpaid = false;
    });
    try {
      final session = await PayMongoService().fetchCheckout(id);
      if (!mounted) return;
      if (!session.paid) {
        setState(() {
          _busy = false;
          _checkedAndUnpaid = !quiet;
        });
        return;
      }
      await _settle(session);
    } on PayMongoException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = 'We couldn\'t check with the payment service just now. Please '
            'try again in a moment — and if you\'ve already paid, don\'t pay '
            'twice.';
      });
    }
  }

  /// Writes a payment PayMongo has confirmed onto the booking and shows the
  /// receipt. Only ever called with a session PayMongo itself reports settled.
  ///
  /// Deals with its own failures rather than throwing: the money has moved
  /// either way, so the one thing this must never do is invite another payment.
  Future<void> _settle(CheckoutSession session) async {
    // Record what PayMongo says cleared, not what we asked for — if the two
    // ever disagree, the team should be able to see it.
    final amount = session.amountPesos > 0 ? session.amountPesos : widget.due;
    try {
      await BookingRepository().markPaid(
        widget.bookingId,
        amount: amount,
        paymentRef: session.paymentId,
        method: session.method,
      );
    } catch (e) {
      // The one failure that leaves a paid order reading unpaid, so it gets
      // named in the log: `permission-denied` means the booking rules haven't
      // been published, and no amount of retrying will land it.
      debugPrint('HapagPamana: couldn\'t record the downpayment — $e');
      if (!mounted) return;
      // The payment went through; this only means we couldn't write it down.
      setState(() {
        _busy = false;
        _error = 'Your payment went through, but we couldn\'t record it just '
            'now — please don\'t pay again. Check once more in a moment, or '
            'quote reference No. ${widget.reference} and we\'ll settle it with '
            'you.';
      });
      return;
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _face = _Face.done;
      _paidAmount = amount;
      _paidMethod = session.method;
    });
  }

  /// Opens [url] in the browser, falling back to the clipboard when no browser
  /// will take it — the same courtesy the About screen's links extend.
  Future<bool> _open(String url) async {
    var opened = false;
    try {
      opened = await launchUrl(
        Uri.parse(url),
        mode: LaunchMode.externalApplication,
      );
    } catch (_) {
      opened = false;
    }
    if (opened || !mounted) return opened;

    await Clipboard.setData(ClipboardData(text: url));
    if (!mounted) return false;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          content: Text(
            'We couldn\'t open your browser — the payment link is copied, '
            'paste it into any browser to pay.',
          ),
        ),
      );
    return false;
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    final done = _face == _Face.done;
    return PopScope(
      // Leaving is legitimate at any point — the booking is filed and the
      // payment resumable — so back simply reports whether it was settled.
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(done);
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          flexibleSpace:
              const ParchmentBackground(weave: true, vignette: false),
          title: Text(
            done ? 'Downpayment received' : 'Reserve your date',
            style: AppTextStyles.heading,
          ),
          leading: IconButton(
            icon: const Icon(Icons.close_rounded),
            tooltip: 'Close',
            onPressed: () => Navigator.of(context).pop(done),
          ),
        ),
        body: Stack(
          children: [
            const ParchmentBackground(weave: true),
            SafeArea(
              top: false,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.screen,
                  AppSpacing.lg,
                  AppSpacing.screen,
                  AppSpacing.section,
                ),
                children: done ? _doneFace() : _payFace(),
              ),
            ),
          ],
        ),
        bottomNavigationBar: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.screen,
              AppSpacing.md,
              AppSpacing.screen,
              AppSpacing.lg,
            ),
            child: _footer(),
          ),
        ),
      ),
    );
  }

  Widget _footer() {
    switch (_face) {
      case _Face.review:
        // The booking is already filed — see the class doc — so leaving here
        // is a real option, not an error state. Offered plainly rather than
        // left to the app bar's close icon, which reads as "cancel" more than
        // "I'll pay later", and only the icon otherwise the review face gave
        // the member ONE way forward.
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppButton.primary(
              label: 'PAY ${peso(widget.due)} NOW',
              icon: Icons.lock_outline_rounded,
              busy: _busy,
              fullWidth: true,
              onPressed: _pay,
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton.secondary(
              label: 'PAY LATER',
              fullWidth: true,
              onPressed:
                  _busy ? null : () => Navigator.of(context).pop(false),
            ),
          ],
        );
      case _Face.waiting:
        return Column(
          // The Scaffold measures its bottom bar against the *whole* screen's
          // height, so a Column left at its default MainAxisSize.max claims all
          // of it: the body is squeezed to nothing and this stack of buttons
          // rides up over the app bar. Only this face stacks two rows, which is
          // why it was the only one that broke.
          mainAxisSize: MainAxisSize.min,
          children: [
            AppButton.primary(
              label: 'I\'VE PAID — CHECK NOW',
              icon: Icons.refresh_rounded,
              busy: _busy,
              fullWidth: true,
              onPressed: () => _check(),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: AppButton.secondary(
                    label: 'PAY LATER',
                    onPressed:
                        _busy ? null : () => Navigator.of(context).pop(false),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: AppButton.secondary(
                    label: 'REOPEN',
                    icon: Icons.open_in_new_rounded,
                    onPressed: _busy || _checkoutUrl == null
                        ? null
                        : () => _open(_checkoutUrl!),
                  ),
                ),
              ],
            ),
          ],
        );
      case _Face.done:
        return AppButton.primary(
          label: 'DONE',
          fullWidth: true,
          onPressed: () => Navigator.of(context).pop(true),
        );
    }
  }

  // ── The review / waiting face ─────────────────────────────────────────────
  List<Widget> _payFace() {
    final waiting = _face == _Face.waiting;
    return [
      FadeSlideIn(
        child: Text(
          '${widget.orderKind.toUpperCase()} · NO. ${widget.reference}',
          style: AppTextStyles.eyebrow,
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      FadeSlideIn(
        delay: const Duration(milliseconds: 40),
        child: Text(
          waiting ? 'Waiting on your payment' : 'One last step',
          style: AppTextStyles.title,
        ),
      ),
      const SizedBox(height: AppSpacing.xs),
      FadeSlideIn(
        delay: const Duration(milliseconds: 70),
        child: Text(
          waiting
              ? 'Finish up on the PayMongo page, then come back and tap the '
                  'button below. We\'ll check with PayMongo — you don\'t have '
                  'to tell us the details.'
              : 'Your booking is saved. To hold the date we ask for half of '
                  'the total now; the balance is settled with the team on the '
                  'day of your function.',
          style: AppTextStyles.body,
        ),
      ),

      // Where the last check got to, directly under the paragraph: it answers
      // the button in the footer, and an answer the member has to scroll for
      // reads as "nothing happened" — which is how someone who has already paid
      // ends up paying twice.
      _notice(),
      const SizedBox(height: AppSpacing.xl),

      // ── The arithmetic, shown rather than asserted ──────────────────────
      FadeSlideIn(
        delay: const Duration(milliseconds: 110),
        child: AppCard(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('WHAT YOU\'RE PAYING', style: AppTextStyles.eyebrow),
              const SizedBox(height: AppSpacing.md),
              Text(
                widget.summary,
                style: AppTextStyles.sans(size: 14, weight: FontWeight.w700),
              ),
              if (widget.priceLine != null) ...[
                const SizedBox(height: 4),
                Text(widget.priceLine!, style: AppTextStyles.bodySmall),
              ],
              const SizedBox(height: AppSpacing.md),
              const Divider(height: 1, color: AppColors.hairline),
              const SizedBox(height: AppSpacing.md),
              _AmountRow(label: 'Order total', amount: peso(widget.total)),
              const SizedBox(height: 6),
              _AmountRow(
                label: 'Downpayment (50%)',
                amount: peso(widget.due),
                strong: true,
              ),
              const SizedBox(height: 6),
              _AmountRow(
                label: 'Balance on the day',
                amount: peso(widget.total - widget.due),
                muted: true,
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: AppSpacing.md),

      // ── What happens next, and what doesn't ─────────────────────────────
      FadeSlideIn(
        delay: const Duration(milliseconds: 150),
        child: AppCard(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('HOW IT WORKS', style: AppTextStyles.eyebrow),
              const SizedBox(height: AppSpacing.md),
              const _NoteLine(
                icon: Icons.account_balance_wallet_outlined,
                text: 'Pay with GCash, Maya, GrabPay or a card on PayMongo\'s '
                    'own secure page. We never see your card details.',
              ),
              const _NoteLine(
                icon: Icons.event_available_outlined,
                text: 'Once the downpayment lands, your order goes to the team '
                    'to confirm — they\'ll call your contact number.',
              ),
              const _NoteLine(
                icon: Icons.bookmark_outline_rounded,
                text: 'Not ready? Your booking is already saved. Pick the '
                    'payment back up any time from Order Tracking.',
              ),
              _NoteLine(
                icon: Icons.receipt_long_outlined,
                text: 'Quote reference No. ${widget.reference} if you need to '
                    'talk to us about this payment.',
                last: true,
              ),
            ],
          ),
        ),
      ),

      if (!PayMongoConfig.isLive) ...[
        const SizedBox(height: AppSpacing.md),
        FadeSlideIn(
          delay: const Duration(milliseconds: 180),
          child: const _Banner(
            icon: Icons.science_outlined,
            title: 'Test mode',
            message: 'This app is on PayMongo\'s test keys, so no real money '
                'moves. Use PayMongo\'s test card 4343 4343 4343 4345 with '
                'any future expiry and any CVC.',
          ),
        ),
      ],

    ];
  }

  /// The one line of feedback the screen owes the member — an error, or a check
  /// that came back with nothing settled yet.
  ///
  /// Always occupies its slot in the list (empty when there's nothing to say) so
  /// the sections under it keep their place, and don't replay their entrance
  /// animation, as a notice comes and goes. The two states are exclusive: a
  /// check clears both before setting either.
  Widget _notice() {
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.only(top: AppSpacing.lg),
        child: FadeSlideIn(
          child: _Banner(
            icon: Icons.error_outline_rounded,
            title: 'That didn\'t go through',
            message: _error!,
            danger: true,
          ),
        ),
      );
    }
    if (_checkedAndUnpaid) {
      return const Padding(
        padding: EdgeInsets.only(top: AppSpacing.lg),
        child: FadeSlideIn(
          child: _Banner(
            icon: Icons.hourglass_top_rounded,
            title: 'Nothing has landed yet',
            message: 'PayMongo hasn\'t recorded a payment on this order. If '
                'you\'ve just paid, give it a few seconds and check again — '
                'e-wallets sometimes take a moment to settle.',
          ),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  // ── The settled face ──────────────────────────────────────────────────────
  List<Widget> _doneFace() {
    return [
      const SizedBox(height: AppSpacing.xxl),
      Center(
        child: Container(
          width: 88,
          height: 88,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.brown, AppColors.espresso],
            ),
            border: Border.all(color: AppColors.gold, width: 1.6),
            boxShadow: [
              BoxShadow(
                color: AppColors.gold.withValues(alpha: 0.3),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: const Icon(Icons.check, size: 38, color: AppColors.gold),
        ),
      ),
      const SizedBox(height: AppSpacing.xl),
      Center(child: Text('MARAMING SALAMAT', style: AppTextStyles.eyebrow)),
      const SizedBox(height: AppSpacing.sm),
      Center(
        child: Text(
          'Your date is held.',
          textAlign: TextAlign.center,
          style: AppTextStyles.displaySmall,
        ),
      ),
      const SizedBox(height: AppSpacing.md),
      Text(
        'We\'ve received your ${peso(_paidAmount)} downpayment'
        '${_paidMethod == null ? '' : ' via ${_methodLabel(_paidMethod!)}'}. '
        'Your order is with the team now — they\'ll call your contact number '
        'to confirm the details, and the balance of '
        '${peso(widget.total - _paidAmount)} is settled on the day.',
        textAlign: TextAlign.center,
        style: AppTextStyles.body,
      ),
      const SizedBox(height: AppSpacing.xl),
      AppCard(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('YOUR RECEIPT', style: AppTextStyles.eyebrow),
            const SizedBox(height: AppSpacing.md),
            _AmountRow(label: 'Order no.', amount: widget.reference),
            const SizedBox(height: 6),
            _AmountRow(label: 'Order total', amount: peso(widget.total)),
            const SizedBox(height: 6),
            _AmountRow(
              label: 'Paid now',
              amount: peso(_paidAmount),
              strong: true,
            ),
            const SizedBox(height: 6),
            _AmountRow(
              label: 'Balance',
              amount: peso(widget.total - _paidAmount),
              muted: true,
            ),
          ],
        ),
      ),
    ];
  }
}

/// A label on the left, an amount on the right — the ledger rows on this screen.
class _AmountRow extends StatelessWidget {
  const _AmountRow({
    required this.label,
    required this.amount,
    this.strong = false,
    this.muted = false,
  });

  final String label;
  final String amount;

  /// The line that matters — the downpayment itself.
  final bool strong;

  /// A line that's context rather than the ask.
  final bool muted;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: AppTextStyles.sans(
              size: strong ? 13 : 12,
              weight: strong ? FontWeight.w600 : FontWeight.w400,
              color: muted ? AppColors.brownSoft : AppColors.brown,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Text(
          amount,
          style: AppTextStyles.sans(
            size: strong ? 17 : 13,
            weight: FontWeight.w700,
            color: strong
                ? AppColors.goldDeep
                : muted
                    ? AppColors.brownSoft
                    : AppColors.brown,
          ),
        ),
      ],
    );
  }
}

/// One quiet icon + sentence in the "How it works" card.
class _NoteLine extends StatelessWidget {
  const _NoteLine({
    required this.icon,
    required this.text,
    this.last = false,
  });

  final IconData icon;
  final String text;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: last ? 0 : AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.brownSoft),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.sans(size: 12, color: AppColors.brownSoft),
            ),
          ),
        ],
      ),
    );
  }
}

/// A tinted notice — the test-mode note, a "nothing yet" reassurance, or an
/// error. Same shape for all three so the screen never changes height jarringly
/// as one replaces another.
class _Banner extends StatelessWidget {
  const _Banner({
    required this.icon,
    required this.title,
    required this.message,
    this.danger = false,
  });

  final IconData icon;
  final String title;
  final String message;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final tint =
        danger ? Theme.of(context).colorScheme.error : AppColors.goldDeep;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: tint.withValues(alpha: 0.06),
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: tint.withValues(alpha: 0.28)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: tint),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                ),
                const SizedBox(height: 2),
                Text(message, style: AppTextStyles.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// PayMongo's method codes as the member knows them.
String _methodLabel(String code) => switch (code.toLowerCase()) {
      'gcash' => 'GCash',
      'paymaya' || 'maya' => 'Maya',
      'grab_pay' => 'GrabPay',
      'card' => 'card',
      'billease' => 'BillEase',
      'dob' || 'dob_ubp' => 'online banking',
      _ => code,
    };

