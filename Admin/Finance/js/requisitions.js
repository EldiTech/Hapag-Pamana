/* HapagPamana · Finance — the requisition register.
   Every slip finance has released, newest first: the paper trail of money let
   out of the house. The costing board (index.html) is where slips are cut;
   this is where they're found again, re-read and reprinted.

   Why the register exists as its own page: the board only shows CONFIRMED
   orders, and the moment the order manager marks an event completed the
   booking leaves that stream and Orders deletes the kitchen's prep plan. The
   costing document survives both — with its own snapshot of the ingredients it
   released — so this page can still draw a slip for an event that finished
   last year.

   The stream orders by `requisition.releasedAt`, which quietly does the
   filtering too: only a released costing carries that field, so an unreleased
   or voided one never enters the query. That keeps the page on Firestore's
   automatic single-field index — a status + date query would need a composite
   index published before it would run at all.

   Reading costings requires the finance (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const F = window.HPFin;

  HP.shell.init();
  HP.shell.setPage({
    title: "Requisitions",
    sub: "Every requisition slip finance has released.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("reqStats");
  const chipsEl = document.getElementById("rangeChips");
  const rowsEl = document.getElementById("slipRows");

  const db = HP.ONLINE ? firebase.firestore() : null;

  /* Bounded like the Orders register: an unbounded stream re-reads the whole
     archive ever more expensively as the years pile up. 250 slips is a couple
     of years of events at this kitchen's pace; older ones are still readable
     by their booking on the costing board. */
  const LIVE_LIMIT = 250;

  let slips = [];      // released costings, newest release first
  let query = "";
  let rangeFilter = "all";
  let loaded = false;
  let unsub = null;

  const { ts, money0, releaseDateMs, fmtDate, fmtDateTime } = F;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      chipsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(
        "Requisitions live in Firestore — connect Firebase to read the register.");
      return;
    }
    unsub = db.collection("costings")
      .orderBy("requisition.releasedAt", "desc").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        slips = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          // Voiding a slip nulls the whole `requisition` map, so the
          // `requisition.releasedAt` field path stops existing and the query
          // drops the doc on its own. This guard just makes that explicit.
          .filter((c) => c.status === "released" && c.requisition)
          .sort((a, b) => releaseDateMs(b.requisition) - releaseDateMs(a.requisition));
        loaded = true;
        renderAll();
      }, (e) => {
        console.error("HapagPamana: couldn't load the requisitions —", e);
        statsEl.innerHTML = "";
        const denied = e && (e.code === "permission-denied" ||
          /permission|insufficient/i.test(e.message || ""));
        rowsEl.innerHTML = emptyRow(denied
          ? "Access denied — publish the updated Firestore rules (finance access to costings), then reload."
          : "Couldn't reach the database. Check your connection and reload.");
        if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
      });
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  /* ── Vocabulary ──────────────────────────────────────────────────────────── */
  const amountOf = (c) => Number(c.requisition && c.requisition.amount) || 0;
  const numberOf = (c) => String((c.requisition && c.requisition.number) || "—");
  const releasedByOf = (c) => String((c.requisition && c.requisition.releasedByName) || "").trim();

  const RANGES = [
    ["all", "All time"],
    ["month", "This month"],
    ["30", "Last 30 days"],
    ["90", "Last 90 days"],
  ];
  function inRange(c) {
    if (rangeFilter === "all") return true;
    const ms = releaseDateMs(c.requisition);
    if (!ms) return false;
    if (rangeFilter === "month") {
      const now = new Date(), d = new Date(ms);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return ms >= today.getTime() - Number(rangeFilter) * 864e5;
  }

  function matches(c) {
    if (!inRange(c)) return false;
    if (!query) return true;
    return [numberOf(c), c.clientName, c.functionDate, c.kindOfFunction, c.venue, releasedByOf(c)]
      .some((v) => String(v || "").toLowerCase().includes(query));
  }

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ───────────────────────────────────────────────────────────── */
  function renderAll() {
    if (!loaded) return;
    renderStats(); renderChips(); renderRows();
  }

  function renderStats() {
    const cash = slips.reduce((s, c) => s + amountOf(c), 0);
    const now = new Date();
    const thisMonth = slips.filter((c) => {
      const ms = releaseDateMs(c.requisition);
      if (!ms) return false;
      const d = new Date(ms);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const avg = slips.length ? Math.round(cash / slips.length) : 0;

    const stat = (ic, value, label, asMoney) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        ${asMoney
          ? `<div class="stat-num stat-num--money">${HP.esc(value)}</div>`
          : `<div class="stat-num" data-count="${value}">${value}</div>`}
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("slip", slips.length, "Slips released") +
      stat("peso", money0(cash), "Cash released", true) +
      stat("calendar", thisMonth.length, "Released this month") +
      stat("scales", money0(avg), "Average slip", true))) HP.countUp(statsEl);
  }

  function renderChips() {
    chipsEl.innerHTML = RANGES.map(([v, label]) =>
      `<button class="chip-filter${rangeFilter === v ? " active" : ""}" data-range="${v}">${label}</button>`).join("");
    chipsEl.querySelectorAll("[data-range]").forEach((b) =>
      b.addEventListener("click", () => {
        rangeFilter = b.dataset.range;
        renderChips(); renderRows();
      }));
  }

  function renderRows() {
    if (!loaded) return;
    const list = slips.filter(matches);
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(slips.length
        ? "No slips match your search or the chosen window."
        : "No requisition slips yet — approve a costing on the board, then release its requisition and it will be filed here.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((c) => {
      const ms = releaseDateMs(c.requisition);
      const by = releasedByOf(c);
      const over = Array.isArray(c.overrideChecks) && c.overrideChecks.length;
      return `
      <tr data-id="${HP.esc(c.id)}" class="cost-row">
        <td data-label="Slip">
          <div class="cell-name"><div>
            <strong class="slip-ref">${HP.esc(numberOf(c))}</strong>
            <small>${HP.esc(fmtDate(ms) || "—")}</small>
          </div></div>
        </td>
        <td data-label="Client">
          <div class="cell-name"><div>
            <strong>${HP.esc(c.clientName || "Unnamed client")}</strong>
            <small>${HP.esc(c.kindOfFunction || c.venue || "—")}</small>
          </div></div>
        </td>
        <td data-label="Event">
          <div class="cell-name"><div>
            <strong>${HP.esc(c.functionDate || "—")}</strong>
            <small>${HP.esc(c.pax ? `${c.pax} pax · ${c.bookingType || "Catering"}` : (c.bookingType || "Catering"))}</small>
          </div></div>
        </td>
        <td data-label="Released">
          <div class="cell-money">
            <strong>${HP.esc(money0(amountOf(c)))}</strong>
            <small>${HP.esc(`${Number(c.ingredientLines) || 0} ingredient line${Number(c.ingredientLines) === 1 ? "" : "s"}`)}</small>
          </div>
        </td>
        <td data-label="Released by">
          ${by ? `<span class="req-by">${HP.esc(by)}</span>` : `<small class="cost-muted">—</small>`}
          ${over ? `<small class="cost-stale">Approved over ${over} failed check${over === 1 ? "" : "s"}</small>` : ""}
        </td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="print" title="Print this slip" aria-label="Print slip ${HP.esc(numberOf(c))}"><span class="ic">${HP.icon("printer")}</span></button>
            <button class="icon-btn" data-act="open" title="Read this slip" aria-label="Read slip ${HP.esc(numberOf(c))}"><span class="ic">${HP.icon("eye")}</span></button>
          </div>
        </td>
      </tr>`;
    }).join(""));

    const find = (el) => slips.find((c) => c.id === el.closest("tr").dataset.id);
    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const c = find(e.currentTarget);
      if (c) openSlip(c, e.currentTarget.dataset.act === "print");
    }));
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const c = find(tr);
        if (c) openSlip(c, false);
      }));
  }

  /* ── One slip, as released ───────────────────────────────────────────────── */
  function openSlip(c, printNow) {
    const req = c.requisition || {};
    const by = releasedByOf(c);
    HP.openModal(`Requisition ${numberOf(c)}`,
      `${F.slipHTML({ ...c, bookingId: c.bookingId || c.id })}
       <p class="slip-audit">Released ${HP.esc(fmtDateTime(ts(req.releasedAt)) || fmtDate(releaseDateMs(req)) || "—")}${
         by ? ` by ${HP.esc(by)}` : ""}. Costing last saved ${
         HP.esc(fmtDateTime(ts(c.updatedAt)) || "—")}${
         c.updatedByName ? ` by ${HP.esc(c.updatedByName)}` : ""}.</p>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="slipPrint"><span class="ic">${HP.icon("printer")}</span>Print</button>`);
    document.getElementById("slipPrint").addEventListener("click", HP.printModal);
    // Straight from the row's printer button: let the dialog's entrance finish
    // first, or the print snapshot catches the slip mid-fade.
    if (printNow) setTimeout(HP.printModal, 240);
  }

  /* ── Export ──────────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = slips.filter(matches);
    if (!list.length) return HP.toast("Nothing to export — no slips in this window.", "warn");
    const rows = [[
      "Slip no.", "Released on", "Client", "Event date", "Function", "Type", "Pax",
      "Amount released (PHP)", "Ingredient lines", "Total cost (PHP)",
      "Order total (PHP)", "Released by", "Note",
    ]];
    list.forEach((c) => {
      rows.push([
        numberOf(c), fmtDate(releaseDateMs(c.requisition)),
        c.clientName || "", c.functionDate || "", c.kindOfFunction || "",
        c.bookingType || "", c.pax || "",
        amountOf(c) || "", Number(c.ingredientLines) || "",
        Number(c.totalCost) || "", Number(c.orderTotal) || "",
        releasedByOf(c), c.note || "",
      ]);
    });
    F.downloadCSV(rows, "hapagpamana_requisitions.csv");
    HP.toast(`Exported ${list.length} slip${list.length === 1 ? "" : "s"} as CSV.`);
  }
})();
