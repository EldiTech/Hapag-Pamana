/// Gabay's training corpus — the business's own written content, arranged so
/// the assistant can retrieve exactly the passage a question is about instead
/// of pattern-matching a handful of hard-coded phrases.
///
/// Three sources are folded in:
///
///   1. **The published catalog** — every active package and every visible dish,
///      with its price, minimum headcount, inclusions, category and allergens.
///      This is live: whatever the Content Moderator publishes is what Gabay
///      can talk about, and nothing else.
///   2. **The business's own answers** — booking, payment, status, allergen and
///      account policy, mirroring the Help & FAQ screen the member can read.
///   3. **The uploaded sales workbooks** — the monthly totals Gabay was trained
///      on, so questions about peak season are answered from the business's own
///      books rather than from a guess. See [GabaySalesInsights].
///
/// Retrieval is a small TF-IDF index over those documents with a hand-written
/// Tagalog/English synonym table on top ([kGabaySynonyms]). It is deliberately
/// on-device: the mobile requirement is that Gabay keeps working from the
/// cached catalog when the phone is offline, and a network call per keystroke
/// would break that promise.
library;

import 'dart:math' as math;

import 'catering.dart';
import 'gabay_sales_insights.dart';
import 'product.dart';

/// What a corpus document is about. The reply layer uses this to keep a
/// question like "how much is the downpayment?" from being answered with a
/// package description that merely shares a word.
enum GabayTopic {
  booking,
  payment,
  status,
  cancellation,
  allergens,
  account,
  delivery,
  contact,
  about,
  packageInfo,
  dishInfo,
  seasonal,
  planning,
  policy,
}

/// One retrievable passage of grounded content.
class GabayDoc {
  const GabayDoc({
    required this.id,
    required this.topic,
    required this.title,
    required this.body,
    required this.keywords,
    this.ref,
    this.weight = 1,
  });

  /// Stable id — also the corpus' index key.
  final String id;

  final GabayTopic topic;

  /// The line the reply cites when it names its source ("Hapag Fiesta Package").
  final String title;

  /// The grounded text itself, in the business's words wherever the business
  /// has written them.
  final String body;

  /// Extra search terms that don't appear verbatim in [body] — synonyms,
  /// Tagalog words, and the things a member actually types.
  final List<String> keywords;

  /// The package or dish id this document describes, when it describes one.
  final String? ref;

  /// Static importance. Policies sit slightly above catalog entries so a
  /// question that touches both ("how much is the downpayment on a package?")
  /// resolves to the policy.
  final double weight;
}

/// Words that carry no retrieval signal on their own.
const Set<String> kGabayStopwords = {
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'for', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'am', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'will', 'shall',
  'may', 'might', 'must', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you',
  'your', 'he', 'she', 'it', 'they', 'them', 'their', 'this', 'that', 'these',
  'those', 'there', 'here', 'what', 'which', 'who', 'whom', 'how', 'when',
  'where', 'why', 'not', 'no', 'yes', 'so', 'than', 'then', 'too', 'very',
  'just', 'about', 'any', 'some', 'please', 'po', 'ba', 'ng', 'sa', 'na',
  'ang', 'mga', 'ko', 'mo', 'ka', 'ako', 'ikaw', 'kami', 'tayo', 'din',
  'rin', 'lang', 'yung', 'si', 'ni', 'kay', 'para', 'meron', 'mayroon',
  'want', 'need', 'like', 'get', 'give', 'tell', 'know', 'help', 'ask',
};

