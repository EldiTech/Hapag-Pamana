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
    sub: "Filter categories for each product type.",
    search: false,
    action: { label: "New category", fn: () => categoryModal() },
  });

  const groupsEl = document.getElementById("catGroups");

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
    HP.shell.paint(groupsEl, HP.TYPES.map((type) => {
      const cats = HP.categoriesForType(type);
      const cards = cats.map((c) => {
        const count = DB.dishes.filter((d) => d.type === type && d.category === c.name).length;
        return `<div class="cat-card">
          <span class="cat-ic"><span class="ic">${HP.icon(HP.iconForCat(c))}</span></span>
          <span class="cat-meta"><h3>${HP.esc(c.name)}</h3><small>${count} product${count === 1 ? "" : "s"}</small></span>
          <button class="icon-btn" data-edit="${c.id}" title="Edit"><span class="ic">${HP.icon("edit")}</span></button>
          <button class="icon-btn danger" data-del="${c.id}" title="Delete"><span class="ic">${HP.icon("trash")}</span></button>
        </div>`;
      }).join("");
      return `<section class="cat-group">
        <div class="cat-group-head">
          <h2 class="cat-group-title">${HP.esc(type)}<span class="cat-group-count">${cats.length}</span></h2>
          <button class="btn btn-ghost btn-sm" data-add="${HP.esc(type)}"><span class="ic">${HP.icon("plus")}</span>Add to ${HP.esc(type)}</button>
        </div>
        <div class="card-grid">${cards || `<div class="empty empty--soft"><span class="ic">${HP.icon("tag")}</span><p>No categories in this type yet.</p></div>`}</div>
      </section>`;
    }).join(""));

    groupsEl.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => categoryModal(null, b.dataset.add)));
    groupsEl.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => categoryModal(b.dataset.edit)));
    groupsEl.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => delCategory(b.dataset.del)));
  }

  function categoryModal(id, presetType) {
    const DB = HP.store.DB;
    const c = id ? DB.categories.find((x) => x.id === id) : null;
    const startType = c ? c.type : (presetType || HP.TYPES[0]);
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
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="saveCat">${id ? "Save" : "Add category"}</button>`);
    document.getElementById("saveCat").addEventListener("click", () => {
      const f = document.getElementById("catForm");
      const name = f.elements.name.value.trim(); // `f.name` is the form's own name property
      const type = f.type.value;
      // Icon is assigned automatically from the category name (no manual picker).
      const icon = (c && c.icon) || HP.iconForCat({ name });
      if (!HP.setErr(f, "name", name ? "" : "Name is required.")) return;
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
        c.name = name; c.icon = icon; c.type = type; delete c.emoji; rec = c;
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
      } else { rec = { id: HP.uid(), name, icon, type }; DB.categories.push(rec); }
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
