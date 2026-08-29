import 'dart:async';
import 'dart:math';

import 'package:firebase_core/firebase_core.dart' show FirebaseException;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../brand.dart';
import '../../core/format.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/booking.dart';
import '../../data/booking_repository.dart';
import '../../data/catering.dart';
import '../../data/catering_repository.dart';
import '../../data/customer_repository.dart';
import '../../data/menu_category.dart';
import '../../data/paymongo_config.dart';
import '../../data/product.dart';
import '../../data/places_service.dart';
import '../../data/product_repository.dart';
import '../../data/promo_discount_service.dart';
import '../../widgets.dart';
import '../detail_sheets.dart';
import 'address_picker_page.dart';
import 'payment_page.dart';

/// "Book Us Now" — a wizard that walks the member through the business's
/// paper booking form in short pages of at most four questions each:
///
///   1. The Occasion — kind of function, date, venue, pax
///   2. The Client   — name, contact number, address
///   3. The Set-up   — ingress / egress times
///   4. The Program  — start, food serving, end of program
///   5+. The Package & menu — the package line, then one question per course
///       the package includes, four to a page, with add-ons on the last.
///   Last. The Look — which of the moderator's published event setups the
///       tables and venue should be dressed in. Only asked when the `setups`
///       gallery has something in it (see [_hasSetupStep]).
///
/// The menu steps are built from the booked package's `inclusions` rather than
/// a fixed course list: a package that includes "Pasta · Pork · Dessert ·
/// Sandwich or Appetizer" asks exactly those four questions, and a line naming
/// alternatives ("Beef or Seafood") offers the dishes of every category it
/// names. See [CateringPackage.courses] and [_coursePages].
///
/// Every question is required (see [_required]); only the add-ons are extra. The
/// five times are checked against each other rather than merely for shape: they
/// have to run in order and inside a believable span (see [_sinceIngress] and
/// [_timeErrors]), so a 6:30 AM ingress with a 5:30 AM egress is refused instead
/// of passing as a 23-hour set-up.
///
/// Nothing here is typed that can be picked instead: the occasion, dates and
/// times come from pickers, every course from the live menu, and add-ons from a
/// two-level category → dish chooser. What *is* typed is held to a format
/// before the wizard will advance (see [_checkField] and [_timeErrors]).
///
/// Submitting files a `pending` document in `bookings` via
/// [BookingRepository], then hands the member to [PaymentPage] for the 50%
/// downpayment that holds the date, and settles into a thank-you state.
///
/// The booking is filed *before* the payment, not after: everything the member
/// spent eight steps filling in is safe the moment they tap SEND, and an
/// abandoned payment leaves a resumable order rather than losing the form. Such
/// an order carries `paymentStatus: 'awaiting'` until the downpayment clears —
/// see [_submit] and [Booking.payment].
///
/// This is the *catering* flow; food pack packages book through the
/// quotation-shaped [FoodPackBookingPage] instead.
class BookingPage extends StatefulWidget {
  const BookingPage({super.key, this.package, this.resumeFrom});

  /// When launched from a package's detail sheet, that package prefills the
  /// "Type/Price of Package" field on the menu step. Also what a resumed
  /// draft's menu steps are built from — see [resumeFrom], which requires the
  /// SAME package that was booked against, not merely one at the same price.
  final CateringPackage? package;

  /// A "Continue later" draft to reopen the wizard on, instead of a blank
  /// form. Every answer it carries prefills its field, the add-ons it held
  /// are restored, and the wizard opens on the page the member left off at
  /// (see [Booking.draftStep]). Order Tracking is the only place this is
  /// passed — it resolves [package] to the one the draft names
  /// ([Booking.draftPackageId]) before pushing this page, since the menu
  /// steps below depend on getting the same package back.
  final Booking? resumeFrom;

  @override
  State<BookingPage> createState() => _BookingPageState();
}

class _BookingPageState extends State<BookingPage> {
  /// The steps that come before the menu — the same for every package.
  ///
  /// The menu steps that follow are built from the booked package's inclusions
  /// (see [_steps]), so the wizard asks for the food that package actually
  /// buys rather than a fixed thirteen-course spread.
  static const List<(String, String, String)> _fixedSteps = [
    (
      'THE OCCASION',
      'Tell us about your celebration',
      'What are we celebrating — and when, where and for how many?',
    ),
    (
      'THE CLIENT',
      'How do we reach you?',
      'So we can confirm the details and coordinate on the day.',
    ),
    (
      'THE SET-UP',
      'Letting us in',
      'When may we come in to set up, and by when must we pack out? '
          'We plan the kitchen\'s day around these, so both are needed.',
    ),
    (
      'THE PROGRAM',
      'How the day flows',
      'All three are needed — they\'re how we time the food to your program.',
    ),
  ];

  /// How many course questions share one menu step, so no page runs long.
  static const int _coursesPerStep = 4;

  /// Document fields that are bookkeeping, not wizard answers — kept off
  /// [_fields] when resuming a draft (see [initState]) so they can never ride
  /// along into a real send.
  static const Set<String> _draftMetaKeys = {
    'uid',
    'status',
    'draftStep',
    'draftPackageId',
    'bookingType',
    'createdAt',
    'statusUpdatedAt',
  };

  /// The fields checked on each step *before* the menu. The menu steps' fields
  /// come from the package's inclusions — see [_validatedByStep].
  static const Map<int, List<String>> _fixedValidatedByStep = {
    0: ['kindOfFunction', 'functionDate', 'venue', 'pax'],
    1: ['clientName', 'contactNumber', 'address'],
    2: ['ingress', 'egress'],
    3: ['functionStart', 'foodServing', 'programEnd'],
  };

  /// Every field's label on the form — the one place they're written, so the
  /// blank on the page and the line naming it in the error popup can't drift.
  static const Map<String, String> _labels = {
    'kindOfFunction': 'Kind of Function',
    'functionDate': 'Date of Function',
    'venue': 'Venue of the Function',
    'pax': 'No. of Pax',
    'clientName': 'Client\'s Name',
    'contactNumber': 'Contact Number',
    'address': 'Address',
    'ingress': 'Time of Ingress',
    'egress': 'Time of Egress',
    'functionStart': 'Start of Function',
    'foodServing': 'Time of Food Serving',
    'programEnd': 'End of Program',
    'package': 'Type/Price of Package',
    'setupStyle': 'Table & Venue Set-up',
  };

  /// The last step, when the moderator's `setups` gallery has anything in it —
  /// the look the tables and venue are dressed in.
  static const (String, String, String) _setupStep = (
    'THE LOOK',
    'How we dress the venue',
    'Pick the set-up you\'d like your tables and venue styled after — tap a '
        'photo\'s magnifier to see it bigger.',
  );

  /// A field's label: the fixed questions from [_labels], every course from the
  /// package inclusion that created it ("Sandwich or Appetizer"), so the form
  /// and the error popup name it exactly as the moderator wrote it.
  String _labelFor(String key) =>
      _labels[key] ?? _courseByKey[key]?.label ?? key;

