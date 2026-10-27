import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'announcement.dart';

/// Reads the live `announcements` collection published by Content Moderators.
///
/// The user app only displays announcements marked with `status == 'published'`.
/// Ordering is done by publication date (newest first).
///
/// This is a process-wide singleton with a broadcast stream controller so every
/// screen shares a single Firestore snapshot listener.
class AnnouncementRepository {
  AnnouncementRepository._();
  static final AnnouncementRepository instance = AnnouncementRepository._();

  factory AnnouncementRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;

  StreamController<List<Announcement>>? _controller;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _source;
  List<Announcement>? _latest;

  /// The most recently loaded published announcements.
  List<Announcement> get latest => _latest ?? const [];

  /// Streams all published announcements in real-time, newest-first.
  Stream<List<Announcement>> watchPublished() {
    _controller ??= StreamController<List<Announcement>>.broadcast(
      onListen: _startSourceIfNeeded,
    );
    final stream = _controller!.stream;
    final cached = _latest;
    if (cached != null) return stream.startWith(cached);
    return stream;
  }

  void _startSourceIfNeeded() {
    if (_source != null) return;
    _source = _db
        .collection('announcements')
        .snapshots()
        .listen(
      (snap) {
        final list = snap.docs
            .map(Announcement.fromDoc)
            .where((a) => a.isPublished)
            .toList()
          ..sort((a, b) {
            final tA = a.publishedAt ?? a.createdAt;
            final tB = b.publishedAt ?? b.createdAt;
            return tB.compareTo(tA);
          });
        _latest = list;
        _controller?.add(list);
      },
      onError: (Object e, StackTrace st) {
        debugPrint('AnnouncementRepository snapshot error: $e');
        _controller?.addError(e, st);
      },
    );
  }
}

extension _StartWith<T> on Stream<T> {
  Stream<T> startWith(T value) async* {
    yield value;
    yield* this;
  }
}
