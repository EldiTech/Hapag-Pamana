/// Gabay's reasoning layer — the part that turns a free-form message into one
/// grounded, personal answer.
///
/// The pipeline is deliberately small and inspectable, because a capstone
/// assistant has to be explainable:
///
///   1. **Understand** — [GabayIntent] and slots (headcount, budget, date,
///      occasion, dish) are read out of the message, in English or Tagalog.
///   2. **Retrieve** — the corpus ([GabayCorpus]) supplies the business's own
///      facts: the live packages and menu, the written policies, and the sales
///      history Gabay was trained on.
///   3. **Personalise** — [GabayUserModel] adds what this member has actually
///      done: their usual headcount, spend per head, favourite dishes, upcoming
///      event, and the Settings they set.
///   4. **Compose** — a reply that names its source and never invents a price,
///      a dish, or a promise the kitchen hasn't made.
///
/// Slots persist across turns, so "recommend a package for 50 pax" followed by
/// "budget is 20,000" is one conversation rather than two disconnected queries.
library;

import 'catering.dart';
import 'gabay_corpus.dart';
import 'gabay_sales_insights.dart';
import 'gabay_user_model.dart';
import 'member_preferences.dart';
import 'product.dart';
import 'recommendation.dart';

/// What the member is asking for.
enum GabayIntent {
  greeting,
  thanks,
  packageMatch,
  packageInfo,
  dishInfo,
  healthier,
  checklist,
  planning,
  booking,
  payment,
  status,
  cancellation,
  allergens,
  account,
  contact,
  delivery,
  whyRecommended,
  seasonal,
  myOrders,
  about,
  unknown,
}

/// The facts a conversation accumulates.
///
/// Everything is nullable because a member may ask about a package without ever
/// naming a budget — and the reply must then ask for it rather than assume one.
class GabaySlots {
  GabaySlots({
    this.pax,
    this.budgetTotal,
    this.perHead,
    this.eventDate,
    this.occasion,
    this.dish,
    this.packageName,
    this.avoidAllergens = const <String>{},
  });

  /// Headcount, when the member has named one.
  int? pax;

  /// Total event budget in pesos, when named.
  double? budgetTotal;

  /// Budget per head in pesos, when named (or derived from [budgetTotal] and
  /// [pax]).
  double? perHead;

  DateTime? eventDate;

  String? occasion;

  /// The dish the current question is about.
  String? dish;

  /// The package the current question is about.
  String? packageName;

  /// Allergens the member mentioned in the conversation, on top of the ones in
  /// Settings.
  Set<String> avoidAllergens;

  /// The per-head figure to filter packages on, deriving it from a total budget
  /// and a headcount when only those two are known.
  double? get effectivePerHead {
    if (perHead != null) return perHead;
    if (budgetTotal != null && pax != null && pax! > 0) {
      return budgetTotal! / pax!;
    }
    return null;
  }
}

/// One assistant: the corpus it reads, the catalogue it filters, and the member
/// it is speaking to.
class GabayBrain {
  GabayBrain({
    required this.corpus,
    required this.packages,
    required this.menu,
    required this.user,
    required this.prefs,
    required this.recs,
    GabaySlots? slots,
  }) : slots = slots ?? GabaySlots() {
    _activePackages = packages.where((p) => p.active).toList();
    _visibleMenu = menu.where((p) => p.available).toList();
  }

  final GabayCorpus corpus;
  final List<CateringPackage> packages;
  final List<Product> menu;
  final GabayUserModel user;
  final MemberPreferences prefs;
  final RecommendationSet recs;
  final GabaySlots slots;

  late final List<CateringPackage> _activePackages;
  late final List<Product> _visibleMenu;

  GabayIntent? _pending;

  /// Every allergen the member wants kept away from: Settings plus whatever
  /// they said in the conversation.
  Set<String> get _avoided => {...prefs.avoidAllergens, ...slots.avoidAllergens};

