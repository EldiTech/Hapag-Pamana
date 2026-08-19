import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/external_link.dart';
import '../core/widgets/app_widgets.dart';
import '../widgets.dart';

/// About screen — the real Fill at Home story told as an heirloom editorial:
/// the family mantra as a hero pull-quote, the origin paragraphs, a Day 1 →
/// Day 365 milestone timeline, the closing message, the offerings, and working
/// contact / social links (dialer, maps, e-mail, browser — with a clipboard
/// fallback when no app can take the link).
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  @override
  Widget build(BuildContext context) {
    Duration d(int ms) => Duration(milliseconds: ms);

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.screen,
        AppSpacing.lg,
        AppSpacing.screen,
        AppSpacing.section,
      ),
      children: [
        // ── The mantra ──────────────────────────────────────────────────────
        const FadeSlideIn(child: _MantraHero()),
        const SizedBox(height: AppSpacing.section),

        // ── Where it began ──────────────────────────────────────────────────
        FadeSlideIn(
          delay: d(120),
          child: const _SectionIntro('WHERE WE BEGAN', 'Our Story'),
        ),
        const SizedBox(height: AppSpacing.md),
        FadeSlideIn(
          delay: d(160),
          child: Text(
            'We tried to open a small Fill at Home canteen back in 2016. It '
            'did not work out — but it was an exciting experience for us. We '
            'went back to being a small family of employees, working every '
            'day to make ends meet: earning enough to pay the bills, put '
            'food on the table and send the kids to school.',
            style: AppTextStyles.body,
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        FadeSlideIn(delay: d(200), child: const _PullLine()),
        const SizedBox(height: AppSpacing.section),

        // ── The first year, milestone by milestone ──────────────────────────
        FadeSlideIn(
          delay: d(260),
          child: const _SectionIntro('THE FIRST YEAR', 'From Day 1 to Day 365'),
        ),
        const SizedBox(height: AppSpacing.lg),
        ...List.generate(_milestones.length, (i) {
          return FadeSlideIn(
            delay: d(300 + i * 60),
            child: _TimelineTile(
              _milestones[i],
              isLast: i == _milestones.length - 1,
            ),
          );
        }),
        const SizedBox(height: AppSpacing.section),

        // ── The message the family signs off with ───────────────────────────
        FadeSlideIn(delay: d(700), child: const _ClosingQuoteCard()),
        const SizedBox(height: AppSpacing.section),

        // ── Offerings ───────────────────────────────────────────────────────
        FadeSlideIn(
          delay: d(760),
          child: const _SectionIntro('AT YOUR TABLE', 'What We Offer'),
        ),
        const SizedBox(height: AppSpacing.sm + 2),
        FadeSlideIn(
          delay: d(790),
          child: Text(
            'A seat at our table for every occasion — from a weekday craving '
            'to a once-in-a-lifetime celebration.',
            style: AppTextStyles.body,
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        ...List.generate(_offers.length, (i) {
          final offer = _offers[i];
          return Padding(
            padding: EdgeInsets.only(
              bottom: i < _offers.length - 1 ? 12 : 0,
            ),
            child: FadeSlideIn(
              delay: d(820 + i * 50),
              child: _OfferCard(offer),
            ),
          );
        }),
        const SizedBox(height: AppSpacing.section),

        // ── Contact ─────────────────────────────────────────────────────────
        FadeSlideIn(
          delay: d(1040),
          child: const _SectionIntro('COME SAY HELLO', 'Visit Us'),
        ),
        const SizedBox(height: AppSpacing.lg),
        FadeSlideIn(delay: d(1080), child: const _ContactCard()),
        const SizedBox(height: AppSpacing.section),

        // ── Social ──────────────────────────────────────────────────────────
        FadeSlideIn(
          delay: d(1140),
          child: const _SectionIntro('KEEP IN TOUCH', 'Follow Us'),
        ),
        const SizedBox(height: AppSpacing.lg),
        FadeSlideIn(delay: d(1180), child: const _SocialRow()),
        const SizedBox(height: AppSpacing.section),

        // ── Sign-off ────────────────────────────────────────────────────────
        FadeSlideIn(delay: d(1240), child: const _Footer()),
      ],
    );
  }
}

// ═══════════════════════════ Sections ═══════════════════════════

/// Engraved eyebrow over a serif heading — the page's one section-opening
/// gesture, so every chapter of the story starts with the same breath.
class _SectionIntro extends StatelessWidget {
  const _SectionIntro(this.eyebrow, this.title);

  final String eyebrow;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(eyebrow, style: AppTextStyles.eyebrow),
        const SizedBox(height: 6),
        Text(title, style: AppTextStyles.heading),
      ],
    );
  }
}

