import 'package:cloud_firestore/cloud_firestore.dart';

/// Where an order stands in the Orders dashboard's workflow. The vocabulary is
/// the dashboard's own (`pending` → `confirmed` → `completed`, or `declined`);
/// anything unrecognised reads as [pending], matching how the dashboard itself
/// treats a missing status.
enum BookingStatus {
  /// Saved by the member with "Continue later" — never sent to the team, and
  /// never seen by the Orders dashboard (see the Firestore rule on
  /// `bookings`). Exists only so the wizard can be picked back up from Order
  /// Tracking; [BookingRepository.submit] moves it to [pending] on send.
  draft,

  pending,
  confirmed,
  completed,
  declined;

  static BookingStatus parse(Object? raw) => switch (raw) {
        'draft' => BookingStatus.draft,
        'confirmed' => BookingStatus.confirmed,
        'completed' => BookingStatus.completed,
        'declined' => BookingStatus.declined,
        _ => BookingStatus.pending,
      };

  /// How far along the Received → Confirmed → Completed track this sits.
  /// [declined] leaves the track, so it reports the one stage it did reach.
  /// [draft] never joins the track at all — it's not filed yet.
  int get stagesDone => switch (this) {
        BookingStatus.draft => 0,
        BookingStatus.pending => 1,
        BookingStatus.confirmed => 2,
        BookingStatus.completed => 3,
        BookingStatus.declined => 1,
      };
}

/// Where an order stands on its downpayment — half the total, collected through
/// PayMongo before the team will confirm the date.
///
/// The wizards stamp this on every order they file, so [none] only ever appears
/// on orders filed before the downpayment gate existed; those are read as
/// settled-offline rather than unpaid, since chasing a payment for an order the
/// team already took by hand would be wrong.
enum PaymentState {
  /// Filed, but the downpayment hasn't landed. The member can pick the payment
  /// back up from Order Tracking.
  awaiting,

  /// The downpayment cleared — the order is the team's to confirm.
  paid,

  /// No total could be worked out (an order placed without a priced package),
  /// so nothing was collected online and the team quotes it directly.
  quoteNeeded,

  /// Filed before the downpayment gate; payment, if any, was arranged offline.
  none;

  static PaymentState parse(Object? raw) => switch (raw) {
        'awaiting' => PaymentState.awaiting,
        'paid' => PaymentState.paid,
        'quote_needed' => PaymentState.quoteNeeded,
        _ => PaymentState.none,
      };

  /// The value written to Firestore — the same vocabulary the Orders dashboard
  /// reads.
  String get wire => switch (this) {
        PaymentState.awaiting => 'awaiting',
        PaymentState.paid => 'paid',
        PaymentState.quoteNeeded => 'quote_needed',
        PaymentState.none => 'none',
      };
}

/// One step in an order's paper trail — a status it moved to, and when.
///
/// The dashboard also stamps *who* made each move (`byName`); that's staff
/// bookkeeping, so it's deliberately not read here.
class BookingStep {
  const BookingStep({required this.status, this.at});

  final BookingStatus status;
  final DateTime? at;
}

/// Where a confirmed order stands on its trip from the kitchen to the venue —
/// the Team Leader and Logistics desks' own workflow, run entirely after the
/// order itself is [BookingStatus.confirmed]. Mirrors the dashboards'
/// `fulfilment.stage` vocabulary exactly (see `hp-fulfilment.js`).
enum FulfilmentStage {
  preparing,
  ready,
  released,
  delivered;

  static FulfilmentStage parse(Object? raw) => switch (raw) {
        'ready' => FulfilmentStage.ready,
        'released' => FulfilmentStage.released,
        'delivered' => FulfilmentStage.delivered,
        _ => FulfilmentStage.preparing,
      };

  String get label => switch (this) {
        FulfilmentStage.preparing => 'Preparing',
        FulfilmentStage.ready => 'Ready',
        FulfilmentStage.released => 'Released',
        FulfilmentStage.delivered => 'Delivered',
      };
}

/// One movement on the kitchen-to-venue rail — a stage reached, or a release
/// asked for/refused. Mirrors `hp-fulfilment.js`'s `movements()`: the plain
/// history plus the request/reject pair, already merged and time-ordered by
/// [Fulfilment.movements].
class FulfilmentMove {
  const FulfilmentMove({
    required this.kind,
    required this.stage,
    this.at,
    this.note,
  });

  /// "stage" for an ordinary move onto [stage], "request" for the Team
  /// Leader's ask to release, "reject" for Logistics turning it down.
  final String kind;
  final FulfilmentStage stage;
  final DateTime? at;
  final String? note;

