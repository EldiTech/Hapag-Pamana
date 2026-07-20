/* HapagPamana · Content Moderator — Settings page.
   App-wide content switches, the currency symbol, the editable allergen
   taxonomy, and a "reset to sample data" action. Every change persists
   immediately. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({ title: "Settings", sub: "App-wide content switches.", search: false, action: null });

  const togglesEl  = document.getElementById("settingsToggles");
  const regionalEl = document.getElementById("settingsRegional");
  const allergenEl = document.getElementById("allergenRows");
  const trashEl    = document.getElementById("trashRows");
  const importFile = document.getElementById("importFile");
  document.getElementById("resetData").addEventListener("click", onReset);
  document.getElementById("importData").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", onImportPicked);
  document.getElementById("allergenAdd").addEventListener("click", onAddAllergen);
  document.getElementById("allergenDefaults").addEventListener("click", onRestoreDefaults);

  if (HP.store.DB) renderAll();
  else {
    togglesEl.innerHTML  = Array.from({ length: 4 }, () => `<div class="setting-row"><div class="skeleton sk-line"></div></div>`).join("");
    allergenEl.innerHTML = Array.from({ length: 5 }, () => `<div class="setting-row"><div class="skeleton sk-line"></div></div>`).join("");
  }
  HP.ready.then(renderAll);         // first paint — instant when the cache has a copy
  HP.onRefresh(renderAll);          // repaint when the background refetch lands

  function renderAll() { render(); renderAllergens(); renderTrash(); }

  /* ── Trash: everything soft-deleted across the four content kinds ─────── */
  const TRASH_KINDS = [
    ["dishes", "Product", (r) => r.name],
    ["categories", "Category", (r) => `${r.name} · ${r.type || ""}`],
    ["packages", "Package", (r) => r.name],
    ["setups", "Setup photo", (r) => r.title],
  ];
  // deletedAt may be a Firestore Timestamp (server copy) or plain ms (the
  // optimistic value written at delete time).
  function trashDate(v) {
    const ms = v && typeof v.toMillis === "function" ? v.toMillis() : Number(v);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    return new Date(ms).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
  }

  function renderTrash() {
    if (!trashEl) return;
    const DB = HP.store.DB;
    const rows = [];
    TRASH_KINDS.forEach(([kind, label, nameOf]) => {
      (DB[kind] || []).filter((r) => r.deleted).forEach((r) => rows.push({ kind, label, r, nameOf }));
    });
    if (!rows.length) {
      HP.shell.paint(trashEl, `<p class="allergen-none">The Trash is empty — deleted items land here for safekeeping.</p>`);
      return;
    }
    HP.shell.paint(trashEl, rows.map(({ kind, label, r, nameOf }) => `
      <div class="setting-row">
        <div class="meta">
          <strong>${HP.esc(String(nameOf(r) || "Untitled"))}</strong>
          <small>${HP.esc(label)}${trashDate(r.deletedAt) ? ` · deleted ${HP.esc(trashDate(r.deletedAt))}` : ""}</small>
        </div>
        <button class="btn btn-ghost btn-sm" data-restore="${kind}:${HP.esc(r.id)}"><span class="ic">${HP.icon("undo")}</span>Restore</button>
        <button class="btn btn-danger btn-sm" data-forever="${kind}:${HP.esc(r.id)}"><span class="ic">${HP.icon("trash")}</span>Delete forever</button>
      </div>`).join(""));
    trashEl.querySelectorAll("[data-restore]").forEach((b) =>
      b.addEventListener("click", () => {
        const [kind, id] = b.dataset.restore.split(":");
        HP.store.restore(kind, id);
        HP.toast("Restored — it stays hidden in the app until you re-enable it.");
        renderTrash();
      }));
    trashEl.querySelectorAll("[data-forever]").forEach((b) =>
      b.addEventListener("click", () => {
        const [kind, id] = b.dataset.forever.split(":");
        const DB2 = HP.store.DB;
        const row = (DB2[kind] || []).find((x) => x.id === id);
        HP.confirmModal("Delete forever",
          `Permanently delete “${row ? (row.name || row.title || "this item") : "this item"}”? This cannot be undone.`, () => {
            DB2[kind] = (DB2[kind] || []).filter((x) => x.id !== id);
            HP.store.remove(kind, id);
            HP.toast("Deleted forever.", "danger");
            renderTrash();
          });
      }));
  }

  /* ── JSON import — validate shape, preview counts, then merge by id ───── */
  function onImportPicked() {
    const file = importFile.files && importFile.files[0];
    importFile.value = ""; // allow re-picking the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => HP.toast("Couldn't read that file.", "danger");
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch { HP.toast("That file isn't valid JSON.", "danger"); return; }
      const kinds = [["categories", "categories"], ["dishes", "products"], ["packages", "packages"], ["setups", "setups"]];
      const counts = kinds.map(([k, label]) => [label, Array.isArray(data[k]) ? data[k].length : 0]);
      const total = counts.reduce((s, [, n]) => s + n, 0);
      if (!total && !data.settings && !Array.isArray(data.allergens)) {
        HP.toast("No importable content found — expected a HapagPamana JSON export.", "danger");
        return;
      }
      HP.openModal("Import content", `
        <p class="modal-text">This merges the file into the live database — rows are matched by id
          (existing ones updated, new ones added; nothing is deleted).</p>
        <dl class="prod-view-facts">
          ${counts.map(([label, n]) => `<div><dt>${HP.esc(label)}</dt><dd>${n}</dd></div>`).join("")}
          <div><dt>settings</dt><dd>${data.settings ? "yes" : "—"}</dd></div>
          <div><dt>allergens</dt><dd>${Array.isArray(data.allergens) ? data.allergens.length : "—"}</dd></div>
        </dl>`,
        `<button class="btn btn-ghost" data-close>Cancel</button>
         <button class="btn btn-primary" id="importGo"><span class="ic">${HP.icon("upload")}</span>Import ${total} item${total === 1 ? "" : "s"}</button>`);
      const go = document.getElementById("importGo");
      go.addEventListener("click", async () => {
        go.disabled = true;
        try {
          const res = await HP.store.importContent(data);
          HP.closeModal();
          HP.toast(res.skipped.length
            ? `Imported ${res.written} items — ${res.skipped.length} skipped (too large for one document).`
            : `Imported ${res.written} item${res.written === 1 ? "" : "s"}.`,
            res.skipped.length ? "warn" : "ok");
          if (res.skipped.length) console.warn("HapagPamana: import skipped —", res.skipped);
          renderAll();
        } catch (e) {
          console.error("HapagPamana: import failed —", e);
          HP.toast(e && e.message === "offline"
            ? "Connect Firebase to import content."
            : "Import failed partway — check your connection and re-import (merging by id makes it safe to retry).", "danger");
          go.disabled = false;
        }
      });
    };
    reader.readAsText(file);
  }

  function render() {
    const s = HP.store.DB.settings;
    const row = (key, title, desc) => `
      <div class="setting-row">
        <div class="meta"><strong>${title}</strong><small>${desc}</small></div>
        <label class="switch"><input type="checkbox" data-setting="${key}" ${s[key] ? "checked" : ""}><span class="track"></span></label>
      </div>`;
    HP.shell.paint(togglesEl, `
      ${row("ordering", "Enable ordering", "Show the Menu and Add-to-cart actions in the app.")}
      ${row("catering", "Enable catering", "Show the Catering screen and packages in the app.")}
      ${row("featuredOnHome", "Featured on Home", "Surface featured dishes in the Home carousel.")}
      ${row("maintenance", "Maintenance mode", "Show a “temporarily closed” notice to guests.")}`);
    regionalEl.innerHTML = `
      <div class="setting-row">
        <div class="meta"><strong>Currency symbol</strong><small>Used for all prices.</small></div>
        <input class="control control--xs" data-setting="currency" value="${HP.esc(s.currency)}" maxlength="3">
      </div>`;

    document.querySelectorAll("[data-setting]").forEach((el) => {
      const k = el.dataset.setting;
      if (el.type === "checkbox") {
        el.addEventListener("change", () => { HP.store.DB.settings[k] = el.checked; HP.store.persistSettings(); HP.toast("Setting saved."); });
      } else {
        el.addEventListener("change", () => { HP.store.DB.settings[k] = el.value || "₱"; HP.store.persistSettings(); HP.toast("Setting saved."); render(); });
      }
    });
  }

  /* ── Allergen taxonomy editor ─────────────────────────────────────────
     Each row edits one allergen in place: name, the short label used by
     tight heatmap cells, and the 0–1 risk weight that scales the heat
     (shown as a %). Changes persist to settings/allergens immediately —
     the customer app reads the same document. */

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

  // Hoisted (not a const arrow): renderAll can run synchronously from the
  // session cache at the top of this file, before consts down here would
  // have initialized.
  function pctOf(a) { return Math.round(a.severity * 100); }

  function renderAllergens() {
    const list = HP.ALLERGENS;
    if (!list.length) {
      HP.shell.paint(allergenEl, `<p class="allergen-none">No allergens yet — add one so dishes can be tagged.</p>`);
      return;
    }
    HP.shell.paint(allergenEl, list.map((a, i) => `
      <div class="setting-row allergen-edit" data-i="${i}">
        <span class="allergen-swatch" style="background:${HP.allergenHeat(a.severity)}" title="Heat at full prevalence"></span>
        <input class="control a-label" value="${HP.esc(a.label)}" maxlength="24" placeholder="Name" aria-label="Allergen name">
        <input class="control control--xs a-short" value="${HP.esc(a.short)}" maxlength="10" placeholder="Short" aria-label="Short label" title="Short label shown on tight heatmap cells">
        <label class="a-sev" title="Risk weight — how hot this allergen paints the heatmap">
          <input type="range" min="5" max="100" step="5" value="${pctOf(a)}" aria-label="Risk weight"><b>${pctOf(a)}%</b>
        </label>
        <button class="icon-btn a-del" title="Delete allergen" aria-label="Delete ${HP.esc(a.label)}"><span class="ic">${HP.icon("trash")}</span></button>
      </div>`).join(""));
    allergenEl.querySelectorAll(".allergen-edit").forEach(wireAllergenRow);
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
        `Remove “${a.label}” from the taxonomy? Dishes tagged with it simply stop showing it — nothing else is deleted.`,
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
        renderAllergens();
      });
  }

  function onReset() {
    // Honest copy: the seed holds ONLY the category taxonomy — there is no
    // sample content to "restore". This erases everything else, so it takes
    // a typed confirmation, not just a button press.
    HP.openModal("Erase all content", `
      <p class="modal-text">This permanently deletes <strong>every product, package,
        category and setup photo</strong> from the live database — the customer app
        goes empty too. Only the built-in category list is restored; there is no
        sample content. This cannot be undone.</p>
      <div class="field"><label>Type <strong>ERASE</strong> to confirm</label>
        <input class="control" id="resetConfirmText" autocomplete="off" placeholder="ERASE">
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-danger" id="resetGo" disabled>Erase everything</button>`);
    const input = document.getElementById("resetConfirmText");
    const go = document.getElementById("resetGo");
    input.addEventListener("input", () => {
      go.disabled = input.value.trim().toUpperCase() !== "ERASE";
    });
    go.addEventListener("click", () => {
      if (go.disabled) return;
      go.disabled = true;
      HP.store.resetData()
        .then(() => { HP.closeModal(); HP.toast("All content erased — category list restored.", "warn"); renderAll(); })
        .catch(() => { HP.toast("Couldn't reset the database.", "danger"); go.disabled = false; });
    });
  }
})();
