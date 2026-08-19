# HapagPamana

*Lutong Pinoy, Pamanang Sarap* — a Flutter app for **HapagPamana Catering Services**, backed by
Firebase (Firestore + Auth). Guests can browse the live menu and catering packages; signed-in
members additionally get a personalised home, profile management, the Gabay assistant tab, and
the Book-Us-Now wizard.

There is also a staff web portal (plain HTML/CSS/JS, no build step) with four role-gated
dashboards behind one sign-in: **Content Moderator** (the content the app reads), **Orders**
(every booking filed from the app), **Master Chef** (ingredient plans and the recipe book) and
**Finance** (costs those plans, confirms the money and releases requisition slips). Each staff
member's `users/{uid}.role` decides which one opens.

## Project layout

| Path | What it is |
| --- | --- |
| `lib/core/theme/` | Design tokens — `AppColors`, `AppTextStyles`, `AppSpacing`, `AppRadius`, `AppMotion`, `AppTheme` (re-exported by `lib/brand.dart`) |
| `lib/core/widgets/` | Reusable UI — `AppCard`, `AppButton`, `AppTextField` (barrel: `app_widgets.dart`) |
| `lib/widgets.dart` | Shared app-level widgets (shimmer, pressable scale, etc.) |
| `lib/data/` | Models + Firestore repositories (products, catering, customers, bookings, allergens) |
| `lib/screens/` | Guest side: splash → `GuestShell` (Home / Menu / Catering / About / Login) |
| `lib/screens/user/` | Member side: `UserShell` (Home / Menu / Gabay / Catering / Account) + booking wizard |
| `Admin/` | Staff portal — `index.html` is the sign-in gate; `Admin/assets/` holds the shared shell (`hp-guard.js`, `hp-core.js`, `hp-shell.js`) each dashboard is built from |
| `Admin/Content Moderator/` · `Admin/Orders/` · `Admin/Master Chef/` · `Admin/Finance/` | The four dashboards, one folder each (`html/`, `js/`, `css/`); all share `Content Moderator/css/global.css` |
| `firestore.rules` | Security rules — **publish manually** in the Firebase console after changes |

## Running

```sh
flutter pub get
flutter run                       # debug on a connected device
flutter build apk --release      # release APK (the usual install path)
flutter test                      # smoke test
```

Android is the primary target (`com.HapagPamana`). iOS requires a Mac to build.
The Content Moderator portal is opened directly from `Admin/index.html` (serve the folder or
open the file; sign-in is Firebase Auth–gated).

## Firebase notes

- App reads live content from Firestore (`products`, catering packages, `settings/allergens`);
  members are stored at `customers/{uid}` and bookings in `bookings`.
- Email/Password sign-in must be enabled in the Firebase console.
- Android config lives at `android/app/google-services.json`; web config for the admin portal
  at `Admin/firebase-config.js`.
- Launcher icons are generated from `Assets/` via `dart run flutter_launcher_icons`.