  /// Answers [input] as one turn of the conversation.
  ///
  /// Returns the reply text only — the UI keeps the history, so the assistant
  /// stays a pure function of (message, slots, user, catalogue).
  String respond(String input) {
    final text = input.trim();
    if (text.isEmpty) return _fallback(text);

    _readSlots(text);
    final intent = _detectIntent(text);

    // A bare answer ("50", "20,000", "June 12") continues the question Gabay
    // last asked instead of starting a new topic.
    final bare = _isBareAnswer(text);
    final effective = bare && _pending != null ? _pending! : intent;
    if (!bare) _pending = null;

    switch (effective) {
      case GabayIntent.greeting:
        return _greeting();
      case GabayIntent.thanks:
        return _thanks();
      case GabayIntent.packageMatch:
        return _packageMatch();
      case GabayIntent.packageInfo:
        return _packageInfo(text);
      case GabayIntent.healthier:
        return _healthier(text);
      case GabayIntent.dishInfo:
        return _dishInfo(text);
      case GabayIntent.checklist:
        return _checklist();
      case GabayIntent.planning:
        return _planning();
      case GabayIntent.whyRecommended:
        return _whyRecommended();
      case GabayIntent.seasonal:
        return _seasonal();
      case GabayIntent.myOrders:
        return _myOrders();
      case GabayIntent.booking:
        return _policy(GabayTopic.booking, text);
      case GabayIntent.payment:
        return _policy(GabayTopic.payment, text);
      case GabayIntent.status:
        return _policy(GabayTopic.status, text);
      case GabayIntent.cancellation:
        return _policy(GabayTopic.cancellation, text);
      case GabayIntent.allergens:
        return _policy(GabayTopic.allergens, text);
      case GabayIntent.account:
        return _policy(GabayTopic.account, text);
      case GabayIntent.contact:
        return _policy(GabayTopic.contact, text);
      case GabayIntent.delivery:
        return _policy(GabayTopic.delivery, text);
      case GabayIntent.about:
        return _policy(GabayTopic.about, text);
      case GabayIntent.unknown:
        return _fallback(text);
    }
  }

  // ═════════════════════════════ Understanding ═════════════════════════════

  bool _has(String text, List<String> words) {
    final lower = text.toLowerCase();
    for (final word in words) {
      if (RegExp('(^|[^a-z])${RegExp.escape(word)}([^a-z]|\$)').hasMatch(lower)) {
        return true;
      }
    }
    return false;
  }

