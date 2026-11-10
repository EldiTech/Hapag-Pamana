import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../widgets.dart';
import 'contact_us_page.dart';
import 'settings_widgets.dart';

/// One numbered clause of a policy: a heading, its prose, and any list it needs.
@immutable
class LegalClause {
  const LegalClause(
    this.heading,
    this.paragraphs, {
    this.bullets = const <String>[],
  });

  /// Set in the clause header bar beside the numbered indicator badge.
  final String heading;

  /// The clause itself, one entry per paragraph.
  final List<String> paragraphs;

  /// Optional list beneath the prose — for the enumerations ("what we collect",
  /// "who can see it") that read far better as items than as a run-on sentence.
  final List<String> bullets;

  factory LegalClause.fromMap(Map<String, dynamic> map) {
    final rawParas = map['paragraphs'];
    final List<String> paras = [];
    if (rawParas is List) {
      for (final p in rawParas) {
        if (p is String && p.trim().isNotEmpty) paras.add(p.trim());
      }
    } else if (map['body'] is String && (map['body'] as String).trim().isNotEmpty) {
      paras.add((map['body'] as String).trim());
    }

    final rawBullets = map['bullets'];
    final List<String> bulletList = [];
    if (rawBullets is List) {
      for (final b in rawBullets) {
        if (b is String && b.trim().isNotEmpty) bulletList.add(b.trim());
      }
    }

    return LegalClause(
      (map['heading'] as String?)?.trim() ?? '',
      paras,
      bullets: bulletList,
    );
  }
}

/// The shape of a policy screen — the Privacy Policy and the Terms of Service
/// are the same document twice, so they share one renderer and differ only in
/// their clauses.
///
/// Set as an editorial document rather than a wall of legalese: a lede, the date
/// it was last changed, then numbered clauses in the brand's own voice. A policy
/// nobody reads protects nobody, so the copy says what actually happens to a
/// member's data and orders in plain words.
class LegalDocument extends StatelessWidget {
  const LegalDocument({
    super.key,
    required this.title,
    required this.lede,
    required this.lastUpdated,
    required this.clauses,
    this.overrideData,
  });

  /// App-bar title, e.g. "Privacy Policy".
  final String title;

  /// The opening line — what this document is, in one sentence.
  final String lede;

  /// When the text last changed, written out ("4 August 2026").
  final String lastUpdated;

  final List<LegalClause> clauses;

  /// Optional live Firestore override map from Content Moderator (`settings/about`).
  final Map<String, dynamic>? overrideData;

