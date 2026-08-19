/* HapagPamana · Stock Clerk — the Pantry.

   The shelf itself: what is stored, how much is left, and what the kitchen is
   about to take. Three things happen on this page:

     1. Items are added and described (name, unit, section, par level).
     2. Stock moves — received, issued, returned, wasted, corrected — and
        EVERY movement writes a pantryLog entry in the same transaction that
        changes the count. A shelf number that can move without a trace is a
        number nobody can defend at inventory time.
     3. An order's plan is opened, its ingredients lined up against the shelf,
        and issued to the kitchen in one go.

   The issue screen is deliberately a REVIEW, not an automatic deduction: the
   clerk sees the order, the dishes, what each line needs and what would be
   left, and decides. Stock leaves a real shelf because a person carried it
   out; the software records that, it doesn't pretend to observe it.

   Requires the stock_clerk (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const K = window.HPPantry;

  HP.shell.init();
  HP.shell.setPage({
    title: "Pantry",
    sub: "What is on the shelf — and what the kitchen is about to take.",
    search: true,
    action: { label: "Add item", fn: () => openItem(null) },
  });

  const statsEl = document.getElementById("pantryStats");
  const chipsEl = document.getElementById("pantryChips");
  const rowsEl = document.getElementById("pantryRows");
  const db = HP.ONLINE ? firebase.firestore() : null;

  let items = [];
  let plans = [];        // prepPlans — the orders whose ingredients can be issued
  let query = "";
  let filter = "all";
  let loaded = false;
  const unsubs = [];

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(7, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("The pantry lives in Firestore — connect Firebase to use it.");
      return;
    }
    unsubs.push(db.collection("pantry").onSnapshot((snap) => {
      items = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      items.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      loaded = true;
      renderAll();
    }, (e) => {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(denied(e)
        ? "Access denied — publish the updated Firestore rules (the pantry collection), then reload."
        : "Couldn't reach Firestore — check your connection.");
      if (denied(e)) HP.toast("Database access denied — update your Firestore rules.", "danger");
    }));

    // The kitchen's plans, so an order can be issued against the shelf. Read
    // -only here: this desk never edits what the chef planned.
    unsubs.push(db.collection("prepPlans").onSnapshot((snap) => {
      plans = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      renderStats();
    }, () => { /* the pantry still works without the plans */ }));
  }
  const denied = (e) => e && (e.code === "permission-denied" ||
    /permission|insufficient/i.test((e && e.message) || ""));
  window.addEventListener("beforeunload", () => unsubs.forEach((u) => { try { u(); } catch (_) {} }));

  function emptyRow(msg) {
    return `<tr><td colspan="7" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    const low = items.filter((i) => K.stateOf(i) === "low").length;
    const out = items.filter((i) => K.stateOf(i) === "out").length;
    // Plans still worth issuing against — an order already fully issued is
    // no longer waiting on this desk.
    const waiting = plans.filter((p) => !p.issuedAt &&
      Array.isArray(p.items) && p.items.length).length;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("shelf", items.length, "Items on the shelf") +
      stat("scales", low, "Running low") +
      stat("crates", out, "Out of stock") +
      stat("logbook", waiting, "Orders awaiting issue"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      all: items.length,
      low: items.filter((i) => K.stateOf(i) === "low").length,
      out: items.filter((i) => K.stateOf(i) === "out").length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML =
      chip("all", "All items") + chip("low", "Running low") + chip("out", "Out of stock") +
      `<button class="btn btn-primary seg-cta" id="issueBtn"><span class="ic">${HP.icon("crates")}</span>Issue to kitchen</button>`;
    HP.hydrateIcons(chipsEl);
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
    const issue = document.getElementById("issueBtn");
    if (issue) issue.addEventListener("click", openOrderPicker);
  }

  function visible() {
    return items.filter((it) => {
      if (filter !== "all" && K.stateOf(it) !== filter) return false;
      if (!query) return true;
      return [it.name, it.category, it.note].join(" ").toLowerCase().includes(query);
    });
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(items.length
        ? "No item matches — try another spelling or clear the filter."
        : "The pantry is empty — press “Add item” to put the first thing on the shelf.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((it) => {
      const st = K.stateOf(it);
      return `
      <tr data-id="${HP.esc(it.id)}">
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(it.name || "Unnamed item")}</strong>
            <small>${HP.esc(it.note || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(it.category || "—")}</td>
        <td><strong>${HP.esc(K.qtyText(it.qty, it.unit))}</strong></td>
        <td>${HP.esc(it.par ? K.qtyText(it.par, it.unit) : "—")}</td>
        <td><span class="badge ${K.STATE_BADGE[st]}">${HP.esc(K.STATE_LABEL[st])}</span></td>
        <td>${HP.esc(K.fmtWhen({ at: it.updatedAt, atLocal: it.updatedAtLocal }))}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="move" title="Record a movement"
              aria-label="Record a movement for ${HP.esc(it.name || "item")}"><span class="ic">${HP.icon("scales")}</span></button>
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
     Editing describes the item; it never sets the count. The only way qty
     moves is a movement, so an edit cannot quietly rewrite history — a new
     item's starting count is itself written as an "opening balance" entry. */
  function openItem(it) {
    const isNew = !it;
    it = it || { name: "", unit: "kg", category: "", par: "", note: "", qty: 0 };
    // A section outside the known list (or none yet) opens on "Other" with
    // its own text box, so a clerk can name a section this list doesn't have
    // instead of being stuck with the closest guess.
    const catKnown = it.category && K.CATEGORIES.includes(it.category);
    const unitOpts = K.UNITS.map((u) =>
      `<option value="${HP.esc(u)}"${u === it.unit ? " selected" : ""}>${HP.esc(u)}</option>`).join("");
    const catOpts = [`<option value="">— section —</option>`]
      .concat(K.CATEGORIES.map((c) =>
        `<option value="${HP.esc(c)}"${c === it.category ? " selected" : ""}>${HP.esc(c)}</option>`))
      .concat([`<option value="__other__"${it.category && !catKnown ? " selected" : ""}>Other…</option>`])
      .join("");

    HP.openModal(isNew ? "Add a pantry item" : `Item — ${String(it.name || "")}`, `
      <div class="pn-form">
        <div class="field">
          <label>Item name <span class="req">*</span></label>
          <input class="control" id="pnName" placeholder="Exactly as the recipes write it — e.g. ground pork"
            value="${HP.esc(String(it.name || ""))}" />
          <p class="pn-hint">Match the recipe's spelling and unit — that is how an order's
            ingredients line up with this shelf.</p>
        </div>
        <div class="pn-grid">
          <div class="field">
            <label>Unit <span class="req">*</span></label>
            <select class="control" id="pnUnit">${unitOpts}</select>
          </div>
          <div class="field">
            <label>Section</label>
            <select class="control" id="pnCat">${catOpts}</select>
          </div>
        </div>
        <div class="field" id="pnCatOtherField" ${it.category && !catKnown ? "" : "hidden"}>
          <label>Section name</label>
          <input class="control" id="pnCatOther" placeholder="e.g. Bakery"
            value="${HP.esc(it.category && !catKnown ? String(it.category) : "")}" />
        </div>
        <div class="field">
          <label>Reorder below</label>
          <input class="control" id="pnPar" type="number" min="0" step="any"
            placeholder="e.g. 2" value="${HP.esc(it.par === 0 || it.par ? String(it.par) : "")}" />
          <p class="pn-hint">Once the shelf count drops to or below this, the item shows as
            “Running low.” Leave blank if you don't track a reorder point for it yet.</p>
        </div>
        <div class="field">
          <label>Note</label>
          <input class="control" id="pnNote" placeholder="e.g. kept in the chest freezer"
            value="${HP.esc(String(it.note || ""))}" />
        </div>
        ${isNew ? "" : `<p class="pn-hint">On hand is <strong>${HP.esc(K.qtyText(it.qty, it.unit))}</strong> —
          use “Record a movement” to change it, so the ledger keeps its trail.</p>`}
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="pnSave"><span class="ic">${HP.icon("check")}</span>${isNew ? "Add to the pantry" : "Save item"}</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));
    document.getElementById("pnCat").addEventListener("change", (e) => {
      document.getElementById("pnCatOtherField").hidden = e.currentTarget.value !== "__other__";
    });
    document.getElementById("pnSave").addEventListener("click", () => saveItem(it, isNew));
  }

  let busy = false;
  async function saveItem(it, isNew) {
    if (busy) return;
    const name = document.getElementById("pnName").value.trim();
    const unit = document.getElementById("pnUnit").value;
    if (!name) return HP.toast("Give the item a name first.", "danger");

    // Name+unit is the key recipes match on, so a duplicate would split one
    // real shelf across two rows that each look complete.
    const clash = items.find((x) =>
      K.itemKey(x.name, x.unit) === K.itemKey(name, unit) && x.id !== it.id);
    if (clash) return HP.toast(`“${name}” (${unit}) is already on the shelf.`, "danger");

    const par = K.num(document.getElementById("pnPar").value);
    const catSel = document.getElementById("pnCat").value;
    const category = catSel === "__other__"
      ? document.getElementById("pnCatOther").value.trim()
      : catSel;
    const fields = {
      name, unit,
      category,
      par: par !== null && par >= 0 ? K.round3(par) : null,
      note: document.getElementById("pnNote").value.trim(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAtLocal: Date.now(),
      updatedByName: HP.user.name || "—",
    };

    busy = true;
    const btn = document.getElementById("pnSave");
    if (btn) btn.disabled = true;
    try {
      if (isNew) {
        // No opening-count field on the add form — a brand-new item starts
        // at zero and is stocked for real through "Record a movement" (a
        // "received" entry), same as every later delivery. That keeps every
        // count on the shelf backed by an actual movement someone chose,
        // rather than a number typed once on the way in.
        const opening = 0;
        const ref = db.collection("pantry").doc();
        const batch = db.batch();
        batch.set(ref, { ...fields, qty: opening });
        // Even the first count is a movement — the ledger has no gap at the
        // top, so a shelf audit can start from zero and add up to today.
        batch.set(db.collection("pantryLog").doc(), K.logEntry({
          itemId: ref.id, itemName: name, unit,
          delta: opening, before: 0, after: opening,
          reason: "opening", note: "Item added to the pantry",
        }));
        await batch.commit();
        HP.toast(`“${name}” is on the shelf.`, "ok");
      } else {
        await db.collection("pantry").doc(it.id).set(fields, { merge: true });
        HP.toast("Item saved.", "ok");
      }
      HP.closeModal();
    } catch (e) {
      console.error(e);
      HP.toast(denied(e) ? "Your role can't write to the pantry." : "Couldn't save — check your connection.", "danger");
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── Record a movement ────────────────────────────────────────────────────
     One dialog for every reason. "Stock correction" is the odd one: the clerk
     types the COUNTED figure rather than a difference, because that is what a
     recount actually produces — the delta is derived from it. */
  function openMove(it) {
    const opts = Object.keys(K.REASONS)
      .filter((k) => k !== "opening") // only ever written once, by the add form
      .map((k) => `<option value="${HP.esc(k)}">${HP.esc(K.REASONS[k].label)}</option>`).join("");

    HP.openModal(`Movement — ${String(it.name || "")}`, `
      <div class="pn-form">
        <p class="pn-onhand">On hand <strong>${HP.esc(K.qtyText(it.qty, it.unit))}</strong></p>
        <div class="pn-grid">
          <div class="field">
            <label>Reason <span class="req">*</span></label>
            <select class="control" id="mvReason">${opts}</select>
          </div>
          <div class="field">
            <label id="mvQtyLabel">Quantity <span class="req">*</span></label>
            <input class="control" id="mvQty" type="number" min="0" step="any" placeholder="0" />
          </div>
        </div>
        <p class="pn-hint" id="mvHint"></p>
        <div class="field">
          <label>Note</label>
          <input class="control" id="mvNote" placeholder="e.g. recount after the Saturday event" />
        </div>
        <p class="pn-preview" id="mvPreview"></p>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="mvSave"><span class="ic">${HP.icon("check")}</span>Record movement</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));

    const reasonEl = document.getElementById("mvReason");
    const qtyEl = document.getElementById("mvQty");
    const label = document.getElementById("mvQtyLabel");
    const hint = document.getElementById("mvHint");
    const preview = document.getElementById("mvPreview");

    function refresh() {
      const r = reasonEl.value;
      const spec = K.REASONS[r] || {};
      const correction = r === "correction";
      label.innerHTML = correction
        ? `Counted on the shelf <span class="req">*</span>`
        : `Quantity <span class="req">*</span>`;
      hint.textContent = spec.hint || "";
      const v = K.num(qtyEl.value);
      if (v === null || v < 0) { preview.textContent = ""; return; }
      const before = K.round3(it.qty);
      const after = correction ? K.round3(v) : K.round3(before + spec.sign * v);
      const delta = K.round3(after - before);
      preview.innerHTML = after < 0
        ? `<span class="is-over">That would take the shelf below zero — ${HP.esc(K.qtyText(before, it.unit))} on hand.</span>`
        : `${HP.esc(K.qtyText(before, it.unit))} → <strong>${HP.esc(K.qtyText(after, it.unit))}</strong>
           <span class="pn-delta">(${HP.esc(K.signedQty(delta, it.unit))})</span>`;
    }
    reasonEl.addEventListener("change", refresh);
    qtyEl.addEventListener("input", refresh);
    refresh();

    document.getElementById("mvSave").addEventListener("click", () =>
      saveMove(it, reasonEl.value, K.num(qtyEl.value), document.getElementById("mvNote").value.trim()));
  }

  async function saveMove(it, reason, value, note) {
    if (busy) return;
    if (value === null || value < 0) return HP.toast("Enter a quantity first.", "danger");
    const spec = K.REASONS[reason] || {};
    const correction = reason === "correction";
    if (correction && !note) return HP.toast("A correction needs a reason — say what the recount found.", "danger");

    busy = true;
    const btn = document.getElementById("mvSave");
    if (btn) btn.disabled = true;
    try {
      const ref = db.collection("pantry").doc(it.id);
      const logRef = db.collection("pantryLog").doc();
      // A transaction, not a read-then-write: two clerks moving the same item
      // at once must not both compute `after` from the same stale `before`.
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const before = K.round3((snap.data() || {}).qty);
        const after = correction ? K.round3(value) : K.round3(before + (spec.sign || 0) * value);
        if (after < 0) throw Object.assign(new Error("negative"), { code: "hp/negative" });
        tx.update(ref, {
          qty: after,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAtLocal: Date.now(),
          updatedByName: HP.user.name || "—",
        });
        tx.set(logRef, K.logEntry({
          itemId: it.id, itemName: it.name, unit: it.unit,
          delta: K.round3(after - before), before, after, reason, note,
        }));
      });
      HP.closeModal();
      HP.toast("Movement recorded.", "ok");
    } catch (e) {
      if (e && e.code === "hp/negative") HP.toast("That would take the shelf below zero.", "danger");
      else if (e && e.code === "hp/gone") HP.toast("That item was removed by someone else.", "warn");
      else {
        console.error(e);
        HP.toast(denied(e) ? "Your role can't write to the pantry." : "Couldn't record it — check your connection.", "danger");
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── One item's history ─────────────────────────────────────────────────── */
  async function openHistory(it) {
    HP.openModal(`History — ${String(it.name || "")}`, `
      <p class="pn-onhand">On hand <strong>${HP.esc(K.qtyText(it.qty, it.unit))}</strong></p>
      <div id="pnHist"><p class="empty">Reading the ledger…</p></div>`,
      `<button class="btn btn-ghost" data-close>Close</button>`);
    const box = document.getElementById("pnHist");
    try {
      // No orderBy: that would need a composite index on (itemId, at). The
      // slice is small, so it is sorted here instead.
      const snap = await db.collection("pantryLog").where("itemId", "==", it.id).limit(200).get();
      const rows = snap.docs.map((d) => d.data()).sort((a, b) => K.entryTime(b) - K.entryTime(a));
      if (document.getElementById("pnHist") !== box) return; // modal moved on
      box.innerHTML = rows.length ? `<ul class="pn-log">${rows.map(logLI).join("")}</ul>`
        : `<p class="empty">No movement recorded yet.</p>`;
    } catch (e) {
      if (document.getElementById("pnHist") !== box) return;
      box.innerHTML = `<p class="empty">${HP.esc(denied(e)
        ? "Your role can't read the pantry ledger."
        : "Couldn't read the ledger — check your connection.")}</p>`;
    }
  }

  function logLI(e) {
    const up = Number(e.delta) > 0;
    return `<li class="pn-log-row">
      <span class="pn-log-delta ${up ? "is-up" : "is-down"}">${HP.esc(K.signedQty(e.delta, e.unit))}</span>
      <span class="pn-log-main">
        <strong>${HP.esc(K.reasonLabel(e.reason))}</strong>
        ${e.clientName ? `<small>${HP.esc(e.clientName)}</small>` : ""}
        ${e.note ? `<small>${HP.esc(e.note)}</small>` : ""}
      </span>
      <span class="pn-log-meta">
        <small>${HP.esc(K.fmtWhen(e))}</small>
        <small>${HP.esc(e.byName || "—")}</small>
        <small>${HP.esc(K.qtyText(e.before, e.unit))} → ${HP.esc(K.qtyText(e.after, e.unit))}</small>
      </span>
    </li>`;
  }

  /* ── Issue an order's ingredients to the kitchen ──────────────────────────
     The clerk picks the order, sees its dishes and every ingredient the plan
     calls for, checks the lines against the shelf, and issues. Nothing is
     deducted until they press the button. */
  function openOrderPicker() {
    const live = plans.filter((p) => Array.isArray(p.items) && p.items.length)
      .sort((a, b) => String(a.functionDate || "").localeCompare(String(b.functionDate || "")));
    HP.openModal("Issue to kitchen — pick an order", `
      <div>
        <div class="ord-pick-list">
          ${live.length ? live.map((p) => `
            <button type="button" class="ord-pick-row" data-plan="${HP.esc(p.id)}">
              <span class="ord-thumb">${HP.esc((String(p.clientName || "?").charAt(0) || "·").toUpperCase())}</span>
              <span class="ord-pick-txt">
                <strong>${HP.esc(p.clientName || "Unnamed order")}</strong>
                <small>${HP.esc([p.functionDate, p.pax ? `${p.pax} pax` : "",
                  `${p.items.length} line${p.items.length === 1 ? "" : "s"}`]
                  .filter(Boolean).join(" · "))}</small>
              </span>
              ${p.issuedAt ? `<span class="badge badge-ok">Issued</span>`
                : `<span class="badge badge-cat">Not issued</span>`}
            </button>`).join("")
            : `<p class="ord-pick-empty">No kitchen plan yet — the Master Chef writes these on the Prep Board.</p>`}
        </div>
        <p class="pn-hint">Pick an order to see what its dishes need and what the shelf can cover.</p>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>`);
    document.querySelectorAll("[data-plan]").forEach((b) =>
      b.addEventListener("click", () => {
        const p = plans.find((x) => x.id === b.dataset.plan);
        if (p) openIssue(p);
      }));
  }

  function openIssue(plan) {
    const rows = K.requirementRows(plan.items, items);
    const blocked = rows.filter((r) => r.missing || r.insufficient);
    const dishes = [...new Set((plan.items || []).map((i) => String(i.dish || "").trim()).filter(Boolean))];

    HP.openModal(`Issue to kitchen — ${String(plan.clientName || "order")}`, `
      <div class="pn-issue">
        <div class="rc-head">
          <p class="rc-client"><strong>${HP.esc(plan.clientName || "—")}</strong>
            ${plan.functionDate ? ` · ${HP.esc(plan.functionDate)}` : ""}
            ${plan.pax ? ` · ${HP.esc(String(plan.pax))} pax` : ""}</p>
          ${dishes.length ? `<p class="pn-dishes">${dishes.map((d) =>
            `<span class="badge badge-cat">${HP.esc(d)}</span>`).join(" ")}</p>` : ""}
        </div>

        ${plan.issuedAt ? `<p class="ck-note">This order was already issued on
          ${HP.esc(K.fmtWhen({ at: plan.issuedAt, atLocal: plan.issuedAtLocal }))}.
          Issuing again will deduct the same amounts a second time.</p>` : ""}

        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Ingredient</th><th>Needed</th><th>On hand</th><th>After</th><th></th></tr></thead>
            <tbody>${rows.map(issueRow).join("") ||
              `<tr><td colspan="5" class="table-empty">This plan has no ingredient lines.</td></tr>`}</tbody>
          </table>
        </div>

        ${blocked.length ? `<p class="ck-note">${HP.esc(
          `${blocked.length} line${blocked.length === 1 ? "" : "s"} can't be covered by the shelf — ` +
          `issue what you can, or add the missing stock first. Only the ticked lines move.`)}</p>` : ""}

        <div class="field">
          <label>Note</label>
          <input class="control" id="isNote" placeholder="e.g. handed to Chef Ana, 6am" />
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="isSave"><span class="ic">${HP.icon("check")}</span>Issue ticked lines</button>`);
    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);
    document.getElementById("isSave").addEventListener("click", () => issue(plan, rows));
  }

  function issueRow(r) {
    const cover = r.missing
      ? `<span class="badge badge-warn">Not on the shelf</span>`
      : r.insufficient
        ? `<span class="badge badge-gold">Short ${HP.esc(K.qtyText(r.short, r.unit))}</span>`
        : `<span class="badge badge-ok">Covered</span>`;
    // Only fully covered lines are tickable — a partial issue would silently
    // hand over less than the dish needs without saying so.
    const can = !r.missing && !r.insufficient;
    return `<tr>
      <td>
        <div class="cell-name"><div>
          <strong>${HP.esc(r.name)}</strong>
          <small>${HP.esc(r.dishes.join(" · ") || "—")}</small>
        </div></div>
      </td>
      <td>${HP.esc(K.qtyText(r.qty, r.unit))}</td>
      <td>${HP.esc(r.have === null ? "—" : K.qtyText(r.have, r.unit))}</td>
      <td>${HP.esc(r.after === null || r.after < 0 ? "—" : K.qtyText(r.after, r.unit))}</td>
      <td>
        ${cover}
        <input type="checkbox" class="is-pick" data-key="${HP.esc(K.itemKey(r.name, r.unit))}"
          ${can ? "checked" : "disabled"} aria-label="Issue ${HP.esc(r.name)}" />
      </td>
    </tr>`;
  }

  async function issue(plan, rows) {
    if (busy) return;
    const picked = new Set([...document.querySelectorAll(".is-pick:checked")].map((c) => c.dataset.key));
    const lines = rows.filter((r) => !r.missing && !r.insufficient &&
      picked.has(K.itemKey(r.name, r.unit)) && r.qty > 0);
    if (!lines.length) return HP.toast("Nothing is ticked — there's nothing to issue.", "warn");

    const note = document.getElementById("isNote").value.trim();
    busy = true;
    const btn = document.getElementById("isSave");
    if (btn) btn.disabled = true;
    try {
      // One transaction for the whole issue: either the kitchen gets every
      // ticked line or the shelf is untouched. A half-applied issue would
      // leave a plan that looks handed over but isn't.
      await db.runTransaction(async (tx) => {
        const refs = lines.map((l) => db.collection("pantry").doc(l.itemId));
        const snaps = [];
        for (const ref of refs) snaps.push(await tx.get(ref)); // reads before writes
        const writes = [];
        snaps.forEach((snap, i) => {
          const l = lines[i];
          if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone", it: l.name });
          const before = K.round3((snap.data() || {}).qty);
          const after = K.round3(before - l.qty);
          // Re-checked inside the transaction: the shelf may have moved since
          // the dialog painted.
          if (after < 0) throw Object.assign(new Error("short"), { code: "hp/short", it: l.name });
          writes.push({ ref: refs[i], l, before, after });
        });
        writes.forEach(({ ref, l, before, after }) => {
          tx.update(ref, {
            qty: after,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtLocal: Date.now(),
            updatedByName: HP.user.name || "—",
          });
          tx.set(db.collection("pantryLog").doc(), K.logEntry({
            itemId: l.itemId, itemName: l.name, unit: l.unit,
            delta: -l.qty, before, after,
            reason: "issued", note,
            bookingId: plan.bookingId || plan.id,
            clientName: plan.clientName || null,
          }));
        });
        // Stamp the plan so the picker can show it as issued.
        tx.set(db.collection("prepPlans").doc(plan.id), {
          issuedAt: firebase.firestore.FieldValue.serverTimestamp(),
          issuedAtLocal: Date.now(),
          issuedByName: HP.user.name || "—",
        }, { merge: true });
      });
      HP.closeModal();
      HP.toast(`Issued ${lines.length} line${lines.length === 1 ? "" : "s"} to the kitchen.`, "ok");
    } catch (e) {
      if (e && e.code === "hp/short") HP.toast(`“${e.it}” ran short while you were reviewing — reopen and try again.`, "warn");
      else if (e && e.code === "hp/gone") HP.toast(`“${e.it}” was removed from the pantry.`, "warn");
      else {
        console.error(e);
        HP.toast(denied(e) ? "Your role can't write to the pantry." : "Couldn't issue — check your connection.", "danger");
      }
    } finally {
      busy = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["Item", "Unit", "Section", "On hand", "Par", "State", "Note", "Last moved", "By"];
    const lines = [head.map(cell).join(",")];
    list.forEach((it) => lines.push([
      it.name, it.unit, it.category || "", K.round3(it.qty), it.par === 0 || it.par ? it.par : "",
      K.STATE_LABEL[K.stateOf(it)], it.note || "",
      K.fmtWhen({ at: it.updatedAt, atLocal: it.updatedAtLocal }), it.updatedByName || "",
    ].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_pantry.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Pantry exported as CSV.");
  }
})();
