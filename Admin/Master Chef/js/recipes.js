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

  const db = HP.ONLINE ? firebase.firestore() : null;

  let recipes = [];   // [{ id, ...recipe }]
  let query = "";
  let loaded = false;
  let unsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 7);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
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
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  /* ── Costing (the spreadsheet's arithmetic) ───────────────────────────── */
  const { num, peso, safeImage } = window.HPChef; // shared kitchen helpers
  // Blank recipe rows default to g — per-portion amounts.
  const unitOptions = (selected) => window.HPChef.unitOptions(selected, "g");

  // cost = qty × (pack cost ÷ pack size), rounded up — like the sheet.
  function lineCost(qty, packCost, packSize) {
    if (!(qty > 0) || !(packCost > 0) || !(packSize > 0)) return null;
    return Math.ceil(qty * (packCost / packSize));
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

  function matches(r) {
    if (!query) return true;
    const hay = [r.name, r.remarks,
      ...(Array.isArray(r.ingredients) ? r.ingredients.map((i) => i.name) : [])]
      .join(" ").toLowerCase();
    return hay.includes(query);
  }

  function renderRows() {
    if (!loaded) return;
    const list = recipes.filter(matches);
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(recipes.length
        ? "No recipes match your search."
        : "The book is empty — press “New recipe”, pick a dish from the menu, and the Prep Board starts scaling it to orders.");
      return;
    }
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
  function rowHTML(it) {
    it = it || {};
    const v = (x) => (x === 0 || x ? String(x) : "");
    return window.HPChef.ingRow(`class="rcp-row"`, `
      <input class="control rcp-name" placeholder="Ingredient — e.g. ground pork" value="${HP.esc(it.name || "")}" />
      <input class="control rcp-qty" type="number" min="0" step="any" placeholder="Qty" value="${HP.esc(v(it.qty))}" />
      <select class="control rcp-unit" aria-label="Unit">${unitOptions(it.unit)}</select>
      <input class="control rcp-pcost" type="number" min="0" step="any" placeholder="Pack ₱" value="${HP.esc(v(it.packCost))}" title="What one package costs" />
      <input class="control rcp-psize" type="number" min="0" step="any" placeholder="Pack size" value="${HP.esc(v(it.packSize))}" title="How much of the unit one package holds" />
      <span class="rcp-cost" title="Line cost — qty × pack ₱ ÷ pack size">${HP.esc(peso(lineCost(num(v(it.qty)), num(v(it.packCost)), num(v(it.packSize)))))}</span>`);
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
            <label>Recipe name <span class="req">*</span></label>
            <input class="control" id="rcpName" placeholder="Exactly as the dish appears on the menu — e.g. Beef Caldereta" value="${HP.esc(String(r.name || ""))}" />
          </div>
          <div class="field rcp-portions">
            <label>Portions <span class="req">*</span></label>
            <input class="control" id="rcpPortions" type="number" min="1" step="1" placeholder="e.g. 20" value="${HP.esc(String(r.portions || ""))}" />
          </div>
        </div>
        <p class="plan-hint">The amounts below make <strong id="rcpPortionEcho">${HP.esc(String(r.portions || "…"))}</strong> portions —
          the Prep Board rescales them to each order's pax.</p>

        <div class="rcp-head" aria-hidden="true">
          <span>Ingredient</span><span>Qty</span><span>Unit</span><span>Pack ₱</span><span>Pack size</span><span>Cost</span><span></span>
        </div>
        <div class="ing-rows" id="rcpRows">${items.map(rowHTML).join("")}</div>
        <button type="button" class="btn btn-ghost add-ing" data-add><span class="ic">${HP.icon("plus")}</span>Add ingredient</button>

        <div class="rcp-totals">
          <span>Total cost <strong id="rcpTotal">—</strong></span>
          <span>Per serving <strong id="rcpServing">—</strong></span>
        </div>

        <div class="field">
          <label>Remarks</label>
          <textarea class="control" id="rcpRemarks" rows="2" placeholder="e.g. This recipe makes 1 roll, good for 10 pax.">${HP.esc(String(r.remarks || ""))}</textarea>
        </div>
      </div>`,
      `${isNew ? "" : `<button class="btn btn-ghost order-del" id="rcpDelete"><span class="ic">${HP.icon("trash")}</span>Delete</button>`}
       <button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="rcpSave"><span class="ic">${HP.icon("check")}</span>Save recipe</button>`);

    const sheet = document.querySelector(".recipe-sheet");

    function recalc() {
      let total = 0;
      sheet.querySelectorAll(".rcp-row").forEach((row) => {
        const c = lineCost(
          num(row.querySelector(".rcp-qty").value),
          num(row.querySelector(".rcp-pcost").value),
          num(row.querySelector(".rcp-psize").value));
        row.querySelector(".rcp-cost").textContent = peso(c);
        total += c || 0;
      });
      const portions = num(document.getElementById("rcpPortions").value);
      document.getElementById("rcpTotal").textContent = total ? peso(total) : "—";
      document.getElementById("rcpServing").textContent =
        total && portions > 0 ? peso(Math.ceil(total / portions)) : "—";
      document.getElementById("rcpPortionEcho").textContent =
        portions > 0 ? String(portions) : "…";
    }
    recalc();

    sheet.addEventListener("input", recalc);
    sheet.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add) {
        const rows = document.getElementById("rcpRows");
        rows.insertAdjacentHTML("beforeend", rowHTML());
        rows.lastElementChild.querySelector(".rcp-name").focus();
        return;
      }
      const del = e.target.closest(".ing-del");
      if (del) { del.closest(".rcp-row").remove(); recalc(); }
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
      ingredients.push({
        name: iname, qty, unit: row.querySelector(".rcp-unit").value,
        packCost, packSize, cost: lineCost(qty, packCost, packSize),
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
    const head = ["Recipe", "Portions", "Ingredient", "Qty", "Unit", "Pack cost", "Pack size", "Line cost", "Recipe total", "Per serving", "Remarks"];
    const lines = [head.map(cell).join(",")];
    recipes.forEach((r) => {
      const c = costOf(r);
      (Array.isArray(r.ingredients) ? r.ingredients : []).forEach((i, idx) => {
        lines.push([
          r.name, r.portions, i.name, i.qty, i.unit, i.packCost, i.packSize, i.cost,
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
