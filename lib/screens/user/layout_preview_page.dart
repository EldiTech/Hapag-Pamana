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
  bool _isLandscape = false;

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
            _patch2dFloorPlan();
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
    ".hp-sim .hp-sim-tools .hp-sim-tool:nth-of-type(1)," +
    ".hp-sim .hp-sim-tools .hp-sim-tool:nth-of-type(3)," +
    ".hp-sim [data-pop=\"quality\"]," +
    ".hp-sim [data-pop=\"guide\"]," +
    ".hp-sim .hp-sim-pop," +
    ".hp-sim #hpSimAnalyze," +
    ".hp-sim #hpSimReset," +
    ".hp-sim #hpSimHide," +
    ".hp-sim #hpSimFull { display: none !important; }" +
    // Controls to the left edge: only 1st Person and Exit remain
    ".hp-sim .hp-sim-foot { justify-content: flex-start !important; gap: 12px !important; }" +
    ".hp-sim .hp-sim-tools { justify-content: flex-start !important; gap: 12px !important; }" +
    ".hp-sim .hp-sim-btn { flex: 0 1 auto !important; min-width: 108px !important; padding: 10px 18px !important; font-size: 0.62rem !important; }" +
    // Safe area spacing for landscape status bar and navigation
    ".hp-sim .hp-sim-top {" +
    "  padding-top: max(12px, env(safe-area-inset-top, 12px)) !important;" +
    "  padding-left: max(18px, env(safe-area-inset-left, 18px)) !important;" +
    "  padding-right: max(18px, env(safe-area-inset-right, 18px)) !important;" +
    "}" +
    ".hp-sim .hp-sim-foot {" +
    "  padding-bottom: max(12px, env(safe-area-inset-bottom, 12px)) !important;" +
    "  padding-left: max(18px, env(safe-area-inset-left, 18px)) !important;" +
    "  padding-right: max(18px, env(safe-area-inset-right, 18px)) !important;" +
    "}" +
    // Prompt dismissal and touch responsiveness
    ".hp-sim-prompt.is-dismissed," +
    ".hp-sim.is-locked .hp-sim-prompt { opacity: 0 !important; pointer-events: none !important; visibility: hidden !important; display: none !important; }" +
    ".hp-sim .hp-sim-prompt {" +
    "  max-width: min(340px, 85vw) !important;" +
    "  padding: 12px 18px !important;" +
    "  cursor: pointer !important;" +
    "  pointer-events: auto !important;" +
    "  transition: opacity 0.3s ease !important;" +
    "}" +
    // Virtual joystick styles
    ".hp-sim-joystick {" +
    "  position: fixed !important;" +
    "  width: 84px !important;" +
    "  height: 84px !important;" +
    "  border-radius: 50% !important;" +
    "  background: radial-gradient(circle, rgba(220, 182, 97, 0.18) 0%, rgba(20, 12, 5, 0.5) 100%) !important;" +
    "  border: 2px solid rgba(220, 182, 97, 0.5) !important;" +
    "  pointer-events: none !important;" +
    "  z-index: 9998 !important;" +
    "  transform: translate(-50%, -50%) !important;" +
    "  box-shadow: 0 0 16px rgba(0, 0, 0, 0.4) !important;" +
    "}" +
    ".hp-sim-joy-knob {" +
    "  position: absolute !important;" +
    "  top: 50% !important;" +
    "  left: 50% !important;" +
    "  width: 38px !important;" +
    "  height: 38px !important;" +
    "  margin-top: -19px !important;" +
    "  margin-left: -19px !important;" +
    "  border-radius: 50% !important;" +
    "  background: linear-gradient(135deg, #DCB661 0%, #7b591f 100%) !important;" +
    "  border: 1.5px solid #F4E9CE !important;" +
    "  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5) !important;" +
    "  pointer-events: none !important;" +
    "  will-change: transform !important;" +
    "}";
  document.head.appendChild(s);

  function wireSimUi() {
    var sim = document.querySelector(".hp-sim");
    if (!sim || sim.dataset.hpUiWired) return;
    sim.dataset.hpUiWired = "1";

    if (window.HPSim && window.HPSim.setQuality && window.HPSim.quality !== "LOW") {
      window.HPSim.setQuality("LOW");
    }

    var prompt = sim.querySelector("#hpSimPrompt");
    if (prompt) {
      var strong = prompt.querySelector("strong");
      var span = prompt.querySelector("span");
      if (strong) strong.textContent = "Touch & Drag to Walk";
      if (span) span.textContent = "Drag left side to walk · Drag right side to look";
      prompt.addEventListener("click", function () {
        prompt.classList.add("is-dismissed");
      });
    }
    var dismissPrompt = function () {
      if (prompt) prompt.classList.add("is-dismissed");
    };
    setTimeout(dismissPrompt, 3500);

    var joy = sim.querySelector(".hp-sim-joystick");
    if (!joy) {
      joy = document.createElement("div");
      joy.className = "hp-sim-joystick";
      joy.style.display = "none";
      var knob = document.createElement("div");
      knob.className = "hp-sim-joy-knob";
      joy.appendChild(knob);
      sim.appendChild(joy);
    }
    var knobEl = joy.querySelector(".hp-sim-joy-knob");
    var moveId = null;
    var startPos = { x: 0, y: 0 };
    var stage = sim.querySelector("#hpSimStage") || sim;

    stage.addEventListener("touchstart", function (e) {
      dismissPrompt();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.clientX < window.innerWidth / 2 && moveId === null) {
          moveId = t.identifier;
          startPos = { x: t.clientX, y: t.clientY };
          joy.style.left = t.clientX + "px";
          joy.style.top = t.clientY + "px";
          joy.style.display = "block";
          if (knobEl) knobEl.style.transform = "translate(0px, 0px)";
        }
      }
    }, { passive: true });

    stage.addEventListener("touchmove", function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (moveId !== null && t.identifier === moveId) {
          var dx = t.clientX - startPos.x;
          var dy = t.clientY - startPos.y;
          var dist = Math.hypot(dx, dy);
          var maxR = 40;
          var clamped = Math.min(dist, maxR);
          var angle = dist > 0 ? Math.atan2(dy, dx) : 0;
          var kx = Math.cos(angle) * clamped;
          var ky = Math.sin(angle) * clamped;
          if (knobEl) knobEl.style.transform = "translate(" + kx + "px, " + ky + "px)";
        }
      }
    }, { passive: true });

    var onEnd = function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (moveId !== null && t.identifier === moveId) {
          moveId = null;
          joy.style.display = "none";
        }
      }
    };
    stage.addEventListener("touchend", onEnd, { passive: true });
    stage.addEventListener("touchcancel", onEnd, { passive: true });
  }

  if (!window.__hpSimPoll) {
    window.__hpSimPoll = setInterval(wireSimUi, 300);
  }
  wireSimUi();
})();
''';
    try {
      await _controller!.runJavaScript(js);
    } catch (_) {
      // Cosmetic. A failure leaves the full toolbar, which still works.
    }
  }

  /// Fixes 2D floor plan rendering on mobile so tables display sequential table
  /// numbering (T1, T2...) instead of bare seat counts, fixtures (Stage, Buffet,
  /// Entrance) stay labeled, and items can be inspected with tap.
  Future<void> _patch2dFloorPlan() async {
    const js = r'''
