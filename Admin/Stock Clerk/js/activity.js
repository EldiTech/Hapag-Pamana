/* HapagPamana · Stock Clerk — Activity.

   The store ledger, read end to end: every movement of every pantry item, in
   the order it happened. `pantryLog` is append-only — nothing on this page
   edits or deletes an entry, and the pantry writes one for every change it
   makes to a shelf count. That is the whole point: the count on the Pantry
   page is only trustworthy because this list explains how it got there.

   Reading requires the stock_clerk (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const K = window.HPPantry;

  HP.shell.init();
  HP.shell.setPage({
    title: "Activity",
    sub: "Every movement in the store — who moved what, when, and why.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("actStats");
  const chipsEl = document.getElementById("actChips");
  const rowsEl = document.getElementById("actRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 500;

  let log = [];
  let query = "";
  let filter = "all";
  let loaded = false;
  let unsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 8);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("The ledger lives in Firestore — connect Firebase to read it.");
      return;
    }
    // No orderBy on the query: entries written moments ago have a null
    // serverTimestamp until the write lands, and ordering server-side would
    // drop them out of the window. Sorted here on entryTime, which falls back
    // to the client stamp.
    unsub = db.collection("pantryLog").limit(LIVE_LIMIT).onSnapshot((snap) => {
      log = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      log.sort((a, b) => K.entryTime(b) - K.entryTime(a));
      loaded = true;
      renderAll();
    }, (e) => {
      const denied = e && (e.code === "permission-denied" ||
        /permission|insufficient/i.test(e.message || ""));
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(denied
        ? "Access denied — publish the updated Firestore rules (the pantryLog collection), then reload."
        : "Couldn't reach Firestore — check your connection.");
      if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
    });
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); }

  const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function renderStats() {
    const today = startOfToday();
    const todays = log.filter((e) => K.entryTime(e) >= today);
    const issued = log.filter((e) => e.reason === "issued").length;
    const corrections = log.filter((e) => e.reason === "correction").length;
    const people = new Set(todays.map((e) => e.byName).filter(Boolean)).size;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("logbook", todays.length, "Movements today") +
      stat("crates", issued, "Issues to kitchen") +
      stat("scales", corrections, "Stock corrections") +
      stat("shelf", people, "Clerks active today"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const today = startOfToday();
    const counts = {
      all: log.length,
      today: log.filter((e) => K.entryTime(e) >= today).length,
      in: log.filter((e) => Number(e.delta) > 0).length,
      out: log.filter((e) => Number(e.delta) < 0).length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("all", "Everything") + chip("today", "Today") +
      chip("in", "Stock in") + chip("out", "Stock out");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    const today = startOfToday();
    return log.filter((e) => {
      if (filter === "today" && K.entryTime(e) < today) return false;
      if (filter === "in" && !(Number(e.delta) > 0)) return false;
      if (filter === "out" && !(Number(e.delta) < 0)) return false;
      if (!query) return true;
      return [e.itemName, e.byName, e.note, e.clientName, K.reasonLabel(e.reason)]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(log.length
        ? "No movement matches — try another spelling or clear the filter."
        : "Nothing has moved yet — the ledger fills as stock is received and issued.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((e) => {
      const up = Number(e.delta) > 0;
      const sub = [e.clientName, e.note].filter(Boolean).join(" · ");
      return `
      <tr>
        <td>${HP.esc(K.fmtWhen(e))}</td>
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(e.itemName || "—")}</strong>
            ${sub ? `<small>${HP.esc(sub)}</small>` : ""}
          </div></div>
        </td>
        <td><span class="pn-log-delta ${up ? "is-up" : "is-down"}">${HP.esc(K.signedQty(e.delta, e.unit))}</span></td>
        <td>${HP.esc(K.reasonLabel(e.reason))}</td>
        <td>${HP.esc(K.qtyText(e.before, e.unit))} → ${HP.esc(K.qtyText(e.after, e.unit))}</td>
        <td>${HP.esc(e.byName || "—")}</td>
      </tr>`;
    }).join(""));
  }

  /* ── Export ─────────────────────────────────────────────────────────────
     The audit copy: the same rows, in the same order, as a spreadsheet. */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["When", "Item", "Unit", "Movement", "Reason", "Before", "After",
      "Order", "Note", "By"];
    const lines = [head.map(cell).join(",")];
    list.forEach((e) => lines.push([
      K.fmtWhen(e), e.itemName || "", e.unit || "", K.round3(e.delta),
      K.reasonLabel(e.reason), K.round3(e.before), K.round3(e.after),
      e.clientName || "", e.note || "", e.byName || "",
    ].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_pantry_activity.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Activity exported as CSV.");
  }
})();
