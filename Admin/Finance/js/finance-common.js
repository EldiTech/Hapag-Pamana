/* ════════════════════════════════════════════════════════════════
   HapagPamana · Finance — shared costing vocabulary.
   Everything both finance pages speak: peso/date formatting, the costing
   states, the four money checks that decide whether a plan may be
   approved, the requisition numbering, the printable slip, and the
   by-id snapshot helper the board watches its plans and costings with.
   Exposed on `window.HPFin`.

   Loads after hp-core.js (needs HP.esc / HP.icon), before the page script:
     … → hp-core.js → hp-shell.js → js/finance-common.js → js/<page>.js
   ════════════════════════════════════════════════════════════════ */
window.HPFin = (function () {
  "use strict";
  const HP = window.HP;

  /* ── Numbers, money, dates ──────────────────────────────────────────────── */
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  // Whole pesos — the ledger never quotes centavos, and the kitchen's costs
  // are already ceil-rounded per line by the prep plan.
  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "";
    return "₱" + Math.round(n).toLocaleString("en-PH");
  };
  // Same, but a figure of exactly zero is a real answer ("₱0"), not a blank —
  // used where the total genuinely is nothing yet.
  const money0 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return "₱" + Math.round(n).toLocaleString("en-PH");
  };
  const ts = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);
  const round2 = (n) => Math.round(n * 100) / 100;

  const fmtDate = (ms) => (ms
    ? new Date(ms).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })
    : "");
  const fmtDateTime = (ms) => (ms
    ? new Date(ms).toLocaleString("en-PH", {
        year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      })
    : "");

  /* The wizard writes functionDate spelled out ("June 12, 2026") — parseable
     directly. Free-typed dates that don't parse just aren't schedulable.
     (Same reading as the kitchen's prep board.) */
  function eventMs(o) {
    const t = Date.parse(String((o && o.functionDate) || ""));
    return Number.isFinite(t) ? t : 0;
  }
  function daysUntil(o) {
    const ms = eventMs(o);
    if (!ms) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((ms - today.getTime()) / 86400000);
  }
  function dueLabel(o) {
    const d = daysUntil(o);
    if (d === null) return "";
    if (d < 0) return d === -1 ? "yesterday" : `${-d} days ago`;
    if (d === 0) return "today";
    if (d === 1) return "tomorrow";
    return `in ${d} days`;
  }

  /* ── Where a costing stands ──────────────────────────────────────────────
     `waiting` isn't stored — it's what the board reads off an order whose
     kitchen plan isn't ready yet, so there is nothing to cost. The other four
     live in costings/{bookingId}.status. */
  const COSTING_STATES = ["waiting", "review", "approved", "released", "hold"];
  const COSTING_META = {
    waiting:  { label: "Waiting on kitchen", tab: "Waiting", badge: "badge-muted" },
    review:   { label: "To cost",            tab: "To cost",  badge: "badge-warn" },
    approved: { label: "Approved",           tab: "Approved", badge: "badge-cat" },
    released: { label: "Slip released",      tab: "Released", badge: "badge-ok" },
    hold:     { label: "On hold",            tab: "On hold",  badge: "badge-danger" },
  };
  const metaOf = (state) => COSTING_META[state] || COSTING_META.waiting;
  function stateBadge(state, extra) {
    const m = metaOf(state);
    return `<span class="badge ${m.badge}"><span class="dot"></span>${HP.esc(extra || m.label)}</span>`;
  }

  /* ── The order's money, as the app stamped it on the booking ──────────────
     paymentTotal is what the order comes to; the app collects 50% up front
     (paymentDue), and paymentPaid is what actually landed. An order manager
     may also have taken the downpayment by hand — same fields either way, so
     finance reads one figure: what the house is actually holding. */
  const orderTotal = (o) => Number((o && o.paymentTotal) || 0) || 0;
  const isPaid = (o) => String((o && o.paymentStatus) || "") === "paid";
  function cashInHand(o) {
    if (!isPaid(o)) return 0;
    return Number((o && o.paymentPaid) || (o && o.paymentDue) || 0) || 0;
  }
  // True when the booking carries no money figures at all — filed before the
  // downpayment gate existed, or without a priced package to halve. The cash
  // checks can't be judged on it, so they report "no figure" instead of "fail".
  const hasMoneyFigures = (o) =>
    !!(orderTotal(o) || Number((o && o.paymentDue) || 0) || Number((o && o.paymentPaid) || 0));

  /* ── Ingredient lines ────────────────────────────────────────────────────
     A prep-plan line the kitchen priced carries { cost }; one whose recipe had
     no pack price carries null — the amount is known, the money isn't. That
     gap is the first thing finance has to see, so it's counted, never guessed. */
  const lineCost = (it) => (Number(it && it.cost) > 0 ? Number(it.cost) : 0);
  const isPriced = (it) => Number(it && it.cost) > 0;

  function ingredientTotals(items) {
    const rows = Array.isArray(items) ? items : [];
    let cost = 0, unpriced = 0;
    rows.forEach((it) => {
      if (isPriced(it)) cost += lineCost(it);
      else if (String((it && it.ingredient) || "").trim()) unpriced += 1;
    });
    return { cost, unpriced, lines: rows.length };
  }

  /* Canonical units for the slip's market list: grams roll up to kg and mL to
     L, so three plan lines of 800 g become one 2.4 kg line to buy. (The same
     rule the kitchen's shopping-list export uses — the two must agree, or the
     slip and the market run wouldn't tally.) */
  function normalizeQty(qty, unit) {
    const u = String(unit || "").trim();
    const l = u.toLowerCase();
    if (l === "g")  return { qty: qty / 1000, unit: "kg" };
    if (l === "ml") return { qty: qty / 1000, unit: "L" };
    if (l === "kg") return { qty, unit: "kg" };
    if (l === "l")  return { qty, unit: "L" };
    return { qty, unit: u };
  }

  /* The slip's lines: one row per ingredient + unit, quantities and costs
     summed, with the dishes each row is for kept alongside (the auditor's
     question is always "what was this for?"). */
  function slipLines(items) {
    const agg = new Map();
    (Array.isArray(items) ? items : []).forEach((it) => {
      const name = String((it && it.ingredient) || "").trim();
      if (!name) return;
      const raw = Number(it.qty);
      const norm = normalizeQty(Number.isFinite(raw) ? raw : 0, it.unit);
      const key = `${name.toLowerCase()}|${String(norm.unit).toLowerCase()}`;
      const cur = agg.get(key)
        || { ingredient: name, unit: norm.unit, qty: 0, hasQty: false, cost: 0, dishes: new Set() };
      if (Number.isFinite(raw)) { cur.qty += norm.qty; cur.hasQty = true; }
      cur.cost += lineCost(it);
      if (it.dish) cur.dishes.add(String(it.dish));
      agg.set(key, cur);
    });
    return [...agg.values()].sort((a, b) => a.ingredient.localeCompare(b.ingredient));
  }

  /* ── Other costs (labour, transport, rentals…) ───────────────────────────
     Finance's own lines on top of the kitchen's ingredients. Blank labels are
     just unused paper; a row with a label but no figure counts as zero. */
  const OTHER_COST_SUGGESTIONS = [
    "Labour — kitchen crew", "Labour — service crew", "Transport / delivery",
    "Rentals — tables & linen", "Gas & fuel", "Disposables & packaging",
    "Permits & fees", "Contingency",
  ];
  function otherTotal(rows) {
    return (Array.isArray(rows) ? rows : [])
      .reduce((s, r) => s + (Number(r && r.amount) > 0 ? Number(r.amount) : 0), 0);
  }

  /* ── The four money checks ───────────────────────────────────────────────
     What "the right money" means, made explicit — so approving a costing is a
     judgement on named facts and not a feeling. Each check answers ok / fail /
     na ("no figure to judge it on"), and the board refuses to approve while
     any of them fails unless the officer overrides it on the record.

     ctx = { plan, order, ingredientCost, unpriced, lines, totalCost,
             revenue, revenueLabel } — `revenue` is what the job earns: the
     booking's own price, or finance's quoted price where the job was filed
     without one. */
  function checks(ctx) {
    const c = ctx || {};
    const plan = c.plan || null;
    const order = c.order || {};
    const ing = Number(c.ingredientCost) || 0;
    const total = Number(c.totalCost) || 0;
    const cash = cashInHand(order);
    const rev = Number(c.revenue) > 0 ? Number(c.revenue) : orderTotal(order);
    const revLabel = c.revenueLabel || (orderTotal(order) ? "order total" : "quoted price");
    const out = [];

    // 1 — Is the kitchen's list fully priced? An unpriced line understates the
    // requisition, and the shortfall only surfaces at the market.
    out.push(c.unpriced > 0
      ? { key: "priced", state: "fail",
          label: "Every ingredient carries a price",
          detail: `${c.unpriced} line${c.unpriced === 1 ? "" : "s"} of ${c.lines || "?"} have no price — the kitchen's Recipe Book is missing their pack cost, so ${money0(ing)} is an understatement.` }
      : { key: "priced", state: "ok",
          label: "Every ingredient carries a price",
          detail: `All ${c.lines || 0} lines priced — ${money0(ing)} of ingredients.` });

    // 2 — Is this the kitchen's finished list, or one still being written?
    const ready = plan && plan.status === "ready";
    out.push(ready
      ? { key: "ready", state: "ok", label: "The kitchen marked this plan ready",
          detail: `Last saved by the kitchen ${fmtDateTime(ts(plan.updatedAt)) || "at an unknown time"}.` }
      : { key: "ready", state: "fail", label: "The kitchen marked this plan ready",
          detail: plan
            ? "This plan is still a draft on the prep board — the amounts may yet change."
            : "There's no ingredient plan for this order at all." });

    // 3 — Can the requisition be paid out of money the house is holding? This
    // is the question the slip exists to answer: buying against a downpayment
    // that never landed spends money the business doesn't have.
    if (!hasMoneyFigures(order)) {
      out.push({ key: "cash", state: "na", label: "The downpayment covers the requisition",
        detail: "This order carries no payment figures — it was filed without a priced package. Confirm the downpayment with the order manager by hand." });
    } else if (cash <= 0) {
      out.push({ key: "cash", state: "fail", label: "The downpayment covers the requisition",
        detail: `No downpayment has landed on this order yet, so there is nothing to buy ${money0(ing)} of ingredients with.` });
    } else if (cash >= ing) {
      out.push({ key: "cash", state: "ok", label: "The downpayment covers the requisition",
        detail: `${money0(cash)} received covers the ${money0(ing)} requisition, with ${money0(cash - ing)} to spare.` });
    } else {
      out.push({ key: "cash", state: "fail", label: "The downpayment covers the requisition",
        detail: `Short by ${money0(ing - cash)} — ${money0(cash)} received against a ${money0(ing)} requisition.` });
    }

    // 4 — Does the order still make money once every cost is counted?
    if (!rev) {
      out.push({ key: "margin", state: "na", label: "The order still turns a margin",
        detail: "This order carries no price, so there's nothing to measure the costs against — quote the job below before releasing cash against it." });
    } else if (rev > total) {
      const m = rev - total;
      out.push({ key: "margin", state: "ok", label: "The order still turns a margin",
        detail: `${money0(m)} left on a ${money0(rev)} ${revLabel} — ${Math.round((m / rev) * 100)}% margin after ${money0(total)} of costs.` });
    } else {
      out.push({ key: "margin", state: "fail", label: "The order still turns a margin",
        detail: `Costs run ${money0(total - rev)} over the ${money0(rev)} ${revLabel} — this event loses money as costed.` });
    }
    return out;
  }
  const failing = (list) => (list || []).filter((k) => k.state === "fail");

  /* ── Requisition numbering ───────────────────────────────────────────────
     REQ-YYYYMMDD-XXXX, from the release date and the booking's own id. There's
     no server here to run a counter, and a client-side "last number + 1" would
     hand two officers releasing at the same moment the same slip. Deriving the
     number instead makes it collision-free by construction, and reprinting a
     slip reproduces its number rather than inventing a second one for the same
     release. */
  /* The day a slip was cut, as the slip itself states it: `releasedOn` is the
     calendar date the number was derived from, so number and date can never
     disagree on the paper. `releasedAt` (the server's clock) is what the
     register sorts and audits by, and stands in for older slips. */
  function releaseDateMs(req) {
    if (!req) return 0;
    /* "YYYY-MM-DD" is read back as a LOCAL calendar date, deliberately not
       through Date.parse(): that reads a date-only string as UTC midnight, so
       everywhere west of Greenwich the slip would print the day BEFORE the one
       its number was cut from. The two must never disagree on the paper. */
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.releasedOn || ""));
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    return ts(req.releasedAt);
  }

  function reqNumber(bookingId, dateMs) {
    const d = dateMs ? new Date(dateMs) : new Date();
    const p = (n) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const tail = String(bookingId || "").replace(/[^A-Za-z0-9]/g, "")
      .slice(-4).toUpperCase().padStart(4, "0");
    return `REQ-${stamp}-${tail}`;
  }

  /* ── The requisition slip (printable) ────────────────────────────────────
     Built from the costing document's OWN snapshot of the kitchen's list, not
     from the live prep plan — the plan is deleted when the order completes,
     and a released slip has to stay readable long after that.

     `preview` draws the slip as it will print once released: the number it
     will carry, with the release line left open. */
  function slipHTML(c, opts) {
    const o = opts || {};
    const req = c.requisition || null;
    const releasedMs = releaseDateMs(req);
    const number = (req && req.number) || reqNumber(c.bookingId, releasedMs);
    const rows = slipLines(c.ingredients);
    const ingCost = Number(c.ingredientCost) || rows.reduce((s, r) => s + r.cost, 0);
    const amount = req && Number(req.amount) > 0 ? Number(req.amount) : ingCost;

    const fact = (label, value) => (value
      ? `<div class="order-fact"><dt>${HP.esc(label)}</dt><dd>${HP.esc(value)}</dd></div>` : "");
    const due = dueLabel(c);

    return `<div class="req-slip">
      <header class="slip-head">
        <div class="slip-brand">
          <img src="../../assets/HapagPamana.png" alt="" />
          <span class="slip-brand-txt">
            <strong>HapagPamana</strong>
            <small>Catering Services</small>
          </span>
        </div>
        <div class="slip-meta">
          <span class="slip-kind">Requisition Slip</span>
          <span class="slip-no">No. ${HP.esc(number)}</span>
          <span class="slip-when">${o.preview
            ? "Not yet released"
            : `Released ${HP.esc(fmtDate(releasedMs) || "—")}`}</span>
        </div>
      </header>

      <p class="slip-lead">Release the ingredients listed below to the kitchen for the
        function named, charged against this order's downpayment.</p>

      <dl class="order-facts slip-facts">
        ${fact("Client", c.clientName || "Unnamed client")}
        ${fact("Order type", c.bookingType || "Catering")}
        ${fact("Event date", (c.functionDate || "—") + (due ? ` (${due})` : ""))}
        ${fact("Guests", c.pax ? `${c.pax} pax` : "")}
        ${fact("Function", c.kindOfFunction)}
        ${fact("Venue", c.venue)}
      </dl>

      ${rows.length ? `<table class="slip-table">
        <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${HP.esc(r.ingredient)}<small>${HP.esc([...r.dishes].join(", "))}</small></td>
          <td>${r.hasQty ? HP.esc(String(round2(r.qty))) : "—"}</td>
          <td>${HP.esc(r.unit || "")}</td>
          <td>${r.cost ? HP.esc(money(r.cost)) : "—"}</td>
        </tr>`).join("")}</tbody>
        <tfoot><tr><th colspan="3">Ingredients subtotal</th><td>${HP.esc(money0(ingCost))}</td></tr></tfoot>
      </table>` : `<p class="slip-none">This costing carries no ingredient lines.</p>`}

      ${Number(c.unpricedLines) > 0 ? `<p class="slip-warn">${
        HP.esc(`${c.unpricedLines} ingredient line${Number(c.unpricedLines) === 1 ? "" : "s"} had no price when this slip was drawn — the amount below covers only the priced ones.`)}</p>` : ""}

      <div class="slip-amount">
        <small>Amount released</small>
        <strong>${HP.esc(money0(amount))}</strong>
      </div>

      ${c.note ? `<p class="slip-note"><em>Note:</em> ${HP.esc(c.note)}</p>` : ""}
      ${c.overrideChecks && c.overrideChecks.length ? `<p class="slip-warn">${
        HP.esc(`Approved over ${c.overrideChecks.length} failed check${c.overrideChecks.length === 1 ? "" : "s"} on the finance officer's authority.`)}</p>` : ""}

      <div class="slip-signs">
        <div class="slip-sign">
          <span class="slip-rule"></span>
          <small>Prepared by — Master Chef</small>
          <em>the kitchen's ingredient plan</em>
        </div>
        <div class="slip-sign">
          <span class="slip-rule">${HP.esc(c.approvedByName || "")}</span>
          <small>Approved by — Finance</small>
          <em>${HP.esc(ts(c.approvedAt) ? fmtDateTime(ts(c.approvedAt)) : "—")}</em>
        </div>
        <div class="slip-sign">
          <span class="slip-rule"></span>
          <small>Received by</small>
          <em>signature over printed name</em>
        </div>
      </div>
    </div>`;
  }

  /* ── Watching documents by id ────────────────────────────────────────────
     Firestore's `in` operator takes at most 10 values, so a board of N orders
     needs ceil(N/10) listeners per collection; the caller is paint-ready only
     once every chunk has answered. Scoping the streams to the ids actually on
     the board is what keeps a growing archive of finished events from being
     re-read forever. (The kitchen's prep board watches its plans the same way.)
     Returns one unsubscribe for the whole set. */
  function watchByIds(db, coll, ids, onData, onError) {
    if (!ids || !ids.length) { onData(new Map()); return () => {}; }
    const chunks = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const byChunk = new Map();
    const unsubs = chunks.map((chunk, ci) =>
      db.collection(coll)
        .where(firebase.firestore.FieldPath.documentId(), "in", chunk)
        .onSnapshot((snap) => {
          byChunk.set(ci, snap.docs.map((d) => [d.id, d.data()]));
          if (byChunk.size < chunks.length) return; // first paint waits for all
          const merged = new Map();
          byChunk.forEach((pairs) => pairs.forEach(([k, v]) => merged.set(k, v)));
          onData(merged);
        }, onError));
    return () => unsubs.forEach((u) => u());
  }

  /* ── CSV download ────────────────────────────────────────────────────────
     rows[0] is the header. Cells go through HP.csvCell (quote-doubled and
     formula-safe), and the BOM makes Excel open the UTF-8 file with ₱ and
     accents intact. */
  function downloadCSV(rows, filename) {
    const csv = rows.map((r) => r.map(HP.csvCell).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* Who's signing — the finance officer as the portal knows them. */
  const meUid = () => (HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null);
  const meName = () => (HP.user && HP.user.name) || "";

  return {
    num, money, money0, ts, round2, fmtDate, fmtDateTime,
    eventMs, daysUntil, dueLabel,
    COSTING_STATES, COSTING_META, metaOf, stateBadge,
    orderTotal, isPaid, cashInHand, hasMoneyFigures,
    lineCost, isPriced, ingredientTotals, normalizeQty, slipLines,
    OTHER_COST_SUGGESTIONS, otherTotal,
    checks, failing,
    reqNumber, releaseDateMs, slipHTML,
    watchByIds, downloadCSV, meUid, meName,
  };
})();
