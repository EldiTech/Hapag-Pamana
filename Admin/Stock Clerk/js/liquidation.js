/* HapagPamana · Stock Clerk — liquidation.
   The last thing this desk does with a run: weigh what was actually spent
   against the slip it was authorised by, confirm the receipts account for it,
   and send the whole file — checklist, quality check and receipt photos — to
   the production manager for the finance record.

   Nothing is recalculated here that isn't already defined in
   ../../assets/hp-procurement.js. `liquidationBlockers` decides whether a run
   may be filed, and it returns REASONS rather than a boolean so this page can
   say what is missing instead of showing a dead button.

   Requires the stock_clerk (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const P = window.HPProc;

  HP.shell.init();
  HP.shell.setPage({
    title: "Liquidation",
    sub: "Weigh each run against its slip, then file it with the production manager.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("liqStats");
  const chipsEl = document.getElementById("liqChips");
  const rowsEl = document.getElementById("liqRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  let runs = [];
  let query = "";
  let filter = "open";
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
      rowsEl.innerHTML = emptyRow("Liquidation lives in Firestore — connect Firebase to read it.");
      return;
    }
    unsub = db.collection("procurements").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        runs = snap.docs
          .map((d) => Object.assign({ id: d.id }, d.data()))
          .filter((r) => P.indexOf(r.stage || "released") >= P.indexOf("liquidation"));
        loaded = true;
        render();
      }, (e) => {
        statsEl.innerHTML = "";
        chipsEl.innerHTML = "";
        rowsEl.innerHTML = emptyRow(e && e.code === "permission-denied"
          ? "Your role can't read the liquidation board."
          : "Couldn't reach Firestore — check your connection.");
        console.warn("HapagPamana: liquidation —", e);
      });
  }

  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  function render() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    let authorised = 0, spent = 0, over = 0;
    const open = runs.filter((r) => r.stage === "liquidation").length;
    runs.forEach((r) => {
      const t = P.totals(r.items, r.receipts);
      authorised += Number(r.amount) || 0;
      spent += t.actual;
      if (t.actual > (Number(r.amount) || 0)) over += 1;
    });
    statsEl.innerHTML =
      stat("scales", String(open), "To liquidate") +
      stat("peso", P.peso(authorised), "Authorised", true) +
      stat("peso", P.peso(spent), "Spent", true) +
      stat("ban", String(over), "Over the slip");
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
    { key: "open", label: "To liquidate" },
    { key: "filed", label: "Filed" },
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
    if (key === "open") return runs.filter((r) => r.stage === "liquidation").length;
    return runs.filter((r) => r.stage === "filed").length;
  }

  function visible() {
    const q = query.trim().toLowerCase();
    return runs
      .filter((r) => filter === "all" ? true
        : filter === "open" ? r.stage === "liquidation"
        : r.stage === "filed")
      .filter((r) => !q || [r.slipNumber, r.clientName, r.kindOfFunction, r.functionDate]
        .join(" ").toLowerCase().includes(q));
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(runs.length
        ? "No run matches that filter."
        : "Nothing to liquidate — no delivery has been checked in yet.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((r) => {
      const st = P.stage(r.stage);
      const t = P.totals(r.items, r.receipts);
      const variance = t.actual - (Number(r.amount) || 0);
      return `<tr data-id="${HP.esc(r.id)}">
        <td><strong>${HP.esc(r.slipNumber || "—")}</strong></td>
        <td>${HP.esc(r.clientName || "—")}<br><small>${HP.esc(r.functionDate || "")}</small></td>
        <td class="ck-num">${HP.esc(P.peso(r.amount))}</td>
        <td class="ck-num">${HP.esc(P.peso(t.actual))}</td>
        <td class="ck-num ${variance > 0 ? "is-over" : ""}">${HP.esc(P.signedPeso(variance))}</td>
        <td><span class="badge ${HP.esc(st.badge)}"><span class="dot"></span>${HP.esc(st.label)}</span></td>
        <td class="row-actions">
          <button class="icon-btn" data-act="open" title="Open the liquidation"
            aria-label="Liquidate ${HP.esc(r.clientName || "run")}"><span class="ic">${HP.icon("scales")}</span></button>
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

  /* ── The liquidation sheet ────────────────────────────────────────────── */
  function openRun(run) {
    if (!run) return;
    const filed = run.stage === "filed";
    const readOnly = filed || !P.canDrive(HP.user.roleKey, "liquidation");
    const t = P.totals(run.items, run.receipts);
    const blockers = P.liquidationBlockers(run.items, run.receipts);

    const foot = readOnly || blockers.length
      ? `<button class="btn btn-ghost" data-close>Close</button>`
      : `<button class="btn btn-ghost" data-close>Cancel</button>
         <button class="btn btn-primary" id="liqFile">File with the production manager</button>`;

    HP.openModal(`Liquidation · ${run.slipNumber || "run"}`, sheetHTML(run, t, blockers, filed), foot);

    const root = document.querySelector(".modal");
    if (!root) return;
    root.classList.add("modal--wide");
    HP.hydrateIcons(root);
    root.querySelectorAll(".lq-thumb").forEach((img) =>
      img.addEventListener("click", () => window.open(img.src, "_blank")));
    const btn = root.querySelector("#liqFile");
    if (btn) btn.addEventListener("click", () => file(run, root));
  }

  function sheetHTML(run, t, blockers, filed) {
    const authorised = Number(run.amount) || 0;
    const variance = t.actual - authorised;
    const receipts = Array.isArray(run.receipts) ? run.receipts : [];
    const rejects = (run.items || []).filter((it) => Number(it.qtyRejected) > 0 || it.qc === "fail");

    return `
      <div class="ck-head">
        <div>
          <p class="ck-client"><strong>${HP.esc(run.clientName || "—")}</strong> · ${HP.esc(run.kindOfFunction || "")}</p>
          <p class="ck-meta">${HP.esc(run.functionDate || "")}${run.venue ? " · " + HP.esc(run.venue) : ""}</p>
        </div>
      </div>

      <div class="lq-ledger">
        <div class="lq-row"><span>Authorised by slip ${HP.esc(run.slipNumber || "—")}</span><strong>${HP.esc(P.peso(authorised))}</strong></div>
        <div class="lq-row"><span>Actually spent (${HP.esc(String(t.bought))} of ${HP.esc(String(t.lines))} lines)</span><strong>${HP.esc(P.peso(t.actual))}</strong></div>
        <div class="lq-row lq-var ${variance > 0 ? "is-over" : ""}">
          <span>${variance > 0 ? "Over the slip" : variance < 0 ? "Returned to the house" : "Balanced"}</span>
          <strong>${HP.esc(P.signedPeso(variance))}</strong>
        </div>
        <div class="lq-row lq-sub"><span>Receipts attached (${HP.esc(String(receipts.length))})</span><strong>${HP.esc(P.peso(t.receiptTotal))}</strong></div>
        <div class="lq-row lq-sub ${t.unreceipted > 0 ? "is-over" : ""}">
          <span>Spend with no receipt behind it</span><strong>${HP.esc(P.peso(Math.max(0, t.unreceipted)))}</strong>
        </div>
      </div>

      ${rejects.length ? `
        <section class="lq-block">
          <h4>Rejected on delivery</h4>
          <ul class="lq-list">
            ${rejects.map((it) => `<li>
              <strong>${HP.esc(it.ingredient)}</strong>
              ${Number(it.qtyRejected) > 0 ? ` — ${HP.esc(P.qty(it.qtyRejected, it.unit))} turned away` : " — failed"}
              ${it.qcNote ? `<small>${HP.esc(it.qcNote)}</small>` : ""}
            </li>`).join("")}
          </ul>
        </section>` : ""}

      ${receipts.length ? `
        <section class="lq-block">
          <h4>Receipts going to finance</h4>
          <div class="lq-thumbs">
            ${receipts.map((r) => `<figure>
              <img class="lq-thumb" src="${HP.esc(r.image)}" alt="Receipt${r.note ? " — " + HP.esc(r.note) : ""}" loading="lazy" />
              <figcaption>${HP.esc(P.peso(r.amount))}<small>${HP.esc(r.note || "")}</small></figcaption>
            </figure>`).join("")}
          </div>
        </section>` : ""}

      ${filed ? `<p class="ck-note">Filed with the production manager${
        run.filedByName ? ` by ${HP.esc(run.filedByName)}` : ""}.</p>`
        : blockers.length ? `
        <section class="lq-block lq-blockers">
          <h4>Not ready to file</h4>
          <ul class="lq-list">${blockers.map((b) => `<li>${HP.esc(b)}</li>`).join("")}</ul>
          ${blockers.some((b) => /actual price|no receipt/i.test(b)) ? `
            <p class="lq-whose">The money columns and the receipts belong to
            <strong>purchasing</strong> — they still hold what was actually paid, and can
            fill it in from their own board while the run sits here. Ask the buyer to
            price the outstanding lines, then reopen this sheet.</p>` : `
            <p class="lq-whose">These are this desk's to clear — finish the quality check
            on the receiving board, then reopen this sheet.</p>`}
        </section>` : `
        <p class="ck-hint">Filing hands the checklist, the quality check and every receipt to the
        production manager for the finance record. The run stops being editable here.</p>`}`;
  }

  function file(run, root) {
    // Re-check at the moment of writing: the run is live, and a colleague may
    // have pulled a receipt out from under this dialog.
    const blockers = P.liquidationBlockers(run.items, run.receipts);
    if (blockers.length) {
      HP.toast(blockers[0], "warn");
      return;
    }
    const t = P.totals(run.items, run.receipts);
    db.collection("procurements").doc(run.id).set({
      stage: "filed",
      liquidation: {
        authorised: Number(run.amount) || 0,
        spent: t.actual,
        variance: t.actual - (Number(run.amount) || 0),
        receiptTotal: t.receiptTotal,
        filedAt: firebase.firestore.FieldValue.serverTimestamp(),
        filedByName: HP.user.name || "—",
      },
      filedByName: HP.user.name || "—",
      history: (run.history || []).concat([{
        stage: "filed", at: Date.now(), byName: HP.user.name || "—",
        note: "Filed with the production manager",
      }]),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedByName: HP.user.name || "—",
    }, { merge: true })
      .then(() => {
        /* Settle the float: the slip took its full authorised amount out of
           the box when it was released, and only now is it known what was
           really spent. The difference goes back (or, on an overspend, comes
           out) so the balance matches the cash again.

           Never blocks the filing — the run is filed either way, and a fund
           that hasn't been opened simply has nothing to settle. The stock
           clerk cannot write the fund themselves; the rules let this write
           through because it is the settlement of a slip finance released.
           A failure is visible in the toast and correctable from the Petty
           Cash page. */
        if (window.HPCash) {
          window.HPCash.settle(db, Number(run.amount) || 0, t.actual, {
            bookingId: run.bookingId || run.id,
            clientName: run.clientName || null,
            slipNumber: run.slipNumber || null,
            note: "Liquidation settled",
          }).catch((e) => {
            if (e && e.code === "hp/nofund") return; // no float in use
            console.warn("HapagPamana: petty cash settle —", e);
            HP.toast("Filed, but the petty cash float couldn't be settled — tell finance.", "warn");
          });
        }
        HP.closeModal();
        HP.toast("Filed with the production manager.", "ok");
      })
      .catch((e) => {
        console.warn("HapagPamana: liquidation write —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't file this run."
          : "Couldn't file — check your connection.", "warn");
      });
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const head = ["Slip", "Client", "Function date", "Stage", "Authorised (PHP)",
      "Spent (PHP)", "Variance (PHP)", "Receipts (PHP)", "Unreceipted (PHP)", "Filed by"];
    const rows = list.map((r) => {
      const t = P.totals(r.items, r.receipts);
      const a = Number(r.amount) || 0;
      return [r.slipNumber || "", r.clientName || "", r.functionDate || "",
        P.labelOf(r.stage), a, t.actual, t.actual - a, t.receiptTotal,
        Math.max(0, t.unreceipted), r.filedByName || ""];
    });
    const csv = [head, ...rows].map((l) => l.map(HP.csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `liquidation-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
