/* HapagPamana · Purchasing — the purchase runs board.
   Every requisition finance has released, and the checklist cut from the lines
   it authorised. This is the buyer's desk: tick what was bought, record what
   it actually cost, explain what wasn't, attach the receipts, then hand the
   run to the stock clerk.

   Where the work comes from: a released costing (costings/{bookingId} with
   `requisition.releasedAt` set) is the authority to spend. The first time a
   buyer opens one, this page writes procurements/{costingId} carrying its own
   snapshot of the plan's lines — the kitchen may revise the plan afterwards,
   and the run must stay the thing that was actually approved.

   The stages, the money and the receipt reader all live in one place,
   ../../assets/hp-procurement.js, so the desks that come after this one
   (stock clerk, and whatever follows) agree with it by construction.

   Reading costings and writing procurements requires the purchasing_staff
   (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const P = window.HPProc;

  HP.shell.init();
  HP.shell.setPage({
    title: "Purchase Runs",
    sub: "Requisitions released by finance, and what the market run actually cost.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("runStats");
  const chipsEl = document.getElementById("stageChips");
  const rowsEl = document.getElementById("runRows");

  const db = HP.ONLINE ? firebase.firestore() : null;

  /* Same ceiling the requisition register uses: an unbounded stream re-reads
     the whole archive ever more expensively as the years pile up. */
  const LIVE_LIMIT = 250;

  let slips = [];              // released costings, newest release first
  let runs = Object.create(null); // costingId → procurement doc
  let query = "";
  let stageFilter = "open";
  let loadedSlips = false, loadedRuns = false;
  let unsubSlips = null, unsubRuns = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(7, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  /* ── Data ─────────────────────────────────────────────────────────────── */
  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      chipsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("Purchase runs live in Firestore — connect Firebase to read the board.");
      return;
    }

    // Only released slips carry requisition.releasedAt, so ordering by it also
    // does the filtering — and keeps us on an automatic single-field index.
    unsubSlips = db.collection("costings")
      .orderBy("requisition.releasedAt", "desc").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        slips = snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((c) => c.status === "released" && c.requisition);
        loadedSlips = true;
        render();
      }, (e) => fail(e));

    unsubRuns = db.collection("procurements").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        const next = Object.create(null);
        snap.docs.forEach((d) => { next[d.id] = Object.assign({ id: d.id }, d.data()); });
        runs = next;
        loadedRuns = true;
        render();
      }, (e) => fail(e));
  }

  function fail(e) {
    statsEl.innerHTML = "";
    chipsEl.innerHTML = "";
    rowsEl.innerHTML = emptyRow(
      e && e.code === "permission-denied"
        ? "Your role can't read the purchase runs."
        : "Couldn't reach Firestore — check your connection.");
    console.warn("HapagPamana: purchase runs —", e);
  }

  window.addEventListener("beforeunload", () => {
    if (unsubSlips) unsubSlips();
    if (unsubRuns) unsubRuns();
  });

  /* A row is a released slip plus whatever run has been started against it.
     A slip with no run yet is stage "released" — nobody has picked it up. */
  function rowsData() {
    return slips.map((c) => {
      const run = runs[c.id] || null;
      return {
        id: c.id,
        slip: (c.requisition && c.requisition.number) || "—",
        amount: (c.requisition && c.requisition.amount) || 0,
        releasedAt: (c.requisition && c.requisition.releasedAt) || null,
        clientName: c.clientName || "—",
        functionDate: c.functionDate || "",
        kindOfFunction: c.kindOfFunction || "",
        venue: c.venue || "",
        costing: c,
        run,
        stage: (run && run.stage) || "released",
      };
    });
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  function render() {
    if (!loadedSlips || !loadedRuns) return;
    renderStats();
    renderChips();
    renderRows();
  }

  function renderStats() {
    const all = rowsData();
    const open = all.filter((r) => r.stage === "released" || r.stage === "purchasing").length;
    const handed = all.filter((r) => r.stage === "delivered").length;
    let spent = 0, authorised = 0;
    all.forEach((r) => {
      authorised += Number(r.amount) || 0;
      if (r.run) spent += P.totals(r.run.items, r.run.receipts).actual;
    });
    statsEl.innerHTML =
      stat("cart", String(open), "Runs to buy") +
      stat("check", String(handed), "Handed to stores") +
      stat("peso", P.peso(authorised), "Authorised", true) +
      stat("peso", P.peso(spent), "Spent so far", true);
    HP.hydrateIcons(statsEl);
  }

  /* Same shape the costing board uses — the shell styles .stat-top,
     .stat-num and .stat-label, and nothing else. */
  function stat(icon, value, label, asMoney) {
    return `<div class="stat">
      <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(icon)}</span></span></div>
      ${asMoney
        ? `<div class="stat-num stat-num--money">${HP.esc(value)}</div>`
        : `<div class="stat-num" data-count="${HP.esc(value)}">${HP.esc(value)}</div>`}
      <div class="stat-label">${HP.esc(label)}</div>
    </div>`;
  }

  const FILTERS = [
    { key: "open", label: "To buy" },
    { key: "delivered", label: "Handed over" },
    { key: "done", label: "Closed" },
    { key: "all", label: "All" },
  ];

  function renderChips() {
    chipsEl.className = "seg";
    chipsEl.innerHTML = FILTERS.map((f) =>
      `<button class="seg-btn${stageFilter === f.key ? " active" : ""}" data-stage="${f.key}" type="button">${HP.esc(f.label)}<span class="seg-count">${countFor(f.key)}</span></button>`
    ).join("");
    chipsEl.querySelectorAll("[data-stage]").forEach((b) =>
      b.addEventListener("click", () => {
        stageFilter = b.dataset.stage;
        chipsEl.classList.add("anim");
        renderChips();
        renderRows();
      }));
  }

  // The bubble beside each tab — how many runs that filter would show.
  function countFor(key) {
    const all = rowsData();
    if (key === "all") return all.length;
    if (key === "open") return all.filter((r) => r.stage === "released" || r.stage === "purchasing").length;
    if (key === "delivered") return all.filter((r) => r.stage === "delivered").length;
    return all.filter((r) => P.indexOf(r.stage) >= P.indexOf("checking")).length;
  }

  function matchesFilter(r) {
    if (stageFilter === "all") return true;
    if (stageFilter === "open") return r.stage === "released" || r.stage === "purchasing";
    if (stageFilter === "delivered") return r.stage === "delivered";
    return P.indexOf(r.stage) >= P.indexOf("checking");
  }

  function visible() {
    const q = query.trim().toLowerCase();
    return rowsData()
      .filter(matchesFilter)
      .filter((r) => !q || [r.slip, r.clientName, r.functionDate, r.kindOfFunction, r.venue]
        .join(" ").toLowerCase().includes(q));
  }

  function renderRows() {
    if (!loadedSlips || !loadedRuns) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(rowsData().length
        ? "No run matches that filter."
        : "Nothing to buy yet — finance hasn't released a requisition.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((r) => {
      const st = P.stage(r.stage);
      const t = r.run ? P.totals(r.run.items, r.run.receipts) : null;
      const lines = t ? `${t.bought}/${t.lines}` : String(countLines(r.costing));
      return `<tr data-id="${HP.esc(r.id)}">
        <td><strong>${HP.esc(r.slip)}</strong><br><small>${HP.esc(P.peso(r.amount))}</small></td>
        <td>${HP.esc(r.clientName)}</td>
        <td>${HP.esc(r.kindOfFunction || "—")}<br><small>${HP.esc(r.functionDate || "")}</small></td>
        <td>${HP.esc(lines)}</td>
        <td>${HP.esc(fmtDate(r.releasedAt))}</td>
        <td><span class="badge ${HP.esc(st.badge)}"><span class="dot"></span>${HP.esc(st.label)}</span></td>
        <td class="row-actions">
          <button class="icon-btn" data-act="open" title="Open the checklist"
            aria-label="Open ${HP.esc(r.clientName)}'s checklist"><span class="ic">${HP.icon("checklist")}</span></button>
        </td>
      </tr>`;
    }).join(""));
    HP.hydrateIcons(rowsEl);
    rowsEl.querySelectorAll("[data-act='open']").forEach((b) =>
      b.addEventListener("click", (e) => {
        const id = e.target.closest("tr").dataset.id;
        openRun(visible().find((r) => r.id === id));
      }));
  }

  const countLines = (c) => Number(c && c.ingredientLines) || 0;

  function emptyRow(msg) {
    return `<tr><td colspan="7" class="empty">${HP.esc(msg)}</td></tr>`;
  }

  function fmtDate(v) {
    const d = v && v.toDate ? v.toDate() : (v ? new Date(v) : null);
    if (!d || isNaN(d)) return "—";
    return d.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  /* ── The checklist ────────────────────────────────────────────────────────
     Generated from the lines the slip was cut for. The first open writes the
     run document; every later open reads the one that exists, so a buyer never
     silently replaces a colleague's work with a fresh snapshot. */
  /* Runs cut before the money columns were seeded (see itemsFromPlan) carry
     null qty/price on every line, so they report ₱0 spent and can never be
     liquidated. Fill those blanks from the figures the slip was authorised
     against — in memory only, so nothing is written until the buyer saves.
     A line the buyer has already priced is left exactly as they typed it. */
  function seedMoney(run) {
    if (!run || !Array.isArray(run.items)) return run;
    const items = run.items.map((it) => {
      const q = it.qtyBought === null || it.qtyBought === undefined
        ? (Number(it.qtyRequested) > 0 ? it.qtyRequested : null) : it.qtyBought;
      const c = it.unitCostActual === null || it.unitCostActual === undefined
        ? (Number(it.unitCostEstimated) > 0 ? it.unitCostEstimated : null) : it.unitCostActual;
      return q === it.qtyBought && c === it.unitCostActual
        ? it : Object.assign({}, it, { qtyBought: q, unitCostActual: c });
    });
    return Object.assign({}, run, { items });
  }

  function openRun(r) {
    if (!r) return;
    if (r.run) return drawChecklist(r, seedMoney(r.run));

    // No run yet — cut one from the costing's own snapshot of the plan.
    const items = P.itemsFromPlan(planItemsOf(r.costing));
    if (!items.length) {
      HP.toast("That requisition has no ingredient lines to check off.", "warn");
      return;
    }
    const doc = {
      costingId: r.id,
      bookingId: r.id,
      slipNumber: r.slip,
      amount: Number(r.amount) || 0,
      clientName: r.clientName,
      functionDate: r.functionDate || "",
      kindOfFunction: r.kindOfFunction || "",
      venue: r.venue || "",
      stage: "purchasing",
      items,
      receipts: [],
      history: [{ stage: "purchasing", at: Date.now(), byName: HP.user.name || "—", note: "Run started" }],
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      startedByName: HP.user.name || "—",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    db.collection("procurements").doc(r.id).set(doc, { merge: true })
      .then(() => drawChecklist(r, Object.assign({}, doc, { items })))
      .catch((e) => HP.toast(writeError(e), "warn"));
  }

  /* The costing keeps the plan it was priced from; that snapshot is what the
     slip authorised. Fall back to the live plan only if it isn't there. */
  /* The approved lines on a costing.

     Finance writes them to `ingredients` — see costing.js's save(), "the
     kitchen's list as approved — the slip's source of truth" — and that is
     the same field its own slip renderer reads (finance-common.js slipLines).
     Read that first.

     `planItems` / `plan.items` are kept as fallbacks for older costings only.
     Nothing has ever written them: reading them FIRST was the bug that left
     every checklist empty ("no ingredient lines to check off") even when the
     recipe was costed and the slip printed its lines correctly.

     Each line arrives shaped {dish, ingredient, qty, unit, unitCost} — what
     itemsFromPlan expects — carried unchanged from the Master Chef's plan. */
  function planItemsOf(c) {
    if (c && Array.isArray(c.ingredients) && c.ingredients.length) return c.ingredients;
    if (c && Array.isArray(c.planItems) && c.planItems.length) return c.planItems;
    if (c && c.plan && Array.isArray(c.plan.items)) return c.plan.items;
    return [];
  }

  function drawChecklist(r, run) {
    const items = Array.isArray(run.items) ? run.items.slice() : [];
    const stage = run.stage || "purchasing";
    const owns = P.canDrive(HP.user.roleKey, stage);
    // Once the goods are with the stores the buyer no longer drives the run —
    // but they are still the only person who knows what was paid, so the
    // money columns stay open until finance holds the paperwork. See
    // canPriceLines: prices are a record, not an action.
    const pricingOnly = !owns && P.canPriceLines(HP.user.roleKey, stage);
    const readOnly = !owns && !pricingOnly;

    const foot = readOnly
      ? `<button class="btn btn-ghost" data-close>Close</button>`
      : pricingOnly
        // No hand-over button: the goods have already gone. Saving here only
        // records what they cost.
        ? `<button class="btn btn-ghost" data-close>Cancel</button>
           <button class="btn btn-primary" id="ckSave">Save prices</button>`
        : `<button class="btn btn-ghost" data-close>Cancel</button>
           <button class="btn btn-ghost" id="ckSave">Save</button>
           <button class="btn btn-primary" id="ckHand">Save &amp; hand to stores</button>`;

    HP.openModal(`Checklist · ${r.slip}`, checklistHTML(r, run, items, readOnly, pricingOnly), foot);

    const root = document.querySelector(".modal");
    if (!root) return;
    root.classList.add("modal--wide");
    wireChecklist(root, r, run, readOnly);
    if (readOnly) return;
    root.querySelector("#ckSave").addEventListener("click", () => saveChecklist(r, run, root, false));
    const hand = root.querySelector("#ckHand");
    if (hand) hand.addEventListener("click", () => saveChecklist(r, run, root, true));
  }

  function checklistHTML(r, run, items, readOnly, pricingOnly) {
    const t = P.totals(items, run.receipts);
    const byDish = new Map();
    items.forEach((it) => {
      const k = it.dish || "Other";
      if (!byDish.has(k)) byDish.set(k, []);
      byDish.get(k).push(it);
    });

    const groups = [...byDish.entries()].map(([dish, rows]) => `
      <tbody class="ck-group">
        <tr class="ck-dish"><th colspan="6">${HP.esc(dish)}</th></tr>
        ${rows.map((it) => lineHTML(it, readOnly, pricingOnly)).join("")}
      </tbody>`).join("");

    return `
      <div class="ck-head">
        <div>
          <p class="ck-client"><strong>${HP.esc(r.clientName)}</strong> · ${HP.esc(r.kindOfFunction || "—")}</p>
          <p class="ck-meta">${HP.esc(r.functionDate || "")}${r.venue ? " · " + HP.esc(r.venue) : ""}</p>
        </div>
        <div class="ck-money">
          <span><small>Authorised</small><strong>${HP.esc(P.peso(r.amount))}</strong></span>
          <span><small>Spent</small><strong id="ckActual">${HP.esc(P.peso(t.actual))}</strong></span>
          <span><small>Variance</small><strong id="ckVar" class="${t.variance > 0 ? "is-over" : ""}">${HP.esc(P.signedPeso(t.variance))}</strong></span>
        </div>
      </div>

      ${readOnly ? `<p class="ck-note">This run has moved on to ${HP.esc(P.labelOf(run.stage))} — it's read-only at your desk.</p>` : ""}
      ${pricingOnly ? `<p class="ck-note">The goods are already at
        ${HP.esc(P.labelOf(run.stage))}, so the ticks are settled — but the run can't be
        liquidated until every bought line carries what you actually paid.
        Fill the <strong>qty</strong> and <strong>unit price</strong> columns from your
        market receipts and save.</p>` : ""}

      <div class="ck-wrap">
        <table class="data ck-table">
          <thead>
            <tr>
              <th class="ck-tick">Got</th>
              <th>Ingredient</th>
              <th>Asked for</th>
              <th>Bought</th>
              <th>Unit cost</th>
              <th>Line</th>
            </tr>
          </thead>
          ${groups}
        </table>
      </div>

      <div class="ck-foot">
        <p class="ck-hint">Leave a note on anything you couldn't buy — the stock clerk and finance read it.</p>
        <p class="ck-tot"><span id="ckCount">${HP.esc(`${t.bought}/${t.lines}`)}</span> lines bought</p>
      </div>`;
  }

  function lineHTML(it, readOnly, pricingOnly) {
    // In pricing-only mode the tick and the note are settled history — the
    // stores already took delivery against them — so only the money columns
    // stay live.
    const dis = readOnly || pricingOnly ? " disabled" : "";
    const disMoney = readOnly ? " disabled" : "";
    return `<tr data-key="${HP.esc(it.key)}">
      <td class="ck-tick">
        <label class="ck-box">
          <input type="checkbox" class="ck-bought"${it.bought ? " checked" : ""}${dis} />
          <span class="box" aria-hidden="true">${HP.icon("check")}</span>
        </label>
      </td>
      <td>
        <strong>${HP.esc(it.ingredient)}</strong>
        <input type="text" class="ck-note" placeholder="Note (why not bought, substitute…)"
               value="${HP.esc(it.note || "")}"${dis} />
      </td>
      <td class="ck-num">${HP.esc(P.qty(it.qtyRequested, it.unit))}${
        it.unitCostEstimated ? `<br><small>@ ${HP.esc(P.peso(it.unitCostEstimated))}</small>` : ""}</td>
      <td class="ck-num">
        <input type="number" class="ck-qty" min="0" step="any" inputmode="decimal"
               placeholder="${HP.esc(String(it.qtyRequested === null ? "" : it.qtyRequested))}"
               value="${it.qtyBought === null || it.qtyBought === undefined ? "" : HP.esc(String(it.qtyBought))}"${disMoney} />
        <small>${HP.esc(it.unit || "")}</small>
      </td>
      <td class="ck-num">
        <input type="number" class="ck-cost" min="0" step="any" inputmode="decimal"
               placeholder="${HP.esc(String(it.unitCostEstimated || ""))}"
               value="${it.unitCostActual === null || it.unitCostActual === undefined ? "" : HP.esc(String(it.unitCostActual))}"${disMoney} />
      </td>
      <td class="ck-num ck-line">${HP.esc(P.peso(P.lineActual(it)))}</td>
    </tr>`;
  }

  /* Live arithmetic: the buyer sees the run's variance move as they type,
     which is the whole point of recording actuals per line. */
  function wireChecklist(root, r, run, readOnly) {
    HP.hydrateIcons(root);
    if (readOnly) return;
    root.addEventListener("input", (e) => {
      if (!e.target.closest("tr[data-key]")) return;
      recalc(root, r);
    });
    root.addEventListener("change", (e) => {
      if (!e.target.classList || !e.target.classList.contains("ck-bought")) return;
      recalc(root, r);
    });
  }

  function readLines(root) {
    return [...root.querySelectorAll("tr[data-key]")].map((tr) => ({
      key: tr.dataset.key,
      bought: tr.querySelector(".ck-bought").checked,
      qtyBought: numOrNull(tr.querySelector(".ck-qty").value),
      unitCostActual: numOrNull(tr.querySelector(".ck-cost").value),
      note: tr.querySelector(".ck-note").value.trim(),
    }));
  }

  function numOrNull(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function recalc(root, r) {
    const edits = readLines(root);
    let actual = 0, bought = 0;
    edits.forEach((e) => {
      const line = e.bought && e.qtyBought > 0 && e.unitCostActual > 0
        ? Math.ceil(e.qtyBought * e.unitCostActual) : 0;
      if (e.bought) bought += 1;
      actual += line;
      const tr = root.querySelector(`tr[data-key="${cssEscape(e.key)}"]`);
      if (tr) tr.querySelector(".ck-line").textContent = P.peso(line);
    });
    const variance = actual - (Number(r.amount) || 0);
    const a = root.querySelector("#ckActual"), v = root.querySelector("#ckVar"), c = root.querySelector("#ckCount");
    if (a) a.textContent = P.peso(actual);
    if (v) { v.textContent = P.signedPeso(variance); v.classList.toggle("is-over", variance > 0); }
    if (c) c.textContent = `${bought}/${edits.length}`;
  }

  // Keys are built from ingredient text, so they can carry quotes and spaces.
  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
  }

  function saveChecklist(r, run, root, hand) {
    const edits = readLines(root);
    const byKey = Object.create(null);
    edits.forEach((e) => { byKey[e.key] = e; });

    if (hand) {
      const nothing = edits.every((e) => !e.bought);
      if (nothing) return HP.toast("Nothing is ticked — there's nothing to hand over yet.", "warn");
    }

    /* Merged inside a transaction against the CURRENT document, never against
       the copy this modal painted from.

       The buyer can now price lines while the run is at the stores (see
       canPriceLines), so the stock clerk may well be quality-checking the very
       same items in another tab. Rebuilding `items` from the opening snapshot
       would carry that colleague's qc/qtyAccepted/qtyRejected back to their
       old values and silently undo their work. Re-reading here means each desk
       only ever overwrites its OWN four fields. */
    const ref = db.collection("procurements").doc(r.id);
    db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
      const cur = snap.data() || {};
      const fresh = Array.isArray(cur.items) ? cur.items : [];

      const items = fresh.map((it) => {
        const e = byKey[it.key];
        if (!e) return it;
        return Object.assign({}, it, {
          bought: e.bought,
          qtyBought: e.qtyBought,
          unitCostActual: e.unitCostActual,
          note: e.note,
        });
      });

      const patch = {
        items,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByName: HP.user.name || "—",
      };
      if (hand) {
        // Guard against handing over a run the stores already took: the stage
        // may have moved while this modal was open.
        if (P.indexOf(cur.stage || "released") > P.indexOf("delivered")) {
          throw Object.assign(new Error("moved"), { code: "hp/moved", stage: cur.stage });
        }
        patch.stage = "delivered";
        patch.history = (Array.isArray(cur.history) ? cur.history : []).concat([{
          stage: "delivered", at: Date.now(), byName: HP.user.name || "—",
          note: "Handed to the stock clerk",
        }]);
        patch.deliveredAt = firebase.firestore.FieldValue.serverTimestamp();
      }
      tx.set(ref, patch, { merge: true });
    })
      .then(() => {
        HP.closeModal();
        HP.toast(hand ? "Handed to the stock clerk." : "Checklist saved.", "ok");
      })
      .catch((e) => {
        if (e && e.code === "hp/moved") {
          HP.closeModal();
          HP.toast(`The stores already took this run on to ${P.labelOf(e.stage)}.`, "warn");
        } else if (e && e.code === "hp/gone") {
          HP.toast("That run no longer exists.", "warn");
        } else HP.toast(writeError(e), "warn");
      });
  }

  function writeError(e) {
    console.warn("HapagPamana: purchase run write —", e);
    return e && e.code === "permission-denied"
      ? "Your role can't change this run."
      : "Couldn't save — check your connection and try again.";
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const head = ["Slip", "Client", "Event", "Function date", "Stage",
      "Authorised (PHP)", "Spent (PHP)", "Variance (PHP)", "Lines", "Bought"];
    const rows = list.map((r) => {
      const t = r.run ? P.totals(r.run.items, r.run.receipts) : null;
      return [
        r.slip, r.clientName, r.kindOfFunction, r.functionDate, P.labelOf(r.stage),
        Number(r.amount) || 0,
        t ? t.actual : "",
        t ? t.actual - (Number(r.amount) || 0) : "",
        t ? t.lines : countLines(r.costing),
        t ? t.bought : 0,
      ];
    });
    const csv = [head, ...rows].map((line) => line.map(HP.csvCell).join(",")).join("\r\n");
    download(csv, `purchase-runs-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  function download(text, name) {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
