import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/recommendation_repository.dart';
import '../../data/taste_profile.dart';
import '../../widgets.dart';
import '../user/user_shell.dart';

/// The taste-profile quiz — four questions asked once, right after sign-up.
///
/// The recommendation engine has nothing to work from until a member has
/// ordered, so this stands in for that missing first booking: the answers are
/// written to `customers/{uid}.tasteProfile`, and [RecommendationEngine] ranks
/// the live menu against them until real orders take over.
///
/// Mirrors [SignUpPage]'s wizard shape (segmented progress, one question per
/// page, Back · Continue footer) so the two screens read as one flow — this is
/// the fourth, fifth, sixth and seventh step of signing up, not a separate
/// errand. Two differences: the pages are swipeable (nothing here can be
/// answered *wrongly*, so there's no validation to hold the member back), and
/// every step can be skipped.
///
/// Skipping is deliberate and always available. A member who doesn't want to
/// answer lands on the member side with featured dishes standing in for
/// recommendations (see [RecommendationRepository.watchRecommended]) — which is
/// a worse strip, not a broken app.
class TasteProfilePage extends StatefulWidget {
  const TasteProfilePage({super.key, this.name});

  /// The member's first name, for the greeting. Falls back to "Kaibigan".
  final String? name;

  @override
  State<TasteProfilePage> createState() => _TasteProfilePageState();
}

class _TasteProfilePageState extends State<TasteProfilePage> {
  static const int _stepCount = 4;

  final PageController _pager = PageController();
  int _step = 0;

  final Set<String> _occasions = <String>{};
  BudgetRange? _budget;
  GroupSize? _group;
  final Set<String> _flavors = <String>{};

  bool _saving = false;
  bool _done = false;

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  /// True when the step the member is on has an answer. Continue stays live
  /// either way — it's [_stepCount] taps to the end whatever they pick — but an
  /// unanswered step's CTA reads "SKIP" so the choice is honest.
  bool get _stepAnswered => switch (_step) {
    0 => _occasions.isNotEmpty,
    1 => _budget != null,
    2 => _group != null,
    _ => _flavors.isNotEmpty,
  };

  void _next() {
    if (_saving) return;
    if (_step < _stepCount - 1) {
      _pager.nextPage(duration: Motion.base, curve: Motion.standard);
    } else {
      _finish();
    }
  }

  void _back() {
    if (_saving || _step == 0) return;
    _pager.previousPage(duration: Motion.base, curve: Motion.standard);
  }

  /// Leaves for the member side without saving anything — the quiz is optional
  /// in full, not only step by step.
  void _skipAll() {
    if (_saving) return;
    _enterShell();
  }

