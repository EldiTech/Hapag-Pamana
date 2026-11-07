import 'dart:async';

import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../core/widgets/app_widgets.dart';
import '../../data/customer_repository.dart';
import '../../data/catering.dart';
import '../../data/product.dart';
import '../../data/member_preferences.dart';
import '../../data/recommendation_repository.dart';
import '../../widgets.dart';
import '../detail_sheets.dart';
import '../home_sections.dart';
import 'user_shell.dart';
import '../../data/booking.dart';
import '../../data/booking_repository.dart';
import '../../data/catering_repository.dart';
import '../../data/gabay_brain.dart';
import '../../data/gabay_corpus.dart';
import '../../data/gabay_user_model.dart';
import '../../data/product_repository.dart';

/// Gabay — the member-side AI catering companion ("gabay" = guide).
///
/// Now partially functional: the assistant can hold a grounded conversation
/// (FAQ, package matching by budget + headcount, healthier-menu suggestions,
/// and an honest "why was this recommended?" explanation) from the business's
/// own cleaned content, on-device. The live "Picks just for you" panel still
/// runs from the recommendation stream as before.
///
/// Out of scope for this pass: open-ended chit-chat, changing filed orders, and
/// anything that fabricates a package, price, or inclusion that isn't published.
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
  final _GabayChat _chat = _GabayChat();

  StreamSubscription<RecommendationSet>? _recSub;
  RecommendationSet _recs = RecommendationSet.empty;
  bool _recsLoading = true;

  /// The member's own orders, watched live so an answer about "my orders"
  /// reflects the latest status the team has written.
  StreamSubscription<List<Booking>>? _ordersSub;
  List<Booking> _orders = const [];

  /// The catalogue Gabay is grounded on, loaded once when the tab opens. Kept
  /// as plain snapshots rather than re-read per message: the corpus is rebuilt
  /// from them for every reply, which is cheap, but two Firestore reads per
  /// keystroke would not be.
  List<CateringPackage> _packages = const [];
  List<Product> _menu = const [];

  /// True while a reply is being composed, so the chat can show it is working.
  bool _thinking = false;

  /// The capabilities Gabay now actually offers. "Picks just for you" is still
  /// absent from this list because it's live and lives in [_RecommendedPanel].
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

  /// Starter prompts shown as tappable chips — now wired to real replies.
  static const List<String> _starters = [
    'Recommend a package for ₱20,000 · 50 pax',
    'Suggest healthier meal options',
    'Why was this package recommended?',
    'Help me plan my event layout',
    'How do I book catering?',
    'When is your busiest season?',
    'Make me a planning checklist',
  ];

  @override
  void initState() {
    super.initState();
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

    // The member's own orders and the live catalogue are what Gabay is grounded
    // on; both are loaded once here, then kept current by the streams.
    _ordersSub = BookingRepository().watchMine().listen(
      (orders) {
        if (!mounted) return;
        setState(() => _orders = orders);
      },
      onError: (_) {},
    );
    CateringRepository().watchPackages().first.then(
      (packages) {
        if (!mounted) return;
        setState(() => _packages = packages);
      },
      onError: (_) {},
    );
    ProductRepository().watchVisible().first.then(
      (menu) {
        if (!mounted) return;
        setState(() => _menu = menu);
      },
      onError: (_) {},
    );
  }

  @override
  void dispose() {
    _recSub?.cancel();
    _ordersSub?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    FocusScope.of(context).unfocus();
    _controller.clear();
    _chat.addUser(text);
    _replay(text);
  }

  void _replay(String text) {
    // Keep the helper static from the UI's point of view: schedule a rebuild
    // when the reply lands, and surface errors as a quiet note rather than a
    // broken screen.
    setState(() => _thinking = true);
    _chat
        .reply(
          text,
          prefs: MemberPreferencesScope.value,
          recs: _recs,
          orders: _orders,
          packages: _packages,
          menu: _menu,
          displayName: CustomerRepository().displayName,
        )
        .then(
          (reply) {
            if (!mounted) return;
            setState(() {
              _chat.addAssistant(reply);
              _thinking = false;
            });
          },
          onError: (error) {
            if (!mounted) return;
            setState(() {
              _thinking = false;
              _chat.addAssistant(
                'Sorry — I dropped your message. Try again in a moment.',
              );
            });
          },
        );
  }

  void _sendStarter(String prompt) {
    FocusScope.of(context).unfocus();
    _controller.text = prompt;
    _send();
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
                SmoothReveal(
                  visible:
                      prefs.gabaySuggestions &&
                      (_recsLoading || _recs.isNotEmpty),
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.section),
                    child: FadeSlideIn(
                      delay: const Duration(milliseconds: 110),
                      child: _RecommendedPanel(
                        loading: _recsLoading,
                        set: _recs,
                        onOpenPackages: widget.onNavigate == null
                            ? null
                            : () => widget.onNavigate!(UserShell.tabPackages),
                      ),
                    ),
                  ),
                ),

                // ── Conversation ─────────────────────────────────────────────
                FadeSlideIn(
                  delay: const Duration(milliseconds: 140),
                  child: _ChatHistory(_chat.messages),
                ),
                if (_thinking) ...[
                  const SizedBox(height: AppSpacing.sm),
                  const _AssistantTyping(),
                ],
                const SizedBox(height: AppSpacing.section),

                FadeSlideIn(
                  delay: const Duration(milliseconds: 170),
                  child: Text(
                    'HERE\'S HOW I CAN HELP',
                    style: AppTextStyles.eyebrow,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                for (var i = 0; i < _capabilities.length; i++) ...[
                  FadeSlideIn(
                    delay: Duration(milliseconds: 200 + i * 50),
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
                  delay: const Duration(milliseconds: 280),
                  child: Text('TRY ASKING', style: AppTextStyles.eyebrow),
                ),
                const SizedBox(height: AppSpacing.md),
                FadeSlideIn(
                  delay: const Duration(milliseconds: 320),
                  child: Wrap(
                    spacing: AppSpacing.sm,
                    runSpacing: AppSpacing.sm,
                    children: [
                      for (final prompt in _starters)
                        _PromptChip(prompt, onTap: () => _sendStarter(prompt)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          _Composer(controller: _controller, onSend: _send),
        ],
      ),
    );
  }
}

// ════════════════════════════ Chat history ════════════════════════════
/// The scrolling conversation so far — user messages and assistant replies, both
/// rendered as chat bubbles.
class _ChatHistory extends StatelessWidget {
  const _ChatHistory(this.messages);

  final List<_GabayMessage> messages;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) return const SizedBox.shrink();

    return Container(
      constraints: const BoxConstraints(maxHeight: 360),
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
      child: ListView.separated(
        shrinkWrap: true,
        physics: const AlwaysScrollableScrollPhysics(),
        itemCount: messages.length,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (context, i) {
          final message = messages[i];
          return message.isFromUser
              ? _UserBubble(message.text)
              : _AssistantBubble(message.text);
        },
      ),
    );
  }
}

