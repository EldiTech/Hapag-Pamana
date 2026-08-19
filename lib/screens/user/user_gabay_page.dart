import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/customer_repository.dart';
import '../../data/member_preferences.dart';
import '../../data/recommendation_repository.dart';
import '../../widgets.dart';
import '../detail_sheets.dart';
import '../home_sections.dart';
import 'user_shell.dart';

/// Gabay — the member-side AI catering companion ("gabay" = guide).
///
/// Mostly design for now: the assistant's welcome, a "how I can help" rundown of
/// its planned capabilities, a set of starter prompts and a chat composer. The
/// conversation isn't wired — typing a message or tapping a prompt surfaces a
/// "coming soon" note.
///
/// One capability IS live: "Picks just for you", the collaborative-filtering
/// recommendations, which sit in a real panel at the top of the page (see
/// [_RecommendedPanel]) rather than in the coming-soon rundown below it. The
/// rest (budget/headcount package matching, healthier-meal swaps, layout
/// explanations, the FAQ assistant) still await an implementation pass.
class UserGabayPage extends StatefulWidget {
  const UserGabayPage({super.key, this.onNavigate});

  /// Switches the member shell to another tab. Null when Gabay is hosted
  /// somewhere that can't navigate — the recommendation panel then simply
  /// doesn't offer to open Packages.
  final void Function(int index)? onNavigate;

  @override
  State<UserGabayPage> createState() => _UserGabayPageState();
}

class _UserGabayPageState extends State<UserGabayPage> {
  final TextEditingController _controller = TextEditingController();

  StreamSubscription<RecommendationSet>? _recSub;
  RecommendationSet _recs = RecommendationSet.empty;
  bool _recsLoading = true;

  /// The capabilities Gabay will offer once implemented — also the content of
  /// the "how I can help" rundown. "Picks just for you" is deliberately absent:
  /// it's live, and lives in [_RecommendedPanel] above this list.
  static const List<(IconData, String, String)> _capabilities = [
    (
      Icons.savings_outlined,
      'Match my budget',
      'Tell me your budget and guest count — I\'ll find the right package.',
    ),
    (
      Icons.eco_outlined,
      'Healthier options',
      'Lighter, more nutritious swaps for any dish on the menu.',
    ),
    (
      Icons.event_seat_outlined,
      'Plan the event',
      'Layout pointers — like why moving the buffet helps the flow.',
    ),
    (
      Icons.help_outline,
      'Why this?',
      'I\'ll explain why a package or setup was recommended to you.',
    ),
    (
      Icons.chat_bubble_outline,
      'Ask anything',
      'Menus, bookings, planning questions — just ask away.',
    ),
  ];

  /// Starter prompts shown as tappable chips.
  static const List<String> _starters = [
    'Recommend a package for ₱20,000 · 50 pax',
    'Suggest healthier meal options',
    'Why was this package recommended?',
    'Help me plan my event layout',
    'How do I book catering?',
  ];

  @override
  void initState() {
    super.initState();
    // Same stream the member home's strip reads — one repository, so the two
    // surfaces can never disagree about what this member is being shown. A
    // failed read settles into the empty set, which drops the panel.
    _recSub = RecommendationRepository().watchRecommended().listen(
      (set) {
        if (!mounted) return;
        setState(() {
          _recs = set;
          _recsLoading = false;
        });
      },
      onError: (_) {
        if (!mounted) return;
        setState(() {
          _recs = RecommendationSet.empty;
          _recsLoading = false;
        });
      },
    );
  }

