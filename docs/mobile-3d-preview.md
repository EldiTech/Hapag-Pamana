# Mobile 3D layout preview

How a member sees the room their event is set up in, from inside the app.

## Shape of it

The Layout Designer desk (`Admin/Layout Designer/`) already renders a plan
three ways — a 2D floor plan, a 3D room, and a walkthrough. Rather than
reimplement a Three.js renderer natively in Flutter, the app hosts a small
read-only page (`hosting/layout-viewer/`) in a WebView and reuses the desk's
own modules verbatim.

"Verbatim" is literal: `crowd.js`, `models.js`, `nav.js`, `rules.js`,
`scene3d.js`, `simulate.js` and `theme.js` are byte-identical copies of
`Admin/Layout Designer/js/`. Nothing is forked for the customer build. The
only file written for the viewer is `js/plan2d.js`, because the desk's 2D
plan lives inside `designer.js` woven through the editor it belongs to —
copying that would hand the member the editing desk as well.

```
lib/screens/user/order_tracking_page.dart   "VIEW 3D LAYOUT", gated on order.hasLayout
  └─ lib/screens/user/layout_preview_page.dart   WebView + the JS bridge
       └─ hosting/layout-viewer/index.html        ?people=0
            └─ js/viewer.js                        bootstrap, read-only
```

## Where the plan comes from

Two sources, because the two contexts have different auth stories.

**1. Handed in (the app).** Flutter has already read `bookings/{id}` under the
member's own session — that read is what decided whether to offer the screen
at all — so the layout is in memory. It is pushed across with one
`runJavaScript` call. The page fetches nothing and signs into nothing.

**2. Fetched (a real browser).** Opened as `?booking=<id>`, the page uses the
Firebase JS SDK's own persisted session and reads `bookings/{id}` under the
existing rule. It waits on `onAuthStateChanged`, not `currentUser`: restoring
a persisted session is asynchronous, and reading a tick after load reports
"signed out" for a member who is perfectly well signed in.

## No Cloud Function

An earlier design minted a custom token from a Cloud Function, because a
WebView cannot inherit the app's native Firebase Auth session, and passed a
Firebase ID token to the page through the URL.

**That design is gone.** It only ever mattered while the WebView was the thing
doing the reading; handing it the data instead removes the function, the Blaze
plan requirement, and an ID token that used to travel through a URL — where it
lands in browser history and referrer headers. Firestore rules are unchanged
either way.

What that leaves:

- `firebase.json` declares only `firestore` and `hosting`. No `functions` key.
- `functions/` still exists on disk, marked `⚠️ DEAD CODE — NOT DEPLOYED` at
  the top of `index.js`, and is untracked in git. It ships nowhere.
- Nothing calls `mintViewerToken` or `firebase.functions()`.
- `index.html` loads the app/auth/firestore compat SDKs only — no
  `firebase-functions-compat`.

**This project runs on the free Spark plan.** Any change that reintroduces a
Cloud Function breaks that, and is a decision to take deliberately rather than
drift into.

## The bridge, and its timing

`layout_preview_page.dart` takes the **booking map**, not a `bookingId`, and:

- loads `…/layout-viewer/?people=0`;
- pushes the plan from `onPageFinished` via `runJavaScript`;
- sends only `layout`, `occasion`, `pax`, `eventType`. The full document
  carries Firestore `Timestamp`s, which throw on `jsonEncode`;
- double-encodes — `jsonEncode(jsonEncode(payload))` — so the argument is a
  correctly escaped JavaScript string literal. The page `JSON.parse`s it back.

`onPageFinished` is not a reliable "the page's scripts have run" signal.
Android's WebView fires it early on some versions, and fires it more than once
on others. A call that lands before `js/viewer.js` has run would be
`undefined.show(…)` — a TypeError raised *inside the WebView*, which
`runJavaScript` does **not** propagate back to Dart. The Dart `catch` would
never fire, and the member would sit on "Loading your layout…" indefinitely
with nothing logged.

So the bridge does not depend on ordering at all:

1. `index.html` installs a queueing `window.HPViewer` in `<head>`, ahead of
   every network-fetched script. Its `show()` only banks the payload.
2. `js/viewer.js` captures whatever was banked, installs the real
   implementation, and replays the queue **at the very end of its IIFE**.

Step 2's placement is load-bearing. `show()` renders, and rendering touches
`view` and `mounted3d`, which are declared partway down `viewer.js`. Draining
the queue where `HPViewer` is defined — above those declarations — would hit
them in their temporal dead zone. That is the same class of failure as an
early `return` in that IIFE: a `ReferenceError` at runtime that no linter
sees. `flutter analyze` and `node --check` are both blind to it, so it is
covered by a DOM-stub harness that drives both orderings instead.

### Still untested

The handshake is exercised against a stubbed DOM in Node, and both orderings
pass. It has **never been run on a physical device or emulator** — the dev
machine has only Windows desktop and Edge web targets, and `webview_flutter`
supports neither. Static analysis cannot cover real `runJavaScript` /
`onPageFinished` behaviour. Treat a device run as outstanding.

## The crowd

`?people=0` suppresses the crowd in the app's WebView. The walkthrough's
guests cost download, memory and frame rate on a phone, for a preview that is
about the room. On the web the crowd loads as usual.

The suppression is done by the *page*, not by editing the copied modules:
`index.html` decides from `?people=0` whether `js/crowd.js` is ever fetched.
That is safe because `simulate.js` resolves `window.HPCrowd` lazily through a
`crowd()` helper and guards every call site, so a page without the file
degrades to an empty-room walkthrough rather than a broken one — and the
options panel's "People" row drops out on its own.

### On the absent `models/` directory

`models.js` names a `BASE` of `../models/` and four Mixamo FBX files. **None of
them exist anywhere in the repo, and that is correct.** `models.js:26` forces
`available()` to `false` — the rigged Mixamo crowd is deliberately parked
("polish primitives only"), code intact, in case a clean set of exports shows
up later.

With `available()` false, `load()` returns early and never requests a file.
`HPModels.ready()` stays false, so `crowd.js`'s `seatRiggedGuest()` and
`addRiggedWalker()` both return `null` and every guest falls through to the
procedural `figure()` / `waiter()` massing bodies. `HPCrowd.available()`
depends on Three, `HPScene` and `HPNav` — never on `HPModels`.

So the walkthrough's "With people" **does** populate. Do not create a
`hosting/models/` directory to "fix" a path that is never walked; if the rigged
set is ever revived, flipping line 26 is the change, and the models then need
to sit beside each *page* that loads them (`../models/` resolves against the
document, so `hosting/models/` for the viewer and
`Admin/Layout Designer/models/` for the desk).
