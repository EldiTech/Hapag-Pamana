import 'package:flutter/material.dart';

import '../../../brand.dart';
import '../../../core/widgets/app_widgets.dart';
import '../../../widgets.dart';
import 'contact_us_page.dart';
import 'settings_widgets.dart';

/// "Help & FAQ" — the questions the app actually raises, answered.
///
/// The copy below describes the real flows: the two booking wizards, the 50%
/// downpayment PayMongo collects, the statuses the Orders dashboard moves an
/// order through, where the allergen tags come from, and what Gabay is (and
/// isn't) yet. Anything the app can't do is said plainly, with the way to get
/// it done instead — the point of a help screen is to end the question, not to
/// promise a feature.
class HelpFaqPage extends StatelessWidget {
  const HelpFaqPage({super.key});

  @override
  Widget build(BuildContext context) {
    Duration d(int ms) => Duration(milliseconds: ms);

    return SettingsScaffold(
      title: 'Help & FAQ',
      children: [
        FadeSlideIn(
          child: const SettingsLede(
            title: 'How can we help?',
            body: 'Tap a question to open it. If yours isn\'t here, we\'re a '
                'message away.',
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        for (final (i, group) in _groups.indexed) ...[
          FadeSlideIn(
            delay: d(60 + i * 60),
            child: SettingsSection(
              title: group.title,
              rows: [for (final faq in group.items) _FaqTile(faq)],
            ),
          ),
          const SizedBox(height: AppSpacing.xl),
        ],
        FadeSlideIn(
          delay: d(60 + _groups.length * 60),
          child: const _StillStuckCard(),
        ),
      ],
    );
  }
}

// ════════════════════════════ The questions ════════════════════════════
class _Faq {
  const _Faq(this.question, this.answer);

  final String question;
  final String answer;
}

class _FaqGroup {
  const _FaqGroup(this.title, this.items);

  final String title;
  final List<_Faq> items;
}

const List<_FaqGroup> _groups = [
  _FaqGroup('BOOKING & ORDERS', [
    _Faq(
      'How do I book catering?',
      'Open the Packages tab, choose the package you like and tap "Book Us '
          'Now". The wizard walks you through the date, the venue, your '
          'headcount and a dish for each course, then files the order. It '
          'reaches us as Pending right away, and we call your contact number '
          'to go through the details.',
    ),
    _Faq(
      'How do I order food packs or party trays?',
      'Also from the Packages tab — "Book Us Now" for food packs. It\'s a '
          'shorter form built around our written quotation: the occasion, when '
          'and where it\'s going, and a menu list with a pax count on every '
          'dish.',
    ),
    _Faq(
      'What do the order statuses mean?',
      'Pending — we have your order and are going through it.\n'
          'Confirmed — your date is locked in and the kitchen is planning for '
          'it.\n'
          'Completed — the event is done, and maraming salamat.\n'
          'Declined — we couldn\'t take that one on. Message us and we\'ll see '
          'what else we can arrange.',
    ),
    _Faq(
      'Where do I see the orders I\'ve sent?',
      'Settings → Order tracking. Every order you\'ve filed is there, newest '
          'first, with the open ones on top. It updates itself as we move an '
          'order along, so there\'s nothing to refresh.',
    ),
    _Faq(
      'Can I change or cancel an order I\'ve already sent?',
      'Not from the app. Once an order is filed, its details are ours to '
          'change — that\'s what stops an event being edited out from under the '
          'kitchen halfway through the planning. Call or message us and we\'ll '
          'adjust it with you.',
    ),
  ]),
  _FaqGroup('PAYING', [
    _Faq(
      'How much do I pay up front?',
      'Half the order total holds your date. The balance is settled with the '
          'team on the day of the event.',
    ),
    _Faq(
      'How can I pay the downpayment?',
      'With GCash, Maya, GrabPay or a Visa / Mastercard, on PayMongo\'s '
          'secure checkout page. Your card details never pass through this app '
          '— we only ever see that the payment cleared.',
    ),
    _Faq(
      'I closed the payment page before finishing. Is my order lost?',
      'No. Your order is filed before the payment, precisely so an interrupted '
          'checkout can\'t lose the form you filled in. Open Order tracking, '
          'tap the order and choose Pay — it hands you back the same checkout '
          'page, rather than starting a second one.',
    ),
    _Faq(
      'My order says you\'ll send a quotation. What does that mean?',
      'Some orders are priced by hand — a small delivery, or a spread that '
          'needs costing first. Those file without an online downpayment: '
          'we\'ll send you the quotation, then arrange the downpayment with '
          'you directly.',
    ),
    _Faq(
      'When is my booking actually confirmed?',
      'When we\'ve been through the details and the downpayment has landed. '
          'The status in Order tracking turns to Confirmed the moment it does '
          '— you don\'t have to chase us for it.',
    ),
  ]),
  _FaqGroup('THE MENU & ALLERGENS', [
    _Faq(
      'Where do the allergen tags come from?',
      'Our own kitchen tags every dish. On the Menu, the allergen map shows '
          'how those tags run across the dishes you\'re looking at — warmer '
          'means both more common and higher-risk, so a peanut tag reads '
          'hotter than a soy one.',
    ),
    _Faq(
      'Can you cook around an allergy?',
      'Set the allergens in Settings → Dietary preference and we\'ll flag any '
          'dish on the Menu that carries one. Please also tell us in your '
          'booking notes and give us a call: we cook everything in one kitchen '
          'on shared equipment, so we can warn you, but we can\'t promise a '
          'dish is free of traces.',
    ),
    _Faq(
      'A dish I liked has disappeared from the Menu.',
      'The kitchen decides what\'s on show, so a dish comes off when it\'s out '
          'of season or resting for a while. It stays on your past orders, and '
          'you can always ask us about it.',
    ),
  ]),
  _FaqGroup('YOUR ACCOUNT', [
    _Faq(
      'How do I change my profile photo?',
      'Open the Account tab and tap your picture. You can choose one from your '
          'gallery, or remove the one that\'s there.',
    ),
    _Faq(
      'I\'ve forgotten my password.',
      'On the log-in screen, tap "Forgot password?" and give us your email '
          'address — a reset link is on its way within a minute or two. Check '
          'your spam folder if it seems slow.',
    ),
    _Faq(
      'Can I change my email address or phone number?',
      'Not in the app yet. Your number is also how we keep two accounts from '
          'sharing one contact, so it\'s moved by hand — message us and we\'ll '
          'take care of it.',
    ),
    _Faq(
      'I can\'t sign in even though my password is right.',
      'An account can be suspended if something has gone wrong with it. Get in '
          'touch and we\'ll go through it with you.',
    ),
    _Faq(
      'What do you do with my information?',
      'Only what we need to cook for you and keep your account working. '
          'Settings → Privacy Policy lists exactly what we hold, who sees it, '
          'and how to have it changed or removed.',
    ),
  ]),
  _FaqGroup('GABAY', [
    _Faq(
      'What is Gabay?',
      '"Gabay" means guide — it\'s your catering companion, in the middle of '
          'the bottom bar. It\'s still in preview: the plan is meal and '
          'package ideas drawn from your past orders, matching a package to '
          'your budget and headcount, lighter swaps for a dish, and pointers '
          'on your event layout. Your two Settings switches — "Gabay '
          'suggestions" and "Healthier suggestions first" — are what it will '
          'follow when it opens up.',
    ),
  ]),
];

// ════════════════════════════ Tiles ════════════════════════════
/// One question, opening onto its answer. Collapsed by default so a group reads
/// as a scannable list rather than a wall of prose.
class _FaqTile extends StatefulWidget {
  const _FaqTile(this.faq);

  final _Faq faq;

  @override
  State<_FaqTile> createState() => _FaqTileState();
}

class _FaqTileState extends State<_FaqTile> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: () => setState(() => _open = !_open),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    widget.faq.question,
                    style: AppTextStyles.sans(
                      size: 14,
                      weight: FontWeight.w600,
                      color: AppColors.brown,
                      height: 1.35,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                AnimatedRotation(
                  turns: _open ? 0.5 : 0,
                  duration: Motion.quick,
                  curve: Motion.standard,
                  child: Icon(
                    Icons.expand_more,
                    size: 20,
                    color: AppColors.goldDeep.withValues(alpha: 0.8),
                  ),
                ),
              ],
            ),
            // AnimatedSize clips as it grows, so the answer unrolls from under
            // the question instead of appearing all at once.
            AnimatedSize(
              duration: Motion.base,
              curve: Motion.standard,
              alignment: Alignment.topCenter,
              child: _open
                  ? Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.sm),
                      child: Text(widget.faq.answer, style: AppTextStyles.body),
                    )
                  : const SizedBox(width: double.infinity),
            ),
          ],
        ),
      ),
    );
  }
}

