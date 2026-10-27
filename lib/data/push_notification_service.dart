import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../app_navigation.dart';
import 'member_preferences.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // The OS displays notification payloads. The Vercel sender writes history.
}

/// Registers this customer's device and routes booking notification taps.
class PushNotificationService {
  PushNotificationService._();

  static final instance = PushNotificationService._();

  final _messaging = FirebaseMessaging.instance;
  final _auth = FirebaseAuth.instance;
  final _db = FirebaseFirestore.instance;
  final Set<String> _seenEventIds = <String>{};

  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _openedSub;
  StreamSubscription<String>? _tokenSub;
  StreamSubscription<User?>? _authSub;
  RemoteMessage? _pendingTap;
  String? _currentToken;
  bool _started = false;

  static void registerBackgroundHandler() {
    if (kIsWeb) return;
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  }

  Future<void> start() async {
    if (_started || kIsWeb) return;
    _started = true;

    await _messaging.setForegroundNotificationPresentationOptions(
      alert: false,
      badge: true,
      sound: false,
    );
    _foregroundSub = FirebaseMessaging.onMessage.listen(_onForegroundMessage);
    _openedSub = FirebaseMessaging.onMessageOpenedApp.listen(
      _onNotificationTap,
    );
    _tokenSub = _messaging.onTokenRefresh.listen(_onTokenRefresh);
    _authSub = _auth.authStateChanges().listen((user) {
      if (user != null && _pendingTap != null) {
        final message = _pendingTap!;
        _pendingTap = null;
        _onNotificationTap(message);
      }
    });

    final initial = await _messaging.getInitialMessage();
    if (initial != null) {
      await Future<void>.delayed(const Duration(milliseconds: 3600));
      _onNotificationTap(initial);
    }
  }

  /// Requests permission only for a signed-in customer who wants order updates.
  Future<void> syncForSignedInUser() async {
    if (kIsWeb) return;
    final user = _auth.currentUser;
    if (user == null) return;
    if (!MemberPreferencesScope.value.orderUpdates) {
      await deactivateCurrentToken();
      return;
    }

    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: true,
    );
    if (settings.authorizationStatus != AuthorizationStatus.authorized &&
        settings.authorizationStatus != AuthorizationStatus.provisional) {
      return;
    }

    try {
      final token = await _messaging.getToken();
      if (token == null || token.isEmpty) return;
      await _registerToken(user.uid, token);
    } catch (error) {
      debugPrint('PushNotificationService registration error: $error');
    }
  }

  Future<void> deactivateCurrentToken() async {
    final user = _auth.currentUser;
    if (user == null) return;
    var token = _currentToken;
    if (token == null) {
      try {
        final settings = await _messaging.getNotificationSettings();
        if (settings.authorizationStatus == AuthorizationStatus.authorized ||
            settings.authorizationStatus == AuthorizationStatus.provisional) {
          token = await _messaging.getToken();
        }
      } catch (_) {
        return;
      }
    }
    if (token == null || token.isEmpty) return;
    try {
      await _tokenRef(user.uid, token).set({
        'active': false,
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    } catch (error) {
      debugPrint('PushNotificationService deactivation error: $error');
    }
  }

  Future<void> _onTokenRefresh(String token) async {
    final user = _auth.currentUser;
    if (user == null || !MemberPreferencesScope.value.orderUpdates) return;
    await _registerToken(user.uid, token);
  }

  Future<void> _registerToken(String uid, String token) async {
    final ref = _tokenRef(uid, token);
    final current = await ref.get();
    if (current.exists) {
      await ref.update({
        'active': true,
        'updatedAt': FieldValue.serverTimestamp(),
      });
    } else {
      await ref.set({
        'uid': uid,
        'token': token,
        'platform': _platform,
        'active': true,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
    _currentToken = token;
  }

  DocumentReference<Map<String, dynamic>> _tokenRef(String uid, String token) {
    final id = base64Url.encode(utf8.encode(token)).replaceAll('=', '');
    return _db
        .collection('customers')
        .doc(uid)
        .collection('pushTokens')
        .doc(id);
  }

  String get _platform {
    if (kIsWeb) return 'web';
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => 'android',
      TargetPlatform.iOS => 'ios',
      _ => defaultTargetPlatform.name,
    };
  }

  void _onForegroundMessage(RemoteMessage message) {
    final bookingId = message.data['bookingId'];
    if (bookingId == null || bookingId.isEmpty || !_remember(message)) return;
    final title = message.notification?.title ?? 'Booking update';
    final body = message.notification?.body ?? 'Your booking has been updated.';
    final messenger = AppNavigation.messengerKey.currentState;
    messenger
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text('$title\n$body'),
          action: SnackBarAction(
            label: 'VIEW',
            onPressed: () => AppNavigation.openBookingTracking(bookingId),
          ),
        ),
      );
  }

  void _onNotificationTap(RemoteMessage message) {
    final bookingId = message.data['bookingId'];
    if (bookingId == null || bookingId.isEmpty || !_remember(message)) return;
    if (_auth.currentUser == null) {
      _pendingTap = message;
      return;
    }
    AppNavigation.openBookingTracking(bookingId);
  }

  bool _remember(RemoteMessage message) {
    final eventId = message.data['eventId'] ?? message.messageId;
    if (eventId == null || eventId.isEmpty) return true;
    if (!_seenEventIds.add(eventId)) return false;
    if (_seenEventIds.length > 100) _seenEventIds.remove(_seenEventIds.first);
    return true;
  }

  Future<void> dispose() async {
    await _foregroundSub?.cancel();
    await _openedSub?.cancel();
    await _tokenSub?.cancel();
    await _authSub?.cancel();
  }
}