  @override
  Widget build(BuildContext context) {
    Duration d(int ms) => Duration(milliseconds: ms);

    final rawLede = (overrideData?['lede'] as String?)?.trim();
    final effectiveLede =
        (rawLede != null && rawLede.isNotEmpty) ? rawLede : lede;

    final rawUpdated = (overrideData?['lastUpdated'] as String?)?.trim();
    final effectiveLastUpdated =
        (rawUpdated != null && rawUpdated.isNotEmpty) ? rawUpdated : lastUpdated;

    final List<LegalClause> parsedClauses = [];
    final rawClauses = overrideData?['clauses'];
    if (rawClauses is List) {
      for (final item in rawClauses) {
        if (item is Map<String, dynamic>) {
          final parsed = LegalClause.fromMap(item);
          if (parsed.heading.isNotEmpty &&
              (parsed.paragraphs.isNotEmpty || parsed.bullets.isNotEmpty)) {
            parsedClauses.add(parsed);
          }
        }
      }
    }
    final effectiveClauses =
        parsedClauses.isNotEmpty ? parsedClauses : clauses;

    return SettingsScaffold(
      title: title,
      children: [
        FadeSlideIn(child: SettingsLede(title: title, body: effectiveLede)),
        const SizedBox(height: AppSpacing.md),
        FadeSlideIn(
          delay: d(40),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.xs + 2,
              ),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                border: Border.all(color: AppColors.hairline),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.schedule_outlined,
                    size: 14,
                    color: AppColors.goldDeep,
                  ),
                  const SizedBox(width: AppSpacing.xs + 2),
                  Flexible(
                    child: Text(
                      'LAST UPDATED · ${effectiveLastUpdated.toUpperCase()}',
                      style: AppTextStyles.sans(
                        size: 11.5,
                        weight: FontWeight.w700,
                        color: AppColors.brown,
                        spacing: 0.8,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        for (final (i, clause) in effectiveClauses.indexed) ...[
          FadeSlideIn(
            // Capped so a long policy never feels like it's still arriving.
            delay: d(80 + 40 * (i > 8 ? 8 : i)),
            child: _Clause(
              number: i + 1,
              total: effectiveClauses.length,
              clause: clause,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
        const SizedBox(height: AppSpacing.sm),
        FadeSlideIn(delay: d(440), child: const _QuestionsCard()),
      ],
    );
  }
}

/// One clause — framed in a structured card with a prominent numbered badge and
/// high-contrast section heading above the prose.
class _Clause extends StatelessWidget {
  const _Clause({
    required this.number,
    required this.total,
    required this.clause,
  });

  final int number;
  final int total;
  final LegalClause clause;

  static final TextStyle _bodyStyle = AppTextStyles.sans(
    size: 14.5,
    color: AppColors.brown,
    height: 1.65,
  );

  @override
  Widget build(BuildContext context) {
    final badgeNumber = number.toString().padLeft(2, '0');

    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header bar with prominent number badge + high-contrast title
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.md,
            ),
            decoration: BoxDecoration(
              color: AppColors.creamEdge.withValues(alpha: 0.45),
              border: const Border(
                bottom: BorderSide(
                  color: AppColors.hairline,
                ),
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.brown,
                    borderRadius: BorderRadius.circular(AppRadius.sm),
                    border: Border.all(
                      color: AppColors.gold.withValues(alpha: 0.6),
                    ),
                  ),
                  child: Text(
                    badgeNumber,
                    style: AppTextStyles.sans(
                      size: 12.5,
                      weight: FontWeight.w700,
                      color: AppColors.cream,
                      spacing: 0.8,
                      height: 1.1,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Text(
                    clause.heading.toUpperCase(),
                    style: AppTextStyles.sans(
                      size: 14.5,
                      weight: FontWeight.w700,
                      color: AppColors.brown,
                      spacing: 0.6,
                      height: 1.3,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  '$number of $total',
                  style: AppTextStyles.sans(
                    size: 11,
                    weight: FontWeight.w600,
                    color: AppColors.brownSoft.withValues(alpha: 0.75),
                  ),
                ),
              ],
            ),
          ),
          // Clause body & bullets
          Padding(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final (i, paragraph) in clause.paragraphs.indexed) ...[
                  if (i > 0) const SizedBox(height: AppSpacing.md),
                  Text(paragraph, style: _bodyStyle),
                ],
                if (clause.bullets.isNotEmpty) ...[
                  if (clause.paragraphs.isNotEmpty)
                    const SizedBox(height: AppSpacing.md),
                  for (final bullet in clause.bullets)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.only(
                              top: 7,
                              right: AppSpacing.sm + 2,
                            ),
                            child: Container(
                              width: 6,
                              height: 6,
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: AppColors.goldDeep,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(bullet, style: _bodyStyle),
                          ),
                        ],
                      ),
                    ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The close of every policy — the way to ask about it, since a document like
/// this always leaves someone with a question.
class _QuestionsCard extends StatelessWidget {
  const _QuestionsCard();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => Navigator.of(context).push(
        BrandPageRoute(builder: (_) => const ContactUsPage()),
      ),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        children: [
          const Icon(
            Icons.chat_bubble_outline,
            size: 18,
            color: AppColors.goldDeep,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('QUESTIONS ABOUT THIS?', style: AppTextStyles.eyebrow),
                const SizedBox(height: 4),
                Text(
                  'Ask us — we\'ll answer in plain words.',
                  style: AppTextStyles.bodySmall,
                ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right,
            size: 20,
            color: AppColors.brownSoft.withValues(alpha: 0.6),
          ),
        ],
      ),
    );
  }
}
