import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'booking.dart';
import 'booking_repository.dart';
import 'catering.dart';
import 'catering_repository.dart';
import 'co_occurrence_repository.dart';
import 'customer_repository.dart';
import 'product.dart';
import 'product_repository.dart';
import 'recommendation.dart';
import 'recommendation_engine.dart';
import 'taste_profile.dart';

// The screens import this repository to get a strip; re-exporting the value
// types it hands them saves every call site a second import.
export 'recommendation.dart'
    show RecommendationSet, RecommendationSource, RecommendedItem;

/// How many recommendations the member side shows.
const int kRecommendationCount = 5;

/// Supplies the member side's recommendations, and keeps the taste profile the
/// sign-up quiz collects.
///
/// ## Where the picks come from
///
/// They are computed **on the device**, by [RecommendationEngine], from four
/// inputs: the crowd's co-occurrence tally, this member's own completed
/// bookings, their taste-quiz answers, and the live menu.
///
/// The crowd tally is the interesting one. Real collaborative filtering needs to
/// see across the customer base, and a client may only read its own bookings —
/// so the app cannot derive it. The Orders dashboard can: it reads every order,
/// and when a manager completes one it records the pairs into `co_occurrences`
/// (see `Admin/assets/hp-recommend.js`). That table holds item ids and counts
/// and never says who ordered what, so the app may read it freely while no
/// member learns anything about another.
///
/// Doing the derivation in a staff browser instead of a database trigger is a
/// real trade — the tally advances on human behaviour, not on every write — and
/// it's what keeps this feature free of a billing plan.
///
/// The seam for a backend stays clean: if a server-side engine is ever added it
/// writes `customers/{uid}.recommendations`, and [watchRecommended] prefers that
/// set over the locally computed one automatically — see [_merge].
///
/// A process-wide singleton, mirroring [ProductRepository] and
/// [CustomerRepository].
class RecommendationRepository {
  RecommendationRepository._();
  static final RecommendationRepository instance = RecommendationRepository._();

  /// Kept for call-site symmetry — always returns the shared singleton.
  factory RecommendationRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final CustomerRepository _customers = CustomerRepository();
  final ProductRepository _products = ProductRepository();
  final CateringRepository _packages = CateringRepository();
  final BookingRepository _bookings = BookingRepository();
  final CoOccurrenceRepository _crowd = CoOccurrenceRepository();

  // ── The taste profile ──────────────────────────────────────────────────────

  /// Reads the signed-in member's taste profile. Returns an empty (uncompleted)
  /// profile when signed out, when the document is missing, or when the member
  /// has never taken the quiz — all three mean the same thing to the caller:
  /// there's nothing to go on yet.
  Future<TasteProfile> fetchTasteProfile() async {
    final uid = _customers.currentUid;
    if (uid == null) return const TasteProfile();
    try {
      final doc = await _db.collection('customers').doc(uid).get();
      final raw = (doc.data() ?? const {})['tasteProfile'];
      return TasteProfile.fromMap(
        raw is Map ? raw.cast<String, Object?>() : null,
      );
    } catch (_) {
      // Offline, or a profile written before the quiz existed. Treated as
      // "not taken" — the quiz is re-offerable, so this can only cost a re-ask.
      return const TasteProfile();
    }
  }

  /// The signed-in member's taste profile, live. Empty when signed out, and on a
  /// read error — both mean "nothing to go on", which the engine handles by
  /// falling through to featured dishes.
  Stream<TasteProfile> watchTasteProfile() {
    final uid = _customers.currentUid;
    if (uid == null) return Stream.value(const TasteProfile());
    return _db
        .collection('customers')
        .doc(uid)
        .snapshots()
        .map((doc) {
          final raw = (doc.data() ?? const {})['tasteProfile'];
          return TasteProfile.fromMap(
            raw is Map ? raw.cast<String, Object?>() : null,
          );
        })
        .transform(_recoverWith(const TasteProfile()));
  }

  /// Writes [profile] to `customers/{uid}.tasteProfile`, marking it completed.
  ///
  /// Merges, so it never clobbers the profile fields beside it, and — like
  /// [CustomerRepository.savePreferences] — rides the existing owner-update rule
  /// (it touches neither `banned` nor `bannedAt`, nor the `recommendations`
  /// field the rules reserve for a backend).
  ///
  /// Throws [FirebaseException] on a rejected or failed write; the quiz surfaces
  /// it rather than pretending the answers were saved.
  Future<void> saveTasteProfile(TasteProfile profile) async {
    final uid = _customers.currentUid;
    if (uid == null) return;
    await _db.collection('customers').doc(uid).set({
      'tasteProfile': profile.copyWith(completed: true).toMap(),
    }, SetOptions(merge: true));
  }

  // ── The recommendations ────────────────────────────────────────────────────

  /// Any server-written recommendation set on this member's profile.
  ///
  /// Always empty today — nothing writes the field, and the rules forbid the
  /// client to. Kept because it costs one already-open document listener and it
  /// is the whole handover path for a future backend: the day something server-
  /// side writes here, [watchRecommended] starts preferring it with no change to
  /// any call site.
  Stream<Recommendations> watchStored() {
    final uid = _customers.currentUid;
    if (uid == null) return Stream.value(const Recommendations());
    return _db
        .collection('customers')
        .doc(uid)
        .snapshots()
        .map(
          (doc) => Recommendations.fromMap(
            (doc.data() ?? const {})['recommendations'],
          ),
        )
        .transform(_recoverWith(const Recommendations()));
  }

