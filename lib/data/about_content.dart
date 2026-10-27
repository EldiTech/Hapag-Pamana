import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

/// The About screen content model, managed by moderators on the Content Moderator
/// dashboard (settings/about in Firestore) with built-in heirloom defaults.
@immutable
class AboutMantra {
  const AboutMantra({
    this.eyebrow = 'SINCE 2016 · THE FILL AT HOME STORY',
    this.quote =
        '“Be patient — your small business will grow enough to pay your bills.”',
    this.label = 'OUR MANTRA FROM DAY ONE',
  });

  final String eyebrow;
  final String quote;
  final String label;

  factory AboutMantra.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const AboutMantra();
    return AboutMantra(
      eyebrow: (map['eyebrow'] as String?) ??
          'SINCE 2016 · THE FILL AT HOME STORY',
      quote: (map['quote'] as String?) ??
          '“Be patient — your small business will grow enough to pay your bills.”',
      label: (map['label'] as String?) ?? 'OUR MANTRA FROM DAY ONE',
    );
  }
}

@immutable
class AboutStory {
  const AboutStory({
    this.eyebrow = 'WHERE WE BEGAN',
    this.title = 'Our Story',
    this.body =
        'We tried to open a small Fill at Home canteen back in 2016. It '
        'did not work out — but it was an exciting experience for us. We '
        'went back to being a small family of employees, working every '
        'day to make ends meet: earning enough to pay the bills, put '
        'food on the table and send the kids to school.',
    this.pullquote =
        'Little did we know that with a little effort, prayer and grit, '
        'this small business would become our lifeline.',
  });

  final String eyebrow;
  final String title;
  final String body;
  final String pullquote;

  factory AboutStory.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const AboutStory();
    return AboutStory(
      eyebrow: (map['eyebrow'] as String?) ?? 'WHERE WE BEGAN',
      title: (map['title'] as String?) ?? 'Our Story',
      body: (map['body'] as String?) ??
          'We tried to open a small Fill at Home canteen back in 2016. It '
          'did not work out — but it was an exciting experience for us. We '
          'went back to being a small family of employees, working every '
          'day to make ends meet: earning enough to pay the bills, put '
          'food on the table and send the kids to school.',
      pullquote: (map['pullquote'] as String?) ??
          'Little did we know that with a little effort, prayer and grit, '
          'this small business would become our lifeline.',
    );
  }
}

@immutable
class AboutMilestone {
  const AboutMilestone({
    required this.id,
    required this.label,
    required this.title,
    required this.paragraphs,
    this.iconName = 'volunteer_activism',
    this.tag,
    this.highlight = false,
  });

  final String id;
  final String label;
  final String title;
  final List<String> paragraphs;
  final String iconName;
  final String? tag;
  final bool highlight;

  IconData get icon {
    switch (iconName.toLowerCase()) {
      case 'volunteer_activism':
      case 'hand':
        return Icons.volunteer_activism_outlined;
      case 'soup_kitchen':
      case 'kitchen':
        return Icons.soup_kitchen_outlined;
      case 'local_shipping':
      case 'shipping':
      case 'truck':
        return Icons.local_shipping_outlined;
      case 'favorite':
      case 'heart':
        return Icons.favorite_outline;
      case 'home_work':
      case 'home':
        return Icons.home_work_outlined;
      case 'groups':
      case 'people':
        return Icons.groups_outlined;
      case 'celebration':
      case 'party':
        return Icons.celebration_outlined;
      default:
        return Icons.star_outline;
    }
  }

  factory AboutMilestone.fromMap(Map<String, dynamic> map, int fallbackIndex) {
    final rawParas = map['paragraphs'];
    final List<String> paras = [];
    if (rawParas is List) {
      for (final p in rawParas) {
        if (p is String && p.trim().isNotEmpty) paras.add(p.trim());
      }
    }
    if (paras.isEmpty && map['body'] is String) {
      paras.add(map['body'] as String);
    }

    return AboutMilestone(
      id: (map['id'] as String?) ?? 'm_$fallbackIndex',
      label: (map['label'] as String?) ?? 'DAY $fallbackIndex',
      title: (map['title'] as String?) ?? '',
      paragraphs: paras.isNotEmpty ? paras : [''],
      iconName: (map['icon'] as String?) ?? 'star',
      tag: map['tag'] as String?,
      highlight: map['highlight'] == true,
    );
  }
}

