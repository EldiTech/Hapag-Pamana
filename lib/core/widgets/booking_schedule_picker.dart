import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../widgets.dart';
import 'app_button.dart';

/// Result returned by [showBookingSchedulePicker].
@immutable
class BookingScheduleSelection {
  const BookingScheduleSelection({
    required this.start,
    required this.end,
  });

  final DateTime start;
  final DateTime end;

  /// Normalized calendar start date (midnight).
  DateTime get startDay => DateTime(start.year, start.month, start.day);

  /// Normalized calendar end date (midnight).
  DateTime get endDay => DateTime(end.year, end.month, end.day);

  /// Total number of calendar days covered by this schedule (inclusive).
  int get days => endDay.difference(startDay).inDays + 1;

  /// True when the schedule spans two or more days.
  bool get isMultiDay => days > 1;

  /// Formatted start date ("June 12, 2026").
  String get formattedStart => formatBookingDate(startDay);

  /// Formatted end date ("June 14, 2026"), or empty string for a single day.
  String get formattedEnd => isMultiDay ? formatBookingDate(endDay) : '';

  /// Full display label stored in `functionDate`:
  /// - Single day: `"June 12, 2026"`
  /// - Multi-day: `"June 12, 2026 – June 14, 2026"`
  String get displayLabel =>
      isMultiDay ? '$formattedStart – $formattedEnd' : formattedStart;
}

const List<String> _kMonths = [
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

const List<String> _kShortMonths = [
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

/// Formats [d] as `"June 12, 2026"`.
String formatBookingDate(DateTime d) {
  return '${_kMonths[d.month - 1]} ${d.day}, ${d.year}';
}

/// Formats [d] compactly as `"Jun 12, 2026"`.
String formatShortBookingDate(DateTime d) {
  return '${_kShortMonths[d.month - 1]} ${d.day}, ${d.year}';
}

/// Parses a single spelled-out date (`"June 12, 2026"`).
DateTime? parseSingleBookingDate(String raw) {
  final text = raw.trim();
  if (text.isEmpty) return null;

  final match = RegExp(
    r'^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$',
  ).firstMatch(text);
  if (match != null) {
    final monthName = match.group(1)!.toLowerCase();
    final day = int.tryParse(match.group(2)!);
    final year = int.tryParse(match.group(3)!);
    int? month;
    for (var i = 0; i < _kMonths.length; i++) {
      if (_kMonths[i].toLowerCase().startsWith(
        monthName.substring(0, monthName.length.clamp(0, 3)),
      )) {
        month = i + 1;
        break;
      }
    }
    if (month != null && day != null && year != null) {
      return DateTime(year, month, day);
    }
  }
  return DateTime.tryParse(text);
}

/// Parses a stored booking schedule from `functionDate` (which may be either a
/// single date `"June 12, 2026"` or a range `"June 12, 2026 – June 14, 2026"`),
/// or from explicit `startRaw` / `endRaw` strings.
BookingScheduleSelection? parseBookingSchedule(
  String rawDate, {
  String? startRaw,
  String? endRaw,
}) {
  final explicitStart = startRaw != null && startRaw.trim().isNotEmpty
      ? parseSingleBookingDate(startRaw)
      : null;
  final explicitEnd = endRaw != null && endRaw.trim().isNotEmpty
      ? parseSingleBookingDate(endRaw)
      : null;
  if (explicitStart != null) {
    final end = (explicitEnd != null && !explicitEnd.isBefore(explicitStart))
        ? explicitEnd
        : explicitStart;
    return BookingScheduleSelection(start: explicitStart, end: end);
  }

  final trimmed = rawDate.trim();
  if (trimmed.isEmpty) return null;

  final parts = trimmed.split(RegExp(r'\s*[–—-]\s*'));
  if (parts.length >= 2) {
    final s = parseSingleBookingDate(parts.first);
    final e = parseSingleBookingDate(parts.last);
    if (s != null && e != null && !e.isBefore(s)) {
      return BookingScheduleSelection(start: s, end: e);
    }
  }

  final single = parseSingleBookingDate(trimmed);
  if (single != null) {
    return BookingScheduleSelection(start: single, end: single);
  }
  return null;
}

/// Segmented toggle shown inline above the Date field on the booking wizard so
/// customers can switch between **Single Day** and **Multi-Day (Date Range)**
/// at any time.
class BookingScheduleModeToggle extends StatelessWidget {
  const BookingScheduleModeToggle({
    super.key,
    required this.isMultiDay,
    required this.onChanged,
    this.daysCount = 1,
  });

  final bool isMultiDay;
  final ValueChanged<bool> onChanged;
  final int daysCount;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: AppColors.cream,
        borderRadius: AppRadius.mdAll,
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(
        children: [
          Expanded(
            child: _ModeTab(
              icon: Icons.event_outlined,
              label: 'Single Day',
              selected: !isMultiDay,
              onTap: () => onChanged(false),
            ),
          ),
          const SizedBox(width: 4),
          Expanded(
            child: _ModeTab(
              icon: Icons.date_range_outlined,
              label: isMultiDay && daysCount > 1
                  ? 'Multi-Day ($daysCount Days)'
                  : 'Multi-Day Range',
              selected: isMultiDay,
              onTap: () => onChanged(true),
            ),
          ),
        ],
      ),
    );
  }
}

