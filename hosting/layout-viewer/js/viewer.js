/* HapagPamana · Layout Viewer — the customer-facing bootstrap.

   Opened inside the app's WebView as layout-viewer/?people=0 with the plan
   handed in afterwards, or in a browser as layout-viewer/?booking=<id>.
   Everything downstream of that URL is READ-ONLY: no palette, no drag, no
   save. Editing stays the Layout Designer desk's alone (see
   Admin/Layout Designer/js/designer.js) — this page only shows the same plan
   three ways: the 2D floor plan (js/plan2d.js), the 3D room (js/scene3d.js),
   and the walkthrough (js/simulate.js), exactly as the desk's own
   "▶ Simulate" button does.

   &people=0 additionally suppresses the crowd, and the app passes it (see
   lib/screens/user/layout_preview_page.dart): the animated guests are skinned
   FBX bodies that phones pay for in download, memory and frame rate, for a
   preview that is about the room. On the web the crowd loads as usual.

   ── Where the plan comes from ────────────────────────────────────────────
   Two sources, because the two contexts have very different auth stories:

   1. HANDED IN (the app). Flutter has already read `bookings/{id}` under the
      customer's own session to decide whether to offer this screen at all,
      so the layout is sitting in memory. It calls window.HPViewer.show(...)
      once the page is up. Nothing is fetched here, nothing is signed into,
      and no credential goes into a URL.

   2. FETCHED (a real browser). Opened as ?booking=<id>, the page uses the
      Firebase JS SDK's own persisted session — in a browser the customer is
      simply signed in — and reads `bookings/{id}` under the existing rule.

   There is deliberately no server-side token exchange. The old build minted a
   custom token from a Cloud Function because a WebView cannot inherit the
   app's native Firebase session — but that only mattered while the WebView
   was the thing doing the reading. Handing it the data instead removes the
   function, the Blaze-plan requirement, and an ID token that used to travel
   through a URL (where it lands in history and referrer headers). Firestore
   rules are untouched either way. */
