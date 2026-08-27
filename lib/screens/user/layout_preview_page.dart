import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../brand.dart';
import '../../widgets.dart';

/// Stands the room a member's event is set up to up in 2D and 3D — the same
/// scene the Layout Designer desk draws with
/// (Admin/Layout Designer/js/scene3d.js), reused as-is by hosting a small
/// read-only page (hosting/layout-viewer) inside a WebView rather than
/// reimplementing a Three.js renderer natively.
///
/// The page is handed the plan rather than left to fetch it. This app has
/// already read `bookings/{id}` under the member's own session — that read is
/// what decided whether to offer this screen at all — so the layout is
/// already in memory, and passing it across costs one `runJavaScript` call.
///
/// That matters beyond tidiness. A WebView cannot inherit the app's native
/// Firebase Auth session, so a page that fetched for itself needed a
/// server-side token exchange to get one: a Cloud Function, and with it the
/// Blaze plan. Handing the data in removes both, and removes an ID token that
/// would otherwise travel through a URL — where it lands in browser history
/// and referrer headers. Firestore rules are untouched.
///
/// Read-only start to finish: nothing this screen or the page it loads can
/// write. Editing the plan stays the Layout Designer desk's job alone.
class LayoutPreviewPage extends StatefulWidget {
  const LayoutPreviewPage({
    super.key,
    required this.booking,
    required this.eventName,
  });

  /// The booking document as read by [BookingRepository] — the `layout` map
  /// and the few fields the walkthrough labels itself with.
  final Map<String, dynamic> booking;
  final String eventName;

  @override
  State<LayoutPreviewPage> createState() => _LayoutPreviewPageState();
}

class _LayoutPreviewPageState extends State<LayoutPreviewPage> {
  // Firebase Hosting's default domain for this project — see
  // lib/firebase_options.dart (projectId: hapagpamana-39687).
  static const _viewerBase =
      'https://hapagpamana-39687.web.app/layout-viewer/';

