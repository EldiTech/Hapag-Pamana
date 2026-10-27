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
  const trashEl    = document.getElementById("trashRows");
  const importFile = document.getElementById("importFile");
  document.getElementById("resetData").addEventListener("click", onReset);
  document.getElementById("importData").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", onImportPicked);

  if (HP.store.DB) renderAll();
  else {
    togglesEl.innerHTML  = Array.from({ length: 4 }, () => `<div class="setting-row"><div class="skeleton sk-line"></div></div>`).join("");
  }
  HP.ready.then(renderAll);         // first paint — instant when the cache has a copy
  HP.onRefresh(renderAll);          // repaint when the background refetch lands

  function renderAll() { render(); renderTrash(); }

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
