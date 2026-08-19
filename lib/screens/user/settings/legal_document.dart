import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../widgets.dart';
import 'contact_us_page.dart';
import 'settings_widgets.dart';

/// One numbered clause of a policy: a heading, its prose, and any list it needs.
class LegalClause {
  const LegalClause(
    this.heading,
    this.paragraphs, {
    this.bullets = const <String>[],
  });

  /// Set in engraved small-caps beside the clause number.
  final String heading;

  /// The clause itself, one entry per paragraph.
  final List<String> paragraphs;

  /// Optional list beneath the prose — for the enumerations ("what we collect",
  /// "who can see it") that read far better as items than as a run-on sentence.
  final List<String> bullets;
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
  });

  /// App-bar title, e.g. "Privacy Policy".
  final String title;

  /// The opening line — what this document is, in one sentence.
  final String lede;

  /// When the text last changed, written out ("4 August 2026").
  final String lastUpdated;

  final List<LegalClause> clauses;

  @override
  Widget build(BuildContext context) {
    Duration d(int ms) => Duration(milliseconds: ms);

    return SettingsScaffold(
      title: title,
      children: [
        FadeSlideIn(child: SettingsLede(title: title, body: lede)),
        const SizedBox(height: AppSpacing.md),
        FadeSlideIn(
          delay: d(40),
          child: Text('LAST UPDATED · $lastUpdated',
              style: AppTextStyles.eyebrow),
        ),
        const SizedBox(height: AppSpacing.xl),
        for (final (i, clause) in clauses.indexed) ...[
          FadeSlideIn(
            // Capped so a long policy never feels like it's still arriving.
            delay: d(80 + 40 * (i > 8 ? 8 : i)),
            child: _Clause(number: i + 1, clause: clause),
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
        FadeSlideIn(delay: d(440), child: const _QuestionsCard()),
      ],
    );
  }
}

/// One clause — its number and heading on a gold-ruled line, then the prose.
class _Clause extends StatelessWidget {
  const _Clause({required this.number, required this.clause});

  final int number;
  final LegalClause clause;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              number.toString().padLeft(2, '0'),
              style: AppTextStyles.engraved(
                size: 11,
                color: AppColors.gold,
                spacing: 1.2,
              ),
            ),
            const SizedBox(width: AppSpacing.sm + 2),
            Expanded(
              child: Text(
                clause.heading.toUpperCase(),
                style: AppTextStyles.eyebrow,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        for (final (i, paragraph) in clause.paragraphs.indexed) ...[
          if (i > 0) const SizedBox(height: AppSpacing.sm + 2),
          Text(paragraph, style: AppTextStyles.body),
        ],
        if (clause.bullets.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.md),
          for (final bullet in clause.bullets)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 6, right: AppSpacing.sm),
                    child: Container(
                      width: 4,
                      height: 4,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.gold,
                      ),
                    ),
                  ),
                  Expanded(child: Text(bullet, style: AppTextStyles.body)),
                ],
              ),
            ),
        ],
      ],
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