/// Tagalog / Filipino / colloquial → canonical English search terms.
///
/// Members write in a mix of English and Tagalog ("magkano ang package para sa
/// 50 pax?", "may pang-diet ba?"), so retrieval translates the words that carry
/// the intent before scoring. Values are added to the query, never to the
/// document, which keeps the business's own copy untouched.
const Map<String, List<String>> kGabaySynonyms = {
  // Money
  'magkano': ['price', 'cost', 'how much'],
  'presyo': ['price', 'cost'],
  'gastos': ['cost', 'budget', 'price'],
  'bayad': ['payment', 'pay', 'price'],
  'babayaran': ['payment', 'pay'],
  'downpayment': ['downpayment', 'deposit', 'half', 'advance'],
  'deposito': ['deposit', 'downpayment'],
  'tipid': ['cheap', 'budget', 'affordable', 'low'],
  'mura': ['cheap', 'affordable', 'budget', 'low'],
  'mahal': ['premium', 'expensive', 'high'],
  'sakto': ['mid', 'midrange', 'moderate'],
  'premium': ['premium', 'high'],
  // Headcount and events
  'tao': ['pax', 'guests', 'people', 'headcount'],
  'bisita': ['guests', 'pax', 'visitors'],
  'katao': ['pax', 'headcount', 'guests'],
  'pax': ['pax', 'guests', 'headcount', 'people'],
  'handaan': ['event', 'catering', 'party', 'feast'],
  'okasyon': ['occasion', 'event'],
  'kasalan': ['wedding', 'occasion'],
  'kasal': ['wedding', 'occasion'],
  'birthday': ['birthday', 'occasion'],
  'kaarawan': ['birthday', 'occasion'],
  'binyag': ['baptism', 'christening', 'occasion'],
  'libing': ['funeral', 'occasion'],
  'graduation': ['graduation', 'occasion'],
  'reunion': ['reunion', 'occasion'],
  'party': ['party', 'event', 'occasion'],
  'event': ['event', 'occasion', 'function'],
  'venue': ['venue', 'place', 'location'],
  'petsa': ['date', 'when'],
  'kailan': ['when', 'date', 'season'],
  'araw': ['date', 'day'],
  // Menu and diet
  'pagkain': ['food', 'menu', 'dish'],
  'ulam': ['dish', 'viand', 'menu'],
  'menu': ['menu', 'dishes', 'food'],
  'masarap': ['delicious', 'dish'],
  'healthy': ['healthy', 'healthier', 'lighter', 'nutritious'],
  'lighter': ['lighter', 'healthy', 'healthier'],
  'diet': ['diet', 'healthy', 'lighter'],
  'gulay': ['vegetables', 'vegetable', 'healthy'],
  'isda': ['fish', 'seafood', 'healthy'],
  'karne': ['meat', 'beef', 'pork'],
  'allergy': ['allergen', 'allergy'],
  'allerhiya': ['allergen', 'allergy'],
  'alergiya': ['allergen', 'allergy'],
  'hindi': ['avoid', 'without', 'no'],
  'wala': ['without', 'no', 'avoid'],
  'vegetarian': ['vegetarian', 'diet', 'healthy'],
  // Booking and service
  'book': ['book', 'booking', 'reserve'],
  'magbook': ['book', 'booking', 'reserve'],
  'reserve': ['reserve', 'booking'],
  'order': ['order', 'booking'],
  'umorder': ['order', 'booking'],
  'paano': ['how', 'process', 'steps'],
  'para': ['for', 'how'],
  'status': ['status', 'order', 'tracking'],
  'kansel': ['cancel', 'cancellation'],
  'cancel': ['cancel', 'cancellation'],
  'deliver': ['delivery', 'deliver'],
  'delivery': ['delivery', 'deliver'],
  'saan': ['where', 'location', 'address'],
  'salamat': ['thanks', 'thank'],
  'kumusta': ['hello', 'hi', 'greeting'],
  'hi': ['hello', 'greeting'],
  'hello': ['hello', 'greeting'],
  'kailangan': ['need', 'require', 'requirements'],
  'checklist': ['checklist', 'planning', 'steps', 'prepare'],
  'plano': ['plan', 'planning', 'checklist'],
  'layout': ['layout', 'venue', 'planning'],
  'planner': ['layout', 'planning'],
  'season': ['season', 'seasonal', 'peak', 'busy'],
  'peak': ['peak', 'busy', 'season'],
  'busy': ['busy', 'peak', 'season'],
  'puno': ['busy', 'peak', 'full'],
};

/// Tokenises a sentence for indexing and querying.
///
/// Lower-cases, splits on anything that isn't a letter/digit, folds a trailing
/// plural "s", and expands Tagalog synonyms. Numbers survive — "50", "20000",
/// "₱1,500" all matter to a catering question.
List<String> gabayTokens(String text) {
  final out = <String>[];
  for (final word in _plainTokens(text)) {
    out.add(word);
    // One level of synonyms only. Expanding recursively would loop forever on
    // the entries that name themselves ("downpayment" → "downpayment").
    for (final synonym in kGabaySynonyms[word] ?? const <String>[]) {
      out.addAll(_plainTokens(synonym));
    }
  }
  return out;
}

