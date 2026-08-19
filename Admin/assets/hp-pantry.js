/* HapagPamana · the pantry — shared vocabulary for the store ledger.

   Two collections, and the rule that ties them together:

     pantry/{id}
       { name, unit, qty, par, category, note, updatedAt, updatedByName }
       What is on the shelf right now. `qty` is the only number that matters
       operationally; `par` is the level below which the shelf counts as low,
       so the board can say "reorder" without anyone remembering the number.

     pantryLog/{id}
       { itemId, itemName, unit, delta, before, after, reason, note,
         bookingId, clientName, byName, byUid, at }
       Every movement, append-only. NOTHING may change `pantry.qty` without
       writing one of these: the shelf count is a running total of the log,
       and a count that can move without a trace is a count nobody can defend
       at inventory time.

   `delta` is signed — positive receives, negative issues — and `before` /
   `after` are stamped at the moment of the write so the ledger reads as a
   statement rather than a diff you have to recompute against a shelf that
   has since moved on.

   Loads after hp-core.js, before the page script. Exposed on window.HPPantry.

   Reading/writing both collections requires the stock_clerk (or admin) role
   — see firestore.rules. */
window.HPPantry = (function () {
  "use strict";
  const HP = window.HP;

  /* ── Units ───────────────────────────────────────────────────────────────
     The kitchen's vocabulary, verbatim. A pantry item's unit has to match the
     unit the recipes are written in or the issue screen cannot line them up,
     so this list is deliberately the same one chef-common.js offers. */
  const UNITS = ["g", "kg", "mL", "L", "pc", "pcs", "packs", "cans", "bottles",
    "trays", "cups", "tbsp", "tsp", "bundles", "sacks"];

  /* Shelf sections — how a clerk walks the store, not how a database sorts. */
  const CATEGORIES = ["Meat & poultry", "Seafood", "Vegetables", "Fruits",
    "Dry goods", "Rice & grains", "Condiments & sauces", "Spices",
    "Dairy & eggs", "Frozen", "Beverages", "Packaging", "Other"];

  /* Why stock moved. The reason is not decoration: liquidation and the audit
     read it to tell a delivery apart from a correction, and a correction
     apart from something thrown away. */
  const REASONS = {
    received: { label: "Received", sign: +1, hint: "Checked in from a purchase run." },
    issued: { label: "Issued to kitchen", sign: -1, hint: "Handed over for an order." },
    returned: { label: "Returned unused", sign: +1, hint: "Came back from the kitchen." },
    wastage: { label: "Wastage / spoilage", sign: -1, hint: "Spoiled, damaged or expired." },
    correction: { label: "Stock correction", sign: 0, hint: "Recount — the shelf disagreed with the book." },
    opening: { label: "Opening balance", sign: +1, hint: "First count when the item was added." },
  };
  const reasonLabel = (k) => (REASONS[k] || { label: k || "—" }).label;

  /* ── Numbers ─────────────────────────────────────────────────────────────
     Kitchen quantities are decimal (3.75 kg) but must not accumulate binary
     float dust across hundreds of movements: 0.1 + 0.2 shelving as
     0.30000000000000004 turns into a shelf count nobody can reconcile.
     Every arithmetic result goes through round3. */
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

  // Display: trim the trailing zeros round3 leaves behind, keep the unit.
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

  /* ── Shelf state ─────────────────────────────────────────────────────────
     "Low" is par-relative, so a 2 kg par and a 200 g par both mean something.
     An item with no par set can only ever be out or ok — inventing a
     threshold for it would cry wolf on things the kitchen never tracked. */
  function stateOf(it) {
    const q = round3(it && it.qty);
    const par = num(it && it.par);
    if (!(q > 0)) return "out";
    if (par > 0 && q <= par) return "low";
    return "ok";
  }
  const STATE_LABEL = { out: "Out of stock", low: "Running low", ok: "In stock" };
  const STATE_BADGE = { out: "badge-warn", low: "badge-gold", ok: "badge-ok" };

  /* ── Matching a recipe line to the shelf ─────────────────────────────────
     The chef writes "Ground Pork", the shelf says "ground pork". Names are
     matched case- and space-insensitively; the UNIT MUST MATCH EXACTLY.

     Deliberately no g↔kg conversion. Converting silently would let a plan
     asking for 3.75 kg drain an item counted in grams by a factor of a
     thousand if anyone ever mistyped the unit, and a wrong deduction is
     worse than an unmatched line the clerk has to look at. Unmatched lines
     surface in the issue screen instead of being guessed at. */
  const nameKey = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();
  const itemKey = (name, unit) => `${nameKey(name)}|${nameKey(unit)}`;

  function indexItems(items) {
    const by = new Map();
    (Array.isArray(items) ? items : []).forEach((it) => {
      by.set(itemKey(it.name, it.unit), it);
    });
    return by;
  }

  /* Fold a plan's lines (many dishes, repeated ingredients) into one row per
     ingredient+unit, remembering which dishes asked for it — the clerk issues
     against the shelf once, not once per dish. */
  function foldPlanItems(planItems) {
    const out = new Map();
    (Array.isArray(planItems) ? planItems : []).forEach((it) => {
      const name = String(it.ingredient || "").trim();
      const unit = String(it.unit || "").trim();
      if (!name) return;
      const key = itemKey(name, unit);
      const cur = out.get(key) || { name, unit, qty: 0, dishes: new Set() };
      const q = num(it.qty);
      if (q !== null && q > 0) cur.qty = round3(cur.qty + q);
      const dish = String(it.dish || "").trim();
      if (dish) cur.dishes.add(dish);
      out.set(key, cur);
    });
    return [...out.values()]
      .map((r) => ({ ...r, dishes: [...r.dishes] }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /* Line up what a plan needs against what is on the shelf. Each row carries
     enough for the clerk to decide without a second lookup: what's needed,
     what's there, and what would be left. */
  function requirementRows(planItems, items) {
    const by = indexItems(items);
    return foldPlanItems(planItems).map((need) => {
      const item = by.get(itemKey(need.name, need.unit)) || null;
      const have = item ? round3(item.qty) : null;
      const short = item ? round3(Math.max(0, need.qty - have)) : need.qty;
      return {
        ...need,
        itemId: item ? item.id : null,
        item,
        have,
        after: item ? round3(have - need.qty) : null,
        short,
        // Three ways a line can fail to be issuable, each needing different words.
        missing: !item,                        // nothing on the shelf by that name+unit
        insufficient: !!item && short > 0,     // there, but not enough
      };
    });
  }

  /* ── The ledger entry ────────────────────────────────────────────────────
     Built in one place so every writer stamps the same shape. `before` and
     `after` are computed by the caller from the value it actually wrote, not
     re-read afterwards — a re-read races another clerk's movement. */
  function logEntry(o) {
    const delta = round3(o.delta);
    return {
      itemId: o.itemId || null,
      itemName: String(o.itemName || "").trim(),
      unit: String(o.unit || "").trim(),
      delta,
      before: round3(o.before),
      after: round3(o.after),
      reason: o.reason || "correction",
      note: String(o.note || "").trim(),
      // Present only when the movement belongs to an order.
      bookingId: o.bookingId || null,
      clientName: o.clientName || null,
      byUid: (HP.FB && HP.FB.auth.currentUser) ? HP.FB.auth.currentUser.uid : null,
      byName: (HP.user && HP.user.name) || "—",
      at: firebase.firestore.FieldValue.serverTimestamp(),
      // A client clock too, so the activity feed can sort the moment it
      // paints — serverTimestamp reads null until the write lands.
      atLocal: Date.now(),
    };
  }

  // Sort key that survives the pending-write window described above.
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
    UNITS, CATEGORIES, REASONS, reasonLabel,
    num, round3, qtyText, signedQty,
    stateOf, STATE_LABEL, STATE_BADGE,
    nameKey, itemKey, indexItems, foldPlanItems, requirementRows,
    logEntry, entryTime, fmtWhen,
  };
})();
