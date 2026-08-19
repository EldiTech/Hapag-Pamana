/* HapagPamana · Content Moderator — Categories page.
   The menu filter categories, grouped under the two product types (Food Packs
   and Catering Food Trays). Each card shows how many products in that type use
   the category. A category belongs to one type; renaming it cascades to every
   product of that type, and deleting checks usage within the type. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Categories",
    sub: "Filter categories for each product type, and the per-head price their dishes carry as add-ons.",
    search: false,
    action: { label: "New category", fn: () => categoryModal() },
  });

  const groupsEl = document.getElementById("catGroups");
  // The store's currency symbol, for the price field's prefix.
  const currency = () => (HP.store.DB && HP.store.DB.settings && HP.store.DB.settings.currency) || "₱";

  const PAGE_SIZE = 10;
  // One page number per product type, so paging Food Packs doesn't move
  // Catering Food Trays out from under the moderator.
  const pageOf = {};

  if (HP.store.DB) render(); else groupsEl.innerHTML = skeleton();
  HP.ready.then(render);            // first paint — instant when the cache has a copy
  HP.onRefresh(render);             // repaint when the background refetch lands

  function skeleton() {
    return HP.TYPES.map((t) =>
      `<section class="cat-group"><h2 class="cat-group-title">${HP.esc(t)}</h2>
        <div class="card-grid">${HP.skel.cards(4)}</div></section>`).join("");
  }

  function render() {
    const DB = HP.store.DB;
    HP.shell.paint(groupsEl, HP.TYPES.map((type, typeIdx) => {
      const cats = HP.categoriesForType(type);
      const pageCount = Math.max(1, Math.ceil(cats.length / PAGE_SIZE));
      const page = Math.min(Math.max(pageOf[type] || 1, 1), pageCount);
      pageOf[type] = page;
      const start = (page - 1) * PAGE_SIZE;
      const pageCats = cats.slice(start, start + PAGE_SIZE);

      const cards = pageCats.map((c) => {
        const count = DB.dishes.filter((d) => d.type === type && d.category === c.name).length;
        // The per-head add-on rate every dish in this category inherits.
        const rate = HP.categoryPrice(c);
        return `<div class="cat-card">
          <span class="cat-ic"><span class="ic">${HP.icon(HP.iconForCat(c))}</span></span>
          <span class="cat-meta"><h3>${HP.esc(c.name)}</h3>
            <small>${count} product${count === 1 ? "" : "s"}</small>
            <span class="cat-price${rate === null ? " cat-price--unset" : ""}">${
              rate === null ? "Not priced" : `${HP.money(rate)} <small>/ pax</small>`}</span></span>
          <button class="icon-btn" data-edit="${c.id}" title="Edit"><span class="ic">${HP.icon("edit")}</span></button>
          <button class="icon-btn danger" data-del="${c.id}" title="Delete"><span class="ic">${HP.icon("trash")}</span></button>
        </div>`;
      }).join("");
      return `<section class="cat-group cat-group--${typeIdx}">
        <div class="cat-group-head">
          <h2 class="cat-group-title"><span class="cat-group-swatch"><span class="ic">${HP.icon(typeIdx === 0 ? "box" : "basket")}</span></span>${HP.esc(type)}<span class="cat-group-count">${cats.length}</span></h2>
          <button class="btn btn-ghost btn-sm" data-add="${HP.esc(type)}"><span class="ic">${HP.icon("plus")}</span>Add to ${HP.esc(type)}</button>
        </div>
        <div class="card-grid">${cards || `<div class="empty empty--soft"><span class="ic">${HP.icon("tag")}</span><p>No categories in this type yet.</p></div>`}</div>
        <div class="pager" data-pager="${HP.esc(type)}"></div>
      </section>`;
    }).join(""));

    groupsEl.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => categoryModal(null, b.dataset.add)));
    groupsEl.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => categoryModal(b.dataset.edit)));
    groupsEl.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delCategory(b.dataset.del)));

    HP.TYPES.forEach((type) => renderPager(type));
  }

  function renderPager(type) {
    const el = groupsEl.querySelector(`[data-pager="${CSS.escape(type)}"]`);
    if (!el) return;
    const cats = HP.categoriesForType(type);
    const pageCount = Math.max(1, Math.ceil(cats.length / PAGE_SIZE));
    if (pageCount <= 1) { el.innerHTML = ""; return; }
    const page = pageOf[type] || 1;
    const numbers = Array.from({ length: pageCount }, (_, i) => i + 1)
      .map((n) => `<button class="page-btn${n === page ? " active" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""}>${n}</button>`)
      .join("");
    el.innerHTML = `
      <button class="icon-btn" data-prev ${page === 1 ? "disabled" : ""} aria-label="Previous page">${HP.icon("chevronLeft")}</button>
      <div class="page-nums">${numbers}</div>
      <button class="icon-btn" data-next ${page === pageCount ? "disabled" : ""} aria-label="Next page">${HP.icon("chevronRight")}</button>`;
    el.querySelector("[data-prev]").addEventListener("click", () => { pageOf[type]--; render(); });
    el.querySelector("[data-next]").addEventListener("click", () => { pageOf[type]++; render(); });
    el.querySelectorAll("[data-page]").forEach((b) =>
      b.addEventListener("click", () => { pageOf[type] = Number(b.dataset.page); render(); }));
  }

  function categoryModal(id, presetType) {
    const DB = HP.store.DB;
    const c = id ? DB.categories.find((x) => x.id === id) : null;
    const startType = c ? c.type : (presetType || HP.TYPES[0]);
    // An existing category opens on its rate (the printed default when it has
    // never been priced); a new one opens blank for the moderator to set.
    const startPrice = c ? HP.categoryPrice(c) : null;
    HP.openModal(id ? "Edit category" : "New category", `
      <form id="catForm" novalidate>
        <div class="field"><label>Name <span class="req">*</span></label>
          <input class="control" name="name" value="${c ? HP.esc(c.name) : ""}" placeholder="e.g. Grilled" required>
          <div class="field-error" data-err="name" hidden></div></div>
        <div class="field"><label>Product type <span class="req">*</span></label>
          <select class="control" name="type">
            ${HP.TYPES.map((t) => `<option ${t === startType ? "selected" : ""}>${HP.esc(t)}</option>`).join("")}
          </select>
          <div class="field-hint">Which menu this category filters.</div></div>
        <div class="field"><label>Add-on price <span class="req">*</span></label>
          <div class="control-affix"><span class="affix">${HP.esc(currency())}</span>
            <input class="control" name="price" type="number" min="0" step="1"
                   value="${startPrice === null ? "" : startPrice}" placeholder="0" required>
            <span class="affix affix--end">/ pax</span></div>
          <div class="field-error" data-err="price" hidden></div>
          <div class="field-hint">What one head of any dish in this category costs as an add-on. A product can override it.</div></div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="saveCat">${id ? "Save" : "Add category"}</button>`);
    document.getElementById("saveCat").addEventListener("click", () => {
      const f = document.getElementById("catForm");
      const name = f.elements.name.value.trim(); // `f.name` is the form's own name property
      const type = f.type.value;
      const priceRaw = f.price.value.trim();
      // Icon is assigned automatically from the category name (no manual picker).
      const icon = (c && c.icon) || HP.iconForCat({ name });
      let ok = true;
      ok = HP.setErr(f, "name", name ? "" : "Name is required.") && ok;
      ok = HP.setErr(f, "price", priceRaw !== "" && Number(priceRaw) >= 0 && Number.isFinite(Number(priceRaw))
        ? "" : "Enter a per-head add-on price.") && ok;
      if (!ok) return;
      const price = Number(priceRaw);
      // Save against the LIVE store — a background refetch may have replaced
      // the copy captured when the modal opened, and a write into that orphan
      // would land in Firestore but never on screen (or in the cache).
      const DB = HP.store.DB;
      // Names must be unique within their product type.
      if (DB.categories.some((x) => x.type === type && x.name.toLowerCase() === name.toLowerCase() && (!c || x.id !== c.id)))
        return HP.setErr(f, "name", "That category already exists in this type.");
      const oldName = c ? c.name : null, oldType = c ? c.type : null;
      let rec;
      if (c) {
        c.name = name; c.icon = icon; c.type = type; c.price = price; delete c.emoji; rec = c;
        if (!DB.categories.some((x) => x.id === c.id)) DB.categories.push(rec); // vanished mid-edit — re-attach
        // Renaming (or retyping) cascades to every product that referenced it —
        // field-only chunked updates, so the dishes' inline images are never
        // rewritten along for the ride.
        if (oldName !== name || oldType !== type) {
          const moved = [];
          DB.dishes.forEach((dd) => {
            if (dd.type === oldType && dd.category === oldName) {
              dd.category = name; dd.type = type;
              moved.push({ id: dd.id, fields: { category: name, type } });
            }
          });
          if (moved.length) HP.store.updateFields("dishes", moved);
        }
      } else {
        rec = { id: HP.uid(), name, icon, type, price }; DB.categories.push(rec);
        // Land on the new row's page instead of leaving it off-screen.
        pageOf[type] = Math.ceil(HP.categoriesForType(type).length / PAGE_SIZE);
      }
      HP.store.persist("categories", rec);
      HP.closeModal();
      HP.toast(id ? "Category updated." : `“${name}” added.`);
      render();
    });
  }

  function delCategory(id) {
    const DB = HP.store.DB;
    const c = DB.categories.find((x) => x.id === id);
    if (!c) return;
    const used = DB.dishes.filter((d) => !d.deleted && d.type === c.type && d.category === c.name).length;
    HP.confirmModal("Delete category",
      used ? `“${c.name}” is used by ${used} product${used === 1 ? "" : "s"} in ${c.type}. They’ll keep the label but it won’t be a filter anymore. Restore the category any time from Settings.`
           : `Move the “${c.name}” category from ${c.type} to the Trash? Restore it any time from Settings.`,
      () => {
        // Fade the card out first, so the deletion reads as "this one left".
        const btn = groupsEl.querySelector(`[data-del="${id}"]`);
        HP.animateOut(btn && btn.closest(".cat-card")).then(() => {
          HP.store.softRemove("categories", id);
          HP.toast("Category moved to Trash — restore it from Settings.", "warn");
          render();
        });
      });
  }
})();