/// Tokens without synonym expansion — the building block [gabayTokens] wraps.
List<String> _plainTokens(String text) {
  final words = text
      .toLowerCase()
      .replaceAll('₱', ' ')
      .replaceAll(RegExp(r'[^a-z0-9\s]'), ' ')
      .split(RegExp(r'\s+'))
      .where((w) => w.isNotEmpty && !kGabayStopwords.contains(w));

  final out = <String>[];
  for (final word in words) {
    out.add(word);
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) {
      out.add(word.substring(0, word.length - 1));
    }
  }
  return out;
}

/// The searchable corpus: every grounded document plus the IDF weights needed
/// to rank them.
class GabayCorpus {
  GabayCorpus._(this.docs, this._postings, this._idf);

  /// Every document, in build order.
  final List<GabayDoc> docs;

  final Map<String, List<String>> _postings;
  final Map<String, double> _idf;

  /// Builds the corpus from what the business has actually published.
  ///
  /// [packages] and [menu] are the live Firestore snapshots the Gabay screen
  /// already loads; [sales] is the bundled snapshot of the uploaded workbooks.
  /// A catalog that hasn't loaded yet simply contributes no documents, so the
  /// assistant stays honest ("nothing published yet") rather than inventing
  /// dishes to talk about.
  factory GabayCorpus.build({
    required List<CateringPackage> packages,
    required List<Product> menu,
    GabaySalesInsights sales = GabaySalesInsights.bundled,
  }) {
    final docs = <GabayDoc>[
      ...kGabayPolicyDocs,
      _salesDoc(sales),
      for (final pkg in packages)
        if (pkg.active) _packageDoc(pkg),
      for (final dish in menu)
        if (dish.available) _dishDoc(dish),
    ];

    final postings = <String, List<String>>{};
    for (final doc in docs) {
      final terms = <String>{
        ...gabayTokens(doc.title),
        ...gabayTokens(doc.body),
        for (final keyword in doc.keywords) ...gabayTokens(keyword),
      };
      for (final term in terms) {
        postings.putIfAbsent(term, () => <String>[]).add(doc.id);
      }
    }

    final total = docs.length.toDouble();
    final idf = <String, double>{};
    postings.forEach((term, ids) {
      idf[term] = 1 + _log(total / (1 + ids.length));
    });

    return GabayCorpus._(docs, postings, idf);
  }

  /// The grounded document with [id], or null.
  GabayDoc? byId(String id) {
    for (final doc in docs) {
      if (doc.id == id) return doc;
    }
    return null;
  }

  /// Every document of a given topic, in build order.
  List<GabayDoc> ofTopic(GabayTopic topic) =>
      docs.where((d) => d.topic == topic).toList();

  /// The best passages for [query], strongest first.
  ///
  /// [topic] narrows the search to one kind of document when the intent is
  /// already known (a booking question never needs to rank dish descriptions);
  /// [limit] caps the result. Documents sharing no term with the query are
  /// dropped, so an empty list is a real "I have nothing on that".
  List<GabayDoc> search(String query, {GabayTopic? topic, int limit = 4}) {
    final terms = gabayTokens(query).toSet();
    if (terms.isEmpty) return const [];
    final pool = topic == null ? docs : ofTopic(topic);
    final allowed = {for (final doc in pool) doc.id};

    final scores = <String, double>{};
    for (final term in terms) {
      final ids = _postings[term];
      if (ids == null) continue;
      final weight = _idf[term] ?? 1;
      for (final id in ids) {
        if (!allowed.contains(id)) continue;
        scores[id] = (scores[id] ?? 0) + weight;
      }
    }

    final ranked = scores.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final out = <GabayDoc>[];
    for (final entry in ranked) {
      if (out.length >= limit) break;
      final doc = byId(entry.key);
      if (doc == null) continue;
      out.add(doc);
    }
    return out;
  }

  /// The strongest single document for [query] restricted to [topic], or null
  /// when nothing clears the relevance floor.
  GabayDoc? best(String query, {required GabayTopic topic}) {
    final hits = search(query, topic: topic, limit: 1);
    return hits.isEmpty ? null : hits.first;
  }