  String get title => switch (kind) {
        'request' => 'Release requested',
        'reject' => 'Release refused',
        _ => stage.label,
      };
}

/// A confirmed order's kitchen → delivery workflow, read back from
/// `bookings/{id}.fulfilment`. Absent on any order that isn't yet
/// [BookingStatus.confirmed] — the Team Leader desk only ever touches a
/// confirmed order — so [Booking.fulfilment] is nullable rather than
/// defaulting to [FulfilmentStage.preparing].
class Fulfilment {
  const Fulfilment({required this.stage, required this.movements});

  final FulfilmentStage stage;

  /// Every movement, oldest first — stage reaches plus release asks/refusals,
  /// merged and sorted the same way the dashboards' own rail is.
  final List<FulfilmentMove> movements;

  static Fulfilment? fromMap(Object? raw) {
    if (raw is! Map) return null;
    final stage = FulfilmentStage.parse(raw['stage']);

    final moves = <FulfilmentMove>[];
    final history = raw['history'];
    if (history is List) {
      for (final entry in history) {
        if (entry is! Map) continue;
        moves.add(FulfilmentMove(
          kind: 'stage',
          stage: FulfilmentStage.parse(entry['stage']),
          at: _dateOf(entry['at']),
          note: (entry['note'] as Object?)?.toString(),
        ));
      }
    }
    final requestedAt = raw['requestedAt'];
    if (requestedAt != null) {
      moves.add(FulfilmentMove(
        kind: 'request',
        stage: FulfilmentStage.ready,
        at: _dateOf(requestedAt),
        note: (raw['requestNote'] as Object?)?.toString(),
      ));
    }
    final rejectedAt = raw['rejectedAt'];
    if (rejectedAt != null) {
      moves.add(FulfilmentMove(
        kind: 'reject',
        stage: FulfilmentStage.ready,
        at: _dateOf(rejectedAt),
        note: (raw['rejectReason'] as Object?)?.toString(),
      ));
    }
    moves.sort((a, b) {
      final am = a.at?.millisecondsSinceEpoch ?? 0;
      final bm = b.at?.millisecondsSinceEpoch ?? 0;
      return am.compareTo(bm);
    });

    return Fulfilment(stage: stage, movements: moves);
  }

  static DateTime? _dateOf(Object? raw) => switch (raw) {
        Timestamp t => t.toDate(),
        DateTime d => d,
        _ => null,
      };
}

/// An order the member filed from one of the booking wizards, as the member
/// side reads it back from `bookings`.
///
/// The wizards drop blank answers on submit and the two flows write different
/// shapes (the catering wizard fills one dish per course; the food-pack wizard
/// writes `menu` lines like "Fish Fillet (5 pax)"), so the raw document is kept
/// alongside the typed fields and read through [value] / [lines]. That way the
/// tracking screen shows exactly what the client filled in — no invented
/// blanks — and a field added to a wizard later needs no change here.
class Booking {
  const Booking({
    required this.id,
    required this.data,
    required this.status,
    required this.type,
    required this.createdAt,
    required this.statusUpdatedAt,
    required this.deleted,
    required this.history,
  });

  final String id;

  /// The raw document, for the fields the detail sheet reads by key.
  final Map<String, dynamic> data;

  final BookingStatus status;

  /// "Catering" or "Food Pack" — the two wizards that write here.
  final String type;

  final DateTime? createdAt;
  final DateTime? statusUpdatedAt;

  /// Trashed from the Orders dashboard. Kept so the member's list can drop it
  /// rather than showing an order the team has retired.
  final bool deleted;

  /// Every status move, oldest first. Empty on orders filed before the
  /// dashboard started stamping a history.
  final List<BookingStep> history;