@immutable
class AboutQuote {
  const AboutQuote({
    this.text =
        '“So if you have a dream — no matter how difficult — put your '
        'heart into it and slowly ease your way toward your goals. And if '
        'you are lucky, you will succeed together with your family.”',
    this.author = '— THE FILL AT HOME FAMILY',
  });

  final String text;
  final String author;

  factory AboutQuote.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const AboutQuote();
    return AboutQuote(
      text: (map['text'] as String?) ??
          '“So if you have a dream — no matter how difficult — put your '
          'heart into it and slowly ease your way toward your goals. And if '
          'you are lucky, you will succeed together with your family.”',
      author: (map['author'] as String?) ?? '— THE FILL AT HOME FAMILY',
    );
  }
}

@immutable
class AboutOffer {
  const AboutOffer({
    required this.id,
    required this.title,
    required this.description,
    this.iconName = 'star',
  });

  final String id;
  final String title;
  final String description;
  final String iconName;

  IconData get icon {
    switch (iconName.toLowerCase()) {
      case 'assignment_ind':
      case 'coordinator':
        return Icons.assignment_ind_outlined;
      case 'emoji_people':
      case 'waiters':
        return Icons.emoji_people_outlined;
      case 'table_restaurant':
      case 'tables':
        return Icons.table_restaurant_outlined;
      case 'format_list_numbered':
      case 'numbers':
        return Icons.format_list_numbered_outlined;
      case 'local_florist':
      case 'flower':
        return Icons.local_florist_outlined;
      case 'event_seat':
      case 'chair':
        return Icons.event_seat_outlined;
      case 'water_drop':
      case 'water':
        return Icons.water_drop_outlined;
      case 'local_fire_department':
      case 'fire':
      case 'chafing':
        return Icons.local_fire_department_outlined;
      case 'restaurant':
      case 'dinnerware':
        return Icons.restaurant_outlined;
      default:
        return Icons.restaurant_menu_outlined;
    }
  }

  factory AboutOffer.fromMap(Map<String, dynamic> map, int fallbackIndex) {
    return AboutOffer(
      id: (map['id'] as String?) ?? 'o_$fallbackIndex',
      title: (map['title'] as String?) ?? '',
      description: (map['description'] as String?) ?? '',
      iconName: (map['icon'] as String?) ?? 'star',
    );
  }
}

@immutable
class AboutContact {
  const AboutContact({
    this.address = 'The Kitchen · Metro Manila, Philippines',
    this.mapQuery = 'Fill at Home Catering, Metro Manila',
    this.hours = 'Monday – Sunday · 8:00 AM – 8:00 PM',
    this.phone = '0917 123 4567',
    this.email = 'hello@fillathome.ph',
  });

  final String address;
  final String mapQuery;
  final String hours;
  final String phone;
  final String email;

  factory AboutContact.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const AboutContact();
    return AboutContact(
      address: (map['address'] as String?) ??
          'The Kitchen · Metro Manila, Philippines',
      mapQuery: (map['mapQuery'] as String?) ??
          'Fill at Home Catering, Metro Manila',
      hours: (map['hours'] as String?) ??
          'Monday – Sunday · 8:00 AM – 8:00 PM',
      phone: (map['phone'] as String?) ?? '0917 123 4567',
      email: (map['email'] as String?) ?? 'hello@fillathome.ph',
    );
  }
}

@immutable
class AboutSocial {
  const AboutSocial({
    this.facebook = 'https://www.facebook.com/fillathome',
    this.instagram = 'https://www.instagram.com/fillathome',
    this.tiktok = 'https://www.tiktok.com/@fillathome',
  });

  final String facebook;
  final String instagram;
  final String tiktok;