  /// The document [query] is most plausibly about, across every topic.
  ///
  /// Stricter than [search]: it requires the document to cover a real share of
  /// the question's meaningful words, so a stray shared word ("package" in
  /// "how long is the package?" vs. a package description) doesn't get answered
  /// as if the question were understood. Null means "nothing grounded fits",
  /// which the reply layer answers honestly instead of guessing.
  GabayDoc? lookup(String query, {double minCoverage = 0.45}) {
    final terms = gabayTokens(query).toSet();
    if (terms.isEmpty) return null;

    GabayDoc? bestDoc;
    var bestScore = 0.0;
    for (final doc in docs) {
      final haystack = <String>{
        ...gabayTokens(doc.title),
        ...gabayTokens(doc.body),
        for (final keyword in doc.keywords) ...gabayTokens(keyword),
      };
      var hits = 0;
      for (final term in terms) {
        if (haystack.contains(term)) hits++;
      }
      final coverage = hits / terms.length;
      if (hits < 2 || coverage < minCoverage) continue;
      final score = coverage + doc.weight / 10;
      if (score > bestScore) {
        bestDoc = doc;
        bestScore = score;
      }
    }
    return bestDoc;
  }

  /// Every package documented in this corpus, by id.
  Map<String, GabayDoc> get packageDocs => {
    for (final doc in docs)
      if (doc.topic == GabayTopic.packageInfo && doc.ref != null)
        doc.ref!: doc,
  };

  /// Every dish documented in this corpus, by id.
  Map<String, GabayDoc> get dishDocs => {
    for (final doc in docs)
      if (doc.topic == GabayTopic.dishInfo && doc.ref != null) doc.ref!: doc,
  };

  static double _log(double v) => v <= 0 ? 0 : math.log(v);
}

// ---------------------------------------------------------------------------
// Document builders
// ---------------------------------------------------------------------------

GabayDoc _salesDoc(GabaySalesInsights sales) {
  final peak = sales.peakMonths
      .map((m) => monthNames[m - 1])
      .where((name) => name.isNotEmpty)
      .join(', ');
  return GabayDoc(
    id: 'sales:season',
    topic: GabayTopic.seasonal,
    title: 'Peak season on our books',
    body:
        '${sales.summary()} The busiest months are $peak, so dates in those '
        'months are best reserved early rather than a week before.',
    keywords: [
      'season',
      'peak',
      'busy',
      'book early',
      'when to book',
      'kalendaryo',
      'holiday',
      'christmas',
      'december',
      'november',
      'august',
      'demand',
      'forecast',
      'sales',
    ],
    weight: 1.1,
  );
}

GabayDoc _packageDoc(CateringPackage pkg) {
  final perHead = pkg.price > 0 ? '${peso(pkg.price)} per head' : 'quoted per event';
  final minimum = pkg.minPax > 0
      ? (pkg.isFoodPack
          ? 'minimum ${pkg.minPax} servings'
          : 'minimum ${pkg.minPax} guests')
      : 'no published minimum';
  final includes = pkg.inclusions.isEmpty
      ? ''
      : 'It covers ${pkg.inclusions.join(', ')}.';
  final services = pkg.standardServices.isEmpty
      ? ''
      : 'Standard service: ${pkg.standardServices.join(', ')}.';
  return GabayDoc(
    id: 'package:${pkg.id}',
    topic: GabayTopic.packageInfo,
    title: pkg.name,
    body:
        '${pkg.name} is a ${pkg.type.toLowerCase()} at $perHead, with a '
        '$minimum. $includes $services'.trim(),
    keywords: [
      'package',
      'catering package',
      pkg.type,
      if (pkg.isFoodPack) 'food pack',
      if (pkg.isFoodPack) 'trays',
      if (pkg.isInstitutional) 'church government school',
      ...pkg.inclusions,
      ...pkg.standardServices,
    ],
    ref: pkg.id,
    weight: 0.9,
  );
}

GabayDoc _dishDoc(Product dish) {
  final allergens = dish.allergens.isEmpty
      ? 'No allergen tag has been published for it yet.'
      : 'It is tagged for ${dish.allergens.join(', ')}.';
  return GabayDoc(
    id: 'dish:${dish.id}',
    topic: GabayTopic.dishInfo,
    title: dish.name,
    body:
        '${dish.name} is on the ${dish.category} line of our '
        '${dish.type.toLowerCase()}. $allergens',
    keywords: [
      'dish',
      'menu',
      dish.category,
      dish.type,
      ...dish.allergens,
      if (dish.featured) 'featured',
    ],
    ref: dish.id,
    weight: 0.8,
  );
}

// ---------------------------------------------------------------------------
// The business's own answers
// ---------------------------------------------------------------------------

