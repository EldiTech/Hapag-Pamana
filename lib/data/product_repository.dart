import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'product.dart';

/// Reads the live `products` collection the Content Moderator publishes.
///
/// The app only ever shows products marked "Visible in app" (`available`).
/// Ordering and category filtering are done client-side so we don't depend on
/// composite Firestore indexes for a collection this small.
///
/// This is a process-wide singleton holding a single broadcast stream. Every
/// screen (Home, Menu, …) shares the one Firestore listener, so the products —
/// which carry inline base64 images and are therefore heavy — are downloaded
/// only once. The latest list is cached and replayed to any new subscriber
/// immediately, so switching tabs never re-triggers a load.
class ProductRepository {
  ProductRepository._();
  static final ProductRepository instance = ProductRepository._();

  /// Kept for call-site compatibility — always returns the shared singleton.
  factory ProductRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;

  StreamController<List<Product>>? _controller;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _source;
  List<Product>? _latest; // last emitted list, replayed to new listeners

  /// The most recently loaded visible products (empty before the first load).
  /// Lets a detail sheet aggregate a dish's category siblings synchronously
  /// without threading the list through every call site.
  List<Product> get latest => _latest ?? const [];

  /// All visible products, alphabetised by name. Streams live updates so menu
  /// edits in the moderator appear without a manual refresh. Shared across the
  /// whole app via a single underlying Firestore listener.
  Stream<List<Product>> watchVisible() {
    _controller ??= StreamController<List<Product>>.broadcast(
      onListen: _startSourceIfNeeded,
    );
    final stream = _controller!.stream;
    // Replay the cached list so a freshly-mounted screen paints instantly.
    final cached = _latest;
    if (cached != null) return stream.startWith(cached);
    return stream;
  }

  void _startSourceIfNeeded() {
    if (_source != null) return;
    _source = _db.collection('products').snapshots().listen(
      (snap) {
        final list = snap.docs
            .map(Product.fromDoc)
            .where((p) => p.available)
            .toList()
          ..sort(
            (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
          );
        _latest = list;
        _controller?.add(list);
      },
      onError: (Object e, StackTrace st) => _controller?.addError(e, st),
    );
  }
}

extension _StartWith<T> on Stream<T> {
  /// Emits [value] first, then the events of this stream.
  Stream<T> startWith(T value) async* {
    yield value;
    yield* this;
  }
}
