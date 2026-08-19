/* HapagPamana · Stock Clerk — receiving.
   What purchasing has handed over, checked in line by line. For each line the
   clerk records how much was actually accepted and how much was turned away,
   with a reason — partial acceptance is the norm in a market run (8 of 10 kilos
   usable), and a plain received/not-received tick would throw that detail away
   exactly where it matters most.

   A run arrives here at stage "delivered" and leaves at "liquidation". The
   stages and the arithmetic live in ../../assets/hp-procurement.js, shared with
   purchasing, so both desks agree about what a line means.

   Requires the stock_clerk (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const P = window.HPProc;
  const K = window.HPPantry;

  HP.shell.init();
  HP.shell.setPage({
    title: "Receiving",
    sub: "Check in what purchasing delivered, line by line.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("recvStats");
  const chipsEl = document.getElementById("recvChips");
  const rowsEl = document.getElementById("recvRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  let runs = [];
  let query = "";
  let filter = "todo";
  let loaded = false;
  let unsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(7, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      chipsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("Deliveries live in Firestore — connect Firebase to read them.");
      return;
    }
    /* Everything from "delivered" onward is this desk's business; earlier runs
       are still with the buyer. Filtering in the page rather than the query
       keeps us off a composite index for a collection this small. */
    unsub = db.collection("procurements").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        runs = snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((r) => P.indexOf(r.stage || "released") >= P.indexOf("delivered"));
        loaded = true;
        render();
      }, (e) => {
        statsEl.innerHTML = "";
        chipsEl.innerHTML = "";
        rowsEl.innerHTML = emptyRow(e && e.code === "permission-denied"
          ? "Your role can't read the deliveries."
          : "Couldn't reach Firestore — check your connection.");
        console.warn("HapagPamana: receiving —", e);
      });
  }

  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  function render() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    const waiting = runs.filter((r) => r.stage === "delivered").length;
    const checking = runs.filter((r) => r.stage === "checking").length;
    let rejected = 0, accepted = 0;
    runs.forEach((r) => {
      (r.items || []).forEach((it) => {
        if (Number(it.qtyRejected) > 0) rejected += 1;
        if (it.qc === "pass") accepted += 1;
      });
    });
    statsEl.innerHTML =
      stat("crates", String(waiting), "Awaiting check-in") +
      stat("check", String(checking), "Being checked") +
      stat("basket", String(accepted), "Lines accepted") +
      stat("ban", String(rejected), "Lines with rejects");
    HP.hydrateIcons(statsEl);
  }

  /* Same shape the costing board uses — the shell styles .stat-top,
     .stat-num and .stat-label, and nothing else. */
  function stat(icon, value, label, asMoney) {
    return `<div class="stat">
      <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(icon)}</span></span></div>
      ${asMoney
        ? `<div class="stat-num stat-num--money">${HP.esc(value)}</div>`
        : `<div class="stat-num" data-count="${HP.esc(value)}">${HP.esc(value)}</div>`}
      <div class="stat-label">${HP.esc(label)}</div>
    </div>`;
  }

  const FILTERS = [
    { key: "todo", label: "To check" },
    { key: "done", label: "Checked" },
    { key: "all", label: "All" },
  ];

  function renderChips() {
    chipsEl.className = "seg";
    chipsEl.innerHTML = FILTERS.map((f) =>
      `<button class="seg-btn${filter === f.key ? " active" : ""}" data-f="${f.key}" type="button">${HP.esc(f.label)}<span class="seg-count">${countFor(f.key)}</span></button>`
    ).join("");
    chipsEl.querySelectorAll("[data-f]").forEach((b) =>
      b.addEventListener("click", () => {
        filter = b.dataset.f;
        chipsEl.classList.add("anim");
        renderChips();
        renderRows();
      }));
  }

  function countFor(key) {
    if (key === "all") return runs.length;
    if (key === "todo") return runs.filter((r) => r.stage === "delivered" || r.stage === "checking").length;
    return runs.filter((r) => P.indexOf(r.stage) >= P.indexOf("liquidation")).length;
  }

  function visible() {
    const q = query.trim().toLowerCase();
    return runs
      .filter((r) => {
        if (filter === "all") return true;
        if (filter === "todo") return r.stage === "delivered" || r.stage === "checking";
        return P.indexOf(r.stage) >= P.indexOf("liquidation");
      })
      .filter((r) => !q || [r.slipNumber, r.clientName, r.kindOfFunction, r.functionDate]
        .join(" ").toLowerCase().includes(q));
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(runs.length
        ? "No delivery matches that filter."
        : "Nothing delivered yet — purchasing hasn't handed a run over.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((r) => {
      const st = P.stage(r.stage);
      const items = r.items || [];
      const bought = items.filter((it) => it.bought);
      const checked = bought.filter((it) => it.qc).length;
      return `<tr data-id="${HP.esc(r.id)}">
        <td><strong>${HP.esc(r.slipNumber || "—")}</strong></td>
        <td>${HP.esc(r.clientName || "—")}</td>
        <td>${HP.esc(r.kindOfFunction || "—")}<br><small>${HP.esc(r.functionDate || "")}</small></td>
        <td>${HP.esc(String(bought.length))}</td>
        <td>${HP.esc(`${checked}/${bought.length}`)}</td>
        <td><span class="badge ${HP.esc(st.badge)}"><span class="dot"></span>${HP.esc(st.label)}</span></td>
        <td class="row-actions">
          <button class="icon-btn" data-act="open" title="Check this delivery in"
            aria-label="Check in ${HP.esc(r.clientName || "delivery")}"><span class="ic">${HP.icon("crates")}</span></button>
        </td>
      </tr>`;
    }).join(""));
    HP.hydrateIcons(rowsEl);
    rowsEl.querySelectorAll("[data-act='open']").forEach((b) =>
      b.addEventListener("click", (e) => {
        const id = e.target.closest("tr").dataset.id;
        openRun(runs.find((r) => r.id === id));
      }));
  }

  function emptyRow(msg) { return `<tr><td colspan="7" class="empty">${HP.esc(msg)}</td></tr>`; }

  /* ── Check-in sheet ───────────────────────────────────────────────────── */
  function openRun(run) {
    if (!run) return;
    const stage = run.stage || "delivered";
    // A delivered run has not been opened yet; checking is this desk's stage.
    const mine = stage === "delivered" || stage === "checking";
    const readOnly = !mine || !P.canDrive(HP.user.roleKey, "checking");

    const bought = (run.items || []).filter((it) => it.bought);
    if (!bought.length) {
      HP.toast("Purchasing didn't tick anything on this run.", "warn");
      return;
    }

    const foot = readOnly
      ? `<button class="btn btn-ghost" data-close>Close</button>`
      : `<button class="btn btn-ghost" data-close>Cancel</button>
         <button class="btn btn-ghost" id="qcSave">Save</button>
         <button class="btn btn-primary" id="qcDone">Save &amp; send to liquidation</button>`;

    HP.openModal(`Check in · ${run.slipNumber || "delivery"}`, sheetHTML(run, bought, readOnly), foot);

    const root = document.querySelector(".modal");
    if (!root) return;
    root.classList.add("modal--wide");
    HP.hydrateIcons(root);
    wire(root);
    if (readOnly) return;
    root.querySelector("#qcSave").addEventListener("click", () => save(run, root, false));
    root.querySelector("#qcDone").addEventListener("click", () => save(run, root, true));
  }

  function sheetHTML(run, bought, readOnly) {
    const byDish = new Map();
    bought.forEach((it) => {
      const k = it.dish || "Other";
      if (!byDish.has(k)) byDish.set(k, []);
      byDish.get(k).push(it);
    });
    const groups = [...byDish.entries()].map(([dish, rows]) => `
      <tbody class="ck-group">
        <tr class="ck-dish"><th colspan="5">${HP.esc(dish)}</th></tr>
        ${rows.map((it) => lineHTML(it, readOnly)).join("")}
      </tbody>`).join("");

    return `
      <div class="ck-head">
        <div>
          <p class="ck-client"><strong>${HP.esc(run.clientName || "—")}</strong> · ${HP.esc(run.kindOfFunction || "")}</p>
          <p class="ck-meta">${HP.esc(run.functionDate || "")}${run.venue ? " · " + HP.esc(run.venue) : ""}</p>
        </div>
        <div class="ck-money">
          <span><small>Delivered by</small><strong>${HP.esc(run.updatedByName || run.startedByName || "—")}</strong></span>
        </div>
      </div>

      ${readOnly ? `<p class="ck-note">This run isn't at your desk — it's read-only here.</p>` : ""}

      <div class="ck-wrap">
        <table class="data ck-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Bought</th>
              <th>Accepted</th>
              <th>Rejected</th>
              <th>Quality</th>
            </tr>
          </thead>
          ${groups}
        </table>
      </div>

      <div class="ck-foot">
        <p class="ck-hint">Rejected stock still needs a reason — it's what finance reads when the money doesn't match.</p>
      </div>`;
  }

  function lineHTML(it, readOnly) {
    const dis = readOnly ? " disabled" : "";
    // Default the accepted quantity to what was bought: the common case is
    // everything is fine, and making the clerk retype it invites errors.
    const acc = it.qtyAccepted === null || it.qtyAccepted === undefined ? "" : it.qtyAccepted;
    const rej = it.qtyRejected === null || it.qtyRejected === undefined ? "" : it.qtyRejected;
    return `<tr data-key="${HP.esc(it.key)}">
      <td>
        <strong>${HP.esc(it.ingredient)}</strong>
        ${it.note ? `<small class="qc-buyer">Buyer: ${HP.esc(it.note)}</small>` : ""}
        <input type="text" class="qc-note" placeholder="Reason if rejected…"
               value="${HP.esc(it.qcNote || "")}"${dis} />
      </td>
      <td class="ck-num">${HP.esc(P.qty(it.qtyBought, it.unit))}</td>
      <td class="ck-num">
        <input type="number" class="qc-acc" min="0" step="any" inputmode="decimal"
               placeholder="${HP.esc(String(it.qtyBought === null ? "" : it.qtyBought))}"
               value="${HP.esc(String(acc))}"${dis} />
      </td>
      <td class="ck-num">
        <input type="number" class="qc-rej" min="0" step="any" inputmode="decimal"
               placeholder="0" value="${HP.esc(String(rej))}"${dis} />
      </td>
      <td class="qc-verdict">
        <div class="qc-seg" role="group" aria-label="Quality for ${HP.esc(it.ingredient)}">
          <label class="qc-opt qc-pass">
            <input type="radio" name="qc-${HP.esc(it.key)}" value="pass"${it.qc === "pass" ? " checked" : ""}${dis} />
            <span>Pass</span>
          </label>
          <label class="qc-opt qc-fail">
            <input type="radio" name="qc-${HP.esc(it.key)}" value="fail"${it.qc === "fail" ? " checked" : ""}${dis} />
            <span>Fail</span>
          </label>
        </div>
      </td>
    </tr>`;
  }

  /* Ticking "pass" with nothing typed means "all of it was fine" — fill the
     accepted quantity in rather than making the clerk type what the buyer
     already recorded. */
  function wire(root) {
    root.addEventListener("change", (e) => {
      const radio = e.target.closest("input[type=radio]");
      if (!radio) return;
      const tr = radio.closest("tr[data-key]");
      if (!tr) return;
      const acc = tr.querySelector(".qc-acc");
      if (radio.value === "pass" && !acc.value) acc.value = acc.placeholder || "";
    });
  }

  function readLines(root) {
    return [...root.querySelectorAll("tr[data-key]")].map((tr) => {
      const picked = tr.querySelector("input[type=radio]:checked");
      return {
        key: tr.dataset.key,
        qc: picked ? picked.value : null,
        qtyAccepted: numOrNull(tr.querySelector(".qc-acc").value),
        qtyRejected: numOrNull(tr.querySelector(".qc-rej").value),
        qcNote: tr.querySelector(".qc-note").value.trim(),
      };
    });
  }

  function numOrNull(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function save(run, root, finish) {
    const edits = readLines(root);
    const byKey = Object.create(null);
    edits.forEach((e) => { byKey[e.key] = e; });

    if (finish) {
      const unchecked = edits.filter((e) => !e.qc).length;
      if (unchecked) {
        return HP.toast(`${unchecked} line${unchecked === 1 ? " still needs" : "s still need"} a pass or fail.`, "warn");
      }
      const unexplained = edits.filter((e) => (e.qtyRejected > 0 || e.qc === "fail") && !e.qcNote).length;
      if (unexplained) {
        return HP.toast(`${unexplained} rejected line${unexplained === 1 ? " needs" : "s need"} a reason.`, "warn");
      }
    }

    const items = (run.items || []).map((it) => {
      const e = byKey[it.key];
      if (!e) return it;
      return Object.assign({}, it, {
        qc: e.qc,
        qtyAccepted: e.qtyAccepted,
        qtyRejected: e.qtyRejected,
        qcNote: e.qcNote,
      });
    });

    /* Advance to "checking" only once this desk has actually checked
       something. Saving used to move the run there unconditionally, so simply
       OPENING a delivered run and pressing save walked it past the buyer's
       stage — which is what stranded runs with nothing bought: the buyer lost
       the checklist, and (before canAttachReceipts) the receipt drawer too,
       while liquidation still refused to file without a receipt.

       A run with no quality marks yet stays "delivered", so the buyer can
       still finish their end. The clerk's own board treats delivered and
       checking identically (both sit in "To check"), so nothing disappears
       from this desk by staying put. */
    const touched = edits.some((e) =>
      e.qc || e.qtyAccepted !== null || e.qtyRejected !== null || String(e.qcNote || "").trim());
    const current = run.stage || "delivered";
    const nextStage = finish ? "liquidation"
      : (touched || P.indexOf(current) > P.indexOf("delivered") ? "checking" : current);

    const patch = {
      items,
      stage: nextStage,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: HP.user.name || "—",
    };
    patch.history = (run.history || []).concat([{
      stage: patch.stage,
      at: Date.now(),
      byName: HP.user.name || "—",
      note: finish ? "Checked in — sent to liquidation"
        : (nextStage === current && !touched ? "Opened — nothing checked yet" : "Checking in"),
    }]);
    if (finish) patch.checkedAt = firebase.firestore.FieldValue.serverTimestamp();

    db.collection("procurements").doc(run.id).set(patch, { merge: true })
      .then(() => (finish ? shelve(run, items) : null))
      .then((shelved) => {
        HP.closeModal();
        if (!finish) return HP.toast("Check-in saved.", "ok");
        HP.toast(shelved
          ? `Sent to liquidation — ${shelved} line${shelved === 1 ? "" : "s"} shelved.`
          : "Sent to liquidation.", "ok");
      })
      .catch((e) => {
        console.warn("HapagPamana: receiving write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't change this delivery."
          : "Couldn't save — check your connection.", "warn");
      });
  }

  /* ── Shelving ─────────────────────────────────────────────────────────────
     What passed QA goes onto the shelf. Until now the check-in only moved the
     run to liquidation, so stock the clerk had just accepted never reached the
     pantry and the kitchen's count stayed blind to a whole market run.

     Only lines marked `qc: "pass"` with a positive accepted quantity are
     shelved — a failed line is stock that was turned away, and shelving it
     would put food the clerk rejected onto the shelf. The accepted quantity is
     what lands, not what was bought: partial acceptance is the norm here.

     An ingredient the pantry has never seen is CREATED at zero and then
     received up to its quantity, so a market run introducing something new
     doesn't silently drop it. Matching is hp-pantry's own name+unit key, so a
     mistyped unit makes a separate item rather than corrupting an existing
     count — the same deliberate refusal to guess that the issue screen makes.

     Every quantity change writes its pantryLog entry in the SAME transaction,
     which is the pantry's rule: nothing moves the shelf without a trace.

     Runs already past checking are skipped (`shelvedAt`), so re-saving a run
     cannot shelve the same delivery twice. */
  function shelve(run, items) {
    if (!K) {
      console.warn("HapagPamana: hp-pantry.js not loaded — nothing shelved.");
      return 0;
    }
    if (run.shelvedAt) return 0; // already on the shelf

    // Fold to one row per ingredient+unit: a run may buy the same thing for
    // two dishes, and the shelf takes it in once.
    const byKey = new Map();
    (items || []).forEach((it) => {
      if (!it.bought || it.qc !== "pass") return;
      const name = String(it.ingredient || "").trim();
      const unit = String(it.unit || "").trim();
      const qty = K.round3(K.num(it.qtyAccepted));
      if (!name || !(qty > 0)) return;
      const key = K.itemKey(name, unit);
      const cur = byKey.get(key) || { name, unit, qty: 0 };
      cur.qty = K.round3(cur.qty + qty);
      byKey.set(key, cur);
    });
    const lines = [...byKey.values()];
    if (!lines.length) return 0;

    return db.collection("pantry").limit(1000).get().then((snap) => {
      const existing = new Map();
      snap.docs.forEach((d) => {
        const data = d.data() || {};
        existing.set(K.itemKey(data.name, data.unit), { id: d.id, ...data });
      });

      return db.runTransaction(async (tx) => {
        const known = lines.map((l) => ({ line: l, item: existing.get(K.itemKey(l.name, l.unit)) || null }));

        // Reads before writes — a Firestore transaction requires it.
        const befores = [];
        for (const k of known) {
          if (!k.item) { befores.push(0); continue; }
          const s = await tx.get(db.collection("pantry").doc(k.item.id));
          befores.push(s.exists ? K.round3((s.data() || {}).qty) : 0);
        }

        known.forEach((k, i) => {
          const before = befores[i];
          const after = K.round3(before + k.line.qty);
          const ref = k.item
            ? db.collection("pantry").doc(k.item.id)
            : db.collection("pantry").doc();

          if (k.item) {
            tx.update(ref, {
              qty: after,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAtLocal: Date.now(),
              updatedByName: HP.user.name || "—",
            });
          } else {
            // New to the pantry — describe it enough to be usable, and let the
            // clerk set par/section later on the pantry page.
            tx.set(ref, {
              name: k.line.name,
              unit: k.line.unit,
              qty: after,
              par: null,
              category: "",
              note: "Added by a purchase run check-in",
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedAtLocal: Date.now(),
              updatedByName: HP.user.name || "—",
            });
          }

          tx.set(db.collection("pantryLog").doc(), K.logEntry({
            itemId: ref.id,
            itemName: k.line.name,
            unit: k.line.unit,
            delta: k.line.qty,
            before,
            after,
            reason: "received",
            note: `Checked in from ${run.slipNumber || "a purchase run"}`,
            bookingId: run.bookingId || null,
            clientName: run.clientName || null,
          }));
        });
      }).then(() => db.collection("procurements").doc(run.id).set({
        // Stamp the run so a re-save can't shelve the same delivery twice.
        shelvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        shelvedCount: lines.length,
      }, { merge: true })).then(() => lines.length);
    }).catch((e) => {
      // The run is already at liquidation; the shelf is what failed. Say so
      // plainly rather than letting the clerk assume the stock landed.
      console.warn("HapagPamana: shelving —", e);
      HP.toast(e && e.code === "permission-denied"
        ? "Sent to liquidation, but your role can't write the pantry."
        : "Sent to liquidation, but the stock didn't reach the pantry.", "warn");
      return 0;
    });
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const head = ["Slip", "Client", "Function date", "Dish", "Ingredient", "Unit",
      "Bought", "Accepted", "Rejected", "Quality", "Reason"];
    const rows = [];
    list.forEach((r) => {
      (r.items || []).filter((it) => it.bought).forEach((it) => {
        rows.push([r.slipNumber || "", r.clientName || "", r.functionDate || "",
          it.dish || "", it.ingredient || "", it.unit || "",
          it.qtyBought === null ? "" : it.qtyBought,
          it.qtyAccepted === null ? "" : it.qtyAccepted,
          it.qtyRejected === null ? "" : it.qtyRejected,
          it.qc || "", it.qcNote || ""]);
      });
    });
    if (!rows.length) return HP.toast("Nothing to export.", "warn");
    const csv = [head, ...rows].map((l) => l.map(HP.csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `receiving-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
