# HapagPamana Architecture

## Runtime surfaces

HapagPamana has four runtime surfaces:

- `lib/` — Flutter customer application for Android, iOS, and web.
- `Admin/` — static staff portal. Firebase Auth and Firestore provide access and data.
- `api/` — Vercel serverless endpoints for payment and notification hand-off.
- `functions/` — Firebase Cloud Functions for server-side events.

The hosted Three.js layout viewer lives in `hosting/layout-viewer/`. It is embedded
by the Flutter app and also used by the Layout Designer dashboard.

## Flutter boundaries

```text
lib/
  main.dart                 process entry point only
  app/                      app shell, startup, and global navigation
  core/theme/               design tokens and ThemeData
  core/widgets/             reusable design-system and shared app widgets
  data/                     models, repositories, services, and remote state
  screens/                  feature screens and flows
```

`lib/widgets.dart` remains a compatibility barrel. New code should import the
canonical shared widgets under `lib/core/widgets/`.

`data/` stays together for now because repositories and models share Firestore
schemas. A future split must update every import and keep the security-sensitive
repository validation intact.

## Admin boundaries

```text
Admin/
  assets/                   shared shell, guards, workflow helpers, and styles
  <dashboard>/html/         page entry points
  <dashboard>/js/           dashboard behavior and Firestore operations
  <dashboard>/css/          dashboard-specific styles
```

Every dashboard loads the shared Firebase config, access guard, core shell, and
its role-specific config. Dashboard folders are kept separate because their HTML
pages are deployed as static files and depend on relative script paths.

## Change rules

- Keep business rules in repositories or services, not screen widgets.
- Keep Firebase access behind existing repository/service boundaries.
- Add shared UI to `core/widgets/`; add feature UI beside its screen.
- Preserve dashboard relative paths unless all HTML references are updated together.
- Keep secrets in `.env`; commit only `.env.example` placeholders.
- Run `flutter analyze` and `flutter test` after Dart changes.
- Run Node syntax checks after API or dashboard JavaScript changes.

## Known migration edges

- Payment uses Xendit. Checkout secrets stay in the Vercel API.
- `Download Web/` is a separate static download page, not part of the Flutter app.
- `bin/`, generated media, and local deployment caches should not gain new artifacts.
