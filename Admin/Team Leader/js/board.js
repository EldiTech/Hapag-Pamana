/* HapagPamana · Team Leader — the Order Board.

   Every confirmed order the kitchen is cooking, and where each one stands on
   the way to the event. The team leader:

     · moves an order Preparing → Ready as the food is finished,
     · asks logistics to release it, with a note,
     · watches the rail for logistics' answer.

   The stage lives on the booking (bookings/{id}.fulfilment) so both desks and
   the customer's own tracking screen read one record — see hp-fulfilment.js.

   This desk deliberately CANNOT release: "Ready" is the kitchen's word that
   the food is finished, "Released" is logistics' word that it has left, and
   keeping them apart is what makes the handover a record rather than a
   conversation.

   Requires the team_leader (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const W = window.HPFul;

  HP.shell.init();
  HP.shell.setPage({
    title: "Order Board",
    sub: "What the kitchen is cooking, and how far along each order is.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("tlStats");
  const chipsEl = document.getElementById("tlChips");
  const rowsEl = document.getElementById("tlRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  let orders = [];
  let query = "";
  let filter = "active";
  let loaded = false;
  let unsub = null;

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
    // Only what the kitchen actually has to cook. Trashed bookings never
    // reach the floor.
    unsub = db.collection("bookings").where("status", "==", "confirmed").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        orders = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((o) => !o.deleted);
        orders.sort(byFunctionDate);
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

  // Soonest event first; undated orders sink. MAX_SAFE_INTEGER rather than
  // Infinity — two undated orders would compare Infinity - Infinity = NaN.
  const dateKey = (o) => {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  };
  const byFunctionDate = (a, b) => dateKey(a) - dateKey(b);
  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    const prep = orders.filter((o) => W.stageOf(o) === "preparing").length;
    const ready = orders.filter((o) => W.stageOf(o) === "ready").length;
    const waiting = orders.filter(W.isRequested).length;
    const sentBack = orders.filter(W.isRejected).length;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("cloche", prep, "Preparing") +
      stat("check", ready, "Ready to go") +
      stat("truck", waiting, "Awaiting release") +
      stat("ban", sentBack, "Sent back"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      active: orders.filter((o) => W.indexOf(W.stageOf(o)) < W.indexOf("delivered")).length,
      preparing: orders.filter((o) => W.stageOf(o) === "preparing").length,
      ready: orders.filter((o) => W.stageOf(o) === "ready").length,
      done: orders.filter((o) => W.stageOf(o) === "delivered").length,
      all: orders.length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("active", "On the floor") + chip("preparing", "Preparing") +
      chip("ready", "Ready") + chip("done", "Delivered") + chip("all", "Everything");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    return orders.filter((o) => {
      const st = W.stageOf(o);
      if (filter === "active" && st === "delivered") return false;
      if (filter === "preparing" && st !== "preparing") return false;
      if (filter === "ready" && st !== "ready") return false;
      if (filter === "done" && st !== "delivered") return false;
      if (!query) return true;
      return [o.clientName, o.kindOfFunction, o.venue, o.functionDate]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function badgeFor(o) {
    if (W.isRejected(o)) return `<span class="badge badge-warn">Sent back</span>`;
    if (W.isRequested(o)) return `<span class="badge badge-gold"><span class="dot"></span>Awaiting release</span>`;
    const st = W.stageOf(o);
    if (st === "delivered") return `<span class="badge badge-ok">Delivered</span>`;
    if (st === "released") return `<span class="badge badge-ok">Released</span>`;
    if (st === "ready") return `<span class="badge badge-gold">Ready</span>`;
    return `<span class="badge badge-cat">Preparing</span>`;
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(orders.length
        ? "Nothing here — try another filter or search."
        : "No confirmed orders yet — they appear once the Orders desk accepts a booking.");
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

  /* ── The workflow sheet ─────────────────────────────────────────────────
     The rail, the account of how the order got here, and whatever this desk
     may do next. Buttons are built from canDrive, never from the stage alone:
     an order already with logistics shows the rail and nothing to press. */
  function openOrder(o) {
    const st = W.stageOf(o);
    const mine = W.canDrive(HP.user.roleKey, st);
    const requested = W.isRequested(o);
    const rejected = W.isRejected(o);
    const f = W.ful(o);

    let flag = "";
    if (rejected) {
      flag = `<p class="wf-flag is-bad"><strong>Logistics sent this back.</strong>
        ${HP.esc(f.rejectReason || "No reason was given.")}
        Fix what they flagged, then ask again.</p>`;
    } else if (requested) {
      flag = `<p class="wf-flag"><strong>Waiting on logistics.</strong>
        Release was requested ${HP.esc(W.fmtWhen(f.requestedAt))}${
          f.requestedByName ? ` by ${HP.esc(f.requestedByName)}` : ""}.</p>`;
    }

    // What this desk can press, in the order it would be pressed.
    const acts = [];
    if (mine && st === "preparing") {
      acts.push(`<button class="btn btn-primary" id="wfNext"><span class="ic">${HP.icon("check")}</span>Mark ready</button>`);
    }
    if (mine && st === "ready" && !requested) {
      acts.push(`<button class="btn btn-primary" id="wfAsk"><span class="ic">${HP.icon("truck")}</span>${
        rejected ? "Ask logistics again" : "Request release"}</button>`);
      acts.push(`<button class="btn btn-ghost" id="wfBack">Back to preparing</button>`);
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
            <label>Note (optional)</label>
            <input class="control" id="wfNote" placeholder="${
              st === "ready" ? "e.g. 12 trays packed, ready at the loading bay" : "e.g. started at 4am"}" />
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
    const nextBtn = document.getElementById("wfNext");
    if (nextBtn) nextBtn.addEventListener("click", () => move(o, "ready", note()));
    const backBtn = document.getElementById("wfBack");
    if (backBtn) backBtn.addEventListener("click", () => move(o, "preparing", note()));
    const askBtn = document.getElementById("wfAsk");
    if (askBtn) askBtn.addEventListener("click", () => request(o, note()));
  }

  /* ── Writes ─────────────────────────────────────────────────────────────
     Both go through a transaction against the live booking: the order board
     and logistics are looking at the same document, and a stale snapshot
     would let one desk's write erase the other's. */
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
        const f = cur.fulfilment || {};
        tx.set(ref, { fulfilment: mutate(f) }, { merge: true });
      });
      HP.closeModal();
      HP.toast(okMsg, "ok");
    } catch (e) {
      if (e && e.code === "hp/gone") HP.toast("That order no longer exists.", "warn");
      else if (e && e.code === "hp/moved") HP.toast(e.message, "warn");
      else {
        console.warn("HapagPamana: fulfilment write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't update this order."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      saving = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  function move(o, to, note) {
    commit(o, (f) => {
      // Once logistics has it, the kitchen no longer moves the order.
      if (W.indexOf(f.stage || "preparing") >= W.indexOf("released")) {
        throw Object.assign(new Error("Logistics already has this order."), { code: "hp/moved" });
      }
      const hist = (Array.isArray(f.history) ? f.history : []).concat([W.entry(to, note)]);
      const patch = Object.assign({}, f, {
        stage: to,
        history: hist,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByName: HP.user.name || "—",
      });
      // Stepping back to preparing withdraws any outstanding ask, so
      // logistics is not left holding a request for food that isn't ready.
      if (to === "preparing") {
        patch.requestedAt = null;
        patch.requestedByName = null;
        patch.requestNote = null;
      }
      return patch;
    }, to === "ready" ? "Marked ready." : "Back to preparing.");
  }

  function request(o, note) {
    commit(o, (f) => Object.assign({}, f, {
      stage: "ready",
      requestedAt: Date.now(),
      requestedByName: HP.user.name || "—",
      requestNote: note,
      // A fresh ask clears the last refusal, so the rail stops showing it.
      rejectedAt: null,
      rejectedByName: null,
      rejectReason: null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: HP.user.name || "—",
    }), "Logistics has been asked to release this order.");
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["Client", "Event", "Function date", "Venue", "Pax", "Stage",
      "Awaiting release", "Last note", "Updated by"];
    const lines = [head.map(cell).join(",")];
    list.forEach((o) => {
      const f = W.ful(o);
      const hist = Array.isArray(f.history) ? f.history : [];
      lines.push([
        clientName(o), o.kindOfFunction || "", o.functionDate || "", o.venue || "",
        o.pax || "", W.labelOf(W.stageOf(o)), W.isRequested(o) ? "yes" : "",
        (hist.length ? hist[hist.length - 1].note : "") || "", f.updatedByName || "",
      ].map(cell).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_order_board.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Order board exported as CSV.");
  }
})();
