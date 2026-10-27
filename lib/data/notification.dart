import 'package:cloud_firestore/cloud_firestore.dart';

/// The kind of activity that triggered this notification.
enum NotificationType {
  /// An order status changed (pending / confirmed / completed / declined).
  orderUpdate,

  /// A promotion or announcement from the kitchen.
  promotion,

  /// A personalised suggestion from Gabay.
  gabay;

  static NotificationType parse(Object? raw) => switch (raw) {
        'orderUpdate' => NotificationType.orderUpdate,
        'promotion' => NotificationType.promotion,
        'gabay' => NotificationType.gabay,
        _ => NotificationType.promotion,
      };

  String get wire => switch (this) {
        NotificationType.orderUpdate => 'orderUpdate',
        NotificationType.promotion => 'promotion',
        NotificationType.gabay => 'gabay',
      };
}

/// A single notification item stored at
/// `notifications/{uid}/items/{notifId}` in Firestore.
///
/// Announcement documents from the shared `announcements` collection are
/// mapped to the same shape at read time so the UI can treat them uniformly.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.type,
    required this.isRead,
    required this.createdAt,
    this.bookingId,
  });

  final String id;
  final String title;
  final String body;
  final NotificationType type;
  final bool isRead;
  final DateTime createdAt;

  /// Set on [NotificationType.orderUpdate] items so the UI can deep-link to
  /// the Order Tracking page for that booking.
  final String? bookingId;

  factory AppNotification.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final d = doc.data() ?? const {};
    final ts = d['createdAt'];
    return AppNotification(
      id: doc.id,
      title: (d['title'] ?? '') as String,
      body: (d['body'] ?? '') as String,
      type: NotificationType.parse(d['type']),
      isRead: d['isRead'] == true,
      createdAt: ts is Timestamp ? ts.toDate() : DateTime.now(),
      bookingId: d['bookingId'] as String?,
    );
  }

  /// Builds a notification from a shared `announcements` document. These are
  /// always treated as promotion-type and always carry the announcement's own
  /// Firestore id. [isRead] is resolved from the caller's local read-set.
  factory AppNotification.fromAnnouncement(
    DocumentSnapshot<Map<String, dynamic>> doc,
    bool isRead,
  ) {
    final d = doc.data() ?? const {};
    final ts = d['publishedAt'] ?? d['createdAt'];
    return AppNotification(
      id: 'ann-${doc.id}',
      title: (d['title'] ?? 'From the Kitchen') as String,
      body: (d['description'] ?? d['body'] ?? '') as String,
      type: NotificationType.promotion,
      isRead: isRead,
      createdAt: ts is Timestamp ? ts.toDate() : DateTime.now(),
    );
  }

  /// Builds a notification directly from an [Announcement] instance.
  factory AppNotification.fromAnnouncementModel(
    dynamic announcement,
    bool isRead,
  ) {
    final title = announcement.title as String;
    final body = announcement.description as String;
    final ts = (announcement.publishedAt ?? announcement.createdAt) as DateTime;
    return AppNotification(
      id: 'ann-${announcement.id}',
      title: title.isNotEmpty ? title : 'From the Kitchen',
      body: body,
      type: NotificationType.promotion,
      isRead: isRead,
      createdAt: ts,
    );
  }

  AppNotification copyWith({bool? isRead}) => AppNotification(
        id: id,
        title: title,
        body: body,
        type: type,
        isRead: isRead ?? this.isRead,
        createdAt: createdAt,
        bookingId: bookingId,
      );

  Map<String, Object?> toMap() => {
        'title': title,
        'body': body,
        'type': type.wire,
        'isRead': isRead,
        'createdAt': FieldValue.serverTimestamp(),
        if (bookingId != null) 'bookingId': bookingId,
      };
}
