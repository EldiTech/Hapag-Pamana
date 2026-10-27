/* HapagPamana · Procurement lifecycle — the ONE definition of how a released
   requisition travels from Finance to the shelf, shared by every desk that
   touches it (Purchasing, Stock Clerk, and whatever comes after).

   Why this file exists
   ────────────────────
   The booking/prep-plan flow that came before it spells its statuses as bare
   strings compared in place ("confirmed", "draft", "released"), in both the
   Flutter app and each dashboard's JS. Adding a stage there means hunting
   literals across two codebases that must agree. This flow does not repeat
   that: every stage, every transition and every label lives here, and the
   dashboards ask this file rather than testing strings themselves.

   Adding a stage later (TL, Logistics, …) is an edit to STAGES and FLOW
   below — not a search across the portal.

   The record
   ──────────
   One `procurements/{costingId}` document per released requisition, created
   the first time Purchasing opens it. It keeps its own snapshot of the lines
   it was cut for: the kitchen may revise the plan afterwards, and a purchase
   run must stay the thing that was actually authorised.

     {
       costingId, bookingId, slipNumber, amount,      // from the released slip
       clientName, functionDate,                       // for humans
       stage,                                          // see STAGES
       items: [{
         key, dish, ingredient, unit,
         qtyRequested, unitCostEstimated,              // as authorised
         qtyBought, unitCostActual, bought, note,      // Purchasing fills
         qtyAccepted, qtyRejected, qc, qcNote,         // Stock Clerk fills
       }],
       receipts: [{ id, image, name, amount, note, uploadedAt, uploadedByName }],
       history: [{ stage, at, byName, note }],          // append-only trail
     }

   Money is kept in centavos-free whole pesos, the way the costing board
   already does it; quantities stay in the unit the kitchen asked for. */
