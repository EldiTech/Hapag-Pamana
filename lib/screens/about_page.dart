import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/external_link.dart';
import '../core/widgets/app_widgets.dart';
import '../data/about_content.dart';
import '../widgets.dart';

/// About screen — the heirloom Fill at Home & Hapag Pamana story told with
/// simple, elegant editorial design, populated live from the Content Moderator.
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  @override
  Widget build(BuildContext context) {
    Duration d(int ms) => Duration(milliseconds: ms);

    return ValueListenableBuilder<AboutContent>(
      valueListenable: AboutContentScope.notifier,
      builder: (context, about, _) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.lg,
            AppSpacing.screen,
            AppSpacing.section * 1.2,
          ),
          children: [
            // ── Hero Mantra Card ──────────────────────────────────────────
            FadeSlideIn(child: _MantraHero(about.mantra)),
            const SizedBox(height: AppSpacing.section),

            // ── Where it began ────────────────────────────────────────────
            FadeSlideIn(
              delay: d(100),
              child: _SectionIntro(
                eyebrow: about.story.eyebrow,
                title: about.story.title,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            FadeSlideIn(
              delay: d(140),
              child: Text(
                about.story.body,
                style: AppTextStyles.body.copyWith(height: 1.6),
              ),
            ),
            if (about.story.pullquote.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.lg),
              FadeSlideIn(
                delay: d(180),
                child: _PullLine(about.story.pullquote),
              ),
            ],
            const SizedBox(height: AppSpacing.section),

            // ── Milestone Timeline ────────────────────────────────────────
            FadeSlideIn(
              delay: d(220),
              child: _SectionIntro(
                eyebrow: about.milestonesEyebrow,
                title: about.milestonesTitle,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            ...List.generate(about.milestones.length, (i) {
              return FadeSlideIn(
                delay: d(260 + i * 40),
                child: _TimelineTile(
                  about.milestones[i],
                  isLast: i == about.milestones.length - 1,
                ),
              );
            }),
            const SizedBox(height: AppSpacing.section),

            // ── Closing Family Quote ──────────────────────────────────────
            FadeSlideIn(delay: d(550), child: _ClosingQuoteCard(about.quote)),
            const SizedBox(height: AppSpacing.section),

            // ── Offerings ─────────────────────────────────────────────────
            FadeSlideIn(
              delay: d(600),
              child: _SectionIntro(
                eyebrow: about.offeringsEyebrow,
                title: about.offeringsTitle,
              ),
            ),
            if (about.offeringsSubtitle.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              FadeSlideIn(
                delay: d(640),
                child: Text(
                  about.offeringsSubtitle,
                  style: AppTextStyles.body.copyWith(height: 1.5),
                ),
              ),
            ],
            const SizedBox(height: AppSpacing.lg),
            FadeSlideIn(
              delay: d(680),
              child: _OfferingsSection(about.offers),
            ),
            const SizedBox(height: AppSpacing.section),

            // ── Contact Card ──────────────────────────────────────────────
            FadeSlideIn(
              delay: d(720),
              child: const _SectionIntro(
                eyebrow: 'COME SAY HELLO',
                title: 'Visit Us',
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            FadeSlideIn(delay: d(760), child: _ContactCard(about.contact)),
            const SizedBox(height: AppSpacing.section),

            // ── Social Channels ───────────────────────────────────────────
            FadeSlideIn(
              delay: d(800),
              child: const _SectionIntro(
                eyebrow: 'KEEP IN TOUCH',
                title: 'Follow Our Journey',
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            FadeSlideIn(delay: d(840), child: _SocialRow(about.social)),
            const SizedBox(height: AppSpacing.section * 1.2),

            // ── Refined Footer ────────────────────────────────────────────
            FadeSlideIn(delay: d(880), child: _Footer(about.footer)),
          ],
        );
      },
    );
  }
}

// ═══════════════════════════ Section Header ═══════════════════════════

class _SectionIntro extends StatelessWidget {
  const _SectionIntro({required this.eyebrow, required this.title});

  final String eyebrow;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 14,
              height: 2,
              decoration: BoxDecoration(
                color: AppColors.gold,
                borderRadius: AppRadius.pillAll,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              eyebrow,
              style: AppTextStyles.engraved(
                size: 10,
                color: AppColors.goldDeep,
                spacing: 1.8,
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          title,
          style: AppTextStyles.serif(
            size: 22,
            weight: FontWeight.w600,
            color: AppColors.brown,
          ),
        ),
      ],
    );
  }
}

// ═══════════════════════════ Hero Mantra ═══════════════════════════

class _MantraHero extends StatelessWidget {
  const _MantraHero(this.mantra);

  final AboutMantra mantra;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      radius: AppRadius.xl,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xl,
        vertical: AppSpacing.xxl,
      ),
      gradient: const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [AppColors.espresso, AppColors.brown],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.gold.withValues(alpha: 0.22),
                  borderRadius: AppRadius.pillAll,
                  border: Border.all(
                    color: AppColors.gold.withValues(alpha: 0.45),
                    width: 0.8,
                  ),
                ),
                child: Text(
                  'SINCE 2016',
                  style: AppTextStyles.engraved(
                    size: 9,
                    color: AppColors.cream,
                    spacing: 1.6,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  mantra.eyebrow,
                  style: AppTextStyles.engraved(
                    size: 9,
                    color: AppColors.gold,
                    spacing: 1.6,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            mantra.quote,
            style: AppTextStyles.serif(
              size: 21,
              color: AppColors.cream,
              italic: true,
              height: 1.35,
              weight: FontWeight.w500,
            ),
          ),
          if (mantra.label.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                Container(width: 24, height: 1.5, color: AppColors.gold),
                const SizedBox(width: AppSpacing.sm),
                Text(
                  mantra.label,
                  style: AppTextStyles.sans(
                    size: 10,
                    weight: FontWeight.w600,
                    color: AppColors.cream.withValues(alpha: 0.82),
                    spacing: 1.2,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ═══════════════════════════ Pull Quote Line ═══════════════════════════

class _PullLine extends StatelessWidget {
  const _PullLine(this.quote);

  final String quote;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.md,
        AppSpacing.sm,
        AppSpacing.md,
        AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.gold.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: const Border(
          left: BorderSide(color: AppColors.gold, width: 3.5),
        ),
      ),
      child: Text(
        quote,
        style: AppTextStyles.serif(
          size: 15,
          italic: true,
          color: AppColors.brown,
          height: 1.45,
          weight: FontWeight.w500,
        ),
      ),
    );
  }
}

// ═══════════════════════════ Milestone Timeline ═══════════════════════════

class _TimelineTile extends StatelessWidget {
  const _TimelineTile(this.milestone, {required this.isLast});

  final AboutMilestone milestone;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final isSpecial = milestone.highlight;

    final disc = Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        color: isSpecial ? AppColors.brown : AppColors.surface,
        shape: BoxShape.circle,
        border: Border.all(
          color: isSpecial
              ? AppColors.gold
              : AppColors.gold.withValues(alpha: 0.4),
          width: 1.2,
        ),
      ),
      child: Icon(
        milestone.icon,
        size: 16,
        color: isSpecial ? AppColors.gold : AppColors.goldDeep,
      ),
    );

    final cardContent = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: isSpecial
                    ? AppColors.brown.withValues(alpha: 0.08)
                    : AppColors.placeholderFill,
                borderRadius: AppRadius.pillAll,
              ),
              child: Text(
                milestone.label,
                style: AppTextStyles.engraved(
                  size: 9,
                  color: isSpecial ? AppColors.brown : AppColors.goldDeep,
                  spacing: 1.4,
                ),
              ),
            ),
            if (milestone.tag != null && milestone.tag!.isNotEmpty) ...[
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.gold.withValues(alpha: 0.12),
                  borderRadius: AppRadius.pillAll,
                  border: Border.all(
                    color: AppColors.gold.withValues(alpha: 0.3),
                    width: 0.8,
                  ),
                ),
                child: Text(
                  milestone.tag!,
                  style: AppTextStyles.sans(
                    size: 9,
                    weight: FontWeight.w600,
                    color: AppColors.goldDeep,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 6),
        Text(
          milestone.title,
          style: AppTextStyles.serif(
            size: 17,
            weight: FontWeight.w600,
            color: AppColors.brown,
            height: 1.25,
          ),
        ),
        const SizedBox(height: 6),
        for (var i = 0; i < milestone.paragraphs.length; i++) ...[
          if (i > 0) const SizedBox(height: 6),
          Text(
            milestone.paragraphs[i],
            style: AppTextStyles.body.copyWith(height: 1.45),
          ),
        ],
      ],
    );

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 36,
            child: Column(
              children: [
                disc,
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 1.5,
                      margin: const EdgeInsets.symmetric(vertical: 4),
                      decoration: BoxDecoration(
                        color: AppColors.gold.withValues(alpha: 0.28),
                        borderRadius: AppRadius.pillAll,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.xl),
              child: isSpecial
                  ? AppCard(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      color: AppColors.gold.withValues(alpha: 0.08),
                      border: true,
                      child: cardContent,
                    )
                  : cardContent,
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ Family Quote Card ═══════════════════════════

class _ClosingQuoteCard extends StatelessWidget {
  const _ClosingQuoteCard(this.quote);

  final AboutQuote quote;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      radius: AppRadius.xl,
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.xl,
        vertical: AppSpacing.xl,
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: const [
              Icon(Icons.favorite, size: 13, color: AppColors.gold),
              SizedBox(width: 5),
              Icon(Icons.favorite, size: 13, color: AppColors.goldDeep),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            quote.text,
            textAlign: TextAlign.center,
            style: AppTextStyles.serif(
              size: 16,
              italic: true,
              color: AppColors.brown,
              height: 1.5,
            ),
          ),
          if (quote.author.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              width: 32,
              height: 1,
              color: AppColors.gold.withValues(alpha: 0.4),
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              quote.author,
              style: AppTextStyles.engraved(
                size: 9,
                color: AppColors.goldDeep,
                spacing: 1.8,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ═══════════════════════════ Offerings Section ═══════════════════════════

class _OfferingsSection extends StatelessWidget {
  const _OfferingsSection(this.offers);

  final List<AboutOffer> offers;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (var i = 0; i < offers.length; i++) ...[
          if (i > 0) const SizedBox(height: 10),
          _OfferCard(offers[i]),
        ],
      ],
    );
  }
}

class _OfferCard extends StatelessWidget {
  const _OfferCard(this.offer);

  final AboutOffer offer;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.placeholderFill,
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.gold.withValues(alpha: 0.3),
                width: 1,
              ),
            ),
            child: Icon(offer.icon, color: AppColors.goldDeep, size: 20),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  offer.title,
                  style: AppTextStyles.serif(
                    size: 15,
                    weight: FontWeight.w600,
                    color: AppColors.brown,
                    height: 1.25,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  offer.description,
                  style: AppTextStyles.body.copyWith(
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ Contact Card ═══════════════════════════

class _ContactCard extends StatelessWidget {
  const _ContactCard(this.contact);

  final AboutContact contact;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[
      if (contact.address.isNotEmpty)
        _ContactRow(
          icon: Icons.location_on_outlined,
          label: 'FIND US',
          value: contact.address,
          onTap: () => openExternalLink(
            context,
            Uri.parse(
              'https://www.google.com/maps/search/?api=1'
              '&query=${Uri.encodeComponent(contact.mapQuery.isNotEmpty ? contact.mapQuery : contact.address)}',
            ),
            copyValue: contact.address,
            copiedWhat: 'Our address',
          ),
        ),
      if (contact.hours.isNotEmpty)
        _ContactRow(
          icon: Icons.access_time,
          label: 'KITCHEN HOURS',
          value: contact.hours,
        ),
      if (contact.phone.isNotEmpty)
        _ContactRow(
          icon: Icons.phone_outlined,
          label: 'CALL OR TEXT',
          value: contact.phone,
          onTap: () => openExternalLink(
            context,
            Uri.parse('tel:${contact.phone.replaceAll(RegExp(r'\s+'), '')}'),
            copyValue: contact.phone,
            copiedWhat: 'Phone number',
          ),
        ),
      if (contact.email.isNotEmpty)
        _ContactRow(
          icon: Icons.mail_outline,
          label: 'E-MAIL',
          value: contact.email,
          onTap: () => openExternalLink(
            context,
            Uri.parse('mailto:${contact.email.trim()}'),
            copyValue: contact.email,
            copiedWhat: 'E-mail address',
          ),
        ),
    ];

    return AppCard(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
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
    final content = Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm + 4),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.placeholderFill,
              shape: BoxShape.circle,
              border: Border.all(
                color: AppColors.gold.withValues(alpha: 0.3),
                width: 0.8,
              ),
            ),
            child: Icon(icon, size: 17, color: AppColors.goldDeep),
          ),
          const SizedBox(width: AppSpacing.md),
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
                const SizedBox(height: 2),
                Text(
                  value,
                  style: AppTextStyles.sans(
                    size: 13,
                    weight: FontWeight.w600,
                    color: AppColors.brown,
                  ),
                ),
              ],
            ),
          ),
          if (onTap != null)
            Icon(
              Icons.north_east,
              size: 14,
              color: AppColors.brownSoft.withValues(alpha: 0.6),
            ),
        ],
      ),
    );

    if (onTap == null) return content;
    return PressableScale(onTap: onTap, child: content);
  }
}

