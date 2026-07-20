import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'customer.dart';

/// Thrown by [CustomerRepository.signUp] when a field that must be unique is
/// already registered to another account. [field] is `'phone'` (email
/// duplicates are caught by Firebase Auth as `email-already-in-use`).
class DuplicateAccountException implements Exception {
  const DuplicateAccountException(this.field, this.message);

  final String field;
  final String message;

  @override
  String toString() => 'DuplicateAccountException($field): $message';
}

/// Thrown by [CustomerRepository.signIn] when the account's profile carries
/// the `banned` flag (written by the dashboard's User Management page). The
/// credentials were correct — the account is simply not allowed in.
class AccountBannedException implements Exception {
  const AccountBannedException();

  @override
  String toString() => 'AccountBannedException';
}

/// Owns customer authentication and the `customers` Firestore collection.
///
/// Sign-up is two steps that must both succeed: create the Firebase Auth
/// email/password account (which also signs the user in), then write the
/// profile to `customers/{uid}`. The Firestore rules only let a signed-in user
/// write their own `customers/{uid}` doc, so the auth step has to come first.
///
/// A process-wide singleton, mirroring [ProductRepository].
class CustomerRepository {
  CustomerRepository._();
  static final CustomerRepository instance = CustomerRepository._();

  /// Kept for call-site symmetry — always returns the shared singleton.
  factory CustomerRepository() => instance;

  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  /// The currently signed-in customer's uid, or null when browsing as a guest.
  String? get currentUid => _auth.currentUser?.uid;

  /// True when a customer is signed in (used to route straight to the member
  /// side on launch).
  bool get isSignedIn => _auth.currentUser != null;

  /// Display name set at sign-up, or null. Cheap (no Firestore read) — handy
  /// for the member home greeting.
  String? get displayName => _auth.currentUser?.displayName;

  /// The signed-in customer's email, or null.
  String? get email => _auth.currentUser?.email;

  /// Creates an email/password account and writes the customer profile to
  /// `customers/{uid}`. Returns the new [Customer].
  ///
  /// Throws [FirebaseAuthException] when the account can't be created
  /// (`email-already-in-use`, `invalid-email`, `weak-password`, or
  /// `operation-not-allowed` when Email/Password sign-in isn't enabled in the
  /// Firebase console); callers map these to field messages.
  Future<Customer> signUp({
    required String name,
    required String email,
    required String phone,
    required String password,
  }) async {
    // Email uniqueness is enforced by Firebase Auth itself (it throws
    // `email-already-in-use`). Phone uniqueness is enforced here: a
    // `customer_phones/{digits}` index doc is written in the *same* transaction
    // as the profile, so two accounts can never end up sharing a number — even
    // if both sign up at the same instant (the loser's transaction sees the
    // doc and aborts).
    final cred = await _auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );
    final user = cred.user!;

    final customer = Customer(
      uid: user.uid,
      name: name,
      email: email,
      phone: phone,
    );
    final phoneRef = _db.collection('customer_phones').doc(_phoneKey(phone));
    final customerRef = _db.collection('customers').doc(user.uid);

    try {
      await _db.runTransaction((txn) async {
        final taken = await txn.get(phoneRef);
        if (taken.exists) {
          throw const DuplicateAccountException(
            'phone',
            'That phone number is already registered.',
          );
        }
        txn.set(phoneRef, {
          'uid': user.uid,
          'createdAt': FieldValue.serverTimestamp(),
        });
        txn.set(customerRef, customer.toCreateMap());
      });
    } catch (_) {
      // The auth account is created before we can know the phone is taken, so
      // roll it back: this frees the email and leaves no orphan (profile-less)
      // account behind.
      try {
        await user.delete();
      } catch (_) {
        // ignore — nothing more we can do; the account stays but is harmless.
      }
      rethrow;
    }

