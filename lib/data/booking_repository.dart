import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Files catering bookings from the member "Book Us Now" wizard into the
/// `bookings` collection, one document per request:
/// { uid, status, createdAt, …the wizard's answers }.
///
/// Only non-blank answers are written — the paper booking form this mirrors
/// leaves plenty of blanks, and the moderator should only see what the client
/// actually filled in. `status` starts at `pending` for the moderator to
/// triage. A process-wide singleton, mirroring [CateringRepository].
class BookingRepository {
  BookingRepository._();
  static final BookingRepository instance = BookingRepository._();
  factory BookingRepository() => instance;

  final FirebaseFirestore _db = FirebaseFirestore.instance;
  final FirebaseAuth _auth = FirebaseAuth.instance;

  /// Submits a new booking. [fields] holds the wizard's answers keyed by
  /// field id (e.g. `kindOfFunction`, `soup`); blanks are dropped. Requires a
  /// signed-in customer — the Firestore rules only allow creates that carry
  /// the caller's own uid.
  Future<void> submit(Map<String, String> fields) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('Booking requires a signed-in customer.');
    }
    await _db.collection('bookings').add({
      for (final e in fields.entries)
        if (e.value.trim().isNotEmpty) e.key: e.value.trim(),
      'uid': uid,
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}
