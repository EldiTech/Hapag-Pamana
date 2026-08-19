import 'package:flutter/material.dart';

import 'legal_document.dart';

/// "Privacy Policy" — what the app actually holds about a member, and why.
///
/// Written against the real data paths rather than from a template: the account
/// fields the sign-up form writes to `customers/{uid}`, the inline profile photo,
/// the answers the two booking wizards file into `bookings`, what PayMongo hands
/// back after a downpayment, and the settings on this very screen. Where staff
/// can read something, it says which staff.
///
/// Kept as in-app copy (rather than a link to a web page) so it's readable
/// offline and can't rot into a 404 — [_lastUpdated] moves whenever the text does.
class PrivacyPolicyPage extends StatelessWidget {
  const PrivacyPolicyPage({super.key});

  static const String _lastUpdated = '4 August 2026';

  @override
  Widget build(BuildContext context) {
    return const LegalDocument(
      title: 'Privacy Policy',
      lede: 'What we keep about you, who can see it, and how to have it '
          'changed or removed.',
      lastUpdated: _lastUpdated,
      clauses: _clauses,
    );
  }
}

const List<LegalClause> _clauses = [
  LegalClause('Who we are', [
    'Hapag Pamana is the customer app of Fill at Home Catering Services — the '
        'family kitchen whose story you can read under Settings → About. When '
        'this policy says "we", it means that family and the staff who work '
        'with us.',
    'You can reach us any time at hello@fillathome.ph or on 0917 123 4567.',
  ]),
  LegalClause(
    'What we keep',
    [
      'Only what we need to cook for you and keep your account working:',
    ],
    bullets: [
      'Your account — the name, e-mail address and phone number you gave us '
          'when you signed up, and the date you joined. Your password is held '
          'by Google Firebase Authentication and never reaches us in a form we '
          'could read.',
      'Your profile photo, if you set one. It is stored inside your own '
          'profile record, and removing it deletes it.',
      'Your orders — the event date, venue, headcount, the dishes you chose, '
          'the address we deliver to, the times you gave us and any notes you '
          'wrote for the kitchen.',
      'Your payments — how much was paid, when, the method used and the '
          'reference PayMongo gives us. Card and e-wallet details are entered '
          'on PayMongo\'s own checkout page and never pass through this app.',
      'Your settings — the notification switches, your dietary preference and '
          'the allergens you asked us to avoid, and your chosen language.',
    ],
  ),
  LegalClause(
    'Why we keep it',
    [
      'Every item above earns its place:',
    ],
    bullets: [
      'To cook, deliver and set up what you ordered.',
      'To reach you about an order — we call the contact number on a booking '
          'to confirm the details, and send quotations to your e-mail address.',
      'To keep one phone number to one account, so two accounts can\'t end up '
          'sharing a contact and crossing their orders.',
      'To remember your preferences, so you don\'t have to explain how you eat '
          'with every booking.',
      'To keep our own business records of what was ordered and paid.',
    ],
  ),
  LegalClause(
    'Who can see it',
    [
      'Our own team, through the staff dashboards, and only the part each role '
          'needs:',
    ],
    bullets: [
      'Order managers see the orders you file, and move them along as we work '
          'through them.',
      'The master chef sees confirmed orders, to plan the ingredients for your '
          'event.',
      'Content moderators, who look after the menu, can see member profiles.',
    ],
  ),
  LegalClause('Who we never share it with', [
    'We do not sell your information, and we do not hand it to advertisers or '
        'data brokers. Nobody outside the team above sees your orders except '
        'the services that carry them for us (next clause), and anyone the law '
        'obliges us to tell.',
  ]),
  LegalClause(
    'The services that hold it for us',
    [
      'We don\'t run our own servers. Two companies hold this information on '
          'our behalf, under their own security and privacy terms:',
    ],
    bullets: [
      'Google Firebase — your account, your profile, your orders and your '
          'settings live in Firebase Authentication and Cloud Firestore.',
      'PayMongo — takes your downpayment on its own secure page and tells us '
          'only that the payment cleared, for how much, and by what method.',
    ],
  ),
  LegalClause('How long we keep it', [
    'Your account details stay with us for as long as your account is open. '
        'Orders and their payment records are kept as business records after '
        'the event, the way any caterer keeps its books.',
    'Ask us to close your account and we will remove your profile; where we '
        'have to keep an order on record, we keep the order and not you — your '
        'name and contact details come off it.',
  ]),
  LegalClause(
    'What you can change yourself',
    [
      'Much of it, right here in the app:',
    ],
    bullets: [
      'Your profile photo — the Account tab; tap your picture.',
      'Your notification, dietary and language settings — this Settings '
          'screen, at any time.',
      'Your password — "Forgot password?" on the log-in screen sends you a '
          'reset link.',
      'Your name, e-mail or phone number, and closing your account — message '
          'us and we\'ll do it for you. Your number is also our one-account '
          'safeguard, so it\'s moved by hand.',
    ],
  ),
  LegalClause('Children', [
    'The app is meant for adults booking food for themselves, their families '
        'and their events. If you are under 18, please use it with a parent or '
        'guardian.',
  ]),
  LegalClause('When this changes', [
    'If we change what we collect or who sees it, we will update this page and '
        'the date at the top of it. Nothing changes retroactively — a change '
        'here describes what we do from that date on.',
  ]),
];