(function () {
  "use strict";

  const statusEl = document.getElementById("lvStatus");
  const titleEl = document.getElementById("lvTitle");
  const subEl = document.getElementById("lvSub");
  const walkBtn = document.getElementById("lvWalkBtn");
  const host3d = document.getElementById("ld3dHost");
  const stage3d = document.getElementById("ldStage3d");
  const stage2d = document.getElementById("lvStage2d");
  const canvas2d = document.getElementById("lvCanvas");
  const tab2d = document.getElementById("lvTab2d");
  const tab3d = document.getElementById("lvTab3d");

  function setStatus(msg, isError) {
    if (!statusEl) return;
    if (!msg) { statusEl.hidden = true; return; }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    statusEl.style.color = isError ? "var(--danger)" : "";
  }

  const params = new URLSearchParams(location.search);
  const bookingId = params.get("booking");

  let layout = null;
  let clientName = "Your event";
  let pax = 0;
  let eventType = "";

  /* Take a booking-shaped object — the Firestore document, whether it was
     handed in by the app or read here — and stand it up. */
  function adopt(d) {
    const doc = d || {};
    const plan = doc.layout;
    if (!plan || !Array.isArray(plan.items) || !plan.items.length) {
      setStatus("No floor plan has been drawn for this event yet.", true);
      return;
    }
    layout = plan;
    clientName = doc.occasion || doc.eventName || "Your event";
    pax = Number(doc.pax || doc.headcount || 0) || 0;
    eventType = String(doc.eventType || "");
    render();
  }

  /* Source 1 — the app hands the plan in over a JS bridge. Exposed before any
     fetch is attempted so an early call can never be missed.

     Earlier still, index.html installs a queueing stub, because "before any
     fetch" is not early enough on its own: the app can call show() from
     onPageFinished before this file has run at all. Anything it banked is
     picked up here and replayed at the bottom of this IIFE. */
  const queued = (window.HPViewer && Array.isArray(window.HPViewer._q))
    ? window.HPViewer._q
    : [];

  window.HPViewer = {
    show: function (payload) {
      try {
        adopt(typeof payload === "string" ? JSON.parse(payload) : payload);
      } catch (e) {
        setStatus("Couldn't read your layout.", true);
      }
    },
  };

  /* Source 2 — a real browser. The SDK restores the customer's own session,
     and the read runs under the existing `bookings/{id}` rule.

     Deliberately a function called at the very BOTTOM of this file rather
     than a block that bails out here: the view-switching state and the tab
     listeners below still have to be set up in the app's case too, and an
     early `return` would skip them. */
  function fetchBooking() {
    if (typeof firebase === "undefined" || !window.firebaseConfigForViewer) {
      setStatus("Couldn't load Firebase — check your connection and try again.", true);
      return;
    }

    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfigForViewer);
    const auth = firebase.auth();
    const db = firebase.firestore();

    /* onAuthStateChanged, not currentUser: restoring a persisted session is
       asynchronous, and reading one tick after load reports "signed out" for
       a customer who is perfectly well signed in. */
    auth.onAuthStateChanged(function (user) {
      if (!user) {
        setStatus("Sign in to view this event's layout.", true);
        return;
      }
      db.collection("bookings").doc(bookingId).get()
        .then(function (doc) {
          if (!doc.exists) throw new Error("not-found");
          adopt(doc.data());
        })
        .catch(function () {
          setStatus("Couldn't load your layout — refresh, or try again later.", true);
        });
    });
  }

  /* Which stage is showing. The 3D canvas is only mounted the first time it
     is actually revealed: a WebGL context sized against a `hidden` element
     comes up 0×0 and stays blank, and mounting it eagerly also costs the
     member a renderer they may never look at. */
  let view = "2d";
  let mounted3d = false;
  let scene3dOk = true;

  function show(next) {
    view = next;
    const is3d = next === "3d";

    stage2d.hidden = is3d;
    stage3d.hidden = !is3d;
    tab2d.classList.toggle("is-on", !is3d);
    tab3d.classList.toggle("is-on", is3d);
    tab2d.setAttribute("aria-selected", String(!is3d));
    tab3d.setAttribute("aria-selected", String(is3d));

    // The walkthrough is a 3D affair; it has nothing to add to a floor plan.
    walkBtn.hidden = !is3d;

    if (!is3d) {
      if (window.HPPlan2D) window.HPPlan2D.resize();
      return;
    }
    if (!scene3dOk) return;

    if (!mounted3d) {
      window.HPScene.mount(host3d);
      window.HPScene.render(layout);
      mounted3d = true;
    }
    window.HPScene.resize();
  }

  function render() {
    titleEl.textContent = clientName;
    subEl.textContent = layout.room
      ? `${layout.room.w} m × ${layout.room.h} m room`
      : "";

    // 2D first — it is the default view and needs nothing but the DOM, so a
    // page where Three.js failed still shows the member their floor plan.
    if (window.HPPlan2D) {
      window.HPPlan2D.mount(canvas2d);
      window.HPPlan2D.render(layout);
    }
    setStatus(null);

    scene3dOk = !!(window.HPScene && window.HPScene.available());
    const canWalk = scene3dOk && window.HPSim && window.HPSim.available();
    walkBtn.disabled = !canWalk;
    if (!canWalk) walkBtn.textContent = "Walkthrough unavailable";

    if (!scene3dOk) {
      tab3d.disabled = true;
      tab3d.title = "The 3D view couldn't load — check your connection.";
    }
    show("2d");
  }

  tab2d.addEventListener("click", () => show("2d"));
  tab3d.addEventListener("click", () => { if (!tab3d.disabled) show("3d"); });

  walkBtn.addEventListener("click", () => {
    if (!layout || !window.HPSim || !window.HPSim.available()) return;
    window.HPSim.enter(layout, {
      pax,
      event: eventType,
      title: clientName,
      onExit: () => {
        window.HPScene.resize();
      },
    });
  });

  window.addEventListener("resize", () => {
    // Only the visible stage: HPScene sizes itself against a hidden host as
    // 0×0, and re-fitting the plan nobody is looking at buys nothing. show()
    // resizes whichever view is being switched to.
    if (view === "3d") {
      if (mounted3d && window.HPScene) window.HPScene.resize();
    } else if (window.HPPlan2D) {
      window.HPPlan2D.resize();
    }
  });

  /* Everything above is wiring; this is the one line that decides where the
     plan comes from. ?booking= means a browser fetching for itself; without
     it we sit on the loading note until the app calls HPViewer.show() —
     unless it already did, before this script ran, in which case the stub in
     index.html is holding the plan and we show it now.

     The drain belongs HERE and nowhere earlier. show() renders, and render()
     reaches `view` and `mounted3d`, which are declared partway down this
     file; replaying the queue up where HPViewer is defined would hit them in
     their temporal dead zone — the same ReferenceError an early `return`
     would cause, and just as invisible to a linter. */
  if (bookingId) fetchBooking();
  else if (queued.length) queued.forEach((p) => window.HPViewer.show(p));
  else setStatus("Loading your layout…");
})();
