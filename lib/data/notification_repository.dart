import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import 'announcement.dart';
import 'announcement_repository.dart';
import 'member_preferences.dart';
import 'notification.dart';

/// Manages the member's in-app notification feed.
///
/// Two Firestore sources are merged:
///  - `notifications/{uid}/items` — per-user items (order updates, etc.)
///  - `announcements` via [AnnouncementRepository] — admin-pushed promotions visible to all.
///
/// The merged stream is the single source of truth for both the unread badge
/// (bell dot) and the full notification modal.
///
/// A process-wide singleton, mirroring [ProductRepository].
class NotificationRepository {
  NotificationRepository._() {
    _initSeenSync();
  }
  static final NotificationRepository instance = NotificationRepository._();
  factory NotificationRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Announcement ids the current user has already seen.
  final Set<String> _seenAnnouncements = {};
  final StreamController<Set<String>> _seenController =
      StreamController<Set<String>>.broadcast();

  String? get _uid => _auth.currentUser?.uid;

  CollectionReference<Map<String, dynamic>> _items(String uid) =>
      _db.collection('notifications').doc(uid).collection('items');

  void _initSeenSync() {
    _auth.authStateChanges().listen((user) {
      if (user == null) {
        _seenAnnouncements.clear();
        _seenController.add(_seenAnnouncements);
      }
    });
  }

  // ─────────────────────────── Reads ───────────────────────────────────────

  /// A merged, newest-first stream of all notifications for the user / guest.
  /// Each emission replaces the previous list in full.
  Stream<List<AppNotification>> watchAll() {
    final uid = _uid;

    final Stream<List<AppNotification>> personalStream = uid != null
        ? _items(uid)
              .orderBy('createdAt', descending: true)
              .limit(50)
              .snapshots()
              .map((snap) => snap.docs.map(AppNotification.fromDoc).toList())
              .handleError((e) {
                debugPrint('NotificationRepository personalStream error: $e');
                return <AppNotification>[];
              })
        : Stream.value(<AppNotification>[]);

    final Stream<List<Announcement>> annStream = AnnouncementRepository.instance
        .watchPublished();

    return _combine(personalStream, annStream);
  }

  /// A stream that emits the count of unread notifications for the badge.
  Stream<int> watchUnreadCount() =>
      watchAll().map((list) => list.where((n) => !n.isRead).length);

  /// Convenience: true when there is at least one unread notification.
  Stream<bool> watchHasUnread() => watchUnreadCount().map((c) => c > 0);

  // ─────────────────────────── Writes ──────────────────────────────────────

  /// Marks every notification in [current] as read.
  ///
  /// Called when the notification modal is opened or refreshed.
  Future<void> markAllRead(List<AppNotification> current) async {
    final uid = _uid;
    bool changedSeen = false;

    WriteBatch? batch;
    if (uid != null) {
      batch = _db.batch();
    }

    for (final n in current) {
      if (n.isRead) continue;
      if (n.id.startsWith('ann-')) {
        _seenAnnouncements.add(n.id);
        changedSeen = true;
      } else if (uid != null && batch != null) {
        batch.update(_items(uid).doc(n.id), {'isRead': true});
      }
    }

    if (changedSeen) {
      _seenController.add(Set<String>.from(_seenAnnouncements));
    }

    if (batch != null) {
      try {
        await batch.commit();
      } catch (e) {
        debugPrint('NotificationRepository.markAllRead error: $e');
      }
    }
  }

  /// Marks a single notification as read by id.
  Future<void> markRead(String id) async {
    if (id.startsWith('ann-')) {
      if (!_seenAnnouncements.contains(id)) {
        _seenAnnouncements.add(id);
        _seenController.add(Set<String>.from(_seenAnnouncements));
      }
      return;
    }
    final uid = _uid;
    if (uid == null) return;
    try {
      await _items(uid).doc(id).update({'isRead': true});
    } catch (e) {
      debugPrint('NotificationRepository.markRead error: $e');
    }
  }

  // ─────────────────────────── Helpers ─────────────────────────────────────

  /// Combines personal items, live published announcements, and seen states.
  Stream<List<AppNotification>> _combine(
    Stream<List<AppNotification>> personalStream,
    Stream<List<Announcement>> announcementsStream,
  ) {
    late StreamController<List<AppNotification>> controller;
    List<AppNotification> latestPersonal = [];
    List<Announcement> latestAnnouncements = [];
    Set<String> seenSet = Set<String>.from(_seenAnnouncements);

    void emit() {
      if (controller.isClosed) return;

      final prefs = MemberPreferencesScope.value;
      final showPromos = prefs.promotions;

      final annItems = showPromos
          ? latestAnnouncements.map((a) {
              final notifId = 'ann-${a.id}';
              final isRead = seenSet.contains(notifId);
              return AppNotification.fromAnnouncementModel(a, isRead);
            }).toList()
          : <AppNotification>[];

      final merged = [...latestPersonal, ...annItems]
        ..sort((x, y) => y.createdAt.compareTo(x.createdAt));

      controller.add(merged);
    }

    StreamSubscription<List<AppNotification>>? subP;
    StreamSubscription<List<Announcement>>? subA;
    StreamSubscription<Set<String>>? subS;

    controller = StreamController<List<AppNotification>>(
      onListen: () {
        subP = personalStream.listen(
          (list) {
            latestPersonal = list;
            emit();
          },
          onError: (e) {
            latestPersonal = [];
            emit();
          },
        );
        subA = announcementsStream.listen(
          (list) {
            latestAnnouncements = list;
            emit();
          },
          onError: (e) {
            latestAnnouncements = [];
            emit();
          },
        );
        subS = _seenController.stream.listen((seen) {
          seenSet = seen;
          emit();
        });
        // Initial emit with whatever cache exists
        emit();
      },
      onCancel: () {
        subP?.cancel();
        subA?.cancel();
        subS?.cancel();
      },
    );

    return controller.stream;
  }
}
