// "Continue later" drafts: the booking-status wiring that lets a member save
// the catering wizard mid-fill and pick it back up from Order Tracking.
//
// Pure model tests — no Firebase. What's covered is the part a typo would
// silently break: an unrecognised or missing `status` string must keep
// reading as [BookingStatus.pending] (a real, already-filed order), never as
// [BookingStatus.draft] — the two are shown in completely different places
// (Order Tracking's "saved for later" row vs. its live order list) and read
// under completely different Firestore rules (a draft is the owner's to edit
// and delete at will; a real order is the team's alone). Confusing the two
// would either hide a filed order from the member or let them silently edit
// one the kitchen is already planning around.

import 'package:flutter_test/flutter_test.dart';

import 'package:hapag_pamana/core/widgets/booking_schedule_picker.dart';
import 'package:hapag_pamana/data/booking.dart';

Booking booking(Map<String, dynamic> data) => Booking(
      id: 'abc123',
      data: data,
      status: BookingStatus.parse(data['status']),
      type: (data['bookingType'] ?? '').toString().toLowerCase() == 'food pack'
          ? 'Food Pack'
          : 'Catering',
      createdAt: null,
      statusUpdatedAt: null,
      deleted: false,
      history: const [],
    );

void main() {
  group('BookingStatus.parse', () {
    test('"draft" reads as draft', () {
      expect(BookingStatus.parse('draft'), BookingStatus.draft);
    });

    test('every dashboard status still round-trips', () {
      expect(BookingStatus.parse('pending'), BookingStatus.pending);
      expect(BookingStatus.parse('confirmed'), BookingStatus.confirmed);
      expect(BookingStatus.parse('completed'), BookingStatus.completed);
      expect(BookingStatus.parse('declined'), BookingStatus.declined);
    });

    test('missing or unrecognised status reads as pending, never draft', () {
      expect(BookingStatus.parse(null), BookingStatus.pending);
      expect(BookingStatus.parse(''), BookingStatus.pending);
      expect(BookingStatus.parse('something_new'), BookingStatus.pending);
    });

    test('draft never leaves stagesDone claiming any progress', () {
      expect(BookingStatus.draft.stagesDone, 0);
    });
  });

  group('Booking.isDraft', () {
    test('a draft document reads as a draft', () {
      final b = booking({'status': 'draft'});
      expect(b.isDraft, isTrue);
    });

    test('a real order — even one never triaged — is not a draft', () {
      final b = booking({'status': 'pending'});
      expect(b.isDraft, isFalse);
    });

    test('a document with no status at all is not a draft', () {
      final b = booking({});
      expect(b.isDraft, isFalse);
    });
  });

  group('resuming a draft', () {
    test('draftPackageId and draftStep round-trip', () {
      final b = booking({
        'status': 'draft',
        'draftPackageId': 'pkg_42',
        'draftStep': '3',
      });
      expect(b.draftPackageId, 'pkg_42');
      expect(b.draftStep, 3);
    });

    test('a draft saved before any package was picked resumes with none', () {
      final b = booking({'status': 'draft', 'draftStep': '0'});
      expect(b.draftPackageId, isEmpty);
    });

    test('a missing draftStep resumes on the first page, not a crash', () {
      final b = booking({'status': 'draft'});
      expect(b.draftStep, 0);
    });

    test('a malformed draftStep also falls back to the first page', () {
      final b = booking({'status': 'draft', 'draftStep': 'not-a-number'});
      expect(b.draftStep, 0);
    });
  });

  group('a draft carries no payment obligation', () {
    test('needsDownpayment is false with no payment fields at all', () {
      final b = booking({'status': 'draft'});
      expect(b.needsDownpayment, isFalse);
      expect(b.payment, PaymentState.none);
    });
  });

  group('Multi-day scheduling & date range parsing', () {
    test('single-day BookingScheduleSelection formats as a single date', () {
      final sel = BookingScheduleSelection(
        start: DateTime(2026, 6, 12),
        end: DateTime(2026, 6, 12),
      );
      expect(sel.isMultiDay, isFalse);
      expect(sel.days, 1);
      expect(sel.displayLabel, 'June 12, 2026');
    });

    test('multi-day BookingScheduleSelection computes inclusive days and range label', () {
      final sel = BookingScheduleSelection(
        start: DateTime(2026, 6, 12),
        end: DateTime(2026, 6, 14),
      );
      expect(sel.isMultiDay, isTrue);
      expect(sel.days, 3);
      expect(sel.formattedStart, 'June 12, 2026');
      expect(sel.formattedEnd, 'June 14, 2026');
      expect(sel.displayLabel, 'June 12, 2026 – June 14, 2026');
    });

    test('parseBookingSchedule round-trips both single-day and multi-day strings', () {
      final single = parseBookingSchedule('August 20, 2026');
      expect(single, isNotNull);
      expect(single!.isMultiDay, isFalse);
      expect(single.days, 1);
      expect(single.formattedStart, 'August 20, 2026');

      final range = parseBookingSchedule('June 12, 2026 – June 15, 2026');
      expect(range, isNotNull);
      expect(range!.isMultiDay, isTrue);
      expect(range.days, 4);
      expect(range.formattedStart, 'June 12, 2026');
      expect(range.formattedEnd, 'June 15, 2026');
    });

    test('Booking exposes eventDays and isMultiDay from stored fields', () {
      final singleBooking = booking({
        'functionDate': 'June 12, 2026',
      });
      expect(singleBooking.eventDays, 1);
      expect(singleBooking.isMultiDay, isFalse);

      final multiBooking = booking({
        'functionDate': 'June 12, 2026 – June 14, 2026',
        'functionStartDate': 'June 12, 2026',
        'functionEndDate': 'June 14, 2026',
        'functionDays': '3',
      });
      expect(multiBooking.eventDays, 3);
      expect(multiBooking.isMultiDay, isTrue);
      expect(multiBooking.eventStartDate, 'June 12, 2026');
      expect(multiBooking.eventEndDate, 'June 14, 2026');
    });
  });
}
