import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart' show debugPrint;

import 'booking.dart';
import 'notification_repository.dart';

/// Files catering bookings from the member "Book Us Now" wizard into the
/// `bookings` collection, one document per request:
/// { uid, status, createdAt, …the wizard's answers }.
///
/// Only non-blank answers are written — the paper booking form this mirrors
/// leaves plenty of blanks, and the moderator should only see what the client
/// actually filled in. `status` starts at `pending` for the moderator to
/// triage. A process-wide singleton, mirroring [CateringRepository].
///
/// Reads back the caller's own orders too ([watchMine]) — the Firestore rules
/// scope a customer's read to documents carrying their uid, which is what the
/// order tracking screen streams.
class BookingRepository {
  BookingRepository._();
  static final BookingRepository instance = BookingRepository._();
  factory BookingRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Submits a new booking and returns its document id. [fields] holds the
  /// wizard's answers keyed by field id (e.g. `kindOfFunction`, `soup`); blanks
  /// are dropped. Requires a signed-in customer — the Firestore rules only allow
  /// creates that carry the caller's own uid.
  ///
  /// [payment] carries the downpayment terms the wizard worked out
  /// (`paymentStatus`, `paymentTotal`, `paymentDue`). It's written on create so
  /// nothing the member filled in can be lost to a payment they abandon: the
  /// order lands as `awaiting`, and the payment screen — or a later visit to
  /// Order Tracking — moves it to `paid`.
  ///
  /// The id comes back because the payment that follows needs it: it travels to
  /// PayMongo as the checkout's reference number, which is what ties a payment
  /// in the PayMongo dashboard to the order it settled.
  Future<String> submit(
    Map<String, String> fields, {
    Map<String, Object?> payment = const {},
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('Booking requires a signed-in customer.');
    }
    final write = {
      for (final e in fields.entries)
        if (e.value.trim().isNotEmpty) e.key: e.value.trim(),
      ...payment,
      'uid': uid,
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
    };
    // Logged before the write so a permission-denied still leaves a record of
    // exactly what was sent — `uid`/`status` are the two the create rule
    // actually checks, and printing them here (rather than trusting the map
    // literal's override order by eye) is what actually proves they landed
    // right, instead of merely arguing that they should have.
    debugPrint(
      'BookingRepository.submit → uid=${write['uid']} '
      'status=${write['status']} authUid=$uid keys=${write.keys.toList()}',
    );
    final doc = await _db.collection('bookings').add(write);
    // Fire-and-forget: post a "Booking Received" notification so the member
    // sees it in their bell as soon as the wizard closes.
    unawaited(
      NotificationRepository.instance.postOrderUpdate(
        uid: uid,
        bookingId: doc.id,
        status: BookingStatus.pending,
      ),
    );
    return doc.id;
  }

  /// Saves (or updates) a "Continue later" draft of the catering wizard.
  ///
  /// [draftId] is null on the first save — a new `draft` document is created
  /// and its id returned — and the saved id on every save after, so
  /// "Continue later" tapped twice from the same session overwrites the one
  /// draft rather than piling up copies. `draftPackageId` and `draftStep`
  /// travel with the answers so [BookingPage] can re-open on the same package
  /// and land back on the page the member left off at; see [Booking.draftStep]
  /// and [Booking.draftPackageId].
  ///
  /// Unlike [submit], blanks ARE written (as deletes on update, simply omitted
  /// on create) — a draft is allowed to be incomplete, and a field the member
  /// cleared before saving again must actually clear, not linger from the
  /// first save.
  Future<String> saveDraft(
    Map<String, String> fields, {
    String? draftId,
    String? packageId,
    required int step,
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('Saving a draft requires a signed-in customer.');
    }
    final payload = {
      for (final e in fields.entries)
        if (e.value.trim().isNotEmpty) e.key: e.value.trim(),
      'draftStep': '$step',
      if ((packageId ?? '').isNotEmpty) 'draftPackageId': packageId,
      'bookingType': 'Catering',
      'status': 'draft',
      'uid': uid,
    };
    if (draftId == null) {
      final doc = await _db.collection('bookings').add({
        ...payload,
        'createdAt': FieldValue.serverTimestamp(),
      });
      return doc.id;
    }
    // Blanks a field the member cleared since the last save rather than
    // leaving its old value behind — set(merge:) only touches keys present
    // here, so an omitted (now-blank) field is deleted explicitly.
    final del = FieldValue.delete();
    final cleared = {
      for (final key in fields.keys)
        if (!payload.containsKey(key)) key: del,
    };
    await _db.collection('bookings').doc(draftId).set({
      ...payload,
      ...cleared,
      'statusUpdatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    return draftId;
  }

  /// Deletes a "Continue later" draft — from the resume card's own delete
  /// action, or once the wizard actually sends (see [BookingPage._submit]),
  /// so a sent booking never leaves a stale draft copy of itself behind.
  Future<void> deleteDraft(String draftId) =>
      _db.collection('bookings').doc(draftId).delete();

  /// Records the PayMongo checkout page opened for [bookingId], so a member who
  /// backs out mid-payment can be handed the same page again from Order
  /// Tracking rather than opening a second one.
  Future<void> attachCheckout(
    String bookingId, {
    required String sessionId,
    required String url,
  }) =>
      _db.collection('bookings').doc(bookingId).update({
        'checkoutSessionId': sessionId,
        'checkoutUrl': url,
      });

  /// Marks [bookingId]'s downpayment settled. Only ever called after PayMongo
  /// itself has confirmed the payment on the checkout session — never on the
  /// member's word that they've paid.
  ///
  /// [amount] is what actually cleared, per PayMongo, rather than what we asked
  /// for; the two should agree, and recording the former means a disagreement is
  /// visible to the team instead of papered over.
  Future<void> markPaid(
    String bookingId, {
    required num amount,
    String? paymentRef,
    String? method,
  }) =>
      _db.collection('bookings').doc(bookingId).update({
        'paymentStatus': 'paid',
        'paymentPaid': amount,
        'paidAt': FieldValue.serverTimestamp(),
        if ((paymentRef ?? '').isNotEmpty) 'paymentRef': paymentRef,
        if ((method ?? '').isNotEmpty) 'paymentMethod': method,
      });

  /// The signed-in member's own orders, newest first, streamed so a status move
  /// in the Orders dashboard reaches the tracking screen without a refresh.
  ///
  /// Only the uid is filtered server-side; the newest-first sort and the
  /// dropping of orders the team has trashed happen here, so this needs no
  /// composite Firestore index (a member's order list is small). Emits an empty
  /// list when nobody is signed in rather than throwing — the screen behind
  /// this is only reachable from the member side, but a sign-out mid-stream
  /// shouldn't surface as an error.
  Stream<List<Booking>> watchMine() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const []);
    return _db
        .collection('bookings')
        .where('uid', isEqualTo: uid)
        .snapshots()
        .map((snap) {
      final orders = snap.docs.map(Booking.fromDoc).where((b) => !b.deleted).toList()
        ..sort((a, b) {
          // Newest first; an order still waiting for its server timestamp
          // (offline write) sorts to the top, where it was just filed.
          final at = a.createdAt, bt = b.createdAt;
          if (at == null && bt == null) return 0;
          if (at == null) return -1;
          if (bt == null) return 1;
          return bt.compareTo(at);
        });
      return orders;
    });
  }
}
