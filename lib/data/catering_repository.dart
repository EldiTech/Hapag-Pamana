import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'catering.dart';

/// Live reads of the catering content the moderator publishes — the `packages`
/// collection and the `setups` photo gallery.
///
/// Mirrors `ProductRepository`: a process-wide singleton with each collection
/// behind a single shared broadcast stream whose latest snapshot is replayed to
/// new listeners. Switching tabs therefore never re-downloads the (heavy,
/// base64) setup images.
class CateringRepository {
  CateringRepository._();
  static final CateringRepository instance = CateringRepository._();
  factory CateringRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;

  late final _LiveCollection<CateringPackage> _packages =
      _LiveCollection<CateringPackage>(
        _db.collection('packages'),
        CateringPackage.fromDoc,
        (list) =>
            list.where((p) => p.active).toList()
              ..sort((a, b) => a.price.compareTo(b.price)),
      );

  late final _LiveCollection<EventSetup> _setups = _LiveCollection<EventSetup>(
    _db.collection('setups'),
    EventSetup.fromDoc,
    (list) =>
        list.where((s) => s.visible).toList()
          ..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
  );

  /// Active packages, cheapest per-head first.
  Stream<List<CateringPackage>> watchPackages() => _packages.watch();

  /// Visible event setups, newest first.
  Stream<List<EventSetup>> watchSetups() => _setups.watch();
}

/// A single Firestore collection exposed as one shared, replayed broadcast
/// stream. [_shape] filters + sorts each raw snapshot into the list the app
/// shows.
class _LiveCollection<T> {
  _LiveCollection(this._ref, this._fromDoc, this._shape);

  final CollectionReference<Map<String, dynamic>> _ref;
  final T Function(DocumentSnapshot<Map<String, dynamic>>) _fromDoc;
  final List<T> Function(List<T>) _shape;

  StreamController<List<T>>? _controller;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _source;
  List<T>? _latest;

  Stream<List<T>> watch() {
    _controller ??= StreamController<List<T>>.broadcast(onListen: _startIfNeeded);
    final stream = _controller!.stream;
    final cached = _latest;
    return cached != null ? stream.startWith(cached) : stream;
  }

  void _startIfNeeded() {
    if (_source != null) return;
    _source = _ref.snapshots().listen(
      (snap) {
        final list = _shape(snap.docs.map(_fromDoc).toList());
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