  factory Booking.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final d = doc.data() ?? const <String, dynamic>{};
    final raw = d['history'];
    return Booking(
      id: doc.id,
      data: d,
      status: BookingStatus.parse(d['status']),
      type: (d['bookingType'] ?? '').toString().toLowerCase() == 'food pack'
          ? 'Food Pack'
          : 'Catering',
      createdAt: _dateOf(d['createdAt']),
      statusUpdatedAt: _dateOf(d['statusUpdatedAt']),
      deleted: d['deleted'] == true,
      history: raw is! List
          ? const []
          : [
              for (final entry in raw)
                if (entry is Map)
                  BookingStep(
                    status: BookingStatus.parse(entry['status']),
                    at: _dateOf(entry['at']),
                  ),
            ],
    );
  }

  static DateTime? _dateOf(Object? raw) => switch (raw) {
        Timestamp t => t.toDate(),
        DateTime d => d,
        _ => null,
      };

  /// A trimmed answer from the wizard, or '' when the client left it blank
  /// (the repository never writes blanks, so a missing key means exactly that).
  String value(String key) => (data[key] ?? '').toString().trim();

  /// A multi-line answer as its lines — the food-pack `menu` and the catering
  /// wizard's `menuAddOns` are both newline-joined on submit.
  List<String> lines(String key) => [
        for (final line in value(key).split('\n'))
          if (line.trim().isNotEmpty) line.trim(),
      ];

  bool get isFoodPack => type == 'Food Pack';

  /// True for a "Continue later" draft — filed nowhere, visible to nobody but
  /// the member who saved it (see the `bookings` Firestore rule).
  bool get isDraft => status == BookingStatus.draft;

  /// The id of the package this draft was booked against — set only on
  /// catering-wizard drafts (see [BookingRepository.saveDraft]), and read back
  /// to re-open [BookingPage] on the same package so its menu steps match.
  String get draftPackageId => value('draftPackageId');

  /// Which page of the wizard the member had reached when they saved. 0 when
  /// absent, which lands a resumed draft back on the first step rather than
  /// erroring on a missing index.
  int get draftStep => int.tryParse(value('draftStep')) ?? 0;

  // ── The downpayment ───────────────────────────────────────────────────────
  /// Where the order stands on its 50% downpayment.
  PaymentState get payment => PaymentState.parse(data['paymentStatus']);

  /// The order's full amount, as the wizard worked it out from the package's
  /// price and the headcount. 0 when no total could be established.
  num get paymentTotal => _numOf(data['paymentTotal']);

  /// The half of [paymentTotal] the downpayment gate asks for.
  num get paymentDue => _numOf(data['paymentDue']);

  /// What actually cleared — normally [paymentDue], read back from PayMongo's
  /// own record of the payment rather than from what we asked for.
  num get paymentPaid => _numOf(data['paymentPaid']);

  /// The PayMongo checkout page this order opened, so a member who backed out
  /// is handed the same page again instead of a second charge.
  String get checkoutUrl => value('checkoutUrl');

  /// PayMongo's session id (`cs_…`), which the app re-reads to confirm payment.
  String get checkoutSessionId => value('checkoutSessionId');

  /// The settled payment's PayMongo id (`pay_…`) — the team's reference when
  /// reconciling against the PayMongo dashboard.
  String get paymentRef => value('paymentRef');

  /// How it was paid, as PayMongo reports it ("gcash", "card", …).
  String get paymentMethod => value('paymentMethod');

  DateTime? get paidAt => _dateOf(data['paidAt']);

  /// True while this order still needs its downpayment — the one state the
  /// member can act on.
  ///
  /// An amount is part of the test, not just the status: a checkout for nothing
  /// is one PayMongo would refuse, so an `awaiting` order that somehow carries no
  /// figure is left for the team rather than offered a button that can only fail.
  bool get needsDownpayment =>
      payment == PaymentState.awaiting && paymentDue > 0;

  /// The order's kitchen → delivery workflow, once the Team Leader desk has
  /// started it. Null until then — an order that's merely [confirmed] has no
  /// `fulfilment` field yet, same as the dashboards themselves treat it.
  Fulfilment? get fulfilment => Fulfilment.fromMap(data['fulfilment']);

  /// True once the Layout Designer has drawn and saved a floor plan for this
  /// event (`bookings/{id}.layout`, written from Admin/Layout Designer). Gates
  /// the "View 3D Layout" entry on Order Tracking — nothing to preview before
  /// the desk has drawn a room.
  bool get hasLayout {
    final l = data['layout'];
    return l is Map && l['items'] is List && (l['items'] as List).isNotEmpty;
  }

  static num _numOf(Object? raw) => switch (raw) {
        num n => n,
        String s => num.tryParse(s) ?? 0,
        _ => 0,
      };

  /// The one line that names this order in a list: the occasion, else its first
  /// menu line, else the order's own kind.
  String get headline {
    final occasion = value('kindOfFunction');
    if (occasion.isNotEmpty) return occasion;
    final menu = lines('menu');
    if (menu.isNotEmpty) return menu.first;
    return isFoodPack ? 'Food pack order' : 'Catering booking';
  }

  /// The event's date exactly as the wizard wrote it ("June 12, 2026").
  String get eventDate => value('functionDate');

  /// A short, stable reference the member can quote to the team — the tail of
  /// the Firestore id, which is what the dashboard's row is keyed by.
  String get reference => referenceFor(id);

  /// [reference] for an id we hold without a [Booking] around it — the wizards
  /// need it the moment they file, to label the payment that follows.
  static String referenceFor(String id) =>
      id.length <= 6 ? id.toUpperCase() : id.substring(id.length - 6).toUpperCase();
}
