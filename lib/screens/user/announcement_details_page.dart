import 'package:flutter/material.dart';

import '../../brand.dart';
import '../../data/announcement.dart';

/// Full-page editorial view for a published Announcement / Event / Promo.
class AnnouncementDetailsPage extends StatelessWidget {
  const AnnouncementDetailsPage({
    super.key,
    required this.announcement,
  });

  final Announcement announcement;

  static Route<void> route(Announcement announcement) {
    return MaterialPageRoute<void>(
      builder: (_) => AnnouncementDetailsPage(announcement: announcement),
    );
  }

  @override
  Widget build(BuildContext context) {
    final imageBytes = announcement.imageBytes;
    final isPromo = announcement.isPromo;

    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.brown),
          tooltip: 'Back',
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          isPromo ? 'Special Promotion' : 'Announcement',
          style: AppTextStyles.serif(
            size: 18,
            weight: FontWeight.w600,
            color: AppColors.brown,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.screen,
            vertical: AppSpacing.md,
          ),
          children: [
            // ── Hero Banner ────────────────────────────────────────────────
            if (announcement.hasImage) ...[
              Container(
                width: double.infinity,
                constraints: const BoxConstraints(
                  maxHeight: 300,
                  minHeight: 160,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: AppColors.hairline),
                ),
                clipBehavior: Clip.antiAlias,
                alignment: Alignment.center,
                child: imageBytes != null
                    ? Image.memory(
                        imageBytes,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => _fallbackBanner(isPromo),
                      )
                    : Image.network(
                        announcement.imageUrl,
                        fit: BoxFit.contain,
                        errorBuilder: (_, _, _) => _fallbackBanner(isPromo),
                      ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],

            // ── Eyebrow Tag ────────────────────────────────────────────────
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: isPromo
                        ? AppColors.olive.withValues(alpha: 0.15)
                        : AppColors.gold.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(
                      color: isPromo
                          ? AppColors.olive.withValues(alpha: 0.35)
                          : AppColors.gold.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Text(
                    announcement.tagLabel,
                    style: AppTextStyles.eyebrow.copyWith(
                      color: isPromo ? AppColors.olive : AppColors.brown,
                      fontWeight: FontWeight.w700,
                      fontSize: 10,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      'Posted ${announcement.formattedPublishedDate}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.caption.copyWith(
                        color: AppColors.brownSoft,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),

            // ── Title ──────────────────────────────────────────────────────
            Text(
              announcement.title,
              style: AppTextStyles.displaySmall.copyWith(
                fontWeight: FontWeight.w700,
                color: AppColors.brown,
                height: 1.2,
              ),
            ),
            const SizedBox(height: AppSpacing.md),

            // ── Meta Details Card ──────────────────────────────────────────
            if (announcement.eventDate.isNotEmpty ||
                announcement.endDate.isNotEmpty ||
                announcement.eventTime.isNotEmpty ||
                announcement.location.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm + 4,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(color: AppColors.hairline),
                ),
                child: Column(
                  children: [
                    if (announcement.eventDate.isNotEmpty ||
                        announcement.endDate.isNotEmpty)
                      _MetaRow(
                        icon: isPromo
                            ? Icons.local_offer_outlined
                            : Icons.calendar_today_outlined,
                        label: isPromo ? 'Promo Period' : 'Date',
                        value: announcement.displayDate,
                      ),
                    if (announcement.eventTime.isNotEmpty) ...[
                      if (announcement.eventDate.isNotEmpty ||
                          announcement.endDate.isNotEmpty)
                        const Divider(height: 16, color: AppColors.hairline),
                      _MetaRow(
                        icon: Icons.access_time_outlined,
                        label: 'Time',
                        value: announcement.eventTime,
                      ),
                    ],
                    if (announcement.location.isNotEmpty) ...[
                      if (announcement.eventDate.isNotEmpty ||
                          announcement.endDate.isNotEmpty ||
                          announcement.eventTime.isNotEmpty)
                        const Divider(height: 16, color: AppColors.hairline),
                      _MetaRow(
                        icon: Icons.place_outlined,
                        label: 'Location / Venue',
                        value: announcement.location,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],

            // ── Hairline Divider ───────────────────────────────────────────
            const Divider(color: AppColors.hairline, height: 24),
            const SizedBox(height: AppSpacing.sm),

            // ── Full Description ───────────────────────────────────────────
            Text(
              announcement.description,
              style: AppTextStyles.body.copyWith(
                fontSize: 15,
                height: 1.6,
                color: AppColors.brown,
              ),
            ),
            const SizedBox(height: AppSpacing.xxxl),
          ],
        ),
      ),
    );
  }

  Widget _fallbackBanner(bool isPromo) {
    return Container(
      color: AppColors.creamEdge,
      alignment: Alignment.center,
      child: Icon(
        isPromo ? Icons.local_offer_outlined : Icons.campaign_outlined,
        size: 48,
        color: AppColors.gold,
      ),
    );
  }
}

class _MetaRow extends StatelessWidget {
  const _MetaRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.all(6),
          decoration: BoxDecoration(
            color: AppColors.cream,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.hairline),
          ),
          child: Icon(icon, size: 15, color: AppColors.goldDeep),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                label.toUpperCase(),
                style: AppTextStyles.engraved(
                  size: 8.5,
                  color: AppColors.brownSoft,
                  spacing: 1.0,
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
      ],
    );
  }
}
