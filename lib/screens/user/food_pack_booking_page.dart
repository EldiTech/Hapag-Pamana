import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../brand.dart';
import '../../core/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/booking.dart';
import '../../data/booking_repository.dart';
import '../../data/catering.dart';
import '../../data/customer_repository.dart';
import '../../data/paymongo_config.dart';
import '../../data/places_service.dart';
import '../../data/product.dart';
import '../../data/product_repository.dart';
import '../../widgets.dart';
import 'address_picker_page.dart';
import 'payment_page.dart';

/// "Book Us Now" for food packs — a short wizard shaped after the business's
/// food pack *quotation* rather than the catering booking form.
///
/// Where the catering wizard walks eight pages of event logistics and
/// one-dish-per-course blanks, a food pack order is a delivery: who it's for,
/// when and where it's going, and a menu list in which each dish carries its
/// own pax count — exactly the quotation's MENU section
/// ("Fish Fillet with aioli sauce (5 pax)").
///
///   1. The Occasion  — occasion, date, venue, pax
///   2. The Client    — name, email, contact number
///   3. The Menu      — dishes from the Food Packs menu, a pax count on each
///   4. The Quotation — a recap of the paperwork, plus the delivery time
///
/// Every blank is required and held to a format before the wizard will advance
/// (see [_checkField]) — only the kitchen notes are genuinely optional. What can
/// be picked is never typed: the date, the delivery time and every dish come
/// from pickers.
///
/// Submitting files a `pending` document in `bookings` via
/// [BookingRepository] with `bookingType: 'Food Pack'` and the menu joined
/// into quotation-style lines, then hands the member to [PaymentPage] for the
/// 50% downpayment that holds the slot, and settles into a thank-you state.
///
/// The order is filed *before* the payment, so an abandoned payment leaves a
/// resumable order (`paymentStatus: 'awaiting'`) rather than losing the form —
/// see [_submit].
class FoodPackBookingPage extends StatefulWidget {
  const FoodPackBookingPage({super.key, this.package});

  /// When launched from a food pack package's detail sheet, that package
  /// prefills the package field and its minimum order count.
  final CateringPackage? package;

  @override
  State<FoodPackBookingPage> createState() => _FoodPackBookingPageState();
}

class _FoodPackBookingPageState extends State<FoodPackBookingPage> {
  /// Step eyebrow + serif title + quiet helper line.
  static const List<(String, String, String)> _steps = [
    (
      'THE OCCASION',
      'When and where do we deliver?',
      'The date, the drop-off point, and how many we\'re feeding.',
    ),
    (
      'THE CLIENT',
      'How do we reach you?',
      'Your quotation goes to this email; we confirm on this number.',
    ),
    (
      'THE MENU',
      'Build your menu',
      'Pick dishes from our Food Packs menu and set how many pax each '
          'one should serve.',
    ),
    (
      'THE QUOTATION',
      'One last look',
      'This is what we\'ll prepare your quotation from. Tell us when to '
          'deliver; the notes are yours to skip.',
    ),
  ];

  /// Every field checked when leaving a step, in the order it appears on the
  /// page. All of them are required — the kitchen notes are the one blank that
  /// isn't, so they're not listed. (The Menu step has its own at-least-one-dish
  /// check in [_next].)
  static const Map<int, List<String>> _validatedByStep = {
    0: ['kindOfFunction', 'functionDate', 'venue', 'pax'],
    1: ['clientName', 'email', 'contactNumber'],
    3: ['deliveryTime'],
  };

  /// "Contains at least one actual letter" — keeps `...` and `12345` from
  /// passing for a venue or an occasion.
  static final RegExp _letter = RegExp('[A-Za-z]');

  /// Personal names: letters (incl. Ñ), spaces, and the punctuation real names
  /// carry — no digits, no symbols.
  static final RegExp _nameChars = RegExp(r"^[A-Za-zÑñ .'-]+$");

  /// Philippine mobile numbers, once spacing and punctuation are stripped:
  /// 09171234567 or 639171234567 (the +63 form loses its plus first).
  static final RegExp _mobile = RegExp(r'^(09\d{9}|639\d{9})$');

  /// The quotation is emailed, so the address has to be a real shape — one @,
  /// a dotted domain, no spaces.
  static final RegExp _email = RegExp(r'^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$');

  int _step = 0;
  bool _submitting = false;
  bool _submitted = false;

  /// The filed order, once REQUEST QUOTATION has gone through — what the
  /// downpayment is taken against, and what the thank-you state reports on.
  String? _bookingId;

  /// True when this order carries a downpayment to collect (see [_orderTotal]);
  /// false for one with no package price behind it, which the team quotes.
  bool _gated = false;

