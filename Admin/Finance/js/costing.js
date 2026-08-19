/* HapagPamana · Finance — the costing board.
   The last desk between the kitchen and the market. Three live streams meet
   here: the CONFIRMED orders (from the Orders dashboard), the ingredient
   PLANS the Master Chef wrote for them (prepPlans), and finance's own
   COSTINGS. Nothing is copied by hand and nothing is re-typed — the moment
   the chef marks a plan ready, it appears here to be costed.

   The finance officer's job on this page, in the order the paper moves:
     1. Read the kitchen's list — every ingredient and what it costs. These
        amounts are READ-ONLY here; only the kitchen may change them (the
        Firestore rules enforce it, not just the UI).
     2. Add the costs the kitchen doesn't carry — labour, transport, rentals,
        gas, disposables — and, where the job was never priced, the markup and
        quoted price.
     3. CONFIRM THE MONEY IS RIGHT. Four named checks decide it: every
        ingredient is priced, the plan is the kitchen's finished one, the
        downpayment actually received covers the requisition, and the order
        still turns a margin once every cost is counted. A costing with a
        failed check can't be approved except deliberately, on the record.
     4. RELEASE THE REQUISITION SLIP — a numbered, printable authority to
        draw that money and buy those ingredients.

   Each costing is saved to `costings/{bookingId}` (the doc id IS the booking
   id, as with the kitchen's plans) and keeps its OWN snapshot of the
   ingredients it approved: when the order completes, Orders deletes the prep
   plan, and a released slip still has to be readable years later.

   Reading bookings / prepPlans and writing costings requires the finance (or
   admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const F = window.HPFin;

  HP.shell.init();
  HP.shell.setPage({
    title: "Costing Board",
    sub: "Every ingredient plan the kitchen has finished, waiting on the money.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("financeStats");
  const segEl = document.getElementById("costSeg");
  const chipsEl = document.getElementById("typeChips");
  const rowsEl = document.getElementById("orderRows");

  const db = HP.ONLINE ? firebase.firestore() : null;

  let orders = [];           // confirmed bookings [{ id, ...booking }]
  let plans = new Map();     // bookingId → the kitchen's prep plan
  let costings = new Map();  // bookingId → finance's costing
  let query = "";
  let stateFilter = "all";
  let typeFilter = "all";
  let loadedOrders = false, loadedPlans = false, loadedCostings = false;
  let unsubOrders = null;
  let unsubPlans = () => {};
  let unsubCostings = () => {};
  let watchedSig = null;     // the id set the scoped listeners cover

  const { ts, money, money0, dueLabel, daysUntil, eventMs } = F;

  // Skeletons while auth + the first snapshots run.
  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 7);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      segEl.innerHTML = ""; chipsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(
        "Costings live in Firestore — connect Firebase to work the board.");
      return;
    }
    const denied = (e) => e && (e.code === "permission-denied" ||
      /permission|insufficient/i.test(e.message || ""));
    const fail = (e, what) => {
      console.error(`HapagPamana: couldn't load ${what} —`, e);
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(denied(e)
        ? "Access denied — publish the updated Firestore rules (finance access to bookings, prepPlans and costings), then reload."
        : "Couldn't reach the database. Check your connection and reload.");
      if (denied(e)) HP.toast("Database access denied — update your Firestore rules.", "danger");
    };

    // Live stream #1 — the confirmed orders. An order the manager completes or
    // declines leaves this query, and with it the board; its costing lives on
    // in the Requisition Register.
    unsubOrders = db.collection("bookings").where("status", "==", "confirmed")
      .onSnapshot((snap) => {
        orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((o) => !o.deleted); // trashed bookings never reach the board
        // Soonest event first; undated requests sink to the bottom. The
        // sentinel is MAX_SAFE_INTEGER, not Infinity — two undated orders would
        // compare as Infinity - Infinity = NaN and corrupt the sort.
        const FAR = Number.MAX_SAFE_INTEGER;
        orders.sort((a, b) => (eventMs(a) || FAR) - (eventMs(b) || FAR));
        loadedOrders = true;
        renderAll();
        // Streams #2 and #3 follow the ids on the board, so they're rebuilt
        // whenever that set changes (see HPFin.watchByIds).
        const sig = orders.map((o) => o.id).sort().join("|");
        if (sig !== watchedSig) { watchedSig = sig; subscribeScoped(); }
      }, (e) => fail(e, "the confirmed orders"));

    function subscribeScoped() {
      unsubPlans(); unsubCostings();
      const ids = orders.map((o) => o.id);
      // #2 — the kitchen's ingredient plans: what finance is costing.
      unsubPlans = F.watchByIds(db, "prepPlans", ids, (m) => {
        plans = m; loadedPlans = true; renderAll();
      }, (e) => fail(e, "the kitchen's ingredient plans"));
      // #3 — finance's own costings, so two officers on the board see each
      // other's approvals and releases as they happen.
      unsubCostings = F.watchByIds(db, "costings", ids, (m) => {
        costings = m; loadedCostings = true; renderAll();
      }, (e) => fail(e, "the costings"));
    }
  }
  window.addEventListener("beforeunload", () => {
    if (unsubOrders) unsubOrders();
    unsubPlans(); unsubCostings();
  });

  /* ── Vocabulary ──────────────────────────────────────────────────────────── */
  const val = (o, k) => String((o && o[k]) || "").trim();
  const typeOf = (o) => (String(o.bookingType || "").toLowerCase() === "food pack" ? "Food Pack" : "Catering");
  const clientName = (o) => val(o, "clientName") || "Unnamed client";

  const planOf = (o) => plans.get(o.id) || null;
  const costingOf = (o) => costings.get(o.id) || null;

  /* Where an order stands with finance. `waiting` is read off the kitchen's
     plan rather than stored: until the chef marks it ready there is nothing to
     cost. Once a costing document exists, its own status is the truth. */
  function stateOf(o) {
    const c = costingOf(o);
    if (c && F.COSTING_META[c.status] && c.status !== "waiting") return c.status;
    const p = planOf(o);
    return p && p.status === "ready" ? "review" : "waiting";
  }

  /* The kitchen kept working after finance signed off. An approved or released
     costing is a statement about a particular version of the plan (its
     planUpdatedAt), so a later edit upstream makes the signature stale — the
     slip in someone's hand no longer matches the list the chef is cooking. */
  function isStale(o) {
    const c = costingOf(o);
    if (!c || !["approved", "released"].includes(c.status)) return false;
    const p = planOf(o);
    if (!p) return false; // plan already cleared — nothing left to differ from
    return ts(p.updatedAt) > ts(c.planUpdatedAt);
  }

  // What a costing would release: the priced ingredients on the kitchen's list.
  function ingredientTotalsOf(o) {
    const c = costingOf(o);
    const p = planOf(o);
    // A released costing answers from its own snapshot — that's the figure the
    // slip carries, and the plan may since have moved or been deleted.
    if (c && c.status === "released") {
      return { cost: Number(c.ingredientCost) || 0, unpriced: Number(c.unpricedLines) || 0, lines: Number(c.ingredientLines) || 0 };
    }
    return F.ingredientTotals(p ? p.items : []);
  }

  /* ── Rendering ───────────────────────────────────────────────────────────── */
  function renderAll() {
    if (!loadedOrders || !loadedPlans || !loadedCostings) return;
    renderStats(); renderSeg(); renderChips(); renderRows();
  }

  function emptyRow(msg) {
    return `<tr><td colspan="7" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  function renderStats() {
    const byState = (s) => orders.filter((o) => stateOf(o) === s).length;
    const toCost = byState("review");
    const stale = orders.filter(isStale).length;
    // Cash released against the orders still on the board — what the market
    // runs for these events have already been authorised to draw.
    const released = orders.filter((o) => stateOf(o) === "released");
    const cash = released.reduce((s, o) => {
      const c = costingOf(o);
      const r = c && c.requisition;
      return s + (Number(r && r.amount) || 0);
    }, 0);

    // The nav badge nags while anything waits on finance — a plan to cost, or
    // a signature the kitchen has since outdated.
    HP.shell.setBadge(toCost + byState("hold") + stale);

    const stat = (ic, value, label, asMoney) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        ${asMoney
          ? `<div class="stat-num stat-num--money">${HP.esc(value)}</div>`
          : `<div class="stat-num" data-count="${value}">${value}</div>`}
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("basket", toCost, "To cost") +
      stat("check", byState("approved"), "Approved, unreleased") +
      stat("slip", released.length, "Slips released") +
      stat("peso", money0(cash), "Cash released", true))) HP.countUp(statsEl);
  }

  function renderSeg() {
    const count = (s) => (s === "all" ? orders.length : orders.filter((o) => stateOf(o) === s).length);
    segEl.innerHTML = ["all", ...F.COSTING_STATES].map((s) => `
      <button class="seg-btn${stateFilter === s ? " active" : ""}" data-state="${s}">
        ${s === "all" ? "All" : HP.esc(F.metaOf(s).tab)}
        <span class="seg-count">${count(s)}</span>
      </button>`).join("");
    segEl.querySelectorAll("[data-state]").forEach((b) =>
      b.addEventListener("click", () => {
        stateFilter = b.dataset.state;
        segEl.classList.add("anim");
        renderSeg(); renderRows();
      }));
  }

  function renderChips() {
    const types = [["all", "All types"], ["Catering", "Catering"], ["Food Pack", "Food Packs"]];
    chipsEl.innerHTML = types.map(([v, label]) =>
      `<button class="chip-filter${typeFilter === v ? " active" : ""}" data-type="${v}">${label}</button>`).join("");
    chipsEl.querySelectorAll("[data-type]").forEach((b) =>
      b.addEventListener("click", () => {
        typeFilter = b.dataset.type;
        renderChips(); renderRows();
      }));
  }

  function matches(o) {
    if (stateFilter !== "all" && stateOf(o) !== stateFilter) return false;
    if (typeFilter !== "all" && typeOf(o) !== typeFilter) return false;
    if (!query) return true;
    const c = costingOf(o);
    const slip = (c && c.requisition && c.requisition.number) || "";
    return [o.clientName, o.kindOfFunction, o.venue, o.package, slip]
      .some((v) => String(v || "").toLowerCase().includes(query));
  }

  function typeBadge(o) {
    const t = typeOf(o);
    return `<span class="badge badge-cat order-type order-type--${t === "Food Pack" ? "pack" : "catering"}">
      <span class="ic">${HP.icon(t === "Food Pack" ? "box" : "party")}</span>${t}</span>`;
  }

  // The ingredients column: what the kitchen's list comes to, and whether it's
  // whole. An unpriced line is called out here rather than buried in the sheet.
  function ingredientCell(o) {
    const p = planOf(o);
    const c = costingOf(o);
    if (!p && !c) return `<small class="cost-muted">No plan yet</small>`;
    const t = ingredientTotalsOf(o);
    const note = t.unpriced
      ? `<small class="cost-unpriced">${t.unpriced} unpriced of ${t.lines}</small>`
      : `<small>${t.lines} line${t.lines === 1 ? "" : "s"}</small>`;
    return `<div class="cell-money"><strong>${HP.esc(money0(t.cost))}</strong>${note}</div>`;
  }

  // The money column: what the client owes, and what the house is holding.
  function moneyCell(o) {
    const total = F.orderTotal(o);
    const cash = F.cashInHand(o);
    if (!F.hasMoneyFigures(o)) return `<small class="cost-muted">No figures</small>`;
    return `<div class="cell-money">
      <strong>${HP.esc(money0(total))}</strong>
      <small class="${cash > 0 ? "cost-cash" : "cost-unpaid"}">${
        cash > 0 ? `${HP.esc(money(cash))} received` : "downpayment unpaid"}</small>
    </div>`;
  }

  function stateCell(o) {
    const state = stateOf(o);
    const c = costingOf(o);
    const slip = c && c.requisition && c.requisition.number;
    return `${F.stateBadge(state)}
      ${slip && state === "released" ? `<small class="cost-slip-no">${HP.esc(slip)}</small>` : ""}
      ${isStale(o) ? `<small class="cost-stale">Kitchen changed the plan since</small>` : ""}`;
  }

  function renderRows() {
    if (!loadedOrders || !loadedPlans || !loadedCostings) return;
    const list = orders.filter(matches);
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(orders.length
        ? "No orders match your filters."
        : "No confirmed orders yet — once the order manager accepts one and the kitchen plans its ingredients, it lands here to be costed.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((o) => {
      const d = daysUntil(o);
      const overdue = d !== null && d < 0;
      const released = stateOf(o) === "released";
      return `
      <tr data-id="${HP.esc(o.id)}" class="cost-row">
        <td data-label="Event">
          <div class="cell-name"><div>
            <strong>${HP.esc(val(o, "functionDate") || "—")}</strong>
            <small${overdue ? ` class="due-past"` : ""}>${HP.esc(dueLabel(o) || "no date parsed")}</small>
          </div></div>
        </td>
        <td data-label="Client">
          <div class="cell-name"><div>
            <strong>${HP.esc(clientName(o))}</strong>
            <small>${HP.esc(val(o, "kindOfFunction") || val(o, "venue") || "—")}</small>
          </div></div>
        </td>
        <td data-label="Type">${typeBadge(o)}</td>
        <td data-label="Ingredients">${ingredientCell(o)}</td>
        <td data-label="The money">${moneyCell(o)}</td>
        <td data-label="Costing">${stateCell(o)}</td>
        <td>
          <div class="row-actions">
            ${released ? `<button class="icon-btn" data-act="print" title="Print the requisition slip" aria-label="Print ${HP.esc(clientName(o))}'s requisition slip"><span class="ic">${HP.icon("printer")}</span></button>` : ""}
            <button class="icon-btn" data-act="open" title="Open the costing" aria-label="Open the costing for ${HP.esc(clientName(o))}'s order"><span class="ic">${HP.icon("pencil")}</span></button>
          </div>
        </td>
      </tr>`;
    }).join(""));

    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const o = orders.find((x) => x.id === e.currentTarget.closest("tr").dataset.id);
      if (!o) return;
      if (e.currentTarget.dataset.act === "print") return openSlip(o);
      openCosting(o);
    }));
    // The whole row opens the costing (buttons handle their own clicks).
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const o = orders.find((x) => x.id === tr.dataset.id);
        if (o) openCosting(o);
      }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The costing sheet
     ═══════════════════════════════════════════════════════════════════════ */

  const GENERAL = "Whole event"; // the kitchen's bucket for shared items

  /* The kitchen's list, read-only and grouped the way the chef wrote it. It is
     deliberately not editable: an amount finance quietly "corrected" here would
     put the slip and the kitchen's own board out of step, and the Firestore
     rules refuse the write anyway (prepPlans is the kitchen's book). */
  function kitchenHTML(plan) {
    const items = (plan && Array.isArray(plan.items) ? plan.items : [])
      .filter((it) => String(it.ingredient || "").trim());
    if (!items.length) {
      return `<section class="order-sec">
        <h4>The kitchen's list</h4>
        <p class="modal-text">The kitchen hasn't listed any ingredients for this order yet.
          Nothing can be costed until it has.</p>
      </section>`;
    }
    const byDish = new Map();
    items.forEach((it) => {
      const d = String(it.dish || GENERAL);
      if (!byDish.has(d)) byDish.set(d, []);
      byDish.get(d).push(it);
    });
    const t = F.ingredientTotals(items);
    const bodies = [...byDish.entries()].map(([dish, rows]) => `
      <tbody>
        <tr class="cost-group"><th colspan="4">${HP.esc(dish)}</th></tr>
        ${rows.map((it) => `<tr${F.isPriced(it) ? "" : ` class="cost-row-unpriced"`}>
          <td>${HP.esc(it.ingredient)}</td>
          <td>${it.qty === 0 || it.qty ? HP.esc(String(it.qty)) : "—"}</td>
          <td>${HP.esc(it.unit || "")}</td>
          <td>${F.isPriced(it) ? HP.esc(money(it.cost)) : `<span class="cost-noprice" title="The kitchen's recipe carries no pack price for this ingredient">no price</span>`}</td>
        </tr>`).join("")}
      </tbody>`).join("");

    return `<section class="order-sec">
      <h4>The kitchen's list</h4>
      <p class="plan-hint">Written by the Master Chef on the prep board — amounts and
        prices are the kitchen's to change, not finance's.</p>
      <table class="cost-table">
        <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
        ${bodies}
        <tfoot><tr><th colspan="3">Ingredients</th><td>${HP.esc(money0(t.cost))}</td></tr></tfoot>
      </table>
      ${t.unpriced ? `<p class="cost-warn">${HP.esc(`${t.unpriced} of ${t.lines} lines carry no price`)} —
        the recipe behind them has no pack cost, so the total above is an understatement.
        Ask the kitchen to price them in the Recipe Book before this is approved.</p>` : ""}
    </section>`;
  }

  function otherRowHTML(r) {
    r = r || {};
    const amt = Number(r.amount) > 0 ? String(Math.round(Number(r.amount))) : "";
    return `<div class="oc-row">
      <input class="control oc-label" list="ocSuggest" placeholder="Cost — e.g. transport" value="${HP.esc(r.label || "")}" />
      <input class="control oc-amt" type="number" min="0" step="1" placeholder="₱" value="${HP.esc(amt)}" />
      <button type="button" class="icon-btn oc-del" title="Remove this cost"><span class="ic">${HP.icon("trash")}</span></button>
    </div>`;
  }

  function otherHTML(costing) {
    const rows = (costing && Array.isArray(costing.otherCosts) ? costing.otherCosts : [])
      .filter((r) => String(r.label || "").trim() || Number(r.amount) > 0);
    return `<section class="order-sec">
      <h4>Other costs</h4>
      <p class="plan-hint">Everything the kitchen's list doesn't carry — crew, transport,
        rentals, gas, disposables, the contingency you always wish you'd kept.</p>
      <datalist id="ocSuggest">${F.OTHER_COST_SUGGESTIONS
        .map((s) => `<option value="${HP.esc(s)}"></option>`).join("")}</datalist>
      <div class="oc-rows" id="ocRows">${(rows.length ? rows : [null]).map(otherRowHTML).join("")}</div>
      <button type="button" class="btn btn-ghost add-ing" id="ocAdd"><span class="ic">${HP.icon("plus")}</span>Add a cost</button>
    </section>`;
  }

  /* The money, totted up: the two subtotals, what the job earns, what the house
     is holding against it, and what's left. Redrawn on every keystroke. */
  function moneyHTML(m) {
    const line = (label, value, cls) => `
      <div class="cm-line${cls ? " " + cls : ""}">
        <dt>${HP.esc(label)}</dt><dd>${HP.esc(value)}</dd>
      </div>`;
    const marginCls = m.revenue ? (m.margin > 0 ? "cm-good" : "cm-bad") : "cm-none";
    return `
      ${line("Ingredients", money0(m.ingredientCost))}
      ${line("Other costs", money0(m.otherCost))}
      ${line("Total cost", money0(m.totalCost), "cm-total")}
      ${line(m.revenueLabel === "quoted price" ? "Quoted price" : "Order total", money0(m.revenue))}
      ${line("Downpayment received", m.cash > 0 ? money0(m.cash) : "none yet")}
      ${line("Margin", m.revenue
        ? `${money0(m.margin)}${m.revenue ? ` · ${Math.round((m.margin / m.revenue) * 100)}%` : ""}`
        : "no price to measure", marginCls)}`;
  }

  function checksHTML(list) {
    const ic = { ok: "check", fail: "ban", na: "clock" };
    return list.map((k) => `
      <li class="ck ck--${k.state}">
        <span class="ck-ic"><span class="ic">${HP.icon(ic[k.state])}</span></span>
        <div class="ck-txt">
          <strong>${HP.esc(k.label)}</strong>
          <small>${HP.esc(k.detail)}</small>
        </div>
      </li>`).join("");
  }

  function footHTML(state, stale) {
    const print = `<button class="btn btn-ghost" id="csPrint" title="Print this costing"><span class="ic">${HP.icon("printer")}</span>Print</button>`;
    const save = `<button class="btn btn-ghost" id="csSave"><span class="ic">${HP.icon("pencil")}</span>Save draft</button>`;
    const hold = `<button class="btn btn-danger" id="csHold" title="Send this costing back with a reason"><span class="ic">${HP.icon("ban")}</span>Put on hold</button>`;
    if (state === "released") {
      return `${print}
        <button class="btn btn-ghost" id="csReopen" title="Void this slip and cost the order again"><span class="ic">${HP.icon("undo")}</span>Re-open</button>
        <button class="btn btn-primary" id="csSlip"><span class="ic">${HP.icon("slip")}</span>The slip</button>`;
    }
    if (state === "approved") {
      return `${print}
        <button class="btn btn-ghost" id="csBack"><span class="ic">${HP.icon("undo")}</span>Back to costing</button>
        <button class="btn btn-primary${stale ? " is-locked" : ""}" id="csRelease" title="${
          stale ? "Locked — the kitchen changed the plan after this was approved" : "Cut the requisition slip"}"><span class="ic">${HP.icon(stale ? "ban" : "slip")}</span>Release requisition</button>`;
    }
    if (state === "hold") {
      return `${print}${save}
        <button class="btn btn-primary" id="csResume"><span class="ic">${HP.icon("undo")}</span>Take off hold</button>`;
    }
    // waiting / review
    return `${print}${hold}${save}
      <button class="btn btn-primary" id="csApprove"><span class="ic">${HP.icon("check")}</span>Approve the money</button>`;
  }

  function openCosting(o) {
    const plan = planOf(o);
    const costing = costingOf(o);
    const state = stateOf(o);
    const stale = isStale(o);
    const planMeta = plan
      ? (plan.status === "ready"
          ? { label: "Plan ready", badge: "badge-ok" }
          : { label: "Plan still a draft", badge: "badge-warn" })
      : { label: "No plan yet", badge: "badge-muted" };

    const ctxFact = (ic, txt) => (txt
      ? `<span class="plan-fact"><span class="ic">${HP.icon(ic)}</span>${HP.esc(txt)}</span>` : "");
    const due = dueLabel(o);
    const markup = costing && Number(costing.markupPct) > 0 ? String(costing.markupPct) : "";
    const quoted = costing && Number(costing.quotedPrice) > 0 ? String(Math.round(costing.quotedPrice)) : "";

    HP.openModal(`Costing — ${clientName(o)}`, `
      <div class="cost-sheet">
        <div class="plan-sheet-head">
          ${typeBadge(o)}
          <span class="badge ${planMeta.badge}"><span class="dot"></span>${planMeta.label}</span>
          ${F.stateBadge(state)}
          <div class="plan-facts">
            ${ctxFact("calendar", val(o, "functionDate") + (due ? ` (${due})` : ""))}
            ${ctxFact("users", val(o, "pax") && `${val(o, "pax")} pax`)}
            ${ctxFact("party", val(o, "kindOfFunction"))}
            ${ctxFact("dish", val(o, "package"))}
          </div>
        </div>

        ${stale ? `<p class="cost-warn cost-warn--loud">The kitchen changed this plan after
          finance signed it off. Re-cost it and release a fresh slip — the one already
          issued no longer matches what the chef is cooking.</p>` : ""}

        ${kitchenHTML(plan)}
        ${otherHTML(costing)}

        <section class="order-sec">
          <h4>The money</h4>
          <dl class="cost-money" id="costMoney"></dl>
          <div class="field-row cost-quote">
            <div class="field">
              <label for="csMarkup">Markup %</label>
              <input class="control" id="csMarkup" type="number" min="0" step="1" placeholder="e.g. 35" value="${HP.esc(markup)}" />
              <div class="field-hint" id="csSuggest">A markup over the total cost — the price the job should fetch.</div>
            </div>
            <div class="field">
              <label for="csQuoted">Quoted price</label>
              <input class="control" id="csQuoted" type="number" min="0" step="1" placeholder="₱" value="${HP.esc(quoted)}" />
              <div class="field-hint">${F.orderTotal(o)
                ? `The margin follows the order's own price (${HP.esc(money0(F.orderTotal(o)))}). A figure here only records a revised quotation — it doesn't change what the client owes.`
                : "This order was filed without a priced package, so the margin is measured against whatever you quote here."}</div>
            </div>
          </div>
        </section>

        <section class="order-sec">
          <h4>Is the money right?</h4>
          <ul class="cost-checks" id="costChecks"></ul>
        </section>

        <section class="order-sec">
          <h4>Note</h4>
          <textarea class="control" id="csNote" placeholder="Anything the next person needs to know — why it's on hold, what you queried with the kitchen, how the price was agreed.">${HP.esc((costing && costing.note) || "")}</textarea>
        </section>
      </div>`,
      footHTML(state, stale));

    const sheet = document.querySelector(".cost-sheet");
    const moneyEl = document.getElementById("costMoney");
    const checksEl = document.getElementById("costChecks");
    const suggestEl = document.getElementById("csSuggest");

    /* Everything the sheet holds, read off the DOM as it stands right now:
       called on every keystroke to redraw, and once more to hand a SNAPSHOT to
       whatever writes. It must be a snapshot, because the dialogs that confirm
       a write (approve-over-a-failure, hold, release) replace this sheet in the
       modal root — by the time they're answered, these inputs are gone. */
    function figures() {
      const t = F.ingredientTotals(plan ? plan.items : []);
      const other = collectOther();
      const otherCost = F.otherTotal(other);
      const totalCost = t.cost + otherCost;
      const orderT = F.orderTotal(o);
      const quotedNow = Math.max(0, F.num(document.getElementById("csQuoted").value) || 0);
      // The booking's own price rules; finance's quote stands in only where the
      // job was never priced (a food-pack request with no package to halve).
      const revenue = orderT || quotedNow;
      return {
        ...t, ingredientCost: t.cost,
        other, otherCost, totalCost,
        orderTotal: orderT, quoted: quotedNow,
        revenue, revenueLabel: orderT ? "order total" : "quoted price",
        margin: revenue ? revenue - totalCost : null,
        cash: F.cashInHand(o),
        markupPct: Math.max(0, F.num(document.getElementById("csMarkup").value) || 0),
        note: document.getElementById("csNote").value.trim(),
      };
    }

    let currentChecks = [];
    function refresh() {
      const m = figures();
      moneyEl.innerHTML = moneyHTML(m);
      currentChecks = F.checks({
        plan, order: o,
        ingredientCost: m.ingredientCost, unpriced: m.unpriced, lines: m.lines,
        totalCost: m.totalCost, revenue: m.revenue, revenueLabel: m.revenueLabel,
      });
      checksEl.innerHTML = checksHTML(currentChecks);
      // The markup's whole point is the figure it suggests — show it as typed.
      suggestEl.textContent = m.markupPct > 0 && m.totalCost > 0
        ? `${m.markupPct}% over ${money0(m.totalCost)} of cost suggests ${money0(Math.ceil(m.totalCost * (1 + m.markupPct / 100)))}.`
        : "A markup over the total cost — the price the job should fetch.";
      const approve = document.getElementById("csApprove");
      if (approve) {
        const bad = F.failing(currentChecks).length;
        approve.classList.toggle("is-locked", bad > 0);
        approve.title = bad
          ? `${bad} check${bad === 1 ? "" : "s"} failed — approving needs a reason on the record`
          : "The money checks out — approve this costing";
      }
    }

    function collectOther() {
      return [...sheet.querySelectorAll(".oc-row")].map((r) => ({
        label: r.querySelector(".oc-label").value.trim(),
        // Negative costs aren't costs — clamp, the way the kitchen clamps its
        // quantities.
        amount: Math.max(0, F.num(r.querySelector(".oc-amt").value) || 0),
      })).filter((r) => r.label || r.amount > 0);
    }

    refresh();
    sheet.addEventListener("input", refresh);
    sheet.addEventListener("click", (e) => {
      if (e.target.closest("#ocAdd")) {
        const rows = document.getElementById("ocRows");
        rows.insertAdjacentHTML("beforeend", otherRowHTML());
        rows.lastElementChild.querySelector(".oc-label").focus();
        return;
      }
      const del = e.target.closest(".oc-del");
      if (del) { del.closest(".oc-row").remove(); refresh(); }
    });

    /* Conflict context for this open of the sheet: the costing's updatedAt as
       painted, plus a force flag set once this officer has been warned that
       another session saved meanwhile. (The kitchen's planner guards its plans
       the same way.) */
    const saveCtx = { openedAt: ts(costing && costing.updatedAt), force: false };
    const wire = (id, fn) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", fn);
    };

    wire("csPrint", HP.printModal);
    wire("csSave", () => save(o, plan, "review", figures(), saveCtx));
    wire("csApprove", () => {
      const bad = F.failing(currentChecks);
      if (bad.length) return approveAnyway(o, plan, bad, saveCtx, figures());
      save(o, plan, "approved", figures(), saveCtx, { approve: true });
    });
    wire("csHold", () => holdModal(o, plan, saveCtx, figures()));
    wire("csResume", () => save(o, plan, "review", figures(), saveCtx));
    wire("csBack", () => save(o, plan, "review", figures(), saveCtx));
    wire("csRelease", () => {
      if (stale) return HP.toast("Re-cost this order first — the kitchen's plan moved on since you approved it.", "warn");
      releaseModal(o, plan, figures(), saveCtx);
    });
    wire("csSlip", () => openSlip(o));
    wire("csReopen", () => reopenModal(o, plan, figures(), saveCtx));
  }

  /* Approving over a failed check. Finance is the authority here, so the way
     through is not a hidden override but a recorded one: the reason is required,
     the failed checks are named on the document, and the slip prints the fact. */
  function approveAnyway(o, plan, bad, ctx, f) {
    HP.openModal("The money doesn't check out", `
      <p class="modal-text">${HP.esc(String(bad.length))} check${bad.length === 1 ? "" : "s"}
        failed on this costing:</p>
      <ul class="cost-checks cost-checks--tight">${checksHTML(bad)}</ul>
      <p class="modal-text">You can put the costing on hold until it's sorted, or approve it
        anyway on your own authority — which records the override on the costing and prints
        it on the requisition slip.</p>
      <div class="field">
        <label for="ovReason">Why is this approved as it stands? <span class="req">*</span></label>
        <textarea class="control" id="ovReason" placeholder="e.g. Client paid the balance in cash to the owner — receipt 4471, banked Monday."></textarea>
        <div class="field-error" id="ovErr" hidden></div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="ovGo"><span class="ic">${HP.icon("check")}</span>Approve on my authority</button>`);
    document.getElementById("ovGo").addEventListener("click", () => {
      const reason = document.getElementById("ovReason").value.trim();
      const err = document.getElementById("ovErr");
      if (!reason) {
        err.hidden = false;
        err.textContent = "An override needs a reason — it's the only record of why.";
        return;
      }
      save(o, plan, "approved", f, ctx, {
        approve: true,
        override: { reason, checks: bad.map((k) => k.key) },
      });
    });
  }

  function holdModal(o, plan, ctx, f) {
    HP.openModal("Put this costing on hold", `
      <p class="modal-text">A costing on hold is one finance won't release money against yet.
        Say why, so whoever picks it up — or the kitchen, when you ring them — knows what
        to fix.</p>
      <div class="field">
        <label for="hdReason">Reason <span class="req">*</span></label>
        <textarea class="control" id="hdReason" placeholder="e.g. Four ingredients have no pack price — waiting on the Master Chef to cost them."></textarea>
        <div class="field-error" id="hdErr" hidden></div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-danger" id="hdGo"><span class="ic">${HP.icon("ban")}</span>Put on hold</button>`);
    document.getElementById("hdGo").addEventListener("click", () => {
      const reason = document.getElementById("hdReason").value.trim();
      const err = document.getElementById("hdErr");
      if (!reason) { err.hidden = false; err.textContent = "A hold needs a reason."; return; }
      save(o, plan, "hold", f, ctx, { note: reason });
    });
  }

  /* Releasing the requisition. The last stop before money leaves the house, so
     it states the figure plainly and asks once. */
  function releaseModal(o, plan, f, ctx) {
    const number = F.reqNumber(o.id, Date.now());
    HP.openModal("Release the requisition", `
      <p class="modal-text">This cuts requisition slip <strong>${HP.esc(number)}</strong> for
        <strong>${HP.esc(clientName(o))}</strong>'s event and releases
        <strong>${HP.esc(money0(f.ingredientCost))}</strong> against the kitchen's list of
        ${HP.esc(String(f.lines))} ingredient line${f.lines === 1 ? "" : "s"}.</p>
      <p class="modal-text">The slip prints straight after, ready to sign and hand over.</p>
      ${f.cash > 0 && f.cash < f.ingredientCost ? `<p class="cost-warn">Only ${
        HP.esc(money0(f.cash))} has been received on this order — you are releasing ${
        HP.esc(money0(f.ingredientCost - f.cash))} more than the house is holding.</p>` : ""}`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="rlGo"><span class="ic">${HP.icon("slip")}</span>Release &amp; print</button>`);
    document.getElementById("rlGo").addEventListener("click", () => {
      save(o, plan, "released", f, ctx, { release: { number, amount: f.ingredientCost } });
    });
  }

  function reopenModal(o, plan, f, ctx) {
    const c = costingOf(o) || {};
    const number = (c.requisition && c.requisition.number) || "—";
    HP.confirmModal("Void this slip and re-open?",
      `Requisition ${number} stops being the live authority for this event and the costing goes back to be worked on. The voided slip stays on the record. Reprint it first if you need the paper.`,
      () => save(o, plan, "review", f, ctx, { voidRequisition: true }), true);
  }

  /* ── Writing the costing ─────────────────────────────────────────────────
     One writer for every transition, so a costing can never be saved with its
     figures and its status out of step. The document carries its own snapshot
     of the kitchen's list and of the order's money — the plan is deleted when
     the event completes, and the register still has to be able to draw the
     slip. */
  let saving = false;
  async function save(o, plan, status, f, ctx, opts) {
    if (saving) return; // double-click — the first write is still in flight
    saving = true;
    const foot = [...document.querySelectorAll(".modal-foot .btn")];
    foot.forEach((b) => { b.disabled = true; });
    const extra = opts || {};
    try {
      const ref = db.collection("costings").doc(o.id);
      const prev = await ref.get();
      const prevData = prev.exists ? prev.data() : null;
      // Another officer may have saved this costing while the sheet was open —
      // warn once instead of silently clobbering their work.
      if (ctx && !ctx.force) {
        const stamp = ts(prevData && prevData.updatedAt);
        if (stamp > ctx.openedAt) {
          ctx.force = true;
          HP.toast("This costing changed in another session — save again to overwrite.", "warn");
          return;
        }
      }

      const items = (plan && Array.isArray(plan.items) ? plan.items : [])
        .filter((it) => String(it.ingredient || "").trim());
      // The note comes from the figures snapshot, never from the DOM: by now a
      // confirming dialog may have replaced the sheet the officer typed it in.
      const note = typeof extra.note === "string" ? extra.note
        : (typeof f.note === "string" ? f.note : ((prevData && prevData.note) || ""));

      const doc = {
        bookingId: o.id,
        status,
        // The kitchen's list as approved — the slip's source of truth.
        ingredients: items,
        ingredientCost: f.ingredientCost || 0,
        ingredientLines: f.lines || 0,
        unpricedLines: f.unpriced || 0,
        otherCosts: f.other || [],
        otherCost: f.otherCost || 0,
        totalCost: f.totalCost || 0,
        markupPct: f.markupPct || null,
        quotedPrice: f.quoted || null,
        // The order's money as it stood when this was costed.
        orderTotal: f.orderTotal || null,
        downpayment: f.cash || null,
        margin: f.revenue ? f.margin : null,
        // Denormalised so the register and the slip read without a second
        // lookup — and still read true once the booking has moved on.
        clientName: clientName(o),
        functionDate: val(o, "functionDate"),
        kindOfFunction: val(o, "kindOfFunction"),
        venue: val(o, "venue"),
        pax: val(o, "pax"),
        bookingType: typeOf(o),
        // Which version of the kitchen's plan this costing speaks for.
        planStatus: (plan && plan.status) || null,
        planUpdatedAt: (plan && plan.updatedAt) || null,
        note,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: F.meUid(),
        updatedByName: F.meName(),
      };

      if (extra.approve) {
        doc.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
        doc.approvedBy = F.meUid();
        doc.approvedByName = F.meName();
        doc.overrideChecks = (extra.override && extra.override.checks) || [];
        doc.overrideReason = (extra.override && extra.override.reason) || null;
        if (extra.override) doc.note = extra.override.reason;
      } else if (prevData) {
        // Not an approval — carry the existing signature rather than dropping
        // it (a full set() would wipe who signed and when).
        doc.approvedAt = prevData.approvedAt || null;
        doc.approvedBy = prevData.approvedBy || null;
        doc.approvedByName = prevData.approvedByName || null;
        doc.overrideChecks = prevData.overrideChecks || [];
        doc.overrideReason = prevData.overrideReason || null;
      }

      if (extra.release) {
        /* The slip's number is cut from today's date and the booking id (see
           HPFin.reqNumber), and `releasedOn` records the same day the number
           was cut from — so the printed slip is always internally consistent.
           `releasedAt` is the server's own clock, which is what the register
           sorts and audits by.

           Both are taken from ONE instant, here at the write, not from the
           number the confirm dialog previewed: a dialog left open across
           midnight would otherwise stamp a slip with yesterday's number and
           today's date. */
        const now = new Date();
        doc.requisition = {
          number: F.reqNumber(o.id, now.getTime()),
          amount: extra.release.amount || 0,
          releasedOn: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
          releasedAt: firebase.firestore.FieldValue.serverTimestamp(),
          releasedBy: F.meUid(),
          releasedByName: F.meName(),
        };
      } else if (extra.voidRequisition) {
        // The slip stops being the live authority, but the record of it stays.
        doc.requisition = null;
        doc.voidedRequisition = (prevData && prevData.requisition) || null;
        doc.voidedBy = F.meName();
      } else if (prevData && prevData.requisition) {
        doc.requisition = prevData.requisition; // untouched by an ordinary save
      }
      // A void that happened earlier stays on the record through every later
      // save — this is a full-document set(), so anything not carried is lost.
      if (!extra.voidRequisition && prevData && prevData.voidedRequisition) {
        doc.voidedRequisition = prevData.voidedRequisition;
        doc.voidedBy = prevData.voidedBy || null;
      }

      await ref.set(doc);
      // Paint the new state locally so the sheet/slip that follows doesn't have
      // to wait on the snapshot round-trip.
      costings.set(o.id, { ...doc, updatedAt: firebase.firestore.Timestamp.now() });

      HP.closeModal();
      renderAll();

      if (extra.release) {
        HP.toast(`Requisition ${doc.requisition.number} released — ${money0(doc.requisition.amount)} for ${clientName(o)}.`);
        // The cash physically leaves the box when the slip is handed over, so
        // the float is deducted here rather than waiting for the spend —
        // otherwise the balance keeps counting money already promised to a
        // buyer. Liquidation settles the difference later.
        //
        // Deliberately AFTER the costing write and never blocking it: the
        // requisition is finance's decision and a float that hasn't been
        // opened yet must not stop a slip being cut. A failure here is
        // reported, and the fund can be corrected from the Petty Cash page.
        if (window.HPCash) {
          window.HPCash.release(db, doc.requisition.amount, {
            bookingId: o.id,
            clientName: clientName(o),
            slipNumber: doc.requisition.number,
            note: "Requisition released",
          }).catch((e) => {
            if (e && e.code === "hp/nofund") {
              HP.toast("No petty cash float is open — the slip stands, but the fund wasn't deducted.", "warn");
            } else {
              console.warn("HapagPamana: petty cash release —", e);
              HP.toast("The slip is released, but the petty cash fund couldn't be updated.", "warn");
            }
          });
        }
        openSlip(o); // the slip, ready to print
      } else if (extra.approve) {
        HP.toast(extra.override
          ? `${clientName(o)}'s costing approved on your authority — the override is on the record.`
          : `${clientName(o)}'s costing is approved. Release the requisition when the kitchen's ready to shop.`);
      } else if (status === "hold") {
        HP.toast(`${clientName(o)}'s costing is on hold.`, "warn");
      } else if (extra.voidRequisition) {
        HP.toast(`Requisition voided — ${clientName(o)}'s costing is open again.`, "warn");
      } else {
        HP.toast(`${clientName(o)}'s costing is saved.`);
      }
    } catch (e) {
      console.error("HapagPamana: couldn't save the costing —", e);
      HP.toast("Couldn't save the costing — check your connection and the Firestore rules.", "danger");
    } finally {
      saving = false;
      foot.forEach((b) => { b.disabled = false; });
    }
  }

  /* ── The requisition slip ───────────────────────────────────────────────── */
  function openSlip(o) {
    const c = costingOf(o);
    if (!c) return HP.toast("There's no costing on this order yet.", "warn");
    const released = c.status === "released";
    HP.openModal(released ? "Requisition slip" : "Requisition slip — preview",
      F.slipHTML({ ...c, bookingId: o.id }, { preview: !released }),
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="slipPrint"><span class="ic">${HP.icon("printer")}</span>Print</button>`);
    document.getElementById("slipPrint").addEventListener("click", HP.printModal);
  }

  /* ── Export (the board as it's filtered) ─────────────────────────────────── */
  function exportCSV() {
    const list = orders.filter(matches);
    if (!list.length) return HP.toast("Nothing to export — the board is empty under these filters.", "warn");
    const rows = [[
      "Event date", "Client", "Type", "Pax", "Kitchen plan", "Ingredients (PHP)",
      "Unpriced lines", "Other costs (PHP)", "Total cost (PHP)", "Order total (PHP)",
      "Downpayment (PHP)", "Margin (PHP)", "Costing", "Slip no.", "Released on",
    ]];
    list.forEach((o) => {
      const c = costingOf(o) || {};
      const p = planOf(o);
      const t = ingredientTotalsOf(o);
      const other = Number(c.otherCost) || 0;
      const total = t.cost + other;
      const revenue = F.orderTotal(o) || Number(c.quotedPrice) || 0;
      const req = c.requisition || null;
      rows.push([
        val(o, "functionDate"), clientName(o), typeOf(o), val(o, "pax"),
        p ? (p.status === "ready" ? "Ready" : "Draft") : "None",
        t.cost || "", t.unpriced || "", other || "", total || "",
        F.orderTotal(o) || "", F.cashInHand(o) || "",
        revenue ? revenue - total : "",
        F.metaOf(stateOf(o)).label,
        (req && req.number) || "",
        (req && (req.releasedOn || F.fmtDate(ts(req.releasedAt)))) || "",
      ]);
    });
    F.downloadCSV(rows, "hapagpamana_costings.csv");
    HP.toast(`Exported ${list.length} costing${list.length === 1 ? "" : "s"} as CSV.`);
  }
})();
