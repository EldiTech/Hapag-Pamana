/// Barrel for the member Settings module.
///
/// Settings grew from one screen into a small section of the app — the settings
/// list itself, the two pickers behind it (dietary preference and language), the
/// support screens (Help & FAQ, Contact us), the two policies, and the About
/// story's member-side frame. They live together under `settings/` and share one
/// row vocabulary ([SettingsScaffold] and friends in `settings_widgets.dart`).
///
/// Outside callers only need [UserSettingsPage] — the Account tab pushes it and
/// everything else is reached from inside. Importing this barrel gets the whole
/// module for the times a screen wants to deep-link one of them (say, jumping
/// straight to Dietary preference from a menu flag).
library;

export 'about_route.dart';
export 'contact_us_page.dart';
export 'dietary_preference_page.dart';
export 'help_faq_page.dart';
export 'language_page.dart';
export 'legal_document.dart';
export 'privacy_policy_page.dart';
export 'settings_page.dart';
export 'settings_widgets.dart';
export 'terms_of_service_page.dart';