  /// True once the downpayment has cleared.
  bool _paid = false;

  /// The PayMongo checkout page opened for this order, so a second run at the
  /// payment reuses it instead of opening another.
  String? _sessionId;
  String? _checkoutUrl;

  final Map<String, TextEditingController> _fields = {};
  final Map<String, String> _errors = {};

  /// The live menu, so the dish picker offers the actual food packs the
  /// moderator has published.
  StreamSubscription<List<Product>>? _productSub;
  List<Product> _products = const [];

  /// The menu being built — each line a dish plus the pax it should serve,
  /// in the order the member added them (exactly the quotation's MENU list).
  final List<_MenuLine> _menu = [];

  TextEditingController _ctrl(String key) =>
      _fields.putIfAbsent(key, () => TextEditingController());

  @override
  void initState() {
    super.initState();
    // Prefill everything we already know. From the member's account: their
    // name and email (and, once the profile loads, their phone number). From
    // the booked package: its name/price and its minimum orders as the
    // starting pax.
    final name = (CustomerRepository().displayName ?? '').trim();
    if (name.isNotEmpty) _ctrl('clientName').text = name;
    final email = (CustomerRepository().email ?? '').trim();
    if (email.isNotEmpty) _ctrl('email').text = email;
    final pkg = widget.package;
    if (pkg != null) {
      _ctrl('package').text = pkg.price > 0
          ? '${pkg.name} — ${peso(pkg.price)} per pack'
          : pkg.name;
      if (pkg.minPax > 0) _ctrl('pax').text = '${pkg.minPax}';
    }
    // The phone number lives on the Firestore profile, so it arrives async —
    // fill only fields the member hasn't typed into meanwhile.
    CustomerRepository().fetchCurrentCustomer().then((customer) {
      if (!mounted || customer == null) return;
      setState(() {
        _fillIfEmpty('clientName', customer.name);
        _fillIfEmpty('email', customer.email);
        _fillIfEmpty('contactNumber', customer.phone);
      });
    }).catchError((_) {
      // Offline / rules hiccup — the member just types it in themselves.
    });
    // The live menu feeds the dish picker (shared app-wide listener, so this
    // doesn't re-download anything the Menu tab already has).
    _productSub = ProductRepository().watchVisible().listen(
      (data) {
        if (mounted) setState(() => _products = data);
      },
      onError: (_) {}, // the menu step quietly falls back to a free-text field
    );
  }

  /// Sets [key]'s field to [value] unless the member has already typed there.
  void _fillIfEmpty(String key, String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return;
    final ctrl = _ctrl(key);
    if (ctrl.text.trim().isEmpty) {
      ctrl.text = trimmed;
      _errors.remove(key);
    }
  }

