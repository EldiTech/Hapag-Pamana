/// What Gabay has learned about *this* member — the "based on the user" half of
/// its grounding.
///
/// Nothing here is stored on the server and nothing is inferred beyond what the
/// member has actually done: their profile, their Settings switches, the taste
/// quiz, and the orders they filed. The model is rebuilt from those sources each
/// time Gabay opens, so a new booking changes what the assistant says the next
/// time it speaks — which is the whole point of personalising the chat rather
/// than showing everyone the same script.
library;

import 'booking.dart';
import 'gabay_sales_insights.dart';
import 'member_preferences.dart';
import 'product.dart';
import 'taste_profile.dart';

/// A compact, read-only picture of one member's history with the business.
class GabayUserModel {
  const GabayUserModel({
    this.firstName = 'Kaibigan',
    this.orderCount = 0,
    this.completedCount = 0,
    this.upcomingCount = 0,
    this.totalSpend = 0,
    this.averagePerHead,
    this.usualPax,
    this.favouriteDishes = const [],
    this.favouriteCategories = const [],
    this.occasions = const [],
    this.nextEventDate,
    this.nextEventName,
    this.lastEventDate,
  });

  /// The name Gabay greets the member with; "Kaibigan" for a blank profile.
  final String firstName;

  /// Orders filed, drafts excluded.
  final int orderCount;

  /// Orders the team has completed.
  final int completedCount;

  /// Orders still pending or confirmed.
  final int upcomingCount;

  /// Everything the member has spent on filed orders, in pesos.
  final double totalSpend;

  /// What their events have averaged per head, when a headcount and a total
  /// were both recorded. Null rather than a guess.
  final double? averagePerHead;

  /// The headcount they book most often.
  final int? usualPax;

  /// The dishes that show up most across their orders, most frequent first.
  final List<String> favouriteDishes;

  /// The menu lines those dishes come from ("Beef", "Seafood").
  final List<String> favouriteCategories;

  /// Occasions they have booked ("Wedding", "Birthday"), most frequent first.
  final List<String> occasions;

  final DateTime? nextEventDate;

  /// The occasion of that next event, when one was written on the booking.
  final String? nextEventName;

  final DateTime? lastEventDate;

  bool get hasHistory => orderCount > 0;

  bool get hasFavourites => favouriteDishes.isNotEmpty;

  /// "your 3 past events" / "your first event" — a phrase that never claims more
  /// history than the member has.
  String get historyPhrase {
    if (orderCount == 0) return 'your first event';
    if (orderCount == 1) return 'your past event';
    return 'your $orderCount events';
  }

  /// Builds the model from the member's own records.
  ///
  /// [menu] is the live catalog, used only to recognise dish names inside the
  /// free-text answers a booking carries; when it hasn't loaded, favourites are
  /// simply empty. Nothing is fabricated when a field is missing.
  factory GabayUserModel.build({
    required String? displayName,
    required List<Booking> bookings,
    required List<Product> menu,
    MemberPreferences? prefs,
    TasteProfile? profile,
  }) {
    final name = (displayName ?? '').trim();
    final filed = bookings.where((b) => !b.isDraft).toList();

    var totalSpend = 0.0;
    var spendPerHeadSum = 0.0;
    var spendPerHeadCount = 0;
    final paxCounts = <int, int>{};
    final dishCounts = <String, int>{};
    final categoryCounts = <String, int>{};
    final occasionCounts = <String, int>{};
    DateTime? nextEvent;
    String? nextEventName;
    DateTime? lastEvent;

    for (final booking in filed) {
      final pax = int.tryParse(booking.value('pax'));
      if (pax != null && pax > 0) {
        paxCounts.update(pax, (v) => v + 1, ifAbsent: () => 1);
      }

      final paid = booking.paymentTotal > 0
          ? booking.paymentTotal.toDouble()
          : booking.packageTotal.toDouble();
      totalSpend += paid;
      if (pax != null && pax > 0 && paid > 0) {
        spendPerHeadSum += paid / pax;
        spendPerHeadCount++;
      }

      final occasion = booking.value('kindOfFunction').trim();
      if (occasion.isNotEmpty) {
        occasionCounts.update(occasion, (v) => v + 1, ifAbsent: () => 1);
      }

      // Dish answers live under the wizard's per-course keys, whose names come
      // from the package the member booked — so rather than guessing the keys,
      // recognise published dish names inside every string answer.
      for (final value in booking.data.values) {
        if (value is! String || value.trim().isEmpty) continue;
        for (final dish in menu) {
          if (dish.name.isEmpty) continue;
          if (value.toLowerCase().contains(dish.name.toLowerCase())) {
            dishCounts.update(dish.name, (v) => v + 1, ifAbsent: () => 1);
            categoryCounts.update(
              dish.category,
              (v) => v + 1,
              ifAbsent: () => 1,
            );
          }
        }
      }

      final date = parseBookingDate(booking.value('functionDate'));
      if (date == null) continue;
      final today = DateTime.now();
      final day = DateTime(date.year, date.month, date.day);
      if (!day.isBefore(DateTime(today.year, today.month, today.day))) {
        if (nextEvent == null || day.isBefore(nextEvent)) {
          nextEvent = day;
          nextEventName = occasion.isEmpty ? null : occasion;
        }
      } else if (lastEvent == null || day.isAfter(lastEvent)) {
        lastEvent = day;
      }
    }

    final paxEntries = paxCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final dishEntries = dishCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final categoryEntries = categoryCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final occasionEntries = occasionCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    // A headcount the member has actually booked beats the quiz answer; the
    // quiz fills the gap for a member who hasn't booked yet.
    final quizPax = _paxFromGroupSize(profile?.groupSize);

    return GabayUserModel(
      firstName: name.isEmpty ? 'Kaibigan' : name.split(' ').first,
      orderCount: filed.length,
      completedCount:
          filed.where((b) => b.status == BookingStatus.completed).length,
      upcomingCount: filed
          .where(
            (b) =>
                b.status == BookingStatus.pending ||
                b.status == BookingStatus.confirmed,
          )
          .length,
      totalSpend: totalSpend,
      averagePerHead: spendPerHeadCount == 0
          ? null
          : spendPerHeadSum / spendPerHeadCount,
      usualPax: paxEntries.isEmpty ? quizPax : paxEntries.first.key,
      favouriteDishes: [for (final e in dishEntries.take(3)) e.key],
      favouriteCategories: [for (final e in categoryEntries.take(3)) e.key],
      occasions: [for (final e in occasionEntries.take(3)) e.key],
      nextEventDate: nextEvent,
      nextEventName: nextEventName,
      lastEventDate: lastEvent,
    );
  }