  GabayIntent _detectIntent(String text) {
    final lower = text.toLowerCase();

    // A named package beats every generic keyword: "how much is the Hapag
    // Fiesta package?" is a package question, not a payment one.
    for (final pkg in _activePackages) {
      if (pkg.name.isNotEmpty && lower.contains(pkg.name.toLowerCase())) {
        slots.packageName = pkg.name;
        return GabayIntent.packageInfo;
      }
    }

    if (_has(lower, ['hi', 'hello', 'hey', 'kumusta', 'kamusta', 'good morning', 'good afternoon', 'good evening']) &&
        lower.split(RegExp(r'\s+')).length <= 5) {
      return GabayIntent.greeting;
    }
    if (_has(lower, ['salamat', 'thanks', 'thank you', 'maraming salamat'])) {
      return GabayIntent.thanks;
    }
    if (_has(lower, ['checklist', 'check list', 'what should i prepare', 'what to prepare', 'preparation list', 'plan my event', 'plan the event', 'planning checklist', 'ano ang kailangan'])) {
      return GabayIntent.checklist;
    }
    if (_has(lower, ['why was this', 'why this', 'why recommend', 'bakit ito', 'bakit ito recommend', 'why did you'])) {
      return GabayIntent.whyRecommended;
    }
    if (_has(lower, ['my orders', 'my order', 'order ko', 'orders ko', 'asan na order', 'status ng order', 'order status', 'track my', 'tracking'])) {
      return GabayIntent.myOrders;
    }
    if (_has(lower, ['busy', 'peak', 'season', 'seasonal', 'when should i book', 'best time to book', 'kailan magandang', 'kailan puno', 'puno ang', 'demand'])) {
      return GabayIntent.seasonal;
    }
    if (_has(lower, ['layout', 'floor plan', 'floorplan', 'venue plan', 'walkway', 'buffet placement', '3d'])) {
      return GabayIntent.planning;
    }
    if (_has(lower, ['healthy', 'healthier', 'lighter', 'nutritious', 'vegetarian', 'vegan', 'diet', 'gulay', 'pampapayat', 'less oil'])) {
      return GabayIntent.healthier;
    }
    if (_has(lower, ['allergy', 'allergen', 'allergies', 'allerhiya', 'alergiya', 'peanut', 'shellfish', 'gluten', 'dairy', 'lactose'])) {
      return GabayIntent.allergens;
    }
    if (_has(lower, ['downpayment', 'down payment', 'deposit', 'payment', 'pay', 'gcash', 'maya', 'xendit', 'bayad', 'magkano ang down'])) {
      if (!_has(lower, ['package', 'packages'])) return GabayIntent.payment;
    }
    if (_has(lower, ['cancel', 'reschedule', 'change my order', 'change order', 'edit my booking', 'kansel', 'palit ng date'])) {
      return GabayIntent.cancellation;
    }
    if (_has(lower, ['forgot password', 'password', 'profile photo', 'my account', 'change my email', 'change my number', 'sign in', 'log in', 'login'])) {
      return GabayIntent.account;
    }
    if (_has(lower, ['contact', 'call you', 'message you', 'talk to someone', 'human', 'staff', 'where are you', 'location', 'address', 'phone number'])) {
      return GabayIntent.contact;
    }
    if (_has(lower, ['deliver', 'delivery', 'shipping', 'rider', 'address of the venue', 'ingress', 'egress'])) {
      return GabayIntent.delivery;
    }
    if (_has(lower, ['what is gabay', 'who are you', 'what can you do', 'how can you help', 'capabilities', 'chatbot', 'are you a bot'])) {
      return GabayIntent.about;
    }

    final namedDish = _findDish(text);
    if (namedDish != null) {
      slots.dish = namedDish.name;
      return GabayIntent.dishInfo;
    }

    if (_has(lower, ['book', 'booking', 'reserve', 'magbook', 'paano magbook', 'order food pack', 'food pack', 'party tray', 'trays'])) {
      if (!_packageWords(lower)) return GabayIntent.booking;
    }

    if (_packageWords(lower) ||
        slots.pax != null ||
        slots.budgetTotal != null ||
        slots.perHead != null) {
      return GabayIntent.packageMatch;
    }

    return GabayIntent.unknown;
  }

  bool _packageWords(String lower) =>
      _has(lower, ['package', 'packages', 'budget', 'pax', 'guests', 'headcount', 'per head', 'recommend', 'suggest', 'quote', 'magkano']);

  /// True for a message that is only a number or a date — the shape of an answer
  /// to Gabay's own follow-up question.
  bool _isBareAnswer(String text) {
    final lower = text.toLowerCase().trim();
    return RegExp(r'^[₱\s\d,\.]+$').hasMatch(lower) ||
        RegExp(r'^[₱\s\d,\.]+(pax|people|guests|tao|bisita|katao)$').hasMatch(lower) ||
        (RegExp(r'^[a-z]{3,9}\s+\d{1,2}(,)?(\s*\d{4})?$').hasMatch(lower)) ||
        RegExp(r'^\d{1,2}\s+[a-z]{3,9}(\s+\d{4})?$').hasMatch(lower) ||
        lower == 'next month' ||
        lower == 'next year';
  }

  void _readSlots(String text) {
    final lower = text.toLowerCase();

    final pax = _parsePax(lower);
    if (pax != null) slots.pax = pax;

    final perHead = _parsePerHead(lower);
    if (perHead != null) slots.perHead = perHead;

    final total = _parseTotalBudget(lower);
    if (total != null) slots.budgetTotal = total;

    final date = _parseDate(lower);
    if (date != null) slots.eventDate = date;

    final occasion = _parseOccasion(lower);
    if (occasion != null) slots.occasion = occasion;

    final allergen = _parseAllergen(lower);
    if (allergen != null) slots.avoidAllergens = {...slots.avoidAllergens, allergen};
  }

  int? _parsePax(String lower) {
    final match = RegExp(
      r'(\d{1,5})\s*(?:pax|people|guests?|persons?|heads?|tao|bisita|katao)\b',
    ).firstMatch(lower);
    if (match != null) {
      final value = int.tryParse(match.group(1)!);
      if (value != null && value > 0 && value <= 5000) return value;
    }
    final reverse = RegExp(
      r'\b(?:for|para sa|para)\s+(\d{1,5})\b(?!\s*(?:k|thousand|pesos|php|p\b))',
    ).firstMatch(lower);
    if (reverse != null) {
      final value = int.tryParse(reverse.group(1)!);
      if (value != null && value >= 5 && value <= 5000) return value;
    }
    return null;
  }

