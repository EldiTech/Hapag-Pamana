import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

/// The crowd signal: how often each pair of menu items has been ordered
/// together, across every customer.
///
/// ## Why this collection exists
///
/// A member may only read their own bookings (see the `bookings` rule in
/// firestore.rules), so the app can never work out for itself what is ordered
/// *together* across the customer base — which is exactly what collaborative
/// filtering needs. The Orders dashboard can read every booking, so it keeps the
/// tally: when a manager marks an order completed, it records a `+1` against
/// every pair of items on that order (see `Admin/assets/hp-recommend.js`).
///
/// The app reads the result. That is safe by construction — a document holds two
/// item ids and a count, and never records who ordered them, so no member learns
/// anything about another from the whole table. Only an order manager may write
/// it, which is what stops a member promoting their own favourites into
/// everyone else's picks.
///
/// ## Why the whole table is read at once
///
/// Firestore's `array-contains-any` caps at 30 values, and a member's history
/// can exceed that, so a targeted query would be several round-trips that still
/// need merging client-side. The documents are tiny (two ids and a number) and
/// the table grows with the *menu* squared, not with the customer base — a
/// hundred items is at most a few thousand rows. One cached, shared listener is
/// cheaper than the query gymnastics, and it means the strip recomputes locally
/// the moment a new order lands anywhere.
///
/// A process-wide singleton over one shared broadcast stream, mirroring
/// [ProductRepository]: every surface that wants the signal shares one listener,
/// and a newly-mounted screen gets the cached table replayed immediately.
class CoOccurrenceRepository {
  CoOccurrenceRepository._();
  static final CoOccurrenceRepository instance = CoOccurrenceRepository._();

  /// Kept for call-site symmetry — always returns the shared singleton.
  factory CoOccurrenceRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;

  StreamController<CoOccurrenceTable>? _controller;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _source;
  CoOccurrenceTable? _latest;

  /// The live pair tally. Empty before the first load, and empty on a read
  /// error — the engine treats "no crowd signal" and "couldn't fetch it" alike,
  /// falling back to the member's own history.
  Stream<CoOccurrenceTable> watch() {
    _controller ??= StreamController<CoOccurrenceTable>.broadcast(
      onListen: _startIfNeeded,
    );
    final stream = _controller!.stream;
    final cached = _latest;
    if (cached != null) return stream.startWith(cached);
    return stream;
  }

  void _startIfNeeded() {
    if (_source != null) return;
    _source = _db.collection('co_occurrences').snapshots().listen(
      (snap) {
        final table = CoOccurrenceTable.fromDocs(snap.docs);
        _latest = table;
        _controller?.add(table);
      },
      // An empty table rather than an error: the crowd signal is the strongest
      // tier the engine has, but it is still only a tier — a member whose read
      // fails should drop to their own history, not to a broken strip.
      onError: (Object _, StackTrace _) =>
          _controller?.add(const CoOccurrenceTable.empty()),
    );
  }
}

/// The pair tally, indexed for lookup: for any item, what else has been ordered
/// alongside it and how often.
class CoOccurrenceTable {
  const CoOccurrenceTable(this._neighbours);

  /// No signal at all — a fresh install, a kitchen with no completed orders
  /// yet, or a failed read.
  const CoOccurrenceTable.empty() : _neighbours = const {};

  factory CoOccurrenceTable.fromDocs(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> docs,
  ) {
    final neighbours = <String, Map<String, int>>{};
    for (final doc in docs) {
      final d = doc.data();
      final items = d['items'];
      final rawCount = d['count'];
      final count = rawCount is num ? rawCount.toInt() : 0;
      if (items is! List || items.length != 2 || count <= 0) continue;
      final a = items[0].toString();
      final b = items[1].toString();
      if (a.isEmpty || b.isEmpty || a == b) continue;
      // Stored once per unordered pair, so it's indexed both ways here — the
      // lookup asks "what goes with X" without caring which side X was on.
      (neighbours[a] ??= <String, int>{})[b] = count;
      (neighbours[b] ??= <String, int>{})[a] = count;
    }
    return CoOccurrenceTable(neighbours);
  }

  final Map<String, Map<String, int>> _neighbours;

  bool get isEmpty => _neighbours.isEmpty;
  bool get isNotEmpty => _neighbours.isNotEmpty;

  /// What has been ordered alongside [itemId], and how often. Empty when the
  /// item has never appeared in a completed order with anything else.
  Map<String, int> neighboursOf(String itemId) =>
      _neighbours[itemId] ?? const <String, int>{};
}

extension _StartWith<T> on Stream<T> {
  /// Emits [value] first, then the events of this stream.
  Stream<T> startWith(T value) async* {
    yield value;
    yield* this;
  }
}