  @override
  void dispose() {
    _productSub?.cancel();
    for (final c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// The dishes the picker offers: the Food Packs family of the live menu,
  /// falling back to the whole menu so the picker is never needlessly empty.
  List<Product> get _dishes {
    final packs = _products.where((p) => p.type == 'Food Packs').toList();
    return packs.isNotEmpty ? packs : _products;
  }

  /// Total pax across every menu line — the quotation's implied headcount.
  int get _menuPax => _menu.fold(0, (sum, l) => sum + l.pax);

  /// The quotation's MENU lines: the structured menu when one was built, or
  /// the free-text fallback split into lines.
  List<String> get _menuLines {
    if (_menu.isNotEmpty) {
      return [for (final l in _menu) '${l.dish.name} (${l.pax} pax)'];
    }
    return _ctrl('menu')
        .text
        .split('\n')
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty)
        .toList();
  }

  // ── Pickers ───────────────────────────────────────────────────────────────
  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 7)),
      firstDate: now,
      lastDate: DateTime(now.year + 2, now.month, now.day),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _ctrl('functionDate').text = _formatDate(picked);
      _errors.remove('functionDate');
    });
  }

  Future<void> _pickTime(String key) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (picked == null || !mounted) return;
    setState(() => _ctrl(key).text = picked.format(context));
  }

  /// The venue popup: a full-screen Google Places search plus a draggable
  /// pin, so the field is filled with a real, mappable address rather than
  /// however the member happens to type it. Reopening it hands back whatever
  /// is already on the field, so a member fine-tuning the pin doesn't start
  /// over from a blank search.
  Future<void> _pickVenue() async {
    final current = _ctrl('venue').text.trim();
    final resolved = await Navigator.of(context).push<ResolvedAddress>(
      BrandPageRoute<ResolvedAddress>(
        builder: (_) => AddressPickerPage(
          initialAddress: current.isEmpty ? null : current,
          title: 'Choose your venue',
          searchHint: 'Search for the venue',
          fieldLabel: 'VENUE / DELIVERY ADDRESS',
          confirmLabel: 'USE THIS VENUE',
        ),
      ),
    );
    if (resolved == null || !mounted) return;
    setState(() {
      _ctrl('venue').text = resolved.address;
      _errors.remove('venue');
    });
  }

  // ── Validation ────────────────────────────────────────────────────────────
  /// Every complaint against [step] — presence first, then format — keyed by
  /// field. Empty means the step is clean.
  Map<String, String> _stepErrors(int step) {
    final found = <String, String>{};
    for (final key in _validatedByStep[step] ?? const <String>[]) {
      final error = _checkField(key);
      if (error != null) found[key] = error;
    }
    // The Menu step is a list, not a blank: it needs at least one dish (or,
    // where nothing is published and it fell back to free text, a line of it).
    if (step == 2 && _menu.isEmpty && _ctrl('menu').text.trim().isEmpty) {
      found['menu'] = 'Add at least one dish to your menu';
    }
    return found;
  }

  /// Marks [step]'s fields with [found] and clears the ones that now pass.
  void _paintErrors(int step, Map<String, String> found) {
    setState(() {
      for (final key in _validatedByStep[step] ?? const <String>[]) {
        _errors.remove(key);
      }
      if (step == 2) _errors.remove('menu');
      _errors.addAll(found);
    });
  }

  /// The message for [key]'s current value, or null when it passes. Nothing is
  /// optional here, so an empty blank always complains.
  String? _checkField(String key) {
    final value = _ctrl(key).text.trim();
    if (value.isEmpty) {
      // A blank that's tapped, not typed, asks to be picked.
      if (key == 'functionDate') return 'Please pick a date.';
      if (key == 'deliveryTime') return 'Please pick a time.';
      if (key == 'venue') return 'Please choose your venue on the map.';
      return 'Please fill this in';
    }
    // Anything a picker wrote is already well-formed, and its shape isn't ours
    // to second-guess.
    if (key == 'functionDate' || key == 'deliveryTime' || key == 'venue') {
      return null;
    }
    switch (key) {
      case 'kindOfFunction':
        return _checkWords(value, min: 3, max: 60);
      case 'clientName':
        if (value.length < 2) return 'Please enter your full name.';
        if (value.length > 60) return 'Please keep this under 60 characters.';
        if (!_nameChars.hasMatch(value)) {
          return 'Letters, spaces, hyphens and apostrophes only.';
        }
        return null;
      case 'email':
        if (!_email.hasMatch(value)) return 'Enter a valid email address.';
        return null;
      case 'contactNumber':
        return _checkMobile(value);
      case 'pax':
        return _checkPax(value);
      default:
        return _checkWords(value, min: 2, max: 120);
    }
  }

  /// Length bounds plus "has actual words", shared by the free-text blanks.
  String? _checkWords(String value, {required int min, required int max}) {
    if (value.length < min) return 'Please write at least $min characters.';
    if (value.length > max) return 'Please keep this under $max characters.';
    if (!_letter.hasMatch(value)) {
      return 'Please use words, not just numbers or symbols.';
    }
    return null;
  }

  /// Headcount: whole numbers only, at least one, no more than the kitchen can
  /// take in one order — and never under the booked package's minimum.
  String? _checkPax(String value) {
    final pax = int.tryParse(value);
    if (pax == null) return 'Numbers only — e.g. 50';
    if (pax < 1) return 'How many people are we feeding?';
    final minPax = widget.package?.minPax ?? 0;
    if (minPax > 0 && pax < minPax) {
      return 'This package starts at $minPax pax.';
    }
    if (pax > 5000) {
      return 'For more than 5,000 pax, please message us directly.';
    }
    return null;
  }

  /// Accepts a PH mobile however the member spaces it — 0917 123 4567,
  /// +63 917 123 4567, (0917) 123-4567 — and nothing else.
  String? _checkMobile(String value) {
    final compact = value.replaceAll(RegExp(r'[\s()\-.]'), '');
    final digits = compact.startsWith('+') ? compact.substring(1) : compact;
    if (!_mobile.hasMatch(digits)) {
      return 'Enter an 11-digit mobile number, e.g. 0917 123 4567';
    }
    return null;
  }

  // ── Flow ──────────────────────────────────────────────────────────────────
  void _next() {
    final found = _stepErrors(_step);
    _paintErrors(_step, found);
    if (found.isNotEmpty) return;
    if (_step < _steps.length - 1) {
      setState(() => _step++);
      return;
    }
    // Last page: re-check every step before filing, so a blank the member
    // walked back through can't slip out. The wizard returns to the first step
    // that complains.
    for (var step = 0; step < _steps.length; step++) {
      final problems = _stepErrors(step);
      _paintErrors(step, problems);
      if (problems.isNotEmpty) {
        setState(() => _step = step);
        return;
      }
    }
    _submit();
  }

  void _back() {
    if (_step > 0) setState(() => _step--);
  }

  // ── The downpayment ───────────────────────────────────────────────────────
  /// The order's full amount — the booked package's per-pack price times the
  /// number of packs ordered.
  ///
  /// Null when the wizard wasn't opened from a package (the Packages tab's plain
  /// "Food Packs" row starts an order with no package behind it) or when that
  /// package carries no price. Those file for the team to quote rather than
  /// having a figure invented for them — see [_submit].
  num? get _orderTotal {
    final price = widget.package?.price ?? 0;
    final packs = int.tryParse(_ctrl('pax').text.trim()) ?? 0;
    if (price <= 0 || packs <= 0) return null;
    return price * packs;
  }

  /// The total's arithmetic, spelled out for the payment screen — "₱180 per pack
  /// × 50 packs" — so the member can check the figure rather than trust it.
  String? get _priceLine {
    final price = widget.package?.price ?? 0;
    final packs = int.tryParse(_ctrl('pax').text.trim()) ?? 0;
    if (price <= 0 || packs <= 0) return null;
    return '${peso(price)} per pack × $packs pack${packs == 1 ? '' : 's'}';
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);

    // Worked out before the write so the terms travel *with* the order: what the
    // team is owed is then the order's own record, not something recomputed
    // later from a package whose price may since have changed.
    final total = _orderTotal;
    final num due = total != null && PayMongoConfig.isChargeable(total)
        ? PayMongoConfig.downpaymentOn(total)
        : 0;
    final gated = due > 0;

    // Only the write is guarded — once the order is filed, "couldn't send" would
    // be wrong, and the payment that follows reports its own trouble.
    final String id;
    try {
      id = await BookingRepository().submit(
        {
          for (final e in _fields.entries) e.key: e.value.text,
          // A structured menu overrides the free-text fallback under the same
          // key, so the moderator always reads one `menu` field of
          // quotation-style lines.
          if (_menu.isNotEmpty) 'menu': _menuLines.join('\n'),
          'bookingType': 'Food Pack',
        },
        payment: {
          'paymentStatus': gated ? 'awaiting' : 'quote_needed',
          'paymentTotal': ?total,
          if (gated) 'paymentDue': due,
        },
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Couldn\'t send your order — please try again.'),
        ),
      );
      return;
    }

    if (!mounted) return;
    setState(() {
      _submitting = false;
      _bookingId = id;
      _gated = gated;
    });
    if (gated) await _collect(total: total!, due: due);
    if (!mounted) return;
    setState(() => _submitted = true);
  }

  /// Opens the downpayment screen for the order just filed, and records whether
  /// it settled. Backing out isn't a failure — the order is filed and the
  /// payment resumable — so this only ever sets [_paid].
  Future<void> _collect({required num total, required num due}) async {
    final id = _bookingId;
    if (id == null) return;
    final menu = _menuLines;
    final paid = await Navigator.of(context).push<bool>(
      BrandPageRoute<bool>(
        builder: (_) => PaymentPage(
          bookingId: id,
          reference: Booking.referenceFor(id),
          total: total,
          due: due,
          orderKind: 'Food Pack',
          summary: menu.isEmpty ? 'Food pack order' : menu.first,
          priceLine: _priceLine,
          // Remembered so reopening this from the thank-you state hands back the
          // page already paid against, rather than opening a second one.
          existingSessionId: _sessionId,
          existingCheckoutUrl: _checkoutUrl,
          onCheckoutOpened: (sessionId, url) {
            _sessionId = sessionId;
            _checkoutUrl = url;
          },
          clientName: _ctrl('clientName').text.trim(),
          phone: _ctrl('contactNumber').text.trim(),
          email: _ctrl('email').text.trim(),
        ),
      ),
    );
    if (!mounted) return;
    setState(() => _paid = paid == true);
  }

  // ── Build ─────────────────────────────────────────────────────────────────
  @override
  Widget build(BuildContext context) {
    return PopScope(
      // System back retreats one step first; only step 1 (or the thank-you
      // state) actually leaves the wizard.
      canPop: _step == 0 || _submitted,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
          title: Text('Book Food Packs', style: AppTextStyles.heading),
        ),
        body: Stack(
          children: [
            const ParchmentBackground(weave: true),
            SafeArea(
              top: false,
              child: _submitted ? _buildThanks() : _buildWizard(),
            ),
          ],
        ),
        bottomNavigationBar: _submitted
            ? null
            : SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.screen,
                    AppSpacing.md,
                    AppSpacing.screen,
                    AppSpacing.lg,
                  ),
                  child: Row(
                    children: [
                      if (_step > 0) ...[
                        Expanded(
                          child: AppButton.secondary(
                            label: 'BACK',
                            onPressed: _submitting ? null : _back,
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                      ],
                      Expanded(
                        flex: 2,
                        child: AppButton.primary(
                          label: _step == _steps.length - 1
                              ? 'REQUEST QUOTATION'
                              : 'NEXT',
                          icon: _step == _steps.length - 1
                              ? Icons.request_quote_outlined
                              : Icons.arrow_forward_rounded,
                          busy: _submitting,
                          fullWidth: true,
                          onPressed: _next,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
      ),
    );
  }

  Widget _buildWizard() {
    final (eyebrow, title, helper) = _steps[_step];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // ── Step header + progress ──────────────────────────────────────
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.lg,
            AppSpacing.screen,
            0,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('STEP ${_step + 1} OF ${_steps.length} · $eyebrow',
                  style: AppTextStyles.eyebrow),
              const SizedBox(height: AppSpacing.sm),
              Text(title, style: AppTextStyles.title),
              const SizedBox(height: AppSpacing.xs),
              Text(helper, style: AppTextStyles.bodySmall),
              const SizedBox(height: AppSpacing.lg),
              _ProgressRule(progress: (_step + 1) / _steps.length),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        // ── The step's form ─────────────────────────────────────────────
        Expanded(
          child: AnimatedSwitcher(
            duration: Motion.base,
            switchInCurve: Motion.standard,
            switchOutCurve: Motion.exit,
            transitionBuilder: (child, animation) => FadeTransition(
              opacity: animation,
              child: SlideTransition(
                position: Tween<Offset>(
                  begin: const Offset(0, 0.02),
                  end: Offset.zero,
                ).animate(animation),
                child: child,
              ),
            ),
            child: ListView(
              key: ValueKey<int>(_step),
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screen,
                AppSpacing.md,
                AppSpacing.screen,
                AppSpacing.section,
              ),
              children: _stepFields(_step),
            ),
          ),
        ),
      ],
    );
  }

  // ── Step forms — at most four questions per page ──────────────────────────
  List<Widget> _stepFields(int step) => switch (step) {
        0 => [
            _field(
              'kindOfFunction',
              'Occasion',
              hint: 'Office lunch, fiesta, team outing…',
              icon: Icons.celebration_outlined,
              inputFormatters: [LengthLimitingTextInputFormatter(60)],
            ),
            _pickerField(
              'functionDate',
              'Date of Event',
              hint: 'Pick a date',
              icon: Icons.event_outlined,
              onTap: _pickDate,
            ),
            _pickerField(
              'venue',
              'Venue / Delivery Address',
              hint: 'Search or drop a pin on the map',
              icon: Icons.place_outlined,
              onTap: _pickVenue,
            ),
            _field(
              'pax',
              'No. of Pax',
              hint: 'e.g. 50',
              icon: Icons.groups_outlined,
              keyboardType: TextInputType.number,
              // A headcount is a whole number — the field refuses anything else.
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(4),
              ],
            ),
          ],
        1 => [
            _field(
              'clientName',
              'Client\'s Name',
              icon: Icons.person_outline,
              // Names carry no digits, so the field won't take them.
              inputFormatters: [
                FilteringTextInputFormatter.deny(RegExp(r'\d')),
                LengthLimitingTextInputFormatter(60),
              ],
            ),
            _field(
              'email',
              'Email Address',
              hint: 'Where we send your quotation',
              icon: Icons.alternate_email_outlined,
              keyboardType: TextInputType.emailAddress,
              // An address carries no spaces; the shape is checked on NEXT.
              inputFormatters: [
                FilteringTextInputFormatter.deny(RegExp(r'\s')),
                LengthLimitingTextInputFormatter(120),
              ],
            ),
            _field(
              'contactNumber',
              'Contact Number',
              hint: '09xx xxx xxxx',
              icon: Icons.phone_outlined,
              keyboardType: TextInputType.phone,
              // Digits and the punctuation people space numbers with, nothing
              // else; the format itself is checked on NEXT.
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[\d +()\-]')),
                LengthLimitingTextInputFormatter(20),
              ],
            ),
          ],
        2 => _menuStep(),
        _ => [
            _QuotationRecap(
              rows: [
                ('For', _ctrl('clientName').text),
                ('Email Address', _ctrl('email').text),
                ('Date of Event', _ctrl('functionDate').text),
                ('Venue', _ctrl('venue').text),
                ('No. of Pax', _ctrl('pax').text),
                if (_ctrl('package').text.trim().isNotEmpty)
                  ('Package', _ctrl('package').text),
              ],
              menuLines: _menuLines,
            ),
            const SizedBox(height: AppSpacing.xl),
            _timeField('deliveryTime', 'Time of Delivery'),
            // The one blank on this wizard that may be left empty.
            _field(
              'notes',
              'Notes for the Kitchen',
              hint: 'Allergies, gate instructions, anything else… (optional)',
              icon: Icons.edit_note_outlined,
              maxLines: 3,
              inputFormatters: [LengthLimitingTextInputFormatter(400)],
            ),
          ],
      };

  // ── The Menu step — the part no catering page has ─────────────────────────
  /// The menu builder: each chosen dish as a line with its own pax stepper,
  /// then the button into the dish picker. When the moderator has published
  /// nothing (or the menu is still loading), it falls back to a free-text
  /// blank like the paper form.
  List<Widget> _menuStep() {
    final dishes = _dishes;
    if (dishes.isEmpty) {
      return [
        _field(
          'menu',
          'Your Menu',
          hint: 'One dish per line — e.g.\nFish Fillet with aioli sauce — 5 pax',
          icon: Icons.restaurant_outlined,
          maxLines: 5,
        ),
      ];
    }
    return [
      for (final line in _menu) ...[
        _MenuLineCard(
          line: line,
          onAdd: () => setState(() => line.pax++),
          onRemove: line.pax > 1
              ? () => setState(() => line.pax--)
              : null,
          onDelete: () => setState(() => _menu.remove(line)),
        ),
        const SizedBox(height: AppSpacing.sm),
      ],
      if (_menu.isNotEmpty) ...[
        Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Text(
            '$_menuPax pax across ${_menu.length} '
            'dish${_menu.length == 1 ? '' : 'es'}.',
            style: AppTextStyles.bodySmall,
          ),
        ),
      ],
      AppButton.secondary(
        label: _menu.isEmpty ? 'ADD DISHES' : 'ADD MORE DISHES',
        icon: Icons.add_rounded,
        fullWidth: true,
        onPressed: _pickDishes,
      ),
      if (_errors['menu'] != null) ...[
        const SizedBox(height: AppSpacing.sm),
        Text(
          _errors['menu']!,
          style: AppTextStyles.sans(
            size: 11,
            color: Theme.of(context).colorScheme.error,
          ),
        ),
      ],
    ];
  }

  /// Every published food pack dish, grouped by category, in the app's
  /// centered quick-look dialog — tap dishes to add or remove them, then
  /// DONE returns to the pax steppers.
  Future<void> _pickDishes() {
    final dishes = _dishes;
    // Group by category, preserving the menu's order; uncategorised dishes
    // gather at the end.
    final byCategory = <String, List<Product>>{};
    for (final d in dishes) {
      final cat = d.category.trim().isEmpty ? 'More dishes' : d.category.trim();
      byCategory.putIfAbsent(cat, () => []).add(d);
    }
    return showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          bool isChosen(Product d) => _menu.any((l) => l.dish.id == d.id);
          void toggle(Product d) {
            // Update both the page (the steppers behind the dialog) and the
            // dialog's own check marks.
            setState(() {
              final i = _menu.indexWhere((l) => l.dish.id == d.id);
              if (i >= 0) {
                _menu.removeAt(i);
              } else {
                _menu.add(_MenuLine(d));
                _errors.remove('menu');
              }
            });
            setDialogState(() {});
          }

          return AppDialogShell(
            footer: AppButton.primary(
              label: _menu.isEmpty
                  ? 'DONE'
                  : 'DONE · ${_menu.length} '
                      'DISH${_menu.length == 1 ? '' : 'ES'}',
              fullWidth: true,
              onPressed: () => Navigator.of(dialogContext).pop(),
            ),
            children: [
              Text('THE MENU · FOOD PACKS', style: AppTextStyles.eyebrow),
              const SizedBox(height: AppSpacing.sm),
              Text('Choose your dishes', style: AppTextStyles.title),
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Tap to add or remove — you\'ll set each dish\'s pax after.',
                style: AppTextStyles.bodySmall,
              ),
              for (final entry in byCategory.entries) ...[
                const SizedBox(height: AppSpacing.lg),
                Text(entry.key.toUpperCase(), style: AppTextStyles.eyebrow),
                const SizedBox(height: AppSpacing.sm),
                for (final dish in entry.value) ...[
                  _DishToggleRow(
                    dish: dish,
                    selected: isChosen(dish),
                    onTap: () => toggle(dish),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
              ],
            ],
          );
        },
      ),
    );
  }

  // ── Field builders ────────────────────────────────────────────────────────
  Widget _field(
    String key,
    String label, {
    String? hint,
    IconData? icon,
    TextInputType? keyboardType,
    int maxLines = 1,
    List<TextInputFormatter>? inputFormatters,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: AppTextField(
        label: label,
        hint: hint,
        controller: _ctrl(key),
        prefixIcon: icon,
        keyboardType: keyboardType,
        maxLines: maxLines,
        inputFormatters: inputFormatters,
        errorText: _errors[key],
        onChanged: (_) {
          if (_errors.containsKey(key)) setState(() => _errors.remove(key));
        },
      ),
    );
  }

  /// Read-only field whose value comes from a picker (date / time).
  Widget _pickerField(
    String key,
    String label, {
    String? hint,
    IconData? icon,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: AppTextField(
        label: label,
        hint: hint,
        controller: _ctrl(key),
        prefixIcon: icon,
        readOnly: true,
        onTap: onTap,
        errorText: _errors[key],
        suffixIcon: const Icon(Icons.expand_more, size: 20),
      ),
    );
  }

  /// A tap-to-pick time field.
  Widget _timeField(String key, String label) => _pickerField(
        key,
        label,
        hint: 'Pick time',
        icon: Icons.schedule_outlined,
        onTap: () => _pickTime(key),
      );

  // ── Thank-you state ───────────────────────────────────────────────────────
  /// The thank-you state, reading back the outcome the order actually reached:
  /// settled, waiting on its downpayment, or filed for the team to quote. An
  /// order still owing its downpayment says so and keeps the payment one tap
  /// away — it's the one case with something left for the member to do.
  Widget _buildThanks() {
    final owing = _gated && !_paid;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.xxxl),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
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
              child: Icon(
                owing ? Icons.bookmark_outline_rounded : Icons.check,
                size: 38,
                color: AppColors.gold,
              ),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text(
              owing ? 'SAVED FOR YOU' : 'MARAMING SALAMAT',
              style: AppTextStyles.eyebrow,
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              owing
                  ? 'Your order is waiting.'
                  : _paid
                      ? 'Your slot is held.'
                      : 'Your food pack order is in.',
              textAlign: TextAlign.center,
              style: AppTextStyles.displaySmall,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              owing
                  ? 'Everything you filled in is filed under No. '
                      '${Booking.referenceFor(_bookingId ?? '')}. We hold the '
                      'delivery once the downpayment lands — finish it below, '
                      'or any time from Order Tracking in Settings.'
                  : _paid
                      ? 'Your downpayment is in. We\'ll send the full quotation '
                          'to your email address and confirm the delivery on '
                          'your contact number.'
                      : 'We\'ll prepare your quotation, send it to your email '
                          'address, and confirm the delivery on your contact '
                          'number.',
              textAlign: TextAlign.center,
              style: AppTextStyles.body,
            ),
            const SizedBox(height: AppSpacing.xxl),
            if (owing) ...[
              AppButton.primary(
                label: 'PAY THE DOWNPAYMENT',
                icon: Icons.lock_outline_rounded,
                fullWidth: true,
                onPressed: () {
                  final total = _orderTotal;
                  if (total == null) return;
                  _collect(
                    total: total,
                    due: PayMongoConfig.downpaymentOn(total),
                  );
                },
              ),
              const SizedBox(height: AppSpacing.sm),
              AppButton.secondary(
                label: 'LATER',
                fullWidth: true,
                onPressed: () => Navigator.of(context).pop(),
              ),
            ] else
              AppButton.primary(
                label: 'DONE',
                fullWidth: true,
                onPressed: () => Navigator.of(context).pop(),
              ),
          ],
        ),
      ),
    );
  }
}

