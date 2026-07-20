import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/booking_repository.dart';
import '../../data/catering.dart';
import '../../data/customer_repository.dart';
import '../../data/product.dart';
import '../../data/product_repository.dart';
import '../../widgets.dart';

/// "Book Us Now" — a wizard that walks the member through the business's
/// paper booking form in short pages of at most four questions each:
///
///   1. The Occasion — kind of function, date, venue, pax        (required)
///   2. The Client   — name, contact number, address             (required*)
///   3. The Set-up   — ingress / egress times
///   4. The Program  — start, food serving, end of program
///   5. The Package  — package choice, soup, appetizer, salad
///   6. The Mains    — rice, pasta/noodles, beef, pork
///   7. The Mains II — chicken, seafoods, vegetables
///   8. To Finish    — desserts, drinks, add-ons
///
/// (*address optional.) Everything from step 3 on mirrors the blanks on the
/// paper form, and the team fills gaps with the client during confirmation.
/// Submitting files a `pending` document in `bookings` via
/// [BookingRepository], then settles into a thank-you state.
///
/// This is the *catering* flow; food pack packages book through the
/// quotation-shaped [FoodPackBookingPage] instead.
class BookingPage extends StatefulWidget {
  const BookingPage({super.key, this.package});

  /// When launched from a package's detail sheet, that package prefills the
  /// "Type/Price of Package" field on the menu step.
  final CateringPackage? package;

  @override
  State<BookingPage> createState() => _BookingPageState();
}