  double? _parsePerHead(String lower) {
    if (!lower.contains('per head') &&
        !lower.contains('each') &&
        !lower.contains('bawat') &&
        !lower.contains('/head') &&
        !lower.contains('/pax')) {
      return null;
    }
    final match = RegExp(r'([\d][\d,]*(?:\.\d+)?)\s*(k)?').firstMatch(lower);
    if (match == null) return null;
    return _toAmount(match.group(1)!, match.group(2) != null);
  }

  double? _parseTotalBudget(String lower) {
    final mentionsBudget = lower.contains('budget') ||
        lower.contains('spend') ||
        lower.contains('total') ||
        lower.contains('all in') ||
        lower.contains('all-in') ||
        lower.contains('gastos') ||
        lower.contains('kaya') ||
        lower.contains('₱') ||
        lower.contains('php');
    if (!mentionsBudget) return null;
    // Skip the number that belongs to the headcount ("50 pax") or the per-head
    // rate ("500 per head").
    final matches = RegExp(r'([\d][\d,]*(?:\.\d+)?)\s*(k|thousand)?')
        .allMatches(lower)
        .toList();
    for (final match in matches) {
      final after = lower.substring(match.end);
      if (RegExp(r'^\s*(pax|people|guests?|tao|bisita|heads?)').hasMatch(after)) {
        continue;
      }
      if (RegExp(r'^\s*(per head|each|bawat|/pax|/head)').hasMatch(after)) {
        continue;
      }
      final amount = _toAmount(match.group(1)!, match.group(2) != null);
      if (amount != null && amount >= 500) return amount;
    }
    return null;
  }

  double? _toAmount(String raw, bool thousands) {
    final value = double.tryParse(raw.replaceAll(',', ''));
    if (value == null) return null;
    return thousands ? value * 1000 : value;
  }

  DateTime? _parseDate(String lower) {
    final explicit = parseBookingDate(lower);
    if (explicit != null) return explicit;

    final now = DateTime.now();
    if (lower.contains('next month')) {
      return DateTime(now.year, now.month + 1, 1);
    }
    if (lower.contains('next year')) {
      return DateTime(now.year + 1, 1, 1);
    }
    final monthOnly = RegExp(
      r'\b(january|february|march|april|may|june|july|august|september|october|november|december)\b',
    ).firstMatch(lower);
    if (monthOnly != null) {
      final month = monthNames.indexWhere(
        (m) => m.toLowerCase() == monthOnly.group(1),
      ) + 1;
      if (month > 0) {
        final year = month < now.month ? now.year + 1 : now.year;
        return DateTime(year, month, 1);
      }
    }
    return null;
  }

  String? _parseOccasion(String lower) {
    const occasions = {
      'wedding': ['wedding', 'kasal', 'kasalan'],
      'birthday': ['birthday', 'kaarawan', 'bday'],
      'debut': ['debut', '18th', 'sweet sixteen'],
      'baptism': ['baptism', 'christening', 'binyag'],
      'funeral': ['funeral', 'libing', 'wake', 'lamay'],
      'graduation': ['graduation', 'graduating', 'grad'],
      'reunion': ['reunion', 'get together'],
      'anniversary': ['anniversary'],
      'fiesta': ['fiesta', 'pista'],
      'corporate': ['corporate', 'company', 'office event', 'seminar', 'conference'],
      'church': ['church', 'parish', 'chapel'],
      'government': ['government', 'govt', 'lgu', 'barangay'],
      'school': ['school', 'university', 'college'],
    };
    for (final entry in occasions.entries) {
      if (_has(lower, entry.value)) return entry.key;
    }
    return null;
  }

