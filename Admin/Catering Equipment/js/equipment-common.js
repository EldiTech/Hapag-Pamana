/* HapagPamana · Catering Equipment — shared vocabulary for the equipment
   inventory and its ledger.

   Three collections:

     equipmentCategories/{id}
       { name, icon, createdAt }
       A flat list of groupings ("Tables & Chairs", "Chafing Dishes",
       "Linens") — unlike the menu's categories.js, there is no product-type
       split, since this desk only ever deals in one kind of thing: gear.

     equipmentItems/{id}
       { name, categoryId, categoryName, variants: [
           { id, label, unit, qty, par }
         ], note, updatedAt, updatedByName }
       One item can carry many variants — "Chafing Dish" might have a
       Round and a Rectangular, each counted separately. `qty`/`par` on a
       variant mean exactly what they mean on a pantry item: what's on
       hand, and the level below which it counts as low.

     equipmentLog/{id}
       { itemId, itemName, variantId, variantLabel, delta, before, after,
         reason, note, bookingId, clientName, byUid, byName, at, atLocal }
       Every movement, append-only — the same ledger discipline as
       pantryLog (see assets/hp-pantry.js): nothing may change a variant's
       qty without writing one of these.

   Loads after hp-core.js, before the page script. Exposed on
   window.HPEquip. Lives in this dashboard's own js/ (not assets/) because,
   unlike the pantry vocabulary, nothing outside this desk consumes it. */
window.HPEquip = (function () {
  "use strict";
  const HP = window.HP;

  /* ── Units ─────────────────────────────────────────────────────────────
     Equipment is mostly counted, not weighed — "pcs" covers almost
     everything, with a few common alternates for things sold by the set. */
  const UNITS = ["pcs", "sets", "pairs", "rolls", "boxes"];

  /* Why stock moved — trimmed from the pantry's reasons: equipment doesn't
     get "wasted", it gets damaged or lost, and a delivery is "received"
     the same way pantry stock is.

     checked_out/reopened are written by Event Prep (prep.js), not by any
     movement dialog on this page — checking equipment out for an event and
     putting it back on the shelf (without it ever having left, i.e.
     reopening a checklist) are still stock movements, so they still go
     through this same ledger. */
  const REASONS = {
    received: { label: "Received", sign: +1, hint: "New stock, or returned from a supplier repair." },
    checked_out: { label: "Checked out for an event", sign: -1, hint: "Reserved against an event's checklist when marked ready." },
    returned: { label: "Returned from event", sign: +1, hint: "Came back from an event." },
    reopened: { label: "Checklist reopened", sign: +1, hint: "Put back on the shelf — the event's checklist was reopened for edits." },
    damaged: { label: "Damaged", sign: -1, hint: "Broken or unusable — taken off the shelf." },
    lost: { label: "Lost / missing", sign: -1, hint: "Not returned, or unaccounted for." },
    correction: { label: "Stock correction", sign: 0, hint: "Recount — the shelf disagreed with the book." },
    opening: { label: "Opening balance", sign: +1, hint: "First count when the variant was added." },
  };
  const reasonLabel = (k) => (REASONS[k] || { label: k || "—" }).label;

  /* ── Numbers ───────────────────────────────────────────────────────────
     Equipment counts are integers — no half a chafing dish — but round3
     is kept for symmetry with the pantry ledger and to absorb any stray
     float dust from repeated arithmetic. */
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

  function qtyText(n, unit) {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
    const v = round3(n);
    const s = Math.abs(v % 1) < 1e-9 ? String(Math.round(v)) : String(v);
    return unit ? `${s} ${unit}` : s;
  }
  const signedQty = (n, unit) => {
    const v = round3(n);
    return (v > 0 ? "+" : "") + qtyText(v, unit);
  };

  /* ── Variant state ─────────────────────────────────────────────────────
     Same semantics as the pantry's stateOf: "low" is par-relative, so a
     variant with no par set can only ever be out or ok. */
  function stateOf(v) {
    const q = round3(v && v.qty);
    const par = num(v && v.par);
    if (!(q > 0)) return "out";
    if (par > 0 && q <= par) return "low";
    return "ok";
  }
  const STATE_LABEL = { out: "Out of stock", low: "Running low", ok: "In stock" };
  const STATE_BADGE = { out: "badge-warn", low: "badge-gold", ok: "badge-ok" };

  // Worst state across an item's variants, for the item-level badge on the
  // inventory table (a single item can have one variant out and one fine).
  function itemState(item) {
    const states = (item.variants || []).map(stateOf);
    if (states.includes("out")) return "out";
    if (states.includes("low")) return "low";
    return "ok";
  }

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /* ── The ledger entry ─────────────────────────────────────────────────
     Built in one place so every writer stamps the same shape — mirrors
     HPPantry.logEntry exactly, with itemId/variantId in place of a single
     item key. */
  function logEntry(o) {
    const delta = round3(o.delta);
    return {
      itemId: o.itemId || null,
      itemName: String(o.itemName || "").trim(),
      variantId: o.variantId || null,
      variantLabel: String(o.variantLabel || "").trim(),
      unit: String(o.unit || "").trim(),
      delta,
      before: round3(o.before),
      after: round3(o.after),
      reason: o.reason || "correction",
      note: String(o.note || "").trim(),
      bookingId: o.bookingId || null,
      clientName: o.clientName || null,
      byUid: (HP.FB && HP.FB.auth.currentUser) ? HP.FB.auth.currentUser.uid : null,
      byName: (HP.user && HP.user.name) || "—",
      at: firebase.firestore.FieldValue.serverTimestamp(),
      atLocal: Date.now(),
    };
  }

  const entryTime = (e) => {
    const t = e && e.at;
    if (t && typeof t.toMillis === "function") return t.toMillis();
    return Number(e && e.atLocal) || 0;
  };

  function fmtWhen(e) {
    const ms = entryTime(e);
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  return {
    UNITS, REASONS, reasonLabel,
    num, round3, qtyText, signedQty,
    stateOf, STATE_LABEL, STATE_BADGE, itemState,
    uid, logEntry, entryTime, fmtWhen,
  };
})();
