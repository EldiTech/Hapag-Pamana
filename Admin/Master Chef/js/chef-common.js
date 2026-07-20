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
  function ingRow(attrs, cellsHTML) {
    return `<div ${attrs}>${cellsHTML}
      <button type="button" class="icon-btn ing-del" title="Remove this ingredient"><span class="ic">${HP.icon("trash")}</span></button>
    </div>`;
  }

  return { UNITS, num, peso, safeImage, dishKey, unitOptions, ingRow };
})();