  Future<void> _finish() async {
    final profile = TasteProfile(
      completed: true,
      occasionTypes: _occasions,
      budgetRange: _budget,
      groupSize: _group,
      flavorProfile: _flavors,
    );

    // A member who skipped every question has told us nothing, so there is
    // nothing to rank the menu against — treated as a skip. A *partly* answered
    // quiz is still saved: two of four answers rank better than none.
    if (_occasions.isEmpty &&
        _flavors.isEmpty &&
        _budget == null &&
        _group == null) {
      _enterShell();
      return;
    }

    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    try {
      await RecommendationRepository().saveTasteProfile(profile);
      if (!mounted) return;
      // Hold the ✓ state for a beat, matching the sign-up CTA's success hold.
      setState(() => _done = true);
      await Future<void>.delayed(const Duration(milliseconds: 700));
      if (!mounted) return;
      _enterShell();
    } on FirebaseException catch (e) {
      // The answers are a nicety, never a gate: a failed write must not strand
      // a member who has already got an account outside the app. Say so, and
      // let them in — the strip falls back to featured dishes.
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        SnackBar(
          content: Text(
            e.code == 'permission-denied'
                ? "Couldn't save your answers — you can set them later in Settings."
                : "Couldn't save your answers just now. You can set them later.",
          ),
        ),
      );
      _enterShell();
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      messenger.showSnackBar(
        const SnackBar(
          content: Text("Couldn't save your answers. You can set them later."),
        ),
      );
      _enterShell();
    }
  }

  /// Opens the member side, dropping the sign-up flow behind it and keeping the
  /// guest shell as the root so logout still returns there — exactly what
  /// [SignUpPage] did before this screen sat between the two.
  void _enterShell() {
    Navigator.of(context).pushAndRemoveUntil(
      BrandPageRoute(builder: (_) => const UserShell()),
      (route) => route.isFirst,
    );
  }

  @override
  Widget build(BuildContext context) {
    final isLast = _step == _stepCount - 1;
    final label = _done
        ? 'ALL SET'
        : (isLast ? 'FINISH' : (_stepAnswered ? 'CONTINUE' : 'SKIP'));

    final primary = AppButton.primary(
      label: label,
      icon: _done ? Icons.check_rounded : null,
      busy: _saving && !_done,
      // A no-op keeps the success state in full brand colour for its hold.
      onPressed: _done ? () {} : (_saving ? null : _next),
      fullWidth: _step == 0,
    );

    // Back steps the wizard rather than abandoning it; the first step can't pop
    // at all — the account already exists, so there's nothing behind this to go
    // back to. "Skip for now" in the header is the way out.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: Scaffold(
        extendBodyBehindAppBar: true,
        body: Stack(
          children: [
            const ParchmentBackground(weave: true),
            SafeArea(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: AppSpacing.sm),
                    Row(
                      children: [
                        // The logo flies in from the sign-up wizard, and on to
                        // the member home once the quiz is done.
                        Hero(
                          tag: AppAssets.logoHeroTag,
                          child: Image.asset(AppAssets.logo, height: 52),
                        ),
                        const Spacer(),
                        TextButton(
                          onPressed: _saving ? null : _skipAll,
                          child: Text(
                            'Skip for now',
                            style: AppTextStyles.sans(
                              size: 12,
                              weight: FontWeight.w700,
                              color: AppColors.goldDeep,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    _WizardProgress(step: _step, total: _stepCount),
                    const SizedBox(height: 10),
                    Text(
                      'QUESTION ${_step + 1} OF $_stepCount',
                      style: AppTextStyles.engraved(
                        size: 9.5,
                        color: AppColors.goldDeep,
                        spacing: 2,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),

                    Expanded(
                      child: PageView(
                        controller: _pager,
                        onPageChanged: (i) => setState(() => _step = i),
                        children: [
                          _occasionStep(),
                          _budgetStep(),
                          _groupStep(),
                          _flavorStep(),
                        ],
                      ),
                    ),

                    AnimatedSize(
                      duration: Motion.base,
                      curve: Motion.standard,
                      alignment: Alignment.topCenter,
                      child: AnimatedSwitcher(
                        duration: Motion.base,
                        switchInCurve: Motion.standard,
                        switchOutCurve: Motion.exit,
                        transitionBuilder: (child, animation) =>
                            FadeTransition(opacity: animation, child: child),
                        child: _step == 0
                            ? KeyedSubtree(
                                key: const ValueKey('footer-first'),
                                child: primary,
                              )
                            : IntrinsicHeight(
                                key: const ValueKey('footer-rest'),
                                child: Row(
                                  crossAxisAlignment:
                                      CrossAxisAlignment.stretch,
                                  children: [
                                    AppButton.secondary(
                                      label: 'BACK',
                                      icon: Icons.arrow_back_rounded,
                                      onPressed: _saving ? null : _back,
                                    ),
                                    const SizedBox(width: 12),
                                    Expanded(child: primary),
                                  ],
                                ),
                              ),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  Widget _occasionStep() {
    final trimmed = (widget.name ?? '').trim();
    final first = trimmed.isEmpty ? 'Kaibigan' : trimmed.split(' ').first;

    return _QuizStep(
      eyebrow: 'ONE LAST THING',
      title: 'What brings\nyou to the hapag?',
      subtitle:
          'Kumusta, $first! Tell us what you cater for and Gabay will have '
          'something ready for you. Pick as many as you like.',
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          for (final o in OccasionType.values)
            _ChoiceChip(
              label: o.label,
              emoji: o.emoji,
              selected: _occasions.contains(o.key),
              onTap: () => setState(() {
                if (!_occasions.remove(o.key)) _occasions.add(o.key);
              }),
            ),
        ],
      ),
    );
  }

  Widget _budgetStep() {
    return _QuizStep(
      eyebrow: 'THE BUDGET',
      title: 'What do you\nusually spend?',
      subtitle: 'Per head. A rough idea is plenty — nothing is held to it.',
      child: Column(
        children: [
          for (final b in BudgetRange.values) ...[
            _ChoiceCard(
              title: b.label,
              blurb: b.blurb,
              selected: _budget == b,
              onTap: () => setState(() => _budget = b),
            ),
            const SizedBox(height: AppSpacing.sm + 2),
          ],
        ],
      ),
    );
  }

  Widget _groupStep() {
    return _QuizStep(
      eyebrow: 'THE CROWD',
      title: 'How many\ndo you feed?',
      subtitle: 'Your usual handaan — we\'ll size the packages to match.',
      child: Column(
        children: [
          for (final g in GroupSize.values) ...[
            _ChoiceCard(
              title: g.label,
              blurb: g.blurb,
              selected: _group == g,
              onTap: () => setState(() => _group = g),
            ),
            const SizedBox(height: AppSpacing.sm + 2),
          ],
        ],
      ),
    );
  }

  Widget _flavorStep() {
    return _QuizStep(
      eyebrow: 'THE FOOD',
      title: 'How do you\nlike to eat?',
      subtitle: 'Pick the flavours your table goes back for.',
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          for (final f in FlavorNote.values)
            _ChoiceChip(
              label: f.label,
              selected: _flavors.contains(f.key),
              onTap: () => setState(() {
                if (!_flavors.remove(f.key)) _flavors.add(f.key);
              }),
            ),
        ],
      ),
    );
  }
}

/// One question: engraved eyebrow, serif heading, a line of guidance, then the
/// answers. Scrolls so a long answer set is never clipped on a short screen.
class _QuizStep extends StatelessWidget {
  const _QuizStep({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String eyebrow;
  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      child: FadeSlideIn(
        key: ValueKey(title),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              eyebrow,
              style: AppTextStyles.engraved(
                size: 11,
                color: AppColors.goldDeep,
                spacing: 2.5,
              ),
            ),
            const SizedBox(height: AppSpacing.sm + 2),
            Text(title, style: AppTextStyles.serif(size: 27, height: 1.12)),
            const SizedBox(height: AppSpacing.sm),
            Text(subtitle, style: AppTextStyles.body),
            const SizedBox(height: AppSpacing.xl),
            child,
            const SizedBox(height: AppSpacing.lg),
          ],
        ),
      ),
    );
  }
}

/// A multi-select answer pill — gold-filled when chosen, parchment when not.
class _ChoiceChip extends StatelessWidget {
  const _ChoiceChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.emoji,
  });

  final String label;
  final String? emoji;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: AnimatedContainer(
        duration: Motion.quick,
        curve: Motion.standard,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.gold.withValues(alpha: 0.22)
              : AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(
            color: selected ? AppColors.gold : AppColors.hairline,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (emoji != null) ...[
              Text(emoji!, style: const TextStyle(fontSize: 14)),
              const SizedBox(width: 7),
            ],
            Text(
              label,
              style: AppTextStyles.sans(
                size: 12.5,
                weight: FontWeight.w600,
                color: selected ? AppColors.brown : AppColors.brownSoft,
                spacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A single-select answer card — title, blurb and a radio mark down the right.
class _ChoiceCard extends StatelessWidget {
  const _ChoiceCard({
    required this.title,
    required this.blurb,
    required this.selected,
    required this.onTap,
  });

  final String title;
  final String blurb;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      width: double.infinity,
      color: selected ? AppColors.gold.withValues(alpha: 0.12) : null,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: AppTextStyles.serif(size: 17, height: 1.15)),
                const SizedBox(height: 3),
                Text(blurb, style: AppTextStyles.bodySmall),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          AnimatedContainer(
            duration: Motion.quick,
            curve: Motion.standard,
            width: 22,
            height: 22,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected ? AppColors.gold : Colors.transparent,
              border: Border.all(
                color: selected ? AppColors.gold : AppColors.hairline,
                width: 1.4,
              ),
            ),
            child: selected
                ? const Icon(Icons.check, size: 14, color: AppColors.brown)
                : null,
          ),
        ],
      ),
    );
  }
}

/// A segmented progress bar — one bar per question, gold for reached, hairline
/// for upcoming. The sign-up wizard's own, kept private to each screen rather
/// than shared: they're the same drawing today but answer to different flows.
class _WizardProgress extends StatelessWidget {
  const _WizardProgress({required this.step, required this.total});

  final int step;
  final int total;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: List.generate(total, (i) {
        final done = i <= step;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: i < total - 1 ? 8 : 0),
            child: AnimatedContainer(
              duration: Motion.base,
              curve: Motion.standard,
              height: 5,
              decoration: BoxDecoration(
                color: done ? AppColors.gold : AppColors.hairline,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
          ),
        );
      }),
    );
  }
}