  /// One grounded sentence about the member's own history, or an empty string
  /// when they have none. Used as the personalisation line in replies.
  String summary() {
    if (!hasHistory) return '';
    final parts = <String>[];
    if (favouriteDishes.isNotEmpty) {
      parts.add('you have ordered ${favouriteDishes.join(', ')} before');
    }
    if (usualPax != null) {
      parts.add('your usual headcount is $usualPax');
    }
    if (averagePerHead != null) {
      parts.add(
        'your events have averaged ${peso(averagePerHead!)} per head',
      );
    }
    if (nextEventDate != null) {
      parts.add('your next event is ${_shortDate(nextEventDate!)}');
    }
    if (parts.isEmpty) return '';
    return 'Going by your own history, ${_join(parts)}.';
  }

  /// A short, honest note for the "why this?" answer.
  String recommendationBasis() {
    if (completedCount > 0) {
      return 'Past orders and what other customers ordered alongside them';
    }
    if (hasHistory) {
      return 'The orders you already have on file';
    }
    return 'Your taste profile answers — nothing else to go on yet';
  }

  static String _join(List<String> parts) {
    if (parts.length == 1) return parts.first;
    if (parts.length == 2) return '${parts.first} and ${parts.last}';
    return '${parts.take(parts.length - 1).join(', ')}, and ${parts.last}';
  }

  static String _shortDate(DateTime date) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${months[date.month - 1]} ${date.day}, ${date.year}';
  }

  static int? _paxFromGroupSize(GroupSize? size) => switch (size) {
    GroupSize.small => 30,
    GroupSize.medium => 60,
    GroupSize.large => 150,
    null => null,
  };
}

/// Reads the free-text date the booking wizard writes ("June 12, 2026").
///
/// The wizard stores a display string rather than a timestamp, so this is the
/// one place that turns it back into a date. Null when it can't be read — the
/// model then simply doesn't claim an event date.
DateTime? parseBookingDate(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;

  final monthMatch = RegExp(
    r'([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s*(\d{4})?',
  ).firstMatch(text);
  if (monthMatch != null) {
    final month = _monthNumber(monthMatch.group(1)!);
    final day = int.tryParse(monthMatch.group(2)!);
    final year = int.tryParse(monthMatch.group(3) ?? '');
    if (month != null && day != null) {
      return DateTime(year ?? DateTime.now().year, month, day);
    }
  }

  final dayFirst = RegExp(
    r'(\d{1,2})\s+([A-Za-z]{3,9})(?:,)?\s*(\d{4})?',
  ).firstMatch(text);
  if (dayFirst != null) {
    final day = int.tryParse(dayFirst.group(1)!);
    final month = _monthNumber(dayFirst.group(2)!);
    final year = int.tryParse(dayFirst.group(3) ?? '');
    if (month != null && day != null) {
      return DateTime(year ?? DateTime.now().year, month, day);
    }
  }

  return null;
}

int? _monthNumber(String name) {
  final key = name.toLowerCase();
  final prefix = key.substring(0, key.length < 3 ? key.length : 3);
  for (var i = 0; i < monthNames.length; i++) {
    if (monthNames[i].toLowerCase().startsWith(prefix)) {
      return i + 1;
    }
  }
  const short = {
    'jan': 1,
    'feb': 2,
    'mar': 3,
    'apr': 4,
    'jun': 6,
    'jul': 7,
    'aug': 8,
    'sep': 9,
    'oct': 10,
    'nov': 11,
    'dec': 12,
  };
  return short[prefix];
}
