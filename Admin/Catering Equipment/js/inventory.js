/* HapagPamana · Catering Equipment — Inventory.

   What this desk owns, in three pieces:

     1. Categories — a flat list of groupings (equipmentCategories),
        managed inline from the item form (no separate page — there's
        rarely more than a handful, unlike the menu's categories).
     2. Items — a name plus one or more variants (equipmentItems), each
        variant its own on-hand count and par level.
     3. Movements — every count change is a logged, reasoned entry
        (equipmentLog), never a silent edit. See equipment-common.js.

   Requires the catering_equipment (or admin/owner) role — see
   firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const K = window.HPEquip;

  HP.shell.init();
  HP.shell.setPage({
    title: "Inventory",
    sub: "Equipment on hand, by category and variant.",
    search: true,
    action: { label: "Add item", fn: () => openItem(null) },
  });

  const statsEl = document.getElementById("eqStats");
  const chipsEl = document.getElementById("eqChips");
  const rowsEl = document.getElementById("eqRows");
  const db = HP.ONLINE ? firebase.firestore() : null;

  let items = [];
  let categories = [];
  let query = "";
  let filter = "all";
  let loaded = false;
  const unsubs = [];

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("The inventory lives in Firestore — connect Firebase to use it.");
      return;
    }
    unsubs.push(db.collection("equipmentCategories").orderBy("name").onSnapshot((snap) => {
      categories = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      renderRows(); // item rows don't depend on categories, but modals do
    }, () => { /* categories still work without live sync; the modal re-reads on open */ }));

    unsubs.push(db.collection("equipmentItems").onSnapshot((snap) => {
      items = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      loaded = true;
      renderAll();
    }, (e) => {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(denied(e)
        ? "Access denied — publish the updated Firestore rules (the equipment collections), then reload."
        : "Couldn't reach Firestore — check your connection.");
      if (denied(e)) HP.toast("Database access denied — update your Firestore rules.", "danger");
    }));
  }
  const denied = (e) => e && (e.code === "permission-denied" ||
    /permission|insufficient/i.test((e && e.message) || ""));
  window.addEventListener("beforeunload", () => unsubs.forEach((u) => { try { u(); } catch (_) {} }));

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    const low = items.filter((i) => K.itemState(i) === "low").length;
    const out = items.filter((i) => K.itemState(i) === "out").length;
    const variantCount = items.reduce((sum, i) => sum + (Array.isArray(i.variants) ? i.variants.length : 0), 0);

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("shelf", items.length, "Equipment items") +
      stat("crate", variantCount, "Variants tracked") +
      stat("logbook", low, "Running low") +
      stat("close", out, "Out of stock"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      all: items.length,
      low: items.filter((i) => K.itemState(i) === "low").length,
      out: items.filter((i) => K.itemState(i) === "out").length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("all", "All items") + chip("low", "Running low") + chip("out", "Out of stock");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    return items.filter((it) => {
      if (filter !== "all" && K.itemState(it) !== filter) return false;
      if (!query) return true;
      return [it.name, it.categoryName, it.note, ...(it.variants || []).map((v) => v.label)]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function variantChips(it) {
    return (it.variants || []).map((v) => {
      const st = K.stateOf(v);
      return `<span class="badge ${K.STATE_BADGE[st]}" title="${HP.esc(K.STATE_LABEL[st])}">${HP.esc(v.label || "—")} · ${HP.esc(K.qtyText(v.qty, v.unit))}</span>`;
    }).join(" ") || `<span class="badge badge-cat">No variants yet</span>`;
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(items.length
        ? "No item matches — try another spelling or clear the filter."
        : "No equipment yet — press “Add item” to start the inventory.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((it) => {
      const st = K.itemState(it);
      return `
      <tr data-id="${HP.esc(it.id)}">
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(it.name || "Unnamed item")}</strong>
            <small>${HP.esc(it.note || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(it.categoryName || "—")}</td>
        <td><div class="eq-variant-chips">${variantChips(it)}</div></td>
        <td><span class="badge ${K.STATE_BADGE[st]}">${HP.esc(K.STATE_LABEL[st])}</span></td>
        <td>${HP.esc(K.fmtWhen({ at: it.updatedAt, atLocal: it.updatedAtLocal }))}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="move" title="Record a movement"
              aria-label="Record a movement for ${HP.esc(it.name || "item")}"><span class="ic">${HP.icon("logbook")}</span></button>
            <button class="icon-btn" data-act="edit" title="Edit this item"
              aria-label="Edit ${HP.esc(it.name || "item")}"><span class="ic">${HP.icon("pencil")}</span></button>
          </div>
        </td>
      </tr>`;
    }).join(""));
    HP.hydrateIcons(rowsEl);

    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const it = items.find((x) => x.id === e.currentTarget.closest("tr").dataset.id);
      if (!it) return;
      if (e.currentTarget.dataset.act === "edit") openItem(it);
      else openMove(it);
    }));
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const it = items.find((x) => x.id === tr.dataset.id);
        if (it) openHistory(it);
      }));
  }

  /* ── Add / edit an item ───────────────────────────────────────────────────
     A form with a category picker (plus an inline "new category" prompt)
     and a repeatable list of variant rows, including each variant's on-hand
     qty. Typing a different qty here is still a logged movement, not a
     silent edit — saveItem() below diffs against the live variant and
     writes a "correction" entry for anything that changed, same reason the
     Movement dialog offers for a recount. A BRAND NEW variant's opening
     count is written as an opening-balance movement instead (same rule the
     pantry's add form follows). */
  let draftVariants = [];
  function openItem(it) {
    const isNew = !it;
    it = it || { name: "", categoryId: "", categoryName: "", note: "", variants: [] };
    draftVariants = (it.variants || []).map((v) => Object.assign({}, v));
    if (isNew && !draftVariants.length) draftVariants.push({ id: K.uid(), label: "", unit: "pcs", qty: 0, par: "" });

    HP.openModal(isNew ? "Add equipment item" : `Item — ${String(it.name || "")}`, `
      <div class="eq-form">
        <div class="field">
          <label>Item name <span class="req">*</span></label>
          <input class="control" id="eqName" placeholder="e.g. Chafing dish"
            value="${HP.esc(String(it.name || ""))}" />
        </div>
        <div class="field">
          <label>Category <span class="req">*</span></label>
          <div class="eq-cat-row">
            <select class="control" id="eqCat"></select>
            <button type="button" class="btn btn-ghost btn-sm" id="eqNewCat"><span class="ic">${HP.icon("plus")}</span>New</button>
          </div>
        </div>
        <div class="field">
          <label>Note</label>
          <input class="control" id="eqNote" placeholder="e.g. kept in the equipment room"
            value="${HP.esc(String(it.note || ""))}" />
        </div>
        <div class="field">
          <label>Variants <span class="req">*</span></label>
          <p class="eq-hint">Each item can have more than one type — e.g. Round and Rectangular chafing dishes are two variants of the same item.</p>
          <div id="eqVariants" class="eq-variants"></div>
          <button type="button" class="btn btn-ghost btn-sm" id="eqAddVariant"><span class="ic">${HP.icon("plus")}</span>Add variant</button>
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="eqSave"><span class="ic">${HP.icon("check")}</span>${isNew ? "Add to inventory" : "Save item"}</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));

    fillCategorySelect(document.getElementById("eqCat"), it.categoryId);
    document.getElementById("eqNewCat").addEventListener("click", () => promptNewCategory());
    renderVariantRows(isNew);
    document.getElementById("eqAddVariant").addEventListener("click", () => {
      draftVariants.push({ id: K.uid(), label: "", unit: "pcs", qty: 0, par: "" });
      renderVariantRows(isNew);
    });
    document.getElementById("eqSave").addEventListener("click", () => saveItem(it, isNew));
  }

  function fillCategorySelect(sel, selectedId) {
    if (!sel) return;
    sel.innerHTML = [`<option value="">— choose a category —</option>`]
      .concat(categories.map((c) => `<option value="${HP.esc(c.id)}"${c.id === selectedId ? " selected" : ""}>${HP.esc(c.name)}</option>`))
      .join("");
  }

  function renderVariantRows(isNew) {
    const wrap = document.getElementById("eqVariants");
    if (!wrap) return;
    wrap.innerHTML = draftVariants.map((v, i) => `
      <div class="eq-variant-row" data-i="${i}">
        <input class="control" data-f="label" placeholder="Type / variant — e.g. Round" value="${HP.esc(v.label || "")}" />
        <select class="control" data-f="unit">${K.UNITS.map((u) => `<option value="${HP.esc(u)}"${u === v.unit ? " selected" : ""}>${HP.esc(u)}</option>`).join("")}</select>
        <input class="control" data-f="qty" type="number" min="0" step="1" placeholder="On hand" value="${v.qty === 0 || v.qty ? HP.esc(String(v.qty)) : ""}" ${isNew ? "" : "title=\"Changing this on save records a stock correction, same as Record a movement.\""} />
        <input class="control" data-f="par" type="number" min="0" step="1" placeholder="Par" value="${v.par === 0 || v.par ? HP.esc(String(v.par)) : ""}" />
        <button type="button" class="icon-btn danger" data-remove title="Remove variant" aria-label="Remove this variant"><span class="ic">${HP.icon("trash")}</span></button>
      </div>`).join("");
    HP.hydrateIcons(wrap);
    wrap.querySelectorAll(".eq-variant-row").forEach((row) => {
      const i = Number(row.dataset.i);
      row.querySelectorAll("[data-f]").forEach((input) => {
        input.addEventListener("input", () => {
          const field = input.dataset.f;
          draftVariants[i][field] = field === "qty" || field === "par" ? input.value : input.value;
        });
      });
      row.querySelector("[data-remove]").addEventListener("click", () => {
        draftVariants.splice(i, 1);
        renderVariantRows(isNew);
      });
    });
  }

  function promptNewCategory() {
    HP.openModal("New category", `
      <form id="catForm" novalidate>
        <div class="field"><label>Name <span class="req">*</span></label>
          <input class="control" name="name" placeholder="e.g. Chafing Dishes" required>
          <div class="field-error" data-err="name" hidden></div></div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="saveNewCat">Add category</button>`);
    document.getElementById("saveNewCat").addEventListener("click", async () => {
      const f = document.getElementById("catForm");
      const name = f.elements.name.value.trim();
      if (!HP.setErr(f, "name", name ? "" : "Name is required.")) return;
      if (categories.some((c) => String(c.name || "").toLowerCase() === name.toLowerCase()))
        return HP.setErr(f, "name", "That category already exists.");
      const btn = document.getElementById("saveNewCat");
      btn.disabled = true;
      try {
        const ref = await db.collection("equipmentCategories").add({
          name, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        categories.push({ id: ref.id, name });
        categories.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        HP.closeModal();
        HP.toast(`“${name}” added.`);
        // Re-open the item form's category select with the new one picked —
        // the item modal is still underneath, its own listeners intact.
        const sel = document.getElementById("eqCat");
        if (sel) { fillCategorySelect(sel, ref.id); }
      } catch (e) {
        console.error(e);
        btn.disabled = false;
        HP.toast(denied(e) ? "Your role can't add categories." : "Couldn't save — check your connection.", "danger");
      }
    });
  }

  let busy = false;
  async function saveItem(it, isNew) {
    if (busy) return;
    const name = document.getElementById("eqName").value.trim();
    const catSel = document.getElementById("eqCat");
    const categoryId = catSel.value;
    const category = categories.find((c) => c.id === categoryId);
    if (!name) return HP.toast("Give the item a name first.", "danger");
    if (!categoryId || !category) return HP.toast("Pick a category first.", "danger");

    const cleanVariants = draftVariants
      .map((v) => ({
        id: v.id || K.uid(),
        label: String(v.label || "").trim(),
        unit: v.unit || "pcs",
        qty: K.round3(Math.max(0, K.num(v.qty) || 0)),
        par: K.num(v.par) !== null && K.num(v.par) >= 0 ? K.round3(K.num(v.par)) : null,
      }))
      .filter((v) => v.label);
    if (!cleanVariants.length) return HP.toast("Add at least one variant with a label.", "danger");
    const labels = cleanVariants.map((v) => v.label.toLowerCase());
    if (new Set(labels).size !== labels.length) return HP.toast("Variant labels must be unique on this item.", "danger");

    const fields = {
      name, categoryId, categoryName: category.name,
      note: document.getElementById("eqNote").value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtLocal: Date.now(),
      updatedByName: HP.user.name || "—",
    };

    busy = true;
    const btn = document.getElementById("eqSave");
    if (btn) btn.disabled = true;
    try {
      if (isNew) {
        const ref = db.collection("equipmentItems").doc();
        const batch = db.batch();
        batch.set(ref, Object.assign({}, fields, { variants: cleanVariants }));
        cleanVariants.forEach((v) => {
          if (v.qty > 0) {
            batch.set(db.collection("equipmentLog").doc(), K.logEntry({
              itemId: ref.id, itemName: name, variantId: v.id, variantLabel: v.label, unit: v.unit,
              delta: v.qty, before: 0, after: v.qty,
              reason: "opening", note: "Variant added to the inventory",
            }));
          }
        });
        await batch.commit();
        HP.toast(`“${name}” is in the inventory.`, "ok");
      } else {
        // Brand-new rows added during this edit get an opening-balance
        // movement, same as the create path. An EXISTING variant whose qty
        // was typed differently here gets a "correction" entry instead —
        // the field is editable, but nothing changes the shelf count
        // without the ledger explaining it.
        const prevById = new Map((it.variants || []).map((v) => [v.id, v]));
        const batch = db.batch();
        batch.set(db.collection("equipmentItems").doc(it.id), Object.assign({}, fields, { variants: cleanVariants }), { merge: true });
        cleanVariants.forEach((v) => {
          const prev = prevById.get(v.id);
          if (!prev) {
            if (v.qty > 0) {
              batch.set(db.collection("equipmentLog").doc(), K.logEntry({
                itemId: it.id, itemName: name, variantId: v.id, variantLabel: v.label, unit: v.unit,
                delta: v.qty, before: 0, after: v.qty,
                reason: "opening", note: "Variant added to the inventory",
              }));
            }
          } else if (K.round3(prev.qty) !== v.qty) {
            batch.set(db.collection("equipmentLog").doc(), K.logEntry({
              itemId: it.id, itemName: name, variantId: v.id, variantLabel: v.label, unit: v.unit,
              delta: K.round3(v.qty - prev.qty), before: K.round3(prev.qty), after: v.qty,
              reason: "correction", note: "Edited from the item form.",
            }));
          }
        });
        await batch.commit();
        HP.toast("Item saved.", "ok");
      }
      HP.closeModal();
    } catch (e) {
      console.error(e);
      HP.toast(denied(e) ? "Your role can't write to the inventory." : "Couldn't save — check your connection.", "danger");
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── Record a movement ────────────────────────────────────────────────── */
  function openMove(it) {
    const variants = it.variants || [];
    if (!variants.length) return HP.toast("This item has no variants yet — edit it to add one.", "warn");
    const vOpts = variants.map((v) => `<option value="${HP.esc(v.id)}">${HP.esc(v.label)} — ${HP.esc(K.qtyText(v.qty, v.unit))}</option>`).join("");
    const reasonOpts = Object.keys(K.REASONS)
      .filter((k) => k !== "opening")
      .map((k) => `<option value="${HP.esc(k)}">${HP.esc(K.REASONS[k].label)}</option>`).join("");

    HP.openModal(`Movement — ${String(it.name || "")}`, `
      <div class="eq-form">
        <div class="eq-grid">
          <div class="field">
            <label>Variant <span class="req">*</span></label>
            <select class="control" id="mvVariant">${vOpts}</select>
          </div>
          <div class="field">
            <label>Reason <span class="req">*</span></label>
            <select class="control" id="mvReason">${reasonOpts}</select>
          </div>
        </div>
        <p class="eq-onhand" id="mvOnHand"></p>
        <div class="field">
          <label id="mvQtyLabel">Quantity <span class="req">*</span></label>
          <input class="control" id="mvQty" type="number" min="0" step="1" placeholder="0" />
        </div>
        <p class="eq-hint" id="mvHint"></p>
        <div class="field">
          <label>Note</label>
          <input class="control" id="mvNote" placeholder="e.g. two round chafing dishes cracked in transit" />
        </div>
        <p class="eq-preview" id="mvPreview"></p>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="mvSave"><span class="ic">${HP.icon("check")}</span>Record movement</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));

    const variantEl = document.getElementById("mvVariant");
    const reasonEl = document.getElementById("mvReason");
    const qtyEl = document.getElementById("mvQty");
    const label = document.getElementById("mvQtyLabel");
    const hint = document.getElementById("mvHint");
    const onHand = document.getElementById("mvOnHand");
    const preview = document.getElementById("mvPreview");

    function currentVariant() { return variants.find((v) => v.id === variantEl.value) || variants[0]; }

    function refresh() {
      const v = currentVariant();
      const r = reasonEl.value;
      const spec = K.REASONS[r] || {};
      const correction = r === "correction";
      onHand.innerHTML = `On hand <strong>${HP.esc(K.qtyText(v.qty, v.unit))}</strong>`;
      label.innerHTML = correction ? `Counted on hand <span class="req">*</span>` : `Quantity <span class="req">*</span>`;
      hint.textContent = spec.hint || "";
      const val = K.num(qtyEl.value);
      if (val === null || val < 0) { preview.textContent = ""; return; }
      const before = K.round3(v.qty);
      const after = correction ? K.round3(val) : K.round3(before + spec.sign * val);
      const delta = K.round3(after - before);
      preview.innerHTML = after < 0
        ? `<span class="is-over">That would take this variant below zero — ${HP.esc(K.qtyText(before, v.unit))} on hand.</span>`
        : `${HP.esc(K.qtyText(before, v.unit))} → <strong>${HP.esc(K.qtyText(after, v.unit))}</strong>
           <span class="eq-delta">(${HP.esc(K.signedQty(delta, v.unit))})</span>`;
    }
    variantEl.addEventListener("change", refresh);
    reasonEl.addEventListener("change", refresh);
    qtyEl.addEventListener("input", refresh);
    refresh();

    document.getElementById("mvSave").addEventListener("click", () =>
      saveMove(it, currentVariant(), reasonEl.value, K.num(qtyEl.value), document.getElementById("mvNote").value.trim()));
  }

  async function saveMove(it, variant, reason, value, note) {
    if (busy) return;
    if (value === null || value < 0) return HP.toast("Enter a quantity first.", "danger");
    const spec = K.REASONS[reason] || {};
    const correction = reason === "correction";
    if (correction && !note) return HP.toast("A correction needs a reason — say what the recount found.", "danger");

    busy = true;
    const btn = document.getElementById("mvSave");
    if (btn) btn.disabled = true;
    try {
      const ref = db.collection("equipmentItems").doc(it.id);
      const logRef = db.collection("equipmentLog").doc();
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const data = snap.data() || {};
        const list = Array.isArray(data.variants) ? data.variants.map((v) => Object.assign({}, v)) : [];
        const idx = list.findIndex((v) => v.id === variant.id);
        if (idx === -1) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const before = K.round3(list[idx].qty);
        const after = correction ? K.round3(value) : K.round3(before + (spec.sign || 0) * value);
        if (after < 0) throw Object.assign(new Error("negative"), { code: "hp/negative" });
        list[idx] = Object.assign({}, list[idx], { qty: after });
        tx.update(ref, {
          variants: list,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAtLocal: Date.now(),
          updatedByName: HP.user.name || "—",
        });
        tx.set(logRef, K.logEntry({
          itemId: it.id, itemName: it.name, variantId: variant.id, variantLabel: variant.label, unit: variant.unit,
          delta: K.round3(after - before), before, after, reason, note,
        }));
      });
      HP.closeModal();
      HP.toast("Movement recorded.", "ok");
    } catch (e) {
      if (e && e.code === "hp/negative") HP.toast("That would take this variant below zero.", "danger");
      else if (e && e.code === "hp/gone") HP.toast("That item or variant was removed by someone else.", "warn");
      else {
        console.error(e);
        HP.toast(denied(e) ? "Your role can't write to the inventory." : "Couldn't record it — check your connection.", "danger");
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── One item's history ───────────────────────────────────────────────── */
  async function openHistory(it) {
    HP.openModal(`History — ${String(it.name || "")}`, `
      <div id="eqHist"><p class="empty">Reading the ledger…</p></div>`,
      `<button class="btn btn-ghost" data-close>Close</button>`);
    const box = document.getElementById("eqHist");
    try {
      const snap = await db.collection("equipmentLog").where("itemId", "==", it.id).limit(200).get();
      const rows = snap.docs.map((d) => d.data()).sort((a, b) => K.entryTime(b) - K.entryTime(a));
      if (document.getElementById("eqHist") !== box) return;
      box.innerHTML = rows.length ? `<ul class="eq-log">${rows.map(logLI).join("")}</ul>`
        : `<p class="empty">No movement recorded yet.</p>`;
    } catch (e) {
      if (document.getElementById("eqHist") !== box) return;
      box.innerHTML = `<p class="empty">${HP.esc(denied(e)
        ? "Your role can't read the equipment ledger."
        : "Couldn't read the ledger — check your connection.")}</p>`;
    }
  }

  function logLI(e) {
    const up = Number(e.delta) > 0;
    return `<li class="eq-log-row">
      <span class="eq-log-delta ${up ? "is-up" : "is-down"}">${HP.esc(K.signedQty(e.delta, e.unit))}</span>
      <span class="eq-log-main">
        <strong>${HP.esc(K.reasonLabel(e.reason))}</strong>
        <small>${HP.esc(e.variantLabel || "—")}</small>
        ${e.note ? `<small>${HP.esc(e.note)}</small>` : ""}
      </span>
      <span class="eq-log-meta">
        <small>${HP.esc(K.fmtWhen(e))}</small>
        <small>${HP.esc(e.byName || "—")}</small>
        <small>${HP.esc(K.qtyText(e.before, e.unit))} → ${HP.esc(K.qtyText(e.after, e.unit))}</small>
      </span>
    </li>`;
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["Item", "Category", "Variant", "Unit", "On hand", "Par", "State", "Note", "Last updated", "By"];
    const lines = [head.map(cell).join(",")];
    list.forEach((it) => {
      const variants = it.variants && it.variants.length ? it.variants : [{ label: "—", unit: "", qty: "", par: "" }];
      variants.forEach((v) => lines.push([
        it.name, it.categoryName || "", v.label || "", v.unit || "",
        v.qty === 0 || v.qty ? K.round3(v.qty) : "", v.par === 0 || v.par ? v.par : "",
        K.STATE_LABEL[K.stateOf(v)] || "", it.note || "",
        K.fmtWhen({ at: it.updatedAt, atLocal: it.updatedAtLocal }), it.updatedByName || "",
      ].map(cell).join(",")));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_equipment_inventory.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Inventory exported as CSV.");
  }
})();
