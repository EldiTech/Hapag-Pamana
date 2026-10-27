/* HapagPamana · Content Moderator — Allergens page.
   The editable allergen taxonomy: name, short label, and risk weight.
   Changes persist to settings/allergens immediately — the customer app
   reads the same document. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({ title: "Allergens", sub: "The tags dishes can carry.", search: false, action: null });

  const PAGE_SIZE = 5;
  let page = 1;

  const allergenEl = document.getElementById("allergenRows");
  const pagerEl = document.getElementById("allergenPager");
  document.getElementById("allergenAdd").addEventListener("click", onAddAllergen);
  document.getElementById("allergenDefaults").addEventListener("click", onRestoreDefaults);

  if (HP.store.DB) renderAllergens();
  else allergenEl.innerHTML = Array.from({ length: 5 }, () => `<div class="setting-row"><div class="skeleton sk-line"></div></div>`).join("");
  HP.ready.then(renderAllergens);   // first paint — instant when the cache has a copy
  HP.onRefresh(renderAllergens);    // repaint when the background refetch lands

  // The live, editable list (materialised onto the store if a stale cache
  // painted this page before the fresh load landed).
  function allergenList() {
    const DB = HP.store.DB;
    if (!Array.isArray(DB.allergens)) DB.allergens = structuredClone(HP.ALLERGENS);
    return DB.allergens;
  }

  // A stable storage key from a label ("Tree nuts" → tree_nuts), de-duped.
  function slugKey(label) {
    const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "allergen";
    let key = base, n = 2;
    while (allergenList().some((a) => a.key === key)) key = `${base}_${n++}`;
    return key;
  }

  function saveAllergens() { HP.store.persistAllergens(); HP.toast("Allergens saved."); }

  function pctOf(a) { return Math.round(a.severity * 100); }

  function renderAllergens() {
    const list = HP.ALLERGENS;
    if (!list.length) {
      HP.shell.paint(allergenEl, `<p class="allergen-none">No allergens yet — add one so dishes can be tagged.</p>`);
      pagerEl.innerHTML = "";
      return;
    }
    const pageCount = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    page = Math.min(Math.max(page, 1), pageCount);
    const start = (page - 1) * PAGE_SIZE;
    const pageItems = list.slice(start, start + PAGE_SIZE);

    HP.shell.paint(allergenEl, pageItems.map((a, i) => {
      const idx = start + i; // real index into HP.ALLERGENS, for wireAllergenRow
      return `
      <div class="setting-row allergen-edit" data-i="${idx}">
        <span class="allergen-swatch" style="background:${HP.allergenHeat(a.severity)}" title="Heat at full prevalence"></span>
        <input class="control a-label" value="${HP.esc(a.label)}" maxlength="24" placeholder="Name" aria-label="Allergen name">
        <input class="control control--xs a-short" value="${HP.esc(a.short)}" maxlength="10" placeholder="Short" aria-label="Short label" title="Short label shown on tight heatmap cells">
        <label class="a-sev" title="Risk weight — how hot this allergen paints the heatmap">
          <input type="range" min="5" max="100" step="5" value="${pctOf(a)}" aria-label="Risk weight"><b>${pctOf(a)}%</b>
        </label>
        <button class="icon-btn a-del" title="Delete allergen" aria-label="Delete ${HP.esc(a.label)}"><span class="ic">${HP.icon("trash")}</span></button>
      </div>`;
    }).join(""));
    allergenEl.querySelectorAll(".allergen-edit").forEach(wireAllergenRow);
    renderPager(pageCount);
  }

  function renderPager(pageCount) {
    if (pageCount <= 1) { pagerEl.innerHTML = ""; return; }
    const numbers = Array.from({ length: pageCount }, (_, i) => i + 1)
      .map((n) => `<button class="page-btn${n === page ? " active" : ""}" data-page="${n}" ${n === page ? 'aria-current="page"' : ""}>${n}</button>`)
      .join("");
    pagerEl.innerHTML = `
      <button class="icon-btn" id="pagePrev" ${page === 1 ? "disabled" : ""} aria-label="Previous page">${HP.icon("chevronLeft")}</button>
      <div class="page-nums">${numbers}</div>
      <button class="icon-btn" id="pageNext" ${page === pageCount ? "disabled" : ""} aria-label="Next page">${HP.icon("chevronRight")}</button>`;
    document.getElementById("pagePrev").addEventListener("click", () => { page--; renderAllergens(); });
    document.getElementById("pageNext").addEventListener("click", () => { page++; renderAllergens(); });
    pagerEl.querySelectorAll("[data-page]").forEach((b) =>
      b.addEventListener("click", () => { page = Number(b.dataset.page); renderAllergens(); }));
  }

  function wireAllergenRow(row) {
    const a = allergenList()[Number(row.dataset.i)];
    const swatch = row.querySelector(".allergen-swatch");
    const shortEl = row.querySelector(".a-short");

    row.querySelector(".a-label").addEventListener("change", (e) => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = a.label; return; } // a blank name is a no-op
      // Keep a short label that was just mirroring the name in step with it.
      if (a.short === a.label) { a.short = v.slice(0, 10); shortEl.value = a.short; }
      a.label = v;
      saveAllergens();
    });
    shortEl.addEventListener("change", () => {
      a.short = shortEl.value.trim() || a.label;
      shortEl.value = a.short;
      saveAllergens();
    });

    const range = row.querySelector('input[type="range"]');
    const pct = row.querySelector(".a-sev b");
    range.addEventListener("input", () => {
      a.severity = Number(range.value) / 100;
      pct.textContent = `${range.value}%`;
      swatch.style.background = HP.allergenHeat(a.severity);
    });
    range.addEventListener("change", saveAllergens);

    row.querySelector(".a-del").addEventListener("click", () => {
      HP.confirmModal("Delete allergen",
        `Remove "${a.label}" from the taxonomy? Dishes tagged with it simply stop showing it — nothing else is deleted.`,
        () => {
          const list = allergenList();
          list.splice(list.indexOf(a), 1);
          saveAllergens();
          renderAllergens();
        });
    });
  }

  function onAddAllergen() {
    HP.openModal("Add allergen", `
      <form id="allergenForm">
        <div class="field"><label>Name</label>
          <input class="control" name="label" maxlength="24" placeholder="e.g. Mustard" required>
          <div class="field-error" data-err="label" hidden></div></div>
        <div class="field"><label>Short label <em>(optional)</em></label>
          <input class="control" name="short" maxlength="10" placeholder="Defaults to the name">
          <div class="field-hint">Shown on tight heatmap cells — keep it to one word.</div></div>
        <div class="field"><label>Risk weight</label>
          <label class="a-sev a-sev--wide">
            <input type="range" name="severity" min="5" max="100" step="5" value="60"><b>60%</b>
          </label>
          <div class="field-hint">How hot the heatmap runs when this allergen is everywhere — set it high for allergens with severe reactions (peanut sits at 100%, soy at 55%).</div></div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="allergenSave">Add allergen</button>`);

    const f = document.getElementById("allergenForm");
    const range = f.querySelector('input[name="severity"]');
    const pct = f.querySelector(".a-sev b");
    range.addEventListener("input", () => { pct.textContent = `${range.value}%`; });

    const submit = () => {
      const label = f.label.value.trim();
      if (!HP.setErr(f, "label", label ? "" : "Give the allergen a name.")) return;
      if (allergenList().some((a) => a.label.toLowerCase() === label.toLowerCase())) {
        HP.setErr(f, "label", "That allergen already exists."); return;
      }
      allergenList().push({
        key: slugKey(label),
        label,
        short: f.short.value.trim() || label.slice(0, 10),
        severity: Number(range.value) / 100,
      });
      HP.closeModal();
      saveAllergens();
      page = Math.ceil(allergenList().length / PAGE_SIZE); // land on the new row's page
      renderAllergens();
    };
    document.getElementById("allergenSave").addEventListener("click", submit);
    f.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  }

  function onRestoreDefaults() {
    HP.confirmModal("Restore default allergens",
      "Replace the current list with the nine built-in allergens. Custom allergens will be removed; dish tags themselves are untouched.",
      () => {
        HP.store.DB.allergens = structuredClone(HP.DEFAULT_ALLERGENS);
        saveAllergens();
        page = 1;
        renderAllergens();
      });
  }
})();