  /// The member's recommendations, ready to render — at most [limit] items,
  /// best first, carrying an honest account of which tier produced them.
  ///
  /// Re-emits whenever anything it depends on changes: a new completed booking,
  /// an edited quiz answer, or a menu change from the moderator. So a dish that
  /// gets hidden leaves the strip without a restart.
  Stream<RecommendationSet> watchRecommended({
    int limit = kRecommendationCount,
  }) {
    // Order matters — the indexes below are read back positionally.
    return _combineLatest([
      watchStored(),
      watchTasteProfile(),
      _bookings.watchMine(),
      _products.watchVisible(),
      _packages.watchPackages(),
      _crowd.watch(),
    ]).map(
      (v) => _merge(
        stored: v[0] as Recommendations,
        profile: v[1] as TasteProfile,
        history: (v[2] as List).cast<Booking>(),
        products: (v[3] as List).cast<Product>(),
        packages: (v[4] as List).cast<CateringPackage>(),
        table: v[5] as CoOccurrenceTable,
        limit: limit,
      ),
    );
  }

  /// A one-shot read of the same thing, for a caller that only needs a snapshot.
  Future<RecommendationSet> fetchForUser({int limit = kRecommendationCount}) =>
      watchRecommended(limit: limit).first;

  /// Prefers a server-computed set over the locally computed one, and falls back
  /// to the local engine whenever there isn't one (which is always, today).
  ///
  /// A server set that resolves to nothing — every id stale — is treated as
  /// absent rather than as an empty answer, so a backend that goes quiet degrades
  /// into on-device picks instead of into a blank strip.
  static RecommendationSet _merge({
    required Recommendations stored,
    required TasteProfile profile,
    required List<Booking> history,
    required List<Product> products,
    required List<CateringPackage> packages,
    required CoOccurrenceTable table,
    required int limit,
  }) {
    if (stored.items.isNotEmpty) {
      final resolved = resolveItems(stored, products, packages, limit: limit);
      if (resolved.isNotEmpty) return resolved;
    }
    return RecommendationEngine.compute(
      history: history,
      profile: profile,
      products: products,
      packages: packages,
      table: table,
      limit: limit,
    );
  }

  /// Turns a stored id list into renderable items against the menu it was
  /// computed over. Only reachable via a server-written set; kept public because
  /// it is the rule a future backend's output is read by, and it is tested as
  /// such.
  ///
  /// Pure — no Firestore, no singletons.
  static RecommendationSet resolveItems(
    Recommendations recs,
    List<Product> products,
    List<CateringPackage> packages, {
    int limit = kRecommendationCount,
  }) {
    final byProductId = {for (final p in products) p.id: p};
    final byPackageId = {for (final p in packages) p.id: p};

    final resolved = <RecommendedItem>[];
    for (final id in recs.items) {
      if (resolved.length >= limit) break;
      final product = byProductId[id];
      if (product != null) {
        resolved.add(RecommendedItem.dish(product));
        continue;
      }
      final package = byPackageId[id];
      if (package != null) resolved.add(RecommendedItem.package(package));
      // Anything else is a stale id — a dish the moderator has since hidden or
      // a package they retired. Dropped silently: the member shouldn't see a
      // gap where the kitchen changed its mind.
    }

    return RecommendationSet(items: resolved, source: recs.source);
  }

  /// Turns a stream error into a value, so one failing source can't take the
  /// whole combined strip down. Passing the error on would break a feature that
  /// is only ever a bonus; swallowing it would leave the strip waiting on a
  /// stream that never speaks again.
  static StreamTransformer<T, T> _recoverWith<T>(T fallback) =>
      StreamTransformer<T, T>.fromHandlers(
        handleError: (_, _, sink) => sink.add(fallback),
      );

  /// Emits the latest value of every source, in the order given, whenever any
  /// of them emits — once all have produced a first value.
  ///
  /// Written by hand rather than pulled in from rxdart: this is the only place
  /// in the app that needs a combine, and the project carries no
  /// reactive-streams dependency. Untyped ([Object?]) because Dart can't express
  /// a heterogeneous list; the one call site casts positionally, which is why
  /// its argument order carries a warning comment.
  static Stream<List<Object?>> _combineLatest(List<Stream<Object?>> sources) {
    late StreamController<List<Object?>> controller;
    final subs = <StreamSubscription<Object?>>[];
    final latest = List<Object?>.filled(sources.length, null);
    final seen = List<bool>.filled(sources.length, false);

    controller = StreamController<List<Object?>>(
      onListen: () {
        for (var i = 0; i < sources.length; i++) {
          final index = i;
          subs.add(
            sources[index].listen((value) {
              latest[index] = value;
              seen[index] = true;
              if (seen.every((s) => s)) {
                // A copy per emission — handing out the mutable buffer would
                // let a listener see it change under them on the next event.
                controller.add(List<Object?>.of(latest));
              }
            }, onError: controller.addError),
          );
        }
      },
      onCancel: () async {
        for (final s in subs) {
          await s.cancel();
        }
        subs.clear();
      },
    );
    return controller.stream;
  }
}