  String? _parseAllergen(String lower) {
    const allergens = {
      'peanut': ['peanut', 'mani'],
      'tree_nuts': ['tree nut', 'tree nuts', 'cashew', 'almond', 'walnut', 'pili'],
      'shellfish': ['shellfish', 'shrimp', 'hipon', 'crab', 'alimango', 'seafood allergy'],
      'fish': ['fish allergy', 'allergic to fish'],
      'milk': ['milk', 'dairy', 'lactose', 'gatas'],
      'egg': ['egg', 'itlog'],
      'gluten': ['gluten', 'wheat', 'flour'],
      'soy': ['soy', 'soya', 'tofu'],
      'sesame': ['sesame', 'linga'],
    };
    for (final entry in allergens.entries) {
      if (_has(lower, entry.value)) return entry.key;
    }
    return null;
  }

  Product? _findDish(String text) {
    final lower = text.toLowerCase();
    Product? best;
    var bestLength = 0;
    for (final dish in _visibleMenu) {
      final name = dish.name.trim().toLowerCase();
      if (name.length < 4) continue;
      if (lower.contains(name) && name.length > bestLength) {
        best = dish;
        bestLength = name.length;
      }
    }
    return best;
  }

  // ═════════════════════════════ Composing ═════════════════════════════

  String _greeting() {
    final name = user.firstName;
    final bits = <String>[
      'Kumusta, $name!',
      'I can match a package to your budget and headcount, suggest lighter '
          'dishes, build a planning checklist, and answer booking and payment '
          'questions from our own answers.',
    ];
    if (user.nextEventDate != null) {
      bits.add(
        'I can see you already have an event on file — ask me "what are my '
        'orders?" if you want the details.',
      );
    } else if (user.hasFavourites) {
      bits.add('Your past orders lean toward ${user.favouriteDishes.first} — say the word and I will build on that.');
    }
    return bits.join(' ');
  }

  String _thanks() {
    return 'Walang anuman, ${user.firstName}. If you want, I can put together a '
        'package shortlist or a planning checklist before you go.';
  }

  String _packageMatch() {
    final perHead = slots.effectivePerHead;
    final pax = slots.pax;

    if (perHead == null && pax == null && slots.occasion == null) {
      _pending = GabayIntent.packageMatch;
      return 'I can do that. How many guests are you feeding, and what budget '
          'are you working with — per head, or for the whole event? '
          'Something like "80 pax, ₱25,000 total" is plenty.';
    }

    if (pax == null) {
      _pending = GabayIntent.packageMatch;
      return 'How many guests should I plan for? I will match the package price '
          'and its minimum headcount against your budget of '
          '${peso(slots.budgetTotal ?? perHead! * 1)}.';
    }

    final fits = _packagesFitting(pax: pax, perHead: perHead);
    if (fits.isEmpty) {
      final published = _activePackages.where((p) => !p.isInstitutional).toList();
      if (published.isEmpty) {
        return 'Nothing is published on the Packages tab just yet, so there is '
            'nothing I can honestly recommend. Check back once the kitchen has '
            'posted the current packages.';
      }
      final cheapest = published.reduce((a, b) => a.price <= b.price ? a : b);
      return 'Nothing active fits ${pax.toString()} guests'
          '${perHead == null ? '' : ' at about ${peso(perHead)} per head'} — the '
          'closest published option is ${cheapest.name} at '
          '${peso(cheapest.price)} per head'
          '${cheapest.minPax > 0 ? ' (minimum ${cheapest.minPax} guests)' : ''}. '
          'For a spread outside the published packages, the team can quote it '
          'directly.';
    }

    final lines = <String>[];
    for (final pkg in fits.take(3)) {
      final minimum = pkg.minPax > 0
          ? (pkg.isFoodPack
              ? 'minimum ${pkg.minPax} servings'
              : 'minimum ${pkg.minPax} guests')
          : 'no published minimum';
      final includes = pkg.inclusions.isEmpty
          ? ''
          : ' Includes ${pkg.inclusions.take(3).join(', ')}.';
      lines.add(
        '• ${pkg.name} — ${peso(pkg.price)} per head, $minimum.$includes',
      );
    }

    final opening = perHead == null
        ? 'For $pax guests, these published packages fit:'
        : 'For $pax guests at about ${peso(perHead)} per head, these fit:';

    final closing = <String>[];
    final known = user.summary();
    if (known.isNotEmpty) closing.add(known);
    if (_avoided.isNotEmpty) {
      closing.add(
        'I kept your ${_avoided.length} avoided allergen'
        '${_avoided.length == 1 ? '' : 's'} in mind — the kitchen still has the '
        'final word, since everything is cooked on shared equipment.',
      );
    }
    if (slots.occasion != null) {
      closing.add('These are the packages we would put forward for a ${slots.occasion}.');
    }
    closing.add(
      'Tap a package on the Packages tab to see its full inclusions and book '
      'it — the wizard is where the date and venue are locked in.',
    );

    return [opening, ...lines, ...closing].join('\n');
  }