/// One line of the menu being built — a food pack dish plus the pax it
/// should serve (the quotation's "(5 pax)" figure), mutable via the stepper.
class _MenuLine {
  _MenuLine(this.dish);

  final Product dish;

  /// Starts at the quotation's customary five and steps by one.
  int pax = 5;
}

/// A chosen dish on the Menu step: photo, name, a −/+ pax stepper, and a
/// quiet remove control — one row per line of the eventual quotation.
class _MenuLineCard extends StatelessWidget {
  const _MenuLineCard({
    required this.line,
    required this.onAdd,
    required this.onRemove,
    required this.onDelete,
  });

  final _MenuLine line;
  final VoidCallback onAdd;

  /// Null when the line is at its 1-pax floor, which disables the − button.
  final VoidCallback? onRemove;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: AppRadius.xsAll,
            child:
                SizedBox(width: 44, height: 44, child: ProductImage(line.dish)),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  line.dish.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    _StepButton(icon: Icons.remove_rounded, onTap: onRemove),
                    SizedBox(
                      width: 56,
                      child: Text(
                        '${line.pax} pax',
                        textAlign: TextAlign.center,
                        style: AppTextStyles.sans(
                          size: 12,
                          weight: FontWeight.w700,
                        ),
                      ),
                    ),
                    _StepButton(icon: Icons.add_rounded, onTap: onAdd),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          IconButton(
            onPressed: onDelete,
            tooltip: 'Remove dish',
            icon: Icon(
              Icons.close_rounded,
              size: 18,
              color: AppColors.brown.withValues(alpha: 0.45),
            ),
          ),
        ],
      ),
    );
  }
}

