import 'package:flutter/material.dart';

import 'legal_document.dart';

/// "Terms of Service" — the deal between a member and the kitchen.
///
/// Like the privacy policy, written against what the app really does: an order
/// arrives as a *request* the team confirms, half the total holds the date,
/// changes and cancellations happen over the phone because the app has no edit
/// path, allergen tags are guidance from a shared kitchen, tabs can be switched
/// off by the moderators, and an account can be suspended.
///
/// Where the outcome genuinely depends on a conversation — what becomes of a
/// downpayment on a cancelled event — it says so rather than inventing a rule
/// the kitchen never agreed to.
class TermsOfServicePage extends StatelessWidget {
  const TermsOfServicePage({super.key});

  static const String _lastUpdated = '4 August 2026';

  @override
  Widget build(BuildContext context) {
    return const LegalDocument(
      title: 'Terms of Service',
      lede: 'The understanding between you and our kitchen when you order '
          'through this app.',
      lastUpdated: _lastUpdated,
      clauses: _clauses,
    );
  }
}

const List<LegalClause> _clauses = [
  LegalClause('The agreement', [
    'These terms are between you and Fill at Home Catering Services, the family '
        'kitchen behind Hapag Pamana. By using the app — browsing the menu, '
        'making an account or filing an order — you\'re agreeing to them.',
    'They sit alongside our Privacy Policy, which covers what we keep about you.',
  ]),
  LegalClause('Your account', [
    'Please give us details that are actually yours: we call the number on a '
        'booking to confirm it, and send quotations to the address you '
        'registered. One phone number belongs to one account.',
    'Keep your password to yourself, and tell us straight away if you think '
        'someone else has it. What happens on your account is treated as done '
        'by you.',
  ]),
  LegalClause('Placing an order', [
    'An order you file is a request, not yet a booking. It reaches us as '
        'Pending, we go through it, and we call you to confirm the details — '
        'the date is only held once we\'ve confirmed it and the downpayment has '
        'landed.',
    'Please tell us everything that matters in the notes: the headcount you '
        'actually expect, how we get into the venue, and anything about '
        'allergies or diets. A surprise on the day costs us both.',
  ]),
  LegalClause('Prices and quotations', [
    'Package prices in the app are what we currently charge, and can change '
        'while an order is still Pending — an order carries the figures it was '
        'filed with, and if anything moves we tell you before you pay.',
    'Some orders are priced by hand, food packs especially. Those file without '
        'an online payment and we send you a quotation; that quotation is what '
        'governs the order.',
  ]),
  LegalClause('The downpayment', [
    'Half the order total is collected up front, and that\'s what holds your '
        'date in the kitchen\'s calendar. The balance is settled with the team '
        'on the day of the event.',
    'The downpayment is taken on PayMongo\'s secure checkout page. If a '
        'payment is interrupted you can pick it up again from Order tracking; '
        'until it clears, your order is filed but your date isn\'t held.',
  ]),
  LegalClause('Changes and cancellations', [
    'Once an order is filed you can\'t edit it in the app — that\'s deliberate, '
        'because the kitchen plans and buys against what you sent. Call or '
        'message us and we\'ll change it with you.',
    'If you need to cancel, tell us as early as you can. What happens to a '
        'downpayment depends on how near the day we are and what has already '
        'been bought and committed for your event, so we work it out with you '
        'directly rather than by a flat rule.',
    'Very occasionally we have to decline or step back from an order — a date '
        'we simply can\'t staff, or something beyond us. If that happens after '
        'you\'ve paid, you get your downpayment back.',
  ]),
  LegalClause('Food, allergens and special diets', [
    'The allergen tags in the app come from our own kitchen and are there to '
        'help you choose. They are guidance, not a guarantee: we cook '
        'everything in one kitchen on shared equipment, so we cannot promise '
        'any dish is free of traces of another.',
    'If an allergy is serious, set it under Settings → Dietary preference, '
        'write it in your booking notes, and call us as well. We would much '
        'rather talk it through than have you rely on a tag.',
  ]),
  LegalClause('What the app can and can\'t do', [
    'The menu, the packages and the setups are ours to change: a dish comes off '
        'when it\'s out of season, and parts of the app can be closed for a '
        'while — the whole app included, when the kitchen needs to pause.',
    'Gabay, the catering companion, is in preview. It doesn\'t place orders or '
        'quote prices, and nothing it eventually suggests is a commitment on '
        'our part.',
  ]),
  LegalClause('Using it fairly', [
    'Please don\'t file orders you don\'t intend to take, use someone else\'s '
        'details, or try to get at parts of the app or other members\' '
        'information that aren\'t yours.',
    'We can suspend an account being used that way. A suspended account can '
        'still be talked about — get in touch and we\'ll go through it with you.',
  ]),
  LegalClause('Our words and pictures', [
    'The story, the photographs, the menu and the recipes in this app are the '
        'family\'s. Enjoy them, share a link, tell your friends — but please '
        'don\'t reuse them commercially or pass them off as your own.',
  ]),
  LegalClause('What we stand behind', [
    'We stand behind our food and our service. If something isn\'t right on '
        'the day, tell us then and there and we will do what we can to put it '
        'right.',
    'Beyond that, we\'re a small kitchen: we can\'t take on losses beyond the '
        'value of the order itself, such as lost earnings or the cost of the '
        'rest of an event. Nothing here takes away the rights Philippine '
        'consumer law gives you.',
  ]),
  LegalClause('Where this is settled', [
    'These terms are governed by the laws of the Republic of the Philippines, '
        'and anything we can\'t settle between us belongs to the courts of '
        'Metro Manila. We would always rather settle it over the phone.',
  ]),
  LegalClause('When these change', [
    'If we change these terms we\'ll update this page and the date at the top. '
        'An order already confirmed keeps the terms it was made under.',
  ]),
];
