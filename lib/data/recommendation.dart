import 'package:cloud_firestore/cloud_firestore.dart';

import 'catering.dart';
import 'product.dart';

/// Why a member is being shown what they're being shown.
///
/// The four sources are a fallback chain, strongest first: what other customers
/// ordered alongside this member's choices, then the member's own history, then
/// their taste-quiz answers, then the moderator's featured picks. Gabay names
/// the source on the panel — a recommendation that can't say why it's there is
/// just an advert.
///
/// Each label claims exactly as much as its tier can support, and no more. Only
/// [crowd] draws on other customers (through the `co_occurrences` tally the
/// Orders dashboard keeps), so only [crowd] may say so; [cf] is one member's own
/// orders reflected back, so it says "your".
enum RecommendationSource {
  /// Item-based collaborative filtering over the whole customer base's completed
  /// orders — the only tier that knows anything beyond this one member.
  crowd('crowd', 'Ordered with your favourites'),

  /// Content-based filtering over the member's own completed bookings.
  cf('cf', 'Based on your past orders'),

  /// From the sign-up quiz, before this member has ordered anything.
  tasteProfile('taste_profile', 'Based on your taste profile'),

  /// Nothing to go on yet — the moderator's featured dishes stand in.
  featured('featured', 'Featured by the kitchen');

  const RecommendationSource(this.wire, this.label);

  /// The value a stored set carries in
  /// `customers/{uid}.recommendations.source`. Kept stable so a future backend
  /// and this app agree on the vocabulary.
  final String wire;

  /// The badge shown beside the panel heading.
  final String label;

  /// Resolves a stored value, falling back to [featured] — the weakest claim,
  /// which is the right thing to say when we can't tell what produced the list.
  static RecommendationSource parse(Object? raw) {
    for (final v in values) {
      if (v.wire == raw) return v;
    }
    return RecommendationSource.featured;
  }
}

/// A recommendation set stored on `customers/{uid}.recommendations`.
///
/// Nothing writes this field today — recommendations are computed on the device
/// by [RecommendationEngine], and firestore.rules forbids a client to write here
/// at all. It is read anyway, and preferred over the local computation when
/// present, so that adding a server-side engine later is a deploy rather than a
/// refactor.
///
/// [items] are opaque ids — a `products` id or a `packages` id — since dishes
/// and packages are both recommendable. [RecommendationRepository.resolveItems]
/// turns them back into things with a name and a picture.
class Recommendations {
  const Recommendations({
    this.items = const <String>[],
    this.source = RecommendationSource.featured,
    this.computedAt,
  });

  factory Recommendations.fromMap(Object? raw) {
    if (raw is! Map) return const Recommendations();
    final items = raw['items'];
    final at = raw['computedAt'];
    return Recommendations(
      items: items is! List
          ? const <String>[]
          : [
              for (final e in items)
                if (e.toString().trim().isNotEmpty) e.toString().trim(),
            ],
      source: RecommendationSource.parse(raw['source']),
      computedAt: at is Timestamp ? at.toDate() : null,
    );
  }

  /// Top-N product / package ids, best first.
  final List<String> items;

  final RecommendationSource source;

  final DateTime? computedAt;

  bool get isEmpty => items.isEmpty;
}

/// One resolved recommendation — an id matched back to the live menu.
///
/// Exactly one of [product] / [package] is set. A sealed pair rather than a
/// common supertype because the two render differently (a dish opens its
/// quick-look sheet, a package opens the booking wizard) and the call sites need
/// to know which they hold.
class RecommendedItem {
  const RecommendedItem.dish(Product this.product) : package = null;
  const RecommendedItem.package(CateringPackage this.package) : product = null;

  final Product? product;
  final CateringPackage? package;

  bool get isPackage => package != null;

  String get id => product?.id ?? package!.id;

  String get name => product?.name ?? package!.name;

  /// The line under the name — a dish's menu category, a package's family.
  String get subtitle =>
      product?.category ??
      (package!.isFoodPack ? 'Food pack' : 'Catering package');

  /// The item's photo, in whichever form the moderator uploaded it. Empty when
  /// there isn't one.
  String get image => product?.image ?? package!.image;
}

/// A resolved recommendation strip — the items to draw and an honest account of
/// where they came from.
///
/// Lives here beside [RecommendationSource] rather than with the repository that
/// builds it, because both the engine that computes a set and the repository
/// that serves one need to name this type, and the repository already imports
/// the engine.
class RecommendationSet {
  const RecommendationSet({required this.items, required this.source});

  static const RecommendationSet empty = RecommendationSet(
    items: <RecommendedItem>[],
    source: RecommendationSource.featured,
  );

  final List<RecommendedItem> items;
  final RecommendationSource source;

  bool get isEmpty => items.isEmpty;
  bool get isNotEmpty => items.isNotEmpty;
}