/// The family mantra as the hero — an inverted brown→olive plate, matching the
/// home page's catering invitation, so the page opens on the words the whole
/// story hangs from.
class _MantraHero extends StatelessWidget {
  const _MantraHero();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      radius: AppRadius.xl,
      padding: const EdgeInsets.all(AppSpacing.xxl),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [AppColors.brown, AppColors.olive],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'SINCE 2016 · THE FILL AT HOME STORY',
            style: AppTextStyles.engraved(
              size: 10,
              color: AppColors.gold,
              spacing: 1.8,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            '“Be patient — your small business will grow enough to pay '
            'your bills.”',
            style: AppTextStyles.serif(
              size: 22,
              color: AppColors.cream,
              italic: true,
              height: 1.3,
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Row(
            children: [
              Container(width: 28, height: 2, color: AppColors.gold),
              const SizedBox(width: AppSpacing.sm + 2),
              Text(
                'OUR MANTRA FROM DAY ONE',
                style: AppTextStyles.engraved(
                  size: 9,
                  color: AppColors.cream.withValues(alpha: 0.8),
                  spacing: 1.6,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The "little did we know" line, set apart from the body copy by a gold rule
/// — the sentence the whole first year turns on.
class _PullLine extends StatelessWidget {
  const _PullLine();

  @override
  Widget build(BuildContext context) {
    // IntrinsicHeight bounds the stretch: in the unbounded height of the
    // scrolling page, a bare stretched Row would force the gold rule to an
    // infinite height and kill layout for everything below it.
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 3,
            decoration: BoxDecoration(
              color: AppColors.gold,
              borderRadius: AppRadius.pillAll,
            ),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Text(
              'Little did we know that with a little effort, prayer and grit, '
              'this small business would become our lifeline.',
              style: AppTextStyles.serif(size: 16, italic: true, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ Timeline ═══════════════════════════

/// One phase of the first year — a label, a title and the phase's full story
/// told in as many paragraphs as it takes.
class _Milestone {
  const _Milestone(
    this.label,
    this.title,
    this.paragraphs,
    this.icon, {
    this.tag,
    this.highlight = false,
  });

  final String label;
  final String title;
  final List<String> paragraphs;
  final IconData icon;

  /// Optional small pill under the body (e.g. the #ParaSaBayan hashtag).
  final String? tag;

  /// Day 365 gets the warm, celebrated treatment.
  final bool highlight;
}

/// The first year, phase by phase, in the family's own words — the full story,
/// not a summary.
const List<_Milestone> _milestones = [
  _Milestone(
    'DAY 1',
    'Para sa Bayan',
    [
      'It began when one of our siblings still had time to share her '
          '#ParaSaBayan posts — we started mainly as a food supplier to '
          'frontliners at the start of the pandemic. We just wanted to make '
          'sure the frontliners were provided with clean and yummy food, and '
          'at the same time it was an opportunity for us to earn extra '
          'income — so we went for it.',
      'We were just five siblings, using our normal household stuff as '
          'equipment, cooking meals daily for 100 people. This went on for '
          'a few days, until we were able to save enough to invest in more '
          'equipment for our kitchen.',
    ],
    Icons.volunteer_activism_outlined,
    tag: '#ParaSaBayan',
  ),
  _Milestone(
    'JUNE',
    'The Kitchen',
    [
      'We started to rent an apartment that we now call “The Kitchen”. This '
          'is where our family started to grow, our equipment started to '
          'pile up, and more clients came knocking — where we grew as a '
          'family and as a small business.',
      'We also started adding to our small family by hiring our first few '
          'staff members, Ate Toneth and CJ — and with their help, we were '
          'able to add even more people to our family.',
      'June was also our first ever catering event. We still remember the '
          'sleepless nights, the excitement, the adrenaline.',
    ],
    Icons.soup_kitchen_outlined,
  ),
  _Milestone(
    'AUGUST',
    'Meet Filla',
    [
      'Operations started to become faster and we were getting more and '
          'more clients, so we decided to buy our first service vehicle — '
          'we call him Filla.',
      'You see, we are very sentimental about all the things we buy and '
          'invest in, and about the people we hire. This is because we know '
          'that with these, big and small, we can become more.',
    ],
    Icons.local_shipping_outlined,
  ),
  _Milestone(
    'DECEMBER',
    'A Family Wedding',
    [
      'The couple who started Fill at Home tied the knot — and all the Fill '
          'at Home family members were present.',
    ],
    Icons.favorite_outline,
  ),
  _Milestone(
    'JANUARY',
    'The Second Kitchen',
    [
      'We started renting a Second Kitchen, to accommodate more orders, '
          'more equipment and more staff.',
    ],
    Icons.home_work_outlined,
  ),
  _Milestone(
    'DAY 365',
    'We Are Still Here',
    [
      'It started as seven siblings — and now, with all our staff and the '
          'second-generation family members, we are 25 strong.',
      'We are still growing, and with the help of our clients and our '
          'members, we will grow more. Soon, we are off to our next '
          'milestone — our biggest investment yet: the new home for Fill '
          'at Home.',
    ],
    Icons.groups_outlined,
    highlight: true,
  ),
];

/// One rung of the timeline — a gold-rimmed icon disc on a gold spine, beside
/// the milestone's engraved date, serif title and body. The highlighted final
/// milestone sits on a warm gold-washed card with an inverted disc.
class _TimelineTile extends StatelessWidget {
  const _TimelineTile(this.milestone, {required this.isLast});

  final _Milestone milestone;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final disc = Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: milestone.highlight ? AppColors.brown : AppColors.surface,
        shape: BoxShape.circle,
        border: Border.all(
          color: AppColors.gold.withValues(alpha: milestone.highlight ? 0.8 : 0.35),
        ),
      ),
      child: Icon(
        milestone.icon,
        size: 18,
        color: milestone.highlight ? AppColors.gold : AppColors.goldDeep,
      ),
    );

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          milestone.label,
          style: AppTextStyles.engraved(
            size: 9,
            color: AppColors.goldDeep,
            spacing: 1.6,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          milestone.title,
          style: AppTextStyles.serif(size: 17, height: 1.2),
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < milestone.paragraphs.length; i++) ...[
          if (i > 0) const SizedBox(height: AppSpacing.sm + 2),
          Text(milestone.paragraphs[i], style: AppTextStyles.body),
        ],
        if (milestone.tag != null) ...[
          const SizedBox(height: AppSpacing.sm + 2),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(
              borderRadius: AppRadius.pillAll,
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.4)),
            ),
            child: Text(
              milestone.tag!,
              style: AppTextStyles.sans(
                size: 10,
                weight: FontWeight.w700,
                color: AppColors.goldDeep,
                spacing: 0.6,
              ),
            ),
          ),
        ],
      ],
    );

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 38,
            child: Column(
              children: [
                disc,
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.gold.withValues(alpha: 0.3),
                        borderRadius: AppRadius.pillAll,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.xl),
              child: milestone.highlight
                  ? AppCard(
                      padding: const EdgeInsets.all(AppSpacing.lg),
                      color: AppColors.gold.withValues(alpha: 0.10),
                      child: content,
                    )
                  : content,
            ),
          ),
        ],
      ),
    );
  }
}

