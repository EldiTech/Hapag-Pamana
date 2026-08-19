# Master Prompt — Verify the HapagPamana Repo

Paste everything below the line into a fresh session opened at
`C:\Users\Moymoy\Downloads\Hapag Pamana`.

---

Verify the state of this repo. **Run the checks — do not conclude anything
from reading code alone, and do not trust any document in this repo that
claims work is already done.** Report what you actually observed.

## Before anything else: confirm you are in the right folder

There are two similarly-named folders in `Downloads`, and they were merged on
2026-08-18. The merge target — the only complete one — is
`Hapag Pamana` (**no** "new" suffix).

Confirm this folder has ALL of: `lib/`, `pubspec.yaml`, `firestore.rules`,
`hosting/layout-viewer/`, `Admin/Catering Equipment/`. If any are missing you
are in the wrong folder (`Hapag Pamana new` has no `lib/` at all) — stop and
say so rather than "fixing" anything.

**`git` is not on PATH.** The only copy is bundled with Flutter:
`C:\dev\flutter\bin\mingit\cmd\git.exe`. Prepend it to `$env:Path`.

## 1. Flutter app builds and analyzes

- `flutter analyze` — expect **No issues found!** Paste the real output.
- Confirm `pubspec.yaml` has `webview_flutter` (^4.10.0 or later).

## 2. The layout viewer — 2D, 3D, walkthrough

In `hosting/layout-viewer/`:

- `index.html` loads, in order: Firebase **app/auth/firestore compat only**
  (there must be **no** `firebase-functions-compat`), Three.js **r128** with
  FBXLoader/fflate/SkeletonUtils, then `rules.js`, `scene3d.js`, `theme.js`,
  `nav.js`, `models.js`, `simulate.js`, `plan2d.js`, `viewer.js`.
- `crowd.js` must be loaded **conditionally** — skipped when the URL carries
  `?people=0`. Confirm the copied modules themselves are NOT edited to do
  this: `simulate.js` resolves `window.HPCrowd` lazily and guards each call
  site, which is what makes omitting the file safe.
- `js/plan2d.js` exists and is read-only: no pointer/drag/resize listeners, no
  writes. It must get shape/label from `HPRules.pieceOf()` rather than
  carrying its own piece catalogue.
- `node --check` every `.js` file under `hosting/layout-viewer/js/`.
- Cross-check every `getElementById("…")` in `viewer.js`/`plan2d.js` against
  the `id="…"` attributes in `index.html`. A mismatch fails silently at
  runtime, so grep it rather than eyeballing.

## 3. Two data paths, and NO Cloud Function

The viewer gets its plan two ways. Confirm both exist in `viewer.js`:

1. **App** — `window.HPViewer.show(payload)`, called by Flutter. No auth, no
   Firestore read in the page.
2. **Browser** — `?booking=<id>`, using the visitor's own persisted Firebase
   session via `onAuthStateChanged` (not `currentUser`, which races session
   restore), reading `bookings/{id}` under the existing rule.

Then confirm the function is gone:

- `firebase.json` has **no** `functions` key (only `firestore` + `hosting`).
- Nothing anywhere calls `mintViewerToken` or `firebase.functions()`.
- No Firebase **ID token is passed in a URL** anywhere.
- `functions/` still exists on disk but is dead code, marked as such at the
  top of `index.js`. It is untracked in git — do not delete it.

**This project must run on the free Spark plan.** If any check here implies a
Cloud Function is needed, say so loudly.

Regression to watch for: an early `return` in `viewer.js`'s IIFE that skips
the tab wiring and the `view`/`mounted3d` declarations. That breaks the app
path with a temporal-dead-zone `ReferenceError` and is invisible to linters.
Prove it works by stubbing the DOM in Node, calling
`window.HPViewer.show({...})`, and checking it does not throw.

The bridge must not depend on script ordering. Confirm both halves:

- `index.html` installs a **queueing `window.HPViewer` in `<head>`**, ahead of
  every network-fetched script, whose `show()` only banks the payload.
- `viewer.js` captures that queue and replays it **at the very END of its
  IIFE** — never where it defines `HPViewer`, which sits above the
  `view`/`mounted3d` declarations and would drain straight into the same
  temporal dead zone.

Test BOTH orderings in the Node harness — `show()` after `viewer.js`, and
`show()` before it — plus a doubled `onPageFinished`. Android does all three.