  @override
  void dispose() {
    _recSub?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _comingSoon() {
    FocusScope.of(context).unfocus();
    _controller.clear();
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          behavior: SnackBarBehavior.floating,
          backgroundColor: AppColors.brown,
          content: Text(
            'Gabay is still learning — chat is coming soon!',
            style: AppTextStyles.sans(size: 13, color: AppColors.cream),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final name = CustomerRepository().displayName?.trim() ?? '';
    final first = name.isEmpty ? 'Kaibigan' : name.split(' ').first;

    // The recommendation panel answers to the member's own switch over whether
    // Gabay may put suggestions in front of them — watched, not read once, so
    // toggling it in Settings takes the panel away without a tab bounce.
    return ValueListenableBuilder<MemberPreferences>(
      valueListenable: MemberPreferencesScope.notifier,
      builder: (context, prefs, _) => Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.screen,
                AppSpacing.lg,
                AppSpacing.screen,
                AppSpacing.xl,
              ),
              children: [
                FadeSlideIn(child: const _GabayHeader()),
                const SizedBox(height: AppSpacing.xl),

                // Greeting from the assistant.
                FadeSlideIn(
                  delay: const Duration(milliseconds: 80),
                  child: _AssistantBubble(
                    'Kumusta, $first! I\'m Gabay, your catering companion. '
                    'I can suggest meals and packages, work to your budget and '
                    'guest count, and answer your planning questions. How can I '
                    'help today?',
                  ),
                ),
                const SizedBox(height: AppSpacing.section),

                // ── Picks just for you (live) ────────────────────────────────
                // The one capability that isn't a promise. Answers to the
                // member's own suggestions switch, and drops out entirely when
                // there's nothing to recommend — an empty panel would say Gabay
                // is broken when it's only new.
                if (prefs.gabaySuggestions &&
                    (_recsLoading || _recs.isNotEmpty)) ...[
                  FadeSlideIn(
                    delay: const Duration(milliseconds: 110),
                    child: _RecommendedPanel(
                      loading: _recsLoading,
                      set: _recs,
                      onOpenPackages: widget.onNavigate == null
                          ? null
                          : () => widget.onNavigate!(UserShell.tabPackages),
                    ),
                  ),
                  const SizedBox(height: AppSpacing.section),
                ],

                FadeSlideIn(
                  delay: const Duration(milliseconds: 140),
                  child: Text(
                    'HERE\'S HOW I CAN HELP',
                    style: AppTextStyles.eyebrow,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                for (var i = 0; i < _capabilities.length; i++) ...[
                  FadeSlideIn(
                    delay: Duration(milliseconds: 180 + i * 50),
                    child: _CapabilityCard(
                      icon: _capabilities[i].$1,
                      title: _capabilities[i].$2,
                      subtitle: _capabilities[i].$3,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm + 2),
                ],
                const SizedBox(height: AppSpacing.lg),

                FadeSlideIn(
                  delay: const Duration(milliseconds: 220),
                  child: Text('TRY ASKING', style: AppTextStyles.eyebrow),
                ),
                const SizedBox(height: AppSpacing.md),
                FadeSlideIn(
                  delay: const Duration(milliseconds: 260),
                  child: Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      for (final prompt in _starters)
                        _PromptChip(prompt, onTap: _comingSoon),
                    ],
                  ),
                ),
              ],
            ),
          ),
          _Composer(controller: _controller, onSend: _comingSoon),
        ],
      ),
    );
  }
}

// ════════════════════════════ Recommended panel ════════════════════════════
/// "Picks just for you" — the collaborative-filtering recommendations, in the
/// one place on the member side that can explain itself.
///
/// The home strip shows the same items in passing; here they get the assistant's
/// own voice around them, a badge naming what produced the list, and a way
/// through to Packages when a pick is a package rather than a dish. Which is the
/// point of the source badge: Gabay promises to say why something was
/// recommended, and a panel that can't distinguish "members like you ordered
/// this" from "the kitchen featured it" can't keep that promise.
class _RecommendedPanel extends StatelessWidget {
  const _RecommendedPanel({
    required this.loading,
    required this.set,
    required this.onOpenPackages,
  });

  final bool loading;
  final RecommendationSet set;