  factory AboutSocial.fromMap(Map<String, dynamic>? map) {
    if (map == null) return const AboutSocial();
    return AboutSocial(
      facebook: (map['facebook'] as String?) ??
          'https://www.facebook.com/fillathome',
      instagram: (map['instagram'] as String?) ??
          'https://www.instagram.com/fillathome',
      tiktok: (map['tiktok'] as String?) ?? 'https://www.tiktok.com/@fillathome',
    );
  }
}

@immutable
class AboutContent {
  const AboutContent({
    this.mantra = const AboutMantra(),
    this.story = const AboutStory(),
    this.milestonesEyebrow = 'THE FIRST YEAR',
    this.milestonesTitle = 'From Day 1 to Day 365',
    this.milestones = defaultMilestones,
    this.quote = const AboutQuote(),
    this.offeringsEyebrow = 'AT YOUR TABLE',
    this.offeringsTitle = 'What We Offer',
    this.offeringsSubtitle =
        'A seat at our table for every occasion — from a weekday craving to a once-in-a-lifetime celebration.',
    this.offers = defaultOffers,
    this.contact = const AboutContact(),
    this.social = const AboutSocial(),
    this.footer = 'FILL AT HOME · SINCE 2016',
  });

  final AboutMantra mantra;
  final AboutStory story;
  final String milestonesEyebrow;
  final String milestonesTitle;
  final List<AboutMilestone> milestones;
  final AboutQuote quote;
  final String offeringsEyebrow;
  final String offeringsTitle;
  final String offeringsSubtitle;
  final List<AboutOffer> offers;
  final AboutContact contact;
  final AboutSocial social;
  final String footer;