    // Surface the name on the auth record too, so it's available without a
    // Firestore read (e.g. in the member home greeting).
    await user.updateDisplayName(name);
    return customer;
  }

  /// Normalises a phone number to a canonical key used as the
  /// `customer_phones` document id, so the same number written in different
  /// styles maps to one entry.
  ///
  /// Strips everything but digits, then folds the standard Philippine mobile
  /// forms to the 10-digit national number (e.g. `9171234567`):
  ///   • `+63 917 123 4567` / `639171234567` → drop the `63` country code
  ///   • `0917 123 4567` / `09171234567`     → drop the trunk `0`
  /// So "+63 917 123 4567", "0917-123-4567" and "0917 123 4567" all collide.
  /// (Landline numbers aren't country-code-folded — mobiles are the common
  /// case here.)
  static String _phoneKey(String phone) {
    var d = phone.replaceAll(RegExp(r'\D'), '');
    if (d.startsWith('63') && d.length == 12) {
      d = d.substring(2); // +63 / 63 country code → national number
    } else if (d.startsWith('0') && d.length == 11) {
      d = d.substring(1); // trunk 0 → national number
    }
    return d;
  }

  /// Signs an existing customer in with email/password.
  ///
  /// Throws [FirebaseAuthException] on failure (`invalid-credential`,
  /// `wrong-password`, `user-not-found`, `invalid-email`, `user-disabled`,
  /// `too-many-requests`, `operation-not-allowed`) and
  /// [AccountBannedException] when the credentials are right but the account
  /// is banned; callers map these to field messages or a SnackBar.
  Future<void> signIn({
    required String email,
    required String password,
  }) async {
    final cred = await _auth.signInWithEmailAndPassword(
      email: email,
      password: password,
    );
    // A banned member may authenticate but never enters the member side: the
    // dashboard writes customers/{uid}.banned and the app honours it here.
    // A failed profile read (offline, missing doc) lets the sign-in stand —
    // the member shell's live watcher is the backstop.
    bool banned;
    try {
      final doc =
          await _db.collection('customers').doc(cred.user!.uid).get();
      banned = (doc.data() ?? const {})['banned'] == true;
    } catch (_) {
      banned = false;
    }
    if (banned) {
      await _auth.signOut();
      throw const AccountBannedException();
    }
  }

  /// Signs the current customer out, returning the app to the guest side.
  Future<void> signOut() => _auth.signOut();

  /// Emits whether the signed-in customer is banned, live. The member shell
  /// listens so a ban flagged on the dashboard takes effect the moment it's
  /// written — the member is signed out mid-session, not just at next login.
  /// Empty when signed out; errors (e.g. the permission drop right after the
  /// forced sign-out) should be ignored by the listener.
  Stream<bool> watchBanned() {
    final uid = currentUid;
    if (uid == null) return const Stream.empty();
    return _db
        .collection('customers')
        .doc(uid)
        .snapshots()
        .map((doc) => (doc.data() ?? const {})['banned'] == true);
  }

  /// Emails [email] a Firebase password-reset link.
  ///
  /// Throws [FirebaseAuthException] (`invalid-email`, `user-not-found`,
  /// `too-many-requests`). Callers should present `user-not-found` exactly
  /// like success so the form can't be used to probe which emails have
  /// accounts (newer Firebase projects with email-enumeration protection
  /// already succeed silently for unknown addresses).
  Future<void> sendPasswordReset(String email) =>
      _auth.sendPasswordResetEmail(email: email);

  /// Sets (or clears) the signed-in customer's profile photo on
  /// `customers/{uid}`. [dataUrl] is an inline `data:image/…;base64,…` string
  /// (a downscaled image), or null to remove the photo. Merges so it never
  /// clobbers the other profile fields, and is permitted by the existing
  /// owner-update rule on `customers/{uid}`.
  Future<void> updatePhoto(String? dataUrl) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return;
    await _db.collection('customers').doc(uid).set(
      {'photo': dataUrl ?? FieldValue.delete()},
      SetOptions(merge: true),
    );
  }

  /// Reads the signed-in customer's `customers/{uid}` profile, or null when
  /// signed out / the doc is missing. Used by the Account screen.
  Future<Customer?> fetchCurrentCustomer() async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return null;
    final doc = await _db.collection('customers').doc(uid).get();
    if (!doc.exists) return null;
    return Customer.fromDoc(doc);
  }
}