/// One tap of the pax stepper — a small circled −/+ that dims when disabled.
class _StepButton extends StatelessWidget {
  const _StepButton({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    return Material(
      color: enabled ? AppColors.cream : AppColors.surface,
      shape: CircleBorder(
        side: BorderSide(
          color: enabled
              ? AppColors.hairline
              : AppColors.hairline.withValues(alpha: 0.5),
        ),
      ),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(6),
          child: Icon(
            icon,
            size: 16,
            color: enabled
                ? AppColors.brown
                : AppColors.brown.withValues(alpha: 0.3),
          ),
        ),
      ),
    );
  }
}

/// One dish inside the dish picker — photo thumbnail, name, and a check that
/// lights gold while the dish is on the menu. Tapping toggles it.
class _DishToggleRow extends StatelessWidget {
  const _DishToggleRow({
    required this.dish,
    required this.selected,
    required this.onTap,
  });

  final Product dish;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.sm),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.gold.withValues(alpha: 0.14)
              : AppColors.surface,
          borderRadius: AppRadius.mdAll,
          border: Border.all(
            color: selected ? AppColors.gold : AppColors.hairline,
          ),
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: AppRadius.xsAll,
              child: SizedBox(width: 44, height: 44, child: ProductImage(dish)),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                dish.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.sans(size: 13, weight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(
              selected
                  ? Icons.check_circle_rounded
                  : Icons.add_circle_outline_rounded,
              size: 20,
              color: selected
                  ? AppColors.goldDeep
                  : AppColors.brown.withValues(alpha: 0.25),
            ),
          ],
        ),
      ),
    );
  }
}

