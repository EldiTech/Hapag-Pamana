/// Facts about this build of the app.
library;

/// The app's version, as shown on Settings → About and stamped into the
/// pre-filled support e-mail so a report arrives with its build attached.
///
/// Kept in step with `version:` in pubspec.yaml by hand — reading it at runtime
/// would mean taking on a plugin (`package_info_plus`) for one line of text.
const String kAppVersion = '1.0.0';
