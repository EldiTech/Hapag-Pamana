import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

/// What a new member tells us about the handaan they throw, before they have
/// thrown one with us.
///
/// Recommending from a member's orders needs a member with orders, and a fresh
/// account has none — so the sign-up wizard hands off to a four-question quiz,
/// and [RecommendationEngine] ranks the live menu against the answers until real
/// orders take over. Stored as the `tasteProfile` map on `customers/{uid}`,
/// beside the `preferences` map [MemberPreferences] keeps — the existing
/// owner-update rule already covers it, so no new Firestore rule is needed.
///
/// Every field defaults to empty/unset and [fromMap] keeps that default for
/// anything missing or malformed: a half-written map reads as an unfinished
/// quiz, never as a member who told us something they didn't.
@immutable
class TasteProfile {
  const TasteProfile({
    this.completed = false,
    this.occasionTypes = const <String>{},
    this.budgetRange,
    this.groupSize,
    this.flavorProfile = const <String>{},
    this.completedAt,
  });

  factory TasteProfile.fromMap(Map<String, Object?>? data) {
    if (data == null) return const TasteProfile();
    // Resolve each stored key against the taxonomy in force, so an answer key
    // we've since renamed quietly drops out rather than surviving as a dead chip.
    Set<String> keys(Object? raw, Iterable<String> valid) {
      if (raw is! List) return const <String>{};
      final allowed = valid.toSet();
      return {
        for (final e in raw)
          if (allowed.contains(e.toString())) e.toString(),
      };
    }

    final at = data['completedAt'];
    return TasteProfile(
      completed: data['completed'] == true,
      occasionTypes: keys(
        data['occasionTypes'],
        OccasionType.values.map((v) => v.key),
      ),
      budgetRange: BudgetRange.fromKey(data['budgetRange']),
      groupSize: GroupSize.fromKey(data['groupSize']),
      flavorProfile: keys(
        data['flavorProfile'],
        FlavorNote.values.map((v) => v.key),
      ),
      completedAt: at is Timestamp ? at.toDate() : null,
    );
  }

  /// True once the member has finished the quiz. False both for a brand-new
  /// account and for one that abandoned the quiz part-way — the member shell
  /// only re-asks on the former (see [TasteProfilePage]).
  final bool completed;

  /// The occasions this member caters for — [OccasionType.key] values.
  final Set<String> occasionTypes;

  /// What they tend to spend per head, or null when unanswered.
  final BudgetRange? budgetRange;

  /// How many people they usually feed, or null when unanswered.
  final GroupSize? groupSize;

  /// How they like the food — [FlavorNote.key] values.
  final Set<String> flavorProfile;

  final DateTime? completedAt;

  /// True when the member has answered every question the quiz asks. The quiz
  /// itself gates its final step on this, so a profile written with
  /// `completed: true` always carries a full set of answers.
  bool get isAnswered =>
      occasionTypes.isNotEmpty &&
      budgetRange != null &&
      groupSize != null &&
      flavorProfile.isNotEmpty;

  /// The payload written to `customers/{uid}.tasteProfile`.
  ///
  /// Sets are sorted so an unchanged answer always writes the same array and the
  /// document doesn't churn on a rewrite. [completedAt] is a server timestamp
  /// rather than a device one, so "when was this taken" stays trustworthy across
  /// devices with wrong clocks.
  Map<String, Object?> toMap() => {
    'completed': completed,
    'occasionTypes': occasionTypes.toList()..sort(),
    'budgetRange': budgetRange?.key,
    'groupSize': groupSize?.key,
    'flavorProfile': flavorProfile.toList()..sort(),
    'completedAt': FieldValue.serverTimestamp(),
  };