class _ModeTab extends StatelessWidget {
  const _ModeTab({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 10),
        decoration: BoxDecoration(
          color: selected ? AppColors.brown : Colors.transparent,
          borderRadius: AppRadius.xsAll,
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: AppColors.shadow,
                    blurRadius: 6,
                    offset: Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 15,
              color: selected ? AppColors.gold : AppColors.brownSoft,
            ),
            const SizedBox(width: 6),
            Flexible(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.sans(
                  size: 12,
                  weight: selected ? FontWeight.w700 : FontWeight.w600,
                  color: selected ? AppColors.cream : AppColors.brownSoft,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Opens the Heirloom-Editorial schedule picker dialog where a customer can
/// choose either a single event date or a multi-day date range.
Future<BookingScheduleSelection?> showBookingSchedulePicker({
  required BuildContext context,
  BookingScheduleSelection? initialSelection,
  bool initialMultiDay = false,
  int defaultLeadDays = 14,
  String eyebrow = 'THE OCCASION · SCHEDULE',
}) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final defaultStart = today.add(Duration(days: defaultLeadDays));

  final startInit = initialSelection?.startDay ?? defaultStart;
  final endInit = initialSelection != null
      ? (initialMultiDay && !initialSelection.isMultiDay
            ? initialSelection.startDay.add(const Duration(days: 1))
            : initialSelection.endDay)
      : (initialMultiDay
            ? defaultStart.add(const Duration(days: 1))
            : defaultStart);

  return showCenterDialog<BookingScheduleSelection>(
    context: context,
    builder: (dialogContext) => _BookingScheduleDialog(
      eyebrow: eyebrow,
      firstDate: today,
      lastDate: DateTime(today.year + 2, today.month, today.day),
      initialStart: startInit.isBefore(today) ? today : startInit,
      initialEnd: endInit.isBefore(startInit) ? startInit : endInit,
      initialMultiDay:
          initialMultiDay || (initialSelection?.isMultiDay ?? false),
    ),
  );
}

class _BookingScheduleDialog extends StatefulWidget {
  const _BookingScheduleDialog({
    required this.eyebrow,
    required this.firstDate,
    required this.lastDate,
    required this.initialStart,
    required this.initialEnd,
    required this.initialMultiDay,
  });

  final String eyebrow;
  final DateTime firstDate;
  final DateTime lastDate;
  final DateTime initialStart;
  final DateTime initialEnd;
  final bool initialMultiDay;

  @override
  State<_BookingScheduleDialog> createState() => _BookingScheduleDialogState();
}

class _BookingScheduleDialogState extends State<_BookingScheduleDialog> {
  late bool _multiDay = widget.initialMultiDay;
  late DateTime _start = widget.initialStart;
  late DateTime _end = widget.initialEnd;
  late DateTime _displayedMonth = DateTime(
    widget.initialStart.year,
    widget.initialStart.month,
  );

  /// True after the user tapped a new start date in multi-day mode and is now
  /// picking the end date on the next tap.
  bool _awaitingEndTap = false;

  int get _daysCount => _multiDay ? (_end.difference(_start).inDays + 1) : 1;

  void _setMode(bool multi) {
    if (_multiDay == multi) return;
    setState(() {
      _multiDay = multi;
      _awaitingEndTap = false;
      if (!_multiDay) {
        _end = _start;
      } else if (_end.isAtSameMomentAs(_start)) {
        final candidate = _start.add(const Duration(days: 1));
        _end = candidate.isAfter(widget.lastDate) ? _start : candidate;
      }
    });
  }

  void _onDayTapped(DateTime day) {
    if (day.isBefore(widget.firstDate) || day.isAfter(widget.lastDate)) return;

    setState(() {
      if (!_multiDay) {
        _start = day;
        _end = day;
        _awaitingEndTap = false;
        return;
      }

      if (!_awaitingEndTap) {
        // First tap of a new range selection sets the start date.
        _start = day;
        _end = day;
        _awaitingEndTap = true;
      } else {
        // Second tap completes the range (or resets start if earlier).
        if (day.isBefore(_start)) {
          _start = day;
          _end = day;
          _awaitingEndTap = true;
        } else {
          _end = day;
          _awaitingEndTap = false;
        }
      }
    });
  }

  void _applyQuickDuration(int days) {
    final targetEnd = _start.add(Duration(days: days - 1));
    final clampedEnd = targetEnd.isAfter(widget.lastDate)
        ? widget.lastDate
        : targetEnd;
    setState(() {
      _multiDay = days > 1;
      _end = clampedEnd;
      _awaitingEndTap = false;
    });
  }

  bool get _canGoPrevMonth {
    final prev = DateTime(_displayedMonth.year, _displayedMonth.month - 1);
    final firstMonth = DateTime(widget.firstDate.year, widget.firstDate.month);
    return !prev.isBefore(firstMonth);
  }

  bool get _canGoNextMonth {
    final next = DateTime(_displayedMonth.year, _displayedMonth.month + 1);
    final lastMonth = DateTime(widget.lastDate.year, widget.lastDate.month);
    return !next.isAfter(lastMonth);
  }

  void _prevMonth() {
    if (!_canGoPrevMonth) return;
    setState(() {
      _displayedMonth = DateTime(
        _displayedMonth.year,
        _displayedMonth.month - 1,
      );
    });
  }

  void _nextMonth() {
    if (!_canGoNextMonth) return;
    setState(() {
      _displayedMonth = DateTime(
        _displayedMonth.year,
        _displayedMonth.month + 1,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final days = _daysCount;
    final ctaLabel = _multiDay && days > 1
        ? 'USE $days-DAY SCHEDULE'
        : 'USE THIS DATE';

    return AppDialogShell(
      footer: AppButton.primary(
        label: ctaLabel,
        icon: _multiDay ? Icons.date_range_rounded : Icons.event_available,
        fullWidth: true,
        onPressed: () {
          Navigator.of(context).pop(
            BookingScheduleSelection(
              start: _start,
              end: _multiDay ? _end : _start,
            ),
          );
        },
      ),
      children: [
        Text(widget.eyebrow, style: AppTextStyles.eyebrow),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _multiDay ? 'Choose your event dates' : 'Choose your event date',
          style: AppTextStyles.title,
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          _multiDay
              ? (_awaitingEndTap
                    ? 'Now tap the end date on the calendar, or pick a duration below.'
                    : 'Tap a start date and end date on the calendar for multi-day service.')
              : 'Pick the date of your event, or switch to Multi-Day for a date range.',
          style: AppTextStyles.bodySmall,
        ),
        const SizedBox(height: AppSpacing.md),

        // ── Mode Switcher ──────────────────────────────────────────────────
        BookingScheduleModeToggle(
          isMultiDay: _multiDay,
          daysCount: days,
          onChanged: _setMode,
        ),
        const SizedBox(height: AppSpacing.md),

        // ── Selected Date / Range Summary Strip ────────────────────────────
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: 10,
          ),
          decoration: BoxDecoration(
            color: AppColors.gold.withValues(alpha: 0.12),
            borderRadius: AppRadius.mdAll,
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
          ),
          child: _multiDay
              ? Row(
                  children: [
                    Expanded(
                      child: _DateEndpointColumn(
                        label: 'START DATE',
                        value: formatShortBookingDate(_start),
                        active: !_awaitingEndTap,
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.brown,
                          borderRadius: AppRadius.pillAll,
                        ),
                        child: Text(
                          '$days ${days == 1 ? 'DAY' : 'DAYS'}',
                          style: AppTextStyles.sans(
                            size: 10,
                            weight: FontWeight.w700,
                            color: AppColors.cream,
                            spacing: 0.5,
                          ),
                        ),
                      ),
                    ),
                    Expanded(
                      child: _DateEndpointColumn(
                        label: 'END DATE',
                        value: _awaitingEndTap
                            ? 'Tap end date…'
                            : formatShortBookingDate(_end),
                        active: _awaitingEndTap,
                        alignRight: true,
                      ),
                    ),
                  ],
                )
              : Row(
                  children: [
                    const Icon(
                      Icons.event_outlined,
                      size: 18,
                      color: AppColors.goldDeep,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        formatBookingDate(_start),
                        style: AppTextStyles.sans(
                          size: 13.5,
                          weight: FontWeight.w700,
                          color: AppColors.brown,
                        ),
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius: AppRadius.pillAll,
                        border: Border.all(color: AppColors.hairline),
                      ),
                      child: Text(
                        '1 DAY',
                        style: AppTextStyles.sans(
                          size: 10,
                          weight: FontWeight.w700,
                          color: AppColors.goldDeep,
                        ),
                      ),
                    ),
                  ],
                ),
        ),

        // ── Quick Duration Chips (Multi-Day Mode) ──────────────────────────
        SmoothReveal(
          visible: _multiDay,
          child: Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final preset in const [
                    (2, '2 Days'),
                    (3, '3 Days'),
                    (4, '4 Days'),
                    (5, '5 Days'),
                    (7, '1 Week'),
                  ]) ...[
                    _DurationPresetChip(
                      label: preset.$2,
                      selected: !_awaitingEndTap && days == preset.$1,
                      onTap: () => _applyQuickDuration(preset.$1),
                    ),
                    const SizedBox(width: 6),
                  ],
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.md),

        // ── Month Header ───────────────────────────────────────────────────
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            IconButton(
              onPressed: _canGoPrevMonth ? _prevMonth : null,
              icon: const Icon(Icons.chevron_left_rounded, size: 22),
              color: AppColors.brown,
              visualDensity: VisualDensity.compact,
            ),
            Text(
              '${_kMonths[_displayedMonth.month - 1]} ${_displayedMonth.year}',
              style: AppTextStyles.serif(
                size: 17,
                weight: FontWeight.w700,
                color: AppColors.brown,
              ),
            ),
            IconButton(
              onPressed: _canGoNextMonth ? _nextMonth : null,
              icon: const Icon(Icons.chevron_right_rounded, size: 22),
              color: AppColors.brown,
              visualDensity: VisualDensity.compact,
            ),
          ],
        ),
        const SizedBox(height: 4),

        // ── Weekday Headers ────────────────────────────────────────────────
        Row(
          children: [
            for (final wd in const ['S', 'M', 'T', 'W', 'T', 'F', 'S'])
              Expanded(
                child: Center(
                  child: Text(
                    wd,
                    style: AppTextStyles.sans(
                      size: 11,
                      weight: FontWeight.w700,
                      color: AppColors.brownSoft,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 6),

        // ── Calendar Grid ──────────────────────────────────────────────────
        _CalendarMonthGrid(
          month: _displayedMonth,
          firstDate: widget.firstDate,
          lastDate: widget.lastDate,
          start: _start,
          end: _multiDay ? _end : _start,
          onDayTapped: _onDayTapped,
        ),
      ],
    );
  }
}

class _DateEndpointColumn extends StatelessWidget {
  const _DateEndpointColumn({
    required this.label,
    required this.value,
    required this.active,
    this.alignRight = false,
  });

  final String label;
  final String value;
  final bool active;
  final bool alignRight;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignRight
          ? CrossAxisAlignment.end
          : CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.engraved(
            size: 8.5,
            color: AppColors.goldDeep,
            spacing: 1.4,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppTextStyles.sans(
            size: 12.5,
            weight: FontWeight.w700,
            color: active ? AppColors.goldDeep : AppColors.brown,
          ),
        ),
      ],
    );
  }
}

