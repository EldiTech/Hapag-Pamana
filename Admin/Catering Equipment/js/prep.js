/* HapagPamana · Catering Equipment — Event Prep.

   Every confirmed booking, and how far its equipment checklist has gotten.
   Deliberately independent of the kitchen's cook/dispatch rail
   (assets/hp-fulfilment.js, driven by Team Leader + Logistics): this desk
   starts preparing gear the moment Orders confirms an event, not after the
   food is ready, and its status never blocks or is blocked by theirs.

   The checklist itself lives on the booking:

     bookings/{id}.equipmentPrep = {
       status,   "pending" | "in_progress" | "ready" | "returned"
       checklist: [{ itemId, itemName, variantId, variantLabel, qty,
                      checked, checkedAt, checkedByName,
                      returnedQty, damagedQty, lostQty, returnedAt }],
       note, preparedAt, preparedByName,
       returnedAt, returnedByName,
       updatedAt, updatedByName,
     }

   Writes only ever touch the `equipmentPrep` field (merge: true, inside a
   transaction against the live booking), so this desk can never collide
   with what Orders, Team Leader or Logistics write on the same document.

   STOCK ACTUALLY MOVES TWICE, symmetrically, and both moves are the SAME
   kind of write as the Inventory page's own movements — a transaction
   touching the booking AND every affected equipmentItems doc AND one
   equipmentLog entry per line, so a shelf count is never changed without an
   entry explaining it (equipment-common.js logEntry):

     "Ready for release"  deducts every checklist line's qty from its
                           variant (reason "checked_out") and LOCKS the
                           checklist — it becomes read-only. Nothing before
                           this point ever touched inventory: building the
                           checklist is just a plan until this commit.
     "Reopen"              the mirror image — adds every line's qty back
                           (reason "reopened") and returns to the editable
                           checklist, for when a correction is genuinely
                           needed after locking.
     "Return equipment"    once the event is over, a per-line review (same
                           review-then-commit shape as the Pantry's "Issue
                           to kitchen") splits what came back into
                           returned-OK vs. damaged/lost. Only returned-OK
                           adds back to the shelf (reason "returned");
                           damaged/lost are ledger-only records — the piece
                           was already checked out, so there's nothing left
                           to subtract.

   Checked-out → returned nets to zero on the shelf for anything that came
   back clean, which is the whole point: this used to only add stock back on
   return without ever having deducted it at checkout, silently inflating
   the count on every round trip.

   THE RETURN is this desk's own close-out, decided entirely on its own —
   it doesn't wait on the booking's status or on Team Leader/Logistics
   finishing their rail.

   NOTIFYING LOGISTICS: the same commitReady() that locks and deducts also
   stamps a second sibling field, requesting pickup —

     bookings/{id}.equipmentPickup = {
       stage,   "requested" | "picked_up" | "delivered"
       requestedAt, requestedByName,
       pickedUpAt, pickedUpByName,
       deliveredAt, deliveredByName,
       history: [{ stage, at, byName, note }],
       updatedAt, updatedByName,
     }

   — a separate parallel lane from the food release Logistics already runs
   (assets/hp-fulfilment.js / Logistics/js/dispatch.js's existing queue):
   equipment can be picked up and delivered on its own schedule, whether or
   not the food has been released yet. Logistics reads and drives this
   field from its own dispatch board; this file only ever writes
   "requested" (on ready) or clears it (on reopen, if not yet picked up).

   Requires the catering_equipment (or admin/owner) role — see
   firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const K = window.HPEquip;

  HP.shell.init();
  HP.shell.setPage({
    title: "Event Prep",
    sub: "Confirmed events, and how far their equipment checklist has gotten.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("epStats");
  const chipsEl = document.getElementById("epChips");
  const rowsEl = document.getElementById("epRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  let orders = [];
  let equipmentItems = [];
  let query = "";
  let filter = "todo";
  let loaded = false;
  let unsub = null;
  let itemsUnsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("Orders live in Firestore — connect Firebase to read them.");
      return;
    }
    unsub = db.collection("bookings").where("status", "==", "confirmed").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        orders = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((o) => !o.deleted);
        orders.sort(byUrgency);
        loaded = true;
        renderAll();
      }, (e) => {
        const denied = e && (e.code === "permission-denied" ||
          /permission|insufficient/i.test(e.message || ""));
        statsEl.innerHTML = "";
        rowsEl.innerHTML = emptyRow(denied
          ? "Your role can't read the confirmed orders — publish the updated Firestore rules, then reload."
          : "Couldn't reach Firestore — check your connection.");
        if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
      });

    // The inventory to pick checklist lines from. Read-only here — this
    // desk's item CRUD lives entirely on the Inventory page.
    itemsUnsub = db.collection("equipmentItems").onSnapshot((snap) => {
      equipmentItems = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      equipmentItems.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }, () => { /* the prep board still works without the picker's live list */ });
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); if (itemsUnsub) itemsUnsub(); });

  const dateKey = (o) => {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  const prep = (o) => (o && o.equipmentPrep) || {};
  const prepStatus = (o) => prep(o).status || "pending";
  // Not-yet-started events first, then by how soon the event is; already
  // -returned events sink to the very back — there's nothing left to do.
  const urgencyRank = { pending: 0, in_progress: 0, ready: 0, returned: 1 };
  function byUrgency(a, b) {
    const ra = urgencyRank[prepStatus(a)] || 0;
    const rb = urgencyRank[prepStatus(b)] || 0;
    return ra - rb || dateKey(a) - dateKey(b);
  }
  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    const todo = orders.filter((o) => prepStatus(o) === "pending").length;
    const inProgress = orders.filter((o) => prepStatus(o) === "in_progress").length;
    const ready = orders.filter((o) => prepStatus(o) === "ready").length;
    const returned = orders.filter((o) => prepStatus(o) === "returned").length;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("checklist", todo, "Not started") +
      stat("crate", inProgress, "In progress") +
      stat("check", ready, "Ready for release") +
      stat("logbook", returned, "Returned"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      todo: orders.filter((o) => prepStatus(o) === "pending").length,
      progress: orders.filter((o) => prepStatus(o) === "in_progress").length,
      ready: orders.filter((o) => prepStatus(o) === "ready").length,
      returned: orders.filter((o) => prepStatus(o) === "returned").length,
      all: orders.length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("todo", "Not started") + chip("progress", "In progress") +
      chip("ready", "Ready for release") + chip("returned", "Returned") + chip("all", "Everything");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    return orders.filter((o) => {
      const st = prepStatus(o);
      if (filter === "todo" && st !== "pending") return false;
      if (filter === "progress" && st !== "in_progress") return false;
      if (filter === "ready" && st !== "ready") return false;
      if (filter === "returned" && st !== "returned") return false;
      if (!query) return true;
      return [o.clientName, o.kindOfFunction, o.venue, o.functionDate]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function badgeFor(o) {
    const st = prepStatus(o);
    if (st === "returned") return `<span class="badge badge-cat">Returned</span>`;
    if (st === "ready") return `<span class="badge badge-ok">Ready for release</span>`;
    if (st === "in_progress") return `<span class="badge badge-gold"><span class="dot"></span>In progress</span>`;
    return `<span class="badge badge-cat">Not started</span>`;
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(orders.length
        ? "Nothing here — try another filter or search."
        : "No confirmed events yet — they appear here as soon as Orders confirms a booking.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((o) => `
      <tr data-id="${HP.esc(o.id)}">
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(clientName(o))}</strong>
            <small>${HP.esc(o.venue || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(o.kindOfFunction || "—")}</td>
        <td>${HP.esc(o.functionDate || "—")}</td>
        <td>${HP.esc(String(o.pax || "—"))}</td>
        <td>${badgeFor(o)}</td>
        <td class="row-actions">
          <button class="icon-btn" data-act="open" title="Open the checklist"
            aria-label="Open ${HP.esc(clientName(o))}'s equipment checklist"><span class="ic">${HP.icon("checklist")}</span></button>
        </td>
      </tr>`).join(""));
    HP.hydrateIcons(rowsEl);

    const open = (id) => { const o = orders.find((x) => x.id === id); if (o) openOrder(o); };
    rowsEl.querySelectorAll("[data-act='open']").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); open(e.currentTarget.closest("tr").dataset.id); }));
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) open(tr.dataset.id); }));
  }

  /* ── The checklist sheet ─────────────────────────────────────────────────
     Lines are added from the inventory (item + variant + qty needed), then
     ticked off as the desk physically pulls each piece. "Mark ready" is
     only offered once every line is checked — the same review-then-commit
     shape the Pantry's issue screen uses, so nothing is declared ready by
     mistake. */
  let draftChecklist = [];
  function openOrder(o) {
    const f = prep(o);
    draftChecklist = Array.isArray(f.checklist) ? f.checklist.map((l) => Object.assign({}, l)) : [];
    const st = prepStatus(o);
    if (st === "returned") openReturnedSummary(o);
    else if (st === "ready") openReadySummary(o);
    else renderSheet(o);
  }

  function renderSheet(o) {
    const f = prep(o);
    const allChecked = draftChecklist.length > 0 && draftChecklist.every((l) => l.checked);

    HP.openModal(`${clientName(o)} · Equipment checklist`, `
      <div class="wf-sheet">
        <div class="ck-head">
          <div>
            <p class="ck-client"><strong>${HP.esc(clientName(o))}</strong>
              ${o.kindOfFunction ? ` · ${HP.esc(o.kindOfFunction)}` : ""}</p>
            <p class="ck-meta">${HP.esc(o.functionDate || "")}${
              o.venue ? " · " + HP.esc(o.venue) : ""}${
              o.pax ? " · " + HP.esc(String(o.pax)) + " pax" : ""}</p>
          </div>
          ${badgeFor(o)}
        </div>

        <div class="eq-picker">
          <select class="control" id="ckItem"></select>
          <select class="control" id="ckVariant"></select>
          <input class="control" id="ckQty" type="number" min="1" step="1" placeholder="Qty" value="1" />
          <button type="button" class="btn btn-ghost btn-sm" id="ckAddLine"><span class="ic">${HP.icon("plus")}</span>Add</button>
        </div>

        <div id="ckLines" class="eq-checklist"></div>

        <div class="field" style="margin-top:14px">
          <label>Note (optional)</label>
          <input class="control" id="ckNote" placeholder="e.g. extra tables on standby at the venue"
            value="${HP.esc(String(f.note || ""))}" />
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="ckSave"><span class="ic">${HP.icon("check")}</span>Save checklist</button>
       <button class="btn btn-primary" id="ckReady" ${allChecked ? "" : "disabled"}><span class="ic">${HP.icon("check")}</span>Mark ready for release</button>`);

    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    fillItemPicker();
    renderLines();

    document.getElementById("ckItem").addEventListener("change", fillVariantPicker);
    document.getElementById("ckAddLine").addEventListener("click", () => addLine());
    document.getElementById("ckSave").addEventListener("click", () => saveChecklist(o));
    document.getElementById("ckReady").addEventListener("click", () => commitReady(o));
  }

  function fillItemPicker() {
    const sel = document.getElementById("ckItem");
    if (!sel) return;
    sel.innerHTML = equipmentItems.length
      ? equipmentItems.map((it) => `<option value="${HP.esc(it.id)}">${HP.esc(it.name)}</option>`).join("")
      : `<option value="">No inventory items yet</option>`;
    fillVariantPicker();
  }

  function fillVariantPicker() {
    const itemSel = document.getElementById("ckItem");
    const varSel = document.getElementById("ckVariant");
    if (!itemSel || !varSel) return;
    const it = equipmentItems.find((x) => x.id === itemSel.value);
    const variants = (it && it.variants) || [];
    varSel.innerHTML = variants.length
      ? variants.map((v) => `<option value="${HP.esc(v.id)}">${HP.esc(v.label)} (${HP.esc(K.qtyText(v.qty, v.unit))} on hand)</option>`).join("")
      : `<option value="">No variants</option>`;
  }

  function addLine() {
    const itemSel = document.getElementById("ckItem");
    const varSel = document.getElementById("ckVariant");
    const qtyEl = document.getElementById("ckQty");
    const it = equipmentItems.find((x) => x.id === itemSel.value);
    if (!it) return HP.toast("Add an item to the inventory first.", "warn");
    const v = (it.variants || []).find((x) => x.id === varSel.value);
    if (!v) return HP.toast("This item has no variant to add.", "warn");
    const qty = Math.max(1, Math.round(Number(qtyEl.value) || 1));
    if (draftChecklist.some((l) => l.itemId === it.id && l.variantId === v.id))
      return HP.toast(`${it.name} — ${v.label} is already on the checklist.`, "warn");
    // A checklist is only a plan until "Mark ready for release" locks it and
    // deducts the shelf — but warning here, before that commit, is what lets
    // the desk pick a different variant instead of discovering the shortfall
    // at lock time.
    const onHand = K.round3(v.qty);
    if (qty > onHand)
      HP.toast(`Only ${K.qtyText(onHand, v.unit)} of ${it.name} — ${v.label} on the shelf — adding anyway.`, "warn");
    draftChecklist.push({
      itemId: it.id, itemName: it.name, variantId: v.id, variantLabel: v.label,
      qty, checked: false, checkedAt: null, checkedByName: null,
    });
    renderLines();
  }

  function renderLines() {
    const wrap = document.getElementById("ckLines");
    if (!wrap) return;
    wrap.innerHTML = draftChecklist.length ? draftChecklist.map((l, i) => `
      <label class="eq-check-line${l.checked ? " is-checked" : ""}">
        <input type="checkbox" data-i="${i}" ${l.checked ? "checked" : ""} />
        <span class="eq-check-main">
          <strong>${HP.esc(l.itemName)}</strong>
          <small>${HP.esc(l.variantLabel)} · qty ${HP.esc(String(l.qty))}</small>
        </span>
        <button type="button" class="icon-btn danger" data-remove="${i}" title="Remove" aria-label="Remove ${HP.esc(l.itemName)}"><span class="ic">${HP.icon("trash")}</span></button>
      </label>`).join("") : `<p class="wf-empty">No equipment lines yet — add some from the inventory above.</p>`;
    HP.hydrateIcons(wrap);
    wrap.querySelectorAll("input[type=checkbox]").forEach((c) => c.addEventListener("change", (e) => {
      const i = Number(e.currentTarget.dataset.i);
      draftChecklist[i].checked = e.currentTarget.checked;
      draftChecklist[i].checkedAt = e.currentTarget.checked ? Date.now() : null;
      draftChecklist[i].checkedByName = e.currentTarget.checked ? (HP.user.name || "—") : null;
      renderLines();
      const readyBtn = document.getElementById("ckReady");
      if (readyBtn) readyBtn.disabled = !(draftChecklist.length && draftChecklist.every((l) => l.checked));
    }));
    wrap.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      draftChecklist.splice(Number(b.dataset.remove), 1);
      renderLines();
      const readyBtn = document.getElementById("ckReady");
      if (readyBtn) readyBtn.disabled = !(draftChecklist.length && draftChecklist.every((l) => l.checked));
    }));
  }

  /* ── Save the (still-editable) checklist ──────────────────────────────────
     Transactional against the live booking, merging ONLY the equipmentPrep
     field — Orders, Team Leader and Logistics each write their own
     top-level fields on the same document, and a plain set() without merge
     (or a merge that touched their fields) would race them.

     This never touches inventory — a checklist is just a plan until
     commitReady() locks and deducts it below. Saving here only ever leaves
     the event at "pending" or "in_progress". */
  let saving = false;
  async function saveChecklist(o) {
    if (saving) return;
    saving = true;
    const btns = [...document.querySelectorAll(".modal-foot .btn")];
    btns.forEach((b) => { b.disabled = true; });
    const note = document.getElementById("ckNote").value.trim();
    try {
      const ref = db.collection("bookings").doc(o.id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const cur = snap.data() || {};
        const prevF = cur.equipmentPrep || {};
        tx.set(ref, {
          equipmentPrep: {
            status: draftChecklist.length ? "in_progress" : "pending",
            checklist: draftChecklist, note,
            preparedAt: prevF.preparedAt || null,
            preparedByName: prevF.preparedByName || null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByName: HP.user.name || "—",
          },
        }, { merge: true });
      });
      HP.closeModal();
      HP.toast("Checklist saved.", "ok");
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That event no longer exists.", "warn");
      else {
        console.warn("HapagPamana: equipment prep write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't update this event."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      saving = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  /* ── Mark ready for release: lock + deduct ────────────────────────────────
     The real checkout moment. One transaction: read every affected
     equipmentItems doc, deduct each checklist line's qty from its variant
     (reason "checked_out"), write the ledger entries, and flip the booking
     to "ready" — all or nothing, same multi-ref shape as commitReturn()
     below and the Pantry's issue(). This is the ONLY place inventory moves
     on the way out; nothing before this point (adding lines, ticking boxes,
     saving) ever touched a shelf count. */
  let committingReady = false;
  async function commitReady(o) {
    if (committingReady) return;
    committingReady = true;
    const btns = [...document.querySelectorAll(".modal-foot .btn")];
    btns.forEach((b) => { b.disabled = true; });
    const note = document.getElementById("ckNote").value.trim();
    const lines = draftChecklist;
    try {
      const bookingRef = db.collection("bookings").doc(o.id);
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      const itemRefs = itemIds.map((id) => db.collection("equipmentItems").doc(id));

      await db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const itemSnaps = [];
        for (const ref of itemRefs) itemSnaps.push(await tx.get(ref)); // reads before writes

        const itemsById = new Map();
        itemSnaps.forEach((snap, i) => {
          if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/item-gone", name: lines.find((l) => l.itemId === itemIds[i]).itemName });
          itemsById.set(itemIds[i], { ref: itemRefs[i], data: snap.data() });
        });

        const logs = [];
        itemsById.forEach(({ ref, data }, itemId) => {
          const variants = Array.isArray(data.variants) ? data.variants.map((v) => Object.assign({}, v)) : [];
          lines.filter((l) => l.itemId === itemId).forEach((l) => {
            const idx = variants.findIndex((v) => v.id === l.variantId);
            if (idx === -1) throw Object.assign(new Error("gone"), { code: "hp/item-gone", name: `${l.itemName} — ${l.variantLabel}` });
            const before = K.round3(variants[idx].qty);
            const after = K.round3(before - l.qty);
            if (after < 0) throw Object.assign(new Error("short"), { code: "hp/short", name: `${l.itemName} — ${l.variantLabel}` });
            variants[idx] = Object.assign({}, variants[idx], { qty: after });
            logs.push({ ref: db.collection("equipmentLog").doc(), entry: K.logEntry({
              itemId, itemName: l.itemName, variantId: l.variantId, variantLabel: l.variantLabel,
              unit: variants[idx].unit, delta: -l.qty, before, after,
              reason: "checked_out", note, bookingId: o.id, clientName: clientName(o),
            }) });
          });
          tx.set(ref, {
            variants,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtLocal: Date.now(),
            updatedByName: HP.user.name || "—",
          }, { merge: true });
        });
        logs.forEach(({ ref, entry }) => tx.set(ref, entry));

        // The same commit that locks and deducts also asks Logistics to
        // come get it — one action, no separate step to remember (per the
        // user: automatic, not a distinct "Request pickup" button).
        tx.set(bookingRef, {
          equipmentPrep: {
            status: "ready", checklist: lines, note,
            preparedAt: Date.now(), preparedByName: HP.user.name || "—",
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByName: HP.user.name || "—",
          },
          equipmentPickup: {
            stage: "requested",
            requestedAt: Date.now(),
            requestedByName: HP.user.name || "—",
            pickedUpAt: null, pickedUpByName: null,
            deliveredAt: null, deliveredByName: null,
            history: [{ stage: "requested", at: Date.now(), byName: HP.user.name || "—", note: "" }],
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByName: HP.user.name || "—",
          },
        }, { merge: true });
      });
      HP.closeModal();
      HP.toast("Marked ready for release — inventory deducted, logistics notified.", "ok");
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That event no longer exists.", "warn");
      else if (e && e.code === "hp/item-gone") HP.toast(`“${e.name}” isn't in the inventory anymore — remove it from the checklist and try again.`, "warn");
      else if (e && e.code === "hp/short") HP.toast(`Not enough “${e.name}” on the shelf to check out — reduce the qty or check the inventory.`, "danger");
      else {
        console.warn("HapagPamana: equipment ready commit —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't update this event."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      committingReady = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  /* ── Reopen a ready checklist ──────────────────────────────────────────────
     The mirror image of commitReady: adds every line's qty back to its
     variant (reason "reopened") and drops the booking back to editable
     in_progress. Nothing here assumes the equipment is physically back on
     the shelf — the checklist was locked in error, or needs a correction,
     while the gear may still be sitting in a van. Any REAL return, after the
     event, goes through "Return equipment" instead, never this.

     Also withdraws the pickup request this same commit created — but ONLY
     if Logistics hasn't acted on it yet. Once they've picked it up or
     delivered it, reopening is refused outright (mirrors hp-fulfilment.js's
     "logistics already has this order" guard in Team Leader's board.js):
     silently un-requesting equipment that's already in a van or at the
     venue would leave Logistics' dispatch board pointing at a checklist
     that no longer matches what they're holding. */
  let reopening = false;
  async function commitReopen(o) {
    if (reopening) return;
    const f = prep(o);
    const lines = Array.isArray(f.checklist) ? f.checklist : [];
    const pickupStage = (o.equipmentPickup || {}).stage;
    if (pickupStage === "picked_up" || pickupStage === "delivered") {
      return HP.toast("Logistics already has this equipment — it can't be reopened now.", "danger");
    }
    reopening = true;
    const btns = [...document.querySelectorAll(".modal-foot .btn")];
    btns.forEach((b) => { b.disabled = true; });
    try {
      const bookingRef = db.collection("bookings").doc(o.id);
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      const itemRefs = itemIds.map((id) => db.collection("equipmentItems").doc(id));

      await db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        // Re-check inside the transaction: Logistics may have picked it up
        // in the moment between this button's click and the write landing.
        const liveStage = ((bookingSnap.data() || {}).equipmentPickup || {}).stage;
        if (liveStage === "picked_up" || liveStage === "delivered") {
          throw Object.assign(new Error("picked up"), { code: "hp/picked-up" });
        }
        const itemSnaps = [];
        for (const ref of itemRefs) itemSnaps.push(await tx.get(ref));

        const itemsById = new Map();
        itemSnaps.forEach((snap, i) => {
          if (snap.exists) itemsById.set(itemIds[i], { ref: itemRefs[i], data: snap.data() });
        });

        const logs = [];
        itemsById.forEach(({ ref, data }, itemId) => {
          const variants = Array.isArray(data.variants) ? data.variants.map((v) => Object.assign({}, v)) : [];
          lines.filter((l) => l.itemId === itemId).forEach((l) => {
            const idx = variants.findIndex((v) => v.id === l.variantId);
            if (idx === -1) return; // variant removed since — skip, don't block the reopen
            const before = K.round3(variants[idx].qty);
            const after = K.round3(before + l.qty);
            variants[idx] = Object.assign({}, variants[idx], { qty: after });
            logs.push({ ref: db.collection("equipmentLog").doc(), entry: K.logEntry({
              itemId, itemName: l.itemName, variantId: l.variantId, variantLabel: l.variantLabel,
              unit: variants[idx].unit, delta: l.qty, before, after,
              reason: "reopened", note: "Checklist reopened for edits.",
              bookingId: o.id, clientName: clientName(o),
            }) });
          });
          tx.set(ref, {
            variants,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtLocal: Date.now(),
            updatedByName: HP.user.name || "—",
          }, { merge: true });
        });
        logs.forEach(({ ref, entry }) => tx.set(ref, entry));

        tx.set(bookingRef, {
          equipmentPrep: {
            status: lines.length ? "in_progress" : "pending",
            checklist: lines, note: f.note || "",
            preparedAt: null, preparedByName: null,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByName: HP.user.name || "—",
          },
          // Withdrawn, not deleted — Logistics' dispatch board simply stops
          // showing this event once the stage is cleared.
          equipmentPickup: {
            stage: null,
            requestedAt: null, requestedByName: null,
            pickedUpAt: null, pickedUpByName: null,
            deliveredAt: null, deliveredByName: null,
            history: [],
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByName: HP.user.name || "—",
          },
        }, { merge: true });
      });
      HP.closeModal();
      HP.toast("Checklist reopened — inventory restored.", "ok");
      draftChecklist = lines.map((l) => Object.assign({}, l));
      renderSheet(o);
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That event no longer exists.", "warn");
      else if (e && e.code === "hp/picked-up") HP.toast("Logistics already has this equipment — it can't be reopened now.", "danger");
      else {
        console.warn("HapagPamana: equipment reopen —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't update this event."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      reopening = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  // What Logistics is doing with a requested pickup, in the equipment
  // desk's own words — Logistics drives this field from its own dispatch
  // board (Logistics/js/dispatch.js); this file only ever reads it here.
  function pickupStatusLine(o) {
    const p = o.equipmentPickup || {};
    if (p.stage === "delivered") return `Delivered to the venue ${HP.esc(K.fmtWhen({ atLocal: p.deliveredAt }))}${p.deliveredByName ? ` by ${HP.esc(p.deliveredByName)}` : ""}.`;
    if (p.stage === "picked_up") return `Picked up by logistics ${HP.esc(K.fmtWhen({ atLocal: p.pickedUpAt }))}${p.pickedUpByName ? ` — ${HP.esc(p.pickedUpByName)}` : ""}.`;
    if (p.stage === "requested") return `Waiting for logistics to pick it up.`;
    return "";
  }

  /* Read-only view once the checklist is locked at "ready for release" —
     the desk sees what was checked out and can either return it (after the
     event) or reopen it (a correction before then). Reopen is hidden once
     Logistics has already picked the equipment up — see commitReopen. */
  function openReadySummary(o) {
    const f = prep(o);
    const lines = Array.isArray(f.checklist) ? f.checklist : [];
    const pickupStage = (o.equipmentPickup || {}).stage;
    const canReopen = pickupStage !== "picked_up" && pickupStage !== "delivered";
    const statusLine = pickupStatusLine(o);
    HP.openModal(`${clientName(o)} · Ready for release`, `
      <div class="wf-sheet">
        <div class="ck-head">
          <div>
            <p class="ck-client"><strong>${HP.esc(clientName(o))}</strong>
              ${o.kindOfFunction ? ` · ${HP.esc(o.kindOfFunction)}` : ""}</p>
            <p class="ck-meta">${HP.esc(o.functionDate || "")}${o.venue ? " · " + HP.esc(o.venue) : ""}</p>
          </div>
          ${badgeFor(o)}
        </div>
        <p class="ck-meta">Marked ready ${HP.esc(K.fmtWhen({ atLocal: f.preparedAt }))} by ${HP.esc(f.preparedByName || "—")}. Checked out and deducted from inventory.</p>
        ${statusLine ? `<p class="wf-flag">${statusLine}</p>` : ""}
        <div class="eq-checklist">${lines.length ? lines.map((l) => `
          <div class="eq-check-line is-checked">
            <span class="eq-check-main">
              <strong>${HP.esc(l.itemName)}</strong>
              <small>${HP.esc(l.variantLabel)} · qty ${HP.esc(String(l.qty))}</small>
            </span>
          </div>`).join("") : `<p class="wf-empty">No checklist lines.</p>`}</div>
        ${f.note ? `<p class="ck-meta">${HP.esc(f.note)}</p>` : ""}
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       ${canReopen ? `<button class="btn btn-ghost" id="ckReopen"><span class="ic">${HP.icon("undo")}</span>Reopen</button>` : ""}
       <button class="btn btn-primary" id="ckReturn"><span class="ic">${HP.icon("crate")}</span>Return equipment</button>`);
    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);
    const reopenBtn = document.getElementById("ckReopen");
    if (reopenBtn) reopenBtn.addEventListener("click", () => commitReopen(o));
    document.getElementById("ckReturn").addEventListener("click", () => openReturnReview(o));
  }

  /* ── Return the equipment ─────────────────────────────────────────────────
     Opens once the event is "ready" — the checklist is frozen at this point
     (no more add/remove/tick), and every line gets a review row: how many
     came back clean, how many were lost or damaged. Defaults to the full
     checked-out qty coming back clean, editable, and the two numbers must
     not exceed what went out — the same guardrail shape the Pantry's issue
     screen uses for "can't cover more than what's there". */
  function openReturnReview(o) {
    const lines = draftChecklist.map((l) => Object.assign({
      returnedQty: l.qty, damagedQty: 0, lostQty: 0,
    }, l));

    HP.openModal(`${clientName(o)} · Return equipment`, `
      <div class="wf-sheet">
        <div class="ck-head">
          <div>
            <p class="ck-client"><strong>${HP.esc(clientName(o))}</strong>
              ${o.kindOfFunction ? ` · ${HP.esc(o.kindOfFunction)}` : ""}</p>
            <p class="ck-meta">${HP.esc(o.functionDate || "")}${
              o.venue ? " · " + HP.esc(o.venue) : ""}</p>
          </div>
        </div>
        <p class="eq-hint">Review what actually came back. Anything short of the checked-out qty needs a reason — mark it damaged or lost so the shelf count and the ledger agree.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Item</th><th>Checked out</th><th>Returned OK</th><th>Damaged</th><th>Lost</th></tr></thead>
            <tbody id="rtRows">${lines.map(returnRow).join("")}</tbody>
          </table>
        </div>
        <div class="field" style="margin-top:14px">
          <label>Note (optional)</label>
          <input class="control" id="rtNote" placeholder="e.g. two round chafing dishes cracked in transit" />
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="rtSave"><span class="ic">${HP.icon("check")}</span>Confirm return</button>`);

    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    const rowsEl2 = document.getElementById("rtRows");
    rowsEl2.querySelectorAll("tr[data-i]").forEach((tr) => {
      const i = Number(tr.dataset.i);
      const okEl = tr.querySelector("[data-f='ok']");
      const dmgEl = tr.querySelector("[data-f='damaged']");
      const lostEl = tr.querySelector("[data-f='lost']");
      const sync = (justEdited) => {
        const max = lines[i].qty;
        let ok = Math.max(0, Math.round(Number(okEl.value) || 0));
        let dmg = Math.max(0, Math.round(Number(dmgEl.value) || 0));
        let lost = Math.max(0, Math.round(Number(lostEl.value) || 0));
        if (ok + dmg + lost > max) {
          // Clamp whichever field wasn't just typed in, favoring the one
          // the desk is actively editing.
          const over = ok + dmg + lost - max;
          if (justEdited === "ok") { const cut = Math.min(over, lost); lost -= cut; dmg -= Math.max(0, over - cut); }
          else if (justEdited === "damaged") { const cut = Math.min(over, lost); lost -= cut; ok -= Math.max(0, over - cut); }
          else { const cut = Math.min(over, dmg); dmg -= cut; ok -= Math.max(0, over - cut); }
          okEl.value = ok; dmgEl.value = dmg; lostEl.value = lost;
        }
        lines[i].returnedQty = ok;
        lines[i].damagedQty = dmg;
        lines[i].lostQty = lost;
      };
      okEl.addEventListener("input", () => sync("ok"));
      dmgEl.addEventListener("input", () => sync("damaged"));
      lostEl.addEventListener("input", () => sync("lost"));
    });

    document.getElementById("rtSave").addEventListener("click", () => commitReturn(o, lines));
  }

  function returnRow(l, i) {
    return `<tr data-i="${i}">
      <td>
        <div class="cell-name"><div>
          <strong>${HP.esc(l.itemName)}</strong>
          <small>${HP.esc(l.variantLabel)}</small>
        </div></div>
      </td>
      <td>${HP.esc(String(l.qty))}</td>
      <td><input class="control" type="number" min="0" step="1" max="${HP.esc(String(l.qty))}" data-f="ok" value="${HP.esc(String(l.returnedQty))}" /></td>
      <td><input class="control" type="number" min="0" step="1" max="${HP.esc(String(l.qty))}" data-f="damaged" value="${HP.esc(String(l.damagedQty))}" /></td>
      <td><input class="control" type="number" min="0" step="1" max="${HP.esc(String(l.qty))}" data-f="lost" value="${HP.esc(String(l.lostQty))}" /></td>
    </tr>`;
  }

  /* Commit: one transaction touching the booking (equipmentPrep → "returned",
     each line stamped with what came back) AND every affected equipmentItems
     doc (bump the variant's qty by the returned-OK amount) AND one
     equipmentLog entry per line per non-zero outcome — matching the ledger
     discipline every write in equipment-common.js follows: a shelf count
     never moves without an entry explaining it. Reads every touched item
     doc before any write (Firestore's read-before-write transaction rule),
     same shape as the Pantry's multi-line issue() in inventory.js. */
  let returning = false;
  async function commitReturn(o, lines) {
    if (returning) return;
    const withMovement = lines.filter((l) => l.returnedQty > 0 || l.damagedQty > 0 || l.lostQty > 0);
    returning = true;
    const btns = [...document.querySelectorAll(".modal-foot .btn")];
    btns.forEach((b) => { b.disabled = true; });
    const note = document.getElementById("rtNote").value.trim();
    try {
      const bookingRef = db.collection("bookings").doc(o.id);
      const itemIds = [...new Set(lines.map((l) => l.itemId))];
      const itemRefs = itemIds.map((id) => db.collection("equipmentItems").doc(id));

      await db.runTransaction(async (tx) => {
        const bookingSnap = await tx.get(bookingRef);
        if (!bookingSnap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const itemSnaps = [];
        for (const ref of itemRefs) itemSnaps.push(await tx.get(ref)); // reads before writes

        const itemsById = new Map();
        itemSnaps.forEach((snap, i) => {
          if (snap.exists) itemsById.set(itemIds[i], { ref: itemRefs[i], data: snap.data() });
        });

        const logs = [];
        itemsById.forEach(({ ref, data }, itemId) => {
          const variants = Array.isArray(data.variants) ? data.variants.map((v) => Object.assign({}, v)) : [];
          lines.filter((l) => l.itemId === itemId).forEach((l) => {
            const idx = variants.findIndex((v) => v.id === l.variantId);
            if (idx === -1) return; // variant removed since — skip, don't fail the whole return
            if (l.returnedQty > 0) {
              const before = K.round3(variants[idx].qty);
              const after = K.round3(before + l.returnedQty);
              variants[idx] = Object.assign({}, variants[idx], { qty: after });
              logs.push({ ref: db.collection("equipmentLog").doc(), entry: K.logEntry({
                itemId, itemName: l.itemName, variantId: l.variantId, variantLabel: l.variantLabel,
                unit: variants[idx].unit, delta: l.returnedQty, before, after,
                reason: "returned", note, bookingId: o.id, clientName: clientName(o),
              }) });
            }
            // Damaged/lost never touches qty — the piece was already out of
            // hand when it broke or went missing, so there's nothing to
            // subtract from the shelf. The ledger entry alone records it.
            if (l.damagedQty > 0) {
              logs.push({ ref: db.collection("equipmentLog").doc(), entry: K.logEntry({
                itemId, itemName: l.itemName, variantId: l.variantId, variantLabel: l.variantLabel,
                unit: variants[idx].unit, delta: 0, before: K.round3(variants[idx].qty), after: K.round3(variants[idx].qty),
                reason: "damaged", note: note || "Damaged at the event.",
                bookingId: o.id, clientName: clientName(o),
              }) });
            }
            if (l.lostQty > 0) {
              logs.push({ ref: db.collection("equipmentLog").doc(), entry: K.logEntry({
                itemId, itemName: l.itemName, variantId: l.variantId, variantLabel: l.variantLabel,
                unit: variants[idx].unit, delta: 0, before: K.round3(variants[idx].qty), after: K.round3(variants[idx].qty),
                reason: "lost", note: note || "Not returned from the event.",
                bookingId: o.id, clientName: clientName(o),
              }) });
            }
          });
          tx.set(ref, {
            variants,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAtLocal: Date.now(),
            updatedByName: HP.user.name || "—",
          }, { merge: true });
        });
        logs.forEach(({ ref, entry }) => tx.set(ref, entry));

        const stampedChecklist = lines.map((l) => ({
          itemId: l.itemId, itemName: l.itemName, variantId: l.variantId, variantLabel: l.variantLabel,
          qty: l.qty, checked: l.checked, checkedAt: l.checkedAt, checkedByName: l.checkedByName,
          returnedQty: l.returnedQty, damagedQty: l.damagedQty, lostQty: l.lostQty, returnedAt: Date.now(),
        }));
        tx.set(bookingRef, {
          equipmentPrep: {
            status: "returned",
            checklist: stampedChecklist,
            note,
            returnedAt: Date.now(),
            returnedByName: HP.user.name || "—",
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedByName: HP.user.name || "—",
          },
        }, { merge: true });
      });

      HP.closeModal();
      HP.toast(withMovement.length ? "Equipment returned — inventory updated." : "Marked returned.", "ok");
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That event no longer exists.", "warn");
      else {
        console.warn("HapagPamana: equipment return write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't record this return."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      returning = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  /* Read-only recap once an event has already been returned — reopening the
     event shows what came back rather than the (now frozen) checklist
     editor. */
  function openReturnedSummary(o) {
    const f = prep(o);
    const lines = Array.isArray(f.checklist) ? f.checklist : [];
    HP.openModal(`${clientName(o)} · Equipment returned`, `
      <div class="wf-sheet">
        <div class="ck-head">
          <div>
            <p class="ck-client"><strong>${HP.esc(clientName(o))}</strong>
              ${o.kindOfFunction ? ` · ${HP.esc(o.kindOfFunction)}` : ""}</p>
            <p class="ck-meta">${HP.esc(o.functionDate || "")}${o.venue ? " · " + HP.esc(o.venue) : ""}</p>
          </div>
          ${badgeFor(o)}
        </div>
        <p class="ck-meta">Returned ${HP.esc(K.fmtWhen({ atLocal: f.returnedAt }))} by ${HP.esc(f.returnedByName || "—")}.</p>
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Item</th><th>Checked out</th><th>Returned OK</th><th>Damaged</th><th>Lost</th></tr></thead>
            <tbody>${lines.length ? lines.map((l) => `
              <tr>
                <td><div class="cell-name"><div><strong>${HP.esc(l.itemName)}</strong><small>${HP.esc(l.variantLabel)}</small></div></div></td>
                <td>${HP.esc(String(l.qty))}</td>
                <td>${HP.esc(String(l.returnedQty ?? "—"))}</td>
                <td>${l.damagedQty ? `<span class="badge badge-warn">${HP.esc(String(l.damagedQty))}</span>` : "—"}</td>
                <td>${l.lostQty ? `<span class="badge badge-warn">${HP.esc(String(l.lostQty))}</span>` : "—"}</td>
              </tr>`).join("") : `<tr><td colspan="5" class="table-empty">No checklist lines.</td></tr>`}</tbody>
          </table>
        </div>
        ${f.note ? `<p class="ck-meta">${HP.esc(f.note)}</p>` : ""}
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>`);
    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["Client", "Event", "Function date", "Venue", "Pax", "Prep status", "Lines", "Checked",
      "Prepared by", "Returned OK", "Damaged", "Lost", "Returned by"];
    const lines = [head.map(cell).join(",")];
    list.forEach((o) => {
      const f = prep(o);
      const checklist = Array.isArray(f.checklist) ? f.checklist : [];
      const sum = (k) => checklist.reduce((s, l) => s + (Number(l[k]) || 0), 0);
      lines.push([
        clientName(o), o.kindOfFunction || "", o.functionDate || "", o.venue || "",
        o.pax || "", prepStatus(o), checklist.length,
        checklist.filter((l) => l.checked).length, f.preparedByName || "",
        prepStatus(o) === "returned" ? sum("returnedQty") : "",
        prepStatus(o) === "returned" ? sum("damagedQty") : "",
        prepStatus(o) === "returned" ? sum("lostQty") : "",
        f.returnedByName || "",
      ].map(cell).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_equipment_prep.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Event prep exported as CSV.");
  }
})();
