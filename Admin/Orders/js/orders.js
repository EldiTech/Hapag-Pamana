/* HapagPamana · Orders — the Order Manager's page.
   Every order placed in the app lands here: the `bookings` collection holds
   both the catering wizard's requests (bookingType "Catering") and the
   food-pack quotation wizard's (bookingType "Food Pack"). The page streams
   the collection live (onSnapshot), so new orders appear the moment a
   customer submits one.

   Workflow: every order arrives `pending`. The order manager confirms or
   declines it, then marks confirmed orders completed after the event.
   Status writes update only { status, statusUpdatedAt } — inside a
   transaction that validates the move against the doc's CURRENT status —
   so the customer's original answers are never touched and two managers
   racing on the same order can't double-apply a transition.

   Reading/updating bookings requires the marketing_admin (or admin) role —
   see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Orders",
    sub: "Every booking and quotation filed from the app.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("orderStats");
  const segEl = document.getElementById("statusSeg");
  const chipsEl = document.getElementById("typeChips");
  const rowsEl = document.getElementById("orderRows");

  const db = HP.ONLINE ? firebase.firestore() : null;

  /* The live stream is bounded to the newest LIVE_LIMIT bookings (Spark
     quota: an unbounded onSnapshot re-reads the whole collection ever more
     expensively as history grows). Older bookings load on demand — one-shot
     pages appended below the live window. */
  const LIVE_LIMIT = 200, OLDER_PAGE = 200;
  let orders = [];         // live window + loaded older pages, newest first
  let live = [];           // the streamed newest-LIVE_LIMIT window
  let older = [];          // older pages, fetched on demand (static copies)
  let liveTail = null;     // last doc of the live window (pagination cursor)
  let olderCursor = null;  // last doc of the oldest page fetched
  let olderDone = false;   // no older bookings remain
  let loadingOlder = false;
  let mayHaveOlder = false;
  let query = "";
  let statusFilter = "all";
  let typeFilter = "all";
  let dateFilter = "all";     // all | 7 | 30 | past (event date window)
  let sortMode = "received";  // received (newest first) | event (soonest first)
  let loaded = false;
  let unsub = null;

  function mergeOrders() {
    const seen = new Set(live.map((o) => o.id));
    orders = live.concat(older.filter((o) => !seen.has(o.id)));
    orders.sort((a, b) => ts(b.createdAt) - ts(a.createdAt)); // newest first
  }

  // Skeletons while auth + the first snapshot run.
  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 8);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      segEl.innerHTML = ""; chipsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(
        "Orders live in Firestore — connect Firebase to manage them.");
      return;
    }
    // Live stream — orders appear/refresh the moment the app writes them.
    // NB: orderBy(createdAt) excludes any legacy booking missing that field.
    unsub = db.collection("bookings")
      .orderBy("createdAt", "desc").limit(LIVE_LIMIT)
      .onSnapshot(
      (snap) => {
        live = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        liveTail = snap.docs[snap.docs.length - 1] || null;
        mayHaveOlder = snap.size >= LIVE_LIMIT;
        announceNewPending(live);
        mergeOrders();
        loaded = true;
        renderAll();
        syncSheet(); // the open detail sheet follows its doc live
        openDeepLinkedOrder();
      },
      (e) => {
        console.error("HapagPamana: couldn't load the orders —", e);
        statsEl.innerHTML = "";
        const denied = e && (e.code === "permission-denied" ||
          /permission|insufficient/i.test(e.message || ""));
        rowsEl.innerHTML = emptyRow(denied
          ? "Access denied — publish the updated Firestore rules (order-manager access to bookings), then reload."
          : "Couldn't reach the database. Check your connection and reload.");
        if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
      });
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  /* Landing here from the booking calendar's day popover ("Open in Orders")
     jumps straight to that order's sheet — the calendar links with
     ?order=<id> rather than duplicating the booking sheet on its own page.
     Only fires once: after that the sheet is just whatever the user has
     open, deep link or not. */
  let deepLinkOpened = false;
  function openDeepLinkedOrder() {
    if (deepLinkOpened) return;
    const id = new URLSearchParams(location.search).get("order");
    if (!id) return;
    deepLinkOpened = true;
    const o = orders.find((x) => x.id === id);
    if (o) openSheet(o);
  }

  /* ── New-pending-order notification ───────────────────────────────────────
     Each snapshot is diffed against the last known ids; genuinely new
     pending orders raise a toast, and the tab title flashes so a
     backgrounded dashboard still catches the manager's eye. */
  let knownIds = null;
  let titleTimer = null;
  const BASE_TITLE = document.title;
  function stopTitleFlash() {
    clearInterval(titleTimer);
    titleTimer = null;
    document.title = BASE_TITLE;
  }
  window.addEventListener("focus", stopTitleFlash);
  function announceNewPending(rows) {
    const ids = new Set(rows.map((o) => o.id));
    if (knownIds) {
      const fresh = rows.filter((o) => !knownIds.has(o.id) && !o.deleted && statusOf(o) === "pending");
      if (fresh.length) {
        HP.toast(fresh.length === 1
          ? `New order from ${clientName(fresh[0])} — it's in the pending queue.`
          : `${fresh.length} new orders are in the pending queue.`, "ok");
        stopTitleFlash();
        let on = false, flashes = 0;
        titleTimer = setInterval(() => {
          document.title = (on = !on) ? `● New order — ${BASE_TITLE}` : BASE_TITLE;
          if (++flashes >= 10) stopTitleFlash();
        }, 1000);
      }
    }
    knownIds = ids;
  }

  /* ── Order vocabulary ─────────────────────────────────────────────────── */
  const STATUSES = ["pending", "confirmed", "completed", "declined"];
  const STATUS_META = {
    pending:   { label: "Pending",   badge: "badge-warn" },
    confirmed: { label: "Confirmed", badge: "badge-ok" },
    completed: { label: "Completed", badge: "badge-gold" },
    declined:  { label: "Declined",  badge: "badge-danger" },
  };
  const statusOf = (o) => (STATUS_META[o.status] ? o.status : "pending");
  const typeOf = (o) => (String(o.bookingType || "").toLowerCase() === "food pack" ? "Food Pack" : "Catering");

  /* ── The downpayment ──────────────────────────────────────────────────────
     The app collects 50% of an order's total through PayMongo before the
     client is told their date is held, and writes the result back onto the
     booking. It matters here because confirming an order puts it on the
     Master Chef's prep board — so an order that hasn't paid its downpayment
     is one to chase, not to confirm.

     `none` is the state of every order filed before the gate existed; those
     were settled by hand, so they're shown as nothing at all rather than as
     unpaid. `quote_needed` means the app had no package price to halve (a
     booking started without picking a package) — the downpayment is yours to
     arrange with the client directly. */
  const PAYMENT_META = {
    awaiting:     { label: "Unpaid",     badge: "badge-warn",   chase: true  },
    paid:         { label: "Paid 50%",   badge: "badge-ok",     chase: false },
    quote_needed: { label: "To quote",   badge: "badge-cat",    chase: false },
  };
  const paymentOf = (o) => String(o.paymentStatus || "none");
  const paymentMeta = (o) => PAYMENT_META[paymentOf(o)] || null;
  // True only for an order the gate asked to pay, which hasn't. This is what
  // locks confirmation (see confirmOrder) — `quote_needed` and the pre-gate
  // `none` never went through PayMongo, so there's nothing to wait for on them.
  const isUnpaid = (o) => paymentOf(o) === "awaiting";
  const isPaid = (o) => paymentOf(o) === "paid";
  /* A downpayment the order manager took by hand — cash over the counter, a
     bank transfer, a direct GCash — and recorded here (see recordPayment).
     PayMongo never saw it, so the sheet says who did instead of showing a
     payment reference that doesn't exist in the dashboard. */
  const isOfflinePay = (o) => String(o.paymentSource || "") === "offline";
  const takenByOf = (o) => String(o.paymentTakenByName || "").trim();
  // The downpayment may still be collected on these; a trashed, completed or
  // declined order is nobody's to take money for.
  const mayRecordPayment = (o) =>
    !o.deleted && !isPaid(o) && ["pending", "confirmed"].includes(statusOf(o));

  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "";
    return "₱" + Math.round(n).toLocaleString("en-PH");
  };

  /* The booking sheet's vocabulary, mirroring the app's wizard steps. Only
     the fields the client actually filled in are shown (the repository drops
     blanks on submit). The catering wizard fills one dish per course; the
     food-pack wizard writes `menu` lines shaped "Dish name (N pax)". */
  const COURSES = [
    ["appetizer", "Appetizer"],
    ["soup", "Soup"],
    ["salad", "Salad"],
    ["rice", "Rice"],
    ["pastaNoodles", "Pasta / Noodles"],
    ["beef", "Beef"],
    ["pork", "Pork"],
    ["chicken", "Chicken"],
    ["seafood", "Seafood"],
    ["vegetables", "Vegetables"],
    ["desserts", "Desserts"],
    ["drinks", "Drinks"],
  ];
  // The event day in the order it actually unfolds — setup through pack-out.
  const TIMELINE = [
    ["ingress", "Setup begins", "Ingress — the crew arrives to set up"],
    ["functionStart", "Function starts", "Guests are seated"],
    ["foodServing", "Food is served", "The meal opens"],
    ["programEnd", "Program ends", "The event closes"],
    ["egress", "Pack out by", "Egress — the crew clears the venue"],
  ];
  // Bookkeeping keys that never belong on the client-facing sheet.
  const META_KEYS = new Set([
    "uid", "status", "createdAt", "statusUpdatedAt", "bookingType",
    "history", "updatedAt", "updatedBy", "deleted", "deletedAt", "deletedBy",
  ]);
  /* Structured state other desks write onto the order — not facts about the
     booking, and not text. "More details" prints values with HP.esc, which
     stringifies an object to "[object Object]", so these have to be named
     rather than left to fall through: the fulfilment record was doing exactly
     that on the sheet. The Team Leader and Logistics desks render it properly
     from their own rail (assets/hp-fulfilment.js). */
  const INTERNAL_KEYS = new Set([
    "fulfilment",
    // The floor plan the Layout Designer draws (bookings/{id}.layout) — a room
    // of pieces, summarised by roomHTML below and drawn properly by that desk.
    "layout",
    // The Catering Equipment desk's checklist and its hand-over to Logistics.
    // Summarised by roomHTML; the desk itself renders the lines.
    "equipmentPrep", "equipmentPickup",
  ]);
  // Every key the sheet already presents somewhere; anything else the app
  // adds later still shows up under "More details".
  const SHEET_KEYS = new Set([
    "kindOfFunction", "functionDate", "venue", "address", "pax",
    "clientName", "contactNumber", "email", "package", "menu", "menuAddOns",
    // The look the client picked off the moderator's Setups gallery — a room,
    // not a dish, so it's shown by roomHTML and must be named here or
    // courseKeys() below would file it as a course and send the kitchen
    // hunting for "Rustic Garden Buffet" in the recipe book.
    "setupStyle",
    // The downpayment, which has its own section (see paymentHTML). The two
    // checkout keys are PayMongo plumbing the app uses to resume an abandoned
    // payment — of no use on a booking sheet, so they're hidden rather than
    // dumped into "More details".
    "paymentStatus", "paymentTotal", "paymentDue", "paymentPaid", "paidAt",
    // The total's breakdown — presented under it in paymentHTML.
    "packageTotal", "addOnsTotal", "discountTotal", "packageDiscount",
    "addOnsDiscountTotal", "appliedPromos",
    "paymentRef", "paymentMethod", "checkoutSessionId", "checkoutUrl",
    // Written when a manager records a payment taken by hand (recordPayment);
    // the sheet reads them in paymentHTML.
    "paymentSource", "paymentTakenBy", "paymentTakenByName",
    ...COURSES.map(([k]) => k),
    ...TIMELINE.map(([k]) => k),
  ]);

  /* Every course on an order, in the order the app asked for them.

     The app used to fill a FIXED thirteen-course spread, which is what COURSES
     above lists. It no longer does: the booking wizard now builds its questions
     from the booked package's own inclusions, so a package including "Pasta ·
     Pork · Dessert · Sandwich or Appetizer" writes `pasta`, `pork`, `dessert`
     and `sandwichOrAppetizer` — keys COURSES has never heard of.

     Reading only COURSES meant those dishes fell through to "More details",
     where the kitchen does not look for food. An order would show one dish on
     the sheet and the chef would cook one dish, while the client had ordered
     four. This finds them instead: a string field that isn't bookkeeping, and
     isn't already shown elsewhere on the sheet, is a course.

     COURSES still leads, so the legacy keys keep their proper labels and their
     familiar order (Appetizer before Soup before Salad …); anything beyond it
     follows, labelled from the key itself the way the wizard wrote it. */
  function courseKeys(o) {
    const out = [];
    const seen = new Set();
    COURSES.forEach(([k, label]) => {
      if (val(o, k)) { out.push({ key: k, label }); seen.add(k); }
    });
    Object.keys(o).sort().forEach((k) => {
      if (seen.has(k) || k === "id") return;
      if (META_KEYS.has(k) || SHEET_KEYS.has(k) || INTERNAL_KEYS.has(k)) return;
      // Only a plain non-empty string names a dish. Objects are workflow state
      // (see INTERNAL_KEYS) and numbers/booleans are never a course.
      if (typeof o[k] !== "string" || !o[k].trim()) return;
      out.push({ key: k, label: labelFor(k) });
    });
    return out;
  }

  /* A field key as the wizard wrote it, turned back into the words the client
     saw: "sandwichOrAppetizer" → "Sandwich or Appetizer". The wizard builds
     these keys by camel-casing the moderator's inclusion line, so splitting on
     the case boundaries recovers it — with "or" kept lowercase, since that is
     how the inclusion reads and how the client chose it. */
  function labelFor(key) {
    const words = String(key)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/\s+/)
      .filter(Boolean);
    return words
      .map((w, i) => {
        const lower = w.toLowerCase();
        if (i > 0 && lower === "or") return "or";
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ");
  }

  /* ── Small helpers ────────────────────────────────────────────────────── */
  const ts = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);

  function fmtDate(v) {
    const ms = ts(v);
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString("en-PH",
      { year: "numeric", month: "short", day: "numeric" });
  }

  // The wizard writes functionDate spelled out ("June 12, 2026") — parseable
  // directly. Free-typed dates that don't parse just aren't "upcoming".
  function eventMs(o) {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : 0;
  }

  function emptyRow(msg) {
    return `<tr><td colspan="8" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";
  const contactOf = (o) => String(o.contactNumber || o.email || "").trim();

  function typeBadge(o) {
    const t = typeOf(o);
    return `<span class="badge badge-cat order-type order-type--${t === "Food Pack" ? "pack" : "catering"}">
      <span class="ic">${HP.icon(t === "Food Pack" ? "box" : "party")}</span>${t}</span>`;
  }
  function statusBadge(o) {
    const m = STATUS_META[statusOf(o)];
    return `<span class="badge ${m.badge}"><span class="dot"></span>${m.label}</span>`;
  }

  /* The downpayment badge, shown under the status in the table. Silent on
     orders that predate the gate — a blank is the honest answer there. */
  function paymentBadge(o) {
    const m = paymentMeta(o);
    if (!m) return "";
    const amount = m.chase ? money(o.paymentDue) : money(o.paymentPaid || o.paymentDue);
    const taken = takenByOf(o);
    return `<span class="badge ${m.badge}" title="${HP.esc(
      m.chase ? "This order's downpayment hasn't been paid yet — it can't be confirmed until it has." :
      isPaid(o) ? (isOfflinePay(o)
        ? `Taken outside PayMongo and recorded here${taken ? " by " + taken : ""}.`
        : "The client has paid the 50% downpayment through PayMongo.") :
      "No package price to halve — arrange the downpayment with the client.")}">${
      HP.esc(m.label)}${amount ? " · " + HP.esc(amount) : ""}</span>`;
  }

  // One-line description for the table: the function kind, or the first menu
  // line of a food-pack quotation.
  function summaryOf(o) {
    if (typeOf(o) === "Food Pack") {
      const lines = String(o.menu || "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return "Food pack quotation";
      return lines[0] + (lines.length > 1 ? ` +${lines.length - 1} more` : "");
    }
    return String(o.kindOfFunction || "").trim() || "Catering booking";
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderSeg(); renderChips(); renderRows(); }

  function renderStats() {
    const alive = orders.filter((o) => !o.deleted); // trashed orders don't count
    const pending = alive.filter((o) => statusOf(o) === "pending").length;
    const confirmed = alive.filter((o) => statusOf(o) === "confirmed").length;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = alive.filter((o) =>
      ["pending", "confirmed"].includes(statusOf(o)) && eventMs(o) >= today.getTime()).length;

    HP.shell.setBadge(pending);

    const stat = (ic, num, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${num}">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("clock", pending, "Pending review") +
      stat("check", confirmed, "Confirmed") +
      stat("calendar", upcoming, "Upcoming events") +
      stat("ledger", alive.length, "All orders"))) HP.countUp(statsEl);
  }

  function renderSeg() {
    const alive = orders.filter((o) => !o.deleted);
    const count = (s) => (
      s === "all" ? alive.length
      : s === "trash" ? orders.length - alive.length
      : alive.filter((o) => statusOf(o) === s).length);
    segEl.innerHTML = ["all", ...STATUSES, "trash"].map((s) => `
      <button class="seg-btn${statusFilter === s ? " active" : ""}" data-status="${s}">
        ${s === "all" ? "All" : s === "trash" ? "Trash" : STATUS_META[s].label}
        <span class="seg-count">${count(s)}</span>
      </button>`).join("");
    segEl.querySelectorAll("[data-status]").forEach((b) =>
      b.addEventListener("click", () => {
        statusFilter = b.dataset.status;
        segEl.classList.add("anim");
        renderSeg(); renderRows();
      }));
  }

  function renderChips() {
    const types = [["all", "All types"], ["Catering", "Catering"], ["Food Pack", "Food Packs"]];
    const dates = [["all", "Any date"], ["7", "Next 7 days"], ["30", "Next 30 days"], ["past", "Past events"]];
    const sorts = [["received", "Newest received"], ["event", "By event date"]];
    chipsEl.innerHTML =
      types.map(([v, label]) =>
        `<button class="chip-filter${typeFilter === v ? " active" : ""}" data-type="${v}">${label}</button>`).join("")
      + dates.map(([v, label]) =>
        `<button class="chip-filter${dateFilter === v ? " active" : ""}" data-date="${v}">${label}</button>`).join("")
      + sorts.map(([v, label]) =>
        `<button class="chip-filter${sortMode === v ? " active" : ""}" data-sort="${v}">${label}</button>`).join("");
    chipsEl.querySelectorAll("[data-type]").forEach((b) =>
      b.addEventListener("click", () => {
        typeFilter = b.dataset.type;
        renderChips(); renderRows();
      }));
    chipsEl.querySelectorAll("[data-date]").forEach((b) =>
      b.addEventListener("click", () => {
        dateFilter = b.dataset.date;
        renderChips(); renderRows();
      }));
    chipsEl.querySelectorAll("[data-sort]").forEach((b) =>
      b.addEventListener("click", () => {
        sortMode = b.dataset.sort;
        renderChips(); renderRows();
      }));
  }

  // Event-date window: "next N days" = today through day N; past = strictly
  // before today. Undated orders only show under "Any date".
  function matchesDate(o) {
    if (dateFilter === "all") return true;
    const t = eventMs(o);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (dateFilter === "past") return !!t && t < today.getTime();
    const end = today.getTime() + (Number(dateFilter) + 1) * 864e5;
    return !!t && t >= today.getTime() && t < end;
  }

  function matches(o) {
    // Trashed orders show ONLY under the Trash tab.
    if (statusFilter === "trash") { if (!o.deleted) return false; }
    else if (o.deleted) return false;
    else if (statusFilter !== "all" && statusOf(o) !== statusFilter) return false;
    if (typeFilter !== "all" && typeOf(o) !== typeFilter) return false;
    if (!matchesDate(o)) return false;
    if (!query) return true;
    return [o.clientName, o.contactNumber, o.email, o.kindOfFunction, o.venue, o.package, o.menu]
      .some((v) => String(v || "").toLowerCase().includes(query));
  }

  // The rows in view: filtered, then sorted per the active sort chip.
  function viewList() {
    const list = orders.filter(matches);
    if (sortMode === "event") {
      const FAR = Number.MAX_SAFE_INTEGER; // undated sinks to the bottom
      list.sort((a, b) => (eventMs(a) || FAR) - (eventMs(b) || FAR));
    }
    return list;
  }
  const filtersActive = () =>
    statusFilter !== "all" || typeFilter !== "all" || dateFilter !== "all" || !!query;

  // The "load older" table foot — shown while more history may exist.
  function olderRowHTML() {
    if (!mayHaveOlder || olderDone) return "";
    return `<tr><td colspan="8" class="table-empty">
      <button class="btn btn-ghost" id="loadOlder" ${loadingOlder ? "disabled" : ""}>
        <span class="ic">${HP.icon("undo")}</span>${loadingOlder ? "Loading older orders…" : "Load older orders"}
      </button></td></tr>`;
  }
  function wireLoadOlder() {
    const b = document.getElementById("loadOlder");
    if (b) b.addEventListener("click", loadOlder);
  }

  async function loadOlder() {
    if (loadingOlder || olderDone || !mayHaveOlder) return;
    loadingOlder = true;
    renderRows();
    try {
      let q = db.collection("bookings").orderBy("createdAt", "desc");
      const cursor = olderCursor || liveTail;
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.limit(OLDER_PAGE).get();
      olderCursor = snap.docs[snap.docs.length - 1] || olderCursor;
      if (snap.size < OLDER_PAGE) olderDone = true;
      older = older.concat(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      mergeOrders();
      renderAll();
    } catch (e) {
      console.error("HapagPamana: couldn't load older orders —", e);
      HP.toast("Couldn't load older orders — check your connection.", "danger");
    } finally {
      loadingOlder = false;
      renderRows();
    }
  }

  function renderRows() {
    if (!loaded) return;
    const list = viewList();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(orders.length
        ? "No orders match your filters."
        : "No orders yet — bookings appear here the moment a customer submits one in the app.")
        + olderRowHTML();
      wireLoadOlder();
      return;
    }
    HP.shell.paint(rowsEl, list.map((o) => `
      <tr data-id="${HP.esc(o.id)}" class="order-row">
        <td>
          <div class="cell-name">
            <div>
              <strong>${HP.esc(clientName(o))}</strong>
              <small>${HP.esc(contactOf(o) || "no contact on file")}</small>
            </div>
          </div>
        </td>
        <td>${typeBadge(o)}</td>
        <td>
          <div class="cell-name"><div>
            <strong class="order-fn">${HP.esc(summaryOf(o))}</strong>
            <small>${HP.esc(String(o.venue || "").trim() || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(String(o.functionDate || "").trim() || "—")}</td>
        <td>${HP.esc(String(o.pax || "").trim() || "—")}</td>
        <td>${fmtDate(o.createdAt)}</td>
        <td>${statusBadge(o)}${
          paymentBadge(o) ? `<div class="cell-pay">${paymentBadge(o)}</div>` : ""}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="view" title="View the booking sheet" aria-label="View ${HP.esc(clientName(o))}'s order"><span class="ic">${HP.icon("eye")}</span></button>
            ${statusOf(o) !== "pending" ? ""
              : isUnpaid(o)
                // Locked, and says so on hover — clicking explains why and
                // offers to record a payment taken by hand.
                ? `<button class="icon-btn is-locked" data-act="confirm" title="Locked — ${HP.esc(clientName(o))} hasn't paid the downpayment" aria-label="Confirm is locked — ${HP.esc(clientName(o))} hasn't paid the downpayment"><span class="ic">${HP.icon("ban")}</span></button>`
                : `<button class="icon-btn" data-act="confirm" title="Confirm this order" aria-label="Confirm ${HP.esc(clientName(o))}'s order"><span class="ic">${HP.icon("check")}</span></button>`}
          </div>
        </td>
      </tr>`).join("") + olderRowHTML());
    wireLoadOlder();

    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onAction));
    // The whole row opens the sheet (buttons handle their own clicks).
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const o = orders.find((x) => x.id === tr.dataset.id);
        if (o) openSheet(o);
      }));
  }

  function onAction(e) {
    e.stopPropagation();
    const btn = e.currentTarget;
    const id = btn.closest("tr").dataset.id;
    const o = orders.find((x) => x.id === id);
    if (!o) return;
    if (btn.dataset.act === "view") openSheet(o);
    else if (btn.dataset.act === "confirm") confirmOrder(o);
  }

  /* Confirming feeds the Master Chef's prep board — never one accidental click
     away, and never before the downpayment is in.

     The downpayment is the gate: an order still `awaiting` can't be confirmed at
     all, because confirming tells the kitchen to start planning for an event
     nobody has paid to hold. The way through is the money, not an override — so
     the block explains itself and offers the one legitimate answer, which is to
     record a payment you took another way (recordPaymentModal). The same rule is
     re-checked inside the transaction, against the order's live state, so this
     can't be walked around with a stale row. */
  function confirmOrder(o) {
    if (isUnpaid(o)) return paymentLockedModal(o);
    HP.confirmModal("Confirm order",
      `Confirm ${clientName(o)}'s ${typeOf(o).toLowerCase()} order? It goes straight onto the Master Chef's prep board.`,
      () => setStatus(o, "confirmed"), false);
  }

  // Why Confirm is locked, and the two ways it unlocks: the client pays in the
  // app, or you record what you took by hand.
  function paymentLockedModal(o) {
    const due = money(o.paymentDue);
    HP.openModal("The downpayment hasn't landed", `
      <p class="modal-text">${HP.esc(clientName(o))} hasn't paid the ${
        HP.esc(due || "50%")} downpayment, so this order can't be confirmed
        onto the Master Chef's prep board yet.</p>
      <p class="modal-text">The client can settle it themselves from Order
        Tracking in the app. If you've already taken it in cash, by transfer or
        over GCash, record it here and the order clears for confirmation.</p>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="lkRecord"><span class="ic">${HP.icon("peso")}</span>Record a payment</button>`);
    document.getElementById("lkRecord").addEventListener("click", () => {
      HP.closeModal();
      recordPaymentModal(o);
    });
  }

  /* Records a downpayment the order manager took outside PayMongo. It writes the
     same keys the app's PayMongo flow writes — so the client's Order Tracking
     reads "Downpayment received" either way — plus `paymentSource: "offline"`
     and who took it, which is what keeps the two apart on the sheet and in any
     later reconciliation against the PayMongo dashboard. */
  function recordPaymentModal(o) {
    const due = Number(o.paymentDue) || 0;
    const METHODS = ["Cash", "Bank transfer", "GCash (direct)", "Maya (direct)", "Cheque"];
    HP.openModal(`Record a payment — ${clientName(o)}`, `
      <p class="modal-text">Only once the money is actually in hand. This tells
        the client's app their downpayment is received, and clears the order for
        confirmation.</p>
      <form id="payForm" novalidate>
        <div class="field-row">
          <div class="field"><label>Amount received (₱) <span class="req">*</span></label>
            <input class="control" name="amount" type="number" min="1" step="1"
              inputmode="numeric" value="${due > 0 ? Math.round(due) : ""}"
              placeholder="e.g. 2500">
            <div class="field-hint">${due > 0
              ? `The 50% downpayment on this order is ${HP.esc(money(due))}.`
              : "This order was filed without a priced package, so there's no figure to go by."}</div>
            <div class="field-error" data-err="amount" hidden></div></div>
          <div class="field"><label>Taken as <span class="req">*</span></label>
            <select class="control" name="method">
              ${METHODS.map((m) => `<option>${HP.esc(m)}</option>`).join("")}
            </select>
            <div class="field-hint">How the client handed it over.</div></div>
        </div>
        <div class="field"><label>Reference or note</label>
          <input class="control" name="note" maxlength="120"
            placeholder="e.g. receipt no. 0142">
          <div class="field-hint">Your own reconciliation trail. The client sees
            it as the payment's reference in the app.</div></div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="paySave"><span class="ic">${HP.icon("check")}</span>Record the payment</button>`);
    document.getElementById("paySave").addEventListener("click", () => {
      const f = document.getElementById("payForm");
      const amount = Number(f.elements.amount.value);
      if (!HP.setErr(f, "amount", Number.isFinite(amount) && amount > 0
        ? "" : "Enter the amount you received.")) return;
      recordPayment(o, {
        amount: Math.round(amount),
        method: f.elements.method.value,
        note: f.elements.note.value.trim(),
      });
    });
  }

  async function recordPayment(o, { amount, method, note }) {
    const btn = document.getElementById("paySave");
    if (btn) btn.disabled = true;
    const me = HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null;
    // The same keys the app's PayMongo flow writes, so the client's Order
    // Tracking reads this as a settled downpayment either way.
    const paid = {
      paymentStatus: "paid",
      paymentPaid: amount,
      paymentMethod: method,
      ...(note ? { paymentRef: note } : {}),
      paymentSource: "offline",
      paymentTakenBy: me,
      paymentTakenByName: HP.user.name || "",
    };
    const wasPending = statusOf(o) === "pending";
    try {
      await db.collection("bookings").doc(o.id).update({
        ...paid,
        paidAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...auditStamp(),
      });
      // Older, non-streamed rows update in place (the live window repaints from
      // the snapshot). Only real values go into the local copy — a
      // serverTimestamp() sentinel would read as a broken date until the
      // snapshot lands, so the client clock stands in for it.
      Object.assign(o, paid, { paidAt: firebase.firestore.Timestamp.now() });
      mergeOrders();
      renderAll();
      HP.closeModal();
      HP.toast(`${money(amount)} recorded for ${clientName(o)}${
        wasPending ? " — the order can now be confirmed." : "."}`);
    } catch (e) {
      console.error("HapagPamana: couldn't record the payment —", e);
      if (btn) btn.disabled = false;
      HP.toast("Couldn't record the payment — check your connection and the Firestore rules.", "danger");
    }
  }

  /* ── Status workflow ──────────────────────────────────────────────────── */
  const STATUS_TOAST = {
    confirmed: (o) => `${clientName(o)}'s order is confirmed — it's now on the Master Chef's prep board.`,
    completed: (o) => `${clientName(o)}'s order is marked completed.`,
    declined:  (o) => `${clientName(o)}'s order was declined.`,
    pending:   (o) => `${clientName(o)}'s order is back in the pending queue.`,
  };

  const NOTIF_COPY = {
    confirmed: {
      title: "Booking Confirmed",
      body: "Great news — your booking is confirmed! We'll be in touch for the details.",
    },
    completed: {
      title: "Booking Completed",
      body: "Your event with Hapag Pamana is done. Salamat — hope it was special!",
    },
    declined: {
      title: "Booking Declined",
      body: "Your booking couldn't be accommodated. Tap to review your details.",
    },
  };

  function sendCustomerNotification(uid, bookingId, status) {
    if (!uid || !NOTIF_COPY[status]) return;
    const { title, body } = NOTIF_COPY[status];
    db.collection("notifications").doc(uid).collection("items").add({
      title,
      body,
      type: "order_update",
      isRead: false,
      bookingId: bookingId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).catch((e) => console.warn("HapagPamana: couldn't post customer notification —", e));
  }

  /* The moves the workflow allows from each status. Validated inside the
     transaction against the doc's CURRENT status — never the copy a sheet
     was painted from — so a stale sheet can't re-route an order another
     manager already moved. `completed` is final: a done order is never
     resurrected onto the Master Chef's prep board. */
  const NEXT_STATUS = {
    pending:   ["confirmed", "declined"],
    confirmed: ["completed", "declined", "pending"],
    completed: [],
    declined:  ["pending"],
  };

  // Audit stamp on every dashboard write to a booking.
  const auditStamp = () => ({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null,
  });
  // A status-history entry. Client-clock Timestamp — serverTimestamp() is
  // not allowed inside array elements.
  const historyEntry = (status) => ({
    status,
    at: firebase.firestore.Timestamp.now(),
    by: HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null,
    byName: HP.user.name || "",
  });

  async function setStatus(o, status) {
    const ref = db.collection("bookings").doc(o.id);
    // The order as the transaction actually found it, kept for the
    // recommendation tally below — that has to count what was really completed,
    // not the possibly-stale row this click came from.
    let committed = null;
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          const err = new Error("order deleted"); err.code = "hp/gone"; throw err;
        }
        const cur = STATUS_META[snap.data().status] ? snap.data().status : "pending";
        if (cur === status) return; // another manager already made this exact move
        if (!NEXT_STATUS[cur].includes(status)) {
          const err = new Error("stale transition"); err.code = "hp/stale"; err.current = cur; throw err;
        }
        // The downpayment gate, judged on the order as it stands right now —
        // not on the row this click came from, which may have been painted
        // before the client's payment was reversed or the order re-filed.
        if (status === "confirmed" && isUnpaid(snap.data())) {
          const err = new Error("downpayment outstanding"); err.code = "hp/unpaid"; throw err;
        }
        // update(), never a merge-set: a set() would resurrect a booking
        // another manager deleted between the sheet opening and this click.
        tx.update(ref, {
          status,
          statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          history: firebase.firestore.FieldValue.arrayUnion(historyEntry(status)),
          ...auditStamp(),
        });
        // Only set once the move is real. The `cur === status` return above
        // leaves this null, which is what stops a second manager's duplicate
        // click from counting the same order twice.
        committed = snap.data();
      });
      // The snapshot listener repaints the live window; update in place (and
      // repaint) so older, non-streamed rows and the open modal follow too.
      o.status = status;
      renderAll();
      // Once an order leaves the prep board (completed / declined), its
      // ingredient plan is spent — clear it so the Master Chef's scoped
      // stream and the shopping list never total dead events. Best-effort:
      // the plan may simply not exist.
      if (status === "completed" || status === "declined") {
        db.collection("prepPlans").doc(o.id).delete()
          .catch((e) => console.warn("HapagPamana: couldn't clear the prep plan —", e));
      }
      // A completed order is the one event the recommendation engine counts —
      // see Admin/assets/hp-recommend.js for why this desk keeps that tally at
      // all. Deliberately NOT awaited: the manager's click is finished, the
      // status is written, and a statistic must never hold up the toast or fail
      // a move that already succeeded. `committed` is null when the transaction
      // made no move (a duplicate click), which is what keeps the count honest.
      if (status === "completed" && committed && window.HPRec) {
        HPRec.recordCompletion(db, committed);
      }
      sendCustomerNotification(o.uid || (committed && committed.uid), o.id, status);
      HP.toast(STATUS_TOAST[status](o), status === "declined" ? "warn" : "ok");
    } catch (e) {
      if (e && (e.code === "hp/gone" || e.code === "not-found")) {
        HP.toast(`${clientName(o)}'s order no longer exists — it was deleted in another session.`, "warn");
      } else if (e && e.code === "hp/stale") {
        HP.toast(`Couldn't apply that — ${clientName(o)}'s order is now ${STATUS_META[e.current].label.toLowerCase()} (changed in another session).`, "warn");
      } else if (e && e.code === "hp/unpaid") {
        HP.toast(`Couldn't confirm — ${clientName(o)}'s downpayment is outstanding as of right now.`, "warn");
      } else {
        console.error(e);
        HP.toast("Couldn't update the order — check the Firestore rules.", "danger");
      }
    }
  }

  // Soft delete: the booking keeps its document, flagged `deleted`, and
  // waits in the Trash tab until restored or deleted forever. Its prep plan
  // is cleared right away (the chef re-plans if it's ever restored).
  function onDelete(o) {
    HP.confirmModal("Delete order",
      `Move ${clientName(o)}'s ${typeOf(o).toLowerCase()} order to the Trash? Restore it any time from the Trash tab.`,
      async () => {
        try {
          await db.collection("bookings").doc(o.id).update({
            deleted: true,
            deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
            deletedBy: HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null,
            ...auditStamp(),
          });
          o.deleted = true; // older (non-streamed) rows update in place
          db.collection("prepPlans").doc(o.id).delete()
            .catch((e) => console.warn("HapagPamana: couldn't clear the prep plan —", e));
          mergeOrders();
          renderAll();
          HP.toast("Order moved to Trash.", "warn");
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't delete the order — check the Firestore rules.", "danger");
        }
      });
  }

  async function restoreOrder(o) {
    try {
      const gone = firebase.firestore.FieldValue.delete();
      await db.collection("bookings").doc(o.id).update({
        deleted: gone, deletedAt: gone, deletedBy: gone, ...auditStamp(),
      });
      delete o.deleted; delete o.deletedAt; delete o.deletedBy;
      mergeOrders();
      renderAll();
      HP.toast(`${clientName(o)}'s order is restored.`);
    } catch (e) {
      console.error(e);
      HP.toast("Couldn't restore the order — check the Firestore rules.", "danger");
    }
  }

  function foreverDelete(o) {
    HP.confirmModal("Delete forever",
      `Permanently delete ${clientName(o)}'s ${typeOf(o).toLowerCase()} order? This removes the record for the customer too and cannot be undone.`,
      async () => {
        try {
          await db.collection("bookings").doc(o.id).delete();
          older = older.filter((x) => x.id !== o.id);
          mergeOrders();
          renderAll();
          HP.toast("Order permanently deleted.", "warn");
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't delete the order — check the Firestore rules.", "danger");
        }
      });
  }

  /* ── The booking sheet (detail modal) ─────────────────────────────────── */
  const val = (o, k) => String(o[k] || "").trim();

  /* Dish photos. The wizards fill each course with an exact product name, so
     the sheet can look the dish up in `products` (public read) and show its
     photo. Fetched lazily per sheet — never the whole multi-megabyte menu —
     and remembered for the session ("" = looked up, no photo). */
  const dishCache = new Map();
  const dishKey = (n) => String(n || "").trim().toLowerCase();
  const safeImage = (v) =>
    (/^(data:image\/|https?:\/\/)/i.test(String(v || "")) ? String(v) : "");

  /* Room setup photos. `setupStyle` on the booking is the title of a card on
     the Content Moderator's Setups gallery (`setups` collection, public
     read) — looked up the same lazy, per-session-cached way as dish photos. */
  const setupCache = new Map();
  const setupKey = (n) => String(n || "").trim().toLowerCase();

  async function hydrateSetupPhotos() {
    if (!db) return;
    const root = document.querySelector(".order-sheet");
    if (!root) return;
    const names = [...new Set(
      [...root.querySelectorAll("[data-setup]")].map((el) => el.dataset.setup),
    )].filter((n) => n && !setupCache.has(setupKey(n)));
    if (!names.length) return;

    const chunks = [];
    for (let i = 0; i < names.length; i += 10) chunks.push(names.slice(i, i + 10));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const snap = await db.collection("setups").where("title", "in", chunk).get();
        snap.forEach((doc) => {
          const d = doc.data() || {};
          setupCache.set(setupKey(d.title), safeImage(d.image));
        });
      } catch (e) {
        console.warn("HapagPamana: couldn't fetch the setup photos —", e);
      }
      chunk.forEach((n) => { if (!setupCache.has(setupKey(n))) setupCache.set(setupKey(n), ""); });
    }));
    paintSetupPhotos();
  }

  function paintSetupPhotos() {
    document.querySelectorAll(".order-sheet [data-setup]").forEach((el) => {
      const img = setupCache.get(setupKey(el.dataset.setup));
      const thumb = el.querySelector(".setup-thumb");
      if (!img || !thumb || thumb.classList.contains("has-img")) return;
      thumb.textContent = "";
      const tag = document.createElement("img");
      tag.src = img;
      tag.alt = "";
      tag.loading = "lazy";
      thumb.appendChild(tag);
      thumb.classList.add("has-img");
    });
  }

  async function hydrateDishPhotos() {
    if (!db) return;
    const root = document.querySelector(".order-sheet");
    if (!root) return;
    const names = [...new Set(
      [...root.querySelectorAll("[data-dish]")].map((el) => el.dataset.dish),
    )].filter((n) => n && !dishCache.has(dishKey(n)));
    if (!names.length) return;

    // Firestore `in` takes at most 10 values per query — chunk the lookups.
    const chunks = [];
    for (let i = 0; i < names.length; i += 10) chunks.push(names.slice(i, i + 10));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const snap = await db.collection("products").where("name", "in", chunk).get();
        snap.forEach((doc) => {
          const d = doc.data() || {};
          dishCache.set(dishKey(d.name), safeImage(d.image));
        });
      } catch (e) {
        console.warn("HapagPamana: couldn't fetch the dish photos —", e);
      }
      // Free-typed dishes that match no product: remember the miss too.
      chunk.forEach((n) => { if (!dishCache.has(dishKey(n))) dishCache.set(dishKey(n), ""); });
    }));
    paintDishPhotos();
  }

  function paintDishPhotos() {
    document.querySelectorAll(".order-sheet [data-dish]").forEach((el) => {
      const img = dishCache.get(dishKey(el.dataset.dish));
      const thumb = el.querySelector(".dish-thumb");
      if (!img || !thumb || thumb.classList.contains("has-img")) return;
      thumb.textContent = "";
      const tag = document.createElement("img");
      tag.src = img;
      tag.alt = "";
      tag.loading = "lazy";
      thumb.appendChild(tag);
      thumb.classList.add("has-img");
    });
  }

  /* The occasion at a glance — date, headcount, function and venue as tiles,
     so the order manager reads the essentials without hunting. */
  function heroHTML(o) {
    const tile = (ic, label, value, wide) => (value ? `
      <div class="hero-tile${wide ? " hero-tile--wide" : ""}">
        <span class="hero-ic"><span class="ic">${HP.icon(ic)}</span></span>
        <div class="hero-txt"><small>${HP.esc(label)}</small><strong>${HP.esc(value)}</strong></div>
      </div>` : "");
    const pax = val(o, "pax");
    const html =
      tile("calendar", "Date of function", val(o, "functionDate")) +
      tile("users", "Guests", pax && (/^\d+$/.test(pax) ? `${pax} pax` : pax)) +
      tile("party", "Kind of function", val(o, "kindOfFunction")) +
      tile("pin", "Venue", val(o, "venue"), true) +
      tile("pin", "Address", val(o, "address"), true);
    return html ? `<div class="order-hero">${html}</div>` : "";
  }

  function clientHTML(o) {
    const name = val(o, "clientName");
    const phone = val(o, "contactNumber");
    const email = val(o, "email");
    if (!name && !phone && !email) return "";
    const chip = (ic, txt, href) => (txt ? `
      <a class="contact-chip" href="${HP.esc(href)}">
        <span class="ic">${HP.icon(ic)}</span>${HP.esc(txt)}</a>` : "");
    return `<section class="order-sec">
      <h4>The client</h4>
      <div class="order-client">
        <div class="client-ava">${HP.esc((name.charAt(0) || "·").toUpperCase())}</div>
        <div class="client-txt">
          <strong>${HP.esc(name || "Unnamed client")}</strong>
          <div class="client-chips">
            ${chip("phone", phone, "tel:" + phone.replace(/[^\d+]/g, ""))}
            ${chip("mail", email, "mailto:" + email)}
          </div>
        </div>
      </div>
    </section>`;
  }

  /* Setup and program times merged into one chronological timeline — the day
     as it will actually run, not two scattered sections. */
  function timelineHTML(o) {
    const rows = TIMELINE.filter(([k]) => val(o, k)).map(([k, label, sub]) => `
      <li class="tl-row">
        <time>${HP.esc(val(o, k))}</time>
        <span class="tl-rail"><span class="tl-dot"></span></span>
        <div class="tl-txt"><strong>${HP.esc(label)}</strong><small>${HP.esc(sub)}</small></div>
      </li>`);
    if (!rows.length) return "";
    return `<section class="order-sec">
      <h4>The day's schedule</h4>
      <ol class="order-times">${rows.join("")}</ol>
    </section>`;
  }

  /* The room the client is getting, gathered from the three desks that decide
     it: the look the client chose in the app (`setupStyle` — the title of a
     card on the Content Moderator's Setups gallery, so the crew can look the
     exact photo up rather than work from a description), the floor plan the
     Layout Designer drew, and the gear the Catering Equipment desk has pulled.

     Each of those desks renders its own record properly on its own board; the
     office only needs to know where each one stands, so this summarises rather
     than repeats. Without it the plan and the checklist reached the Orders
     sheet as "[object Object]" under "More details" (see INTERNAL_KEYS) and
     the chosen look was read as though it were a dish. */
  const EQUIP_PREP = {
    pending: "Not started",
    in_progress: "Checklist in progress",
    ready: "Ready for release",
    returned: "Returned",
  };
  const EQUIP_PICKUP = {
    requested: "waiting on logistics",
    picked_up: "picked up by logistics",
    delivered: "delivered to the venue",
  };
  function roomHTML(o) {
    const look = val(o, "setupStyle");

    const facts = [];
    const l = o.layout;
    if (l && typeof l === "object") {
      const items = Array.isArray(l.items) ? l.items.length : 0;
      const seated = Number(l.seated) || 0;
      const r = l.room;
      if (items) {
        facts.push(["Floor plan",
          `${items} piece${items === 1 ? "" : "s"}${seated ? ` · seats ${seated}` : ""}${
            r && r.w && r.h ? ` · room ${r.w} × ${r.h} m` : ""}`]);
      }
      /* The dressing the Layout Designer actually drew the room in. Named only
         when it differs from what the client asked for — the desk may override
         a choice (a look that can't be built in that venue), and that is worth
         the office seeing before the client rings about it. */
      const dressed = String((l.setup && l.setup.title) || "").trim();
      if (dressed && dressed.toLowerCase() !== look.toLowerCase()) {
        facts.push(["Dressed for", dressed]);
      }
    }

    const eq = o.equipmentPrep;
    if (eq && typeof eq === "object") {
      const lines = Array.isArray(eq.checklist) ? eq.checklist.length : 0;
      const stage = (o.equipmentPickup || {}).stage;
      facts.push(["Equipment",
        `${EQUIP_PREP[eq.status] || "Not started"}${
          lines ? ` · ${lines} line${lines === 1 ? "" : "s"}` : ""}${
          EQUIP_PICKUP[stage] ? ` · ${EQUIP_PICKUP[stage]}` : ""}`]);
    }

    if (!look && !facts.length) return "";
    const lookImg = look ? setupCache.get(setupKey(look)) : "";
    const thumb = look ? `<span class="setup-thumb${lookImg ? " has-img" : ""}" data-setup="${HP.esc(look)}">${
      lookImg ? `<img src="${HP.esc(lookImg)}" alt="" loading="lazy">` : `<span class="ic">${HP.icon("photo")}</span>`
    }</span>` : "";
    return `<section class="order-sec">
      <h4>The room</h4>
      ${look ? `<div class="order-pkg">${thumb}
        <div><small>Table &amp; venue set-up</small><strong>${HP.esc(look)}</strong></div></div>` : ""}
      ${facts.length ? `<dl class="order-facts">${facts.map(([k, v]) => `
        <div class="order-fact"><dt>${HP.esc(k)}</dt><dd>${HP.esc(v)}</dd></div>`).join("")}</dl>` : ""}
    </section>`;
  }

  function dishCard(name, course, pax) {
    const img = dishCache.get(dishKey(name));
    const thumb = img
      ? `<span class="dish-thumb has-img"><img src="${HP.esc(img)}" alt="" loading="lazy"></span>`
      : `<span class="dish-thumb">${HP.esc((name.charAt(0) || "·").toUpperCase())}</span>`;
    return `<div class="dish-card" data-dish="${HP.esc(name)}">
      ${thumb}
      <div class="dish-txt"><small>${HP.esc(course)}</small><strong>${HP.esc(name)}</strong></div>
      ${pax ? `<span class="dish-pax">${HP.esc(pax)}</span>` : ""}
    </div>`;
  }

  function menuHTML(o) {
    const cards = [];
    if (typeOf(o) === "Food Pack") {
      // Quotation lines: "Dish name (N pax)" from the picker, or free text.
      String(o.menu || "").split("\n").map((s) => s.trim()).filter(Boolean).forEach((line) => {
        const m = line.match(/^(.*?)\s*\((\d+)\s*pax\)$/i);
        cards.push(dishCard((m ? m[1] : line).trim(), "Menu", m ? `${m[2]} pax` : ""));
      });
    } else {
      courseKeys(o).forEach(({ key, label }) => {
        const v = val(o, key);
        if (v) cards.push(dishCard(v, label, ""));
      });
    }
    const pkg = val(o, "package");
    const addons = val(o, "menuAddOns");
    // Each line is "Dish name × qty — ₱rate/pax" (or "— to be quoted") from
    // the booking wizard's add-on picker — split on the same " × " separator
    // _restoreAddOns reads, so each add-on gets its own photo card instead of
    // one unbroken block of text.
    const addonCards = String(addons || "").split("\n").map((s) => s.trim()).filter(Boolean)
      .map((line) => {
        const sep = line.indexOf(" × ");
        const name = sep === -1 ? line : line.slice(0, sep).trim();
        const rest = sep === -1 ? "" : line.slice(sep + 3).trim();
        return dishCard(name, "Add-on", rest);
      });
    if (!cards.length && !pkg && !addonCards.length) return "";
    return `<section class="order-sec">
      <h4>Package &amp; menu</h4>
      ${pkg ? `<div class="order-pkg"><span class="ic">${HP.icon("dish")}</span>
        <div><small>Package</small><strong>${HP.esc(pkg)}</strong></div></div>` : ""}
      ${cards.length ? `<div class="dish-grid">${cards.join("")}</div>` : ""}
      ${addonCards.length ? `<div class="dish-grid">${addonCards.join("")}</div>` : ""}
    </section>`;
  }

  /* The order's money: what it comes to, what the 50% downpayment was, and
     whether it landed. The figures are the ones the app stamped on the order
     when it was filed, so this still reads true after the package's price has
     moved on.

     Nothing is drawn for an order filed before the gate existed — it carries no
     figures, and an empty ledger would only raise questions. */
  function paymentHTML(o) {
    const m = paymentMeta(o);
    if (!m) return "";
    const total = money(o.paymentTotal);
    const settled = money(o.paymentPaid || o.paymentDue);
    const due = money(o.paymentDue);
    const offline = isOfflinePay(o);
    const facts = [];
    if (total) facts.push(["Order total", total]);
    // The total's two halves, when the app worked the order out from a priced
    // package plus priced add-ons. Shown under the total so "why is this more
    // than the package?" is answered on the sheet rather than by arithmetic.
    if (total && money(o.addOnsTotal)) {
      if (money(o.packageTotal)) facts.push(["· Package", money(o.packageTotal)]);
      facts.push(["· Add-ons", money(o.addOnsTotal)]);
    }
    if (money(o.discountTotal)) {
      facts.push(["· Promo discount", `-${money(o.discountTotal)}`]);
      if (o.packageDiscount) facts.push(["· Package promo", String(o.packageDiscount)]);
      if (money(o.addOnsDiscountTotal)) facts.push(["· Add-ons savings", `-${money(o.addOnsDiscountTotal)}`]);
      if (Array.isArray(o.appliedPromos) && o.appliedPromos.length) {
        facts.push(["· Applied promos", o.appliedPromos.join(", ")]);
      }
    }
    if (isPaid(o)) {
      if (settled) facts.push([offline ? "Downpayment taken" : "Downpayment paid", settled]);
      if (total && settled) facts.push(["Balance on the day",
        money(Number(o.paymentTotal) - Number(o.paymentPaid || o.paymentDue))]);
      if (ts(o.paidAt)) facts.push(["Settled", fmtDateTime(ts(o.paidAt))]);
      if (val(o, "paymentMethod")) facts.push(["Paid with", val(o, "paymentMethod")]);
      if (offline && takenByOf(o)) facts.push(["Recorded by", takenByOf(o)]);
      // PayMongo's own payment id, or — on a payment taken by hand — whatever
      // reference the manager wrote down. Labelled for which it is: calling a
      // receipt number a "PayMongo ref" would send the next person hunting for
      // it in a dashboard it was never in.
      if (val(o, "paymentRef")) {
        facts.push([offline ? "Reference" : "PayMongo ref", val(o, "paymentRef")]);
      }
    } else if (isUnpaid(o)) {
      if (due) facts.push(["Downpayment due", due]);
    }
    return `<section class="order-sec">
      <h4>The downpayment ${paymentBadge(o)}</h4>
      ${m.chase ? `<p class="modal-text"><strong>This order can't be confirmed until the downpayment is in.</strong> The client can settle it themselves from Order Tracking in the app — or, if you've already taken it in cash or by transfer, use <em>Record payment</em> below.</p>` : ""}
      ${paymentOf(o) === "quote_needed" ? `<p class="modal-text">This order was placed without a priced package, so the app had nothing to halve. Send the client a quotation and arrange the downpayment with them — then record it below.</p>` : ""}
      ${offline ? `<p class="modal-text">Taken outside PayMongo and recorded here, so there's nothing to match against the PayMongo dashboard for this one.</p>` : ""}
      ${facts.length ? `<dl class="order-facts">${facts.map(([k, v]) => `
        <div class="order-fact"><dt>${HP.esc(k)}</dt><dd>${HP.esc(v)}</dd></div>`).join("")}</dl>` : ""}
    </section>`;
  }

  /* Anything the app adds later still shows up, under "More details" — but a
     course now belongs to the menu section above, and structured workflow
     state belongs to neither (it would print as "[object Object]"). Both are
     excluded here rather than at the source, so a genuinely new text field the
     app starts writing is still surfaced rather than silently dropped. */
  function extrasHTML(o) {
    const courses = new Set(courseKeys(o).map((c) => c.key));
    const rows = Object.keys(o)
      .filter((k) => k !== "id" && !META_KEYS.has(k) && !SHEET_KEYS.has(k)
        && !INTERNAL_KEYS.has(k) && !courses.has(k) && val(o, k))
      .sort()
      .map((k) => `
        <div class="order-fact">
          <dt>${HP.esc(k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()))}</dt>
          <dd>${HP.esc(val(o, k)).replace(/\n/g, "<br>")}</dd>
        </div>`);
    if (!rows.length) return "";
    return `<section class="order-sec"><h4>More details</h4><dl class="order-facts">${rows.join("")}</dl></section>`;
  }

  // The order's paper trail: received, then every status move (who, when).
  function fmtDateTime(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-PH",
      { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  /* What the kitchen and logistics did to the order, as timeline entries.

     The two desks keep their own record under `fulfilment` (the same one the
     Team Leader and Logistics rails read — see assets/hp-fulfilment.js), so
     until now the office could see an order confirmed and completed with no
     account of the hours in between: who cooked it, when it was released, when
     it actually reached the venue. Those are the questions asked when a client
     rings about a late delivery, and the answers were a dashboard away.

     Only movements that actually happened are listed. A release REQUEST and a
     REFUSAL are milestones too — a refusal especially, since it is why an
     order sat still — so both are named rather than folded into the stages. */
  function fulfilmentEntries(o) {
    const f = o && o.fulfilment;
    if (!f || typeof f !== "object") return [];
    // Labels come from the shared stage table when it is loaded, so the office
    // and the two desks always call a stage by the same name.
    const W = window.HPFul;
    const labelOf = (k) => (W && W.labelOf ? W.labelOf(k) : String(k || "—"));
    const out = [];
    const at = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : Number(v) || 0);

    (Array.isArray(f.history) ? f.history : []).forEach((h) => {
      const ms = at(h.at);
      if (!ms) return;
      out.push({
        label: labelOf(h.stage),
        at: ms,
        by: String(h.byName || ""),
        note: String(h.note || ""),
      });
    });
    if (at(f.requestedAt)) {
      out.push({
        label: "Release requested",
        at: at(f.requestedAt),
        by: String(f.requestedByName || ""),
        note: String(f.requestNote || ""),
      });
    }
    if (at(f.rejectedAt)) {
      out.push({
        label: "Release refused",
        at: at(f.rejectedAt),
        by: String(f.rejectedByName || ""),
        note: String(f.rejectReason || ""),
      });
    }
    return out;
  }

  function historyHTML(o) {
    const moves = Array.isArray(o.history) ? o.history : [];
    const paidMs = ts(o.paidAt);
    const ful = fulfilmentEntries(o);
    // Nothing beyond "received" — skip the section.
    if (!moves.length && !o.deleted && !paidMs && !ful.length) return "";
    const entries = [{ label: "Received", at: ts(o.createdAt), by: "" }];
    moves.forEach((h) => {
      const m = STATUS_META[h.status];
      entries.push({ label: m ? m.label : String(h.status || "—"), at: ts(h.at), by: String(h.byName || "") });
    });
    // The downpayment belongs on the paper trail: whether it landed before or
    // after the order was confirmed is exactly what this timeline is for.
    if (paidMs) {
      entries.push({
        label: isOfflinePay(o) ? "Downpayment recorded" : "Downpayment paid",
        at: paidMs,
        by: isOfflinePay(o) ? takenByOf(o) : "PayMongo",
      });
    }
    // The kitchen's and logistics' own milestones, woven in by time so the
    // whole life of the order reads as one column.
    ful.forEach((e) => entries.push(e));
    if (o.deleted) entries.push({ label: "Moved to Trash", at: ts(o.deletedAt), by: "" });
    entries.sort((a, b) => a.at - b.at);
    return `<section class="order-sec">
      <h4>Status history</h4>
      <ol class="order-times">${entries.map((e) => `
        <li class="tl-row">
          <time>${HP.esc(fmtDateTime(e.at))}</time>
          <span class="tl-rail"><span class="tl-dot"></span></span>
          <div class="tl-txt"><strong>${HP.esc(e.label)}</strong><small>${
            HP.esc(e.by ? `by ${e.by}` : "")}</small>${
            e.note ? `<small class="tl-note">${HP.esc(e.note)}</small>` : ""}</div>
        </li>`).join("")}</ol>
    </section>`;
  }

  function sheetBody(o) {
    return [heroHTML(o), clientHTML(o), paymentHTML(o), timelineHTML(o),
            roomHTML(o), menuHTML(o), historyHTML(o), extrasHTML(o)]
      .filter(Boolean).join("") ||
      `<p class="modal-text">The client left the whole form blank — only the request itself was filed.</p>`;
  }

  function sheetFoot(o) {
    const print = `<button class="btn btn-ghost" id="shPrint" title="Print this booking sheet"><span class="ic">${HP.icon("printer")}</span>Print</button>`;
    if (o.deleted) return `${print}
      <button class="btn btn-ghost order-del" id="shForever" title="Delete forever"><span class="ic">${HP.icon("trash")}</span>Delete forever</button>
      <button class="btn btn-primary" id="shRestoreTrash"><span class="ic">${HP.icon("undo")}</span>Restore order</button>`;
    const s = statusOf(o);
    const del = `<button class="btn btn-ghost order-del" id="shDelete" title="Delete this order"><span class="ic">${HP.icon("trash")}</span>Delete</button>`;
    // Offered wherever the downpayment could still be collected, so a payment
    // taken at the counter can be recorded without hunting for the right screen.
    const rec = mayRecordPayment(o)
      ? `<button class="btn btn-ghost" id="shRecordPay" title="Record a downpayment you took by hand"><span class="ic">${HP.icon("peso")}</span>Record payment</button>`
      : "";
    if (s === "pending") {
      // Locked rather than hidden: the manager should see that Confirm is the
      // next step and why it isn't available. It still clicks — into the
      // explanation, which carries the way forward.
      const confirmBtn = isUnpaid(o)
        ? `<button class="btn btn-primary is-locked" id="shConfirm" title="Locked — the downpayment hasn't landed"><span class="ic">${HP.icon("ban")}</span>Confirm order</button>`
        : `<button class="btn btn-primary" id="shConfirm"><span class="ic">${HP.icon("check")}</span>Confirm order</button>`;
      return `${print}${del}${rec}
      <button class="btn btn-danger" id="shDecline"><span class="ic">${HP.icon("ban")}</span>Decline</button>
      ${confirmBtn}`;
    }
    if (s === "confirmed") return `${print}${del}${rec}
      <button class="btn btn-ghost" id="shPending"><span class="ic">${HP.icon("undo")}</span>Back to pending</button>
      <button class="btn btn-primary" id="shComplete"><span class="ic">${HP.icon("check")}</span>Mark completed</button>`;
    // Completed is final — no reopen: resurrecting a done order would put it
    // back on the Master Chef's prep board.
    if (s === "completed") return `${print}${del}`;
    return `${print}${del}
      <button class="btn btn-ghost" id="shRestore"><span class="ic">${HP.icon("undo")}</span>Restore to pending</button>`;
  }

  /* The open sheet follows its document live: repainted when the doc changes
     in a snapshot (another manager moved it), closed when it disappears. */
  let sheetId = null;   // booking id of the open detail sheet
  let sheetJSON = "";   // serialized copy the sheet was painted from

  function syncSheet() {
    if (!sheetId) return;
    if (!document.querySelector(".order-sheet")) { sheetId = null; return; } // closed meanwhile
    const fresh = orders.find((x) => x.id === sheetId);
    if (!fresh) {
      sheetId = null;
      HP.closeModal();
      HP.toast("The open order was deleted in another session.", "warn");
      return;
    }
    const now = JSON.stringify(fresh);
    if (now !== sheetJSON) openSheet(fresh); // repaint from the live copy
  }

  function openSheet(o) {
    sheetId = o.id;
    sheetJSON = JSON.stringify(o);
    const m = STATUS_META[statusOf(o)];
    HP.openModal(`${typeOf(o)} order — ${clientName(o)}`, `
      <div class="order-sheet">
        <div class="order-sheet-head">
          ${typeBadge(o)}
          <span class="badge ${m.badge}"><span class="dot"></span>${m.label}</span>
          <span class="order-received"><span class="ic">${HP.icon("clock")}</span>Received ${fmtDate(o.createdAt)}</span>
        </div>
        ${sheetBody(o)}
      </div>`,
      sheetFoot(o));

    // Fill in the dish and room-setup photos as the lookups land.
    hydrateDishPhotos();
    hydrateSetupPhotos();

    const wire = (id, fn) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", fn);
    };
    const move = (status) => async () => {
      await setStatus(o, status);
      HP.closeModal();
    };
    wire("shConfirm", () => { HP.closeModal(); confirmOrder(o); });
    wire("shRecordPay", () => { HP.closeModal(); recordPaymentModal(o); });
    wire("shComplete", move("completed"));
    wire("shDecline", () => {
      HP.closeModal();
      HP.confirmModal("Decline order",
        `Decline ${clientName(o)}'s ${typeOf(o).toLowerCase()} order? The customer keeps the record, marked declined.`,
        () => setStatus(o, "declined"));
    });
    wire("shPending", move("pending"));
    wire("shRestore", move("pending"));
    wire("shDelete", () => { HP.closeModal(); onDelete(o); });
    wire("shPrint", HP.printModal);
    wire("shRestoreTrash", async () => { await restoreOrder(o); HP.closeModal(); });
    wire("shForever", () => { HP.closeModal(); foreverDelete(o); });
  }

  /* ── CSV export — respects the active filters and sort, so the file is
     exactly the table in view. ─────────────────────────────────────────── */
  function exportCSV() {
    const list = viewList();
    if (!list.length) {
      HP.toast(orders.length
        ? "No orders match the active filters — nothing to export."
        : "No orders to export yet.", "warn");
      return;
    }
    const cols = [
      ["Received", (o) => fmtDate(o.createdAt)],
      ["Status", (o) => STATUS_META[statusOf(o)].label],
      ["Type", typeOf],
      ["Client", clientName],
      ["Contact", (o) => String(o.contactNumber || "")],
      ["Email", (o) => String(o.email || "")],
      ["Function", (o) => String(o.kindOfFunction || "")],
      ["Event date", (o) => String(o.functionDate || "")],
      ["Venue", (o) => String(o.venue || "")],
      ["Pax", (o) => String(o.pax || "")],
      ["Package", (o) => String(o.package || "")],
      ["Set-up", (o) => String(o.setupStyle || "")],
      ["Menu", (o) => String(o.menu || "")],
    ];
    const cell = HP.csvCell; // formula-safe, quote-doubled (hp-core.js)
    const csv = [cols.map(([h]) => cell(h)).join(",")]
      .concat(list.map((o) => cols.map(([, f]) => cell(f(o))).join(",")))
      .join("\r\n");
    // BOM so Excel opens the UTF-8 file with ₱ and accents intact.
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_orders.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast(`Exported ${list.length} order${list.length === 1 ? "" : "s"}${filtersActive() ? " (matching the active filters)" : ""}.`);
  }

  /* ── Photo lightbox ──────────────────────────────────────────────────────
     Tap any dish or room-setup thumbnail in the order sheet to see it full
     size. A standalone overlay rather than HP.openModal — the order sheet is
     already the modal, and openModal owns a single shared root, so opening a
     second one would tear down the sheet underneath it. */
  let lightboxEl = null;
  function openLightbox(src) {
    if (!src) return;
    closeLightbox();
    const el = document.createElement("div");
    el.className = "photo-lightbox";
    el.innerHTML = `<img src="${HP.esc(src)}" alt="">`;
    el.addEventListener("click", closeLightbox);
    document.addEventListener("keydown", onLightboxEsc);
    document.body.appendChild(el);
    lightboxEl = el;
  }
  function closeLightbox() {
    if (!lightboxEl) return;
    lightboxEl.remove();
    lightboxEl = null;
    document.removeEventListener("keydown", onLightboxEsc);
  }
  function onLightboxEsc(e) { if (e.key === "Escape") closeLightbox(); }
  document.addEventListener("click", (e) => {
    const img = e.target.closest(".dish-thumb.has-img img, .setup-thumb.has-img img");
    if (img) openLightbox(img.src);
  });
})();
