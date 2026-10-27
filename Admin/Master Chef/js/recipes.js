/* HapagPamana · Master Chef — the Recipe Book.
   One costed recipe per dish, mirroring the kitchen's costing spreadsheet:
   each ingredient carries Qty, Unit, Pack cost (what a package costs) and
   Pack size (how much of the unit is in that package), from which the line
   cost is derived — cost = ceil(qty × packCost ÷ packSize) — plus the base
   Number of Portions the recipe yields, the Total Cost and the Per-Serving
   cost (ceil(total ÷ portions)), exactly like the sheet.

   Stored in `recipes/{id}`:
     { name, portions, remarks, ingredients: [{name, qty, unit, packCost,
       packSize, cost}], totalCost, perServing, updatedAt, updatedBy }.

   THE FLOW: name a recipe exactly like the dish on the menu (the booking
   wizards store exact product names) and the Prep Board scales it from its
   base portions to each confirmed order's pax automatically — the chef
   reviews amounts instead of retyping them.

   Reading/writing recipes requires the master_chef (or admin) role — see
   firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Recipe Book",
    sub: "Each dish's ingredients, portions and cost — the Prep Board scales these to every confirmed order.",
    search: true,
    action: { label: "New recipe", fn: () => openDishPicker() },
  });

  const statsEl = document.getElementById("recipeStats");
  const rowsEl = document.getElementById("recipeRows");
  const pagerEl = document.getElementById("recipePager");
  const catChipsEl = document.getElementById("categoryChips");

  const db = HP.ONLINE ? firebase.firestore() : null;

  const PAGE_SIZE = 5;
  let recipes = [];   // [{ id, ...recipe }]
  let query = "";
  let categoryFilter = "all";
  let page = 1;        // 1-based
  let loaded = false;
  let unsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 7);

  HP.shell.onSearch((q) => { query = q; page = 1; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("Recipes live in Firestore — connect Firebase to write them.");
      return;
    }
    unsub = db.collection("recipes").onSnapshot(
      (snap) => {
        recipes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        recipes.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        loaded = true;
        renderAll();
      },
      (e) => {
        console.error("HapagPamana: couldn't load the recipes —", e);
        statsEl.innerHTML = "";
        const denied = e && (e.code === "permission-denied" ||
          /permission|insufficient/i.test(e.message || ""));
        rowsEl.innerHTML = emptyRow(denied
          ? "Access denied — publish the updated Firestore rules (the recipes collection), then reload."
          : "Couldn't reach the database. Check your connection and reload.");
        if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
      });
    // The menu's own category vocabulary (Pork, Chicken, Beef, Seafood, …) —
    // fetched once at boot so the category chips are ready without waiting
    // for the dish picker to open (see loadProducts below).
    loadProducts().then(renderCategoryChips).catch((e) =>
      console.warn("HapagPamana: couldn't load categories for the recipe filter —", e));
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  /* ── Costing (the spreadsheet's arithmetic) ───────────────────────────── */
  const { num, peso, safeImage } = window.HPChef; // shared kitchen helpers
  // Blank recipe rows default to g — per-portion amounts.
  const unitOptions = (selected) => window.HPChef.unitOptions(selected, "g");

  // cost = qty × (pack cost ÷ pack size), rounded up — like the sheet. The
  // pack may be priced in its own unit (a 1 kg bag against a recipe in
  // grams), so the per-unit price comes from the shared converter.
  function lineCost(qty, packCost, packSize, unit, packUnit) {
    if (!(qty > 0)) return null;
    const uc = window.HPChef.unitCostOf({ packCost, packSize, unit, packUnit });
    return uc === null ? null : Math.ceil(qty * uc);
  }

  // Rescaling a quantity to a new portion count. Same rounding the Prep Board
  // uses (chef.js scaleQty) so a recipe rescaled here and one rescaled onto an
  // order agree to the gram: 3 significant digits, whole numbers from 100 up,
  // so a small amount (5 g of spice in a big batch) survives instead of
  // rounding away to zero.
  //
  // Only Qty moves. Pack ₱ and Pack size describe the SUPPLIER'S PACKAGE — a
  // 1 kg bag costs ₱180 whether the recipe makes 20 portions or 50 — so they
  // are carried across untouched, exactly as scaledItems() does.
  function scaleQty(q, k) {
    const v = (Number(q) || 0) * k;
    if (!(v > 0)) return null;
    return v >= 100 ? Math.round(v) : Number(v.toPrecision(3));
  }

  function costOf(r) {
    const items = Array.isArray(r.ingredients) ? r.ingredients : [];
    const total = items.reduce((s, i) => s + (Number(i.cost) || 0), 0);
    const portions = Number(r.portions) || 0;
    return { total, perServing: portions > 0 && total > 0 ? Math.ceil(total / portions) : null };
  }

  /* ── Small helpers ────────────────────────────────────────────────────── */
  const ts = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);
  function fmtDate(v) {
    const ms = ts(v);
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString("en-PH",
      { year: "numeric", month: "short", day: "numeric" });
  }
  function emptyRow(msg) {
    return `<tr><td colspan="7" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderRows(); }

  function renderStats() {
    const ingredients = recipes.reduce((s, r) => s + (Array.isArray(r.ingredients) ? r.ingredients.length : 0), 0);
    const served = recipes.map((r) => costOf(r).perServing).filter((v) => v);
    const avg = served.length ? Math.round(served.reduce((a, b) => a + b, 0) / served.length) : 0;
    const dearest = recipes.reduce((m, r) => Math.max(m, costOf(r).total), 0);

    const stat = (ic, num, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${num}">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("book", recipes.length, "Recipes") +
      stat("basket", ingredients, "Ingredients listed") +
      stat("dish", avg, "Avg ₱ per serving") +
      stat("ledger", dearest, "Costliest recipe (₱)"))) HP.countUp(statsEl);
  }

  // A recipe's category, read off the menu it's named after (same
  // productIndex the dish picker reads — see loadProducts). A recipe whose
  // name matches no product (a custom, hand-typed dish) has no category to
  // filter by, and shows only under "All".
  function categoryOf(r) {
    const p = (products || []).find((x) => nameKey(x.name) === nameKey(r.name));
    return (p && p.category) || "";
  }

  function matches(r) {
    if (categoryFilter !== "all" && categoryOf(r) !== categoryFilter) return false;
    if (!query) return true;
    const hay = [r.name, r.remarks,
      ...(Array.isArray(r.ingredients) ? r.ingredients.map((i) => i.name) : [])]
      .join(" ").toLowerCase();
    return hay.includes(query);
  }

  // The category chips — only the categories actually present among the
  // menu's dishes, so the row never lists a category with nothing to filter
  // to (Drinks only appears on Catering Food Trays, for instance).
  function renderCategoryChips() {
    const cats = [...new Set((products || []).map((p) => p.category).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    if (!cats.length) { catChipsEl.innerHTML = ""; return; }
    catChipsEl.innerHTML = ["all", ...cats].map((c) => `
      <button class="chip-filter${categoryFilter === c ? " active" : ""}" data-cat="${HP.esc(c)}">${
        c === "all" ? "All categories" : HP.esc(c)}</button>`).join("");
    catChipsEl.querySelectorAll("[data-cat]").forEach((b) =>
      b.addEventListener("click", () => {
        categoryFilter = b.dataset.cat;
        page = 1;
        renderCategoryChips();
        renderRows();
      }));
  }

  function renderRows() {
    if (!loaded) return;
    const filtered = recipes.filter(matches);
    if (!filtered.length) {
      rowsEl.innerHTML = emptyRow(recipes.length
        ? (query || categoryFilter !== "all"
            ? "No recipes match your search and filter."
            : "No recipes match your search.")
        : "The book is empty — press “New recipe”, pick a dish from the menu, and the Prep Board starts scaling it to orders.");
      pagerEl.hidden = true;
      return;
    }
    const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page > pageCount) page = pageCount; // fewer results (e.g. a delete) may strand the page
    const start = (page - 1) * PAGE_SIZE;
    const list = filtered.slice(start, start + PAGE_SIZE);

    HP.shell.paint(rowsEl, list.map((r) => {
      const c = costOf(r);
      const n = Array.isArray(r.ingredients) ? r.ingredients.length : 0;
      return `
      <tr data-id="${HP.esc(r.id)}" class="chef-row">
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(String(r.name || "Unnamed recipe"))}</strong>
            <small>${HP.esc(String(r.remarks || "").split("\n")[0] || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(String(r.portions || "—"))}</td>
        <td>${n}</td>
        <td>${HP.esc(peso(c.total || null))}</td>
        <td>${HP.esc(peso(c.perServing))}</td>
        <td>${fmtDate(r.updatedAt)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="edit" title="Edit this recipe" aria-label="Edit ${HP.esc(String(r.name || "recipe"))}"><span class="ic">${HP.icon("pencil")}</span></button>
            <button class="icon-btn" data-act="del" title="Delete this recipe" aria-label="Delete ${HP.esc(String(r.name || "recipe"))}"><span class="ic">${HP.icon("trash")}</span></button>
          </div>
        </td>
      </tr>`;
    }).join(""));

    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = recipes.find((x) => x.id === e.currentTarget.closest("tr").dataset.id);
      if (!r) return;
      if (e.currentTarget.dataset.act === "edit") openEditor(r);
      else onDelete(r);
    }));
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const r = recipes.find((x) => x.id === tr.dataset.id);
        if (r) openEditor(r);
      }));

    renderPager(pageCount);
  }

  // Prev/Next + "Page N of M" — hidden entirely when everything fits on one
  // page, so the book doesn't grow a dead control for a dozen recipes.
  function renderPager(pageCount) {
    if (pageCount <= 1) { pagerEl.hidden = true; pagerEl.innerHTML = ""; return; }
    pagerEl.hidden = false;
    pagerEl.innerHTML = `
      <button class="icon-btn" id="pagerPrev" ${page <= 1 ? "disabled" : ""} aria-label="Previous page"><span class="ic">${HP.icon("chevronLeft")}</span></button>
      <span class="pager-count">Page ${page} of ${pageCount}</span>
      <button class="icon-btn" id="pagerNext" ${page >= pageCount ? "disabled" : ""} aria-label="Next page"><span class="ic">${HP.icon("chevronRight")}</span></button>`;
    document.getElementById("pagerPrev").addEventListener("click", () => {
      if (page > 1) { page--; renderRows(); }
    });
    document.getElementById("pagerNext").addEventListener("click", () => {
      if (page < pageCount) { page++; renderRows(); }
    });
  }

  function onDelete(r) {
    HP.confirmModal("Delete recipe",
      `Permanently delete the “${String(r.name || "unnamed")}” recipe? Orders already planned keep their saved amounts, but the Prep Board stops scaling this dish.`,
      async () => {
        try {
          await db.collection("recipes").doc(r.id).delete();
          HP.toast("Recipe deleted.", "warn");
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't delete the recipe — check the Firestore rules.", "danger");
        }
      });
  }

  /* ── The dish picker — start a recipe from the menu itself ──────────────
     "New recipe" first shows the published menu (the `products` collection,
     public read) so the chef taps a dish instead of retyping its name; the
     chosen name lands on the recipe EXACTLY as the Prep Board expects it.
     Products carry inline base64 photos and are heavy, so the menu is
     fetched once per session, only when the picker first opens. */
  let products = null;
  const nameKey = window.HPChef.dishKey; // same normalizer the Prep Board keys on
  const recipeByName = (n) => recipes.find((r) => nameKey(r.name) === nameKey(n)) || null;

  async function loadProducts() {
    if (products) return products;
    // One tiny read — the Content Moderator maintains settings/productIndex
    // (id → name/category/type, NO photos) on every product save, so the
    // picker no longer downloads the whole multi-megabyte products
    // collection just for names. Dishes show letter tiles here.
    try {
      const idx = await db.collection("settings").doc("productIndex").get();
      const items = idx.exists ? (idx.data() || {}).items : null;
      if (items && Object.keys(items).length) {
        const byName = new Map();
        Object.keys(items).forEach((id) => {
          const e = items[id] || {};
          const name = String(e.n || "").trim();
          const key = nameKey(name);
          if (!key || e.a === false) return; // hidden dishes stay out, as before
          const cur = byName.get(key);
          if (!cur) {
            byName.set(key, {
              name,
              category: String(e.c || "").trim(),
              types: new Set([String(e.t || "").trim()].filter(Boolean)),
              image: "",
            });
          } else {
            if (!cur.category) cur.category = String(e.c || "").trim();
            const t = String(e.t || "").trim();
            if (t) cur.types.add(t);
          }
        });
        products = [...byName.values()]
          .map((p) => ({ ...p, types: [...p.types] }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return products;
      }
    } catch (e) {
      console.warn("HapagPamana: couldn't read the product index — falling back to the full menu.", e);
    }
    // Index doc not built yet (no moderator save since this shipped) — pay
    // the heavy read once so the picker still works.
    const snap = await db.collection("products").get();
    // The same dish often exists twice on the menu — once under Catering
    // Food Trays and once under Food Packs (same name, same photo). One
    // recipe serves both, so the picker lists each NAME once, families
    // merged into the subline.
    const byName = new Map();
    snap.docs.forEach((d) => {
      const p = d.data() || {};
      const key = nameKey(p.name);
      if (!key || p.available === false) return;
      const cur = byName.get(key);
      if (!cur) {
        byName.set(key, {
          name: String(p.name).trim(),
          category: String(p.category || "").trim(),
          types: new Set([String(p.type || "").trim()].filter(Boolean)),
          image: safeImage(p.image),
        });
      } else {
        if (!cur.image) cur.image = safeImage(p.image);
        if (!cur.category) cur.category = String(p.category || "").trim();
        const t = String(p.type || "").trim();
        if (t) cur.types.add(t);
      }
    });
    products = [...byName.values()]
      .map((p) => ({ ...p, types: [...p.types] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return products;
  }

  function dishRow(p) {
    const img = safeImage(p.image);
    const thumb = img
      ? `<span class="dish-thumb has-img"><img src="${HP.esc(img)}" alt="" loading="lazy"></span>`
      : `<span class="dish-thumb">${HP.esc((String(p.name).charAt(0) || "·").toUpperCase())}</span>`;
    const sub = [p.category, p.types.join(" & ")].filter(Boolean).join(" · ");
    return `<button type="button" class="dish-pick-row" data-name="${HP.esc(p.name)}">
      ${thumb}
      <span class="dish-pick-txt">
        <strong>${HP.esc(p.name)}</strong>
        <small>${HP.esc(sub || "On the menu")}</small>
      </span>
      ${recipeByName(p.name)
        ? `<span class="badge badge-ok"><span class="dot"></span>In the book</span>`
        : `<span class="badge badge-cat">No recipe yet</span>`}
    </button>`;
  }

  function openDishPicker() {
    if (!HP.ONLINE) { HP.toast("Connect Firebase to browse the menu.", "warn"); return; }
    HP.openModal("Pick a dish from the menu", `
      <div class="dish-pick">
        <label class="dish-pick-search"><span class="ic">${HP.icon("search")}</span>
          <input id="dishPickSearch" placeholder="Search the menu…" autocomplete="off" /></label>
        <div class="dish-pick-list" id="dishPickList">
          <p class="dish-pick-empty">Fetching the menu…</p>
        </div>
        <p class="plan-hint">Tap a dish to write (or reopen) its recipe — the name lands
          exactly as the Prep Board expects it. Cooking something that isn't on the menu?
          Use a custom name instead.</p>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-ghost" id="dishCustom"><span class="ic">${HP.icon("pencil")}</span>Write a custom name</button>`);

    document.getElementById("dishCustom").addEventListener("click", () => openEditor(null));

    const listEl = document.getElementById("dishPickList");
    const searchEl = document.getElementById("dishPickSearch");

    const paint = () => {
      const needle = searchEl.value.trim().toLowerCase();
      const list = (products || []).filter((p) =>
        !needle || [p.name, p.category, ...p.types].join(" ").toLowerCase().includes(needle));
      listEl.innerHTML = list.length
        ? list.map(dishRow).join("")
        : `<p class="dish-pick-empty">${products && products.length
            ? "No dish matches — try another spelling, or write a custom name."
            : "The menu is empty — no dishes are published yet."}</p>`;
      listEl.querySelectorAll("[data-name]").forEach((b) =>
        b.addEventListener("click", () => {
          const existing = recipeByName(b.dataset.name);
          if (existing) openEditor(existing);
          else openEditor(null, b.dataset.name);
        }));
    };

    loadProducts().then(() => {
      // Paint only if this picker is still the open modal.
      if (document.getElementById("dishPickList") === listEl) paint();
    }).catch((e) => {
      console.error("HapagPamana: couldn't fetch the menu —", e);
      listEl.innerHTML = `<p class="dish-pick-empty">Couldn't fetch the menu — check your connection and try again.</p>`;
    });
    searchEl.addEventListener("input", paint);
  }

  /* ── The recipe editor (mirrors the costing sheet) ────────────────────── */
  /* The line's arithmetic, spelled out under the row — "₱340 ÷ 1 kg =
     ₱0.34/g × 1005 g". Seeing the division is what makes the pack fields
     legible: they are not loose numbers, they are one price per unit. When
     the units can't relate (a kg pack against a "pc" recipe) the note says
     so, because the cost column can only show a dash. */
  function unitPriceNote(qty, packCost, packSize, unit, packUnit) {
    if (!(packCost > 0) || !(packSize > 0)) return "";
    const pu = packUnit || unit;
    const uc = window.HPChef.unitCostOf({ packCost, packSize, unit, packUnit: pu });
    if (uc === null) {
      return `${pu} and ${unit} aren't the same kind of measure — match them to get a cost.`;
    }
    // Cheap staples (₱0.049/g of salt) need the digits; pricier ones don't.
    const shown = uc >= 1 ? uc.toFixed(2) : uc.toPrecision(2);
    return `₱${packCost} ÷ ${packSize} ${pu} = ₱${shown}/${unit}`
      + (qty > 0 ? ` × ${qty} ${unit}` : "");
  }

  function rowHTML(it) {
    it = it || {};
    const v = (x) => (x === 0 || x ? String(x) : "");
    const unit = it.unit || "g";
    const packUnit = it.packUnit || unit;
    const cost = lineCost(num(v(it.qty)), num(v(it.packCost)), num(v(it.packSize)), unit, packUnit);
    return window.HPChef.ingRow(`class="rcp-row"`, `
      <input class="control rcp-name" placeholder="e.g. Ground pork" value="${HP.esc(it.name || "")}" />
      <input class="control rcp-qty" type="number" min="0" step="any" placeholder="—" value="${HP.esc(v(it.qty))}" />
      <select class="control rcp-unit" aria-label="Unit used">${unitOptions(it.unit)}</select>
      <span class="rcp-money">
        <span class="rcp-money-sign" aria-hidden="true">₱</span>
        <input class="control rcp-pcost" type="number" min="0" step="any" placeholder="—" value="${HP.esc(v(it.packCost))}" title="What one whole package costs at the market" />
      </span>
      <span class="rcp-pack">
        <input class="control rcp-psize" type="number" min="0" step="any" placeholder="—" value="${HP.esc(v(it.packSize))}" title="How much is inside that package" />
        <select class="control rcp-punit" aria-label="Pack unit" title="The unit the package is sold in">${unitOptions(packUnit)}</select>
      </span>
      <span class="rcp-cost${cost === null ? " rcp-cost--empty" : ""}" title="Qty × (pack price ÷ pack size)">${HP.esc(peso(cost))}</span>`,
      `<small class="rcp-math">${HP.esc(unitPriceNote(num(v(it.qty)), num(v(it.packCost)), num(v(it.packSize)), unit, packUnit))}</small>`);
  }

  function openEditor(r, prefillName) {
    const isNew = !r;
    r = r || { name: prefillName || "", portions: "", remarks: "", ingredients: [] };
    const items = Array.isArray(r.ingredients) && r.ingredients.length ? r.ingredients : [null];

    HP.openModal(isNew
      ? (prefillName ? `New recipe — ${prefillName}` : "New recipe")
      : `Recipe — ${String(r.name || "unnamed")}`, `
      <div class="recipe-sheet">
        <div class="rcp-top">
          <div class="field field--grow">
            <label for="rcpName">Recipe name <span class="req">*</span></label>
            <input class="control" id="rcpName" placeholder="As it appears on the menu — e.g. Beef Caldereta" value="${HP.esc(String(r.name || ""))}" />
          </div>
          <div class="field rcp-portions">
            <label for="rcpPortions">Portions <span class="req">*</span></label>
            <div class="rcp-stepper">
              <button type="button" class="rcp-step" data-step="-1" aria-label="One portion fewer">−</button>
              <span class="rcp-step-mid">
                <input class="control" id="rcpPortions" type="number" min="1" step="1" placeholder="20" value="${HP.esc(String(r.portions || ""))}" />
                <span class="rcp-step-unit" aria-hidden="true">portions</span>
              </span>
              <button type="button" class="rcp-step" data-step="1" aria-label="One portion more">+</button>
            </div>
          </div>
        </div>

        <h4 class="rcp-legend"><span class="ic">${HP.icon("basket")}</span>Ingredients
          <button type="button" class="rcp-how" id="rcpHow" aria-expanded="false">How is this costed?</button>
        </h4>
        <div class="rcp-how-body" id="rcpHowBody" hidden>
          <p class="rcp-how-eq"><strong>₱340</strong> ÷ <strong>1 kg</strong> = ₱0.34 per g
             &nbsp;×&nbsp; <strong>1005 g</strong> used = <strong>₱342</strong></p>
          <p>Enter what you use on the left and the package you buy on the right — the
             pack keeps its own unit and the conversion is handled for you. Line costs
             round up to the peso; cost per portion is the total ÷ portions. Change the
             portions and quantities rescale, packages stay put.</p>
        </div>

        <div class="rcp-group" aria-hidden="true">
          <span class="rcp-group-use">Amount used</span>
          <span class="rcp-group-buy">Purchase package</span>
        </div>
        <div class="rcp-head" aria-hidden="true">
          <span>Ingredient</span><span>Qty</span><span>Unit</span><span>Price</span><span>Pack size</span><span>Cost</span><span></span>
        </div>
        <div class="ing-rows" id="rcpRows">${items.map(rowHTML).join("")}</div>
        <button type="button" class="btn btn-ghost add-ing" data-add><span class="ic">${HP.icon("plus")}</span>Add ingredient</button>

        <div class="rcp-summary">
          <div class="rcp-sum-fig">
            <span class="rcp-sum-label">Total recipe cost</span>
            <strong id="rcpTotal">—</strong>
          </div>
          <div class="rcp-sum-fig">
            <span class="rcp-sum-label">Cost per portion</span>
            <strong id="rcpServing">—</strong>
            <small id="rcpServingBasis">Based on <span id="rcpPortionEcho">${HP.esc(String(r.portions || "…"))}</span> portions</small>
          </div>
        </div>

        <div class="field rcp-remarks">
          <label for="rcpRemarks">Remarks</label>
          <textarea class="control" id="rcpRemarks" rows="2" placeholder="e.g. This recipe makes 1 roll, good for 10 pax.">${HP.esc(String(r.remarks || ""))}</textarea>
        </div>
      </div>`,
      `${isNew ? "" : `<button class="btn btn-ghost order-del" id="rcpDelete"><span class="ic">${HP.icon("trash")}</span>Delete</button>`}
       <button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="rcpSave"><span class="ic">${HP.icon("check")}</span>Save recipe</button>`);

    const sheet = document.querySelector(".recipe-sheet");
    const portionsEl = document.getElementById("rcpPortions");

    /* ── Portions → Qty (the amounts follow the yield) ───────────────────────
       The Qty column always describes the portion count in the Portions box,
       so changing 20 → 50 multiplies every quantity by 2.5 instead of making
       the chef retype the column. Pack ₱ and Pack size stay put (see
       scaleQty's note).

       `basis` is the portion count the Qty figures on screen currently stand
       for, and it is re-read after every scale — so 20 → 50 → 100 scales
       ×2.5 then ×2, never ×2.5 then ×5. Scaling from the last basis rather
       than from the recipe's saved portions also stops the 3-significant-
       digit rounding from compounding across a series of edits.

       A recipe opened with no portions yet (a new one) has no basis to scale
       from: the first number typed simply defines what the amounts mean. */
    let basis = num(portionsEl.value);
    if (!(basis > 0)) basis = null;

    function applyPortionScale() {
      const next = num(portionsEl.value);
      // Only a real, changed, positive yield rescales. Clearing the box (or
      // typing "0"/"-5" mid-edit) leaves the amounts alone and keeps the old
      // basis, so the column isn't wiped by a transient keystroke.
      if (!(next > 0) || basis === null || next === basis) {
        if (next > 0 && basis === null) basis = next; // first yield — adopt it
        return;
      }
      const k = next / basis;
      sheet.querySelectorAll(".rcp-row").forEach((row) => {
        const qtyEl = row.querySelector(".rcp-qty");
        const cur = num(qtyEl.value);
        if (cur === null || !(cur > 0)) return; // blank/zero rows stay blank
        const scaled = scaleQty(cur, k);
        if (scaled !== null) qtyEl.value = String(scaled);
      });
      basis = next;
    }

    function recalc() {
      let total = 0;
      sheet.querySelectorAll(".rcp-row").forEach((row) => {
        const qty = num(row.querySelector(".rcp-qty").value);
        const pcost = num(row.querySelector(".rcp-pcost").value);
        const psize = num(row.querySelector(".rcp-psize").value);
        const unit = row.querySelector(".rcp-unit").value;
        const punit = row.querySelector(".rcp-punit").value;
        const c = lineCost(qty, pcost, psize, unit, punit);
        const costEl = row.querySelector(".rcp-cost");
        costEl.textContent = peso(c);
        costEl.classList.toggle("rcp-cost--empty", c === null);
        // A pack in an unrelated unit (kg against pc) can't be costed —
        // flag the row instead of leaving a silent dash.
        const mismatch = pcost > 0 && psize > 0 &&
          window.HPChef.unitRatio(punit, unit) === null;
        row.classList.toggle("rcp-row--mismatch", mismatch);
        const wrap = row.closest(".ing-row-wrap");
        const math = wrap && wrap.querySelector(".rcp-math");
        if (math) {
          math.textContent = unitPriceNote(qty, pcost, psize, unit, punit);
          math.classList.toggle("rcp-math--warn", mismatch);
        }
        total += c || 0;
      });
      const portions = num(document.getElementById("rcpPortions").value);
      const totalEl = document.getElementById("rcpTotal");
      const servEl = document.getElementById("rcpServing");
      totalEl.textContent = total ? peso(total) : "—";
      totalEl.classList.toggle("is-empty", !total);
      const per = total && portions > 0 ? Math.ceil(total / portions) : null;
      servEl.textContent = per === null ? "—" : peso(per);
      servEl.classList.toggle("is-empty", per === null);
      document.getElementById("rcpPortionEcho").textContent =
        portions > 0 ? String(portions) : "…";
      const basisEl = document.getElementById("rcpServingBasis");
      if (basisEl) basisEl.hidden = !(portions > 0);
    }
    recalc();

    sheet.addEventListener("input", recalc);

    // Scale on commit — blur, Enter, or the number spinner — never on every
    // keystroke: typing "50" over "20" passes through "5", and scaling on
    // that intermediate digit would shrink the column ×0.25 before the "0"
    // arrives. "change" fires once the value settles, which is the moment the
    // chef actually means a new yield.
    portionsEl.addEventListener("change", () => { applyPortionScale(); recalc(); });
    portionsEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); applyPortionScale(); recalc(); }
    });
    sheet.addEventListener("click", (e) => {
      // − / + on the portions box. Stepping is a committed change, so it
      // rescales the quantities exactly as typing a new yield does.
      const step = e.target.closest(".rcp-step");
      if (step) {
        const cur = num(portionsEl.value);
        const next = Math.max(1, (cur > 0 ? Math.round(cur) : 0) + Number(step.dataset.step));
        portionsEl.value = String(next);
        applyPortionScale();
        recalc();
        return;
      }
      const how = e.target.closest("#rcpHow");
      if (how) {
        const body = document.getElementById("rcpHowBody");
        const open = body.hidden;
        body.hidden = !open;
        how.setAttribute("aria-expanded", String(open));
        return;
      }
      const add = e.target.closest("[data-add]");
      if (add) {
        const rows = document.getElementById("rcpRows");
        rows.insertAdjacentHTML("beforeend", rowHTML());
        rows.lastElementChild.querySelector(".rcp-name").focus();
        return;
      }
      // Remove the wrapper, not just the row — the unit-price note lives
      // beside the row inside it and would otherwise be orphaned on screen.
      const del = e.target.closest(".ing-del");
      if (del) {
        const row = del.closest(".rcp-row");
        (row.closest(".ing-row-wrap") || row).remove();
        recalc();
      }
    });

    // Conflict context for this open of the editor: the recipe's updatedAt as
    // painted, plus a force flag set once the chef has been warned that
    // another session saved meanwhile.
    const saveCtx = { openedAt: ts(r.updatedAt), force: false };
    document.getElementById("rcpSave").addEventListener("click", () => save(r, saveCtx));
    const delBtn = document.getElementById("rcpDelete");
    if (delBtn) delBtn.addEventListener("click", () => { HP.closeModal(); onDelete(r); });
  }

  let saving = false;
  async function save(r, ctx) {
    if (saving) return; // double-click — the first save is still in flight
    const name = document.getElementById("rcpName").value.trim();
    const portions = num(document.getElementById("rcpPortions").value);
    if (!name) { HP.toast("Give the recipe its dish name first.", "danger"); return; }
    if (!(portions > 0)) { HP.toast("How many portions do these amounts make?", "danger"); return; }

    const ingredients = [];
    document.querySelectorAll(".recipe-sheet .rcp-row").forEach((row) => {
      const iname = row.querySelector(".rcp-name").value.trim();
      if (!iname) return; // blank rows are just unused paper
      const rawQty = num(row.querySelector(".rcp-qty").value);
      // Negative amounts can't be cooked with — clamp to zero.
      const qty = rawQty === null ? null : Math.max(0, rawQty);
      const packCost = num(row.querySelector(".rcp-pcost").value);
      const packSize = num(row.querySelector(".rcp-psize").value);
      const unit = row.querySelector(".rcp-unit").value;
      const packUnit = row.querySelector(".rcp-punit").value;
      ingredients.push({
        name: iname, qty, unit, packCost, packSize, packUnit,
        cost: lineCost(qty, packCost, packSize, unit, packUnit),
      });
    });
    if (!ingredients.length) { HP.toast("List at least one ingredient.", "danger"); return; }

    const total = ingredients.reduce((s, i) => s + (i.cost || 0), 0);
    const doc = {
      name,
      portions: Math.round(portions),
      remarks: document.getElementById("rcpRemarks").value.trim(),
      ingredients,
      totalCost: total,
      perServing: total > 0 ? Math.ceil(total / Math.round(portions)) : null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: (HP.FB && HP.FB.auth.currentUser) ? HP.FB.auth.currentUser.uid : null,
    };
    saving = true;
    const btn = document.getElementById("rcpSave");
    if (btn) btn.disabled = true;
    try {
      // Another chef may have saved this recipe while the editor was open —
      // warn once instead of silently clobbering their version.
      if (r.id && ctx && !ctx.force) {
        const now = await db.collection("recipes").doc(r.id).get();
        const stamp = ts(now.exists ? now.data().updatedAt : null);
        if (stamp > ctx.openedAt) {
          ctx.force = true;
          const sheet = document.querySelector(".recipe-sheet");
          if (sheet && !document.getElementById("recipeConflict")) {
            sheet.insertAdjacentHTML("beforeend",
              `<p class="plan-recipe-note plan-recipe-note--none" id="recipeConflict">Someone else saved this recipe while you had it open — saving again overwrites their version.</p>`);
          }
          const note = document.getElementById("recipeConflict");
          if (note) note.scrollIntoView({ block: "nearest" });
          HP.toast("This recipe changed in another session — save again to overwrite.", "warn");
          return;
        }
      }
      if (r.id) await db.collection("recipes").doc(r.id).set(doc);
      else await db.collection("recipes").add(doc);
      HP.toast(`“${name}” is in the book — the Prep Board scales it from here on.`);
      HP.closeModal();
    } catch (e) {
      console.error(e);
      HP.toast("Couldn't save the recipe — check the Firestore rules.", "danger");
    } finally {
      saving = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── CSV export (long format, like the costing sheet) ─────────────────── */
  function exportCSV() {
    if (!recipes.length) { HP.toast("No recipes to export yet.", "warn"); return; }
    const cell = HP.csvCell; // formula-safe, quote-doubled (hp-core.js)
    const head = ["Recipe", "Portions", "Ingredient", "Qty", "Unit", "Pack cost", "Pack size", "Pack unit", "Line cost", "Recipe total", "Per serving", "Remarks"];
    const lines = [head.map(cell).join(",")];
    recipes.forEach((r) => {
      const c = costOf(r);
      (Array.isArray(r.ingredients) ? r.ingredients : []).forEach((i, idx) => {
        lines.push([
          r.name, r.portions, i.name, i.qty, i.unit, i.packCost, i.packSize,
          i.packUnit || i.unit, i.cost,
          idx === 0 ? c.total : "", idx === 0 ? (c.perServing ?? "") : "", idx === 0 ? (r.remarks || "") : "",
        ].map(cell).join(","));
      });
    });
    // BOM so Excel opens the UTF-8 file with ₱ and accents intact.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_recipes.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Recipes exported as CSV.");
  }
})();