window.HPProc = (function () {
  "use strict";

  /* ── Stages ──────────────────────────────────────────────────────────────
     `owner` is the role whose desk the document is sitting on. `next` is the
     stage it advances to when that desk finishes. A stage with next:null is
     the end of the line — give it a successor when the next role is built. */
  const STAGES = {
    released: {
      label: "Awaiting purchase",
      hint: "Finance released the slip — purchasing has not started the run.",
      owner: "production_manager",
      next: "purchasing",
      badge: "badge-muted",
    },
    purchasing: {
      label: "Purchasing",
      hint: "The buyer is working through the checklist.",
      owner: "purchasing_staff",
      next: "delivered",
      badge: "badge-gold",
    },
    delivered: {
      label: "Delivered to stores",
      hint: "Bought and handed to the stock clerk — awaiting checking in.",
      owner: "purchasing_staff",
      next: "checking",
      badge: "badge-warn",
    },
    checking: {
      label: "Quality checking",
      hint: "The stock clerk is checking each line against the slip.",
      owner: "stock_clerk",
      next: "liquidation",
      badge: "badge-gold",
    },
    liquidation: {
      label: "For liquidation",
      hint: "Checked in — the spend is being reconciled against the slip.",
      owner: "stock_clerk",
      next: "filed",
      badge: "badge-warn",
    },
    filed: {
      label: "Filed with finance",
      hint: "Receipts and liquidation are with the production manager.",
      owner: "production_manager",
      next: null, // ← give this a successor when TL / Logistics arrive
      badge: "badge-ok",
    },
  };

  /* The order stages appear in — boards and progress rails read this rather
     than Object.keys(), which has no meaningful order to promise. */
  const FLOW = ["released", "purchasing", "delivered", "checking", "liquidation", "filed"];

  const stage = (k) => STAGES[k] || STAGES.released;
  const labelOf = (k) => stage(k).label;
  const indexOf = (k) => Math.max(0, FLOW.indexOf(k));
  const isAfter = (a, b) => indexOf(a) > indexOf(b);
  const nextOf = (k) => stage(k).next;

  /* Which stages a role is allowed to move a document THROUGH. The guard has
     already decided the desk may open the dashboard; this decides whether the
     button on a given row does anything. admin may drive any stage, which is
     what makes a single admin able to walk a run end to end while testing. */
  const DRIVES = {
    purchasing_staff: ["released", "purchasing", "delivered"],
    stock_clerk: ["checking", "liquidation"],
    production_manager: ["filed"],
  };
  function canDrive(role, stageKey) {
    if (role === "admin") return true;
    return (DRIVES[role] || []).indexOf(stageKey) !== -1;
  }

  /* Whether the buyer may still attach or remove receipts.

     Deliberately WIDER than canDrive. A receipt is evidence of spend that has
     already happened, not an action on the run: the buyer routinely walks the
     goods to the stock clerk and only then flattens the paper out of their
     pocket. Gating receipts on canDrive meant the drawer locked the instant
     the clerk opened the run (which moves it to "checking"), while
     liquidationBlockers still refuses to file without a receipt — so the run
     could reach a state where the only desk that can supply the missing
     receipt is the one desk locked out of supplying it, and nothing could
     move it back.

     "filed" is the real close: once the paperwork is with finance the record
     is sealed, and reopening is finance's call. */
  function canAttachReceipts(role, stageKey) {
    if (role === "admin") return true;
    if (role !== "purchasing_staff") return false;
    return (stageKey || "released") !== "filed";
  }

  /* Whether the buyer may still record WHAT THEY PAID — the qty bought and the
     unit cost on each checklist line.

     Wider than canDrive, and for the same reason receipts are: a price is a
     record of money that has already left the buyer's hand, not an action on
     the run. The goods are walked to the stores as soon as they are bought;
     the prices are copied off the market receipts afterwards. Gating them on
     canDrive meant the checklist went read-only at handover, while
     liquidationBlockers still refuses to file a run with unpriced lines — so
     a run could reach a state where the only desk that knows what was paid
     is the one desk locked out of writing it down, and the stock clerk's
     sheet has no price fields to fix it with either.

     The stock clerk's own columns (qc, qtyAccepted, qtyRejected, qcNote) are
     NOT covered by this — quality checking stays that desk's alone, which is
     what saveChecklist enforces when it merges the two desks' edits.

     "filed" closes it: once finance holds the paperwork the spend is a
     finance record, and reopening is their call. */
  function canPriceLines(role, stageKey) {
    if (role === "admin") return true;
    if (role !== "purchasing_staff") return false;
    return (stageKey || "released") !== "filed";
  }

  /* ── Line items ──────────────────────────────────────────────────────────
     Built from the prep plan's items — the same {dish, ingredient, qty, unit,
     unitCost} rows the costing board priced. `key` is what every later write
     addresses a line by, so it must not move when the kitchen edits the plan:
     it is derived from the line's own content, not its position. */
  function lineKey(it, i) {
    const base = `${String(it.dish || "").trim()}|${String(it.ingredient || "").trim()}|${String(it.unit || "").trim()}`;
    return base.replace(/\s+/g, " ").toLowerCase() || `line-${i}`;
  }

  function itemsFromPlan(planItems) {
    const seen = Object.create(null);
    return (Array.isArray(planItems) ? planItems : [])
      .filter((it) => it && String(it.ingredient || "").trim())
      .map((it, i) => {
        // Two identical lines from different dishes are still two lines.
        let key = lineKey(it, i);
        if (seen[key]) key += `#${(seen[key] += 1)}`; else seen[key] = 1;
        const q = Number(it.qty);
        const uc = Number(it.unitCost);
        return {
          key,
          dish: String(it.dish || "").trim(),
          ingredient: String(it.ingredient || "").trim(),
          unit: String(it.unit || "").trim(),
          qtyRequested: Number.isFinite(q) && q > 0 ? q : null,
          unitCostEstimated: Number.isFinite(uc) && uc > 0 ? uc : null,
          // Purchasing.
          //
          // The money columns START at the kitchen's costed figures rather
          // than blank. The Master Chef's recipe book already prices every
          // ingredient (pack cost ÷ pack size → unitCost), that price is what
          // finance authorised the slip against, and it is the number the
          // buyer would otherwise copy by hand off the same sheet.
          //
          // Seeding them is not cosmetic: a line left blank costs ₱0, so a
          // run whose buyer ticked everything and typed nothing reported ₱0
          // spent and could not be liquidated at all. Starting from the
          // authorised figure means a run is always liquidatable, and the
          // buyer only touches a line where the market actually differed —
          // which is what makes the variance mean something.
          bought: false,
          qtyBought: Number.isFinite(q) && q > 0 ? q : null,
          unitCostActual: Number.isFinite(uc) && uc > 0 ? uc : null,
          note: "",
          // Stock clerk
          qc: null, // null = unchecked · "pass" · "fail"
          qtyAccepted: null,
          qtyRejected: null,
          qcNote: "",
        };
      });
  }

  /* ── Money ───────────────────────────────────────────────────────────────
     Estimated is what the slip was cut against; actual is what the run really
     cost. Lines the buyer never touched contribute nothing to actual — an
     unbought line is not a free line, it is an unknown, and the variance
     readout says so rather than quietly reading zero. */
  const lineEstimated = (it) =>
    it && it.qtyRequested > 0 && it.unitCostEstimated > 0
      ? Math.ceil(it.qtyRequested * it.unitCostEstimated) : 0;

  const lineActual = (it) =>
    it && it.bought && it.qtyBought > 0 && it.unitCostActual > 0
      ? Math.ceil(it.qtyBought * it.unitCostActual) : 0;

  function totals(items, receipts) {
    const list = Array.isArray(items) ? items : [];
    let estimated = 0, actual = 0, bought = 0, unpriced = 0, rejected = 0;
    list.forEach((it) => {
      estimated += lineEstimated(it);
      if (it.bought) {
        bought += 1;
        const a = lineActual(it);
        actual += a;
        // Bought, but with nothing to cost it by — the total is understated.
        if (!a) unpriced += 1;
      }
      if (Number(it.qtyRejected) > 0) rejected += 1;
    });
    const receiptTotal = (Array.isArray(receipts) ? receipts : [])
      .reduce((s, r) => s + (Number(r && r.amount) || 0), 0);
    return {
      lines: list.length,
      bought,
      unpriced,
      rejected,
      estimated,
      actual,
      receiptTotal,
      variance: actual - estimated,            // + over the slip, − under it
      unreceipted: actual - receiptTotal,      // spend with no paper behind it
    };
  }

  /* Liquidation is only meaningful once every line has been dealt with and
     the paper matches the spend. This returns the reasons it is NOT ready,
     so the UI can show them rather than just disabling a button. */
  function liquidationBlockers(items, receipts) {
    const list = Array.isArray(items) ? items : [];
    const t = totals(list, receipts);
    const out = [];
    if (!list.length) out.push("This run has no lines.");
    const untouched = list.filter((it) => !it.bought && !String(it.note || "").trim()).length;
    if (untouched) out.push(`${untouched} line${untouched === 1 ? " is" : "s are"} neither bought nor explained.`);
    const unchecked = list.filter((it) => it.bought && !it.qc).length;
    if (unchecked) out.push(`${unchecked} bought line${unchecked === 1 ? " has" : "s have"} not been quality checked.`);
    if (t.unpriced) out.push(`${t.unpriced} bought line${t.unpriced === 1 ? " has" : "s have"} no actual price.`);
    if (!(Array.isArray(receipts) && receipts.length)) out.push("No receipt has been attached.");
    return out;
  }

  /* ── Receipts ────────────────────────────────────────────────────────────
     Receipts are evidence, so they are stored at a higher quality than the
     menu photos are: a receipt whose total has been compressed into mush is
     not a record of anything. They still have to fit a Firestore document,
     which is the ceiling this budget respects.

     When Firebase Storage is turned on for the project, only `readFile` below
     changes — it starts returning a hosted URL instead of a data URL, and
     everything that reads `receipt.image` keeps working. */
  const RECEIPT_IMG = { maxSize: 1600, quality: 0.9, step: 0.08, budget: 900 * 1024 };

  function readFile(file, opts) {
    const o = Object.assign({}, RECEIPT_IMG, opts || {});
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error("That file isn't an image."));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("That image couldn't be read."));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("That image couldn't be opened."));
        img.onload = () => {
          const scale = Math.min(1, o.maxSize / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const cv = document.createElement("canvas");
          cv.width = w; cv.height = h;
          const cx = cv.getContext("2d");
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, w, h); // JPEG has no alpha
          cx.drawImage(img, 0, 0, w, h);
          let q = o.quality, out = cv.toDataURL("image/jpeg", q);
          while (out.length > o.budget && q > 0.4) out = cv.toDataURL("image/jpeg", (q -= o.step));
          if (out.length > o.budget) return reject(new Error("That receipt is too large to store — photograph it closer, or crop it."));
          resolve(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* ── Formatting ──────────────────────────────────────────────────────── */
  const peso = (n) => "₱" + Math.round(Number(n) || 0).toLocaleString("en-PH");
  const signedPeso = (n) => (Number(n) > 0 ? "+" : Number(n) < 0 ? "−" : "") + peso(Math.abs(Number(n) || 0));
  function qty(n, unit) {
    if (n === null || n === undefined || n === "" || !Number.isFinite(Number(n))) return "—";
    const v = Number(n);
    const s = Math.abs(v % 1) < 1e-9 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
    return unit ? `${s} ${unit}` : s;
  }

  return {
    STAGES, FLOW, DRIVES,
    stage, labelOf, indexOf, isAfter, nextOf, canDrive,
    itemsFromPlan, lineKey, canAttachReceipts, canPriceLines,
    lineEstimated, lineActual, totals, liquidationBlockers,
    readFile, RECEIPT_IMG,
    peso, signedPeso, qty,
  };
})();
