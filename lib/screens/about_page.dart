import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../brand.dart';
import '../core/external_link.dart';
import '../core/theme/bottom_navigation_layout.dart';
import '../core/widgets/app_widgets.dart';
import '../data/about_content.dart';
import '../widgets.dart';

/// About screen — the heirloom Fill at Home & Hapag Pamana story told in the
/// shared "Heirloom Editorial" system (Playfair Display headings & quotes,
/// Montserrat body & UI copy, Cinzel engraved eyebrows & captions), populated
/// live from the Content Moderator (`settings/about`).
class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  Duration _d(int ms) => Duration(milliseconds: ms);

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<AboutContent>(
      valueListenable: AboutContentScope.notifier,
      builder: (context, about, _) {
        final hasContact =
            about.contact.address.isNotEmpty ||
            about.contact.hours.isNotEmpty ||
            about.contact.phone.isNotEmpty ||
            about.contact.email.isNotEmpty;
        final hasSocial =
            about.social.facebook.isNotEmpty ||
            about.social.instagram.isNotEmpty ||
            about.social.tiktok.isNotEmpty;

        return ListView(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.screen,
            AppSpacing.lg,
            AppSpacing.screen,
            AppSpacing.xl,
          ),
          children: [
            // ── Hero Mantra Card ──────────────────────────────────────────
            FadeSlideIn(child: _MantraHero(about.mantra)),
            const SizedBox(height: AppSpacing.section),

            // ── Where We Began / Our Story ────────────────────────────────
            FadeSlideIn(
              delay: _d(60),
              child: _SectionHeader(
                eyebrow: about.story.eyebrow,
                title: about.story.title,
              ),
            ),
            const SizedBox(height: 14),
            FadeSlideIn(
              delay: _d(100),
              child: _StoryCard(about.story),
            ),
            const SizedBox(height: AppSpacing.section),

            // ── Milestone Timeline ────────────────────────────────────────
            if (about.milestones.isNotEmpty) ...[
              FadeSlideIn(
                delay: _d(140),
                child: _SectionHeader(
                  eyebrow: about.milestonesEyebrow,
                  title: about.milestonesTitle,
                ),
              ),
              const SizedBox(height: 14),
              for (var i = 0; i < about.milestones.length; i++)
                FadeSlideIn(
                  delay: _d(math.min(170 + i * 25, 300)),
                  child: _TimelineTile(
                    about.milestones[i],
                    isLast: i == about.milestones.length - 1,
                  ),
                ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── Closing Family Quote ──────────────────────────────────────
            if (about.quote.text.isNotEmpty) ...[
              FadeSlideIn(
                delay: _d(220),
                child: _ClosingQuoteCard(about.quote),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── What We Offer ─────────────────────────────────────────────
            if (about.offers.isNotEmpty) ...[
              FadeSlideIn(
                delay: _d(250),
                child: _SectionHeader(
                  eyebrow: about.offeringsEyebrow,
                  title: about.offeringsTitle,
                  subtitle: about.offeringsSubtitle,
                ),
              ),
              const SizedBox(height: 14),
              FadeSlideIn(
                delay: _d(280),
                child: _OfferingsSection(about.offers),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── Visit Us / Contact ────────────────────────────────────────
            if (hasContact) ...[
              FadeSlideIn(
                delay: _d(300),
                child: const _SectionHeader(
                  eyebrow: 'COME SAY HELLO',
                  title: 'Visit Us',
                ),
              ),
              const SizedBox(height: 14),
              FadeSlideIn(
                delay: _d(320),
                child: _ContactCard(about.contact),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── Social Channels ───────────────────────────────────────────
            if (hasSocial) ...[
              FadeSlideIn(
                delay: _d(330),
                child: const _SectionHeader(
                  eyebrow: 'KEEP IN TOUCH',
                  title: 'Follow Our Journey',
                ),
              ),
              const SizedBox(height: 14),
              FadeSlideIn(
                delay: _d(350),
                child: _SocialSection(about.social),
              ),
              const SizedBox(height: AppSpacing.section),
            ],

            // ── Heritage Colophon Footer ──────────────────────────────────
            FadeSlideIn(
              delay: _d(360),
              child: _Footer(about.footer),
            ),
            SizedBox(
              height: AppBottomNavigationLayout.guestContentClearance(context),
            ),
          ],
        );
      },
    );
  }
}

// ═══════════════════════════ Section Header ═══════════════════════════
/// Pairs the brand's engraved [AppTextStyles.eyebrow] with the shared
/// [SectionHeading] (`AppTextStyles.heading`) so About sections match Home and
/// Catering identically.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.eyebrow,
    required this.title,
    this.subtitle = '',
  });

  final String eyebrow;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (eyebrow.trim().isNotEmpty) ...[
          Text(eyebrow.toUpperCase(), style: AppTextStyles.eyebrow),
          const SizedBox(height: AppSpacing.xs + 2),
        ],
        SectionHeading(title),
        if (subtitle.trim().isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(subtitle, style: AppTextStyles.body),
        ],
      ],
    );
  }
}