class _BookingPageState extends State<BookingPage> {
  /// Step eyebrow + serif title + quiet helper line.
  static const List<(String, String, String)> _steps = [
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
          'Optional — skip what you\'re still deciding.',
    ),
    (
      'THE PROGRAM',
      'How the day flows',
      'All optional — leave blank anything you\'re still deciding.',
    ),
    (
      'THE PACKAGE',
      'Your package & starters',
      'Your chosen package, and how the meal opens. All optional.',
    ),
    (
      'THE MAINS',
      'The heart of the feast',
      'Name a dish per course, or leave blanks and we\'ll suggest a spread.',
    ),
    (
      'THE MAINS, CONT.',
      'More of the feast',
      'A few more courses — again, only fill what you\'ve decided.',
    ),
    (
      'TO FINISH',
      'Sweet endings',
      'Desserts, drinks, and anything extra you\'d like us to bring.',
    ),
  ];

  /// Required fields, per step; steps not listed are entirely optional.
  static const Map<int, List<String>> _requiredByStep = {
    0: ['kindOfFunction', 'functionDate', 'venue', 'pax'],
    1: ['clientName', 'contactNumber'],
  };

  int _step = 0;
  bool _submitting = false;
  bool _submitted = false;

  final Map<String, TextEditingController> _fields = {};
  final Map<String, String> _errors = {};

  /// The live menu, so each course field can offer the actual dishes the
  /// moderator has published rather than a blank line.
  StreamSubscription<List<Product>>? _productSub;
  List<Product> _products = const [];

  /// Wizard course key → the menu category names (lowercased) whose dishes it
  /// offers. Mirrors the Content Moderator's category taxonomy, with plural /
  /// legacy spellings included so a renamed category doesn't orphan dishes.
  static const Map<String, List<String>> _courseCategories = {
    'soup': ['soup', 'soups'],
    'appetizer': ['appetizer', 'appetizers'],
    'salad': ['salad', 'salads'],
    'rice': ['rice'],
    'pastaNoodles': ['pasta', 'noodles'],
    'beef': ['beef'],
    'pork': ['pork'],
    'chicken': ['chicken'],
    'seafood': ['seafood', 'seafoods', 'fish'],
    'vegetables': ['vegetables', 'vegetable'],
    'desserts': ['dessert', 'desserts'],
    'drinks': ['drinks', 'drink', 'beverages'],
  };

  TextEditingController _ctrl(String key) =>
      _fields.putIfAbsent(key, () => TextEditingController());

  @override
  void initState() {
    super.initState();
    // Prefill everything we already know. From the member's account: their
    // name (and, once the profile loads, their phone number). From the booked
    // package: its name/price and its minimum pax as the starting headcount.
    final name = (CustomerRepository().displayName ?? '').trim();
    if (name.isNotEmpty) _ctrl('clientName').text = name;
    final pkg = widget.package;
    if (pkg != null) {
      final unit = pkg.isFoodPack ? 'per pack' : 'per head';
      _ctrl('package').text = pkg.price > 0
          ? '${pkg.name} — ${_peso(pkg.price)} $unit'
          : pkg.name;
      if (pkg.minPax > 0) _ctrl('pax').text = '${pkg.minPax}';
    }
    // The phone number lives on the Firestore profile, so it arrives async —
    // fill only fields the member hasn't typed into meanwhile.
    CustomerRepository().fetchCurrentCustomer().then((customer) {
      if (!mounted || customer == null) return;
      setState(() {
        _fillIfEmpty('clientName', customer.name);
        _fillIfEmpty('contactNumber', customer.phone);
      });
    }).catchError((_) {
      // Offline / rules hiccup — the member just types it in themselves.
    });
    // The live menu feeds the course pickers (shared app-wide listener, so
    // this doesn't re-download anything the Menu tab already has).
    _productSub = ProductRepository().watchVisible().listen(
      (data) {
        if (mounted) setState(() => _products = data);
      },
      onError: (_) {}, // pickers quietly fall back to free-text fields
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

  /// All available dishes for a course, drawn from the booked package's
  /// family first (food packs offer Food Packs dishes, everything else the
  /// Catering Food Trays) and falling back to the whole menu so the picker is
  /// never needlessly empty.
  List<Product> _dishesFor(String key) {
    final cats = _courseCategories[key];
    if (cats == null) return const [];
    bool inCourse(Product p) => cats.contains(p.category.trim().toLowerCase());
    final wantType = (widget.package?.isFoodPack ?? false)
        ? 'Food Packs'
        : 'Catering Food Trays';
    final inFamily = _products
        .where((p) => p.type == wantType && inCourse(p))
        .toList();
    if (inFamily.isNotEmpty) return inFamily;
    return _products.where(inCourse).toList();
  }

  // ── Pickers ───────────────────────────────────────────────────────────────
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

  Future<void> _pickTime(String key) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 10, minute: 0),
    );
    if (picked == null || !mounted) return;
    setState(() => _ctrl(key).text = picked.format(context));
  }

  // ── Flow ──────────────────────────────────────────────────────────────────
  void _next() {
    final missing = [
      for (final k in _requiredByStep[_step] ?? const <String>[])
        if (_ctrl(k).text.trim().isEmpty) k,
    ];
    if (missing.isNotEmpty) {
      setState(() {
        for (final k in missing) {
          _errors[k] = 'Please fill this in';
        }
      });
      return;
    }
    if (_step < _steps.length - 1) {
      setState(() => _step++);
    } else {
      _submit();
    }
  }

  void _back() {
    if (_step > 0) setState(() => _step--);
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await BookingRepository().submit({
        for (final e in _fields.entries) e.key: e.value.text,
        // Distinguishes this flow's documents from the food pack wizard's
        // (`bookingType: 'Food Pack'`) in the shared `bookings` collection.
        'bookingType': 'Catering',
      });
      if (!mounted) return;
      setState(() {
        _submitted = true;
        _submitting = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _submitting = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Couldn\'t send your booking — please try again.'),
        ),
      );
    }
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
            // Hapag Serbisyo is offered strictly to churches, government and
            // schools — booking it locks the function kind to those three.
            if (widget.package?.isInstitutional ?? false)
              _kindOfFunctionChoices()
            else
              _field(
                'kindOfFunction',
                'Kind of Function',
                hint: 'Wedding, birthday, christening…',
                icon: Icons.celebration_outlined,
              ),
            _pickerField(
              'functionDate',
              'Date of Function',
              hint: 'Pick a date',
              icon: Icons.event_outlined,
              onTap: _pickDate,
            ),
            _field(
              'venue',
              'Venue of the Function',
              icon: Icons.place_outlined,
            ),
            _field(
              'pax',
              'No. of Pax',
              hint: 'e.g. 150',
              icon: Icons.groups_outlined,
              keyboardType: TextInputType.number,
            ),
          ],
        1 => [
            _field(
              'clientName',
              'Client\'s Name',
              icon: Icons.person_outline,
            ),
            _field(
              'contactNumber',
              'Contact Number',
              hint: '09xx xxx xxxx',
              icon: Icons.phone_outlined,
              keyboardType: TextInputType.phone,
            ),
            _field(
              'address',
              'Address',
              icon: Icons.home_outlined,
            ),
          ],
        2 => [
            _timeField('ingress', 'Time of Ingress'),
            _timeField('egress', 'Time of Egress'),
          ],
        3 => [
            _timeField('functionStart', 'Start of Function'),
            _timeField('foodServing', 'Time of Food Serving'),
            _timeField('programEnd', 'End of Program'),
          ],
        4 => [
            _field(
              'package',
              'Type/Price of Package',
              hint: 'Choose from our Packages tab, or describe one',
              icon: Icons.local_dining_outlined,
            ),
            _courseField('soup', 'Soup'),
            _courseField('appetizer', 'Appetizer'),
            _courseField('salad', 'Salad'),
          ],
        5 => [
            _courseField('rice', 'Rice'),
            _courseField('pastaNoodles', 'Pasta/Noodles'),
            _courseField('beef', 'Beef'),
            _courseField('pork', 'Pork'),
          ],
        6 => [
            _courseField('chicken', 'Chicken'),
            _courseField('seafood', 'Seafoods'),
            _courseField('vegetables', 'Vegetables'),
          ],
        _ => [
            _courseField('desserts', 'Desserts'),
            _courseField('drinks', 'Drinks'),
            _field(
              'menuAddOns',
              'Add ons/Amount',
              hint: 'e.g. Lechon belly — ₱6,500',
              icon: Icons.add_circle_outline,
            ),
          ],
      };

  // ── Field builders ────────────────────────────────────────────────────────
  /// The three functions Hapag Serbisyo may be booked for, as tap-to-pick
  /// pills in place of the free-text "Kind of Function" field.
  Widget _kindOfFunctionChoices() {
    const options = [
      'Church Function',
      'Government Function',
      'School Function',
    ];
    final current = _ctrl('kindOfFunction').text;
    final error = _errors['kindOfFunction'];

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Kind of Function', style: AppTextStyles.label),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              for (final option in options)
                GestureDetector(
                  onTap: () => setState(() {
                    _ctrl('kindOfFunction').text = option;
                    _errors.remove('kindOfFunction');
                  }),
                  child: AnimatedContainer(
                    duration: Motion.quick,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.lg,
                      vertical: 10,
                    ),
                    decoration: BoxDecoration(
                      color: current == option
                          ? AppColors.brown
                          : AppColors.surface,
                      borderRadius: AppRadius.pillAll,
                      border: Border.all(
                        color: current == option
                            ? AppColors.brown
                            : AppColors.hairline,
                      ),
                    ),
                    child: Text(
                      option,
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w600,
                        color: current == option
                            ? AppColors.onBrown
                            : AppColors.brownSoft,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (error != null) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              error,
              style: AppTextStyles.sans(
                size: 11,
                color: Theme.of(context).colorScheme.error,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Hapag Serbisyo is offered strictly for church, government and '
            'school functions.',
            style: AppTextStyles.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _field(
    String key,
    String label, {
    String? hint,
    IconData? icon,
    TextInputType? keyboardType,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: AppTextField(
        label: label,
        hint: hint,
        controller: _ctrl(key),
        prefixIcon: icon,
        keyboardType: keyboardType,
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

  /// A course field (Soup, Beef, …). When the live menu has dishes in that
  /// course, tapping opens a picker listing all of them; when it doesn't
  /// (menu still loading, or nothing published), it stays a plain free-text
  /// blank like the paper form.
  Widget _courseField(String key, String label) {
    final dishes = _dishesFor(key);
    if (dishes.isEmpty) return _field(key, label);
    return _pickerField(
      key,
      label,
      hint: 'Choose from ${dishes.length} dish${dishes.length == 1 ? '' : 'es'}',
      icon: Icons.restaurant_outlined,
      onTap: () => _pickDish(key, label, dishes),
    );
  }

  /// Every available dish for a course, in the app's centered quick-look
  /// dialog — tap one to fill the field, or clear the current choice.
  Future<void> _pickDish(String key, String label, List<Product> dishes) {
    final ctrl = _ctrl(key);
    return showCenterDialog<void>(
      context: context,
      builder: (dialogContext) => AppDialogShell(
        footer: ctrl.text.trim().isEmpty
            ? null
            : AppButton.secondary(
                label: 'CLEAR CHOICE',
                fullWidth: true,
                onPressed: () {
                  Navigator.of(dialogContext).pop();
                  setState(ctrl.clear);
                },
              ),
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
  Widget _buildThanks() {
    return Center(
      child: Padding(
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
              child: const Icon(Icons.check, size: 38, color: AppColors.gold),
            ),
            const SizedBox(height: AppSpacing.xl),
            Text('MARAMING SALAMAT', style: AppTextStyles.eyebrow),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Your booking is in.',
              textAlign: TextAlign.center,
              style: AppTextStyles.displaySmall,
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              'We\'ll review the details and reach out on your contact '
              'number to confirm the date and finalise the feast.',
              textAlign: TextAlign.center,
              style: AppTextStyles.body,
            ),
            const SizedBox(height: AppSpacing.xxl),
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

/// Formats a peso amount with thousands separators, e.g. 1500 → "₱1,500".
String _peso(num value) {
  final digits = value.round().abs().toString();
  final buf = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buf.write(',');
    buf.write(digits[i]);
  }
  return '₱$buf';
}

/// "June 12, 2026" — spelled-out date for the booking form.
String _formatDate(DateTime d) {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return '${months[d.month - 1]} ${d.day}, ${d.year}';
}