(function () {
  if (!document.getElementById("hp2dPatchStyles")) {
    var s = document.createElement("style");
    s.id = "hp2dPatchStyles";
    s.textContent =
      ".ld-item.is-tiny .ld-item-seats { display: none !important; }" +
      ".ld-item.is-tiny .ld-item-label { display: block !important; font-size: 0.58rem !important; letter-spacing: 0 !important; max-width: 96% !important; line-height: 1 !important; }" +
      ".ld-item-num { font-family: var(--display, serif) !important; font-weight: 700 !important; font-size: 0.78rem !important; color: var(--ink, #33220f) !important; line-height: 1 !important; pointer-events: none !important; }" +
      ".ld-item.is-tiny:has(.ld-item-num) .ld-item-label { display: none !important; }" +
      ".ld-item[data-kind=\"stage\"] .ld-item-label { font-size: 0.75rem !important; letter-spacing: 1.5px !important; color: var(--brown-deep, #2a1a08) !important; display: block !important; }" +
      ".ld-item[data-kind=\"buffet\"] { background: var(--paper-2, #f8f1de) !important; }" +
      ".ld-item[data-kind=\"buffet\"] .ld-item-label { font-size: 0.6rem !important; letter-spacing: 1.2px !important; color: var(--brown, #432c0e) !important; display: block !important; writing-mode: vertical-rl !important; }" +
      ".ld-item[data-kind=\"door\"] { background: rgba(169, 130, 60, 0.25) !important; border: 1.5px dashed var(--gold-deep, #7b591f) !important; }" +
      ".ld-item[data-kind=\"door\"] .ld-item-label { font-size: 0.52rem !important; display: block !important; color: var(--brown-deep, #2a1a08) !important; }" +
      ".lv-stage2d .ld-item { cursor: pointer !important; }" +
      ".lv-stage2d .ld-item.selected { border-color: var(--brown, #432c0e) !important; box-shadow: 0 0 0 2px var(--gold-light, #c7a04a), 0 6px 16px rgba(0,0,0,0.2) !important; z-index: 5 !important; }" +
      ".lv-zoom-tools { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; gap: 6px; z-index: 20; }" +
      ".lv-zoom-btn { width: 36px; height: 36px; border-radius: 8px; border: 1px solid rgba(169, 130, 60, 0.42); background: #FFFBF0; color: #33220F; font-size: 1.15rem; font-weight: 700; line-height: 1; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.15); }" +
      ".lv-selection-info { position: absolute; bottom: 12px; left: 14px; right: 14px; background: #FFFBF0; border: 1px solid #A9823C; border-radius: 8px; padding: 10px 14px; box-shadow: 0 12px 28px rgba(42,26,8,0.25); display: flex; align-items: center; justify-content: space-between; gap: 12px; z-index: 25; }" +
      ".lv-sel-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }" +
      ".lv-sel-title { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 700; font-size: 1.05rem; color: #2A1A08; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }" +
      ".lv-sel-meta { font-size: 0.8rem; color: #6A5331; }" +
      ".lv-sel-close { background: transparent; border: none; font-size: 1.4rem; line-height: 1; color: #927A4E; cursor: pointer; padding: 4px 8px; }";
    document.head.appendChild(s);
  }

  function enhanceCanvas() {
    var canvas = document.getElementById("lvCanvas");
    if (!canvas) return;

    var items = canvas.querySelectorAll(".ld-item");
    items.forEach(function (el) {
      if (el.dataset.hpEnhanced) return;
      el.dataset.hpEnhanced = "1";

      var body = el.querySelector(".ld-item-body");
      var labelEl = el.querySelector(".ld-item-label");
      var seatsEl = el.querySelector(".ld-item-seats");
      var rawLabel = (labelEl ? labelEl.textContent : "").trim();
      var kind = el.dataset.kind || "";

      var m = rawLabel.match(/^(?:Table|T|Guest)\s*(\d+)$/i);
      if (m) {
        if (!el.querySelector(".ld-item-num")) {
          var numSpan = document.createElement("span");
          numSpan.className = "ld-item-num";
          numSpan.textContent = "T" + m[1];
          if (body) {
            body.insertBefore(numSpan, body.firstChild);
            if (labelEl) labelEl.style.display = "none";
          }
        }
      } else if (kind === "stage") {
        if (labelEl && !labelEl.textContent.trim()) labelEl.textContent = "STAGE";
      } else if (kind === "buffet") {
        if (labelEl && !labelEl.textContent.trim()) labelEl.textContent = "BUFFET";
      } else if (kind === "door") {
        if (labelEl && !labelEl.textContent.trim()) labelEl.textContent = "ENTRANCE";
      }

      el.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var stage = document.getElementById("lvStage2d");
        if (!stage) return;
        stage.querySelectorAll(".ld-item").forEach(function (other) { other.classList.remove("selected"); });
        el.classList.add("selected");

        var card = stage.querySelector(".lv-selection-info");
        if (!card) {
          card = document.createElement("div");
          card.className = "lv-selection-info";
          stage.appendChild(card);
        }
        var title = rawLabel || kind.toUpperCase();
        var seats = seatsEl ? seatsEl.textContent.trim() : "";
        var meta = seats ? (seats + " seats") : "Floor piece";
        card.innerHTML =
          '<div class="lv-sel-body">' +
          '  <span class="lv-sel-title">' + title + '</span>' +
          '  <span class="lv-sel-meta">' + meta + '</span>' +
          '</div>' +
          '<button class="lv-sel-close" type="button">&times;</button>';
        card.querySelector(".lv-sel-close").addEventListener("click", function (cEv) {
          cEv.stopPropagation();
          el.classList.remove("selected");
          card.remove();
        });
      });
    });
  }

  // 3. Patch 3D View Pinch-To-Zoom
  function patch3d() {
    var host = document.getElementById("ld3dHost");
    if (!host) return;
    var canvas = host.querySelector("canvas");
    if (!canvas || canvas.dataset.hpPinchPatched) return;
    canvas.dataset.hpPinchPatched = "1";

    var pointers = new Map();
    var pinchDist = null;

    canvas.addEventListener("pointerdown", function (e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        var pts = Array.from(pointers.values());
        pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    }, { capture: true });

    canvas.addEventListener("pointermove", function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        e.stopPropagation();
        var pts = Array.from(pointers.values());
        var curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist && Math.abs(curDist - pinchDist) > 1.5) {
          var diff = curDist - pinchDist;
          var delta = -diff * 4;
          canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
          pinchDist = curDist;
        }
      }
    }, { capture: true });

    var end = function (e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = null;
    };
    canvas.addEventListener("pointerup", end, { capture: true });
    canvas.addEventListener("pointercancel", end, { capture: true });
  }

  if (!window.__hpEnhanceTimer) {
    window.__hpEnhanceTimer = setInterval(function () {
      enhanceCanvas();
      patch3d();
    }, 400);
  }
  enhanceCanvas();
  patch3d();
})();
''';
    try {
      await _controller!.runJavaScript(js);
    } catch (_) {}
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
    if (mounted && _isLandscape != landscape) {
      setState(() => _isLandscape = landscape);
    }
    if (landscape) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
    } else {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    }
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
    if (!kIsWeb) {
      SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
      _orient(false);
    }
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
      appBar: _isLandscape
          ? null
          : AppBar(
              backgroundColor: Colors.transparent,
              flexibleSpace:
                  const ParchmentBackground(weave: true, vignette: false),
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