  TasteProfile copyWith({
    bool? completed,
    Set<String>? occasionTypes,
    BudgetRange? budgetRange,
    GroupSize? groupSize,
    Set<String>? flavorProfile,
  }) {
    return TasteProfile(
      completed: completed ?? this.completed,
      occasionTypes: occasionTypes ?? this.occasionTypes,
      budgetRange: budgetRange ?? this.budgetRange,
      groupSize: groupSize ?? this.groupSize,
      flavorProfile: flavorProfile ?? this.flavorProfile,
      completedAt: completedAt,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is TasteProfile &&
      other.completed == completed &&
      other.budgetRange == budgetRange &&
      other.groupSize == groupSize &&
      other.completedAt == completedAt &&
      setEquals(other.occasionTypes, occasionTypes) &&
      setEquals(other.flavorProfile, flavorProfile);

  @override
  int get hashCode => Object.hash(
    completed,
    budgetRange,
    groupSize,
    completedAt,
    Object.hashAllUnordered(occasionTypes),
    Object.hashAllUnordered(flavorProfile),
  );
}

/// What the member is cooking for. Multi-select — a household that throws both
/// birthdays and fiestas is the common case, not the exception.
///
/// [key] is what's stored; never localise or renumber it.
enum OccasionType {
  birthday('birthday', 'Birthday', '🎂'),
  wedding('wedding', 'Wedding', '💍'),
  fiesta('fiesta', 'Fiesta', '🎊'),
  corporate('corporate', 'Corporate', '💼'),
  reunion('reunion', 'Family reunion', '🏡'),
  funeral('funeral', 'Lamay / burol', '🕯️'),
  religious('religious', 'Binyag · Kumpil', '⛪'),
  everyday('everyday', 'Just because', '🍚');

  const OccasionType(this.key, this.label, this.emoji);

  final String key;
  final String label;
  final String emoji;

  static OccasionType? fromKey(Object? raw) {
    for (final v in values) {
      if (v.key == raw) return v;
    }
    return null;
  }
}

/// Roughly what the member spends per head. Single choice.
enum BudgetRange {
  budget('budget', 'Tipid mode', 'Under ₱350 a head'),
  mid('mid', 'Sakto', '₱350 – ₱700 a head'),
  premium('premium', 'All-out', 'Over ₱700 a head');

  const BudgetRange(this.key, this.label, this.blurb);

  final String key;
  final String label;
  final String blurb;

  static BudgetRange? fromKey(Object? raw) {
    for (final v in values) {
      if (v.key == raw) return v;
    }
    return null;
  }
}

/// How many mouths the member usually feeds. Single choice.
enum GroupSize {
  small('small', 'Intimate', 'Up to 30 guests'),
  medium('medium', 'A good crowd', '30 – 100 guests'),
  large('large', 'The whole barangay', 'More than 100 guests');

  const GroupSize(this.key, this.label, this.blurb);

  final String key;
  final String label;
  final String blurb;

  static GroupSize? fromKey(Object? raw) {
    for (final v in values) {
      if (v.key == raw) return v;
    }
    return null;
  }
}

/// How the member likes the food to taste. Multi-select.
///
/// Deliberately separate from [DietStyle] in [MemberPreferences]: that records a
/// restriction the kitchen must honour, this records a leaning the
/// recommendations may follow. `no_pork` appears in both vocabularies because a
/// member may express it either way, and the CF seed reads this one.
enum FlavorNote {
  savory('savory', 'Malinamnam', 'Rich and savoury'),
  sweet('sweet', 'Matamis', 'On the sweeter side'),
  sour('sour', 'Maasim', 'Sinigang, adobo, paksiw'),
  spicy('spicy', 'Maanghang', 'Bring the heat'),
  grilled('grilled', 'Inihaw', 'Off the grill'),
  seafood('seafood', 'Lamang-dagat', 'Fish and shellfish'),
  vegetables('vegetables', 'Gulay', 'Plenty of vegetables'),
  noPork('no_pork', 'Walang baboy', 'Keep the pork off the table');

  const FlavorNote(this.key, this.label, this.blurb);

  final String key;
  final String label;
  final String blurb;

  static FlavorNote? fromKey(Object? raw) {
    for (final v in values) {
      if (v.key == raw) return v;
    }
    return null;
  }
}