class _DurationPresetChip extends StatelessWidget {
  const _DurationPresetChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.quick,
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.brown : AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(
            color: selected ? AppColors.brown : AppColors.hairline,
          ),
        ),
        child: Text(
          label,
          style: AppTextStyles.sans(
            size: 11.5,
            weight: FontWeight.w600,
            color: selected ? AppColors.cream : AppColors.brownSoft,
          ),
        ),
      ),
    );
  }
}

class _CalendarMonthGrid extends StatelessWidget {
  const _CalendarMonthGrid({
    required this.month,
    required this.firstDate,
    required this.lastDate,
    required this.start,
    required this.end,
    required this.onDayTapped,
  });

  final DateTime month;
  final DateTime firstDate;
  final DateTime lastDate;
  final DateTime start;
  final DateTime end;
  final ValueChanged<DateTime> onDayTapped;

  @override
  Widget build(BuildContext context) {
    final daysInMonth = DateUtils.getDaysInMonth(month.year, month.month);
    // Sunday = 0 .. Saturday = 6
    final firstWeekday = DateTime(month.year, month.month, 1).weekday % 7;
    final totalCells = ((firstWeekday + daysInMonth + 6) ~/ 7) * 7;
    final rows = totalCells ~/ 7;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var r = 0; r < rows; r++)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              children: [
                for (var c = 0; c < 7; c++)
                  Expanded(
                    child: _buildCell(r * 7 + c - firstWeekday + 1, daysInMonth),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildCell(int dayNum, int daysInMonth) {
    if (dayNum < 1 || dayNum > daysInMonth) {
      return const SizedBox(height: 38);
    }

    final date = DateTime(month.year, month.month, dayNum);
    final disabled = date.isBefore(firstDate) || date.isAfter(lastDate);
    final isStart = DateUtils.isSameDay(date, start);
    final isEnd = DateUtils.isSameDay(date, end);
    final isRangeSpan = !DateUtils.isSameDay(start, end);
    final inRange =
        isRangeSpan && date.isAfter(start) && date.isBefore(end);

    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: disabled ? null : () => onDayTapped(date),
      child: SizedBox(
        height: 38,
        child: Stack(
          alignment: Alignment.center,
          children: [
            // Continuous highlight bar across multi-day ranges
            if (isRangeSpan && (inRange || isStart || isEnd))
              Positioned.fill(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: AppColors.gold.withValues(alpha: 0.22),
                      borderRadius: BorderRadius.horizontal(
                        left: isStart ? const Radius.circular(18) : Radius.zero,
                        right: isEnd ? const Radius.circular(18) : Radius.zero,
                      ),
                    ),
                  ),
                ),
              ),
            // Endpoint circle or day number
            AnimatedContainer(
              duration: Motion.quick,
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: (isStart || isEnd)
                    ? AppColors.brown
                    : Colors.transparent,
                border: (isStart || isEnd)
                    ? Border.all(color: AppColors.gold, width: 1.2)
                    : null,
              ),
              child: Text(
                '$dayNum',
                style: AppTextStyles.sans(
                  size: 12.5,
                  weight: (isStart || isEnd || inRange)
                      ? FontWeight.w700
                      : FontWeight.w500,
                  color: disabled
                      ? AppColors.brownSoft.withValues(alpha: 0.32)
                      : (isStart || isEnd)
                      ? AppColors.cream
                      : AppColors.brown,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