/// The way out of the FAQ when it hasn't answered the question. Shaped like the
/// home page's catering invitation — the same inverted plate, gold call to
/// action and icon disc — so the app's one "come talk to us" gesture reads the
/// same wherever it appears.
class _StillStuckCard extends StatelessWidget {
  const _StillStuckCard();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => Navigator.of(context).push(
        BrandPageRoute(builder: (_) => const ContactUsPage()),
      ),
      radius: AppRadius.xl,
      padding: const EdgeInsets.all(AppSpacing.xxl - 2),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [AppColors.brown, AppColors.olive],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'STILL NEED A HAND?',
                  style: AppTextStyles.engraved(
                    size: 10,
                    color: AppColors.gold,
                    spacing: 2,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm + 2),
                Text(
                  'Ask us anything.',
                  style: AppTextStyles.serif(
                    size: 21,
                    color: AppColors.cream,
                    height: 1.15,
                  ),
                ),
                const SizedBox(height: 14),
                Row(
                  children: [
                    Text(
                      'Contact us',
                      style: AppTextStyles.sans(
                        size: 12,
                        weight: FontWeight.w600,
                        color: AppColors.gold,
                        spacing: 0.5,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Icon(
                      Icons.arrow_forward,
                      size: 16,
                      color: AppColors.gold,
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Container(
            width: 56,
            height: 56,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: AppColors.cream.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.chat_bubble_outline,
              color: AppColors.cream,
              size: 26,
            ),
          ),
        ],
      ),
    );
  }
}