/// The review step's recap card — laid out like the paper quotation the
/// kitchen will send back: the For / Email / Date / Venue / Pax block up
/// top, a rule, then the MENU list with each dish's pax count.
class _QuotationRecap extends StatelessWidget {
  const _QuotationRecap({required this.rows, required this.menuLines});

  /// Label → value pairs for the quotation's header block; blank values
  /// render as a long dash, like an unfilled blank on the paper form.
  final List<(String, String)> rows;
  final List<String> menuLines;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.xl),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('YOUR QUOTATION, IN BRIEF', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.md),
          for (final (label, value) in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 112,
                    child: Text(
                      '$label:',
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w700,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      value.trim().isEmpty ? '—' : value.trim(),
                      style: AppTextStyles.sans(size: 12),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          Container(height: 1, color: AppColors.hairline),
          const SizedBox(height: AppSpacing.md),
          Text('MENU', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          if (menuLines.isEmpty)
            Text('—', style: AppTextStyles.sans(size: 12))
          else
            for (final line in menuLines)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('–  ', style: AppTextStyles.sans(size: 12)),
                    Expanded(
                      child: Text(line, style: AppTextStyles.sans(size: 12)),
                    ),
                  ],
                ),
              ),
        ],
      ),
    );
  }
}

/// Thin gold progress rule under the step header — fills left to right as the
/// wizard advances, like a line being drawn across the page.
class _ProgressRule extends StatelessWidget {
  const _ProgressRule({required this.progress});

  final double progress;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(2),
      child: SizedBox(
        height: 3,
        width: double.infinity,
        child: Stack(
          children: [
            Container(color: AppColors.hairline),
            AnimatedFractionallySizedBox(
              duration: Motion.base,
              curve: Motion.standard,
              alignment: Alignment.centerLeft,
              widthFactor: progress,
              child: Container(color: AppColors.gold),
            ),
          ],
        ),
      ),
    );
  }
}

/// "June 12, 2026" — spelled-out date for the quotation.
String _formatDate(DateTime d) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return '${months[d.month - 1]} ${d.day}, ${d.year}';
}