/// The story's sign-off — the "if you have a dream" message, centred on
/// parchment under the family's twin hearts.
class _ClosingQuoteCard extends StatelessWidget {
  const _ClosingQuoteCard();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      radius: AppRadius.xl,
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              Icon(Icons.favorite, size: 14, color: AppColors.gold),
              SizedBox(width: 4),
              Icon(Icons.favorite, size: 14, color: AppColors.goldDeep),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            'So if you have a dream — no matter how difficult — put your '
            'heart into it and slowly ease your way toward your goals. And if '
            'you are lucky, you will succeed together with your family.',
            textAlign: TextAlign.center,
            style: AppTextStyles.serif(size: 17, italic: true, height: 1.45),
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            '— THE FILL AT HOME FAMILY',
            style: AppTextStyles.engraved(
              size: 9,
              color: AppColors.goldDeep,
              spacing: 1.8,
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ Offerings ═══════════════════════════

/// One thing the kitchen does — an icon, a name and a sentence of warmth.
class _Offer {
  const _Offer(this.icon, this.title, this.description);

  final IconData icon;
  final String title;
  final String description;
}

/// The offerings shown under "What We Offer", ordered from the everyday plate
/// to the full celebration.
const List<_Offer> _offers = [
  _Offer(
    Icons.soup_kitchen_outlined,
    'Home-Style Filipino Cooking',
    'Comfort-food classics — adobo, kare-kare, sinigang and kakanin — '
        'cooked fresh, the way they were handed down.',
  ),
  _Offer(
    Icons.takeout_dining_outlined,
    'Party Trays & Bilao',
    'Generous trays and bilao for fiestas, reunions and office spreads — '
        'handa na para sa handaan.',
  ),
  _Offer(
    Icons.room_service_outlined,
    'Full-Service Catering',
    'From intimate gatherings to grand celebrations, we bring the feast, '
        'the setup and the heart of the home.',
  ),
  _Offer(
    Icons.celebration_outlined,
    'Event Styling & Setups',
    'Curated buffet styling and themed table setups that turn any venue '
        'into a celebration to remember.',
  ),
];

/// A single offering — a gold-rimmed icon disc beside a serif title and a warm
/// line of body copy. Full-width and editorial so each offer has room to read.
class _OfferCard extends StatelessWidget {
  const _OfferCard(this.offer);

  final _Offer offer;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: AppColors.placeholderFill,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
            ),
            child: Icon(offer.icon, color: AppColors.goldDeep, size: 22),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  offer.title,
                  style: AppTextStyles.serif(size: 16, height: 1.2),
                ),
                const SizedBox(height: 6),
                Text(offer.description, style: AppTextStyles.body),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ Contact & social ═══════════════════════════

/// The four ways to reach the kitchen, in one card. Every tappable row opens
/// the matching app — maps, dialer, mail — via [openExternalLink].
class _ContactCard extends StatelessWidget {
  const _ContactCard();

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[
      _ContactRow(
        icon: Icons.location_on_outlined,
        label: 'FIND US',
        value: 'The Kitchen · Metro Manila, Philippines',
        onTap: () => openExternalLink(
          context,
          Uri.parse(
            'https://www.google.com/maps/search/?api=1'
            '&query=Fill+at+Home+Catering',
          ),
          copyValue: 'Fill at Home Catering, Metro Manila',
          copiedWhat: 'Our address',
        ),
      ),
      const _ContactRow(
        icon: Icons.access_time,
        label: 'KITCHEN HOURS',
        value: 'Monday – Sunday · 8:00 AM – 8:00 PM',
      ),
      _ContactRow(
        icon: Icons.phone_outlined,
        label: 'CALL OR TEXT',
        value: '0917 123 4567',
        onTap: () => openExternalLink(
          context,
          Uri.parse('tel:+639171234567'),
          copyValue: '09171234567',
          copiedWhat: 'Phone number',
        ),
      ),
      _ContactRow(
        icon: Icons.mail_outline,
        label: 'E-MAIL',
        value: 'hello@fillathome.ph',
        onTap: () => openExternalLink(
          context,
          Uri.parse('mailto:hello@fillathome.ph'),
          copyValue: 'hello@fillathome.ph',
          copiedWhat: 'E-mail address',
        ),
      ),
    ];

    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.xs,
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++) ...[
            if (i > 0) Container(height: 1, color: AppColors.hairline),
            rows[i],
          ],
        ],
      ),
    );
  }
}

