import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';

/// A customer profile stored at `customers/{uid}`, where the document id is the
/// Firebase Auth user id. Written when a guest signs up; read back later for an
/// account screen or to pre-fill catering inquiries.
class Customer {
  const Customer({
    required this.uid,
    required this.name,
    required this.email,
    required this.phone,
    this.photo = '',
    this.banned = false,
    this.createdAt,
  });

  final String uid;
  final String name;
  final String email;
  final String phone;

  /// True when the dashboard's User Management has banned this account. Only
  /// moderators can write the flag (see firestore.rules); the app blocks a
  /// banned member at login and signs them out live in the member shell.
  final bool banned;

  /// Profile photo — a remote URL (https://…) or an inline data URL
  /// ("data:image/jpeg;base64,…"). Empty when the member hasn't set one. Mirrors
  /// the [Product] image handling so the same render path applies.
  final String photo;

  /// Server timestamp written at sign-up; null until the server resolves it.
  final DateTime? createdAt;

  factory Customer.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const {};
    final ts = d['createdAt'];
    return Customer(
      uid: doc.id,
      name: (d['name'] ?? '') as String,
      email: (d['email'] ?? '') as String,
      phone: (d['phone'] ?? '') as String,
      photo: (d['photo'] ?? '') as String,
      banned: d['banned'] == true,
      createdAt: ts is Timestamp ? ts.toDate() : null,
    );
  }

  bool get hasPhoto => photo.isNotEmpty;

  /// True when [photo] is an inline base64 data URL rather than a network URL.
  bool get photoIsDataUrl => photo.startsWith('data:');

  /// The remote photo URL, or null when the photo is inline / absent.
  String? get photoUrl => hasPhoto && !photoIsDataUrl ? photo : null;

  /// Decoded bytes for an inline data-URL photo, or null otherwise.
  Uint8List? get photoBytes {
    if (!photoIsDataUrl) return null;
    final comma = photo.indexOf(',');
    if (comma == -1) return null;
    try {
      return base64Decode(photo.substring(comma + 1));
    } catch (_) {
      return null;
    }
  }

  /// The payload written at sign-up. [createdAt] is a server timestamp so the
  /// join date doesn't depend on the device clock.
  Map<String, dynamic> toCreateMap() => {
    'name': name,
    'email': email,
    'phone': phone,
    'createdAt': FieldValue.serverTimestamp(),
  };
}