// ═══════════════════════════ Hero Mantra ═══════════════════════════
/// Inverted brown-to-olive heritage banner, matching Home's `CateringInvite`
/// palette and curvature.
class _MantraHero extends StatelessWidget {
  const _MantraHero(this.mantra);

  final AboutMantra mantra;

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
          if (mantra.eyebrow.trim().isNotEmpty) ...[
            Text(
              mantra.eyebrow.toUpperCase(),
              style: AppTextStyles.eyebrow.copyWith(
                color: AppColors.gold,
                height: 1.35,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
          ],
          Text(
            mantra.quote,
            style: AppTextStyles.serif(
              size: 22,
              color: AppColors.cream,
              italic: true,
              height: 1.34,
            ),
          ),
          if (mantra.label.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.lg),
            Row(
              children: [
                Container(width: 24, height: 1.5, color: AppColors.gold),
                const SizedBox(width: AppSpacing.sm + 2),
                Expanded(
                  child: Text(
                    mantra.label.toUpperCase(),
                    style: AppTextStyles.caption.copyWith(
                      color: AppColors.cream.withValues(alpha: 0.86),
                      letterSpacing: 1.6,
                    ),
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

// ═══════════════════════════ Story Card ═══════════════════════════
class _StoryCard extends StatelessWidget {
  const _StoryCard(this.story);

  final AboutStory story;

  @override
  Widget build(BuildContext context) {
    final hasPullquote = story.pullquote.trim().isNotEmpty;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            story.body,
            style: AppTextStyles.body.copyWith(height: 1.55),
          ),
          if (hasPullquote) ...[
            const SizedBox(height: AppSpacing.lg),
            Container(
              padding: const EdgeInsets.only(left: AppSpacing.md + 2),
              decoration: const BoxDecoration(
                border: Border(
                  left: BorderSide(color: AppColors.gold, width: 2.5),
                ),
              ),
              child: Text(
                story.pullquote,
                style: AppTextStyles.serif(
                  size: 16,
                  italic: true,
                  color: AppColors.brown,
                  height: 1.45,
                ),
              ),
            ),
          ],
        ],
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

    final medallion = Container(
      width: 38,
      height: 38,
      decoration: BoxDecoration(
        color: isSpecial ? AppColors.brown : AppColors.surface,
        shape: BoxShape.circle,
        border: Border.all(
          color: isSpecial ? AppColors.gold : AppColors.hairline,
          width: isSpecial ? 1.2 : 1,
        ),
      ),
      child: Icon(
        milestone.icon,
        size: 18,
        color: isSpecial ? AppColors.gold : AppColors.goldDeep,
      ),
    );

    final tag = milestone.tag?.trim() ?? '';

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 38,
            child: Column(
              children: [
                medallion,
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 1.5,
                      margin: const EdgeInsets.symmetric(
                        vertical: AppSpacing.xs + 2,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.gold.withValues(alpha: 0.32),
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
              padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.md),
              child: AppCard(
                padding: const EdgeInsets.all(AppSpacing.lg),
                elevated: isSpecial,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: AppSpacing.sm,
                      runSpacing: AppSpacing.xs + 2,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: isSpecial
                                ? AppColors.brown
                                : AppColors.gold.withValues(alpha: 0.14),
                            borderRadius: AppRadius.pillAll,
                          ),
                          child: Text(
                            milestone.label.toUpperCase(),
                            style: AppTextStyles.caption.copyWith(
                              color: isSpecial
                                  ? AppColors.onBrown
                                  : AppColors.goldDeep,
                            ),
                          ),
                        ),
                        if (tag.isNotEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.placeholderFill,
                              borderRadius: AppRadius.pillAll,
                            ),
                            child: Text(
                              tag,
                              style: AppTextStyles.label.copyWith(
                                fontSize: 11,
                                color: AppColors.brownSoft,
                              ),
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.sm + 2),
                    Text(milestone.title, style: AppTextStyles.title),
                    if (milestone.paragraphs.isNotEmpty) ...[
                      const SizedBox(height: AppSpacing.sm),
                      for (var i = 0; i < milestone.paragraphs.length; i++) ...[
                        if (i > 0) const SizedBox(height: AppSpacing.sm),
                        Text(
                          milestone.paragraphs[i],
                          style: AppTextStyles.body,
                        ),
                      ],
                    ],
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

// ═══════════════════════════ Family Quote Card ═══════════════════════════
class _ClosingQuoteCard extends StatelessWidget {
  const _ClosingQuoteCard(this.quote);

  final AboutQuote quote;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      radius: AppRadius.xl,
      padding: const EdgeInsets.all(AppSpacing.xxl),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(width: 32, height: 1, color: AppColors.hairline),
              const SizedBox(width: AppSpacing.md),
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: AppColors.gold.withValues(alpha: 0.14),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.format_quote_rounded,
                  size: 18,
                  color: AppColors.goldDeep,
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Container(width: 32, height: 1, color: AppColors.hairline),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          Text(
            quote.text,
            textAlign: TextAlign.center,
            style: AppTextStyles.serif(
              size: 17,
              italic: true,
              color: AppColors.brown,
              height: 1.5,
            ),
          ),
          if (quote.author.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md + 2),
            Text(
              quote.author.toUpperCase(),
              textAlign: TextAlign.center,
              style: AppTextStyles.caption.copyWith(letterSpacing: 1.6),
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
          if (i > 0) const SizedBox(height: AppSpacing.sm + 2),
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
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md + 2,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(offer.icon, color: AppColors.goldDeep, size: 19),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(offer.title, style: AppTextStyles.cardTitle),
                if (offer.description.trim().isNotEmpty) ...[
                  const SizedBox(height: AppSpacing.xs),
                  Text(offer.description, style: AppTextStyles.bodySmall),
                ],
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
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.md + 2),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 19, color: AppColors.goldDeep),
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: AppTextStyles.caption),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  value,
                  style: AppTextStyles.sans(
                    size: 13,
                    weight: FontWeight.w600,
                    color: AppColors.brown,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          if (onTap != null) ...[
            const SizedBox(width: AppSpacing.sm),
            const Icon(
              Icons.north_east,
              size: 16,
              color: AppColors.goldDeep,
            ),
          ],
        ],
      ),
    );

    if (onTap == null) return content;
    return PressableScale(onTap: onTap, child: content);
  }
}

// ═══════════════════════════ Social Channels ═══════════════════════════
class _SocialSection extends StatelessWidget {
  const _SocialSection(this.social);

  final AboutSocial social;

  @override
  Widget build(BuildContext context) {
    final items = <(IconData, String, String)>[
      if (social.facebook.isNotEmpty)
        (Icons.facebook, 'Facebook', social.facebook),
      if (social.instagram.isNotEmpty)
        (Icons.photo_camera_outlined, 'Instagram', social.instagram),
      if (social.tiktok.isNotEmpty)
        (Icons.music_note_outlined, 'TikTok', social.tiktok),
    ];

    return Row(
      children: [
        for (var i = 0; i < items.length; i++) ...[
          if (i > 0) const SizedBox(width: AppSpacing.sm + 2),
          Expanded(
            child: _SocialCard(
              icon: items[i].$1,
              label: items[i].$2,
              url: items[i].$3,
            ),
          ),
        ],
      ],
    );
  }
}

class _SocialCard extends StatelessWidget {
  const _SocialCard({
    required this.icon,
    required this.label,
    required this.url,
  });

  final IconData icon;
  final String label;
  final String url;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => openExternalLink(
        context,
        Uri.parse(url),
        copyValue: url,
        copiedWhat: '$label link',
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.lg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: AppColors.gold.withValues(alpha: 0.14),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: AppColors.goldDeep),
          ),
          const SizedBox(height: AppSpacing.sm),
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              label,
              maxLines: 1,
              style: AppTextStyles.label.copyWith(color: AppColors.brown),
            ),
          ),
        ],
      ),
    );
  }
}

// ═══════════════════════════ Colophon Footer ═══════════════════════════
class _Footer extends StatelessWidget {
  const _Footer(this.footerText);

  final String footerText;

  @override
  Widget build(BuildContext context) {
    final text = footerText.trim().isNotEmpty
        ? footerText.trim().toUpperCase()
        : 'FILL AT HOME · SINCE 2016';

    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(width: 36, height: 1, color: AppColors.hairline),
            const SizedBox(width: AppSpacing.md),
            Transform.rotate(
              angle: math.pi / 4,
              child: Container(
                width: 5,
                height: 5,
                color: AppColors.gold,
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Container(width: 36, height: 1, color: AppColors.hairline),
          ],
        ),
        const SizedBox(height: AppSpacing.sm + 4),
        Text(
          text,
          textAlign: TextAlign.center,
          style: AppTextStyles.caption.copyWith(
            color: AppColors.brownSoft,
            letterSpacing: 2,
          ),
        ),
      ],
    );
  }
}
