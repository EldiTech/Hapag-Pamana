/* HapagPamana · Layout Designer — the drafting table.

   Every confirmed order needs a room dressed for it, and this desk draws
   where each piece stands: the round tables and their covers, the buffet
   line, the stage, the dance floor, the bar. The plan is drawn to scale over
   a metre grid the size of the venue, so what the drawing says is 1.5 m
   across is 1.5 m across on the night.

   The plan lives on the booking (bookings/{id}.layout) rather than in a
   collection of its own, so the crew dressing the room, the desk that drew it
   and the client's own record are all reading ONE document — the same reason
   the service floor keeps `fulfilment` there (see hp-fulfilment.js).

   layout = {
     room:      { w, h },            metres
     items:     [{ id, kind, label, x, y, w, h, rot, seats }],  metres/degrees
     updatedAt, updatedByName
   }

   This desk deliberately writes NOTHING but `layout`: the floor plan is not a
   place to move an order's status or its money, and firestore.rules pins that
   with hasOnly(['layout']).

   Requires the layout_designer (or admin/owner) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Layout Designer",
    sub: "The floor plan each confirmed event is dressed to.",
    search: true,
    action: null,
  });

  const chipsEl = document.getElementById("ldChips");
  const canvasEl = document.getElementById("ldCanvas");
  const emptyEl = document.getElementById("ldCanvasEmpty");
  const paletteEl = document.getElementById("ldPalette");
  const propsEl = document.getElementById("ldProps");
  const tallyEl = document.getElementById("ldTally");
  const dimXEl = document.getElementById("ldDimX");
  const dimYEl = document.getElementById("ldDimY");
  const nameEl = document.getElementById("ldEventName");
  const metaEl = document.getElementById("ldEventMeta");
  const savedEl = document.getElementById("ldSaved");
  const saveBtn = document.getElementById("ldSave");
  const roomBtn = document.getElementById("ldRoom");
  const printBtn = document.getElementById("ldPrint");
  const resetBtn = document.getElementById("ldReset");
  const fsBtn = document.getElementById("ldFullscreen");
  const pickBtn = document.getElementById("ldPick");
  const presetBtn = document.getElementById("ldPreset");
  const themeBtn = document.getElementById("ldTheme");
  const simBtn = document.getElementById("ldSimulate");
  const walkBtn = document.getElementById("ldWalk");
  const optBtn = document.getElementById("ldOptimise");
  const scnBtn = document.getElementById("ldScenarios");
  const evtBtn = document.getElementById("ldEvent");
  const stage2d = document.getElementById("ldStage2d");
  const stage3d = document.getElementById("ldStage3d");
  const host3d = document.getElementById("ld3dHost");
  const camsEl = document.getElementById("ldCams");
  const tabsEl = document.getElementById("ldViewTabs");
  const tab3d = document.getElementById("ldTab3d");
  const undoBtn = document.getElementById("ldUndo");
  const redoBtn = document.getElementById("ldRedo");
  const zoomSel = document.getElementById("ldZoom");
  const gridToggleBtn = document.getElementById("ldGridToggle");

  let zoomLevel = 1.0;

  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  /* ── The pieces a room is dressed with ─────────────────────────────────
     The catalogue now lives in js/rules.js (LAYOUT_RULES), because the same
     definitions are needed by the collision model, the 3D builders, the
     analysis and the optimiser — and a table's default size being written in
     four places is how those four drift apart.

     Sizes are the real thing in metres, so a plan drawn here measures on the
     floor: a 1.5 m round seats eight, a 1.8 × 0.75 m banquet table seats six.
     `seats` is what the piece adds to the cover count — a stage seats nobody.

     The fallback list is the ten kinds this desk shipped with, so a page
     where the rules file failed to load still draws a plan rather than an
     empty drawer. */
  const RULES = window.HPRules;
  const PIECES = (RULES && RULES.PIECES) || [
    { kind: "round",  icon: "roundTable", label: "Round Table",  shape: "round", w: 1.5, h: 1.5, seats: 8, group: "Tables" },
    { kind: "rect",   icon: "longTable",  label: "Long Table",   shape: "rect",  w: 1.8, h: 0.75, seats: 6, group: "Tables" },
    { kind: "buffet", icon: "buffet",     label: "Buffet",       shape: "rect",  w: 4.0, h: 0.8, seats: 0, group: "Catering" },
    { kind: "stage",  icon: "stage",      label: "Stage",        shape: "rect",  w: 6.0, h: 3.0, seats: 0, group: "Event" },
    { kind: "dance",  icon: "dance",      label: "Dance Floor",  shape: "rect",  w: 5.0, h: 5.0, seats: 0, group: "Event" },
    { kind: "bar",    icon: "cup",        label: "Bar",          shape: "rect",  w: 2.4, h: 0.8, seats: 0, group: "Catering" },
    { kind: "decor",  icon: "leaf",       label: "Decor",        shape: "round", w: 0.8, h: 0.8, seats: 0, group: "Event" },
    { kind: "door",   icon: "door",       label: "Doorway",      shape: "rect",  w: 0.9, h: 0.25, seats: 0, group: "Access" },
    { kind: "spawn",  icon: "pin",        label: "Start Point",  shape: "round", w: 0.6, h: 0.6, seats: 0, group: "Access" },
    { kind: "other",  icon: "box",        label: "Other",        shape: "rect",  w: 1.2, h: 1.2, seats: 0, group: "Access" },
  ];
  const PIECE_GROUPS = (RULES && RULES.GROUPS) || ["Tables", "Catering", "Event", "Access"];
  const pieceOf = (kind) => (RULES ? RULES.pieceOf(kind)
    : (PIECES.find((p) => p.kind === kind) || PIECES[PIECES.length - 1]));
  // A piece that never carries covers, whatever a stored document says.
  const noSeats = (kind) => {
    const d = pieceOf(kind);
    return !!d.noSeats || d.kind === "door" || d.kind === "spawn";
  };

  const DEFAULT_ROOM = { w: 24, h: 18 };
  const GRID = 0.25;      // pieces land on a quarter-metre, so plans stay tidy
  const MIN_SIDE = 0.3;   // metres — smaller than this is a smudge, not a piece
  const MAX_ROOM = 120;

  let orders = [];        // confirmed bookings
  let query = "";
  let filter = "todo";
  let loaded = false;
  let unsub = null;

  let current = null;     // the booking being drawn
  let room = Object.assign({}, DEFAULT_ROOM);
  let items = [];
  let selectedId = null;
  let dirty = false;
  let saving = false;
  let scale = 26;         // px per metre — recomputed to fit the panel
  let mode = "2d";        // which stage is showing
  let sceneReady = false; // the 3D renderer has been mounted

  /* ── History (Ctrl+Z / Ctrl+Y) and clipboard (Ctrl+C / Ctrl+V) ──────────
     One stack of whole-plan snapshots, not a diff log: the plan is small (a
     roomful of tables, not a document), so cloning `room` and `items` before
     each mutation costs nothing and never drifts from what a diff-and-replay
     approach could — undoing is just "the plan as it stood a moment ago". */
  const UNDO_LIMIT = 60;
  let undoStack = [];
  let redoStack = [];
  let clipboardItem = null;   // last copied piece, or null

  /* ── The dressing ─────────────────────────────────────────────────────
     A setup from the Content Moderator's gallery (Admin/Content Moderator)
     re-dresses the 3D room in that photograph's own colours — see
     js/theme.js for how they are read out of the image.

     What is SAVED on the plan is the setup's id and title, never the five
     extracted colours. Re-uploading a better photo of the same setup should
     re-dress every plan that chose it, and it does, because the colours are
     read afresh from the gallery each time rather than frozen into the
     booking the day the plan was drawn. */
  let setups = [];        // the visible gallery, read once
  let setupChoice = null; // { id, title } as stored on the plan

  /* ── The kind of function ─────────────────────────────────────────────
     What this room is being dressed for. It changes what the ANALYSIS asks
     of the plan (a conference wants wide aisles and a registration desk; a
     party wants a bar guests can reach) and which lighting the walkthrough
     opens under. It never forces a layout — §18 is explicit, and the whole
     point of this desk is that the designer draws the room.

     Guessed from the booking's own "kind of function" text when the plan
     doesn't say, so a designer who never opens the selector still gets an
     analysis pitched at the right event. */
  let eventType = (RULES && RULES.DEFAULT_EVENT) || "wedding";

  /* ── Scenarios ────────────────────────────────────────────────────────
     Saved alternatives of the SAME event's plan (§21) — "Layout A", "Layout
     B", "Final" — kept on the booking beside the live layout. Saving one
     copies the current room and items; loading one replaces them. The live
     plan is never overwritten without the designer pressing something. */
  let scenarios = [];

  /* The last analysis run on this plan, and whether the sheet is showing
     it. Held here so the report, the 2D overlay and the 3D overlay are three
     views of one object rather than three separate runs that could disagree. */
  let analysis = null;
  let analyzeOn = false;

  HP.shell.onSearch((q) => { query = q; renderChips(); if (!current) openPicker(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  /* ── Loading the confirmed orders ─────────────────────────────────────── */
  function boot() {
    handleHash();
    renderPalette();
    renderProps();
    renderTally();
    fitCanvas();
    // Nothing to stand up, analyse or walk through until an event is chosen.
    [tab3d, simBtn, walkBtn, optBtn, scnBtn, evtBtn]
      .forEach((b) => { if (b) b.disabled = true; });

    renderThemeBtn();

    if (!HP.ONLINE) {
      chipsEl.innerHTML = "";
      metaEl.textContent = "Events live in Firestore — connect Firebase to read them.";
      return;
    }

    // The setup gallery, fetched alongside the events. Not awaited: the plan
    // is drawable before the dressing is available, and a slow gallery must
    // not hold the desk shut.
    loadSetups().then(() => {
      // A plan opened before the gallery landed still gets its dressing.
      if (setupChoice) applySetup(setupChoice);
      renderThemeBtn();
    });
    unsub = db.collection("bookings").where("status", "==", "confirmed").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        orders = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((o) => !o.deleted);
        orders.sort(byFunctionDate);
        loaded = true;
        renderOverview();
        renderChips();
        // Keep the open plan in step with the live document — but never
        // overwrite unsaved drawing with a snapshot echo of the old one.
        if (current) {
          const fresh = orders.find((o) => o.id === current.id);
          if (fresh) {
            current = fresh;
            renderHead();
            if (!dirty) { loadPlan(fresh); }
          }
        }
      }, (e) => {
        const denied = e && (e.code === "permission-denied" ||
          /permission|insufficient/i.test(e.message || ""));
        statsEl.innerHTML = "";
        chipsEl.innerHTML = "";
        metaEl.textContent = denied
          ? "Your role can't read the confirmed events — publish the updated Firestore rules, then reload."
          : "Couldn't reach Firestore — check your connection.";
        if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
      });
  }
  window.addEventListener("beforeunload", (e) => {
    if (unsub) unsub();
    if (dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  // Soonest event first; undated events sink. MAX_SAFE_INTEGER rather than
  // Infinity — two undated events would compare Infinity - Infinity = NaN.
  const dateKey = (o) => {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  const byFunctionDate = (a, b) => dateKey(a) - dateKey(b);
  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";
  const paxOf = (o) => {
    const n = parseInt(String(o.pax || "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const planOf = (o) => (o && o.layout) || null;
  const isDrawn = (o) => {
    const l = planOf(o);
    return !!(l && Array.isArray(l.items) && l.items.length);
  };

  let activeNav = "overview";

  const overviewView = document.getElementById("ldOverviewView");
  const overviewSummary = document.getElementById("ldOverviewSummary");
  const overviewTableBody = document.getElementById("ldOverviewTableBody");

  function switchNav(navKey) {
    activeNav = navKey;
    const overviewEl = document.getElementById("ldOverviewView");
    const chipsContainer = document.getElementById("ldChips");
    const workContainer = document.querySelector(".ld-work");

    document.querySelectorAll("#sidebar .nav-item[data-view]").forEach((a) => {
      a.classList.toggle("active", a.dataset.view === navKey);
    });

    if (overviewEl) overviewEl.hidden = navKey !== "overview";
    if (chipsContainer) chipsContainer.hidden = navKey !== "designer";
    if (workContainer) workContainer.hidden = navKey !== "designer";
  }

  function handleHash() {
    const h = (window.location.hash || "#overview").replace("#", "").toLowerCase();
    const key = h === "designer" ? "designer" : "overview";
    switchNav(key);
  }

  window.addEventListener("hashchange", handleHash);

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-nav]");
    if (btn) {
      const key = btn.dataset.nav;
      window.location.hash = key;
      switchNav(key);
    }
    const sideLink = e.target.closest("#sidebar .nav-item[data-view]");
    if (sideLink) {
      const key = sideLink.dataset.view;
      if (key === "overview" || key === "designer") {
        window.location.hash = key;
        switchNav(key);
      }
    }
  });

  /* ── Overview Dashboard (database layout information) ───────────────── */
  function renderOverview() {
    if (!overviewSummary || !overviewTableBody) return;

    const drawn = orders.filter(isDrawn).length;
    const todo = orders.length - drawn;
    const covers = orders.filter(isDrawn)
      .reduce((n, o) => n + seatsOf(planOf(o).items), 0);
    const totalBooked = orders.reduce((n, o) => n + paxOf(o), 0);

    overviewSummary.innerHTML = `
      <div class="ld-overview-card">
        <span class="ld-overview-card-title">Total Events</span>
        <span class="ld-overview-card-val">${orders.length}</span>
        <span class="ld-overview-card-sub">${todo} awaiting layout plan</span>
      </div>
      <div class="ld-overview-card">
        <span class="ld-overview-card-title">Plans Drawn</span>
        <span class="ld-overview-card-val">${drawn}</span>
        <span class="ld-overview-card-sub">${Math.round((drawn / (orders.length || 1)) * 100)}% completed</span>
      </div>
      <div class="ld-overview-card">
        <span class="ld-overview-card-title">Covers Seated</span>
        <span class="ld-overview-card-val">${covers}</span>
        <span class="ld-overview-card-sub">Out of ${totalBooked || 0} booked guests</span>
      </div>
      <div class="ld-overview-card">
        <span class="ld-overview-card-title">Awaiting Plan</span>
        <span class="ld-overview-card-val">${todo}</span>
        <span class="ld-overview-card-sub">Needs floor plan dressing</span>
      </div>`;

    if (!orders.length) {
      overviewTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px;">No confirmed events found in database.</td></tr>`;
      return;
    }

    overviewTableBody.innerHTML = orders.map((o) => {
      const drawnFlag = isDrawn(o);
      const plan = planOf(o);
      const seated = drawnFlag ? seatsOf(plan.items) : 0;
      const booked = paxOf(o);
      const roomStr = plan && plan.room ? `${plan.room.w} × ${plan.room.h} m` : "Default (24 × 18 m)";
      const piecesCount = plan && Array.isArray(plan.items) ? plan.items.length : 0;

      return `
        <tr>
          <td>
            <div class="ld-overview-client">
              <strong>${HP.esc(clientName(o))}</strong>
              <small>${HP.esc(o.kindOfFunction || "General Event")}</small>
            </div>
          </td>
          <td>
            <div class="ld-overview-client">
              <strong>${HP.esc(o.functionDate || "Undated")}</strong>
              <small>${HP.esc(o.venue || "Main Venue")}</small>
            </div>
          </td>
          <td>
            <strong>${seated} / ${booked || "—"}</strong>
            <small style="display:block; font-size:0.75rem; color:var(--ink-soft);">${booked ? Math.min(100, Math.round((seated/booked)*100)) + "% seated" : ""}</small>
          </td>
          <td>
            <div>${roomStr}</div>
            <small style="color:var(--ink-soft);">${piecesCount} pieces on floor</small>
          </td>
          <td>
            ${drawnFlag 
              ? `<span class="badge badge-ok">Ready (${seated} seated)</span>`
              : `<span class="badge badge-muted">Awaiting Plan</span>`}
          </td>
          <td>
            <button class="btn btn-ghost btn-sm" data-open-event="${HP.esc(o.id)}">
              <span class="ic">${HP.icon("plan")}</span> Open in Designer
            </button>
          </td>
        </tr>`;
    }).join("");

    HP.hydrateIcons(overviewTableBody);

    overviewTableBody.querySelectorAll("[data-open-event]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const o = orders.find((x) => x.id === btn.dataset.openEvent);
        if (o) {
          chooseEvent(o);
          switchNav("designer");
        }
      });
    });

    HP.shell.setBadge(todo);
  }

  function renderChips() {
    const counts = {
      todo: orders.filter((o) => !isDrawn(o)).length,
      drawn: orders.filter(isDrawn).length,
      all: orders.length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("todo", "Awaiting a plan") + chip("drawn", "Drawn") +
      chip("all", "Every event") +
      `<span class="chip-sep"></span>
       <button class="chip-filter" id="ldChipPick"><span class="ic">${HP.icon("calendar")}</span>Choose event</button>`;
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); openPicker(); }));
    const cp = document.getElementById("ldChipPick");
    if (cp) cp.addEventListener("click", openPicker);
    HP.hydrateIcons(chipsEl);
  }

  function visible() {
    return orders.filter((o) => {
      if (filter === "todo" && isDrawn(o)) return false;
      if (filter === "drawn" && !isDrawn(o)) return false;
      if (!query) return true;
      return [o.clientName, o.kindOfFunction, o.venue, o.functionDate]
        .join(" ").toLowerCase().includes(query);
    });
  }

  /* ── Choosing the event to draw ───────────────────────────────────────── */
  function openPicker() {
    if (!HP.ONLINE) return HP.toast("Events live in Firestore — connect Firebase to read them.", "warn");
    if (!loaded) return HP.toast("Still loading the confirmed events…", "warn");
    const list = visible();
    const body = list.length
      ? `<div class="ld-events">${list.map((o) => `
          <button class="ld-event ${current && current.id === o.id ? "active" : ""}" data-id="${HP.esc(o.id)}">
            <span class="ld-prop-swatch"><span class="ic">${HP.icon(isDrawn(o) ? "plan" : "ruler")}</span></span>
            <span class="ld-event-text">
              <strong>${HP.esc(clientName(o))}</strong>
              <small>${HP.esc(o.functionDate || "No date")}${o.venue ? " · " + HP.esc(o.venue) : ""}${
                paxOf(o) ? " · " + paxOf(o) + " pax" : ""}</small>
            </span>
            ${isDrawn(o)
              ? `<span class="badge badge-ok">${seatsOf(planOf(o).items)} seated</span>`
              : `<span class="badge badge-muted">No plan</span>`}
          </button>`).join("")}</div>`
      : `<div class="ld-prop-empty"><span class="ic">${HP.icon("calendar")}</span>
           <p>${orders.length ? "Nothing matches this filter" : "No confirmed events yet"}</p></div>`;

    HP.openModal("Choose an event", body, `<button class="btn btn-ghost" data-close>Close</button>`);
    const modal = document.querySelector(".modal");
    HP.hydrateIcons(modal);
    modal.querySelectorAll(".ld-event").forEach((b) =>
      b.addEventListener("click", () => {
        const o = orders.find((x) => x.id === b.dataset.id);
        if (o) chooseEvent(o);
        HP.closeModal();
      }));
  }

  function chooseEvent(o) {
    if (dirty && !window.confirm("This plan has unsaved changes. Leave them?")) return;
    current = o;
    loadPlan(o);
    renderHead();
  }

  function loadPlan(o) {
    const l = planOf(o) || {};
    const r = l.room || {};
    room = {
      w: clamp(Number(r.w) || DEFAULT_ROOM.w, 2, MAX_ROOM),
      h: clamp(Number(r.h) || DEFAULT_ROOM.h, 2, MAX_ROOM),
    };
    items = (Array.isArray(l.items) ? l.items : []).map(sanitize).filter(Boolean);
    selectedId = null;

    /* The event type: what the plan says, else what the booking's own
       "kind of function" text suggests. Guessing rather than defaulting is
       what lets the analysis be useful on the hundreds of plans drawn before
       this field existed. */
    eventType = (RULES && RULES.EVENT_TYPES[String(l.eventType)])
      ? String(l.eventType)
      : (RULES ? RULES.guessEvent(o.kindOfFunction) : "wedding");

    // The saved alternatives, sanitised the same way the live plan is — a
    // scenario is a plan, and a hand-edited one must not be able to park a
    // table outside the room when it is loaded.
    scenarios = (Array.isArray(l.scenarios) ? l.scenarios : [])
      .slice(0, 12)
      .map((s) => (s && typeof s === "object" ? {
        id: String(s.id || newId()),
        name: String(s.name || "Untitled").slice(0, 40),
        savedAt: String(s.savedAt || ""),
        room: {
          w: clamp(Number(s.room && s.room.w) || DEFAULT_ROOM.w, 2, MAX_ROOM),
          h: clamp(Number(s.room && s.room.h) || DEFAULT_ROOM.h, 2, MAX_ROOM),
        },
        items: Array.isArray(s.items) ? s.items : [],
        metrics: s.metrics || null,
      } : null))
      .filter(Boolean);

    // A report from the previous event describes a room that is no longer
    // open. Dropped rather than re-run — running it is the designer's press.
    analysis = null;
    setAnalyze(false);
    // The dressing this plan was saved with. Applied through applySetup so a
    // plan whose setup has since been deleted or hidden falls back to the
    // house scheme rather than to a colour nobody can find in the gallery.
    const su = l.setup;
    applySetup(su && su.id ? { id: String(su.id), title: String(su.title || "") } : null);
    setDirty(false);
    [saveBtn, roomBtn, printBtn, resetBtn, tab3d, presetBtn, simBtn, walkBtn, themeBtn,
     optBtn, scnBtn, evtBtn]
      .forEach((b) => { if (b) b.disabled = false; });
    fitCanvas();
    renderProps();
    renderTally();
    // A new event while the 3D tab is open rebuilds the room under it, rather
    // than leaving the last event's floor standing.
    if (mode === "3d") show3d();
  }

  // A stored item is only trusted for its shape, never for its bounds — a
  // hand-edited document shouldn't be able to park a table outside the room.
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const def = pieceOf(String(raw.kind || ""));
    const w = clamp(Number(raw.w) || def.w, MIN_SIDE, MAX_ROOM);
    const h = clamp(Number(raw.h) || def.h, MIN_SIDE, MAX_ROOM);
    const out = {
      id: String(raw.id || newId()),
      kind: def.kind,
      label: String(raw.label || def.label).slice(0, 40),
      x: clamp(Number(raw.x) || 0, 0, Math.max(0, room.w - w)),
      y: clamp(Number(raw.y) || 0, 0, Math.max(0, room.h - h)),
      w, h,
      rot: ((Number(raw.rot) || 0) % 360 + 360) % 360,
      // A doorway or a start point can never carry covers, whatever a
      // hand-edited document says — otherwise a stray value there would be
      // counted against the booked headcount.
      seats: noSeats(def.kind) ? 0 : clamp(Math.round(Number(raw.seats) || 0), 0, 99),
    };
    /* Which chair a table wears. Written only when the piece is one that
       takes chairs AND a type was stored: an absent `chair` is what every
       plan drawn before chair types existed has, and it must keep meaning
       "the house's banquet chair" rather than becoming a null on the record. */
    if (raw.chair && RULES && RULES.CHAIRS[String(raw.chair)] && def.seatRule) {
      out.chair = String(raw.chair);
    }
    return out;
  }

  function renderHead() {
    if (!current) {
      nameEl.textContent = "No event chosen";
      metaEl.textContent = "Pick an event to start drawing";
      return;
    }
    nameEl.textContent = clientName(current);
    const bits = [current.kindOfFunction, current.functionDate, current.venue]
      .map((s) => String(s || "").trim()).filter(Boolean);
    if (paxOf(current)) bits.push(paxOf(current) + " pax");
    metaEl.textContent = bits.join(" · ") || "—";
  }

  /* ── The palette ──────────────────────────────────────────────────────
     Grouped, because twenty-five kinds in one flat run is a wall nobody
     reads. The groups are the catalogue's own — Tables, Catering, Event,
     Access — and the drawer opens with Tables expanded, since that is what
     the first click on an empty plan is always for. */
  let openGroups = { Tables: true, Catering: true, Event: false, Access: false };

  function renderPalette() {
    const byGroup = Object.create(null);
    PIECES.forEach((p) => {
      const g = p.group || "Access";
      (byGroup[g] = byGroup[g] || []).push(p);
    });
    paletteEl.innerHTML = PIECE_GROUPS.filter((g) => byGroup[g]).map((g) => `
      <div class="ld-pal-group${openGroups[g] ? " is-open" : ""}" data-group="${HP.esc(g)}">
        <button class="ld-pal-head" data-toggle="${HP.esc(g)}">
          <span>${HP.esc(g)}</span>
          <small>${byGroup[g].length}</small>
        </button>
        <div class="ld-pal-items"${openGroups[g] ? "" : " hidden"}>
          ${byGroup[g].map((p) => `
            <button class="ld-piece" data-kind="${p.kind}" title="${HP.esc(p.label)} · ${p.w}×${p.h} m">
              <span class="ic">${HP.icon(p.icon)}</span>${HP.esc(p.label)}
            </button>`).join("")}
        </div>
      </div>`).join("");
    HP.hydrateIcons(paletteEl);
    paletteEl.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", () => {
        const g = b.dataset.toggle;
        openGroups[g] = !openGroups[g];
        renderPalette();
      }));
    paletteEl.querySelectorAll("[data-kind]").forEach((b) =>
      b.addEventListener("click", () => addPiece(b.dataset.kind)));
  }

  function addPiece(kind) {
    if (!current) return HP.toast("Choose an event first.", "warn");
    const def = pieceOf(kind);
    /* Some pieces there can only be one of. A room has one place the
       walkthrough starts from — a second start point would make "where does
       the visitor appear" a matter of which one the simulator happened to
       find first. The catalogue marks them `unique`. */
    if (def.unique && items.some((i) => i.kind === kind)) {
      const existing = items.find((i) => i.kind === kind);
      select(existing.id);
      return HP.toast(`There's already a ${def.label.toLowerCase()} — drag it where you want it.`, "warn");
    }
    // Drop it just clear of whatever is already there, so a run of clicks
    // lays pieces out in a readable stagger rather than one on top of another.
    const n = items.filter((i) => i.kind === kind).length;
    const step = snap(def.w + 0.5);
    const perRow = Math.max(1, Math.floor((room.w - 1) / step));
    const x = clamp(0.5 + (n % perRow) * step, 0, Math.max(0, room.w - def.w));
    const y = clamp(0.5 + Math.floor(n / perRow) * snap(def.h + 0.5), 0, Math.max(0, room.h - def.h));

    pushUndo();
    const item = {
      id: newId(), kind: def.kind, label: def.label,
      x, y, w: def.w, h: def.h, rot: 0, seats: def.seats,
    };
    items.push(item);
    selectedId = item.id;
    setDirty(true);
    drawItems();
    renderProps();
    renderTally();
  }

  /* ── The canvas ───────────────────────────────────────────────────────── */
  // The room is drawn to whatever scale fits the panel, so a 24 m ballroom and
  // a 9 m function room both fill the sheet instead of one overflowing it.
  function fitCanvas() {
    const stage = canvasEl.closest(".ld-stage");
    const avail = Math.max(320, (stage ? stage.clientWidth : 900) - 60 - 22);
    // Budget off where the stage actually sits, not a flat share of the
    // window — the stat strip, chip row and plan header above it all eat
    // into the same viewport, and their heights change with content (e.g.
    // an event with a long address wraps the header to two lines).
    const bottomPad = document.body.classList.contains("ld-fullscreen") ? 16 : 40;
    const stageTop = stage ? stage.getBoundingClientRect().top : 260;
    const maxH = Math.max(260, Math.round(window.innerHeight - stageTop - bottomPad));
    scale = Math.max(8, Math.min(avail / room.w, maxH / room.h)) * zoomLevel;

    canvasEl.style.width = room.w * scale + "px";
    canvasEl.style.height = room.h * scale + "px";
    canvasEl.style.backgroundSize = `${scale}px ${scale}px, ${scale}px ${scale}px`;
    dimXEl.textContent = fmtM(room.w);
    dimYEl.textContent = fmtM(room.h);
    drawItems();
  }
  window.addEventListener("resize", debounce(fitCanvas, 150));

  if (undoBtn) undoBtn.addEventListener("click", undo);
  if (redoBtn) redoBtn.addEventListener("click", redo);
  if (gridToggleBtn) gridToggleBtn.addEventListener("click", () => {
    canvasEl.classList.toggle("no-grid");
    gridToggleBtn.classList.toggle("active");
  });
  if (zoomSel) zoomSel.addEventListener("change", () => {
    zoomLevel = parseFloat(zoomSel.value) || 1.0;
    fitCanvas();
  });

  function drawItems() {
    // Keep the empty-state note, replace everything else.
    canvasEl.querySelectorAll(".ld-item").forEach((el) => el.remove());
    emptyEl.hidden = !!items.length || !current;
    if (!current) {
      emptyEl.hidden = false;
      emptyEl.querySelector("p").textContent =
        "Choose a confirmed event, then add pieces from the right.";
    } else if (!items.length) {
      emptyEl.querySelector("p").textContent =
        "An empty floor — add tables and fixtures from the right.";
    }

    items.forEach((it) => canvasEl.appendChild(itemEl(it)));

    /* The analysis marks are painted onto these very elements, so redrawing
       the plan throws them away. Re-applied here rather than re-run: the
       report still describes this plan unless the plan CHANGED, and the
       callers that change it re-run it themselves. */
    if (analyzeOn && analysis) drawAnalysis();
    else scheduleLiveWarnings();
  }

  function itemEl(it) {
    const def = pieceOf(it.kind);
    const el = document.createElement("div");
    el.className = "ld-item ld-item--" + def.shape + (it.id === selectedId ? " selected" : "");
    el.dataset.id = it.id;
    el.dataset.kind = it.kind;
    el.tabIndex = 0;
    place(el, it);
    el.innerHTML = `
      <span class="ld-item-body">
        <span class="ld-item-label">${HP.esc(it.label)}</span>
        ${it.seats ? `<span class="ld-item-seats">${it.seats}</span>` : ""}
      </span>
      <span class="ld-grip ld-grip--rot" data-grip="rot" title="Rotate"></span>
      <span class="ld-grip ld-grip--size" data-grip="size" title="Resize"></span>`;
    wireItem(el, it);
    return el;
  }

  function place(el, it) {
    el.style.left = it.x * scale + "px";
    el.style.top = it.y * scale + "px";
    el.style.width = it.w * scale + "px";
    el.style.height = it.h * scale + "px";
    el.style.transform = it.rot ? `rotate(${it.rot}deg)` : "";
    el.classList.toggle("is-tiny", Math.min(it.w, it.h) * scale < 54);
  }

  /* Drag to move, grips to resize and rotate. All three run on pointer events
     so a pen or a finger drives the plan the same way a mouse does; the piece
     is written back in metres, snapped to the grid, and clamped inside the
     room — a table half in the corridor is not a plan. */
  function wireItem(el, it) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const grip = e.target.closest("[data-grip]");
      e.preventDefault();
      select(it.id);

      const startX = e.clientX, startY = e.clientY;
      const from = { x: it.x, y: it.y, w: it.w, h: it.h, rot: it.rot };
      const rect = canvasEl.getBoundingClientRect();
      const mode = grip ? grip.dataset.grip : "move";
      let moved = false;

      el.setPointerCapture(e.pointerId);
      if (mode === "move") el.classList.add("dragging");

      const onMove = (ev) => {
        const dx = (ev.clientX - startX) / scale;
        const dy = (ev.clientY - startY) / scale;
        if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 2) return;
        if (!moved) pushUndo();      // once, for the state just before this drag
        moved = true;

        if (mode === "move") {
          it.x = clamp(snap(from.x + dx), 0, Math.max(0, room.w - it.w));
          it.y = clamp(snap(from.y + dy), 0, Math.max(0, room.h - it.h));
        } else if (mode === "size") {
          // A round piece stays round — dragging its grip changes the diameter.
          const shape = pieceOf(it.kind).shape;
          const w = clamp(snap(from.w + dx), MIN_SIDE, room.w - it.x);
          const h = shape === "round" ? w : clamp(snap(from.h + dy), MIN_SIDE, room.h - it.y);
          it.w = w;
          it.h = clamp(h, MIN_SIDE, room.h - it.y);
        } else {
          // Rotate about the piece's own centre; hold Shift for 15° steps.
          const cx = rect.left + (it.x + it.w / 2) * scale;
          const cy = rect.top + (it.y + it.h / 2) * scale;
          let deg = Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI + 90;
          deg = ((deg % 360) + 360) % 360;
          it.rot = ev.shiftKey ? Math.round(deg / 15) * 15 % 360 : Math.round(deg);
        }
        place(el, it);
        syncPropInputs(it);
      };
      const onUp = () => {
        el.releasePointerCapture(e.pointerId);
        el.classList.remove("dragging");
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        if (moved) { setDirty(true); renderProps(); }
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });

    // Keyboard nudging, so a plan can be tidied without a steady hand.
    el.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey)) return;   // Ctrl+Z/C/V etc. — the document handler's job
      const step = e.shiftKey ? 1 : GRID;
      let handled = true;
      if (e.key === "ArrowLeft") { pushUndo(); it.x = clamp(snap(it.x - step), 0, room.w - it.w); }
      else if (e.key === "ArrowRight") { pushUndo(); it.x = clamp(snap(it.x + step), 0, room.w - it.w); }
      else if (e.key === "ArrowUp") { pushUndo(); it.y = clamp(snap(it.y - step), 0, room.h - it.h); }
      else if (e.key === "ArrowDown") { pushUndo(); it.y = clamp(snap(it.y + step), 0, room.h - it.h); }
      else if (e.key === "Delete" || e.key === "Backspace") { removeItem(it.id); return; }
      else handled = false;
      if (!handled) return;
      e.preventDefault();
      place(el, it);
      setDirty(true);
      syncPropInputs(it);
    });
  }

  canvasEl.addEventListener("pointerdown", (e) => {
    if (e.target === canvasEl || e.target === emptyEl) select(null);
  });

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    canvasEl.querySelectorAll(".ld-item").forEach((el) =>
      el.classList.toggle("selected", el.dataset.id === id));
    renderProps();
  }

  function removeItem(id) {
    const el = canvasEl.querySelector(`.ld-item[data-id="${CSS.escape(id)}"]`);
    pushUndo();
    items = items.filter((i) => i.id !== id);
    if (selectedId === id) selectedId = null;
    HP.animateOut(el).then(() => { drawItems(); renderProps(); renderTally(); });
    setDirty(true);
  }

  /* ── Properties of the selected piece ─────────────────────────────────── */
  function renderProps() {
    const it = items.find((i) => i.id === selectedId);
    if (!it) {
      propsEl.innerHTML = `
        <div class="ld-prop-empty">
          <span class="ic">${HP.icon("pin")}</span>
          <p>${current ? "Select a piece on the plan" : "No event chosen"}</p>
        </div>`;
      HP.hydrateIcons(propsEl);
      return;
    }
    const def = pieceOf(it.kind);
    const round = def.shape === "round";
    // A doorway seats nobody and a start point is a position — offering
    // either a "seats" box invites a number that would then be counted
    // against the booked headcount.
    const seatable = !noSeats(it.kind);
    // What this table's own geometry comfortably takes. Shown beside the
    // seats box so a designer typing twelve into a 1.5 m round is told, at
    // the moment they type it, that eight is what fits.
    const able = RULES && def.seatRule ? RULES.capacityOf(it) : 0;
    // Chair types are offered only where chairs are actually drawn.
    const chairable = !!(RULES && def.seatRule);
    propsEl.innerHTML = `
      <div class="ld-props ld-prop">
        <div class="ld-prop-id">
          <span class="ld-prop-swatch"><span class="ic">${HP.icon(def.icon)}</span></span>
          <div>
            <strong>${HP.esc(it.label)}</strong>
            <small>${fmtM(it.w)}${round ? " diameter" : " × " + fmtM(it.h)}${
              it.seats ? " · " + it.seats + " pax" : ""}</small>
          </div>
        </div>

        <div class="field">
          <label for="ldLabel">Label</label>
          <input class="control" id="ldLabel" maxlength="40" value="${HP.esc(it.label)}" />
        </div>

        <div class="ld-prop-row">
          <div class="field">
            <label for="ldW">${round ? "Diameter (m)" : "Width (m)"}</label>
            <input class="control" id="ldW" type="number" min="${MIN_SIDE}" max="${MAX_ROOM}" step="0.05" value="${round2(it.w)}" />
          </div>
          <div class="field">
            <label for="ldH">${round && seatable ? "Seats" : "Depth (m)"}</label>
            ${round && seatable
              ? `<input class="control" id="ldSeatsAlt" type="number" min="0" max="99" step="1" value="${it.seats}" />`
              : `<input class="control" id="ldH" type="number" min="${MIN_SIDE}" max="${MAX_ROOM}" step="0.05" value="${round2(it.h)}" />`}
          </div>
        </div>

        <div class="ld-prop-row">
          <div class="field">
            <label for="ldX">Position X (m)</label>
            <input class="control" id="ldX" type="number" min="0" max="${MAX_ROOM}" step="${GRID}" value="${round2(it.x)}" />
          </div>
          <div class="field">
            <label for="ldY">Position Y (m)</label>
            <input class="control" id="ldY" type="number" min="0" max="${MAX_ROOM}" step="${GRID}" value="${round2(it.y)}" />
          </div>
        </div>

        ${round || !seatable ? "" : `
          <div class="field">
            <label for="ldSeats">Seats</label>
            <input class="control" id="ldSeats" type="number" min="0" max="99" step="1" value="${it.seats}" />
          </div>`}

        ${able ? `<p class="ld-prop-hint" id="ldCapHint">${
          it.seats > able + 1
            ? `<b class="is-short">Tight.</b> A ${fmtM(it.w)} ${HP.esc(def.label.toLowerCase())} seats about ${able}.`
            : `Comfortably seats ${able} at this size.`}</p>` : ""}

        ${chairable ? `
          <div class="field">
            <label for="ldChair">Chairs</label>
            <select class="control" id="ldChair">
              ${RULES.CHAIR_NAMES.map((n) => `
                <option value="${n}"${(it.chair || RULES.DEFAULT_CHAIR) === n ? " selected" : ""}>${
                  HP.esc(RULES.CHAIRS[n].label)}</option>`).join("")}
            </select>
          </div>` : ""}

        <div class="field">
          <label for="ldRot">Rotation</label>
          <div class="ld-rot">
            <input id="ldRot" type="range" min="0" max="359" step="1" value="${Math.round(it.rot)}" />
            <b id="ldRotVal">${Math.round(it.rot)}°</b>
          </div>
        </div>

        <div class="card-foot card-foot--stack">
          <button class="btn btn-ghost btn-sm" id="ldDup"><span class="ic">${HP.icon("plus")}</span>Duplicate</button>
          <button class="btn btn-danger btn-sm" id="ldDel"><span class="ic">${HP.icon("trash")}</span>Delete item</button>
        </div>
      </div>`;
    HP.hydrateIcons(propsEl);
    // `round && seatable` — a round piece only locks width to height when it
    // is a table. A start point is round but is sized freely, and its depth
    // box must therefore be wired like any rectangle's.
    wireProps(it, round && seatable);
  }

  function wireProps(it, round) {
    const el = () => canvasEl.querySelector(`.ld-item[data-id="${CSS.escape(it.id)}"]`);
    const redraw = () => { const e = el(); if (e) place(e, it); };

    /* One undo step per edit SESSION on a field, not one per keystroke —
       typing "1.5" into a width box is one change to undo, not four. Armed
       on focus, fired on the field's first input, and re-armed on blur so
       the next time the designer clicks back in, it snapshots again. */
    const armOnFocus = (input) => {
      let armed = true;
      input.addEventListener("focus", () => { armed = true; });
      input.addEventListener("blur", () => { armed = true; });
      return () => { if (armed) { pushUndo(); armed = false; } };
    };

    const num = (id, apply) => {
      const input = document.getElementById(id);
      if (!input) return;
      const snapshotOnce = armOnFocus(input);
      input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) return;
        snapshotOnce();
        apply(v);
        redraw();
        setDirty(true);
        renderTally();
      });
    };

    const label = document.getElementById("ldLabel");
    const labelSnap = armOnFocus(label);
    label.addEventListener("input", () => {
      labelSnap();
      it.label = label.value.slice(0, 40);
      const e = el();
      if (e) e.querySelector(".ld-item-label").textContent = it.label;
      setDirty(true);
    });

    num("ldW", (v) => {
      it.w = clamp(v, MIN_SIDE, room.w);
      if (round) it.h = it.w;
      it.x = clamp(it.x, 0, Math.max(0, room.w - it.w));
      it.y = clamp(it.y, 0, Math.max(0, room.h - it.h));
    });
    num("ldH", (v) => {
      it.h = clamp(v, MIN_SIDE, room.h);
      it.y = clamp(it.y, 0, Math.max(0, room.h - it.h));
    });
    num("ldX", (v) => { it.x = clamp(v, 0, Math.max(0, room.w - it.w)); });
    num("ldY", (v) => { it.y = clamp(v, 0, Math.max(0, room.h - it.h)); });

    const seats = document.getElementById("ldSeats") || document.getElementById("ldSeatsAlt");
    if (seats) {
      const seatsSnap = armOnFocus(seats);
      seats.addEventListener("input", () => {
        seatsSnap();
        const v = parseInt(seats.value, 10);
        it.seats = clamp(Number.isFinite(v) ? v : 0, 0, 99);
        const e = el();
        if (e) {
          const s = e.querySelector(".ld-item-seats");
          if (it.seats && s) s.textContent = String(it.seats);
          else if (it.seats && !s) drawItems();
          else if (!it.seats && s) s.remove();
        }
        setDirty(true);
        renderTally();
      });
    }

    /* The chair type. Changing it re-renders the 3D view if it is open —
       the 2D sheet draws a table's footprint, which a chair type does not
       change, so nothing on the plan itself moves. */
    const chairSel = document.getElementById("ldChair");
    if (chairSel) chairSel.addEventListener("change", () => {
      pushUndo();
      it.chair = chairSel.value;
      setDirty(true);
      if (mode === "3d") show3d();
    });

    const rot = document.getElementById("ldRot");
    const rotVal = document.getElementById("ldRotVal");
    const rotSnap = armOnFocus(rot);
    rot.addEventListener("input", () => {
      rotSnap();
      it.rot = Number(rot.value) || 0;
      rotVal.textContent = Math.round(it.rot) + "°";
      redraw();
      setDirty(true);
    });

    document.getElementById("ldDel").addEventListener("click", () => removeItem(it.id));
    document.getElementById("ldDup").addEventListener("click", () => {
      pushUndo();
      const copy = Object.assign({}, it, {
        id: newId(),
        x: clamp(snap(it.x + it.w + 0.5), 0, Math.max(0, room.w - it.w)),
      });
      items.push(copy);
      selectedId = copy.id;
      setDirty(true);
      drawItems();
      renderProps();
      renderTally();
    });
  }

  // Dragging on the canvas moves the numbers in the drawer too — the two are
  // one control, shown twice.
  function syncPropInputs(it) {
    if (it.id !== selectedId) return;
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    set("ldX", round2(it.x));
    set("ldY", round2(it.y));
    set("ldW", round2(it.w));
    set("ldH", round2(it.h));
    set("ldRot", Math.round(it.rot));
    const rv = document.getElementById("ldRotVal");
    if (rv) rv.textContent = Math.round(it.rot) + "°";
  }

  /* ── The cover count ──────────────────────────────────────────────────── */
  const seatsOf = (list) => (Array.isArray(list) ? list : [])
    .reduce((n, i) => n + (Number(i.seats) || 0), 0);

  function renderTally() {
    const seated = seatsOf(items);
    const booked = current ? paxOf(current) : 0;
    // Doors and start points are fixtures of the room, not pieces set out in
    // it — counting them under "pieces on the floor" would tell the crew to
    // carry in a doorway.
    const furniture = items.filter((i) => i.kind !== "door" && i.kind !== "spawn").length;
    const pct = booked ? Math.min(100, Math.round((seated / booked) * 100)) : (seated ? 100 : 0);
    const short = booked && seated < booked;

    tallyEl.innerHTML = `
      <div class="ld-tally">
        <div class="ld-tally-row"><span>Seated by this plan</span><strong>${seated}</strong></div>
        <div class="ld-tally-bar ${short ? "is-short" : ""}"><span style="width:${pct}%"></span></div>
        <div class="ld-tally-row"><span>Booked headcount</span><strong>${booked || "—"}</strong></div>
        <p class="ld-tally-note ${short ? "is-short" : ""}">${
          !current ? "No event chosen."
          : !booked ? "This booking records no headcount."
          : short ? `${booked - seated} guest${booked - seated === 1 ? "" : "s"} still without a seat.`
          : `Seats every guest, with ${seated - booked} to spare.`}</p>
        <div class="ld-tally-row"><span>Pieces on the floor</span><strong>${furniture}</strong></div>
        <div class="ld-tally-row"><span>Room</span><strong>${fmtM(room.w)} × ${fmtM(room.h)}</strong></div>
      </div>`;
  }

  /* ── Room size ────────────────────────────────────────────────────────── */
  roomBtn.addEventListener("click", () => {
    if (!current) return;
    HP.openModal("Room size", `
      <p class="modal-text">The venue's usable floor, in metres. Everything on the
        plan is drawn to this — pieces already outside the new bounds are pulled back in.</p>
      <div class="field-row" style="margin-top:16px">
        <div class="field">
          <label for="ldRoomW">Width (m)</label>
          <input class="control" id="ldRoomW" type="number" min="2" max="${MAX_ROOM}" step="0.5" value="${round2(room.w)}" />
        </div>
        <div class="field">
          <label for="ldRoomH">Depth (m)</label>
          <input class="control" id="ldRoomH" type="number" min="2" max="${MAX_ROOM}" step="0.5" value="${round2(room.h)}" />
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="ldRoomOk">Apply</button>`);
    document.getElementById("ldRoomOk").addEventListener("click", () => {
      const w = clamp(parseFloat(document.getElementById("ldRoomW").value) || room.w, 2, MAX_ROOM);
      const h = clamp(parseFloat(document.getElementById("ldRoomH").value) || room.h, 2, MAX_ROOM);
      room = { w, h };
      items.forEach((it) => {
        it.w = Math.min(it.w, room.w);
        it.h = Math.min(it.h, room.h);
        it.x = clamp(it.x, 0, Math.max(0, room.w - it.w));
        it.y = clamp(it.y, 0, Math.max(0, room.h - it.h));
      });
      HP.closeModal();
      setDirty(true);
      fitCanvas();
      renderProps();
      renderTally();
    });
  });

  pickBtn.addEventListener("click", openPicker);
  printBtn.addEventListener("click", () => window.print());
  // Clears every piece off the floor (room size untouched) so the drafting
  // starts over from an empty sheet. Undoable like any other edit, and — like
  // every edit here — only reaches the booking once Save is pressed.
  resetBtn.addEventListener("click", () => {
    if (!current) return;
    if (!items.length) return;
    if (!window.confirm("Clear every piece off the floor? This can be undone with Ctrl+Z until you save.")) return;
    pushUndo();
    items = [];
    selectedId = null;
    drawItems();
    renderProps();
    renderTally();
    setDirty(true);
  });

  /* ── Fullscreen ───────────────────────────────────────────────────────────
     Hands .ld-work to the Fullscreen API; ld-fullscreen (CSS) hides the
     sidebar/topbar/stat strip around it, same layout either way. */
  const workEl = document.querySelector(".ld-work");
  const setFsIcon = (on) => {
    fsBtn.querySelector(".ic").dataset.icon = on ? "contract" : "expand";
    HP.hydrateIcons(fsBtn);
    fsBtn.title = on ? "Exit fullscreen" : "Fullscreen";
    fsBtn.setAttribute("aria-label", fsBtn.title);
  };
  const applyFsState = (on) => {
    document.body.classList.toggle("ld-fullscreen", on);
    setFsIcon(on);
    fitCanvas();
    if (mode === "3d" && sceneReady && window.HPScene) window.HPScene.resize();
  };
  document.addEventListener("fullscreenchange", () => {
    applyFsState(document.fullscreenElement === workEl);
  });
  fsBtn.addEventListener("click", () => {
    // Once the CSS-only fallback is active there is no fullscreenElement to
    // exit, so the class itself is the source of truth for which way to go.
    if (document.body.classList.contains("ld-fullscreen")) {
      if (document.fullscreenElement) document.exitFullscreen();
      else applyFsState(false);
      return;
    }
    if (workEl.requestFullscreen) {
      workEl.requestFullscreen().catch(() => applyFsState(true));
    } else {
      applyFsState(true);
    }
  });

  /* ── Saving ───────────────────────────────────────────────────────────────
     One merge write of `layout` and nothing else — the field the rules allow
     this desk, and the field the crew reads off the booking. */
  saveBtn.addEventListener("click", save);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }

    // Typing in a text field (the label box, the client search, a modal's
    // own inputs) — Ctrl+Z/C/V there means "undo my typing" and "copy my
    // text", the browser's own job, not the plan's. Left alone whenever
    // focus is on an editable element.
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing) return;
    if (!current) return;

    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && k === "z") { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && (k === "y" || (e.shiftKey && k === "z"))) { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && k === "c") { e.preventDefault(); copySelected(); }
    else if ((e.ctrlKey || e.metaKey) && k === "v") { e.preventDefault(); pasteClipboard(); }
  });

  async function save() {
    if (!current || saving) return;
    if (!HP.ONLINE) return HP.toast("Offline — the plan can't be saved.", "warn");
    saving = true;
    setSaved("saving");
    saveBtn.disabled = true;
    try {
      await db.collection("bookings").doc(current.id).set({
        layout: {
          room: { w: round2(room.w), h: round2(room.h) },
          items: items.map((i) => {
            const rec = {
              id: i.id, kind: i.kind, label: i.label,
              x: round2(i.x), y: round2(i.y), w: round2(i.w), h: round2(i.h),
              rot: Math.round(i.rot), seats: i.seats,
            };
            // Only written when it is set — see sanitize(). Firestore has no
            // reason to carry a null on every doorway in the room.
            if (i.chair) rec.chair = i.chair;
            return rec;
          }),
          seated: seatsOf(items),
          // The kind of function this room is dressed for. Drives the
          // analysis's expectations and the walkthrough's opening lighting;
          // guessed from the booking when the designer never chose one.
          eventType: eventType,
          // The saved scenarios (§21). Held on the same document as the plan
          // so a layout and its alternatives travel together — see saveScenario.
          scenarios: scenarios.map((s) => ({
            id: s.id, name: s.name, savedAt: s.savedAt,
            room: s.room, items: s.items, metrics: s.metrics || null,
          })),
          // The chosen setup by reference, not by colour — see the note on
          // `setupChoice`. `null` clears it back to the house scheme.
          setup: setupChoice ? { id: setupChoice.id, title: setupChoice.title } : null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByName: HP.user.name || "—",
        },
      }, { merge: true });
      setDirty(false);
      HP.toast("Floor plan saved.", "ok");
    } catch (e) {
      console.warn("HapagPamana: layout write —", e);
      setSaved("dirty");
      HP.toast(e && e.code === "permission-denied"
        ? "Your role can't save a plan on this event."
        : "Couldn't save — check your connection.", "danger");
    } finally {
      saving = false;
      saveBtn.disabled = false;
    }
  }

  function setDirty(v) {
    dirty = v;
    setSaved(v ? "dirty" : "saved");
    if (v) scheduleLiveWarnings();
  }

  /* ── Undo / redo ──────────────────────────────────────────────────────
     Call BEFORE a mutation, not after: the stack holds what the plan looked
     like a moment ago, so undo can hand it straight back. A redo history is
     only worth keeping until the designer diverges from it — the next fresh
     edit after an undo clears it, same as every other editor. */
  function cloneItems(list) { return list.map((it) => Object.assign({}, it)); }

  function pushUndo() {
    undoStack.push({ room: Object.assign({}, room), items: cloneItems(items) });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
  }

  function restoreSnapshot(state) {
    room = Object.assign({}, state.room);
    items = cloneItems(state.items);
    selectedId = (items.find((i) => i.id === selectedId) || {}).id || null;
    fitCanvas();
    renderProps();
    renderTally();
    setDirty(true);
  }

  function undo() {
    if (!undoStack.length) return HP.toast("Nothing to undo.", "warn");
    redoStack.push({ room: Object.assign({}, room), items: cloneItems(items) });
    restoreSnapshot(undoStack.pop());
    HP.toast("Undone.", "ok");
  }

  function redo() {
    if (!redoStack.length) return HP.toast("Nothing to redo.", "warn");
    undoStack.push({ room: Object.assign({}, room), items: cloneItems(items) });
    restoreSnapshot(redoStack.pop());
    HP.toast("Redone.", "ok");
  }

  /* ── Copy / paste ─────────────────────────────────────────────────────
     A clipboard of one piece, held in memory rather than the system
     clipboard: the plan's own coordinate space (metres, snapped to the
     room's grid) means a paste from THIS room onto another is exactly what
     Duplicate already does, and going through the OS clipboard would only
     add a permission prompt for the same result. */
  function copySelected() {
    const it = items.find((i) => i.id === selectedId);
    if (!it) return HP.toast("Select a piece to copy first.", "warn");
    clipboardItem = Object.assign({}, it);
    HP.toast(`Copied ${it.label}.`, "ok");
  }

  function pasteClipboard() {
    if (!clipboardItem) return HP.toast("Nothing copied yet.", "warn");
    // The same "only one of these" rule addPiece enforces — a pasted second
    // start point would leave the walkthrough choosing between two.
    const def = pieceOf(clipboardItem.kind);
    if (def.unique && items.some((i) => i.kind === clipboardItem.kind)) {
      return HP.toast(`There's already a ${def.label.toLowerCase()} on this plan.`, "warn");
    }
    pushUndo();
    const copy = Object.assign({}, clipboardItem, {
      id: newId(),
      x: clamp(snap(clipboardItem.x + clipboardItem.w + 0.5), 0, Math.max(0, room.w - clipboardItem.w)),
      y: clamp(snap(clipboardItem.y), 0, Math.max(0, room.h - clipboardItem.h)),
    });
    items.push(copy);
    selectedId = copy.id;
    setDirty(true);
    drawItems();
    renderProps();
    renderTally();
    HP.toast(`Pasted ${copy.label}.`, "ok");
  }

  function setSaved(state) {
    if (!current) { savedEl.hidden = true; return; }
    savedEl.hidden = false;
    savedEl.dataset.state = state;
    const txt = state === "saving" ? "Saving…" : state === "dirty" ? "Unsaved changes" : "Saved";
    savedEl.innerHTML = `<span class="ic">${HP.icon(state === "dirty" ? "pencil" : "check")}</span>${txt}`;
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    if (!current || !items.length) return HP.toast("Nothing to export — draw a plan first.", "warn");
    const cell = HP.csvCell;
    const head = ["Client", "Function date", "Venue", "Room (m)", "Item", "Kind",
      "X (m)", "Y (m)", "Width (m)", "Depth (m)", "Rotation", "Seats"];
    const lines = [head.map(cell).join(",")];
    items.forEach((i) => {
      lines.push([
        clientName(current), current.functionDate || "", current.venue || "",
        `${round2(room.w)} × ${round2(room.h)}`, i.label, i.kind,
        round2(i.x), round2(i.y), round2(i.w), round2(i.h),
        Math.round(i.rot) + "°", i.seats,
      ].map(cell).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_floor_plan.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Floor plan exported as CSV.");
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SIMULATION MODE (js/simulate.js) and WALKABILITY (js/walkability.js).

     Both read `liveLayout()` — the very object the 2D sheet is editing. Not a
     snapshot, not a conversion: the same room and the same items array. That
     is the whole of the "one source of truth" requirement, and it is why the
     walkthrough can never show a table somewhere the plan doesn't.

     Entering the walkthrough SAVES FIRST when there is anything to save, so
     the state you walk is the state on the record. Exiting restores the
     editor untouched — the simulator holds no editor state to restore, which
     is the reason it can't lose any.
     ═══════════════════════════════════════════════════════════════════════ */
  const SIM = window.HPSim;
  const WALK = window.HPWalk;

  function startSimulation() {
    if (!current) return HP.toast("Choose an event first.", "warn");
    if (!SIM || !SIM.available()) {
      return HP.toast("The 3D viewer couldn't load — check the connection.", "danger");
    }
    if (!items.length) return HP.toast("Nothing to walk through — the floor is empty.", "warn");
    openSimulationChoice();
  }

  /* Asked once, before the room is even built: walk the bare furniture, or
     walk it with the crowd a night at that density actually looks like. The
     same choice already lives inside the walkthrough (Quality → People), but
     buried a click deep — a designer opening a fresh preset for the first
     time shouldn't have to find it. Answering here just sets the SAME density
     the in-sim menu sets; nothing about the walkthrough itself changes. */
  function openSimulationChoice() {
    HP.openModal("Walk the room", `
      <p class="modal-text">See the bare layout, or the room with guests and staff
        moving through it. Density can still be changed once inside, from Quality → People.</p>
      <div class="ld-evt-list">
        <button class="ld-evt" data-density="NONE">
          <strong>Layout only</strong>
          <small>Just the furniture — fastest to load, easiest to check measurements.</small>
        </button>
        <button class="ld-evt is-on" data-density="HALF">
          <strong>With people</strong>
          <small>Guests seated, staff working the floor — see how the room actually reads.</small>
        </button>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>`);
    const modal = document.querySelector(".modal");
    modal.querySelectorAll("[data-density]").forEach((b) =>
      b.addEventListener("click", () => {
        HP.closeModal();
        enterSimulation(b.dataset.density);
      }));
  }

  async function enterSimulation(density) {
    // Save first, so what is walked is what is on the record. A failed save
    // doesn't block the walkthrough — the plan in memory is still the plan,
    // and refusing to show it would help nobody.
    if (dirty && HP.ONLINE) {
      HP.toast("Saving before the walkthrough…", "ok");
      await save();
    }

    SIM.enter(liveLayout(), {
      // The walkthrough runs the same analysis this desk does, so it is
      // handed the same context: the headcount to check capacity against and
      // the event type that decides which clearances apply and which
      // lighting the room opens under.
      pax: paxOf(current),
      event: eventType,
      title: clientName(current),
      onExit: () => {
        // Nothing to restore: the editor was never torn down, only hidden.
        // Repaint in case the theme or the viewport changed while away.
        fitCanvas();
        if (mode === "3d") show3d();
        // A layout changed inside the walkthrough (it cannot be — the
        // simulator holds no editor state) would still leave a stale report
        // here, so it is dropped rather than trusted.
        if (analyzeOn) runAnalysis();
      },
    });
    // Set AFTER enter(): enter() has already populated at the module's own
    // default, and setDensity is what both re-populates the crowd (or clears
    // it, for NONE) and keeps the in-sim People menu showing the same choice.
    if (SIM.setDensity) SIM.setDensity(density);
    SIM.setTitle(clientName(current));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ANALYSE (js/walkability.js) and OPTIMISE (js/optimise.js).

     The report is advisory by design (brief §8, §17): nothing is moved, the
     number measured and the number wanted are both shown, and the designer
     decides. The optimiser goes one step further and proposes the move — but
     only proposes it, and only applies one when [APPLY] is pressed.
     ═══════════════════════════════════════════════════════════════════════ */
  const OPT = window.HPOptimise;

  /* Run the analysis against the live plan. Cheap enough to re-run whenever
     the plan changes while ANALYSE is on — a report describing the plan as
     it was two edits ago is worse than no report. */
  function runAnalysis(withHeat) {
    if (!WALK || !items.length) { analysis = null; return null; }
    analysis = WALK.analyse(liveLayout(), {
      pax: paxOf(current),
      event: eventType,
      heat: withHeat !== false,
    });
    drawAnalysis();
    return analysis;
  }

  /* ANALYSE mode on the 2D sheet: the pieces the report has something to say
     about are marked in the severity's colour, and the heatmap is laid under
     the plan. The 3D view gets the same through HPScene.showAnalysis. */
  function setAnalyze(on) {
    analyzeOn = !!on;
    if (walkBtn) walkBtn.classList.toggle("is-on", analyzeOn);
    if (!analyzeOn) {
      analysis = null;
      canvasEl.classList.remove("is-analyzing");
      canvasEl.querySelectorAll(".ld-heat, .ld-issue").forEach((el) => el.remove());
      canvasEl.querySelectorAll(".ld-item").forEach((el) => {
        el.classList.remove("sev-high", "sev-medium", "sev-low");
      });
      if (sceneReady && window.HPScene) window.HPScene.clearAnalysis();
      renderTally();
      liveWarnItems = [];        // the full report just cleared these marks;
      scheduleLiveWarnings();    // let the live check redraw them at once
      return;
    }
    runAnalysis();
  }

  /* Paint the report onto the sheet. Called by runAnalysis and again by
     drawItems, because redrawing the plan throws the marks away with it. */
  function drawAnalysis() {
    canvasEl.querySelectorAll(".ld-heat, .ld-issue").forEach((el) => el.remove());
    canvasEl.querySelectorAll(".ld-item").forEach((el) => {
      el.classList.remove("sev-high", "sev-medium", "sev-low");
    });
    if (!analyzeOn || !analysis) return;
    canvasEl.classList.add("is-analyzing");

    /* The heatmap, drawn as one canvas element rather than a thousand divs.
       Same field the 3D floor is coloured by, same bands, same meaning —
       green is floor a server can pass through, red is floor nobody can. */
    if (analysis.heat && analysis.heat.field && RULES) {
      const grid = analysis.heat.grid;
      const cv = document.createElement("canvas");
      cv.className = "ld-heat";
      cv.width = grid.cols;
      cv.height = grid.rows;
      cv.style.width = room.w * scale + "px";
      cv.style.height = room.h * scale + "px";
      const ctx = cv.getContext("2d");
      const img = ctx.createImageData(grid.cols, grid.rows);
      for (let i = 0; i < grid.cols * grid.rows; i++) {
        const o = i * 4;
        if (!grid.walk[i]) { img.data[o + 3] = 0; continue; }
        const band = RULES.bandFor(analysis.heat.field[i]);
        img.data[o] = (band.colour >> 16) & 255;
        img.data[o + 1] = (band.colour >> 8) & 255;
        img.data[o + 2] = band.colour & 255;
        img.data[o + 3] = 96;
      }
      ctx.putImageData(img, 0, 0);
      canvasEl.insertBefore(cv, canvasEl.firstChild);
    }

    // Every piece the report named, marked at its worst severity.
    const worst = Object.create(null);
    const rank = { high: 3, medium: 2, low: 1 };
    analysis.findings.forEach((f) => {
      if (!f.item || !f.item.id) return;
      const cur = worst[f.item.id];
      if (!cur || rank[f.severity] > rank[cur]) worst[f.item.id] = f.severity;
    });
    Object.keys(worst).forEach((id) => {
      const el = canvasEl.querySelector(`.ld-item[data-id="${CSS.escape(id)}"]`);
      if (el) el.classList.add("sev-" + worst[id]);
    });

    // Congestion, as a disc on the floor where the routes actually cross.
    (analysis.congestion || []).forEach((h) => {
      if (h.level === "fair") return;
      const r = Math.max(0.6, Math.sqrt(h.area / Math.PI));
      const dot = document.createElement("div");
      dot.className = "ld-issue ld-issue--congestion is-" + h.level;
      dot.style.left = (h.x - r) * scale + "px";
      dot.style.top = (h.y - r) * scale + "px";
      dot.style.width = dot.style.height = r * 2 * scale + "px";
      dot.title = `${h.share}% of routes pass through ${h.width} m here`;
      canvasEl.appendChild(dot);
    });

    if (sceneReady && window.HPScene) {
      window.HPScene.showAnalysis(analysis, { heatOpacity: 0.4 });
    }
    renderTally();
  }

  /* ── Live collision / route warnings ──────────────────────────────────
     ANALYSE mode is opt-in and paints the whole report — heatmap, every
     severity, the lot. A designer dragging a table into another table (or
     across the only route in from the door) shouldn't have to turn that on
     first to find out: the two faults that make a plan physically wrong —
     two pieces standing in the same place, and a table A* can't reach from
     the entrance — are checked after every edit and marked right on the
     sheet, whether or not ANALYSE is on.

     Skipped while ANALYSE is already on: the full report already marks
     these same pieces (among others), and running both would just repaint
     the same boxes twice with two different code paths deciding severity. */
  let liveWarnItems = [];   // ids of pieces currently marked, so a toast only
                             // fires when the SET of problems actually changed
  let liveWarnTimer = 0;

  function scheduleLiveWarnings() {
    if (analyzeOn) return;             // the full report already covers this
    clearTimeout(liveWarnTimer);
    liveWarnTimer = setTimeout(checkLiveWarnings, 120);
  }

  function checkLiveWarnings() {
    canvasEl.querySelectorAll(".ld-item.sev-live").forEach((el) =>
      el.classList.remove("sev-live", "sev-high"));
    if (!WALK || !current || !items.length) { liveWarnItems = []; return; }

    const ids = [];
    const mark = (id) => {
      if (!id || ids.indexOf(id) >= 0) return;
      ids.push(id);
      const el = canvasEl.querySelector(`.ld-item[data-id="${CSS.escape(id)}"]`);
      if (el) el.classList.add("sev-high", "sev-live");
    };

    /* Overlaps, checked directly against the AABBs rather than through the
       report: walkability.js names only ONE side of a colliding pair on its
       finding (the other is mentioned in the sentence, not on the object), so
       reading it back here would leave half of every collision unmarked. */
    let overlapMsg = null;
    if (window.HPNav) {
      const solids = window.HPNav.solidsOf(liveLayout());
      for (let a = 0; a < solids.length && !overlapMsg; a++) {
        for (let b = a + 1; b < solids.length; b++) {
          const A = solids[a], B = solids[b];
          const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
          const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
          if (ox > 0.02 && oy > 0.02) {
            mark(A.item && A.item.id); mark(B.item && B.item.id);
            if (!overlapMsg) {
              overlapMsg = `${A.item.label || "A piece"} and ${B.item.label || "another piece"} ` +
                `are standing in the same place — they overlap by ${Math.round(Math.min(ox, oy) * 100) / 100} m.`;
            }
          }
        }
      }
    }

    const r = WALK.analyse(liveLayout(), { pax: paxOf(current), event: eventType, heat: false });
    const blocked = r.findings.find((f) => f.title === "Tables can't be walked to");
    if (blocked && blocked.item && blocked.item.id) mark(blocked.item.id);

    // Only the pieces newly in trouble get a toast — an edit that leaves an
    // already-flagged table exactly as blocked as it was a moment ago isn't
    // news, and re-announcing it on every nudge would just be noise.
    const isNew = ids.some((id) => liveWarnItems.indexOf(id) < 0);
    liveWarnItems = ids;
    if (isNew) HP.toast(overlapMsg || (blocked && blocked.detail), "danger");
  }

  /* The report itself, as a panel. Clicking a finding selects the piece it
     names and scrolls the sheet to it — §16's "click an issue and focus on
     the affected object", done the way a 2D sheet can. */
  function openWalkability() {
    if (!current) return HP.toast("Choose an event first.", "warn");
    if (!WALK) return HP.toast("The walkability check couldn't load.", "danger");
    if (!items.length) return HP.toast("Nothing to check — the floor is empty.", "warn");

    const r = runAnalysis();
    if (!r) return;
    analyzeOn = true;
    if (walkBtn) walkBtn.classList.add("is-on");
    drawAnalysis();

    const band = r.score >= 85 ? "is-good" : r.score >= 60 ? "is-warn" : "is-bad";
    const verdict = r.counts.high
      ? `${r.counts.high} thing${r.counts.high === 1 ? "" : "s"} to fix before the night.`
      : r.counts.medium
        ? "Workable, with a few things worth a look."
        : "Nothing standing in a guest's way.";

    const m = r.metrics;
    const icon = { high: "⚠", medium: "▲", low: "·" };
    const metric = (label, value, cls) =>
      `<div class="ld-metric"><span>${HP.esc(label)}</span><b class="${cls || ""}">${HP.esc(String(value))}</b></div>`;
    const grade = (v) => (v >= 85 ? "is-good" : v >= 60 ? "is-warn" : "is-bad");

    const body = `
      <div class="ld-walk-head">
        <div class="ld-walk-score ${band}">${r.score}</div>
        <div class="ld-walk-sum">
          <strong>${HP.esc(verdict)}</strong>
          <p>Measured against the same floor the walkthrough moves on — clearances
             are edge to edge, and routes are what a guest could actually walk.</p>
        </div>
      </div>

      <div class="ld-metrics">
        ${metric("Walkability", m.walkabilityPct + "%", grade(m.walkabilityPct))}
        ${metric("Reachable floor", m.reachablePct + "%", grade(m.reachablePct))}
        ${metric("Seats", m.seats + (m.standing ? " +" + m.standing : ""))}
        ${metric("Booked", m.pax || "—")}
        ${metric("Tables", m.tables)}
        ${metric("Venue capacity", m.roomCapacity)}
        ${metric("Congestion", m.congestionAreas || "None", m.congestionAreas ? "is-warn" : "is-good")}
        ${metric("Main route", m.spineWidth != null ? m.spineWidth + " m" : "—")}
      </div>

      ${r.findings.length ? `
        <div class="ld-walk-list">
          ${r.findings.map((f) => `
            <div class="ld-walk-item sev-${f.severity}"${
              f.item && f.item.id ? ` data-focus="${HP.esc(f.item.id)}"` : ""}>
              <span class="ld-walk-ic">${icon[f.severity]}</span>
              <div class="ld-walk-body">
                <strong>${HP.esc(f.title)}</strong>
                <p>${HP.esc(f.detail)}</p>
                ${f.need != null ? `
                  <div class="ld-walk-metric">
                    <span>Recommended <b>${f.need} m</b></span>
                    <span class="is-short">Current <b>${f.got} m</b></span>
                  </div>` : ""}
              </div>
            </div>`).join("")}
        </div>`
      : `<div class="ld-walk-clean">
           <span class="ic">${HP.icon("check")}</span>
           <p>Every table can be reached, every aisle is wide enough,<br>and the entrance is clear.</p>
         </div>`}`;

    HP.openModal("Layout analysis", body,
      `<button class="btn btn-ghost" data-close>Close</button>
       ${r.findings.length ? `<button class="btn btn-ghost" id="ldWalkOptimise">Optimise layout</button>` : ""}
       <button class="btn btn-primary" id="ldWalkSim">▶ Walk it</button>`);
    const modal = document.querySelector(".modal");
    modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    modal.querySelectorAll("[data-focus]").forEach((el) => {
      el.addEventListener("click", () => {
        HP.closeModal();
        focusItem(el.dataset.focus);
      });
    });
    const modalOptBtn = document.getElementById("ldWalkOptimise");
    if (modalOptBtn) modalOptBtn.addEventListener("click", () => { HP.closeModal(); openOptimiser(); });
    document.getElementById("ldWalkSim").addEventListener("click", () => {
      HP.closeModal();
      startSimulation();
    });
  }

  // Select a piece and bring it into view — the sheet's answer to "focus the
  // camera on the affected object".
  function focusItem(id) {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    select(id);
    const el = canvasEl.querySelector(`.ld-item[data-id="${CSS.escape(id)}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    if (el) {
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1200);
    }
    // In the 3D view, glide the camera to it instead.
    if (mode === "3d" && sceneReady && window.HPScene && window.HPScene.focusOn) {
      window.HPScene.focusOn(it.x + it.w / 2, it.y + it.h / 2, {});
    }
  }

  /* ── OPTIMISE LAYOUT (§17) ────────────────────────────────────────────
     Recommendations, each with the move stated in metres and a compass
     point, and each with its own [APPLY]. Nothing is applied by opening this
     dialog, and applying one is undoable.

     The header shows what the plan would score if every suggestion were
     taken, so [Apply all] is a decision with a stated outcome. */
  function openOptimiser() {
    if (!OPT) return HP.toast("The optimiser couldn't load.", "danger");
    if (!items.length) return HP.toast("Nothing to optimise — the floor is empty.", "warn");

    const before = analysis || runAnalysis(false);
    if (!before) return;
    const list = OPT.suggest(liveLayout(), {
      report: before, pax: paxOf(current), event: eventType,
    });

    if (!list.length) {
      return HP.openModal("Optimise layout", `
        <div class="ld-walk-clean">
          <span class="ic">${HP.icon("check")}</span>
          <p>Nothing here can be improved by moving a single piece.<br>
             ${before.findings.length
               ? "The remaining findings need a change of room or a change of plan — a wider aisle has to come from somewhere."
               : "The plan already clears every check."}</p>
        </div>`,
        `<button class="btn btn-primary" data-close>Close</button>`);
    }

    const after = OPT.preview(liveLayout(), list, { pax: paxOf(current), event: eventType });
    const undos = [];

    const body = `
      <div class="ld-opt-head">
        <div class="ld-opt-compare">
          <div><span>Now</span><b class="${before.score >= 85 ? "is-good" : before.score >= 60 ? "is-warn" : "is-bad"}">${before.score}</b>
            <small>${before.counts.high + before.counts.medium} warnings</small></div>
          <span class="ld-opt-arrow">→</span>
          <div><span>If all applied</span><b class="${after.score >= 85 ? "is-good" : after.score >= 60 ? "is-warn" : "is-bad"}">${after.score}</b>
            <small>${after.counts.high + after.counts.medium} warnings</small></div>
        </div>
        <p>Each move is the smallest one that clears the finding it answers.
           Nothing changes until you press Apply.</p>
      </div>
      <div class="ld-opt-list" id="ldOptList">
        ${list.map((s) => `
          <div class="ld-opt-item sev-${s.severity}" data-sugg="${s.id}">
            <div class="ld-opt-body">
              <strong>${HP.esc(s.title)}</strong>
              <p>${HP.esc(s.detail)}</p>
              <small>${HP.esc(s.from.x)}, ${HP.esc(s.from.y)} m → ${HP.esc(s.to.x)}, ${HP.esc(s.to.y)} m${
                s.move.rot ? ` · turned ${s.move.rot}°` : ""}</small>
            </div>
            <div class="ld-opt-acts">
              <button class="btn btn-primary btn-sm" data-apply="${s.id}">Apply</button>
              <button class="btn btn-ghost btn-sm" data-ignore="${s.id}">Ignore</button>
            </div>
          </div>`).join("")}
      </div>`;

    HP.openModal("Optimise layout", body,
      `<button class="btn btn-ghost" data-close>Done</button>
       <button class="btn btn-ghost" id="ldOptUndo" disabled>Undo last</button>
       <button class="btn btn-primary" id="ldOptAll">Apply all</button>`);
    const modal = document.querySelector(".modal");
    modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    const undoBtn = document.getElementById("ldOptUndo");
    const applyOne = (id) => {
      const s = list.find((x) => x.id === id);
      if (!s) return;
      const rec = OPT.apply({ room: room, items: items }, s);
      if (!rec) return;
      undos.push(rec);
      undoBtn.disabled = false;
      setDirty(true);
      drawItems();
      renderProps();
      renderTally();
      if (mode === "3d") show3d();
      const row = modal.querySelector(`[data-sugg="${s.id}"]`);
      if (row) { row.classList.add("is-done"); row.querySelector(".ld-opt-acts").innerHTML =
        `<span class="ld-opt-applied">Applied</span>`; }
    };

    modal.querySelectorAll("[data-apply]").forEach((b) =>
      b.addEventListener("click", () => applyOne(b.dataset.apply)));
    modal.querySelectorAll("[data-ignore]").forEach((b) =>
      b.addEventListener("click", () => {
        const row = modal.querySelector(`[data-sugg="${b.dataset.ignore}"]`);
        if (row) HP.animateOut(row).then(() => row.remove());
      }));

    document.getElementById("ldOptAll").addEventListener("click", () => {
      list.forEach((s) => {
        const row = modal.querySelector(`[data-sugg="${s.id}"]`);
        if (row && !row.classList.contains("is-done")) applyOne(s.id);
      });
      HP.toast(`${undos.length} move${undos.length === 1 ? "" : "s"} applied.`, "ok");
    });

    undoBtn.addEventListener("click", () => {
      const rec = undos.pop();
      if (!rec) return;
      OPT.undo({ room: room, items: items }, rec);
      undoBtn.disabled = !undos.length;
      setDirty(true);
      drawItems();
      renderProps();
      renderTally();
      if (mode === "3d") show3d();
      const row = modal.querySelector(`[data-sugg="${rec.itemId}"]`);
      HP.toast("Move undone.", "ok");
    });

    // Re-analysing on close keeps the sheet's marks honest about the plan as
    // it now stands rather than as it stood when the dialog opened.
    const closeBtn = modal.querySelector("[data-close]");
    if (closeBtn) closeBtn.addEventListener("click", () => {
      if (undos.length && analyzeOn) runAnalysis();
    });
  }

  /* ── SCENARIOS (§21) ──────────────────────────────────────────────────
     "Wedding Reception — Layout A / B / Final". Saved on the booking beside
     the live plan, so a designer can try a second arrangement without losing
     the first, and compare the two on the numbers rather than by eye.

     Loading one replaces the live plan, and says so before it does. */
  function openScenarios() {
    if (!current) return HP.toast("Choose an event first.", "warn");

    const rows = scenarios.map((s) => {
      const m = s.metrics || {};
      return `
        <div class="ld-scn" data-scn="${HP.esc(s.id)}">
          <div class="ld-scn-id">
            <strong>${HP.esc(s.name)}</strong>
            <small>${HP.esc(s.savedAt || "—")} · ${s.items.length} pieces · ${
              round2(s.room.w)} × ${round2(s.room.h)} m</small>
          </div>
          <div class="ld-scn-metrics">
            <span>Seats <b>${m.seats != null ? m.seats : "—"}</b></span>
            <span>Walkability <b>${m.walkabilityPct != null ? m.walkabilityPct + "%" : "—"}</b></span>
            <span>Warnings <b>${m.warnings != null ? m.warnings : "—"}</b></span>
          </div>
          <div class="ld-scn-acts">
            <button class="btn btn-ghost btn-sm" data-load="${HP.esc(s.id)}">Load</button>
            <button class="btn btn-ghost btn-sm" data-drop="${HP.esc(s.id)}">Delete</button>
          </div>
        </div>`;
    }).join("");

    HP.openModal("Saved layouts", `
      <p class="modal-text">Alternatives for ${HP.esc(clientName(current))}. Saving one
        copies the plan as it stands now; loading one replaces what is on the sheet.</p>
      <div class="field" style="margin-top:14px">
        <label for="ldScnName">Save the current plan as</label>
        <div class="ld-scn-save">
          <input class="control" id="ldScnName" maxlength="40"
                 placeholder="Layout ${String.fromCharCode(65 + scenarios.length)}" />
          <button class="btn btn-primary btn-sm" id="ldScnSave">Save</button>
        </div>
      </div>
      ${scenarios.length ? `<div class="ld-scn-list">${rows}</div>`
        : `<p class="ld-scn-empty">No saved layouts for this event yet.</p>`}`,
      `<button class="btn btn-ghost" data-close>Close</button>
       ${scenarios.length >= 2 ? `<button class="btn btn-primary" id="ldScnCompare">Compare</button>` : ""}`);
    const modal = document.querySelector(".modal");
    modal.classList.add("modal--wide");

    document.getElementById("ldScnSave").addEventListener("click", () => {
      const name = String(document.getElementById("ldScnName").value || "").trim()
        || `Layout ${String.fromCharCode(65 + scenarios.length)}`;
      saveScenario(name);
      HP.closeModal();
      openScenarios();
    });

    modal.querySelectorAll("[data-load]").forEach((b) =>
      b.addEventListener("click", () => loadScenario(b.dataset.load)));
    modal.querySelectorAll("[data-drop]").forEach((b) =>
      b.addEventListener("click", () => {
        scenarios = scenarios.filter((s) => s.id !== b.dataset.drop);
        setDirty(true);
        HP.closeModal();
        openScenarios();
      }));
    const cmp = document.getElementById("ldScnCompare");
    if (cmp) cmp.addEventListener("click", () => { HP.closeModal(); openCompare(); });
  }

  /* A scenario carries its own METRICS, measured when it was saved. Storing
     them rather than recomputing on open is what makes the comparison table
     instant, and it is honest: the numbers describe the plan as saved, which
     is exactly the plan the row represents. */
  function saveScenario(name) {
    if (scenarios.length >= 12) {
      return HP.toast("Twelve saved layouts is the limit — delete one first.", "warn");
    }
    const snapshot = items.map((i) => Object.assign({}, i));
    let metrics = null;
    if (WALK) {
      const r = WALK.analyse({ room: { w: room.w, h: room.h }, items: snapshot },
                             { pax: paxOf(current), event: eventType });
      metrics = {
        seats: r.metrics.seats,
        tables: r.metrics.tables,
        walkabilityPct: r.metrics.walkabilityPct,
        reachablePct: r.metrics.reachablePct,
        congestionAreas: r.metrics.congestionAreas,
        score: r.score,
        warnings: r.counts.high + r.counts.medium,
      };
    }
    scenarios.push({
      id: newId(),
      name: String(name).slice(0, 40),
      savedAt: new Date().toISOString().slice(0, 10),
      room: { w: round2(room.w), h: round2(room.h) },
      items: snapshot,
      metrics: metrics,
    });
    setDirty(true);
    HP.toast(`Saved as "${name}".`, "ok");
  }

  function loadScenario(id) {
    const s = scenarios.find((x) => x.id === id);
    if (!s) return;
    const go = () => {
      room = { w: s.room.w, h: s.room.h };
      items = s.items.map(sanitize).filter(Boolean);
      selectedId = null;
      setDirty(true);
      fitCanvas();
      renderProps();
      renderTally();
      if (analyzeOn) runAnalysis();
      if (mode === "3d") show3d();
      HP.closeModal();
      HP.toast(`"${s.name}" loaded.`, "ok");
    };
    if (!dirty) return go();
    // Never lose the designer's work silently — §21's "do not lose the
    // user's existing layout data", enforced at the one place it could.
    HP.openModal("Replace the current plan?", `
      <p class="modal-text">The plan on the sheet has unsaved changes. Loading
        "${HP.esc(s.name)}" will replace it. Save the current one as a layout first
        if you want to keep it.</p>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-danger" id="ldScnGo">Replace</button>`);
    document.getElementById("ldScnGo").addEventListener("click", go);
  }

  /* The comparison table (§21): every saved layout side by side, plus the
     plan currently on the sheet, so "which of these do we set up" is a
     decision made on numbers. */
  function openCompare() {
    const live = WALK ? WALK.analyse(liveLayout(), { pax: paxOf(current), event: eventType }) : null;
    const cols = [];
    if (live) {
      cols.push({
        name: "On the sheet now", metrics: {
          seats: live.metrics.seats, tables: live.metrics.tables,
          walkabilityPct: live.metrics.walkabilityPct,
          reachablePct: live.metrics.reachablePct,
          congestionAreas: live.metrics.congestionAreas,
          score: live.score, warnings: live.counts.high + live.counts.medium,
        },
      });
    }
    scenarios.forEach((s) => cols.push({ name: s.name, metrics: s.metrics || {} }));

    const booked = paxOf(current);
    const ROWS = [
      ["Guests booked", () => booked || "—"],
      ["Seats", (m) => (m.seats != null ? m.seats : "—")],
      ["Tables", (m) => (m.tables != null ? m.tables : "—")],
      ["Walkability", (m) => (m.walkabilityPct != null ? m.walkabilityPct + "%" : "—")],
      ["Reachable floor", (m) => (m.reachablePct != null ? m.reachablePct + "%" : "—")],
      ["Congestion areas", (m) => (m.congestionAreas != null ? m.congestionAreas : "—")],
      ["Warnings", (m) => (m.warnings != null ? m.warnings : "—")],
      ["Score", (m) => (m.score != null ? m.score : "—")],
    ];

    HP.openModal("Compare layouts", `
      <div class="ld-cmp-wrap">
        <table class="ld-cmp">
          <thead><tr><th></th>${cols.map((c) =>
            `<th>${HP.esc(c.name)}</th>`).join("")}</tr></thead>
          <tbody>
            ${ROWS.map(([label, get]) => `
              <tr>
                <th>${HP.esc(label)}</th>
                ${cols.map((c) => `<td>${HP.esc(String(get(c.metrics)))}</td>`).join("")}
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p class="modal-text">Walkability is the share of the floor wide enough for a
        server to pass. Every number is measured on the same grid the walkthrough
        walks on.</p>`,
      `<button class="btn btn-primary" data-close>Close</button>`);
    document.querySelector(".modal").classList.add("modal--wide");
  }

  /* ── The event type selector (§18) ────────────────────────────────────
     What the room is being dressed for. Changes what the analysis asks and
     which lighting the walkthrough opens under; changes nothing on the plan. */
  function openEventType() {
    if (!current || !RULES) return;
    HP.openModal("Kind of function", `
      <p class="modal-text">What this room is being dressed for. It changes what the
        analysis looks for and how the walkthrough is lit — it never moves anything
        on your plan.</p>
      <div class="ld-evt-list">
        ${RULES.EVENT_NAMES.map((k) => {
          const e = RULES.EVENT_TYPES[k];
          return `
            <button class="ld-evt${k === eventType ? " is-on" : ""}" data-evt="${k}">
              <strong>${HP.esc(e.label)}</strong>
              <small>${HP.esc(e.note)}</small>
            </button>`;
        }).join("")}
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>`);
    const modal = document.querySelector(".modal");
    modal.classList.add("modal--wide");
    modal.querySelectorAll("[data-evt]").forEach((b) =>
      b.addEventListener("click", () => {
        eventType = b.dataset.evt;
        setDirty(true);
        HP.closeModal();
        renderHead();
        if (analyzeOn) runAnalysis();
        HP.toast(`Analysing as a ${RULES.eventOf(eventType).label.toLowerCase()}.`, "ok");
      }));
  }

  simBtn.addEventListener("click", startSimulation);
  walkBtn.addEventListener("click", openWalkability);
  if (optBtn) optBtn.addEventListener("click", openOptimiser);
  if (scnBtn) scnBtn.addEventListener("click", openScenarios);
  if (evtBtn) evtBtn.addEventListener("click", openEventType);

  /* ═══════════════════════════════════════════════════════════════════════
     The preset book (js/presets.js).

     The house's standard settings for the headcounts actually booked, so a
     designer starts a 50-pax reception from a floor that already works rather
     than from nothing. A preset LANDS AS AN ORDINARY PLAN: it fills `room`
     and `items` exactly as a loaded one would, and is editable, saveable and
     3D-viewable from that moment. Nothing about it stays special — which is
     the property that stops the presets becoming a second kind of layout the
     rest of the desk has to know about.

     Applying one replaces the floor, so it asks first when there is work to
     lose.
     ═══════════════════════════════════════════════════════════════════════ */
  const PR = window.HPPresets;

  /* A preset's thumbnail is drawn from its own items — the same rectangles and
     circles the 2D sheet draws, at gallery size. Rendering the real plan (and
     not a stock illustration) is what makes the gallery honest: what is
     pressed is what lands. */
  function presetSVG(plan) {
    const W = 200, H = 150, pad = 6;
    const k = Math.min((W - pad * 2) / plan.room.w, (H - pad * 2) / plan.room.h);
    const ox = (W - plan.room.w * k) / 2;
    const oy = (H - plan.room.h * k) / 2;
    const fill = {
      round: "var(--paper-3)", rect: "var(--paper-3)",
      buffet: "var(--gold-hair)", stage: "rgba(84,88,47,.35)",
      dance: "rgba(123,89,31,.3)", bar: "rgba(140,51,32,.3)",
      decor: "rgba(92,122,51,.4)", other: "var(--vellum)",
    };
    const shapes = plan.items.map((i) => {
      const x = ox + i.x * k, y = oy + i.y * k, w = i.w * k, h = i.h * k;
      const f = fill[i.kind] || "var(--paper-3)";
      return i.kind === "round" || i.kind === "decor"
        ? `<ellipse cx="${(x + w / 2).toFixed(1)}" cy="${(y + h / 2).toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="${f}" stroke="var(--gold-deep)" stroke-width=".7"/>`
        : `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1" fill="${f}" stroke="var(--gold-deep)" stroke-width=".7"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-hidden="true">
      <rect x="${ox.toFixed(1)}" y="${oy.toFixed(1)}" width="${(plan.room.w * k).toFixed(1)}" height="${(plan.room.h * k).toFixed(1)}"
        fill="var(--vellum)" stroke="var(--gold-hair)" stroke-width="1"/>${shapes}</svg>`;
  }

  // The headcount the gallery opens on: whatever the booking actually says,
  // rounded to the nearest standard setting, so the first thing a designer
  // sees is the one they were going to pick.
  function nearestCount(pax) {
    if (!pax) return 50;
    return PR.COUNTS.reduce((best, c) =>
      Math.abs(c - pax) < Math.abs(best - pax) ? c : best, PR.COUNTS[0]);
  }

  let presetCount = null;

  function openPresets() {
    if (!current) return HP.toast("Choose an event first.", "warn");
    if (!PR) return HP.toast("The preset book couldn't load.", "danger");
    presetCount = presetCount || nearestCount(paxOf(current));

    HP.openModal("Start from a preset", `
      <p class="modal-text">The house's standard settings. Choosing one replaces
        everything on the floor — the room, the tables and the fixtures — and it
        is an ordinary plan from there: move anything, then save.</p>
      <div class="ld-counts" id="ldCounts"></div>
      <div class="ld-presets" id="ldPresetGrid"></div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>`);
    const modal = document.querySelector(".modal");
    modal.classList.add("modal--wide");
    renderPresetCounts();
    renderPresetGrid();
  }

  function renderPresetCounts() {
    const el = document.getElementById("ldCounts");
    if (!el) return;
    const booked = paxOf(current);
    el.innerHTML = PR.COUNTS.map((c) => `
      <button class="ld-count ${c === presetCount ? "active" : ""}" data-count="${c}">
        ${c}<small>${c === nearestCount(booked) && booked ? "booked" : "pax"}</small>
      </button>`).join("");
    el.querySelectorAll("[data-count]").forEach((b) =>
      b.addEventListener("click", () => {
        presetCount = Number(b.dataset.count);
        renderPresetCounts();
        renderPresetGrid();
      }));
  }

  function renderPresetGrid() {
    const el = document.getElementById("ldPresetGrid");
    if (!el) return;
    const cards = PR.list(presetCount);
    el.innerHTML = cards.map((c) => `
      <button class="ld-preset" data-style="${HP.esc(c.key)}">
        <span class="ld-preset-shot">${presetSVG(c.plan)}</span>
        <span class="ld-preset-body">
          <h4>${HP.esc(c.name)}</h4>
          <p class="ld-preset-blurb">${HP.esc(c.blurb)}</p>
          <span class="ld-preset-facts">
            <span class="badge badge-gold">${c.seats} seated</span>
            <span class="badge badge-muted">${c.pieces} pieces</span>
            <span class="badge badge-cat">${c.room.w} × ${c.room.h} m</span>
          </span>
        </span>
      </button>`).join("");
    el.querySelectorAll("[data-style]").forEach((b) =>
      b.addEventListener("click", () => applyPreset(b.dataset.style, presetCount)));
  }

  function applyPreset(styleKey, pax) {
    const land = () => {
      const plan = PR.build(styleKey, pax);
      room = { w: plan.room.w, h: plan.room.h };
      // Through sanitize(), so a preset is held to exactly the same bounds
      // rules as a plan read back from Firestore — one gate, not two.
      items = plan.items.map(sanitize).filter(Boolean);
      selectedId = null;
      setDirty(true);
      HP.closeModal();
      fitCanvas();
      renderProps();
      renderTally();
      if (mode === "3d") show3d();
      HP.toast("Preset applied — save when you're happy with it.", "ok");
    };
    if (items.length) {
      HP.confirmModal("Replace the floor?",
        `This clears the ${items.length} piece${items.length === 1 ? "" : "s"} already on the plan.`,
        land, false);
    } else land();
  }

  presetBtn.addEventListener("click", openPresets);

  /* ═══════════════════════════════════════════════════════════════════════
     The 3D view (js/scene3d.js).

     One rule keeps the two views honest: the 3D side is built from the SAME
     `room` + `items` the 2D sheet is editing, never from a copy of its own.
     Switching to 3D rebuilds from live state, so a piece dragged on the sheet
     is standing in the right place the moment the tab is pressed — and there
     is no second model that can drift out of step with the first.

     It rebuilds on tab-switch rather than on every drag: extruding forty
     tables and three hundred chairs mid-drag would stutter the very gesture
     it was meant to illustrate.
     ═══════════════════════════════════════════════════════════════════════ */
  const S = window.HPScene;

  // The live plan, in the shape scene3d.js reads.
  const liveLayout = () => ({
    room: { w: room.w, h: room.h },
    items: items,
  });

  function setMode(next) {
    if (next === mode) return;
    if (next === "3d" && !current) return HP.toast("Choose an event first.", "warn");
    mode = next;
    tabsEl.querySelectorAll("[data-view2d]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view2d === mode));
    stage2d.hidden = mode !== "2d";
    stage3d.hidden = mode !== "3d";
    if (mode === "2d") { fitCanvas(); return; }
    show3d();
  }

  function show3d() {
    if (!S || !S.available()) return fallback3d();
    if (!sceneReady) {
      // First entry: mount the renderer into the host, keeping the drag hint
      // (the canvas is inserted alongside it, not in place of it).
      sceneReady = S.mount(host3d);
      if (!sceneReady) return fallback3d();
    }
    S.resize();
    S.render(liveLayout());
    // The dressing is applied AFTER the render: a chosen setup survives the
    // rebuild, and a designer who picked a theme from the 2D sheet sees it
    // the first time they open this tab. renderCams runs inside applySetup
    // once the colours land, so the filmstrip photographs the dressed room.
    if (setupChoice) applySetup(setupChoice);
    else renderCams();
  }

  function fallback3d() {
    host3d.innerHTML = `
      <div class="ld-3d-fallback">
        <span class="ic">${HP.icon("cube")}</span>
        <p>The 3D viewer couldn't load.</p>
        <p style="font-size:.84rem">Check the connection — the 2D plan is unaffected.</p>
      </div>`;
    camsEl.innerHTML = "";
    HP.hydrateIcons(host3d);
  }

  /* ── The setup gallery ────────────────────────────────────────────────
     Read once, straight from the same `setups` collection the Content
     Moderator writes (firestore.rules grants public read). Only the visible
     ones: a setup hidden from the app is hidden from the designer too, which
     is the whole point of that switch.

     Failure here is quiet by design. The gallery is a garnish on the plan —
     a designer who can't reach it should still be able to draw a floor plan,
     so a dead read leaves the Theme button showing the house scheme rather
     than throwing a banner across a working desk. */
  function loadSetups() {
    if (!db) return Promise.resolve([]);
    return db.collection("setups").get()
      .then((snap) => {
        setups = snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((s) => s && s.visible && !s.deleted && s.image)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return setups;
      })
      .catch((e) => {
        console.warn("HapagPamana: setups read —", e);
        return [];
      });
  }

  /* Dress the room. Passing null strips back to the house scheme.

     Deliberately NOT gated on `sceneReady`. The dressing lives on the shared
     MATERIALS (js/scene3d.js owns them and builds them on demand), not on a
     mounted renderer — and Simulation Mode builds its own scene from those
     same materials without the preview ever having been opened. Waiting for
     the 3D tab here is what made a theme picked from the 2D sheet arrive in
     the walkthrough undressed.

     Only the FILMSTRIP needs a live renderer, so that is the one thing kept
     behind the check. */
  function applySetup(choice) {
    setupChoice = choice && choice.id ? { id: choice.id, title: choice.title || "" } : null;
    if (!S.available()) { renderThemeBtn(); return Promise.resolve(null); }

    // Re-shooting the camera thumbnails: only meaningful once the preview is
    // mounted AND showing.
    const reshoot = () => { if (sceneReady && mode === "3d") renderCams(); };

    const TH = window.HPTheme;
    if (!TH || !setupChoice) {
      S.setTheme(null);
      renderThemeBtn();
      reshoot();
      return Promise.resolve(null);
    }
    const s = setups.find((x) => x.id === setupChoice.id);
    // Chosen setup gone from the gallery (deleted, or hidden since): the plan
    // keeps the reference, the room falls back to the house scheme.
    if (!s) { S.setTheme(null); renderThemeBtn(); return Promise.resolve(null); }

    return TH.fromSetup(s).then((t) => {
      S.setTheme(t);
      // The button's swatch strip shows what the room is WEARING, so it can
      // only be painted once the colours have actually been read.
      renderThemeBtn();
      reshoot();
      return t;
    });
  }

  /* The Theme button's own face: the chosen setup's name, and a strip of the
     colours actually being worn, so the current dressing is legible without
     opening the picker or switching to the 3D tab. */
  function renderThemeBtn() {
    const btn = themeBtn;
    if (!btn) return;
    const name = btn.querySelector(".ld-theme-name");
    const strip = btn.querySelector(".ld-theme-strip");
    const t = S.available() ? S.theme : null;
    if (name) name.textContent = "Theme";
    if (strip) {
      const cols = t ? [t.wall, t.floor, t.cloth, t.accent, t.uplight] : [];
      strip.innerHTML = cols.map((c) =>
        `<i style="background:${HP.esc(c)}"></i>`).join("");
      strip.hidden = !cols.length;
    }
    btn.classList.toggle("is-themed", !!setupChoice);
  }

  /* The picker. Each setup is its own photograph with the palette read out of
     it underneath — the designer is choosing a LOOK, so the thing to show is
     the look, not a dropdown of titles. */
  function openThemePicker() {
    if (!setups.length) {
      return HP.toast(HP.ONLINE
        ? "No visible setups in the gallery yet — upload one under Content Moderator › Setups."
        : "Setups live in Firestore — connect Firebase to read them.", "warn");
    }
    const card = (s) => `
      <button class="ld-setup ${setupChoice && setupChoice.id === s.id ? "active" : ""}"
              data-setup="${HP.esc(s.id)}">
        <span class="ld-setup-shot"><img src="${HP.esc(s.image)}" alt="" loading="lazy"></span>
        <span class="ld-setup-text">
          <strong>${HP.esc(s.title || "Untitled setup")}</strong>
          <span class="ld-setup-strip" data-strip="${HP.esc(s.id)}"></span>
        </span>
      </button>`;

    HP.openModal("Dress the room", `
      <p class="ld-setup-note">The room's linen, drapes, accents and uplighting take
         their colours from the setup photo. Floor, walls and timber stay as the venue's.</p>
      <div class="ld-setups">
        <button class="ld-setup ${!setupChoice ? "active" : ""}" data-setup="">
          <span class="ld-setup-shot ld-setup-shot--house"><span class="ic">${HP.icon("plan")}</span></span>
          <span class="ld-setup-text"><strong>House scheme</strong>
            <small>The venue's own paper and gold</small></span>
        </button>
        ${setups.map(card).join("")}
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>`);

    const modal = document.querySelector(".modal");
    HP.hydrateIcons(modal);

    // Fill each card's swatch strip as its photo is read. Extraction is
    // cached per image, so reopening the picker is instant.
    const TH = window.HPTheme;
    if (TH) setups.forEach((s) => {
      TH.fromSetup(s).then((t) => {
        const el = modal.querySelector(`[data-strip="${CSS.escape(s.id)}"]`);
        if (!el) return;
        /* The ROLES the room will actually wear, not the raw clusters read
           off the photo. The two differ — every role is fitted into a band
           before it becomes a finish — and showing the clusters promised a
           look the room then didn't deliver. */
        const roles = [
          ["Walls", t.wall], ["Floor", t.floor], ["Linen", t.cloth],
          ["Accent", t.accent], ["Drape", t.drape], ["Uplight", t.uplight],
        ];
        el.innerHTML = roles.map(([name, c]) =>
          `<i title="${HP.esc(name)}" style="background:${HP.esc(c)}"></i>`).join("");
        if (t.house) el.insertAdjacentHTML("beforeend", `<em>no colour read</em>`);
      });
    });

    modal.querySelectorAll("[data-setup]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.dataset.setup;
        const s = id ? setups.find((x) => x.id === id) : null;
        applySetup(s ? { id: s.id, title: s.title } : null);
        setDirty(true);
        HP.closeModal();
        HP.toast(s ? `Room dressed for "${s.title}".` : "Back to the house scheme.", "ok");
      }));
  }

  if (themeBtn) themeBtn.addEventListener("click", openThemePicker);

  /* The camera filmstrip. Thumbnails are rendered off the live scene, so each
     one is this room from that angle — not a stock illustration of a camera
     position. They're re-shot whenever the plan changes, which is why the
     strip is rebuilt here rather than cached across events. */
  function renderCams() {
    const shots = S.thumbnails();
    camsEl.innerHTML = S.views.map((name) => `
      <button class="ld-cam ${name === S.view ? "active" : ""}" data-cam="${HP.esc(name)}">
        <span class="ld-cam-shot">${shots[name]
          ? `<img src="${shots[name]}" alt="${HP.esc(name)}" />`
          : `<span class="ic">${HP.icon("eye")}</span>`}</span>
        <span class="ld-cam-name">${HP.esc(name)}</span>
      </button>`).join("");
    HP.hydrateIcons(camsEl);
    camsEl.querySelectorAll("[data-cam]").forEach((b) =>
      b.addEventListener("click", () => {
        S.setView(b.dataset.cam);
        camsEl.querySelectorAll(".ld-cam").forEach((c) =>
          c.classList.toggle("active", c === b));
      }));
  }

  tabsEl.querySelectorAll("[data-view2d]").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.view2d)));

  window.addEventListener("resize", debounce(() => { if (mode === "3d" && sceneReady) S.resize(); }, 150));

  // The portal's dark variant swaps the colour tokens under a page that is
  // already open; the model reads those tokens, so it has to be repainted.
  if (window.matchMedia) {
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => { if (sceneReady) S.refreshTheme(liveLayout()); };
    if (dark.addEventListener) dark.addEventListener("change", onTheme);
    else if (dark.addListener) dark.addListener(onTheme);
  }

  /* ── Small helpers ────────────────────────────────────────────────────── */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function snap(v) { return Math.round(v / GRID) * GRID; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function fmtM(v) { return round2(v) + " m"; }
  function newId() { return "it_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
})();