/// Policies transcribed from the app's Help & FAQ screen. Keeping them here (as
/// documents rather than branches in the reply code) is what lets the retriever
/// decide which one a free-form question is about.
const List<GabayDoc> kGabayPolicyDocs = [
  GabayDoc(
    id: 'policy:book',
    topic: GabayTopic.booking,
    title: 'How to book catering',
    body:
        'Open the Packages tab, choose the package you like and tap "Book Us '
        'Now". The wizard asks for the date, the venue, your headcount, and a '
        'dish for each course, then files the order. It reaches the team as '
        'Pending straight away, and we call your contact number to go through '
        'the details.',
    keywords: [
      'book', 'booking', 'reserve', 'how to book', 'steps', 'package',
      'wizard', 'magbook', 'paano magbook', 'start',
    ],
    weight: 1.2,
  ),
  GabayDoc(
    id: 'policy:foodpack',
    topic: GabayTopic.booking,
    title: 'Ordering food packs and party trays',
    body:
        'Food packs and party trays are ordered from the Packages tab too — tap '
        '"Book Us Now" on a food pack. It is a shorter form built around the '
        'quotation: the occasion, when and where it is going, and a menu list '
        'with a pax count on every dish.',
    keywords: [
      'food pack', 'food packs', 'party tray', 'trays', 'order food',
      'baon', 'packed meal', 'quotation',
    ],
    weight: 1.2,
  ),
  GabayDoc(
    id: 'policy:status',
    topic: GabayTopic.status,
    title: 'What the order statuses mean',
    body:
        'Pending — we have your order and are going through it. Confirmed — '
        'your date is locked in and the kitchen is planning for it. Completed — '
        'the event is done. Declined — we could not take that one on; message '
        'us and we will see what else we can arrange.',
    keywords: [
      'status', 'pending', 'confirmed', 'completed', 'declined', 'tracking',
      'order status', 'asan na', 'nasa', 'progress',
    ],
    weight: 1.2,
  ),
  GabayDoc(
    id: 'policy:tracking',
    topic: GabayTopic.status,
    title: 'Where to see your orders',
    body:
        'Settings → Order tracking lists every order you have filed, newest '
        'first, with the open ones on top. It updates itself as the team moves '
        'an order along, so there is nothing to refresh.',
    keywords: [
      'my orders', 'order history', 'tracking', 'where are my orders',
      'orders ko', 'order list',
    ],
    weight: 1.1,
  ),
  GabayDoc(
    id: 'policy:change',
    topic: GabayTopic.cancellation,
    title: 'Changing or cancelling a filed order',
    body:
        'An order cannot be edited or cancelled from the app once it is filed — '
        'that is what stops an event being changed out from under the kitchen '
        'halfway through planning. Call or message the team and we will adjust '
        'it with you.',
    keywords: [
      'cancel', 'change order', 'edit booking', 'cancellation', 'reschedule',
      'move date', 'kansel', 'palit',
    ],
    weight: 1.2,
  ),
  GabayDoc(
    id: 'policy:downpayment',
    topic: GabayTopic.payment,
    title: 'Paying up front',
    body:
        'Half the order total holds your date; the balance is settled with the '
        'team on the day of the event. The downpayment is paid on Xendit\'s '
        'secure checkout with GCash, Maya, GrabPay, or a Visa / Mastercard — '
        'card details never pass through the app.',
    keywords: [
      'downpayment', 'deposit', 'half', 'advance', 'pay', 'payment', 'gcash',
      'maya', 'card', 'xendit', 'magkano ang downpayment', 'bayad',
    ],
    weight: 1.3,
  ),
  GabayDoc(
    id: 'policy:payment-resume',
    topic: GabayTopic.payment,
    title: 'Resuming an interrupted payment',
    body:
        'Your order is filed before the payment, so an interrupted checkout '
        'never loses the form you filled in. Open Order tracking, tap the order '
        'and choose Pay — it hands you back the same checkout page instead of '
        'starting a second one.',
    keywords: [
      'payment failed', 'closed payment', 'resume payment', 'pay again',
      'checkout', 'unpaid',
    ],
    weight: 1.1,
  ),
  GabayDoc(
    id: 'policy:quotation',
    topic: GabayTopic.payment,
    title: 'Orders that need a quotation',
    body:
        'Some orders are priced by hand — a small delivery, or a spread that '
        'needs costing first. Those file without an online downpayment: the '
        'team sends the quotation, then arranges the downpayment with you '
        'directly.',
    keywords: ['quotation', 'quote', 'priced by hand', 'custom price', 'costing'],
    weight: 1.1,
  ),
  GabayDoc(
    id: 'policy:confirmed',
    topic: GabayTopic.status,
    title: 'When a booking is confirmed',
    body:
        'A booking is confirmed once the team has been through the details and '
        'the downpayment has landed. The status in Order tracking turns to '
        'Confirmed the moment it does.',
    keywords: ['confirmed', 'confirmation', 'when confirmed', 'lock date'],
    weight: 1.1,
  ),
  GabayDoc(
    id: 'policy:allergens',
    topic: GabayTopic.allergens,
    title: 'Allergens and shared equipment',
    body:
        'The kitchen tags every dish itself. Set the allergens you avoid in '
        'Settings → Dietary preference and the Menu flags anything carrying '
        'one. Please also tell the team in your booking and give us a call: '
        'everything is cooked in one kitchen on shared equipment, so we can '
        'warn you but cannot promise a dish is free of traces.',
    keywords: [
      'allergen', 'allergy', 'allergies', 'peanut', 'nuts', 'shellfish',
      'gluten', 'dairy', 'cross contamination', 'shared kitchen', 'allerhiya',
      'alergiya', 'safe to eat',
    ],
    weight: 1.3,
  ),
  GabayDoc(
    id: 'policy:menu-change',
    topic: GabayTopic.dishInfo,
    title: 'A dish that disappeared from the menu',
    body:
        'The kitchen decides what is on show, so a dish comes off when it is '
        'out of season or resting for a while. It stays on your past orders, '
        'and you can always ask the team about it.',
    keywords: ['missing dish', 'removed', 'not on menu', 'unavailable', 'out of stock'],
    weight: 1,
  ),
  GabayDoc(
    id: 'policy:account',
    topic: GabayTopic.account,
    title: 'Account help',
    body:
        'Tap your picture on the Account tab to change or remove your profile '
        'photo. For a forgotten password, use "Forgot password?" on the log-in '
        'screen and a reset link arrives by email. Email addresses and phone '
        'numbers are changed by the team, not in the app — message us and we '
        'will take care of it.',
    keywords: [
      'account', 'profile', 'password', 'forgot password', 'email', 'phone',
      'sign in', 'login', 'photo',
    ],
    weight: 1,
  ),
  GabayDoc(
    id: 'policy:delivery',
    topic: GabayTopic.delivery,
    title: 'Delivery and the venue',
    body:
        'The venue you give in the booking wizard is where the team plans the '
        'delivery and set-up. Catering events are set up at your venue; food '
        'packs and trays are delivered to the address on the order. Live '
        'rider tracking is not part of the app — the team coordinates delivery '
        'with you directly.',
    keywords: [
      'delivery', 'deliver', 'shipping', 'address', 'venue', 'set up',
      'setup', 'ingress', 'egress', 'rider',
    ],
    weight: 1,
  ),
  GabayDoc(
    id: 'policy:contact',
    topic: GabayTopic.contact,
    title: 'Talking to the team',
    body:
        'For anything the app cannot do — moving a filed order, changing a '
        'contact number, a quotation, or a concern about an event — message or '
        'call the team from Settings → Contact us. HapagPamana has been cooking '
        'from Quezon City since 2016.',
    keywords: [
      'contact', 'call', 'message', 'talk to someone', 'human', 'staff',
      'phone number', 'email', 'location', 'where are you', 'quezon city',
    ],
    weight: 1.1,
  ),
  GabayDoc(
    id: 'policy:gabay',
    topic: GabayTopic.about,
    title: 'What Gabay can do',
    body:
        'Gabay means guide. I can explain the packages and what they include, '
        'match one to your budget and headcount, suggest lighter dishes, build '
        'a planning checklist, explain why something was recommended, and '
        'answer booking, payment and allergen questions from the business\'s '
        'own answers. I will not invent a price, a dish, or a promise the '
        'kitchen has not made.',
    keywords: [
      'gabay', 'who are you', 'what can you do', 'help', 'assistant', 'bot',
      'chatbot', 'capabilities',
    ],
    weight: 1.1,
  ),
  GabayDoc(
    id: 'policy:layout',
    topic: GabayTopic.planning,
    title: 'Venue layout planning',
    body:
        'The 3D layout planner is where the room itself is arranged: tables, '
        'the buffet, the stage and the walkways, checked for overlaps and '
        'blocked paths. Gabay is the explainer, not the planner — tell me your '
        'occasion, headcount and budget and I will suggest a package and a '
        'planning checklist, and I can explain what a layout warning means.',
    keywords: [
      'layout', 'floor plan', 'venue layout', 'buffet', 'stage', 'tables',
      'walkway', '3d', 'planner', 'spacing',
    ],
    weight: 1,
  ),
];