/// One contact line — icon disc, engraved label over the value, and a quiet
/// north-east arrow when the row goes somewhere.
class _ContactRow extends StatelessWidget {
  const _ContactRow({
    required this.icon,
    required this.label,
    required this.value,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final row = Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.placeholderFill,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
            ),
            child: Icon(icon, size: 18, color: AppColors.goldDeep),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: AppTextStyles.engraved(
                    size: 8,
                    color: AppColors.goldDeep,
                    spacing: 1.4,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  style: AppTextStyles.sans(
                    size: 13,
                    weight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          if (onTap != null)
            Icon(
              Icons.north_east,
              size: 14,
              color: AppColors.brownSoft.withValues(alpha: 0.7),
            ),
        ],
      ),
    );

    if (onTap == null) return row;
    return PressableScale(onTap: onTap, child: row);
  }
}

/// The social pages as labelled pills — each opens the page in the browser
/// (or its app) rather than a bare dot that goes nowhere.
class _SocialRow extends StatelessWidget {
  const _SocialRow();

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm + 2,
      runSpacing: AppSpacing.sm + 2,
      children: [
        _SocialPill(
          icon: Icons.facebook,
          label: 'Facebook',
          url: 'https://www.facebook.com/fillathome',
        ),
        _SocialPill(
          icon: Icons.photo_camera_outlined,
          label: 'Instagram',
          url: 'https://www.instagram.com/fillathome',
        ),
        _SocialPill(
          icon: Icons.music_note_outlined,
          label: 'TikTok',
          url: 'https://www.tiktok.com/@fillathome',
        ),
      ],
    );
  }
}

class _SocialPill extends StatelessWidget {
  const _SocialPill({
    required this.icon,
    required this.label,
    required this.url,
  });

  final IconData icon;
  final String label;
  final String url;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: () => openExternalLink(
        context,
        Uri.parse(url),
        copyValue: url,
        copiedWhat: '$label link',
      ),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: AppColors.goldDeep),
            const SizedBox(width: AppSpacing.sm),
            Text(
              label,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                spacing: 0.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Quiet centred sign-off, echoing the 🧡💛 the family ends every post with.
class _Footer extends StatelessWidget {
  const _Footer();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(width: 36, height: 1, color: AppColors.hairline),
            const SizedBox(width: AppSpacing.md),
            const Icon(Icons.favorite, size: 11, color: AppColors.gold),
            const SizedBox(width: 3),
            const Icon(Icons.favorite, size: 11, color: AppColors.goldDeep),
            const SizedBox(width: AppSpacing.md),
            Container(width: 36, height: 1, color: AppColors.hairline),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          'FILL AT HOME · SINCE 2016',
          style: AppTextStyles.engraved(
            size: 9,
            color: AppColors.brownSoft,
            spacing: 2,
          ),
        ),
      ],
    );
  }
}