// ═══════════════════════════ Social Channels ═══════════════════════════

class _SocialRow extends StatelessWidget {
  const _SocialRow(this.social);

  final AboutSocial social;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        if (social.facebook.isNotEmpty)
          _SocialPill(
            icon: Icons.facebook,
            label: 'Facebook',
            url: social.facebook,
          ),
        if (social.instagram.isNotEmpty)
          _SocialPill(
            icon: Icons.photo_camera_outlined,
            label: 'Instagram',
            url: social.instagram,
          ),
        if (social.tiktok.isNotEmpty)
          _SocialPill(
            icon: Icons.music_note_outlined,
            label: 'TikTok',
            url: social.tiktok,
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
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: AppRadius.pillAll,
          border: Border.all(color: AppColors.hairline),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: AppColors.goldDeep),
            const SizedBox(width: 6),
            Text(
              label,
              style: AppTextStyles.sans(
                size: 12,
                weight: FontWeight.w600,
                color: AppColors.brown,
                spacing: 0.2,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════ Footer ═══════════════════════════

class _Footer extends StatelessWidget {
  const _Footer(this.footerText);

  final String footerText;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(width: 32, height: 1, color: AppColors.hairline),
            const SizedBox(width: AppSpacing.sm),
            const Icon(Icons.favorite, size: 10, color: AppColors.gold),
            const SizedBox(width: 3),
            const Icon(Icons.favorite, size: 10, color: AppColors.goldDeep),
            const SizedBox(width: AppSpacing.sm),
            Container(width: 32, height: 1, color: AppColors.hairline),
          ],
        ),
        const SizedBox(height: AppSpacing.sm + 2),
        Text(
          footerText.isNotEmpty ? footerText : 'FILL AT HOME · SINCE 2016',
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