  /// Opens the Packages tab; null when this Gabay can't navigate.
  final VoidCallback? onOpenPackages;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.12),
                    borderRadius: AppRadius.mdAll,
                  ),
                  child: const Icon(
                    Icons.recommend_outlined,
                    size: 19,
                    color: AppColors.goldDeep,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm + 2),
                Expanded(
                  child: Text(
                    'Picks just for you',
                    style: AppTextStyles.serif(size: 17, height: 1.15),
                  ),
                ),
              ],
            ),
          ),
          if (!loading) ...[
            const SizedBox(height: AppSpacing.sm),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: RecommendationSourceBadge(set.source),
            ),
          ],
          const SizedBox(height: AppSpacing.md),

          // The cards run to the card's own edge rather than the screen
          // gutter, so the strip reads as belonging to the panel — hence the
          // ListView here instead of the home page's [ForYouStrip], which pads
          // itself to the wider screen inset.
          SizedBox(
            height: 196,
            child: loading
                ? const Center(
                    child: SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: AppColors.goldDeep,
                      ),
                    ),
                  )
                : ListView.separated(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.md,
                    ),
                    itemCount: set.items.length,
                    separatorBuilder: (_, _) => const SizedBox(width: 12),
                    itemBuilder: (context, i) {
                      final item = set.items[i];
                      return RecommendedCard(
                        item,
                        onTap: () {
                          if (!item.isPackage) {
                            showProductSheet(context, item.product!);
                          } else {
                            onOpenPackages?.call();
                          }
                        },
                      );
                    },
                  ),
          ),

          if (!loading && onOpenPackages != null) ...[
            const SizedBox(height: AppSpacing.sm + 2),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: TextButton(
                onPressed: onOpenPackages,
                style: TextButton.styleFrom(
                  padding: EdgeInsets.zero,
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'See the packages',
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w700,
                        color: AppColors.goldDeep,
                      ),
                    ),
                    const SizedBox(width: 5),
                    const Icon(
                      Icons.arrow_forward,
                      size: 14,
                      color: AppColors.goldDeep,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ════════════════════════════ Header ════════════════════════════
class _GabayHeader extends StatelessWidget {
  const _GabayHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        // Gold-ringed sparkle avatar — the assistant's mark.
        Container(
          width: 60,
          height: 60,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppColors.gold.withValues(alpha: 0.12),
            border: Border.all(
              color: AppColors.gold.withValues(alpha: 0.55),
              width: 1.4,
            ),
          ),
          child: const GabayMark(size: 26, color: AppColors.goldDeep),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Text('Gabay', style: AppTextStyles.serif(size: 26)),
                  const SizedBox(width: AppSpacing.sm),
                  const _PreviewTag(),
                ],
              ),
              const SizedBox(height: 2),
              Text('Your catering companion', style: AppTextStyles.bodySmall),
            ],
          ),
        ),
      ],
    );
  }
}

/// A small "PREVIEW" badge marking Gabay as not-yet-live.
class _PreviewTag extends StatelessWidget {
  const _PreviewTag();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.gold.withValues(alpha: 0.14),
        borderRadius: AppRadius.pillAll,
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
      ),
      child: Text(
        'PREVIEW',
        style: AppTextStyles.engraved(
          size: 8,
          color: AppColors.goldDeep,
          spacing: 1.4,
        ),
      ),
    );
  }
}

// ════════════════════════════ Assistant bubble ════════════════════════════
/// A left-aligned chat bubble spoken by Gabay, fronted by a small sparkle
/// avatar, on the parchment ground.
class _AssistantBubble extends StatelessWidget {
  const _AssistantBubble(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: AppColors.gold.withValues(alpha: 0.12),
            border: Border.all(color: AppColors.gold.withValues(alpha: 0.5)),
          ),
          child: const GabayMark(size: 15, color: AppColors.goldDeep),
        ),
        const SizedBox(width: AppSpacing.sm + 2),
        Expanded(
          child: AppCard(
            // Square off the top-left corner so the bubble points back at the
            // avatar, the usual chat-tail cue.
            radius: AppRadius.lg,
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Text(text, style: AppTextStyles.body),
          ),
        ),
      ],
    );
  }
}

// ════════════════════════════ Capability card ════════════════════════════
class _CapabilityCard extends StatelessWidget {
  const _CapabilityCard({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.12),
              borderRadius: AppRadius.mdAll,
            ),
            child: Icon(icon, size: 22, color: AppColors.goldDeep),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, style: AppTextStyles.serif(size: 16, height: 1.15)),
                const SizedBox(height: 3),
                Text(subtitle, style: AppTextStyles.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ════════════════════════════ Prompt chip ════════════════════════════
class _PromptChip extends StatelessWidget {
  const _PromptChip(this.label, {required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Text(
          label,
          style: AppTextStyles.sans(
            size: 12,
            weight: FontWeight.w600,
            color: AppColors.brownSoft,
            spacing: 0.2,
          ),
        ),
      ),
    );
  }
}

// ════════════════════════════ Composer ════════════════════════════
/// The chat input bar pinned above the bottom nav. Visual only for now — the
/// send button surfaces a "coming soon" note rather than dispatching a message.
class _Composer extends StatelessWidget {
  const _Composer({required this.controller, required this.onSend});

  final TextEditingController controller;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            AppSpacing.sm,
            AppSpacing.md,
            AppSpacing.sm,
          ),
          child: Row(
            children: [
              Expanded(
                child: AppTextField(
                  controller: controller,
                  hint: 'Ask Gabay anything…',
                  textInputAction: TextInputAction.send,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              PressableScale(
                onTap: onSend,
                child: Container(
                  width: 48,
                  height: 48,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    color: AppColors.brown,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.arrow_upward,
                    color: AppColors.cream,
                    size: 22,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