  static const List<AboutMilestone> defaultMilestones = [
    AboutMilestone(
      id: 'm1',
      label: 'DAY 1',
      title: 'Para sa Bayan',
      paragraphs: [
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
      iconName: 'volunteer_activism',
      tag: '#ParaSaBayan',
    ),
    AboutMilestone(
      id: 'm2',
      label: 'JUNE',
      title: 'The Kitchen',
      paragraphs: [
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
      iconName: 'soup_kitchen',
    ),
    AboutMilestone(
      id: 'm3',
      label: 'AUGUST',
      title: 'Meet Filla',
      paragraphs: [
        'Operations started to become faster and we were getting more and '
            'more clients, so we decided to buy our first service vehicle — '
            'we call him Filla.',
        'You see, we are very sentimental about all the things we buy and '
            'invest in, and about the people we hire. This is because we know '
            'that with these, big and small, we can become more.',
      ],
      iconName: 'local_shipping',
    ),
    AboutMilestone(
      id: 'm4',
      label: 'DECEMBER',
      title: 'A Family Wedding',
      paragraphs: [
        'The couple who started Fill at Home tied the knot — and all the Fill '
            'at Home family members were present.',
      ],
      iconName: 'favorite',
    ),
    AboutMilestone(
      id: 'm5',
      label: 'JANUARY',
      title: 'The Second Kitchen',
      paragraphs: [
        'We started renting a Second Kitchen, to accommodate more orders, '
            'more equipment and more staff.',
      ],
      iconName: 'home_work',
    ),
    AboutMilestone(
      id: 'm6',
      label: 'DAY 365',
      title: 'We Are Still Here',
      paragraphs: [
        'It started as seven siblings — and now, with all our staff and the '
            'second-generation family members, we are 25 strong.',
        'We are still growing, and with the help of our clients and our '
            'members, we will grow more. Soon, we are off to our next '
            'milestone — our biggest investment yet: the new home for Fill '
            'at Home.',
      ],
      iconName: 'groups',
      highlight: true,
    ),
  ];

  static const List<AboutOffer> defaultOffers = [
    AboutOffer(
      id: 'o1',
      title: 'Event Coordinator/s',
      description:
          'Assigned on the day to ensure smooth operations during the event.',
      iconName: 'assignment_ind',
    ),
    AboutOffer(
      id: 'o2',
      title: 'Trained Waiters',
      description:
          'Uniformed and trained to assist guests throughout the event.',
      iconName: 'emoji_people',
    ),
    AboutOffer(
      id: 'o3',
      title: 'Dressed-Up Tables',
      description:
          "Tables styled with toppers based on the client's motif.",
      iconName: 'table_restaurant',
    ),
    AboutOffer(
      id: 'o4',
      title: 'Table Numbers',
      description:
          'Numbered tables to keep guests organized and seated with ease.',
      iconName: 'format_list_numbered',
    ),
    AboutOffer(
      id: 'o5',
      title: 'Basic Centerpiece Design',
      description: "Simple centerpieces to complete each table's look.",
      iconName: 'local_florist',
    ),
    AboutOffer(
      id: 'o6',
      title: 'Chairs with Cover & Accent',
      description: 'Chairs dressed with covers and accents to match the theme.',
      iconName: 'event_seat',
    ),
    AboutOffer(
      id: 'o7',
      title: 'Purified Water',
      description: 'Purified drinking water served throughout the event.',
      iconName: 'water_drop',
    ),
    AboutOffer(
      id: 'o8',
      title: 'Roll-Up Chafing Dish',
      description: 'Chafing dishes to keep the spread warm and ready.',
      iconName: 'local_fire_department',
    ),
    AboutOffer(
      id: 'o9',
      title: 'Sanitized Dinnerware & Glassware',
      description:
          'Sanitized dinnerware, glassware and flatware for every guest.',
      iconName: 'restaurant',
    ),
  ];

  factory AboutContent.fromMap(Map<String, dynamic>? data) {
    if (data == null) return const AboutContent();

    final rawMilestones = data['milestones'];
    final List<AboutMilestone> milestones = [];
    if (rawMilestones is List) {
      for (var i = 0; i < rawMilestones.length; i++) {
        final m = rawMilestones[i];
        if (m is Map<String, dynamic>) {
          milestones.add(AboutMilestone.fromMap(m, i + 1));
        }
      }
    }

    final rawOffers = data['offers'];
    final List<AboutOffer> offers = [];
    if (rawOffers is List) {
      for (var i = 0; i < rawOffers.length; i++) {
        final o = rawOffers[i];
        if (o is Map<String, dynamic>) {
          offers.add(AboutOffer.fromMap(o, i + 1));
        }
      }
    }

    return AboutContent(
      mantra: AboutMantra.fromMap(data['mantra'] as Map<String, dynamic>?),
      story: AboutStory.fromMap(data['story'] as Map<String, dynamic>?),
      milestonesEyebrow:
          (data['milestonesEyebrow'] as String?) ?? 'THE FIRST YEAR',
      milestonesTitle:
          (data['milestonesTitle'] as String?) ?? 'From Day 1 to Day 365',
      milestones: milestones.isNotEmpty ? milestones : defaultMilestones,
      quote: AboutQuote.fromMap(data['quote'] as Map<String, dynamic>?),
      offeringsEyebrow:
          (data['offeringsEyebrow'] as String?) ?? 'AT YOUR TABLE',
      offeringsTitle: (data['offeringsTitle'] as String?) ?? 'What We Offer',
      offeringsSubtitle: (data['offeringsSubtitle'] as String?) ??
          'A seat at our table for every occasion — from a weekday craving to a once-in-a-lifetime celebration.',
      offers: offers.isNotEmpty ? offers : defaultOffers,
      contact: AboutContact.fromMap(data['contact'] as Map<String, dynamic>?),
      social: AboutSocial.fromMap(data['social'] as Map<String, dynamic>?),
      footer: (data['footer'] as String?) ?? 'FILL AT HOME · SINCE 2016',
    );
  }
}

/// Broadcast scope that stays in sync with Firestore `settings/about`.
class AboutContentScope {
  AboutContentScope._();

  static final ValueNotifier<AboutContent> notifier =
      ValueNotifier(const AboutContent());

  static AboutContent get value => notifier.value;

  static bool _started = false;

  static void start() {
    if (_started) return;
    _started = true;
    FirebaseFirestore.instance
        .collection('settings')
        .doc('about')
        .snapshots()
        .listen(
          (snap) {
            if (snap.exists) {
              notifier.value = AboutContent.fromMap(snap.data());
            }
          },
          onError: (Object _) {
            // Offline fallback
          },
        );
  }
}
