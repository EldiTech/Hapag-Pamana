/* HapagPamana · Logistics — Dispatch.

   The other half of the fulfilment rail (see hp-fulfilment.js). The team
   leader cooks and packs; this desk decides when the food actually leaves and
   records that it arrived:

     · a ready order the TL has asked about lands in "To release",
     · approving it moves the order to Released,
     · rejecting it returns the order to the kitchen WITH A REASON,
     · once it reaches the venue, it is marked Delivered.

   Rejection is a first-class outcome rather than an error: the reason goes on
   the record and shows on the team leader's own rail, so a refusal is a
   message, not a silence.

   Requires the logistics (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const W = window.HPFul;

  HP.shell.init();
  HP.shell.setPage({
    title: "Dispatch",
    sub: "Orders the kitchen says are ready — and everything already on its way.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("lgStats");
  const chipsEl = document.getElementById("lgChips");
  const rowsEl = document.getElementById("lgRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  // Equipment pickups — a separate, independent lane driven by
  // bookings/{id}.equipmentPickup (see Catering Equipment/js/prep.js). Reads
  // the SAME `orders` array the food queue above uses (one confirmed-bookings
  // subscription, boot() below), just filtered to a different field.
  const epuStatsEl = document.getElementById("epuStats");
  const epuChipsEl = document.getElementById("epuChips");
  const epuRowsEl = document.getElementById("epuRows");
  let epuFilter = "todo";

  let orders = [];
  let query = "";
  let filter = "todo";   // this desk's own queue opens first
  let loaded = false;
  let unsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 6);
  epuStatsEl.innerHTML = HP.skel.stats(3);
  epuRowsEl.innerHTML = HP.skel.rows(4, 5);

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
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  const dateKey = (o) => {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  // Anything the kitchen is waiting on comes first — this desk is the
  // bottleneck for those — then by how soon the event is.
  function byUrgency(a, b) {
    const ra = W.isRequested(a) ? 0 : 1;
    const rb = W.isRequested(b) ? 0 : 1;
    return ra - rb || dateKey(a) - dateKey(b);
  }
  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); renderEquipAll(); }

  function renderStats() {
    const todo = orders.filter(W.isRequested).length;
    const out = orders.filter((o) => W.stageOf(o) === "released").length;
    const done = orders.filter((o) => W.stageOf(o) === "delivered").length;
    const cooking = orders.filter((o) => W.indexOf(W.stageOf(o)) < W.indexOf("released")
      && !W.isRequested(o)).length;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("truck", todo, "To release") +
      stat("milestone", out, "On the way") +
      stat("check", done, "Delivered") +
      stat("cloche", cooking, "Still in the kitchen"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      todo: orders.filter(W.isRequested).length,
      out: orders.filter((o) => W.stageOf(o) === "released").length,
      done: orders.filter((o) => W.stageOf(o) === "delivered").length,
      all: orders.length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("todo", "To release") + chip("out", "On the way") +
      chip("done", "Delivered") + chip("all", "Everything");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    return orders.filter((o) => {
      const st = W.stageOf(o);
      if (filter === "todo" && !W.isRequested(o)) return false;
      if (filter === "out" && st !== "released") return false;
      if (filter === "done" && st !== "delivered") return false;
      if (!query) return true;
      return [o.clientName, o.kindOfFunction, o.venue, o.functionDate]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function badgeFor(o) {
    if (W.isRequested(o)) return `<span class="badge badge-gold"><span class="dot"></span>Asking for release</span>`;
    if (W.isRejected(o)) return `<span class="badge badge-warn">Sent back</span>`;
    const st = W.stageOf(o);
    if (st === "delivered") return `<span class="badge badge-ok">Delivered</span>`;
    if (st === "released") return `<span class="badge badge-ok">On the way</span>`;
    return `<span class="badge badge-cat">${HP.esc(W.labelOf(st))}</span>`;
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(orders.length
        ? (filter === "todo"
            ? "Nothing is waiting on you — the kitchen hasn't asked for a release yet."
            : "Nothing here — try another filter or search.")
        : "No confirmed orders yet.");
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
          <button class="icon-btn" data-act="open" title="Open the workflow"
            aria-label="Open ${HP.esc(clientName(o))}'s workflow"><span class="ic">${HP.icon("milestone")}</span></button>
        </td>
      </tr>`).join(""));
    HP.hydrateIcons(rowsEl);

    const open = (id) => { const o = orders.find((x) => x.id === id); if (o) openOrder(o); };
    rowsEl.querySelectorAll("[data-act='open']").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); open(e.currentTarget.closest("tr").dataset.id); }));
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) open(tr.dataset.id); }));
  }

  /* ── The workflow sheet ────────────────────────────────────────────────── */
  function openOrder(o) {
    const st = W.stageOf(o);
    const requested = W.isRequested(o);
    const f = W.ful(o);
    const mayRelease = W.canDrive(HP.user.roleKey, "released");

    let flag = "";
    if (requested) {
      flag = `<p class="wf-flag"><strong>${HP.esc(f.requestedByName || "The kitchen")}</strong>
        asked for this to be released ${HP.esc(W.fmtWhen(f.requestedAt))}.
        ${f.requestNote ? HP.esc(f.requestNote) : ""}</p>`;
    } else if (W.indexOf(st) < W.indexOf("released")) {
      flag = `<p class="wf-flag"><strong>Not asked for yet.</strong>
        The kitchen marks an order ready and requests release — it will appear
        in your queue then.</p>`;
    }

    const acts = [];
    if (mayRelease && requested) {
      acts.push(`<button class="btn btn-ghost btn-danger" id="wfReject"><span class="ic">${HP.icon("ban")}</span>Reject</button>`);
      acts.push(`<button class="btn btn-primary" id="wfRelease"><span class="ic">${HP.icon("truck")}</span>Approve &amp; release</button>`);
    } else if (mayRelease && st === "released") {
      acts.push(`<button class="btn btn-primary" id="wfDeliver"><span class="ic">${HP.icon("check")}</span>Mark delivered</button>`);
    }

    HP.openModal(`${clientName(o)} · ${W.labelOf(st)}`, `
      <div class="wf-sheet">
        <div class="ck-head">
          <div>
            <p class="ck-client"><strong>${HP.esc(clientName(o))}</strong>
              ${o.kindOfFunction ? ` · ${HP.esc(o.kindOfFunction)}` : ""}</p>
            <p class="ck-meta">${HP.esc(o.functionDate || "")}${
              o.venue ? " · " + HP.esc(o.venue) : ""}${
              o.pax ? " · " + HP.esc(String(o.pax)) + " pax" : ""}</p>
          </div>
        </div>

        ${W.railHTML(o)}
        ${flag}
        ${W.historyHTML(o)}

        ${acts.length ? `
          <div class="field" style="margin-top:14px">
            <label>Note${requested ? " (a reason is required to reject)" : " (optional)"}</label>
            <input class="control" id="wfNote" placeholder="${
              requested ? "e.g. two trays short of the pax count" : "e.g. received by the venue coordinator"}" />
          </div>` : ""}
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>${acts.join("")}`);

    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    const note = () => {
      const el = document.getElementById("wfNote");
      return el ? el.value.trim() : "";
    };
    const rel = document.getElementById("wfRelease");
    if (rel) rel.addEventListener("click", () => release(o, note()));
    const rej = document.getElementById("wfReject");
    if (rej) rej.addEventListener("click", () => reject(o, note()));
    const del = document.getElementById("wfDeliver");
    if (del) del.addEventListener("click", () => deliver(o, note()));
  }

  /* ── Writes ─────────────────────────────────────────────────────────────
     Transactional against the live booking: the kitchen may withdraw its ask
     while this sheet is open, and approving a request that no longer exists
     would release food nobody said was ready. */
  let saving = false;
  async function commit(o, mutate, okMsg) {
    if (saving) return;
    saving = true;
    const btns = [...document.querySelectorAll(".modal-foot .btn")];
    btns.forEach((b) => { b.disabled = true; });
    try {
      const ref = db.collection("bookings").doc(o.id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const cur = snap.data() || {};
        tx.set(ref, { fulfilment: mutate(cur.fulfilment || {}, cur) }, { merge: true });
      });
      HP.closeModal();
      HP.toast(okMsg, "ok");
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That order no longer exists.", "warn");
      else if (e && e.code === "hp/stale") HP.toast(e.message, "warn");
      else {
        console.warn("HapagPamana: dispatch write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't update this order."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      saving = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  function release(o, note) {
    commit(o, (f) => {
      if (!f.requestedAt) {
        throw Object.assign(new Error("The kitchen withdrew this request — ask them to send it again."),
          { code: "hp/stale" });
      }
      return Object.assign({}, f, {
        stage: "released",
        history: (Array.isArray(f.history) ? f.history : []).concat([W.entry("released", note)]),
        releasedAt: Date.now(),
        releasedByName: HP.user.name || "—",
        // The ask is answered; clear any older refusal so the rail is clean.
        rejectedAt: null, rejectedByName: null, rejectReason: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByName: HP.user.name || "—",
      });
    }, "Released — the kitchen has been told.");
  }

  function reject(o, reason) {
    if (!reason) return HP.toast("Say why — the kitchen needs to know what to fix.", "danger");
    commit(o, (f) => Object.assign({}, f, {
      // The order stays where it was; only the ask is refused. Sending it
      // back a stage would erase the kitchen's own record of finishing.
      stage: f.stage || "ready",
      history: (Array.isArray(f.history) ? f.history : []).concat([
        Object.assign(W.entry(f.stage || "ready", reason), { note: `Release refused — ${reason}` })]),
      rejectedAt: Date.now(),
      rejectedByName: HP.user.name || "—",
      rejectReason: reason,
      requestedAt: null, requestedByName: null, requestNote: null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: HP.user.name || "—",
    }), "Sent back to the kitchen with your reason.");
  }

  function deliver(o, note) {
    commit(o, (f) => Object.assign({}, f, {
      stage: "delivered",
      history: (Array.isArray(f.history) ? f.history : []).concat([W.entry("delivered", note)]),
      deliveredAt: Date.now(),
      deliveredByName: HP.user.name || "—",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: HP.user.name || "—",
    }), "Marked delivered.");
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["Client", "Event", "Function date", "Venue", "Pax", "Stage",
      "Requested by", "Requested", "Released by", "Delivered", "Last reason"];
    const lines = [head.map(cell).join(",")];
    list.forEach((o) => {
      const f = W.ful(o);
      lines.push([
        clientName(o), o.kindOfFunction || "", o.functionDate || "", o.venue || "",
        o.pax || "", W.labelOf(W.stageOf(o)),
        f.requestedByName || "", f.requestedAt ? W.fmtWhen(f.requestedAt) : "",
        f.releasedByName || "", f.deliveredAt ? W.fmtWhen(f.deliveredAt) : "",
        f.rejectReason || "",
      ].map(cell).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_dispatch.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Dispatch board exported as CSV.");
  }

  /* ── Equipment pickups ─────────────────────────────────────────────────────
     A second, independent lane on the SAME confirmed-bookings stream above:
     the Catering Equipment desk stamps bookings/{id}.equipmentPickup the
     moment it marks a checklist "ready for release" (see
     Catering Equipment/js/prep.js commitReady) — no waiting on the food
     release this page already tracks via HPFul/`fulfilment`. Only bookings
     with an active request/pickup/delivery appear here; most bookings won't
     have this field at all and are simply absent from the list, same as how
     the food queue's "todo" filter only shows what's actually asking. */
  const epu = (o) => (o && o.equipmentPickup) || {};
  const epuStage = (o) => epu(o).stage || "none";
  const EPU_LABEL = { requested: "To pick up", picked_up: "Picked up", delivered: "Delivered" };
  const EPU_BADGE = { requested: "badge-gold", picked_up: "badge-ok", delivered: "badge-cat" };
  // Whether Catering Equipment has confirmed the gear physically came back —
  // read-only here (equipmentPrep is that desk's own field; see
  // Catering Equipment/js/prep.js commitReturn). This desk's own stage stays
  // at "delivered" — the pickup lane tracks getting equipment TO the venue,
  // not its return — so a returned event is flagged on top of that badge
  // rather than getting a stage of its own.
  const epuReturned = (o) => ((o.equipmentPrep || {}).status === "returned");

  function epuActive() {
    return orders.filter((o) => ["requested", "picked_up", "delivered"].includes(epuStage(o)));
  }

  function epuVisible() {
    return epuActive().filter((o) => {
      const st = epuStage(o);
      if (epuFilter === "todo" && st !== "requested") return false;
      if (epuFilter === "picked" && st !== "picked_up") return false;
      if (epuFilter === "delivered" && st !== "delivered") return false;
      return true;
    });
  }

  function renderEquipAll() { renderEquipStats(); renderEquipChips(); renderEquipRows(); }

  function renderEquipStats() {
    const active = epuActive();
    const todo = active.filter((o) => epuStage(o) === "requested").length;
    const pickedUp = active.filter((o) => epuStage(o) === "picked_up").length;
    const delivered = active.filter((o) => epuStage(o) === "delivered").length;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(epuStatsEl,
      stat("crate", todo, "To pick up") +
      stat("milestone", pickedUp, "Picked up") +
      stat("check", delivered, "Delivered"))) HP.countUp(epuStatsEl);
  }

  function renderEquipChips() {
    const active = epuActive();
    const counts = {
      todo: active.filter((o) => epuStage(o) === "requested").length,
      picked: active.filter((o) => epuStage(o) === "picked_up").length,
      delivered: active.filter((o) => epuStage(o) === "delivered").length,
      all: active.length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${epuFilter === key ? "active" : ""}" data-epuchip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    epuChipsEl.innerHTML = chip("todo", "To pick up") + chip("picked", "Picked up") +
      chip("delivered", "Delivered") + chip("all", "Everything");
    epuChipsEl.querySelectorAll("[data-epuchip]").forEach((b) =>
      b.addEventListener("click", () => { epuFilter = b.dataset.epuchip; renderEquipChips(); renderEquipRows(); }));
  }

  function renderEquipRows() {
    if (!loaded) return;
    const list = epuVisible();
    if (!list.length) {
      epuRowsEl.innerHTML = `<tr><td colspan="5" class="table-empty">${HP.esc(epuActive().length
        ? "Nothing here — try another filter."
        : "Nothing waiting on equipment pickup yet.")}</td></tr>`;
      return;
    }
    HP.shell.paint(epuRowsEl, list.map((o) => `
      <tr data-eid="${HP.esc(o.id)}">
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(clientName(o))}</strong>
            <small>${HP.esc(o.venue || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(o.kindOfFunction || "—")}</td>
        <td>${HP.esc(o.functionDate || "—")}</td>
        <td><span class="badge ${EPU_BADGE[epuStage(o)]}">${HP.esc(EPU_LABEL[epuStage(o)] || "—")}</span>${
          epuStage(o) === "delivered" && epuReturned(o)
            ? ` <span class="badge badge-ok" title="Catering Equipment confirmed this gear is back">Returned</span>` : ""}</td>
        <td class="row-actions">
          <button class="icon-btn" data-epuact="open" title="Open"
            aria-label="Open ${HP.esc(clientName(o))}'s equipment pickup"><span class="ic">${HP.icon("milestone")}</span></button>
        </td>
      </tr>`).join(""));
    HP.hydrateIcons(epuRowsEl);

    const open = (id) => { const o = orders.find((x) => x.id === id); if (o) openEquipOrder(o); };
    epuRowsEl.querySelectorAll("[data-epuact='open']").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); open(e.currentTarget.closest("tr").dataset.eid); }));
    epuRowsEl.querySelectorAll("tr[data-eid]").forEach((tr) =>
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) open(tr.dataset.eid); }));
  }

  /* A lighter modal than the food workflow sheet above — no rail, since
     there's no shared 3+-desk state machine here (only Catering Equipment
     writes "requested"; only Logistics ever advances past it). Just the
     event, the checklist Catering Equipment locked in, and whichever of
     "Mark picked up" / "Mark delivered" applies to the current stage. */
  function openEquipOrder(o) {
    const p = epu(o);
    const st = epuStage(o);
    const checklist = Array.isArray((o.equipmentPrep || {}).checklist) ? o.equipmentPrep.checklist : [];

    const acts = [];
    if (st === "requested") acts.push(`<button class="btn btn-primary" id="epuPickup"><span class="ic">${HP.icon("crate")}</span>Mark picked up</button>`);
    if (st === "picked_up") acts.push(`<button class="btn btn-primary" id="epuDeliver"><span class="ic">${HP.icon("check")}</span>Mark delivered</button>`);

    HP.openModal(`${clientName(o)} · Equipment pickup`, `
      <div class="wf-sheet">
        <div class="ck-head">
          <div>
            <p class="ck-client"><strong>${HP.esc(clientName(o))}</strong>
              ${o.kindOfFunction ? ` · ${HP.esc(o.kindOfFunction)}` : ""}</p>
            <p class="ck-meta">${HP.esc(o.functionDate || "")}${
              o.venue ? " · " + HP.esc(o.venue) : ""}</p>
          </div>
          <span class="badge ${EPU_BADGE[st]}">${HP.esc(EPU_LABEL[st] || "—")}</span>
        </div>
        <p class="wf-flag">${st === "requested"
          ? `<strong>${HP.esc(p.requestedByName || "Catering Equipment")}</strong> asked for pickup ${HP.esc(fmtEpuWhen(p.requestedAt))}.`
          : st === "picked_up"
          ? `Picked up ${HP.esc(fmtEpuWhen(p.pickedUpAt))}${p.pickedUpByName ? ` by ${HP.esc(p.pickedUpByName)}` : ""}.`
          : `Delivered ${HP.esc(fmtEpuWhen(p.deliveredAt))}${p.deliveredByName ? ` by ${HP.esc(p.deliveredByName)}` : ""}.`}</p>
        ${st === "delivered" && epuReturned(o) ? `<p class="wf-flag">
          <strong>Returned.</strong> Catering Equipment confirmed this gear is back${
            (o.equipmentPrep || {}).returnedByName ? ` — recorded by ${HP.esc(o.equipmentPrep.returnedByName)}` : ""}.</p>` : ""}
        <div class="table-wrap">
          <table class="data">
            <thead><tr><th>Item</th><th>Variant</th><th>Qty</th></tr></thead>
            <tbody>${checklist.length ? checklist.map((l) => `
              <tr><td>${HP.esc(l.itemName)}</td><td>${HP.esc(l.variantLabel)}</td><td>${HP.esc(String(l.qty))}</td></tr>`).join("")
              : `<tr><td colspan="3" class="table-empty">No checklist lines.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>${acts.join("")}`);

    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    const pickupBtn = document.getElementById("epuPickup");
    if (pickupBtn) pickupBtn.addEventListener("click", () => commitPickup(o, "picked_up"));
    const deliverBtn = document.getElementById("epuDeliver");
    if (deliverBtn) deliverBtn.addEventListener("click", () => commitPickup(o, "delivered"));
  }

  function fmtEpuWhen(ms) {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  /* Transactional against the live booking, merging ONLY equipmentPickup —
     the same discipline as commit() above for `fulfilment`, so this queue
     can never collide with the food release, Orders, or Catering
     Equipment's own equipmentPrep field on the same document. */
  let epuSaving = false;
  async function commitPickup(o, toStage) {
    if (epuSaving) return;
    epuSaving = true;
    const btns = [...document.querySelectorAll(".modal-foot .btn")];
    btns.forEach((b) => { b.disabled = true; });
    try {
      const ref = db.collection("bookings").doc(o.id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const cur = snap.data() || {};
        const p = cur.equipmentPickup || {};
        if (!p.stage || p.stage === "delivered") {
          throw Object.assign(new Error("stale"), { code: "hp/stale" });
        }
        const patch = Object.assign({}, p, {
          stage: toStage,
          history: (Array.isArray(p.history) ? p.history : []).concat([
            { stage: toStage, at: Date.now(), byName: HP.user.name || "—", note: "" },
          ]),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByName: HP.user.name || "—",
        });
        if (toStage === "picked_up") { patch.pickedUpAt = Date.now(); patch.pickedUpByName = HP.user.name || "—"; }
        if (toStage === "delivered") { patch.deliveredAt = Date.now(); patch.deliveredByName = HP.user.name || "—"; }
        tx.set(ref, { equipmentPickup: patch }, { merge: true });
      });
      HP.closeModal();
      HP.toast(toStage === "picked_up" ? "Marked picked up." : "Marked delivered.", "ok");
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That event no longer exists.", "warn");
      else if (e && e.code === "hp/stale") HP.toast("This pickup was withdrawn or already finished — refresh and try again.", "warn");
      else {
        console.warn("HapagPamana: equipment pickup write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't update this pickup."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      epuSaving = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }
})();