## 4. Flutter side of the bridge

`lib/screens/user/layout_preview_page.dart` must:

- take the **booking map** (not a `bookingId`),
- load `…/layout-viewer/?people=0`,
- push the plan in `onPageFinished` via `runJavaScript`,
- send only `layout`, `occasion`, `pax`, `eventType` — the full document
  carries Firestore `Timestamp`s that will throw on `jsonEncode`,
- double-encode the payload (`jsonEncode(jsonEncode(x))`) so it is a valid
  escaped JS string literal.

`order_tracking_page.dart` passes `booking: order.data` and gates the button
on `order.hasLayout`.

## 5. The merged Admin work

- `Admin/Catering Equipment/` — 8 files (`prep.js`, `inventory.js`,
  `equipment-common.js`, `config.js`, 2 HTML, CSS, rules snippet).
- `Admin/Logistics/js/dispatch.js` has the equipment-pickup lane driven by
  `bookings/{id}.equipmentPickup`.
- `Admin/firebase-config.js` defines `CATERING_EQUIPMENT_ROLES` and a
  `ROLE_HOMES` entry; confirm that path actually resolves on disk.
- `Owner/js/staff.js` includes `catering_equipment` in assignable departments.
- `node --check` all of the above.

## 6. firestore.rules must match PRODUCTION

This is the one that can cause real damage: deploying a stale rules file
silently deletes live rules.

Fetch the deployed ruleset and diff it against `firestore.rules` **ignoring
comments and whitespace**. There is no `firebase firestore:rules get` in CLI
15.x — use the Rules REST API:

- `GET https://firebaserules.googleapis.com/v1/projects/hapagpamana-39687/releases`
  → find the `cloud.firestore` release → `GET` its `rulesetName`.
- Authenticate with the service-account JSON in the repo root by signing a
  JWT (scope `cloud-platform`) and exchanging it at
  `https://oauth2.googleapis.com/token`.

Expected: **zero differences in either direction.** As of 2026-08-18 both
sides had 162 code lines, including `isCateringEquipment()`, the three
`equipment*` collections, and `bookings` clauses covering `equipmentPrep` /
`equipmentPickup`.

If they differ, **report it — do not deploy and do not "fix" production.**
Say which side is ahead and what would be lost either way.

Then validate compilation without touching production:
`firebase deploy --only firestore:rules --dry-run`.

Finally, confirm every collection the Catering Equipment dashboard touches is
covered by a `match` block.

## 7. Report honestly

State plainly what passed, what failed, and what you could not check. In
particular, these are known-outstanding and are **not** things to fix silently:

- Live device/emulator testing of the WebView bridge has never been done, and
  a dev box with only Windows-desktop and Edge-web targets cannot do it —
  `webview_flutter` supports neither. The *ordering* hazard is now closed by
  the `<head>` queue described in §3, and both orderings are covered by the
  Node harness, but real `runJavaScript` / `onPageFinished` behaviour on a
  physical device remains genuinely unverified. Do not report it as tested.
- The crowd's FBX models are **absent from the repo on purpose** — do not
  "fix" this by creating a `models/` directory. `models.js:26` forces
  `available()` to `false` (the rigged Mixamo set is parked, code intact), so
  `load()` never requests a file, `HPModels.ready()` stays false, and
  `crowd.js` falls through to its procedural `figure()`/`waiter()` bodies.
  `HPCrowd.available()` never consults `HPModels`. "With people" populates
  normally. Verify by stubbing an FBXLoader that throws on any fetch and
  confirming `load()` resolves `false` having requested nothing.
- A live **service-account key** sits at the repo root
  (`hapagpamana-39687-firebase-adminsdk-fbsvc-*.json`). It is correctly
  gitignored by the `*-firebase-adminsdk-*.json` rule and has never been
  committed — verify with `git check-ignore -v` and `git ls-files` before
  raising any alarm, and trust those over any line number quoted here. It is
  still a real credential on local disk: never print, commit, or publish it.
- `docs/mobile-3d-preview.md` now documents the design that actually ships:
  no Cloud Function, no ID token in a URL, the plan handed in over the
  bridge. It is still a document, so it is still not evidence — run the
  checks. An older copy of the *superseded* text (Cloud Function + ID token
  in URL) survives as `m.md` in the sibling `Hapag Pamana new` folder; that
  one is historical and describes a design deliberately replaced.
