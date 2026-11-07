/// The business's own sales history — the dataset Gabay is trained on for the
/// "when is it busy?" / "when should I book?" kind of question.
///
/// The figures are transcribed from the workbooks the business uploaded under
/// `Demand Forecast Datasets/` (2023 SALES · 2025 SALES · 2026 SALES), so every
/// number here can be traced back to a sheet the partner organization actually
/// keeps. Nothing is interpolated: the 2026 sheet was still empty when it was
/// uploaded, so it contributes no months, and 2023 was recorded from June
/// onward, so it contributes six.
///
/// Gabay speaks from this snapshot rather than guessing at "peak season". The
/// snapshot is deliberately kept in code — not read live from the spreadsheets,
/// which never leave the office — so the assistant can answer the same way
/// offline, which is one of the app's stated requirements.
library;

/// One month of recorded sales for a year.
class GabaySalesMonth {
  const GabaySalesMonth(this.year, this.month, this.amount);

  /// Calendar year the figure was recorded under.
  final int year;

  /// 1 = January … 12 = December.
  final int month;

  /// Recorded sales for the month, in pesos.
  final double amount;

  String get label => monthNames[month - 1];
}

const List<String> monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/// The recorded months, oldest first. Sources, sheet by sheet:
///   • 2025 SALES → SALES_SUMMARY (full year, total ₱14,362,963.37)
///   • 2023 SALES → SUMMARY (June–December only, total ₱6,573,184.11)
const List<GabaySalesMonth> kRecordedSalesMonths = [
  // 2023 — the half-year the workbook covers.
  GabaySalesMonth(2023, 6, 678162.00),
  GabaySalesMonth(2023, 7, 911820.00),
  GabaySalesMonth(2023, 8, 831966.11),
  GabaySalesMonth(2023, 9, 762140.00),
  GabaySalesMonth(2023, 10, 644815.00),
  GabaySalesMonth(2023, 11, 658927.00),
  GabaySalesMonth(2023, 12, 2085354.00),

  // 2025 — the most recent complete year on file.
  GabaySalesMonth(2025, 1, 1067750.50),
  GabaySalesMonth(2025, 2, 425873.14),
  GabaySalesMonth(2025, 3, 416973.12),
  GabaySalesMonth(2025, 4, 925268.40),
  GabaySalesMonth(2025, 5, 718629.11),
  GabaySalesMonth(2025, 6, 1202445.21),
  GabaySalesMonth(2025, 7, 411785.27),
  GabaySalesMonth(2025, 8, 1930974.54),
  GabaySalesMonth(2025, 9, 938826.55),
  GabaySalesMonth(2025, 10, 972135.18),
  GabaySalesMonth(2025, 11, 3059307.14),
  GabaySalesMonth(2025, 12, 2292995.21),
];

/// Read-only views over the recorded sales, shaped for the sentences Gabay
/// composes.
///
/// Everything here is a fact about the business's own book, stated as such —
/// "in 2025", "on the months we recorded". Gabay must never turn a busy month
/// into a promised lead time or a guaranteed price, so this class stops at the
/// numbers and leaves the advice to the reply layer.
class GabaySalesInsights {
  const GabaySalesInsights._();

  /// The snapshot every reply is grounded in.
  static const GabaySalesInsights bundled = GabaySalesInsights._();

  /// The most recent year with a full twelve months on file.
  static const int latestFullYear = 2025;

  List<GabaySalesMonth> monthsOf(int year) =>
      kRecordedSalesMonths.where((m) => m.year == year).toList();

  /// The year's recorded total, as the workbook states it.
  double totalOf(int year) =>
      monthsOf(year).fold(0, (sum, m) => sum + m.amount);

  /// Every recorded year, newest first.
  List<int> get years {
    final out = kRecordedSalesMonths.map((m) => m.year).toSet().toList()
      ..sort((a, b) => b.compareTo(a));
    return out;
  }

  /// The year's months, strongest first.
  List<GabaySalesMonth> rankedMonthsOf(int year) =>
      monthsOf(year)..sort((a, b) => b.amount.compareTo(a.amount));

  /// The strongest recorded month for [year], or null when the year has none.
  GabaySalesMonth? bestMonthOf(int year) {
    final ranked = rankedMonthsOf(year);
    return ranked.isEmpty ? null : ranked.first;
  }

  /// The weakest recorded month for [year], or null when the year has none.
  GabaySalesMonth? quietestMonthOf(int year) {
    final ranked = rankedMonthsOf(year);
    return ranked.isEmpty ? null : ranked.last;
  }

  /// The month numbers that sit in the top third of the latest full year — the
  /// months the kitchen is genuinely at its busiest. 2025's top third is
  /// November, December, August and June, which matches how the business talks
  /// about the ber months and the graduation season.
  List<int> get peakMonths {
    final ranked = rankedMonthsOf(latestFullYear);
    if (ranked.isEmpty) return const [];
    final cut = (ranked.length / 3).ceil();
    return ranked.take(cut).map((m) => m.month).toList()
      ..sort((a, b) => a.compareTo(b));
  }

  /// True when the calendar month of [date] is one of [peakMonths].
  bool isPeakMonth(DateTime date) => peakMonths.contains(date.month);

  /// "November" — the busiest month of the latest full year, or null.
  String? get busiestMonthName => bestMonthOf(latestFullYear)?.label;

  /// A single grounded sentence naming the three biggest months of the latest
  /// full year, for the reply layer to open with.
  String busiestSeasonLine() {
    final ranked = rankedMonthsOf(latestFullYear);
    if (ranked.isEmpty) return '';
    final top = ranked.take(3).toList();
    final names = top.map((m) => m.label).join(', ');
    final amounts = top.map((m) => peso(m.amount)).join(', ');
    return 'On our own books, $latestFullYear peaked in $names — $amounts for '
        'those months.';
  }

  /// A single grounded sentence naming the quietest recorded month, so Gabay can
  /// talk about flexibility without inventing a discount.
  String quietestSeasonLine() {
    final quiet = quietestMonthOf(latestFullYear);
    if (quiet == null) return '';
    return '${quiet.label} was the quietest month on our $latestFullYear books '
        '(${peso(quiet.amount)}), so the calendar has more room around it.';
  }

  /// The whole snapshot as one paragraph — the corpus entry Gabay retrieves when
  /// a member asks about demand, peak season, or the best time to book.
  String summary() {
    final parts = <String>[busiestSeasonLine(), quietestSeasonLine()]
        .where((s) => s.isNotEmpty)
        .toList();
    if (parts.length < 2) return parts.join(' ');
    return '${parts.join(' ')} The figures come from the sales workbooks the '
        'business keeps for 2023 and 2025; 2023 was recorded from June onward.';
  }
}

/// "₱1,067,750.50" — grouping and two decimals, no dependency on Flutter so the
/// assistant's grounding stays testable on its own.
String peso(num amount) {
  final fixed = amount.toStringAsFixed(2);
  final dot = fixed.indexOf('.');
  final whole = fixed.substring(0, dot);
  final cents = fixed.substring(dot);
  final buffer = StringBuffer();
  for (var i = 0; i < whole.length; i++) {
    final fromEnd = whole.length - i;
    buffer.write(whole[i]);
    if (fromEnd > 1 && fromEnd % 3 == 1) buffer.write(',');
  }
  return '₱$buffer$cents';
}