  // Null on web: webview_flutter has no web-platform implementation at all,
  // and even constructing a WebViewController there throws (a bare
  // "platform implementation ... has not been set" assertion, not something
  // catchable per-call) — so the controller is skipped entirely rather than
  // built and left unused, and the page falls back to [_WebNotSupportedNotice].
  WebViewController? _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (kIsWeb) return;
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      // The walkthrough asks for landscape through here, and asks for portrait
      // back when it exits. A page cannot rotate the device on its own —
      // `screen.orientation.lock()` is refused inside an Android WebView — so
      // js/viewer.js posts through this channel and _orient does the rotating.
      //
      // Deliberately scoped to the walkthrough rather than locked for the whole
      // screen: the 2D plan and the 3D orbit are read upright, and only the
      // first-person view needs the width.
      //
      // The cost of that scoping is a dependency on the deployed page. The
      // viewer is fetched from Firebase Hosting, so a copy older than the
      // commit that added the post — or a cached one — leaves this channel
      // silent and the walkthrough upright, with nothing logged to say why.
      // If the room does not rotate, suspect the deploy before this file.
      ..addJavaScriptChannel(
        'HPOrient',
        onMessageReceived: (m) => _orient(m.message == 'landscape'),
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          // The plan goes in only once the page's own scripts have run —
          // window.HPViewer does not exist before that.
          onPageFinished: (_) {
            _send();
            _wireOrientation();
            _trimWalkthroughUi();
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (_) {
            if (mounted) {
              setState(() => _error = "Couldn't open the layout preview.");
            }
          },
        ),
      );
    _load();
  }

  /// Cuts the walkthrough's toolbar down to what a member exploring a room
  /// needs: the 1st/3rd-person toggle, Quality, and Exit.
  ///
  /// The desk's walkthrough is a planning instrument — Guide routes, Analyse
  /// clearance reports, Reset, a WASD legend, a "Simulation Mode" badge. None
  /// of that means anything to someone looking at the room their party is
  /// booked into, and most of it leads somewhere confusing with no clear way
  /// back. Exit is never hidden: pointer-locked and fullscreen, it is the only
  /// way out.
  ///
  /// `css/viewer.css` carries the same rules for the browser build. They are
  /// repeated here for the same reason as [_wireOrientation]: that stylesheet
  /// arrives over the network and can be stale, and when it is, the member
  /// simply sees the desk's full toolbar.
  ///
  /// Injected as a stylesheet rather than by removing nodes, so every handler
  /// in the copied `simulate.js` still finds what it reaches for — the buttons
  /// keep working, they are just not shown.
  ///
  /// Quality keeps only HIGH and ULTRA. LOW and MEDIUM exist for the desk's
  /// older laptops; on a phone they mostly read as "make my room look worse".
  /// Note this hides the *options*, not the setting — `autoQuality()` still
  /// picks from all four on entry, so a modest phone may open on MEDIUM with
  /// neither remaining button lit. That is correct: the two on offer are both
  /// upgrades from there.
  ///
  /// The strip is pinned left, per the same instruction that asked for
  /// fullscreen — `justify-content` on the footer rather than on the tools row,
  /// because the footer is the flex parent that was holding it right.
  Future<void> _trimWalkthroughUi() async {
    const js = r'''
(function () {
  if (document.getElementById("hpCustomerView")) return;
  var s = document.createElement("style");
  s.id = "hpCustomerView";
  // Appended to <head> last, so it beats both stylesheets on order as well as
  // on specificity; !important covers the copied rules that set display.
  s.textContent =
    ".hp-sim .hp-sim-keys," +
    ".hp-sim .hp-sim-badge," +
    ".hp-sim .hp-sim-status-wrap," +
    ".hp-sim .hp-sim-tools .hp-sim-tool:nth-of-type(3)," +
    ".hp-sim #hpSimAnalyze," +
    ".hp-sim #hpSimReset," +
    ".hp-sim #hpSimHide," +
    ".hp-sim #hpSimFull { display: none !important; }" +
    // Only HIGH and ULTRA are worth offering on a phone.
    ".hp-sim .hp-sim-opt[data-quality=\"LOW\"]," +
    ".hp-sim .hp-sim-opt[data-quality=\"MEDIUM\"] { display: none !important; }" +
    // Controls to the left edge, and the popovers with them.
    ".hp-sim .hp-sim-foot { justify-content: flex-start !important; }" +
    ".hp-sim .hp-sim-tools { justify-content: flex-start !important; }" +
    ".hp-sim .hp-sim-btn { flex: 0 1 auto !important; }" +
    // css/viewer.css centres the popovers on narrow screens (left: 50% with a
    // translateX). With the strip moved left they belong over it, not over the
    // middle of the room, so that centring is undone here.
    "@media (max-width: 480px) {" +
    "  .hp-sim .hp-sim-pop {" +
    "    left: 10px !important;" +
    "    right: auto !important;" +
    "    transform: none !important;" +
    "  }" +
    "}";
  document.head.appendChild(s);
})();
''';
    try {
      await _controller!.runJavaScript(js);
    } catch (_) {
      // Cosmetic. A failure leaves the full toolbar, which still works.
    }
  }

  /// Wires the walkthrough's rotation from this side, rather than trusting the
  /// deployed page to do it.
  ///
  /// `js/viewer.js` posts through `HPOrient` too, and when the deployed copy is
  /// current that is what fires. But the viewer is fetched from Firebase
  /// Hosting: a page older than the commit that added those posts — or one
  /// served from the WebView's cache — stays silent, and the walkthrough opens
  /// upright with nothing logged to say why. That failure cost several rounds
  /// of "still like this" with correct code on disk the whole time.
  ///
  /// So the posts are installed here as well, against the walkthrough's own
  /// buttons, which are part of the copied `simulate.js` and have been stable
  /// far longer than this feature. Both paths call the same channel and the
  /// same [_orient]; firing twice is harmless, since setting an orientation
  /// that is already set does nothing.
  ///
  /// Idempotent by the `dataset` flag: `onPageFinished` fires more than once on
  /// some Android WebViews, and a second pass must not stack another pair of
  /// listeners on the same buttons.
  Future<void> _wireOrientation() async {
    const js = '''
(function () {
  var walk = document.getElementById("lvWalkBtn");
  if (!walk || walk.dataset.hpOrientWired) return;
  walk.dataset.hpOrientWired = "1";
  var post = function (m) {
    if (window.HPOrient && window.HPOrient.postMessage) window.HPOrient.postMessage(m);
  };
  walk.addEventListener("click", function () {
    post("landscape");
    // Fullscreen on entry, so the room gets the whole screen without the
    // member having to find a button for it.
    //
    // Requested HERE, synchronously inside the click, and not in the timeout
    // below: requestFullscreen() is only granted while a user gesture is being
    // handled, and a setTimeout — even at 0 ms — ends that window on some
    // browsers, which rejects the request.
    //
    // .hp-sim is already in the DOM by this point, by listener order: viewer.js
    // registers its own click handler when the page loads, this one is added
    // later from onPageFinished, and listeners fire in registration order — so
    // its HPSim.enter(), which builds and appends the overlay synchronously,
    // has already run. Guarded anyway rather than assumed.
    //
    // Allowed to fail quietly: a browser that refuses leaves the page as it
    // was, and the walkthrough is still perfectly usable.
    var sim = document.querySelector(".hp-sim");
    if (sim && sim.requestFullscreen) sim.requestFullscreen().catch(function () {});
    // The Exit button is inside that same overlay. Bound per entry rather than
    // once: exiting destroys the overlay, and re-entering builds a fresh one.
    setTimeout(function () {
      var ex = document.getElementById("hpSimExit");
      if (ex && !ex.dataset.hpOrientWired) {
        ex.dataset.hpOrientWired = "1";
        ex.addEventListener("click", function () {
          post("portrait");
          // simulate.js's own exit() also drops fullscreen; this covers the
          // case where the deployed copy is older than that behaviour.
          if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
        });
      }
    }, 0);
  });
})();
''';
    try {
      await _controller!.runJavaScript(js);
    } catch (_) {
      // A failure here costs the rotation, not the preview — the room is still
      // perfectly usable upright, so this must not surface an error over it.
    }
  }

  /// Rotates the app for the walkthrough, and back again when it exits.
  ///
  /// A first-person view down a 13-metre hall through an upright phone is a
  /// sliver of the room, with the walkthrough's wrapped toolbar eating what is
  /// left of it. The 2D plan and the 3D orbit stay portrait.
  ///
  /// Restoring passes the portrait pair rather than an empty list. Empty means
  /// "all four, including upside-down", which is not what the rest of this app
  /// runs in — it never sets orientations anywhere else, so it inherits the
  /// manifest's (Android) and Info.plist's (iOS) portrait default.
  void _orient(bool landscape) {
    SystemChrome.setPreferredOrientations(
      landscape
          ? const [
              DeviceOrientation.landscapeLeft,
              DeviceOrientation.landscapeRight,
            ]
          : const [
              DeviceOrientation.portraitUp,
              DeviceOrientation.portraitDown,
            ],
    );
  }

  /// The walkthrough's own "Exit" button reports itself through `HPOrient`, but
  /// a system Back gesture out of a running walkthrough tears this screen down
  /// without that message ever being sent — which would leave the whole app
  /// sideways. Unlocking here covers that path, and is a no-op when the member
  /// already exited cleanly.
  @override
  void dispose() {
    if (!kIsWeb) _orient(false);
    super.dispose();
  }

  Future<void> _load() async {
    // people=0 drops the crowd from the walkthrough on mobile. The animated
    // guests are heavy — skinned FBX bodies, one mesh each — and phones pay
    // for them in download, memory and frame rate for a preview that is
    // about the ROOM. The web viewer, on a desktop GPU, still gets them.
    // No booking id and no token: the plan is handed over by _send() below.
    final uri = Uri.parse(_viewerBase).replace(queryParameters: {
      'people': '0',
    });
    try {
      await _controller!.loadRequest(uri);
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't open the layout preview.");
    }
  }

  /// Hands the page the plan. Only the fields the viewer actually reads are
  /// sent — the booking document also carries `Timestamp`s and other Firestore
  /// types that have no JSON form, and the preview has no business seeing the
  /// rest of a member's order anyway.
  ///
  /// Safe to call whenever [onPageFinished] decides to fire, including early
  /// and including twice, which Android's WebView does. The page installs
  /// `window.HPViewer` as a queueing stub in its `<head>` — before any
  /// network-fetched script — and `js/viewer.js` drains that queue when it
  /// loads, so a plan delivered ahead of the page's own scripts is held
  /// rather than thrown at an undefined object. Do not remove that stub
  /// believing this call is ordered after it; nothing guarantees that.
  ///
  /// The guard below matters because a JS exception raised here does NOT come
  /// back through [runJavaScript] as a Dart error — the `catch` would never
  /// fire and the failure would be invisible, which is precisely how this
  /// went wrong before.
  Future<void> _send() async {
    final b = widget.booking;
    final payload = <String, dynamic>{
      'layout': _jsonSafe(b['layout']),
      'occasion': b['occasion'] ?? b['eventName'] ?? widget.eventName,
      'pax': b['pax'] ?? b['headcount'],
      'eventType': b['eventType'],
    };
    // Encoded twice on purpose: once to JSON, then again to turn that JSON
    // into a correctly escaped JavaScript string literal to sit inside the
    // call. The page JSON.parses it back.
    final arg = jsonEncode(jsonEncode(payload));
    try {
      await _controller!
          .runJavaScript('window.HPViewer && window.HPViewer.show($arg)');
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't open the layout preview.");
    }
  }

  /// Recursively strips Firestore types [jsonEncode] can't serialize —
  /// `Timestamp` is the one actually seen on a booking's `layout` map (the
  /// desk's `updatedAt` stamp), converted to an ISO string; anything else of
  /// that kind (`GeoPoint`, `DocumentReference`) is dropped outright since
  /// the viewer has no use for either. Without this, `jsonEncode` throws
  /// synchronously — before the try/catch below even starts — and the whole
  /// call is lost silently, which is exactly how this page ended up stuck on
  /// "Loading your layout…" forever.
  static Object? _jsonSafe(Object? v) => switch (v) {
        Timestamp t => t.toDate().toIso8601String(),
        Map<dynamic, dynamic> m => {
            for (final e in m.entries)
              if (e.value is! GeoPoint && e.value is! DocumentReference)
                e.key.toString(): _jsonSafe(e.value),
          },
        List<dynamic> l => [for (final e in l) _jsonSafe(e)],
        _ => v,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        flexibleSpace: const ParchmentBackground(weave: true, vignette: false),
        title: Text(widget.eventName, style: AppTextStyles.heading),
      ),
      // The room takes a moment to build, so the scrim doesn't vanish the
      // instant the page reports itself finished — it fades off the WebView,
      // and an error fades in over it, rather than either one cutting.
      body: SmoothSwap(
        alignment: Alignment.center,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (kIsWeb) {
      return const _WebNotSupportedNotice(key: ValueKey('preview-web'));
    }
    if (_error != null) {
      return _ErrorNotice(
        key: const ValueKey('preview-error'),
        message: _error!,
      );
    }
    return Stack(
      key: const ValueKey('preview'),
      children: [
        WebViewWidget(controller: _controller!),
        IgnorePointer(
          ignoring: !_loading,
          child: AnimatedOpacity(
            opacity: _loading ? 1 : 0,
            duration: Motion.base,
            curve: Motion.exit,
            child: const ColoredBox(
              color: Colors.black12,
              child: Center(child: CircularProgressIndicator()),
            ),
          ),
        ),
      ],
    );
  }
}

class _ErrorNotice extends StatelessWidget {
  const _ErrorNotice({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const ParchmentBackground(weave: true),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.screen),
            child: Text(
              message,
              style: AppTextStyles.body,
              textAlign: TextAlign.center,
            ),
          ),
        ),
      ],
    );
  }
}

/// Shown instead of the WebView on Flutter Web — `webview_flutter` has no
/// web-platform implementation, so building [WebViewController] there throws
/// rather than degrading gracefully. The 3D walkthrough stays a mobile
/// feature; this tells the member (or a developer testing on Chrome) why,
/// instead of the app crashing.
class _WebNotSupportedNotice extends StatelessWidget {
  const _WebNotSupportedNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        const ParchmentBackground(weave: true),
        Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.screen),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.view_in_ar_outlined,
                  size: 36,
                  color: AppColors.brownSoft,
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'Open Hapag Pamana on your phone to walk through this room '
                  'in 3D — the preview isn\'t available on the web yet.',
                  style: AppTextStyles.body,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