  List<CateringPackage> _packagesFitting({
    required int pax,
    required double? perHead,
  }) {
    final institutionalAllowed = const {
      'church',
      'government',
      'school',
    }.contains(slots.occasion);

    final fits = _activePackages.where((pkg) {
      if (pkg.isInstitutional && !institutionalAllowed) return false;
      if (pkg.minPax > 0 && pkg.minPax > pax) return false;
      if (perHead != null && pkg.price > 0 && pkg.price > perHead * 1.05) {
        return false;
      }
      return true;
    }).toList();

    if (perHead != null) {
      fits.sort((a, b) => (b.price - perHead).abs().compareTo(
        (a.price - perHead).abs(),
      ));
    } else {
      fits.sort((a, b) => a.price.compareTo(b.price));
    }
    return fits;
  }

  String _packageInfo(String text) {
    final wanted = slots.packageName;
    CateringPackage? pkg;
    for (final candidate in _activePackages) {
      if (wanted != null && candidate.name == wanted) pkg = candidate;
    }
    pkg ??= _findPackage(text);

    if (pkg != null) {
      final doc = corpus.byId('package:${pkg.id}');
      final includeLines = <String>[];
      if (pkg.inclusions.isNotEmpty) {
        includeLines.add('Courses: ${pkg.inclusions.join(', ')}.');
      }
      if (pkg.standardServices.isNotEmpty) {
        includeLines.add('Standard service: ${pkg.standardServices.join(', ')}.');
      }
      return [
        doc?.body ?? '${pkg.name} is a ${pkg.type.toLowerCase()} at ${peso(pkg.price)} per head.',
        ...includeLines,
        'Its minimum is ${pkg.minPax > 0 ? pkg.minPax : 0} '
            '${pkg.isFoodPack ? 'servings' : 'guests'}, and the booking wizard '
            'builds its questions from these courses.',
      ].join(' ');
    }

    final doc = corpus.best(text, topic: GabayTopic.packageInfo);
    if (doc != null) return doc.body;
    return 'I could not match that to a published package. The full list is on '
        'the Packages tab — tell me your guest count and budget and I will '
        'narrow it down.';
  }

  CateringPackage? _findPackage(String text) {
    final lower = text.toLowerCase();
    for (final pkg in _activePackages) {
      if (pkg.name.isNotEmpty && lower.contains(pkg.name.toLowerCase())) {
        return pkg;
      }
    }
    return null;
  }

  String _healthier(String text) {
    final named = _findDish(text);
    final avoid = _avoided;
    final pool = _visibleMenu
        .where((d) => avoid.every((a) => !d.allergens.contains(a)))
        .where((d) => named == null || d.id != named.id)
        .where((d) => named == null || d.category != named.category)
        .toList();

    if (pool.isEmpty) {
      return 'Every dish currently published either carries something you asked '
          'us to avoid or there is nothing to swap to yet. The kitchen can '
          'still suggest something when you book — just flag the allergy in '
          'the booking and give us a call.';
    }

    pool.sort((a, b) => _lightness(b.category).compareTo(_lightness(a.category)));
    final picks = pool.take(4).toList();

    final opening = named == null
        ? 'Lighter-leaning dishes on the current menu:'
        : 'For a lighter take on ${named.name}, the current menu offers:';
    final lines = [
      for (final dish in picks)
        '• ${dish.name} — ${dish.category}'
            '${dish.allergens.isEmpty ? '' : ' · tagged ${dish.allergens.join(', ')}'}',
    ];
    final note = named == null
        ? 'These are menu suggestions the kitchen can talk through with you, not '
            'nutritional claims.'
        : 'Same kitchen, same shared equipment, so tell us about any allergy in '
            'the booking as well.';

    final personal = prefs.healthierFirst
        ? 'Your Settings already ask me to lead with lighter options.'
        : '';
    return [opening, ...lines, note, personal]
        .where((s) => s.trim().isNotEmpty)
        .join('\n');
  }