  /// The blanks the booking can't be filed without — which is every question on
  /// the wizard. The kitchen's day is built out of them: the set-up window, the
  /// program's shape and the whole spread all have to be on the form before a
  /// crew and a menu can be scheduled against it. Only the add-ons stay
  /// genuinely extra, and they're not a field.
  ///
  /// Derived from [_validatedByStep] so a question added later is required by
  /// default; to let one through empty again, exclude it here.
  Set<String> get _required => {
        for (final keys in _validatedByStep.values) ...keys,
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

  int _step = 0;

  /// Which way the wizard last moved — drives the side the arriving step
  /// slides in from, so advancing and going back feel like different moves.
  bool _stepForward = true;
  bool _submitting = false;
  bool _submitted = false;

  /// The filed booking, once SEND has gone through — what the downpayment is
  /// taken against, and what the thank-you state reports on.
  String? _bookingId;

  /// The draft this wizard is saving into, if any — [widget.resumeFrom]'s id
  /// on a resumed draft, or whatever [BookingRepository.saveDraft] handed back
  /// the first time "Continue later" is tapped in a fresh session. Kept so a
  /// second tap updates the same document instead of creating another one, and
  /// so a successful send can clean the draft up (see [_submit]).
  String? _draftId;

  /// True while a "Continue later" save is in flight, so the button can show
  /// its own busy state independently of [_submitting].
  bool _savingDraft = false;

  /// True when this order carries a downpayment to collect (see [_orderTotal]).
  /// False for an order with no package price behind it, which files for the
  /// team to quote instead.
  bool _gated = false;

  /// True once the downpayment has cleared.
  bool _paid = false;

  /// The PayMongo checkout page opened for this order, so a second run at the
  /// payment reuses it instead of opening another.
  String? _sessionId;
  String? _checkoutUrl;

  final Map<String, TextEditingController> _fields = {};
  final Map<String, String> _errors = {};

  /// The picked time behind each time field's display text, so the chronology
  /// checks compare real clock values instead of re-parsing localised strings.
  final Map<String, TimeOfDay> _times = {};

  /// The extras the member chose from the add-on picker — never typed, so they
  /// always name a dish the kitchen actually publishes.
  final List<_AddOnLine> _addOns = [];

  /// The live menu, so each course field can offer the actual dishes the
  /// moderator has published rather than a blank line.
  StreamSubscription<List<Product>>? _productSub;
  List<Product> _products = const [];

  /// The live per-head rates add-ons are charged at, by category (with any
  /// per-dish override applied). Empty until the categories load, which is why
  /// every price on screen is written to tolerate "not priced yet".
  StreamSubscription<AddOnPricing>? _pricingSub;
  AddOnPricing _pricing = const AddOnPricing.empty();

  /// The event setups the moderator publishes — the photos the last step is
  /// built from. Empty until they load, and empty for good if the gallery is
  /// bare, which is exactly when the step shouldn't exist at all.
  StreamSubscription<List<EventSetup>>? _setupSub;
  List<EventSetup> _setups = const [];

  /// The courses this booking asks for — one per inclusion on the booked
  /// package, in the moderator's order. A booking started without a package
  /// (the "describe one" path) has none, so the wizard just skips the menu
  /// steps and the kitchen quotes the spread when it confirms.
  late final List<PackageCourse> _courses = widget.package?.courses ?? const [];

  /// Course by field key, for label and category lookups.
  late final Map<String, PackageCourse> _courseByKey = {
    for (final c in _courses) c.key: c,
  };

  /// The courses split into pages of [_coursesPerStep]. The first menu page
  /// also carries the package line, so it takes one fewer course.
  List<List<PackageCourse>> get _coursePages {
    if (_courses.isEmpty) return const [];
    final pages = <List<PackageCourse>>[];
    // Page one shares its space with the package field.
    var index = 0;
    final first = _coursesPerStep - 1;
    pages.add(_courses.sublist(0, min(first, _courses.length)));
    index = min(first, _courses.length);
    while (index < _courses.length) {
      final end = min(index + _coursesPerStep, _courses.length);
      pages.add(_courses.sublist(index, end));
      index = end;
    }
    return pages;
  }

  /// The whole wizard — the questions above, then the set-up step when there
  /// are setups to choose from.
  List<(String, String, String)> get _steps => [
        ..._contentSteps,
        if (_hasSetupStep) _setupStep,
      ];

  /// True once the moderator's setup gallery has arrived with something in it.
  /// Nothing published (or the read failed) means no set-up step: the wizard
  /// can't ask a member to pick from an empty wall.
  bool get _hasSetupStep => _setups.isNotEmpty;

  /// Where the set-up step sits, or -1 when there is none. It's appended after
  /// the menu, so every step before it keeps its index even if the gallery
  /// only loads once the member is halfway through the form.
  int get _setupStepIndex => _hasSetupStep ? _contentSteps.length : -1;

  /// The fixed questions, then one step per page of courses. The last menu step
  /// carries the add-ons; when the package has no inclusions at all, a single
  /// "the package" step does.
  List<(String, String, String)> get _contentSteps {
    final pages = _coursePages;
    if (pages.isEmpty) {
      return [
        ..._fixedSteps,
        (
          'THE PACKAGE',
          'Your package',
          'Your chosen package. Add-ons below are extra — take them or leave '
              'them.',
        ),
      ];
    }
    return [
      ..._fixedSteps,
      for (var i = 0; i < pages.length; i++)
        if (i == 0)
          (
            'THE PACKAGE',
            'Your package & menu',
            'Your chosen package, and a dish for each course it includes — '
                'tap one to choose from our menu.',
          )
        else if (i == pages.length - 1)
          (
            'TO FINISH',
            'The last of the menu',
            'The rest of what your package includes. Add-ons below are extra '
                '— take them or leave them.',
          )
        else
          (
            'THE MENU',
            'More of the feast',
            'A dish for each course — tap one to choose from our menu.',
          ),
    ];
  }

  /// Every field checked when leaving a step: the fixed questions, then each
  /// menu page's courses (the first also carrying the package line).
  Map<int, List<String>> get _validatedByStep {
    final pages = _coursePages;
    final base = _fixedSteps.length;
    return {
      ..._fixedValidatedByStep,
      if (pages.isEmpty) base: const ['package'],
      for (var i = 0; i < pages.length; i++)
        base + i: [
          if (i == 0) 'package',
          for (final c in pages[i]) c.key,
        ],
      if (_hasSetupStep) _setupStepIndex: const ['setupStyle'],
    };
  }

  TextEditingController _ctrl(String key) =>
      _fields.putIfAbsent(key, () => TextEditingController());

  @override
  void initState() {
    super.initState();
    final draft = widget.resumeFrom;
    if (draft != null) {
      _draftId = draft.id;
      // Every answer the draft carries, poured straight back into its field —
      // course keys included, since [_labels] only names the fixed questions
      // and the rest are read out of the document the same generic way the
      // draft was saved from (see [_submit]'s `_fields.entries`).
      //
      // The document's OWN bookkeeping — `uid`, `status`, `draftStep`,
      // `draftPackageId`, `bookingType`, `createdAt`, `statusUpdatedAt` — is
      // deliberately skipped rather than copied in: those aren't wizard
      // answers, and a real send re-derives every one of them itself
      // (see [_submit]). Copying them in used to be harmless only because
      // [BookingRepository.submit]'s own map literal happens to re-assert
      // `uid`/`status`/`createdAt` after the spread — a single reordering
      // there would have silently sent a booking stamped `status: 'draft'`
      // and rejected by the rules, or `createdAt` as a plain string instead
      // of the server timestamp the rules require to equal `request.time`.
      for (final entry in draft.data.entries) {
        if (_draftMetaKeys.contains(entry.key)) continue;
        final value = entry.value?.toString() ?? '';
        if (value.isEmpty) continue;
        _ctrl(entry.key).text = value;
      }
      // Picked times don't round-trip through their display text (locale-
      // dependent formatting), so the chronology check simply has nothing to
      // compare until the member re-taps a time picker — the typed-looking
      // text is still there and still passes [_checkField] on its own.
      //
      // Clamped: the package could have picked up or dropped an inclusion
      // since the draft was saved, changing how many menu steps exist.
      _step = draft.draftStep.clamp(0, _steps.length - 1);
    } else {
      // Prefill everything we already know. From the member's account: their
      // name (and, once the profile loads, their phone number). From the
      // booked package: its name/price and its minimum pax as the starting
      // headcount.
      final name = (CustomerRepository().displayName ?? '').trim();
      if (name.isNotEmpty) _ctrl('clientName').text = name;
      final pkg = widget.package;
      if (pkg != null) {
        final unit = pkg.isFoodPack ? 'per pack' : 'per head';
        _ctrl('package').text = pkg.price > 0
            ? '${pkg.name} — ${peso(pkg.price)} $unit'
            : pkg.name;
        if (pkg.minPax > 0) _ctrl('pax').text = '${pkg.minPax}';
      }
      // The phone number lives on the Firestore profile, so it arrives
      // async — fill only fields the member hasn't typed into meanwhile.
      CustomerRepository().fetchCurrentCustomer().then((customer) {
        if (!mounted || customer == null) return;
        setState(() {
          _fillIfEmpty('clientName', customer.name);
          _fillIfEmpty('contactNumber', customer.phone);
        });
      }).catchError((_) {
        // Offline / rules hiccup — the member just types it in themselves.
      });
    }
    // The live menu feeds the course pickers (shared app-wide listener, so
    // this doesn't re-download anything the Menu tab already has).
    _productSub = ProductRepository().watchVisible().listen(
      (data) {
        if (!mounted) return;
        setState(() {
          _products = data;
          // The add-ons a resumed draft held are stored as text lines
          // ("Beef Caldereta × 2 — ₱150/pax"), because that's the only form
          // that survives a Firestore round-trip through a free-text field —
          // rebuild the real dish-backed list the moment the menu they refer
          // to has loaded, and only once (an empty [_addOns] is also the
          // legitimate "chose none" state for a fresh wizard).
          if (draft != null && !_addOnsRestored) _restoreAddOns(draft);
        });
      },
      onError: (_) {}, // pickers quietly fall back to free-text fields
    );
    _pricingSub = MenuCategoryRepository().watchPricing().listen(
      (table) {
        if (mounted) setState(() => _pricing = table);
      },
      // Unpriced is a state the wizard already handles: the extras are listed
      // and the team quotes them, exactly as before add-ons carried prices.
      onError: (_) {},
    );
    _setupSub = CateringRepository().watchSetups().listen(
      (data) {
        if (!mounted) return;
        setState(() {
          _setups = data;
          // The set-up step exists only while the gallery has photos in it, so
          // a gallery that empties mid-wizard (the moderator hiding the last
          // one) must not leave [_step] pointing past the end of the list.
          _step = _step.clamp(0, _steps.length - 1);
        });
      },
      // No gallery, no set-up question — the team styles the tables as they
      // always did before the wizard asked.
      onError: (_) {},
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
    _pricingSub?.cancel();
    _setupSub?.cancel();
    for (final c in _fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  /// All available dishes for a course, drawn from the booked package's
  /// family first (food packs offer Food Packs dishes, everything else the
  /// Catering Food Trays) and falling back to the whole menu so the picker is
  /// never needlessly empty.
  ///
  /// The course's categories are the moderator's own category names, taken
  /// straight from the inclusion, so they match a dish's `category` exactly.
  /// Plural / singular drift is tolerated ("Seafood" still finds "Seafoods")
  /// so renaming a category doesn't strand its dishes.
  List<Product> _dishesFor(String key) {
    final course = _courseByKey[key];
    if (course == null) return const [];
    bool inCourse(Product p) {
      final cat = _singular(p.category);
      return course.categories.any((c) => _singular(c) == cat);
    }

    final wantType = widget.package?.productType ?? 'Catering Food Trays';
    final inFamily = _products
        .where((p) => p.type == wantType && inCourse(p))
        .toList();
    if (inFamily.isNotEmpty) return inFamily;
    return _products.where(inCourse).toList();
  }

  /// A category name reduced for comparison: trimmed, lowercased and stripped
  /// of a trailing "s" so "Seafoods" and "Seafood" are the same course.
  static String _singular(String value) {
    final v = value.trim().toLowerCase();
    return v.endsWith('s') ? v.substring(0, v.length - 1) : v;
  }

  /// The chosen add-ons as form lines — "Beef Caldereta × 2 — ₱150/pax". The
  /// rate travels with the line so the Orders board reads the price the member
  /// was actually shown, not one recomputed later from a category whose rate
  /// may since have changed. An extra the moderator hasn't priced says so
  /// plainly rather than going out as a silent blank.
  List<String> get _addOnLines => [
        for (final l in _addOns)
          switch (_pricing.priceFor(l.dish)) {
            final num rate => '${l.dish.name} × ${l.qty} — ${peso(rate)}/pax',
            null => '${l.dish.name} × ${l.qty} — to be quoted',
          },
      ];

  /// True once [_restoreAddOns] has run, so a resumed draft's extras are
  /// rebuilt exactly once — after that, an emptied [_addOns] genuinely means
  /// the member removed every one of them.
  bool _addOnsRestored = false;

  /// The inverse of [_addOnLines]: turns a draft's saved add-on lines back
  /// into real [_AddOnLine]s now that the menu they name has loaded.
  ///
  /// A line is "Dish Name × N — …"; the " × " separator is safe to split on
  /// because dish names are the moderator's own and never contain it. A line
  /// naming a dish no longer on the menu (deleted, or hidden since the draft
  /// was saved) is silently dropped — there is nothing left to add it back
  /// as, and re-choosing it is what the add-on picker is for.
  void _restoreAddOns(Booking draft) {
    _addOnsRestored = true;
    _addOns.clear();
    for (final line in draft.lines('menuAddOns')) {
      final sep = line.indexOf(' × ');
      if (sep == -1) continue;
      final name = line.substring(0, sep).trim();
      final rest = line.substring(sep + 3);
      final qtyMatch = RegExp(r'^\d+').firstMatch(rest);
      final qty = qtyMatch == null ? 1 : int.parse(qtyMatch.group(0)!);
      Product? dish;
      for (final p in _products) {
        if (p.name == name) {
          dish = p;
          break;
        }
      }
      if (dish == null) continue;
      _addOns.add(_AddOnLine(dish)..qty = qty.clamp(1, 99));
    }
  }

  // ── Pickers ───────────────────────────────────────────────────────────────
  /// The occasions the kitchen cooks for most often — the list behind the
  /// "Kind of Function" popup. Booking Hapag Serbisyo narrows it to the three
  /// institutional functions that package is offered for.
  List<String> get _occasions => (widget.package?.isInstitutional ?? false)
      ? const ['Church Function', 'Government Function', 'School Function']
      : const [
          'Wedding',
          'Birthday',
          'Christening / Binyag',
          'Debut',
          'Anniversary',
          'Graduation',
          'Family Reunion',
          'Despedida',
          'Fiesta',
          'Corporate Event',
          'Church Function',
          'Government Function',
          'School Function',
          'Funeral Reception',
        ];

  /// The occasion popup: it opens on the common celebrations, and "Other" turns
  /// it into a single blank for anything not on the list — so the field on the
  /// form is only ever tapped, never typed into.
  ///
  /// Hapag Serbisyo offers no Other: that package is sold strictly for the
  /// three institutional functions, so the list is the whole of it.
  Future<void> _pickOccasion() async {
    final options = _occasions;
    final allowOther = !(widget.package?.isInstitutional ?? false);
    final ctrl = _ctrl('kindOfFunction');
    final current = ctrl.text.trim();
    // A value that isn't on the list came from Other, so reopening the popup
    // lands back on the blank with it ready to edit.
    final custom = options.contains(current) ? '' : current;
    final other = TextEditingController(text: custom);

    var typing = allowOther && custom.isNotEmpty;
    String? error;

    void choose(BuildContext dialogContext, String occasion) {
      Navigator.of(dialogContext).pop();
      setState(() {
        ctrl.text = occasion;
        _errors.remove('kindOfFunction');
      });
    }

    await showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          // Each face — the list of occasions, and the blank behind Other — is
          // built as one widget with its own key, so the popup can cross-fade
          // from one to the other and settle to the new height (see the
          // AnimatedSize / AnimatedSwitcher pair below) instead of snapping.
          // The commit button lives inside the typing face rather than in the
          // shell's pinned footer for the same reason: a footer appearing would
          // jump the card's height out from under the fade.
          final Widget face = typing
              ? Column(
                  key: const ValueKey('occasion-typing'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Tell us the occasion', style: AppTextStyles.title),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      'A few words is plenty — e.g. "Company Christmas party".',
                      style: AppTextStyles.bodySmall,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    _DialogBackRow(
                      label: 'ALL OCCASIONS',
                      onTap: () => setDialogState(() {
                        typing = false;
                        error = null;
                      }),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    AppTextField(
                      hint: 'e.g. Company Christmas party',
                      controller: other,
                      prefixIcon: Icons.celebration_outlined,
                      errorText: error,
                      inputFormatters: [LengthLimitingTextInputFormatter(60)],
                      onChanged: (_) {
                        if (error != null) setDialogState(() => error = null);
                      },
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    AppButton.primary(
                      label: 'USE THIS OCCASION',
                      fullWidth: true,
                      onPressed: () {
                        final value = other.text.trim();
                        final problem = value.isEmpty
                            ? 'Please tell us what we\'re celebrating.'
                            : _checkWords(value, min: 3, max: 60);
                        if (problem != null) {
                          setDialogState(() => error = problem);
                          return;
                        }
                        choose(dialogContext, value);
                      },
                    ),
                  ],
                )
              : Column(
                  key: const ValueKey('occasion-list'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('What are we celebrating?',
                        style: AppTextStyles.title),
                    const SizedBox(height: AppSpacing.xs),
                    Text(
                      allowOther
                          ? 'Pick the closest one. Nothing quite right? Choose '
                              'Other and type it yourself.'
                          : 'Hapag Serbisyo is offered strictly for these '
                              'three functions.',
                      style: AppTextStyles.bodySmall,
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    for (final option in options) ...[
                      _OccasionRow(
                        name: option,
                        selected: current == option,
                        onTap: () => choose(dialogContext, option),
                      ),
                      const SizedBox(height: AppSpacing.sm),
                    ],
                    if (allowOther)
                      _OccasionRow(
                        name: 'Other',
                        subtitle: 'Something else — type it yourself',
                        icon: Icons.edit_outlined,
                        selected: custom.isNotEmpty,
                        onTap: () => setDialogState(() => typing = true),
                      ),
                  ],
                );

          return AppDialogShell(
            children: [
              // The eyebrow is common to both faces, so it stays put while the
              // rest of the popup changes under it.
              Text(
                'THE OCCASION · ${_labels['kindOfFunction']!.toUpperCase()}',
                style: AppTextStyles.eyebrow,
              ),
              const SizedBox(height: AppSpacing.sm),
              AnimatedSize(
                duration: Motion.base,
                curve: Motion.standard,
                alignment: Alignment.topCenter,
                child: AnimatedSwitcher(
                  duration: Motion.base,
                  switchInCurve: Motion.standard,
                  switchOutCurve: Motion.exit,
                  // The faces are very different heights. Taking the size from
                  // the incoming face alone (the outgoing one is positioned, so
                  // it doesn't stretch the card) leaves the height change to
                  // AnimatedSize above, which eases it.
                  layoutBuilder: (current, previous) => Stack(
                    alignment: Alignment.topLeft,
                    children: [
                      for (final child in previous)
                        Positioned(left: 0, right: 0, top: 0, child: child),
                      ?current,
                    ],
                  ),
                  transitionBuilder: (child, animation) => FadeTransition(
                    opacity: animation,
                    child: SlideTransition(
                      position: Tween<Offset>(
                        begin: const Offset(0, 0.03),
                        end: Offset.zero,
                      ).animate(animation),
                      child: child,
                    ),
                  ),
                  child: face,
                ),
              ),
            ],
          );
        },
      ),
    );
    other.dispose();
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now.add(const Duration(days: 14)),
      firstDate: now,
      lastDate: DateTime(now.year + 2, now.month, now.day),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _ctrl('functionDate').text = _formatDate(picked);
      _errors.remove('functionDate');
    });
  }

  /// The address popup: a full-screen Google Places search plus a draggable
  /// pin, so the field is filled with a real, mappable address rather than
  /// however the member happens to type it. Reopening it hands back whatever
  /// is already on the field, so a member fine-tuning the pin doesn't start
  /// over from a blank search.
  Future<void> _pickAddress() async {
    final current = _ctrl('address').text.trim();
    final resolved = await Navigator.of(context).push<ResolvedAddress>(
      BrandPageRoute<ResolvedAddress>(
        builder: (_) => AddressPickerPage(
          initialAddress: current.isEmpty ? null : current,
        ),
      ),
    );
    if (resolved == null || !mounted) return;
    setState(() {
      _ctrl('address').text = resolved.address;
      _errors.remove('address');
    });
  }

  /// Same picker as [_pickAddress], titled for the event's venue rather than
  /// the delivery address — the two questions ask for the same kind of
  /// thing (a real, mappable place), just at different steps of the form.
  Future<void> _pickVenue() async {
    final current = _ctrl('venue').text.trim();
    final resolved = await Navigator.of(context).push<ResolvedAddress>(
      BrandPageRoute<ResolvedAddress>(
        builder: (_) => AddressPickerPage(
          initialAddress: current.isEmpty ? null : current,
          title: 'Choose your venue',
          searchHint: 'Search for the venue',
          fieldLabel: 'VENUE',
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

  Future<void> _pickTime(String key) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _times[key] ?? const TimeOfDay(hour: 10, minute: 0),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _times[key] = picked;
      _ctrl(key).text = picked.format(context);
      // The order of the day is checked as a whole, so re-picking one time
      // clears the complaints against all of them.
      _errors.removeWhere((k, _) => _isTimeKey(k));
    });
  }

  static bool _isTimeKey(String key) => const {
        'ingress',
        'egress',
        'functionStart',
        'foodServing',
        'programEnd',
      }.contains(key);

  // ── Validation ────────────────────────────────────────────────────────────
  /// Every complaint against [step] — presence, then format, then the
  /// chronology between the times — keyed by field. Empty means the step is
  /// clean. Pure: nothing here paints or pops up.
  Map<String, String> _stepErrors(int step) {
    final found = <String, String>{};
    for (final key in _validatedByStep[step] ?? const <String>[]) {
      final error = _checkField(key);
      if (error != null) found[key] = error;
    }
    // Chronology complaints land on the later of the two times, so they never
    // overwrite a format message already on that field.
    for (final entry in _timeErrors(step).entries) {
      found.putIfAbsent(entry.key, () => entry.value);
    }
    return found;
  }

  /// Marks [step]'s fields with [found] (each message shakes its field) and
  /// clears the ones that now pass.
  void _paintErrors(int step, Map<String, String> found) {
    setState(() {
      for (final key in _validatedByStep[step] ?? const <String>[]) {
        _errors.remove(key);
      }
      _errors.addAll(found);
    });
  }

  /// Checks [step], marks its fields, and raises the popup listing whatever
  /// failed. Returns true when the step is clean.
  bool _validateStep(int step) {
    final found = _stepErrors(step);
    _paintErrors(step, found);
    if (found.isEmpty) return true;
    _showProblems(step, found);
    return false;
  }

  /// The wizard's one way of speaking up: a centered popup naming each blank
  /// that needs a second look, in the order the blanks appear on the step. The
  /// fields keep their marks underneath, so the member still sees which ones to
  /// fix once the popup is dismissed.
  void _showProblems(int step, Map<String, String> found) {
    final keys = [
      for (final key in _validatedByStep[step] ?? const <String>[])
        if (found.containsKey(key)) key,
    ];
    _showAlert(
      eyebrow: '${_steps[step].$1} · PLEASE CHECK',
      title: keys.length == 1
          ? 'One blank needs a second look'
          : '${keys.length} blanks need a second look',
      message: 'We can\'t take the booking forward until these read right.',
      problems: [for (final key in keys) (_labelFor(key), found[key]!)],
    );
  }

  /// The page's popup for anything that went wrong — a failed step check or a
  /// send that didn't get through. Uses the app's standard centered dialog so
  /// an error reads like every other popup in the app.
  Future<void> _showAlert({
    required String eyebrow,
    required String title,
    required String message,
    List<(String, String)> problems = const [],
  }) {
    return showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => AppDialogShell(
        footer: AppButton.primary(
          label: 'GOT IT',
          fullWidth: true,
          onPressed: () => Navigator.of(dialogContext).pop(),
        ),
        children: [
          Text(eyebrow, style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          Text(title, style: AppTextStyles.title),
          const SizedBox(height: AppSpacing.xs),
          Text(message, style: AppTextStyles.bodySmall),
          if (problems.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            // The complaints arrive one after another, just behind the popup's
            // own scale-in, so a list of them reads as a list rather than
            // landing all at once.
            for (final (i, (label, problem)) in problems.indexed) ...[
              FadeSlideIn(
                delay: Duration(milliseconds: 110 + 70 * i),
                duration: Motion.base,
                offsetY: 10,
                child: _ProblemRow(label: label, message: problem),
              ),
              const SizedBox(height: AppSpacing.sm),
            ],
          ],
        ],
      ),
    );
  }

  /// The message for [key]'s current value, or null when it passes. Optional
  /// fields pass while empty; anything filled in is held to its format.
  String? _checkField(String key) {
    final value = _ctrl(key).text.trim();
    if (value.isEmpty) {
      if (!_required.contains(key)) return null;
      // A blank that's tapped, not typed, asks to be picked.
      if (_isTimeKey(key)) return 'Please pick a time.';
      if (key == 'functionDate') return 'Please pick a date.';
      if (key == 'kindOfFunction') return 'Please choose the occasion.';
      if (key == 'package') return 'Please tell us which package.';
      if (key == 'address') return 'Please choose your address on the map.';
      if (key == 'venue') return 'Please choose your venue on the map.';
      if (key == 'setupStyle') return 'Please choose a set-up.';
      if (_courseByKey.containsKey(key)) {
        // Courses with nothing published fall back to a typed blank.
        return _dishesFor(key).isNotEmpty
            ? 'Please choose a dish.'
            : 'Please name a dish.';
      }
      return 'Please fill this in';
    }
    // Anything a picker wrote is already well-formed, and its shape isn't ours
    // to second-guess: the date, the times (a 24-hour locale's "10:00" carries
    // no letters), the address and venue (Google's own formatted string), the
    // set-up (the moderator's own gallery title), and any course served by the
    // live menu.
    if (key == 'functionDate' ||
        key == 'address' ||
        key == 'venue' ||
        key == 'setupStyle' ||
        _isTimeKey(key)) {
      return null;
    }
    if (_courseByKey.containsKey(key) && _dishesFor(key).isNotEmpty) {
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
      case 'contactNumber':
        return _checkMobile(value);
      case 'pax':
        return _checkPax(value);
      default:
        // The package line and any course blank that fell back to free text
        // (nothing published in that course yet) — keep it dish-shaped.
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
  /// take in one booking — and never under the booked package's minimum.
  String? _checkPax(String value) {
    final pax = int.tryParse(value);
    if (pax == null) return 'Numbers only — e.g. 150';
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

  /// Minutes after ingress — the run of hours the booking actually occupies.
  ///
  /// Every time is measured from ingress and rolls forward past midnight, so an
  /// afternoon set-up with a 1:00 AM egress reads in order. The point of
  /// anchoring on ingress rather than on a fixed hour of the clock is that the
  /// span is then a real length: 6:30 AM ingress → 5:30 AM egress is 23 hours,
  /// which [_maxSpanMins] rejects, instead of quietly passing as "later in the
  /// day" the way a wall-clock comparison would.
  int? _sinceIngress(String key) {
    final ingress = _times['ingress'];
    final time = _times[key];
    if (ingress == null || time == null) return null;
    const day = 24 * 60;
    final from = ingress.hour * 60 + ingress.minute;
    final at = time.hour * 60 + time.minute;
    return (at - from + day) % day;
  }

  /// How long a booking may run from ingress to egress. Under the floor there's
  /// no time to set up and pack out; over the ceiling the times are far likelier
  /// to be a slip (an AM/PM mix-up, a next-morning egress picked by accident)
  /// than a real function.
  static const int _minSpanMins = 60;
  static const int _maxSpanMins = 16 * 60;

  /// "23 hours" / "12h 30m" / "45 minutes" — a span as the message should read.
  static String _spanLabel(int mins) {
    final hours = mins ~/ 60;
    final rest = mins % 60;
    if (hours == 0) return '$rest minutes';
    if (rest == 0) return '$hours hour${hours == 1 ? '' : 's'}';
    return '${hours}h ${rest}m';
  }

  /// The day has to run in order, and inside a believable span. Each check only
  /// speaks up once both of its times are picked, and the message lands on the
  /// later one — the field the member most likely wants to change.
  Map<String, String> _timeErrors(int step) {
    final found = <String, String>{};
    // The whole set-up window: everything else has to fit inside it.
    final span = _sinceIngress('egress');

    void inOrder(
      String earlier,
      String later,
      String message, {
      bool allowSame = false,
    }) {
      final a = _sinceIngress(earlier);
      final b = _sinceIngress(later);
      if (a == null || b == null || found.containsKey(later)) return;
      final ok = allowSame ? b >= a : b > a;
      if (!ok) found[later] = message;
    }

    switch (step) {
      case 2:
        if (span == 0) {
          found['egress'] = 'Egress has to be later than the time we come in.';
        } else if (span != null && span < _minSpanMins) {
          found['egress'] =
              'That leaves only ${_spanLabel(span)} to set up and pack out.';
        } else if (span != null && span > _maxSpanMins) {
          found['egress'] = 'That\'s ${_spanLabel(span)} after ingress — '
              'please check the AM/PM.';
        }
      case 3:
        // Nothing in the program may fall outside the set-up window. A time
        // *before* ingress lands here too: measured from ingress it reads as
        // most of a day later, which is well past egress.
        if (span != null) {
          for (final key in const [
            'functionStart',
            'foodServing',
            'programEnd',
          ]) {
            final at = _sinceIngress(key);
            if (at != null && at > span) {
              found[key] =
                  'This has to fall between your ingress and egress times.';
            }
          }
        }
        inOrder(
          'functionStart',
          'foodServing',
          'Food is served once the function has started.',
          allowSame: true,
        );
        inOrder(
          'functionStart',
          'programEnd',
          'The program has to end after the function starts.',
        );
        inOrder(
          'foodServing',
          'programEnd',
          'The program has to end after the food is served.',
        );
    }
    return found;
  }

  // ── Flow ──────────────────────────────────────────────────────────────────
  void _next() {
    if (!_validateStep(_step)) return;
    if (_step < _steps.length - 1) {
      _goToStep(_step + 1);
      return;
    }
    // Last page: re-check every step before filing, so a blank the member
    // walked back through can't slip out. The wizard returns to the first
    // step that complains, and the popup names what's wrong there.
    for (var step = 0; step < _steps.length; step++) {
      final found = _stepErrors(step);
      _paintErrors(step, found);
      if (found.isNotEmpty) {
        _goToStep(step);
        _showProblems(step, found);
        return;
      }
    }
    _submit();
  }

  void _back() {
    if (_step > 0) _goToStep(_step - 1);
  }

  /// The one place [_step] moves, so the slide direction can never disagree
  /// with the step it is animating to — including the jump back to whichever
  /// step still has a problem on it.
  void _goToStep(int next) {
    setState(() {
      _stepForward = next >= _step;
      _step = next;
    });
  }

  // ── The downpayment ───────────────────────────────────────────────────────
  /// The order's full amount — the booked package's per-head price times the
  /// headcount.
  ///
  /// Null when the wizard wasn't opened from a package (the Packages tab's plain
  /// "Catering Service" row starts a booking with no package behind it) or when
  /// that package carries no price. The package field is free text in that case,
  /// and a price read out of prose is a price the member set themselves — so
  /// rather than guess at a figure to charge, those orders file for the team to
  /// quote (see [_submit]).
  /// The headcount the member has entered, or 0 while it is blank or unusable.
  int get _pax => int.tryParse(_ctrl('pax').text.trim()) ?? 0;

  /// Active promo discount on the booked package if any.
  PackageDiscountInfo? get _packageDiscount {
    final pkg = widget.package;
    if (pkg == null || pkg.price <= 0) return null;
    return PromoDiscountService.instance.getPackageDiscount(pkg.name, pkg.price);
  }

  /// What the package alone comes to — its per-head discounted price times the headcount.
  num? get _packageTotal {
    final price = widget.package?.price ?? 0;
    if (price <= 0 || _pax <= 0) return null;
    final disc = _packageDiscount;
    final effectivePrice = disc != null ? disc.discountedPrice : price;
    return effectivePrice * _pax;
  }

  /// Total money saved on the package.
  num get _packageSavingsTotal {
    final disc = _packageDiscount;
    if (disc == null || _pax <= 0) return 0;
    return disc.discountSavings * _pax;
  }

  /// What one head of the add-ons comes to (reflecting any active promo discounts).
  num get _addOnsPerHead {
    num sum = 0;
    for (final line in _addOns) {
      final rate = _pricing.priceFor(line.dish);
      if (rate != null) {
        final disc = PromoDiscountService.instance.getDishDiscount(line.dish, rate);
        final effectiveRate = disc != null ? disc.discountedPrice : rate;
        sum += effectiveRate * line.qty;
      }
    }
    return sum;
  }

  /// Total money saved on add-ons across all pax.
  num get _addOnsSavingsTotal {
    num sum = 0;
    if (_pax <= 0) return 0;
    for (final line in _addOns) {
      final rate = _pricing.priceFor(line.dish);
      if (rate != null) {
        final disc = PromoDiscountService.instance.getDishDiscount(line.dish, rate);
        if (disc != null) {
          sum += disc.discountSavings * line.qty * _pax;
        }
      }
    }
    return sum;
  }

  /// Total promo savings across package and all add-ons.
  num get _totalSavings => _packageSavingsTotal + _addOnsSavingsTotal;

  /// The add-ons' share of the order — per-head rates times the headcount.
  num get _addOnsTotal => _pax > 0 ? _addOnsPerHead * _pax : 0;

  /// The chosen extras that carry no price, so the summary can say plainly
  /// which ones the team will still quote.
  List<_AddOnLine> get _unpricedAddOns =>
      [for (final l in _addOns) if (_pricing.priceFor(l.dish) == null) l];

  /// The order's full amount — the discounted package plus the discounted add-ons.
  num? get _orderTotal {
    final base = _packageTotal;
    if (base == null) return null;
    return base + _addOnsTotal;
  }

  /// The total's arithmetic, spelled out for the payment screen.
  String? get _priceLine {
    final price = widget.package?.price ?? 0;
    if (price <= 0 || _pax <= 0) return null;
    final pkgDisc = _packageDiscount;
    final effectivePrice = pkgDisc != null ? pkgDisc.discountedPrice : price;
    var line = '${peso(effectivePrice)} per head × $_pax pax';
    if (pkgDisc != null) {
      line += ' (${pkgDisc.badgeLabel})';
    }
    final extras = _addOnsPerHead;
    if (extras > 0) {
      line += '  ·  add-ons ${peso(extras)} per head';
    }
    if (_totalSavings > 0) {
      line += '  ·  Total Savings: -${peso(_totalSavings)}';
    }
    return line;
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);

    final total = _orderTotal;
    final num due = total != null && PayMongoConfig.isChargeable(total)
        ? PayMongoConfig.downpaymentOn(total)
        : 0;
    final gated = due > 0;

    final String id;
    try {
      id = await BookingRepository().submit(
        {
          for (final e in _fields.entries) e.key: e.value.text.trim(),
          'menuAddOns': _addOnLines.join('\n'),
          'bookingType': 'Catering',
        },
        payment: {
          'paymentStatus': gated ? 'awaiting' : 'quote_needed',
          'paymentTotal': ?total,
          if (gated) 'paymentDue': due,
          if (_packageTotal != null) 'packageTotal': _packageTotal,
          if (_addOnsTotal > 0) 'addOnsTotal': _addOnsTotal,
          if (_totalSavings > 0) 'discountTotal': _totalSavings,
          if (_packageDiscount != null) 'packageDiscount': _packageDiscount!.badgeLabel,
          if (_addOnsSavingsTotal > 0) 'addOnsDiscountTotal': _addOnsSavingsTotal,
          if (_totalSavings > 0) 'appliedPromos': [
            if (_packageDiscount != null) '${_packageDiscount!.promo.title} (${_packageDiscount!.badgeLabel})',
            for (final l in _addOns)
              if (PromoDiscountService.instance.getDishDiscount(l.dish, _pricing.priceFor(l.dish) ?? 0) != null)
                '${l.dish.name} (${PromoDiscountService.instance.getDishDiscount(l.dish, _pricing.priceFor(l.dish) ?? 0)!.badgeLabel})',
          ],
        },
      );
    } catch (e, st) {
      // Logged rather than shown: the alert below stays the same reassuring
      // copy regardless of cause (there's no fix a member can act on from a
      // raw Firestore error), but a silent catch here was hiding exactly the
      // detail needed to diagnose a real failure — a permission-denied, a
      // malformed value the rules reject, or a genuine network drop all read
      // identically to the member, and used to read identically in the logs
      // too.
      //
      // Logged as its runtimeType + every field a FirebaseException carries,
      // not just `$e` — a bare toString() on some plugin exception types
      // omits the `code`, which is the one field that actually distinguishes
      // "the rules rejected this" from "the network dropped".
      debugPrint('BookingPage._submit failed: (${e.runtimeType}) $e');
      if (e is FirebaseException) {
        debugPrint('  code=${e.code} plugin=${e.plugin} message=${e.message}');
      }
      debugPrintStack(stackTrace: st);
      if (!mounted) return;
      setState(() => _submitting = false);
      _showAlert(
        eyebrow: 'COULDN\'T SEND',
        title: 'Your booking didn\'t go through',
        message: 'Something interrupted the send — nothing was filed. Please '
            'check your connection and tap SEND BOOKING again. Everything '
            'you\'ve filled in is still here.',
      );
      return;
    }

    // The booking above is a brand-new document (submit() always add()s), so a
    // draft this session started from is now a stale copy of an order that
    // exists for real — clean it up. Best-effort: the booking itself is
    // already filed, so a failed delete here (offline, a rules hiccup) just
    // leaves a harmless leftover draft rather than costing the member anything.
    final draftId = _draftId;
    if (draftId != null) {
      unawaited(BookingRepository().deleteDraft(draftId).catchError((_) {}));
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

  /// Saves everything filled in so far as a "Continue later" draft, then
  /// leaves the wizard. Nothing is validated — a draft is allowed to be
  /// incomplete, which is the whole point of saving one instead of finishing
  /// the send.
  Future<void> _saveDraftAndExit() async {
    setState(() => _savingDraft = true);
    try {
      await BookingRepository().saveDraft(
        {
          for (final e in _fields.entries) e.key: e.value.text.trim(),
          'menuAddOns': _addOnLines.join('\n'),
        },
        draftId: _draftId,
        packageId: widget.package?.id,
        step: _step,
      );
    } catch (e, st) {
      debugPrint('BookingPage._saveDraftAndExit failed: (${e.runtimeType}) $e');
      if (e is FirebaseException) {
        debugPrint('  code=${e.code} plugin=${e.plugin} message=${e.message}');
      }
      debugPrintStack(stackTrace: st);
      if (!mounted) return;
      setState(() => _savingDraft = false);
      _showAlert(
        eyebrow: 'COULDN\'T SAVE',
        title: 'That didn\'t save',
        message: 'Something interrupted the save. Please check your '
            'connection and try again — nothing here has been lost.',
      );
      return;
    }
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  /// Opens the downpayment screen for the order just filed, and records whether
  /// it settled. Backing out is not a failure — the order is filed and the
  /// payment resumable — so this only ever sets [_paid].
  Future<void> _collect({required num total, required num due}) async {
    final id = _bookingId;
    if (id == null) return;
    final paid = await Navigator.of(context).push<bool>(
      BrandPageRoute<bool>(
        builder: (_) => PaymentPage(
          bookingId: id,
          reference: Booking.referenceFor(id),
          total: total,
          due: due,
          orderKind: 'Catering',
          summary: _ctrl('kindOfFunction').text.trim().isEmpty
              ? 'Catering booking'
              : _ctrl('kindOfFunction').text.trim(),
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
          email: CustomerRepository().email,
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
          title: Text('Book Us Now', style: AppTextStyles.heading),
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
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
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
                                  ? 'SEND BOOKING'
                                  : 'NEXT',
                              icon: _step == _steps.length - 1
                                  ? Icons.event_available_outlined
                                  : Icons.arrow_forward_rounded,
                              busy: _submitting,
                              fullWidth: true,
                              onPressed: _next,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.sm),
                      // Always available, every step — the wizard is long
                      // enough that a member should never have to hunt for
                      // the way to save and leave.
                      TextButton(
                        onPressed:
                            _submitting || _savingDraft
                                ? null
                                : _saveDraftAndExit,
                        child: _savingDraft
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child:
                                    CircularProgressIndicator(strokeWidth: 2),
                              )
                            : Text(
                                'CONTINUE LATER',
                                style: AppTextStyles.engraved(
                                  size: 10,
                                  color: AppColors.brownSoft,
                                  spacing: 1.1,
                                ),
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
          child: StepTransition(
            step: _step,
            forward: _stepForward,
            child: ListView(
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
            // Tap-to-pick from the common celebrations (see [_pickOccasion]).
            // Hapag Serbisyo is offered strictly to churches, government and
            // schools — booking it locks the list to those three.
            _pickerField(
              'kindOfFunction',
              hint: 'Choose the occasion',
              icon: Icons.celebration_outlined,
              note: (widget.package?.isInstitutional ?? false)
                  ? 'Hapag Serbisyo is offered strictly for church, government '
                      'and school functions.'
                  : null,
              onTap: _pickOccasion,
            ),
            _pickerField(
              'functionDate',
              hint: 'Pick a date',
              icon: Icons.event_outlined,
              onTap: _pickDate,
            ),
            _pickerField(
              'venue',
              hint: 'Search or drop a pin on the map',
              icon: Icons.place_outlined,
              onTap: _pickVenue,
            ),
            _field(
              'pax',
              hint: 'e.g. 150',
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
              icon: Icons.person_outline,
              // Names carry no digits, so the field won't take them.
              inputFormatters: [
                FilteringTextInputFormatter.deny(RegExp(r'\d')),
                LengthLimitingTextInputFormatter(60),
              ],
            ),
            _field(
              'contactNumber',
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
            _pickerField(
              'address',
              hint: 'Search or drop a pin on the map',
              icon: Icons.home_outlined,
              onTap: _pickAddress,
            ),
          ],
        2 => [
            _timeField('ingress'),
            _timeField('egress'),
          ],
        3 => [
            _timeField('functionStart'),
            _timeField('foodServing'),
            _timeField('programEnd'),
          ],
        // The menu steps, built from the package's inclusions (the first
        // carries the package line, the last the add-ons), and after them the
        // set-up gallery when there is one.
        _ => step == _setupStepIndex
            ? _setupStepFields()
            : _menuStepFields(step),
      };

  /// One menu page: the package line on the first, a field per course the
  /// package includes, and the add-ons on the last.
  List<Widget> _menuStepFields(int step) {
    final pages = _coursePages;
    final index = step - _fixedSteps.length;
    final courses = (index >= 0 && index < pages.length)
        ? pages[index]
        : const <PackageCourse>[];
    final isLast = index >= pages.length - 1;
    return [
      if (index == 0)
        _field(
          'package',
          hint: 'Choose from our Packages tab, or describe one',
          icon: Icons.local_dining_outlined,
          inputFormatters: [LengthLimitingTextInputFormatter(120)],
        ),
      for (final course in courses) _courseField(course.key),
      if (isLast) ..._addOnsSection(),
    ];
  }

  // ── The set-up step ───────────────────────────────────────────────────────
  /// The set-up gallery as a step: every visible photo the moderator has
  /// published, two to a row, one of them chosen. Like every other answer on
  /// this wizard it's picked, never typed — the field carries the setup's own
  /// title, so the kitchen reads back the exact look it published rather than
  /// a member's description of it.
  List<Widget> _setupStepFields() {
    final chosen = _ctrl('setupStyle').text.trim();
    final error = _errors['setupStyle'];
    return [
      Text(_labelFor('setupStyle'), style: AppTextStyles.label),
      const SizedBox(height: AppSpacing.xs),
      Text(
        chosen.isEmpty
            ? 'Tap a photo to choose the look. We\'ll match it as closely as '
                'your venue allows.'
            : 'Chosen: $chosen. Tap another to change it.',
        style: AppTextStyles.bodySmall,
      ),
      if (error != null) ...[
        const SizedBox(height: AppSpacing.sm),
        Text(
          error,
          style: AppTextStyles.sans(
            size: 12,
            weight: FontWeight.w600,
            color: Theme.of(context).colorScheme.error,
          ),
        ),
      ],
      const SizedBox(height: AppSpacing.md),
      GridView.count(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        crossAxisCount: 2,
        mainAxisSpacing: AppSpacing.md,
        crossAxisSpacing: AppSpacing.md,
        childAspectRatio: 0.82,
        children: [
          for (final setup in _setups)
            _SetupChoiceCard(
              setup: setup,
              selected: chosen.isNotEmpty && setup.title.trim() == chosen,
              onTap: () => _chooseSetup(setup),
              onView: () => showSetupSheet(context, setup),
            ),
        ],
      ),
    ];
  }

  void _chooseSetup(EventSetup setup) {
    setState(() {
      _ctrl('setupStyle').text = setup.title.trim();
      _errors.remove('setupStyle');
    });
  }

  // ── The add-ons section ───────────────────────────────────────────────────
  /// Add-ons are chosen, never typed: the button below opens the category →
  /// dish chooser, and each extra comes back as a card with its own quantity
  /// stepper. Amounts stay off the form — the kitchen quotes each extra when
  /// it confirms the booking.
  List<Widget> _addOnsSection() {
    final catalogue = _addOnsByCategory;
    return [
      Text('Add-ons', style: AppTextStyles.label),
      const SizedBox(height: AppSpacing.xs),
      Text(
        catalogue.isEmpty
            ? 'Our extras list is still loading. You can send your booking '
                'now — we\'ll go through add-ons when we confirm.'
            : _pricing.isEmpty
                ? 'Anything extra you\'d like us to bring, chosen from our '
                    'menu. We\'ll quote each one when we confirm your booking.'
                : 'Anything extra you\'d like us to bring, chosen from our '
                    'menu. Each is priced per head and added to your total.',
        style: AppTextStyles.bodySmall,
      ),
      const SizedBox(height: AppSpacing.md),
      for (final line in _addOns) ...[
        _AddOnLineCard(
          line: line,
          unitPrice: _pricing.priceFor(line.dish),
          onAdd: line.qty < 99 ? () => setState(() => line.qty++) : null,
          onRemove: line.qty > 1 ? () => setState(() => line.qty--) : null,
          onDelete: () => setState(() => _addOns.remove(line)),
        ),
        const SizedBox(height: AppSpacing.sm),
      ],
      if (_addOns.isNotEmpty) ..._addOnsSummary(),
      if (catalogue.isNotEmpty)
        AppButton.secondary(
          label: _addOns.isEmpty ? 'I WANT ADD-ONS' : 'ADD MORE ADD-ONS',
          icon: Icons.add_circle_outline,
          fullWidth: true,
          onPressed: () => _pickAddOns(catalogue),
        ),
    ];
  }

  /// What the chosen extras come to, under the list of them. Written to stay
  /// honest in every partial state the wizard can be in: before a headcount is
  /// entered it can only quote a per-head figure, and any extra the moderator
  /// hasn't priced is named as one the team will quote rather than folded
  /// silently into the total.
  List<Widget> _addOnsSummary() {
    final chosen =
        '${_addOns.length} add-on${_addOns.length == 1 ? '' : 's'} chosen.';
    final perHead = _addOnsPerHead;
    final unpriced = _unpricedAddOns;

    final lines = <String>[chosen];
    if (perHead > 0) {
      lines.add(_pax > 0
          ? '${peso(perHead)} per head × $_pax pax  =  ${peso(_addOnsTotal)}'
          : '${peso(perHead)} per head — enter your headcount to see the total.');
    }
    if (_addOnsSavingsTotal > 0) {
      lines.add('Promo discount savings: -${peso(_addOnsSavingsTotal)}');
    }
    if (unpriced.isNotEmpty) {
      lines.add(unpriced.length == _addOns.length
          ? 'We\'ll quote these when we confirm your booking.'
          : '${unpriced.length} of these (${unpriced.map((l) => l.dish.name).join(', ')}) '
              'we\'ll quote when we confirm.');
    }

    return [
      Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.cream,
            borderRadius: AppRadius.mdAll,
            border: Border.all(color: AppColors.hairline),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (var i = 0; i < lines.length; i++) ...[
                if (i > 0) const SizedBox(height: 4),
                Text(
                  lines[i],
                  style: i == 1 && perHead > 0
                      ? AppTextStyles.sans(
                          size: 13,
                          weight: FontWeight.w700,
                          color: AppColors.goldDeep,
                        )
                      : AppTextStyles.bodySmall,
                ),
              ],
            ],
          ),
        ),
      ),
    ];
  }

  /// The add-on catalogue, grouped by the moderator's menu categories and
  /// alphabetised; dishes with no category gather under "More dishes".
  Map<String, List<Product>> get _addOnsByCategory {
    final wantType = (widget.package?.isFoodPack ?? false)
        ? 'Food Packs'
        : 'Catering Food Trays';
    final inFamily = _products.where((p) => p.type == wantType).toList();
    final catalogue = inFamily.isNotEmpty ? inFamily : _products;

    final grouped = <String, List<Product>>{};
    for (final dish in catalogue) {
      final category =
          dish.category.trim().isEmpty ? 'More dishes' : dish.category.trim();
      grouped.putIfAbsent(category, () => []).add(dish);
    }
    final names = grouped.keys.toList()
      ..sort((a, b) {
        // "More dishes" is a catch-all, so it sits last rather than under M.
        if (a == 'More dishes') return 1;
        if (b == 'More dishes') return -1;
        return a.toLowerCase().compareTo(b.toLowerCase());
      });
    return {for (final name in names) name: grouped[name]!};
  }

  /// What a category costs per head, for its row in the chooser: one figure
  /// when its dishes all charge the same, a range when some are priced apart
  /// from it. Null when nothing in it is priced — the row then says only how
  /// many dishes it holds, as it did before add-ons carried prices.
  String? _categoryPriceLabel(List<Product> dishes) {
    final rates = [
      for (final d in dishes)
        if (_pricing.priceFor(d) case final num r) r,
    ];
    if (rates.isEmpty) return null;
    final lo = rates.reduce(min), hi = rates.reduce(max);
    return lo == hi
        ? '${peso(lo)} per head'
        : '${peso(lo)}–${peso(hi)} per head';
  }

  /// The add-on chooser: one dialog with two faces. It opens on the list of
  /// menu categories; tapping one shows that category's available dishes,
  /// where tapping adds or removes an extra. A back row returns to the
  /// categories, and DONE closes.
  Future<void> _pickAddOns(Map<String, List<Product>> byCategory) {
    String? open; // the category being browsed; null → the category list
    return showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          final dishes = open == null ? const <Product>[] : byCategory[open]!;
          bool isChosen(Product d) => _addOns.any((l) => l.dish.id == d.id);
          // How many of a category's dishes are already on the list — shown on
          // the category row so choices stay visible one level up.
          int chosenIn(List<Product> list) => list.where(isChosen).length;

          return AppDialogShell(
            footer: AppButton.primary(
              label: _addOns.isEmpty
                  ? 'DONE'
                  : 'DONE · ${_addOns.length} '
                      'ADD-ON${_addOns.length == 1 ? '' : 'S'}',
              fullWidth: true,
              onPressed: () => Navigator.of(dialogContext).pop(),
            ),
            children: [
              Text(
                open == null
                    ? 'ADD-ONS · CATEGORIES'
                    : 'ADD-ONS · ${open!.toUpperCase()}',
                style: AppTextStyles.eyebrow,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                open == null ? 'What kind of add-on?' : open!,
                style: AppTextStyles.title,
              ),
              const SizedBox(height: AppSpacing.xs),
              Text(
                open == null
                    ? 'Pick a category to see the dishes available in it. '
                        'Add-ons are priced per head.'
                    : 'Tap to add or remove — you\'ll set how many after.',
                style: AppTextStyles.bodySmall,
              ),
              const SizedBox(height: AppSpacing.lg),
              if (open == null)
                for (final entry in byCategory.entries) ...[
                  _CategoryChoiceRow(
                    name: entry.key,
                    dishCount: entry.value.length,
                    chosenCount: chosenIn(entry.value),
                    priceLabel: _categoryPriceLabel(entry.value),
                    onTap: () => setDialogState(() => open = entry.key),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ]
              else ...[
                _DialogBackRow(
                  label: 'ALL CATEGORIES',
                  onTap: () => setDialogState(() => open = null),
                ),
                const SizedBox(height: AppSpacing.md),
                for (final dish in dishes) ...[
                  _AddOnToggleRow(
                    dish: dish,
                    unitPrice: _pricing.priceFor(dish),
                    selected: isChosen(dish),
                    onTap: () {
                      // Update the page behind the dialog (the quantity
                      // steppers) and the dialog's own check marks together.
                      setState(() {
                        final i =
                            _addOns.indexWhere((l) => l.dish.id == dish.id);
                        if (i >= 0) {
                          _addOns.removeAt(i);
                        } else {
                          _addOns.add(_AddOnLine(dish));
                        }
                      });
                      setDialogState(() {});
                    },
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
    String key, {
    String? hint,
    IconData? icon,
    TextInputType? keyboardType,
    List<TextInputFormatter>? inputFormatters,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: AppTextField(
        label: _labelFor(key),
        hint: hint,
        controller: _ctrl(key),
        prefixIcon: icon,
        keyboardType: keyboardType,
        inputFormatters: inputFormatters,
        errorText: _errors[key],
        onChanged: (_) {
          if (_errors.containsKey(key)) setState(() => _errors.remove(key));
        },
      ),
    );
  }

  /// Read-only field whose value comes from a picker (date, time, occasion,
  /// dish). [note] adds a quiet line under the field for anything the member
  /// should know before tapping it.
  Widget _pickerField(
    String key, {
    String? hint,
    IconData? icon,
    String? note,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppTextField(
            label: _labelFor(key),
            hint: hint,
            controller: _ctrl(key),
            prefixIcon: icon,
            readOnly: true,
            onTap: onTap,
            errorText: _errors[key],
            suffixIcon: const Icon(Icons.expand_more, size: 20),
          ),
          if (note != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(note, style: AppTextStyles.bodySmall),
          ],
        ],
      ),
    );
  }

  /// A tap-to-pick time field. All five are required — see [_required] — and
  /// they're checked against each other in [_timeErrors].
  Widget _timeField(String key) => _pickerField(
        key,
        hint: 'Pick time',
        icon: Icons.schedule_outlined,
        onTap: () => _pickTime(key),
      );

  /// A course field (Soup, Beef, …). When the live menu has dishes in that
  /// course, tapping opens a picker listing all of them; when it doesn't
  /// (menu still loading, or nothing published), it stays a plain free-text
  /// blank like the paper form. Either way a dish is required.
  Widget _courseField(String key) {
    final dishes = _dishesFor(key);
    if (dishes.isEmpty) {
      return _field(
        key,
        hint: 'Name the dish',
        inputFormatters: [LengthLimitingTextInputFormatter(120)],
      );
    }
    return _pickerField(
      key,
      hint: 'Choose from ${dishes.length} dish${dishes.length == 1 ? '' : 'es'}',
      icon: Icons.restaurant_outlined,
      onTap: () => _pickDish(key, dishes),
    );
  }

  /// Every available dish for a course, in the app's centered quick-look
  /// dialog — tap one to fill the field. There's no clearing it: the course is
  /// required, so the only move from here is a different dish.
  Future<void> _pickDish(String key, List<Product> dishes) {
    final ctrl = _ctrl(key);
    final label = _labelFor(key);
    return showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => AppDialogShell(
        children: [
          Text('THE MENU · ${label.toUpperCase()}', style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.sm),
          Text('Choose your ${label.toLowerCase()}', style: AppTextStyles.title),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${dishes.length} dish${dishes.length == 1 ? '' : 'es'} available '
            'from our menu.',
            style: AppTextStyles.bodySmall,
          ),
          const SizedBox(height: AppSpacing.lg),
          for (final dish in dishes) ...[
            _DishChoiceRow(
              dish: dish,
              selected: ctrl.text.trim() == dish.name,
              onTap: () {
                Navigator.of(dialogContext).pop();
                setState(() {
                  ctrl.text = dish.name;
                  _errors.remove(key);
                });
              },
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
        ],
      ),
    );
  }

  // ── Thank-you state ───────────────────────────────────────────────────────
  /// The thank-you state, which reads back the outcome the booking actually
  /// reached: settled, waiting on its downpayment, or filed for the team to
  /// quote. An order still owing its downpayment says so plainly and keeps the
  /// payment one tap away — it's the one case where the member has something
  /// left to do.
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
                  ? 'Your booking is waiting.'
                  : _paid
                      ? 'Your date is held.'
                      : 'Your booking is in.',
              textAlign: TextAlign.center,
              style: AppTextStyles.displaySmall,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              owing
                  ? 'Everything you filled in is filed under No. '
                      '${Booking.referenceFor(_bookingId ?? '')}. We hold the '
                      'date once the downpayment lands — finish it below, or '
                      'any time from Order Tracking in Settings.'
                  : _paid
                      ? 'Your downpayment is in and your order is with the '
                          'team. We\'ll reach out on your contact number to '
                          'confirm the details and finalise the feast.'
                      : 'We\'ll review the details and reach out on your '
                          'contact number with a quotation, then confirm the '
                          'date and finalise the feast.',
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

/// One complaint inside the error popup — the blank's name over the message
/// that field's own mark carries, behind a quiet warning rule.
class _ProblemRow extends StatelessWidget {
  const _ProblemRow({required this.label, required this.message});

  final String label;
  final String message;

  @override
  Widget build(BuildContext context) {
    final error = Theme.of(context).colorScheme.error;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: error.withValues(alpha: 0.06),
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: error.withValues(alpha: 0.28)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.error_outline_rounded, size: 18, color: error),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
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

/// One extra on the booking — a menu dish plus how many of it, mutable via the
/// card's stepper. Only the add-on picker can create these, which is what keeps
/// typed-in add-ons off the form.
class _AddOnLine {
  _AddOnLine(this.dish);

  final Product dish;

  /// One of the dish unless the member steps it up.
  int qty = 1;
}

/// A chosen add-on on the To Finish step: photo, name, its menu category, a
/// −/+ quantity stepper, and a quiet remove control.
class _AddOnLineCard extends StatelessWidget {
  const _AddOnLineCard({
    required this.line,
    required this.unitPrice,
    required this.onAdd,
    required this.onRemove,
    required this.onDelete,
  });

  final _AddOnLine line;

  /// What one head of this dish costs, or null when neither it nor its
  /// category has been priced — then the card says the team will quote it.
  final num? unitPrice;

  /// Null at the 99 ceiling / the 1 floor, which dims the matching button.
  final VoidCallback? onAdd;
  final VoidCallback? onRemove;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final category = line.dish.category.trim();
    final rate = unitPrice;
    final disc = rate != null ? PromoDiscountService.instance.getDishDiscount(line.dish, rate) : null;
    final effectiveRate = disc != null ? disc.discountedPrice : rate;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: disc != null ? AppColors.gold : AppColors.hairline),
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
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        line.dish.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                      ),
                    ),
                    if (disc != null) ...[
                      const SizedBox(width: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                        decoration: BoxDecoration(
                          color: AppColors.gold.withValues(alpha: 0.2),
                          borderRadius: AppRadius.pillAll,
                          border: Border.all(color: AppColors.goldDeep.withValues(alpha: 0.5)),
                        ),
                        child: Text(
                          disc.badgeLabel,
                          style: AppTextStyles.sans(
                            size: 8.5,
                            weight: FontWeight.w700,
                            color: AppColors.goldDeep,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
                if (category.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(category.toUpperCase(), style: AppTextStyles.eyebrow),
                ],
                const SizedBox(height: 2),
                Row(
                  children: [
                    if (disc != null && rate != null) ...[
                      Text(
                        peso(rate),
                        style: AppTextStyles.sans(
                          size: 10,
                          color: AppColors.brownSoft,
                        ).copyWith(decoration: TextDecoration.lineThrough),
                      ),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      effectiveRate == null
                          ? 'We\'ll quote this one'
                          : '${peso(effectiveRate)} per head'
                              '${line.qty > 1 ? ' × ${line.qty} = ${peso(effectiveRate * line.qty)} per head' : ''}',
                      style: AppTextStyles.sans(
                        size: 11,
                        weight: FontWeight.w600,
                        color: effectiveRate == null
                            ? AppColors.brown.withValues(alpha: 0.6)
                            : AppColors.gold,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    _StepButton(icon: Icons.remove_rounded, onTap: onRemove),
                    SizedBox(
                      width: 56,
                      child: Text(
                        '× ${line.qty}',
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
            tooltip: 'Remove add-on',
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

/// One tap of the quantity stepper — a small circled −/+ that dims when it has
/// nowhere left to go.
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

/// The first face of the add-on chooser — one row per menu category, with how
/// many dishes it holds and how many are already on the booking.
class _CategoryChoiceRow extends StatelessWidget {
  const _CategoryChoiceRow({
    required this.name,
    required this.dishCount,
    required this.chosenCount,
    required this.onTap,
    this.priceLabel,
  });

  final String name;
  final int dishCount;
  final int chosenCount;
  final VoidCallback onTap;

  /// What this category's dishes cost per head ("₱150 per head", or a range
  /// when dishes inside it are priced apart from it). Null when nothing in it
  /// is priced, which leaves the row exactly as it was before add-ons carried
  /// prices.
  final String? priceLabel;

  @override
  Widget build(BuildContext context) {
    final chosen = chosenCount > 0;
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: chosen
              ? AppColors.gold.withValues(alpha: 0.10)
              : AppColors.surface,
          borderRadius: AppRadius.mdAll,
          border: Border.all(
            color: chosen ? AppColors.gold : AppColors.hairline,
          ),
        ),
        child: Row(
          children: [
            Icon(
              Icons.restaurant_menu_rounded,
              size: 20,
              color: chosen ? AppColors.goldDeep : AppColors.brownSoft,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    chosen
                        ? '$dishCount dish${dishCount == 1 ? '' : 'es'} · '
                            '$chosenCount chosen'
                        : '$dishCount dish${dishCount == 1 ? '' : 'es'}',
                    style: AppTextStyles.bodySmall,
                  ),
                  if (priceLabel != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      priceLabel!,
                      style: AppTextStyles.sans(
                        size: 11,
                        weight: FontWeight.w600,
                        color: AppColors.gold,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: AppColors.brown.withValues(alpha: 0.4),
            ),
          ],
        ),
      ),
    );
  }
}

/// The quiet "◂ ALL CATEGORIES" / "◂ ALL OCCASIONS" row at the top of a popup's
/// second face, so a chooser can be walked back up a level without closing.
class _DialogBackRow extends StatelessWidget {
  const _DialogBackRow({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: AppRadius.pillAll,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.chevron_left_rounded,
              size: 18,
              color: AppColors.brownSoft,
            ),
            const SizedBox(width: 2),
            Text(
              label,
              style: AppTextStyles.engraved(
                size: 9,
                color: AppColors.brownSoft,
                spacing: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One dish inside a category of the add-on chooser — tapping toggles it onto
/// the booking, which lights the row gold.
class _AddOnToggleRow extends StatelessWidget {
  const _AddOnToggleRow({
    required this.dish,
    required this.unitPrice,
    required this.selected,
    required this.onTap,
  });

  final Product dish;

  /// The dish's per-head rate, or null when it hasn't been priced.
  final num? unitPrice;

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
            GestureDetector(
              onTap: () => showProductImageViewer(context, dish),
              child: ClipRRect(
                borderRadius: AppRadius.xsAll,
                child: SizedBox(width: 44, height: 44, child: ProductImage(dish)),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    dish.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style:
                        AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    unitPrice == null
                        ? 'Priced on confirmation'
                        : '${peso(unitPrice!)} per head',
                    style: AppTextStyles.sans(
                      size: 11,
                      weight: FontWeight.w600,
                      color: unitPrice == null
                          ? AppColors.brown.withValues(alpha: 0.6)
                          : AppColors.gold,
                    ),
                  ),
                ],
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

/// One occasion in the "Kind of Function" popup — the celebration's name and a
/// check that lights gold on the current choice. The last row is "Other", which
/// carries a subtitle and a pencil instead and opens the typing face.
class _OccasionRow extends StatelessWidget {
  const _OccasionRow({
    required this.name,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.icon = Icons.celebration_outlined,
  });

  final String name;
  final String? subtitle;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: const EdgeInsets.all(AppSpacing.md),
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
            Icon(
              icon,
              size: 20,
              color: selected ? AppColors.goldDeep : AppColors.brownSoft,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        AppTextStyles.sans(size: 13, weight: FontWeight.w600),
                  ),
                  if (subtitle != null) ...[
                    const SizedBox(height: 2),
                    Text(subtitle!, style: AppTextStyles.bodySmall),
                  ],
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Icon(
              selected
                  ? Icons.check_circle_rounded
                  : Icons.radio_button_unchecked,
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

/// One dish inside the course picker — photo thumbnail, name, and a check
/// that lights gold on the current choice.
class _DishChoiceRow extends StatelessWidget {
  const _DishChoiceRow({
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
            GestureDetector(
              onTap: () => showProductImageViewer(context, dish),
              child: ClipRRect(
                borderRadius: AppRadius.xsAll,
                child: SizedBox(width: 44, height: 44, child: ProductImage(dish)),
              ),
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
                  : Icons.radio_button_unchecked,
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

/// One event setup on the set-up step — its photo under a gold frame when it's
/// the chosen look, its title underneath, and a magnifier that opens the photo
/// full-size without changing the choice.
class _SetupChoiceCard extends StatelessWidget {
  const _SetupChoiceCard({
    required this.setup,
    required this.selected,
    required this.onTap,
    required this.onView,
  });

  final EventSetup setup;
  final bool selected;
  final VoidCallback onTap;

  /// Opens the setup's own lightbox sheet. Its own tap target sits on top of
  /// the card, so looking closer never picks the setup by accident.
  final VoidCallback onView;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.gold.withValues(alpha: 0.14)
              : AppColors.surface,
          borderRadius: AppRadius.mdAll,
          border: Border.all(
            color: selected ? AppColors.gold : AppColors.hairline,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: AppRadius.xsAll,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    SetupImage(setup),
                    Positioned(
                      top: 6,
                      right: 6,
                      child: GestureDetector(
                        onTap: onView,
                        child: Container(
                          padding: const EdgeInsets.all(5),
                          decoration: BoxDecoration(
                            color: AppColors.espresso.withValues(alpha: 0.55),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.zoom_in_rounded,
                            size: 16,
                            color: AppColors.cream,
                          ),
                        ),
                      ),
                    ),
                    if (selected)
                      const Positioned(
                        top: 6,
                        left: 6,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: AppColors.gold,
                            shape: BoxShape.circle,
                          ),
                          child: Padding(
                            padding: EdgeInsets.all(4),
                            child: Icon(
                              Icons.check_rounded,
                              size: 14,
                              color: AppColors.espresso,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 6, 4, 2),
              child: Text(
                setup.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.sans(
                  size: 12,
                  weight: FontWeight.w600,
                  color: selected ? AppColors.goldDeep : AppColors.brown,
                ),
              ),
            ),
          ],
        ),
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

/// "June 12, 2026" — spelled-out date for the booking form.
String _formatDate(DateTime d) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return '${months[d.month - 1]} ${d.day}, ${d.year}';
}
