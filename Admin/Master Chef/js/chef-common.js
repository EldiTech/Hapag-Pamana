/* HapagPamana · Master Chef — shared kitchen vocabulary.
   The helpers both kitchen pages (chef.js prep board, recipes.js recipe
   book) previously carried as drifting copies: the unit list, number and
   peso formatting, the image guard, the dish-name key and the
   ingredient-row scaffold. Exposed on `window.HPChef`.

   Loads after hp-core.js (needs HP.esc / HP.icon), before the page script:
     … → hp-core.js → hp-shell.js → js/chef-common.js → js/<page>.js */
window.HPChef = (function () {
  "use strict";
  const HP = window.HP;

  const UNITS = ["g", "kg", "mL", "L", "pc", "pcs", "packs", "cans", "bottles", "trays", "cups", "tbsp", "tsp", "bundles", "sacks"];

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const peso = (n) => (n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—" : "₱" + Number(n).toLocaleString("en-PH"));

  // Only data-URL / http(s) images may land in an <img src> — anything else
  // a booking or product doc carries is ignored.
  const safeImage = (v) =>
    (/^(data:image\/|https?:\/\/)/i.test(String(v || "")) ? String(v) : "");

  /* ── Units and pack conversion ──────────────────────────────────────────
     A package is bought in its own unit — a 1 kg bag of pork priced against
     a recipe measured in grams — so the pack size must be converted into the
     recipe's unit before the per-unit price means anything. Everything else
     (pc, packs, trays…) is countable and only ever comparable to itself.

     Conversion factors are to a base unit per family: grams and millilitres. */
  const UNIT_FACTOR = { g: 1, kg: 1000, ml: 1, l: 1000 };
  const UNIT_FAMILY = { g: "mass", kg: "mass", ml: "volume", l: "volume" };
  const family = (u) => UNIT_FAMILY[String(u || "").toLowerCase()] || null;

  // How many of `to` one `from` makes — null when the two can't be compared
  // (kg → pc is not a conversion, it's a category error). Same-unit and
  // same-name countables convert 1:1.
  function unitRatio(from, to) {
    const a = String(from || "").toLowerCase(), b = String(to || "").toLowerCase();
    if (a === b) return 1;
    const fa = family(a), fb = family(b);
    if (fa && fa === fb) return UNIT_FACTOR[a] / UNIT_FACTOR[b];
    return null;
  }

  /* The price of ONE recipe-unit of an ingredient — the number every cost on
     both pages is built from:

       packCost ÷ (packSize converted into the recipe's unit)

     `packUnit` is optional: rows saved before the pack carried its own unit
     (and rows where the chef leaves it alone) treat the pack as already
     being in the recipe's unit, which is exactly the old behaviour. Returns
     null when the units don't relate, so a mismatch shows no cost rather
     than a silently wrong one. */
  function unitCostOf(i) {
    const pc = Number(i && i.packCost), ps = Number(i && i.packSize);
    if (!(pc > 0) || !(ps > 0)) return null;
    const r = unitRatio(i.packUnit || i.unit, i.unit);
    if (r === null) return null;
    return pc / (ps * r);
  }

  // Dish names key the recipe lookups — normalized once, used everywhere.
  const dishKey = (n) => String(n || "").trim().toLowerCase();

  // <option> list for a unit select. An off-list stored unit is kept as its
  // own entry so old rows never silently change; `fallback` is the blank-row
  // default ("kg" on the prep board, "g" in the recipe book).
  function unitOptions(selected, fallback) {
    const sel = String(selected || fallback || "g");
    const all = UNITS.includes(sel) ? UNITS : [sel, ...UNITS];
    return all.map((u) =>
      `<option value="${HP.esc(u)}"${u === sel ? " selected" : ""}>${HP.esc(u)}</option>`).join("");
  }

  // The scaffold both ingredient-row templates share: a row wrapper (extra
  // attributes welcome) whose cells always end in the same delete button.
  //
  // `belowHTML` is optional and hangs under the row, OUTSIDE the grid — the
  // recipe book uses it for the line's unit-price working. The row itself is
  // a grid, so a stray child would land in a column; the wrapper keeps the
  // note clear of the track list. Callers that pass nothing get the bare row
  // exactly as before.
  function ingRow(attrs, cellsHTML, belowHTML) {
    const row = `<div ${attrs}>${cellsHTML}
      <button type="button" class="icon-btn ing-del" title="Remove this ingredient"><span class="ic">${HP.icon("trash")}</span></button>
    </div>`;
    return belowHTML ? `<div class="ing-row-wrap">${row}${belowHTML}</div>` : row;
  }

  return { UNITS, num, peso, safeImage, dishKey, unitOptions, ingRow,
           unitRatio, unitCostOf, PACK_UNITS: UNITS };
})();