  int _lightness(String category) {
    final key = category.toLowerCase();
    if (key.contains('vegetable') || key.contains('gulay')) return 5;
    if (key.contains('salad')) return 5;
    if (key.contains('seafood') || key.contains('fish') || key.contains('isda')) {
      return 4;
    }
    if (key.contains('grilled') || key.contains('inihaw')) return 4;
    if (key.contains('chicken') || key.contains('manok')) return 3;
    if (key.contains('soup') || key.contains('sabaw')) return 3;
    if (key.contains('pasta') || key.contains('noodle')) return 2;
    if (key.contains('pork') || key.contains('beef')) return 1;
    return 2;
  }

  String _dishInfo(String text) {
    final dish = _findDish(text) ?? _dishByName(slots.dish);
    if (dish == null) {
      final doc = corpus.best(text, topic: GabayTopic.dishInfo);
      if (doc != null) return doc.body;
      return 'That dish is not on the published menu right now. The kitchen '
          'decides what is on show — it may be resting for a while. Ask me for '
          'lighter options and I will work from what is available today.';
    }

    final allergens = dish.allergens.isEmpty
        ? 'No allergen tag has been published for it yet.'
        : 'It is tagged for ${dish.allergens.join(', ')}.';
    final avoided = _avoided.where(dish.allergens.contains).toList();
    final warning = avoided.isEmpty
        ? ''
        : ' That overlaps with what you asked us to avoid, so please flag it in '
            'the booking and call the team.';

    return '${dish.name} is on our ${dish.category} line for '
        '${dish.type.toLowerCase()}. $allergens$warning '
        'Ask me for a lighter alternative if you want a swap.';
  }

  Product? _dishByName(String? name) {
    if (name == null) return null;
    for (final dish in _visibleMenu) {
      if (dish.name.toLowerCase() == name.toLowerCase()) return dish;
    }
    return null;
  }

  String _checklist() {
    final who = slots.pax == null ? 'your guests' : '${slots.pax} guests';
    final when = slots.eventDate == null
        ? 'the date you pick'
        : _prettyDate(slots.eventDate!);
    final occasion = slots.occasion == null ? 'your event' : 'your ${slots.occasion}';
    final budget = slots.budgetTotal == null
        ? ''
        : ' Your working budget is ${peso(slots.budgetTotal!)} total'
            '${slots.perHead == null ? '' : ' (${peso(slots.perHead!)} per head)'}.';

    final known = user.summary();

    return [
      'Here is a planning checklist for $occasion on $when for $who.$budget',
      if (known.isNotEmpty) known,
      '',
      'BEFORE BOOKING',
      '• Pick the package that fits your headcount and budget — I can shortlist '
          'one if you tell me both.',
      '• Choose a dish for each course the package names (the wizard asks one '
          'question per course).',
      '• Have the venue address, ingress and egress times, and the programme '
          'times ready.',
      '',
      'WHEN YOU FILE',
      '• The order lands as Pending; the team calls your contact number to go '
          'through the details.',
      '• Half the total holds the date — settled on Xendit with GCash, Maya, '
          'GrabPay or a card.',
      '• The order turns Confirmed once the details are checked and the '
          'downpayment lands.',
      '',
      'BEFORE THE EVENT',
      '• Confirm the final headcount with the team; the kitchen plans from it.',
      '• Settle the allergens and any swaps with the kitchen — one kitchen, '
          'shared equipment.',
      '• Review the 3D layout preview if the team has drawn one for your venue.',
      '',
      'ON THE DAY',
      '• The balance is settled with the team on the day of the event.',
      '• Keep the reference number from Order tracking handy.',
    ].join('\n');
  }

  String _planning() {
    final doc = corpus.best(
      'layout venue planning',
      topic: GabayTopic.planning,
    );
    final base = doc?.body ??
        'The 3D layout planner is where the room is arranged and checked for '
            'overlaps and blocked walkways.';
    return '$base\n\nWhat I can do here is the planning around it: tell me the '
        'occasion, headcount and budget and I will suggest a package and build '
        'you a checklist.';
  }

