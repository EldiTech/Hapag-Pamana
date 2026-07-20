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

   Reading/updating bookings requires the order_manager (or admin) role —
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
  // Every key the sheet already presents somewhere; anything else the app
  // adds later still shows up under "More details".
  const SHEET_KEYS = new Set([
    "kindOfFunction", "functionDate", "venue", "address", "pax",
    "clientName", "contactNumber", "email", "package", "menu", "menuAddOns",
    ...COURSES.map(([k]) => k),
    ...TIMELINE.map(([k]) => k),
  ]);

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
        <td>${statusBadge(o)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="view" title="View the booking sheet" aria-label="View ${HP.esc(clientName(o))}'s order"><span class="ic">${HP.icon("eye")}</span></button>
            ${statusOf(o) === "pending"
              ? `<button class="icon-btn" data-act="confirm" title="Confirm this order" aria-label="Confirm ${HP.esc(clientName(o))}'s order"><span class="ic">${HP.icon("check")}</span></button>`
              : ""}
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

  // Confirming feeds the Master Chef's prep board — never one accidental
  // click away.
  function confirmOrder(o) {
    HP.confirmModal("Confirm order",
      `Confirm ${clientName(o)}'s ${typeOf(o).toLowerCase()} order? It goes straight onto the Master Chef's prep board.`,
      () => setStatus(o, "confirmed"), false);
  }

  /* ── Status workflow ──────────────────────────────────────────────────── */
  const STATUS_TOAST = {
    confirmed: (o) => `${clientName(o)}'s order is confirmed — it's now on the Master Chef's prep board.`,
    completed: (o) => `${clientName(o)}'s order is marked completed.`,
    declined:  (o) => `${clientName(o)}'s order was declined.`,
    pending:   (o) => `${clientName(o)}'s order is back in the pending queue.`,
  };

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
        // update(), never a merge-set: a set() would resurrect a booking
        // another manager deleted between the sheet opening and this click.
        tx.update(ref, {
          status,
          statusUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          history: firebase.firestore.FieldValue.arrayUnion(historyEntry(status)),
          ...auditStamp(),
        });
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
      HP.toast(STATUS_TOAST[status](o), status === "declined" ? "warn" : "ok");
    } catch (e) {
      if (e && (e.code === "hp/gone" || e.code === "not-found")) {
        HP.toast(`${clientName(o)}'s order no longer exists — it was deleted in another session.`, "warn");
      } else if (e && e.code === "hp/stale") {
        HP.toast(`Couldn't apply that — ${clientName(o)}'s order is now ${STATUS_META[e.current].label.toLowerCase()} (changed in another session).`, "warn");
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
    const venue = [val(o, "venue"), val(o, "address")].filter(Boolean).join(" · ");
    const html =
      tile("calendar", "Date of function", val(o, "functionDate")) +
      tile("users", "Guests", pax && (/^\d+$/.test(pax) ? `${pax} pax` : pax)) +
      tile("party", "Kind of function", val(o, "kindOfFunction")) +
      tile("pin", "Venue & address", venue, true);
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
      COURSES.forEach(([k, label]) => {
        const v = val(o, k);
        if (v) cards.push(dishCard(v, label, ""));
      });
    }
    const pkg = val(o, "package");
    const addons = val(o, "menuAddOns");
    if (!cards.length && !pkg && !addons) return "";
    return `<section class="order-sec">
      <h4>Package &amp; menu</h4>
      ${pkg ? `<div class="order-pkg"><span class="ic">${HP.icon("dish")}</span>
        <div><small>Package</small><strong>${HP.esc(pkg)}</strong></div></div>` : ""}
      ${cards.length ? `<div class="dish-grid">${cards.join("")}</div>` : ""}
      ${addons ? `<div class="order-addons"><span class="ic">${HP.icon("plus")}</span>
        <div><small>Add-ons</small><strong>${HP.esc(addons).replace(/\n/g, "<br>")}</strong></div></div>` : ""}
    </section>`;
  }

  // Anything the app adds later still shows up, under "More details".
  function extrasHTML(o) {
    const rows = Object.keys(o)
      .filter((k) => k !== "id" && !META_KEYS.has(k) && !SHEET_KEYS.has(k) && val(o, k))
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
  function historyHTML(o) {
    const moves = Array.isArray(o.history) ? o.history : [];
    if (!moves.length && !o.deleted) return ""; // nothing beyond "received" — skip the section
    const entries = [{ label: "Received", at: ts(o.createdAt), by: "" }];
    moves.forEach((h) => {
      const m = STATUS_META[h.status];
      entries.push({ label: m ? m.label : String(h.status || "—"), at: ts(h.at), by: String(h.byName || "") });
    });
    if (o.deleted) entries.push({ label: "Moved to Trash", at: ts(o.deletedAt), by: "" });
    entries.sort((a, b) => a.at - b.at);
    return `<section class="order-sec">
      <h4>Status history</h4>
      <ol class="order-times">${entries.map((e) => `
        <li class="tl-row">
          <time>${HP.esc(fmtDateTime(e.at))}</time>
          <span class="tl-rail"><span class="tl-dot"></span></span>
          <div class="tl-txt"><strong>${HP.esc(e.label)}</strong><small>${HP.esc(e.by ? `by ${e.by}` : "")}</small></div>
        </li>`).join("")}</ol>
    </section>`;
  }

  function sheetBody(o) {
    return [heroHTML(o), clientHTML(o), timelineHTML(o), menuHTML(o), historyHTML(o), extrasHTML(o)]
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
    if (s === "pending") return `${print}${del}
      <button class="btn btn-danger" id="shDecline"><span class="ic">${HP.icon("ban")}</span>Decline</button>
      <button class="btn btn-primary" id="shConfirm"><span class="ic">${HP.icon("check")}</span>Confirm order</button>`;
    if (s === "confirmed") return `${print}${del}
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

    // Fill in the dish photos as the product lookups land.
    hydrateDishPhotos();

    const wire = (id, fn) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", fn);
    };
    const move = (status) => async () => {
      await setStatus(o, status);
      HP.closeModal();
    };
    wire("shConfirm", () => { HP.closeModal(); confirmOrder(o); });
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
})();