class _UserBubble extends StatelessWidget {
  const _UserBubble(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Expanded(
          child: AppCard(
            radius: AppRadius.lg,
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Text(text, style: AppTextStyles.body),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
      ],
    );
  }
}

// ════════════════════════════ Recommended panel ════════════════════════════
/// "Picks just for you" — the collaborative-filtering recommendations, in the
/// one place on the member side that can explain itself.
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
          SmoothReveal(
            visible: !loading,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.sm,
                AppSpacing.md,
                0,
              ),
              child: RecommendationSourceBadge(set.source),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: 196,
            child: SmoothSwap(
              alignment: Alignment.center,
              child: loading
                  ? const Center(
                      key: ValueKey('picks-loading'),
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
                      key: const ValueKey('picks'),
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
          ),
          SmoothReveal(
            visible: !loading && onOpenPackages != null,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.sm + 2,
                AppSpacing.md,
                0,
              ),
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
          ),
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

// ════════════════════════════ Grounded chat controller ════════════════════════════
/// The conversation's state for one member: the bubbles drawn so far, the slots
/// Gabay has collected, and the bridge to [GabayBrain].
///
/// The UI stays deliberately thin — it draws bubbles and asks for a reply.
/// Everything that decides *what* Gabay says lives in the brain, which is
/// grounded on the business's own catalog, written policies and uploaded sales
/// workbooks, and personalised from this member's own orders and settings.
class _GabayChat {
  final List<_GabayMessage> messages = [];

  /// Slots survive across turns, so a follow-up like "budget is 20,000"
  /// completes the package match the previous message started instead of
  /// starting over.
  final GabaySlots _slots = GabaySlots();

  void addUser(String text) {
    messages.add(_GabayMessage(text, fromUser: true));
  }

  void addAssistant(String text) {
    messages.add(_GabayMessage(text, fromUser: false));
  }

  Future<String> reply(
    String text, {
    required MemberPreferences prefs,
    required RecommendationSet recs,
    required List<Booking> orders,
    required List<CateringPackage> packages,
    required List<Product> menu,
    required String? displayName,
  }) async {
    final user = GabayUserModel.build(
      displayName: displayName,
      bookings: orders,
      menu: menu,
      prefs: prefs,
      profile: prefs.tasteProfile,
    );
    final brain = GabayBrain(
      corpus: GabayCorpus.build(packages: packages, menu: menu),
      packages: packages,
      menu: menu,
      user: user,
      prefs: prefs,
      recs: recs,
      slots: _slots,
    );
    return brain.respond(text);
  }
}

class _GabayMessage {
  const _GabayMessage(this.text, {required this.fromUser});

  final String text;
  final bool fromUser;

  bool get isFromUser => fromUser;
}

/// The "Gabay is working on it" bubble shown while a reply is composed. Short
/// and quiet — the reply itself is usually one frame away.
class _AssistantTyping extends StatelessWidget {
  const _AssistantTyping();

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
            radius: AppRadius.lg,
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Text('Gabay is putting that together…', style: AppTextStyles.bodySmall),
          ),
        ),
      ],
    );
  }
}
