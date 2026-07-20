/* HapagPamana · Content Moderator — Products page.
   The menu items shown in the app, split into two product types — Food Packs
   and Catering Food Trays — each with its own filter categories. The page is a
   type tab bar, per-type category chips, a search box (topbar) and a table,
   with create / edit / delete in a modal that includes an image uploader and a
   category dropdown that follows the chosen product type. Nothing is hardcoded:
   every row comes from the store (Firestore, or localStorage in demo mode). */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Products",
    sub: "Food Packs & Catering Food Trays shown in the app.",
    search: true,
    action: { label: "New product", fn: () => productModal() },
  });

  let typeFilter = HP.TYPES[0];        // active product-type tab
  let catFilters = new Set();          // selected categories — empty means "All"
  let searchTerm = "";
  let lastType = null;                 // last rendered tab — gates the underline grow-in

  const tabsEl = document.getElementById("typeTabs");
  const chipsEl = document.getElementById("catChips");
  const mapEl = document.getElementById("allergenMap");
  const gridEl = document.getElementById("rows");

  HP.shell.onSearch((term) => { searchTerm = term; render(); });

  // ── Bulk operations: a selection of card ids drives the action bar that
  // appears above the grid (delete / show / hide / feature / move category).
  const selection = new Set();
  const bulkEl = document.createElement("div");
  bulkEl.className = "bulk-bar";
  bulkEl.hidden = true;
  gridEl.before(bulkEl);

  if (!HP.store.DB) renderSkeleton();
  HP.ready.then(render);            // first paint — instant when the cache has a copy
  HP.onRefresh(render);             // repaint when the background refetch lands

  function renderSkeleton() {
    tabsEl.innerHTML = "";
    chipsEl.innerHTML = "";
    if (mapEl) mapEl.innerHTML = "";
    gridEl.innerHTML = HP.skel.cards(8);
  }

  function render() {
    const DB = HP.store.DB;
    const alive = DB.dishes.filter((d) => !d.deleted); // trashed dishes live on the Settings Trash

    // ── Type tabs (with a per-type product count) ──
    tabsEl.innerHTML = HP.TYPES.map((t) => {
      const n = alive.filter((d) => d.type === t).length;
      return `<button class="seg-btn ${t === typeFilter ? "active" : ""}" role="tab"
                aria-selected="${t === typeFilter}" data-type="${HP.esc(t)}">
                ${HP.esc(t)}<span class="seg-count">${n}</span></button>`;
    }).join("");
    // The gold underline grows in only when the active course actually changes
    // — search/filter re-renders rebuild the tabs too, and mustn't replay it.
    tabsEl.classList.toggle("anim", typeFilter !== lastType);
    lastType = typeFilter;
    tabsEl.querySelectorAll("[data-type]").forEach((b) =>
      b.addEventListener("click", () => {
        typeFilter = b.dataset.type; catFilters.clear();
        selection.clear(); // a selection never spans product types
        render();
      }));

    // ── Category chips for the active type (multi-select OR) ──
    const typeCats = HP.categoriesForType(typeFilter).map((c) => c.name);
    // Drop any selections that no longer exist in the current type.
    catFilters.forEach((c) => { if (!typeCats.includes(c)) catFilters.delete(c); });
    const allActive = catFilters.size === 0;
    chipsEl.innerHTML = [
      `<button class="chip-filter ${allActive ? "active" : ""}" data-cat="">All</button>`,
      ...typeCats.map((c) =>
        `<button class="chip-filter ${catFilters.has(c) ? "active" : ""}" data-cat="${HP.esc(c)}">${HP.esc(c)}</button>`),
    ].join("");
    chipsEl.querySelectorAll("[data-cat]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const cat = btn.dataset.cat;
        if (!cat) { catFilters.clear(); }
        else if (catFilters.has(cat)) { catFilters.delete(cat); }
        else { catFilters.add(cat); }
        render();
      }));

    // ── Cards: filter by type → categories (OR) → search ──
    let list = alive.filter((d) => d.type === typeFilter).sort((a, b) => a.name.localeCompare(b.name));
    if (catFilters.size > 0) list = list.filter((d) => catFilters.has(d.category));
    if (searchTerm) list = list.filter((d) => d.name.toLowerCase().includes(searchTerm));

    // ── Allergen heatmap over the dishes currently in view ──
    renderAllergenMap(list);

    HP.shell.paint(gridEl, list.length ? list.map((d) => `
      <div class="prod-card">
        <div class="prod-thumb">
          <label class="prod-pick" title="Select for bulk actions">
            <input type="checkbox" data-pick="${d.id}" ${selection.has(d.id) ? "checked" : ""} aria-label="Select ${HP.esc(d.name)}">
          </label>
          ${d.image
            /* One <img> only: on cards the fg covers the whole 4:3 thumb
               (object-fit: cover), so the blurred bg layer was invisible —
               and each bg duplicated the multi-hundred-KB data URL in the
               DOM. The detail view keeps its two-layer letterbox treatment. */
            ? `<img class="prod-thumb-fg" src="${HP.esc(d.image)}" alt="${HP.esc(d.name)}" loading="lazy">`
            : `<span class="prod-thumb-letter">${HP.esc((d.name[0] || "?").toUpperCase())}</span>`}
          <button class="prod-feat ${d.featured ? "is-on" : ""}" data-feat="${d.id}" aria-pressed="${!!d.featured}"
            title="${d.featured ? "Featured on Home — click to remove" : "Feature on Home"}"
            aria-label="${d.featured ? "Remove from Home features" : "Feature on Home"}"><span class="ic">${HP.icon("star")}</span></button>
          ${d.available
            ? `<span class="prod-status prod-status--ok"><span class="dot"></span>Visible</span>`
            : `<span class="prod-status prod-status--off">Hidden</span>`}
        </div>
        <div class="prod-body">
          <h3 class="prod-name">${HP.esc(d.name)}</h3>
          <span class="badge badge-cat">${HP.esc(d.category)}</span>
        </div>
        <div class="card-foot">
          <button class="btn btn-ghost btn-sm" data-view="${d.id}"><span class="ic">${HP.icon("eye")}</span>View</button>
          <button class="btn btn-ghost btn-sm" data-edit="${d.id}"><span class="ic">${HP.icon("edit")}</span>Edit</button>
          <button class="icon-btn danger prod-del" data-del="${d.id}" title="Delete" aria-label="Delete product"><span class="ic">${HP.icon("trash")}</span></button>
        </div>
      </div>`).join("") : `
      <div class="empty empty--soft">
        <span class="ic">${HP.icon("dish")}</span>
        <p>${searchTerm || catFilters.size > 0 ? "No products match." : "No products yet."}</p>
      </div>`);

    gridEl.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => viewDish(b.dataset.view)));
    gridEl.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => productModal(b.dataset.edit)));
    gridEl.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delDish(b.dataset.del)));
    gridEl.querySelectorAll("[data-feat]").forEach((b) => b.addEventListener("click", () => toggleFeatured(b.dataset.feat)));
    gridEl.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("change", () => {
      if (b.checked) selection.add(b.dataset.pick); else selection.delete(b.dataset.pick);
      renderBulk();
    }));
    renderBulk();
  }

  // ── Bulk action bar ─────────────────────────────────────────────────────
  function renderBulk() {
    const DB = HP.store.DB;
    // Drop selections that no longer exist (deleted elsewhere / refetched away).
    [...selection].forEach((id) => {
      const d = DB && DB.dishes.find((x) => x.id === id);
      if (!d || d.deleted) selection.delete(id);
    });
    if (!selection.size) { bulkEl.hidden = true; bulkEl.innerHTML = ""; return; }
    bulkEl.hidden = false;
    bulkEl.innerHTML = `
      <strong>${selection.size} selected</strong>
      <button class="btn btn-ghost btn-sm" data-bulk="show"><span class="ic">${HP.icon("eye")}</span>Show in app</button>
      <button class="btn btn-ghost btn-sm" data-bulk="hide">Hide</button>
      <button class="btn btn-ghost btn-sm" data-bulk="feature"><span class="ic">${HP.icon("star")}</span>Feature</button>
      <button class="btn btn-ghost btn-sm" data-bulk="unfeature">Unfeature</button>
      <select class="control control--xs" id="bulkCat" aria-label="Move to category">${catOptions(typeFilter, "")}</select>
      <button class="btn btn-ghost btn-sm" data-bulk="move">Move</button>
      <button class="btn btn-danger btn-sm" data-bulk="delete"><span class="ic">${HP.icon("trash")}</span>Delete</button>
      <button class="btn btn-ghost btn-sm" data-bulk="clear">Clear</button>`;
    bulkEl.querySelectorAll("[data-bulk]").forEach((b) =>
      b.addEventListener("click", () => bulkApply(b.dataset.bulk)));
  }

  function bulkApply(act) {
    const DB = HP.store.DB;
    const picks = [...selection].map((id) => DB.dishes.find((x) => x.id === id)).filter(Boolean);
    if (act === "clear" || !picks.length) { selection.clear(); render(); return; }
    const done = (msg, tone) => {
      selection.clear();
      HP.toast(msg, tone || "ok");
      render();
    };
    if (act === "delete") {
      HP.confirmModal("Delete selected products",
        `Move ${picks.length} product${picks.length === 1 ? "" : "s"} to the Trash? Restore them any time from Settings.`, () => {
          picks.forEach((d) => HP.store.softRemove("dishes", d.id));
          done(`${picks.length} product${picks.length === 1 ? "" : "s"} moved to Trash.`, "warn");
        });
      return;
    }
    if (act === "move") {
      const cat = document.getElementById("bulkCat").value;
      if (!cat) { HP.toast("Pick the category to move them to first.", "warn"); return; }
      picks.forEach((d) => { d.category = cat; });
      HP.store.updateFields("dishes", picks.map((d) => ({ id: d.id, fields: { category: cat } })));
      done(`Moved ${picks.length} product${picks.length === 1 ? "" : "s"} to “${cat}”.`);
      return;
    }
    const fields = {
      show: { available: true }, hide: { available: false },
      feature: { featured: true }, unfeature: { featured: false },
    }[act];
    if (!fields) return;
    picks.forEach((d) => Object.assign(d, fields));
    HP.store.updateFields("dishes", picks.map((d) => ({ id: d.id, fields })));
    done(`Updated ${picks.length} product${picks.length === 1 ? "" : "s"}.`);
  }

  // One-click feature toggle from the card — no need to open the editor.
  function toggleFeatured(id) {
    const d = HP.store.DB.dishes.find((x) => x.id === id);
    if (!d) return;
    d.featured = !d.featured;
    HP.store.persist("dishes", d);
    HP.toast(d.featured ? `“${d.name}” is now featured on Home.` : `“${d.name}” removed from Home features.`);
    render();
    if (d.featured) {
      // Stamp the freshly-rendered gilt coin — a small reward for the action.
      const btn = gridEl.querySelector(`[data-feat="${id}"]`);
      if (btn) {
        btn.classList.add("stamped");
        setTimeout(() => btn.classList.remove("stamped"), 600);
      }
    }
  }

  // ── Allergen heatmap (collection view) ────────────────────────────────
  // Aggregates the allergen taxonomy across the dishes currently shown; each
  // cell's warmth = prevalence × severity. Only allergens actually present in
  // the shown dishes get a cell, and the whole map hides until at least one
  // dish carries allergen data, so an untagged menu doesn't imply an all-clear.
  function renderAllergenMap(list) {
    if (!mapEl) return;
    const stats = HP.aggregateAllergens(list);
    if (!list.length || !HP.hasAnyAllergenData(stats)) { mapEl.innerHTML = ""; return; }

    const cells = stats.filter((s) => s.count > 0).map((s) => {
      const bg = HP.allergenHeat(s.intensity);
      const fg = s.intensity >= 0.5 ? "#F6EFDF" : "#503413";
      return `<span class="allergen-cell" style="background:${bg};color:${fg};border-color:transparent"
        title="${HP.esc(s.allergen.label)} — in ${s.count} of ${s.total} dishes shown">
        <b>${HP.esc(s.allergen.short)}</b><small>${s.count}/${s.total}</small></span>`;
    }).join("");

    mapEl.innerHTML = `
      <section class="allergen-map">
        <div class="allergen-map-head">
          <span class="ic">${HP.icon("dish")}</span>
          <div>
            <h3>Allergen map</h3>
            <p>Across the ${list.length} dish${list.length === 1 ? "" : "es"} shown — warmer means more common &amp; higher-risk.</p>
          </div>
        </div>
        <div class="allergen-grid">${cells}</div>
        <div class="allergen-legend"><span>Less</span><i></i><span>More</span></div>
      </section>`;
  }

  // Solid chips naming a single dish's allergens, each tinted by its own risk.
  function allergenTagsHTML(keys) {
    const list = HP.parseAllergens(keys);
    if (!list.length) return `<span class="allergen-none">None recorded</span>`;
    return list.map((k) => {
      const a = HP.ALLERGENS.find((x) => x.key === k);
      const bg = HP.allergenHeat(a.severity);
      const fg = a.severity >= 0.5 ? "#F6EFDF" : "#503413";
      return `<span class="allergen-tag" style="background:${bg};color:${fg}">${HP.esc(a.label)}</span>`;
    }).join("");
  }

  // ── Read-only detail view ─────────────────────────────────────────────
  function viewDish(id) {
    const d = HP.store.DB.dishes.find((x) => x.id === id);
    if (!d) return;

    HP.openModal(d.name, `
      <div class="prod-view">
        <div class="prod-view-media">
          ${d.image
            ? `<img class="prod-thumb-bg" src="${HP.esc(d.image)}" alt="" aria-hidden="true">
               <img class="prod-thumb-fg" src="${HP.esc(d.image)}" alt="${HP.esc(d.name)}">`
            : `<span class="prod-thumb-letter">${HP.esc((d.name[0] || "?").toUpperCase())}</span>`}
        </div>
        <div class="prod-view-meta">
          <span class="badge badge-cat">${HP.esc(d.category)}</span>
          ${d.available
            ? `<span class="badge badge-ok"><span class="dot"></span>Visible</span>`
            : `<span class="badge badge-muted">Hidden</span>`}
          ${d.featured ? `<span class="badge badge-gold"><span class="ic">${HP.icon("star")}</span>Featured</span>` : ""}
        </div>
        <dl class="prod-view-facts">
          <div><dt>Product type</dt><dd>${HP.esc(d.type)}</dd></div>
          <div><dt>Category</dt><dd>${HP.esc(d.category)}</dd></div>
          <div><dt>Shown in app</dt><dd>${d.available ? "Yes" : "No"}</dd></div>
          <div><dt>Featured on Home</dt><dd>${d.featured ? "Yes" : "No"}</dd></div>
        </dl>
        <div class="prod-view-allergens">
          <dt>Allergens</dt>
          <div class="allergen-tags">${allergenTagsHTML(d.allergens)}</div>
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="viewEdit"><span class="ic">${HP.icon("edit")}</span>Edit</button>`);

    document.getElementById("viewEdit").addEventListener("click", () => {
      HP.closeModal();
      productModal(id);
    });
  }

  // Category <option>s for a given product type (selected one pre-chosen).
  // Without a match, a disabled placeholder holds the selection — switching
  // product type must never silently file the dish under the first category.
  function catOptions(type, selected) {
    const cats = HP.categoriesForType(type);
    if (!cats.length) return `<option value="" disabled selected>No categories — add one first</option>`;
    const hasMatch = cats.some((c) => c.name === selected);
    return (hasMatch ? "" : `<option value="" disabled selected>Choose a category…</option>`)
      + cats.map((c) => `<option ${c.name === selected ? "selected" : ""}>${HP.esc(c.name)}</option>`).join("");
  }

  // ── Create / edit ──
  function productModal(id) {
    const DB = HP.store.DB;
    const d = id ? DB.dishes.find((x) => x.id === id) : null;
    const startType = d ? d.type : typeFilter;
    let image = d ? d.image || "" : ""; // current image (data URL or remote URL)

    HP.openModal(id ? "Edit product" : "New product", `
      <form id="dishForm" novalidate>
        <div class="field"><label>Name <span class="req">*</span></label>
          <input class="control" name="name" value="${d ? HP.esc(d.name) : ""}" placeholder="e.g. Chicken Adobo Pack" required>
          <div class="field-error" data-err="name" hidden></div></div>

        <div class="field-row">
          <div class="field"><label>Product type <span class="req">*</span></label>
            <select class="control" name="type">
              ${HP.TYPES.map((t) => `<option ${t === startType ? "selected" : ""}>${HP.esc(t)}</option>`).join("")}
            </select></div>
          <div class="field"><label>Category <span class="req">*</span></label>
            <select class="control" name="category">${catOptions(startType, d ? d.category : "")}</select>
            <div class="field-error" data-err="category" hidden></div></div>
        </div>

        <div class="field"><label>Product image</label>
          <div class="uploader">
            <div class="uploader-preview" id="imgPreview"></div>
            <div class="uploader-side">
              <button type="button" class="btn btn-ghost btn-sm" id="pickImg"><span class="ic">${HP.icon("download")}</span>Upload image</button>
              <button type="button" class="btn btn-danger btn-sm" id="clearImg" hidden><span class="ic">${HP.icon("trash")}</span>Remove</button>
              <input type="file" id="imgFile" accept="image/*" hidden>
            </div>
          </div>
          <div class="field-hint">JPG or PNG — large images are resized automatically. Leave empty for a lettered tile.</div></div>

        <div class="field"><label>Allergens</label>
          <div class="allergen-picker">
            ${HP.ALLERGENS.map((a) => `
              <label class="chk">
                <input type="checkbox" name="allergen" value="${a.key}" ${d && HP.parseAllergens(d.allergens).includes(a.key) ? "checked" : ""}>
                <span>${HP.esc(a.label)}</span>
              </label>`).join("")}
          </div>
          <div class="field-hint">Tick every allergen this dish contains — this powers the allergen heatmap in the app.</div></div>

        <div class="inline-toggles">
          <label class="switch"><input type="checkbox" name="available" ${!d || d.available ? "checked" : ""}><span class="track"></span><span class="switch-label">Visible in app</span></label>
          <label class="switch"><input type="checkbox" name="featured" ${d && d.featured ? "checked" : ""}><span class="track"></span><span class="switch-label">Featured on Home</span></label>
        </div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="saveDish">${id ? "Save changes" : "Add product"}</button>`);

    const f = document.getElementById("dishForm");
    const typeSel = f.type, catSel = f.category;
    const preview = document.getElementById("imgPreview");
    const clearBtn = document.getElementById("clearImg");
    const fileInput = document.getElementById("imgFile");
    // NB: access the "name" control via .elements — `f.name` resolves to the
    // form's own `name` property (a string), not the input.
    const nameInput = f.elements.name;

    function renderPreview() {
      if (image) {
        preview.innerHTML = `<img src="${HP.esc(image)}" alt="">`;
        preview.classList.add("has-img");
      } else {
        const letter = (nameInput.value.trim()[0] || "?").toUpperCase();
        preview.innerHTML = `<span class="uploader-letter">${HP.esc(letter)}</span>`;
        preview.classList.remove("has-img");
      }
      clearBtn.hidden = !image;
    }
    renderPreview();

    // Category dropdown follows the chosen product type.
    typeSel.addEventListener("change", () => { catSel.innerHTML = catOptions(typeSel.value, catSel.value); });
    nameInput.addEventListener("input", () => { if (!image) renderPreview(); });

    document.getElementById("pickImg").addEventListener("click", () => fileInput.click());
    clearBtn.addEventListener("click", () => { image = ""; fileInput.value = ""; renderPreview(); });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      HP.compressImage(file).then((dataUrl) => {
        image = dataUrl; renderPreview();
        const hint = preview.closest(".field").querySelector(".field-hint");
        if (hint) hint.textContent = `Image ready — ${Math.round(dataUrl.length / 1024)} KB stored inline.`;
      }).catch((err) => HP.toast(err && err.message === "image too large"
        ? "That photo can't be squeezed under the storage budget — try a smaller or simpler image."
        : "Couldn't read that image.", "danger"));
    });

    document.getElementById("saveDish").addEventListener("click", () => {
      const name = nameInput.value.trim(), category = f.category.value;
      let ok = true;
      ok = HP.setErr(f, "name", name ? "" : "Name is required.") && ok;
      ok = HP.setErr(f, "category", category ? ""
        : (HP.categoriesForType(f.type.value).length ? "Choose a category." : "Add a category for this type first.")) && ok;
      if (!ok) return;
      const allergens = Array.from(f.querySelectorAll('input[name="allergen"]:checked')).map((c) => c.value);
      const payload = {
        name, type: f.type.value, category, allergens,
        image, available: f.available.checked, featured: f.featured.checked,
      };
      // Save against the LIVE store — a background refetch may have replaced
      // the copy captured when the modal opened, and a write into that orphan
      // would land in Firestore but never on screen (or in the cache).
      const DB = HP.store.DB;
      let rec;
      if (d) {
        rec = Object.assign(d, payload);
        if (!DB.dishes.some((x) => x.id === d.id)) DB.dishes.push(rec); // vanished mid-edit — re-attach
      } else { rec = { id: HP.uid(), createdAt: Date.now(), ...payload }; DB.dishes.push(rec); }
      HP.store.persist("dishes", rec);
      // Make sure the just-saved product is visible after closing the modal.
      typeFilter = rec.type; catFilters.clear();
      HP.closeModal();
      HP.toast(id ? "Product updated." : `“${name}” added.`);
      render();
    });
  }

  // Image compression lives in core.js (HP.compressImage) — shared with Setups.

  function delDish(id) {
    const DB = HP.store.DB;
    const d = DB.dishes.find((x) => x.id === id);
    if (!d) return;
    HP.confirmModal("Delete product",
      `Move “${d.name}” to the Trash? It leaves the menu right away — restore it any time from Settings.`, () => {
      // Fade the card out first, so the deletion reads as "this one left".
      const btn = gridEl.querySelector(`[data-del="${id}"]`);
      HP.animateOut(btn && btn.closest(".prod-card")).then(() => {
        HP.store.softRemove("dishes", id);
        HP.toast("Product moved to Trash — restore it from Settings.", "warn");
        render();
      });
    });
  }
})();