  String _whyRecommended() {
    if (recs.isEmpty) {
      return 'There is nothing in your "Picks just for you" strip right now, so '
          'there is no recommendation to explain. Once the menu and your '
          'history give the engine something to work with, I will tell you '
          'exactly which signal produced each pick.';
    }
    final names = recs.items.take(3).map((i) => i.name).join(', ');
    return 'Your picks are $names. ${recs.source.label} — '
        '${user.recommendationBasis().toLowerCase()}. '
        'I never make a pick up: if the engine has nothing to go on, the '
        'kitchen\'s featured dishes stand in and the label says so.';
  }

  String _seasonal() {
    final sales = GabaySalesInsights.bundled;
    final bits = <String>[sales.summary()];
    if (slots.eventDate != null && sales.isPeakMonth(slots.eventDate!)) {
      bits.add(
        'Your date falls in ${monthNames[slots.eventDate!.month - 1]}, one of '
        'the busiest months on our books — earlier is safer for that one.',
      );
    } else if (slots.eventDate != null) {
      bits.add(
        'Your date is in ${monthNames[slots.eventDate!.month - 1]}, outside the '
        'peak months, so the calendar has more room.',
      );
    } else {
      bits.add(
        'If your date is in November, December or August, book as early as you '
        'can; the quieter months give you more flexibility.',
      );
    }
    bits.add(
      'I read these figures from the sales workbooks the business keeps, not '
      'from a guess.',
    );
    return bits.join(' ');
  }

  String _myOrders() {
    if (!user.hasHistory) {
      return 'You have no filed orders yet — only you can see your own orders, '
          'so there is nothing for me to look up. Once you book, Order tracking '
          'under Settings lists everything, newest first.';
    }
    final bits = <String>[
      'You have ${user.orderCount} order${user.orderCount == 1 ? '' : 's'} on '
          'file: ${user.completedCount} completed, ${user.upcomingCount} still '
          'open.',
    ];
    if (user.nextEventDate != null) {
      bits.add(
        'Your next event is ${_prettyDate(user.nextEventDate!)}'
        '${user.nextEventName == null ? '' : ' (${user.nextEventName})'}.',
      );
    }
    if (user.totalSpend > 0) {
      bits.add('Recorded totals come to ${peso(user.totalSpend)}.');
    }
    bits.add(
      'The live status is in Settings → Order tracking — it updates itself as '
      'the team moves an order along.',
    );
    return bits.join(' ');
  }

  String _policy(GabayTopic topic, String text) {
    final doc = corpus.best(text, topic: topic) ??
        corpus.best(_topicKeywords(topic), topic: topic);
    if (doc == null) {
      return 'I do not have a written answer for that one, and I will not guess '
          'at a policy. The team can settle it — Settings → Contact us.';
    }
    return doc.body;
  }

  String _topicKeywords(GabayTopic topic) => switch (topic) {
    GabayTopic.booking => 'how to book catering package wizard',
    GabayTopic.payment => 'downpayment deposit payment',
    GabayTopic.status => 'order status pending confirmed',
    GabayTopic.cancellation => 'cancel change order',
    GabayTopic.allergens => 'allergen allergy shared equipment',
    GabayTopic.account => 'account password profile',
    GabayTopic.contact => 'contact call message team',
    GabayTopic.delivery => 'delivery venue address',
    GabayTopic.about => 'what is gabay what can you do',
    _ => 'hapagpamana',
  };

  String _fallback(String text) {
    final doc = corpus.lookup(text);
    if (doc != null) {
      return '${doc.body}\n\nAnything else you want me to explain?';
    }
    if (slots.pax != null || slots.budgetTotal != null) {
      return _packageMatch();
    }
    return 'I did not catch a question I can ground in our own menu, packages or '
        'policies there — and I would rather say so than invent an answer. '
        'Try asking about a package, a budget and headcount, lighter dishes, '
        'the downpayment, allergens, peak season, or your own orders.';
  }

  String _prettyDate(DateTime date) =>
      '${monthNames[date.month - 1]} ${date.day}, ${date.year}';
}
