/* HapagPamana · Purchasing — receipts.
   The paper behind the spend. Every run the buyer has started, what it cost,
   and what the photographed receipts actually account for. The gap between
   those two numbers is the thing this page exists to make impossible to miss:
   money recorded as spent with no receipt behind it is exactly what the stock
   clerk's liquidation and finance's record will bounce on later.

   Receipts are stored on the run document (procurements/{costingId}.receipts)
   as compressed images, at a higher quality than the menu photos: a receipt
   whose total has been squeezed into mush is not a record of anything. When
   Firebase Storage is turned on, only HPProc.readFile changes — this page
   keeps reading `receipt.image` either way.

   Requires the purchasing_staff (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const P = window.HPProc;

  HP.shell.init();
  HP.shell.setPage({
    title: "Receipts",
    sub: "The paper behind every purchase run.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("recStats");
  const rowsEl = document.getElementById("recRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  let runs = [];
  let query = "";
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
      rowsEl.innerHTML = emptyRow("Receipts live in Firestore — connect Firebase to read them.");
      return;
    }
    unsub = db.collection("procurements").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        runs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        loaded = true;
        render();
      }, (e) => {
        statsEl.innerHTML = "";
        rowsEl.innerHTML = emptyRow(e && e.code === "permission-denied"
          ? "Your role can't read the purchase runs."
          : "Couldn't reach Firestore — check your connection.");
        console.warn("HapagPamana: receipts —", e);
      });
  }

  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  function render() { renderStats(); renderRows(); }

  function renderStats() {
    let spent = 0, paper = 0, photos = 0, gapRuns = 0;
    runs.forEach((r) => {
      const t = P.totals(r.items, r.receipts);
      spent += t.actual;
      paper += t.receiptTotal;
      photos += (r.receipts || []).length;
      if (t.unreceipted > 0) gapRuns += 1;
    });
    statsEl.innerHTML =
      stat("slip", String(photos), "Receipts held") +
      stat("peso", P.peso(spent), "Spent", true) +
      stat("peso", P.peso(paper), "On paper", true) +
      stat("ban", String(gapRuns), "Runs with a gap");
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

  function visible() {
    const q = query.trim().toLowerCase();
    return runs.filter((r) => !q ||
      [r.slipNumber, r.clientName, r.kindOfFunction, r.functionDate].join(" ").toLowerCase().includes(q));
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(runs.length
        ? "No run matches that search."
        : "No purchase run has been started yet.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((r) => {
      const t = P.totals(r.items, r.receipts);
      const n = (r.receipts || []).length;
      const gap = t.unreceipted;
      return `<tr data-id="${HP.esc(r.id)}">
        <td><strong>${HP.esc(r.slipNumber || "—")}</strong></td>
        <td>${HP.esc(r.clientName || "—")}<br><small>${HP.esc(r.functionDate || "")}</small></td>
        <td>${HP.esc(String(n))}</td>
        <td>${HP.esc(P.peso(t.actual))}</td>
        <td>${HP.esc(P.peso(t.receiptTotal))}</td>
        <td class="${gap > 0 ? "is-over" : ""}">${HP.esc(gap > 0 ? P.peso(gap) : "—")}</td>
        <td class="row-actions">
          <button class="icon-btn" data-act="open" title="Receipts for this run"
            aria-label="Receipts for ${HP.esc(r.clientName || r.slipNumber || "run")}"><span class="ic">${HP.icon("slip")}</span></button>
        </td>
      </tr>`;
    }).join(""));
    HP.hydrateIcons(rowsEl);
    rowsEl.querySelectorAll("[data-act='open']").forEach((b) =>
      b.addEventListener("click", (e) => {
        const id = e.target.closest("tr").dataset.id;
        openReceipts(runs.find((r) => r.id === id));
      }));
  }

  function emptyRow(msg) { return `<tr><td colspan="7" class="empty">${HP.esc(msg)}</td></tr>`; }

  /* ── The receipt drawer ───────────────────────────────────────────────── */
  function openReceipts(run) {
    if (!run) return;
    // Receipts stay attachable after the run leaves this desk — see
    // canAttachReceipts. Only a filed run is closed to the buyer.
    const readOnly = !P.canAttachReceipts(HP.user.roleKey, run.stage || "purchasing");
    draw(run, readOnly);
  }

  function draw(run, readOnly) {
    const list = Array.isArray(run.receipts) ? run.receipts : [];
    const t = P.totals(run.items, list);

    HP.openModal(`Receipts · ${run.slipNumber || "run"}`, `
      <div class="rc-head">
        <p class="rc-client"><strong>${HP.esc(run.clientName || "—")}</strong> · ${HP.esc(run.kindOfFunction || "")}</p>
        <div class="rc-money">
          <span><small>Spent</small><strong>${HP.esc(P.peso(t.actual))}</strong></span>
          <span><small>On paper</small><strong>${HP.esc(P.peso(t.receiptTotal))}</strong></span>
          <span><small>Unreceipted</small><strong class="${t.unreceipted > 0 ? "is-over" : ""}">${HP.esc(P.peso(Math.max(0, t.unreceipted)))}</strong></span>
        </div>
      </div>

      ${readOnly ? `<p class="ck-note">This run is <strong>${HP.esc(P.labelOf(run.stage || "filed"))}</strong> —
        the paperwork is with the production manager and receipts are sealed.
        Ask finance to reopen it if a receipt still has to go on.</p>` : `
      <div class="rc-add">
        <label class="rc-drop" for="rcFile">
          <span class="ic">${HP.icon("upload")}</span>
          <span>Photograph or choose a receipt</span>
          <input type="file" id="rcFile" accept="image/*" capture="environment" hidden />
        </label>
        <div class="rc-fields">
          <label>Amount<input type="number" id="rcAmount" min="0" step="any" inputmode="decimal" placeholder="0" /></label>
          <label>Supplier / note<input type="text" id="rcNote" placeholder="Palengke, supplier…" /></label>
        </div>
        <p class="rc-status" id="rcStatus" hidden></p>
      </div>`}

      <div class="rc-grid" id="rcGrid">${list.map(cardHTML).join("") ||
        `<p class="empty">No receipt attached yet.</p>`}</div>
    `, `<button class="btn btn-ghost" data-close>Close</button>`);

    const root = document.querySelector(".modal");
    if (!root) return;
    root.classList.add("modal--wide");
    HP.hydrateIcons(root);
    wireGrid(root, run, readOnly);
    if (readOnly) return;

    const file = root.querySelector("#rcFile");
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (f) addReceipt(run, root, f);
      file.value = "";
    });
  }

  function cardHTML(r) {
    return `<figure class="rc-card" data-rid="${HP.esc(r.id)}">
      <img src="${HP.esc(r.image)}" alt="Receipt${r.note ? " — " + HP.esc(r.note) : ""}" loading="lazy" />
      <figcaption>
        <strong>${HP.esc(P.peso(r.amount))}</strong>
        <small>${HP.esc(r.note || "—")}</small>
        <small class="rc-by">${HP.esc(r.uploadedByName || "")}</small>
      </figcaption>
      <button class="icon-btn rc-del" data-act="del" title="Remove this receipt"
        aria-label="Remove receipt"><span class="ic">${HP.icon("trash")}</span></button>
    </figure>`;
  }

  function wireGrid(root, run, readOnly) {
    root.querySelectorAll(".rc-card img").forEach((img) =>
      img.addEventListener("click", () => window.open(img.src, "_blank")));
    if (readOnly) {
      root.querySelectorAll(".rc-del").forEach((b) => b.remove());
      return;
    }
    root.querySelectorAll("[data-act='del']").forEach((b) =>
      b.addEventListener("click", (e) => {
        const id = e.target.closest(".rc-card").dataset.rid;
        removeReceipt(run, id);
      }));
  }

  function addReceipt(run, root, file) {
    const status = root.querySelector("#rcStatus");
    const amount = Number(root.querySelector("#rcAmount").value) || 0;
    const note = root.querySelector("#rcNote").value.trim();
    say(status, "Reading the photo…");

    P.readFile(file).then((image) => {
      const rec = {
        id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        image, amount, note,
        uploadedAt: Date.now(),
        uploadedByName: HP.user.name || "—",
      };
      const receipts = (run.receipts || []).concat([rec]);
      return db.collection("procurements").doc(run.id).set({
        receipts,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByName: HP.user.name || "—",
      }, { merge: true }).then(() => {
        run.receipts = receipts;      // keep the open drawer honest
        HP.closeModal();
        draw(run, false);
        HP.toast("Receipt attached.", "ok");
      });
    }).catch((e) => {
      console.warn("HapagPamana: receipt —", e);
      say(status, e && e.message ? e.message : "That receipt couldn't be attached.", true);
    });
  }

  function removeReceipt(run, rid) {
    HP.confirmModal("Remove this receipt?",
      "The photo is deleted from the run. The spend it was standing for stays recorded.",
      () => {
        const receipts = (run.receipts || []).filter((r) => r.id !== rid);
        db.collection("procurements").doc(run.id).set({
          receipts,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByName: HP.user.name || "—",
        }, { merge: true }).then(() => {
          run.receipts = receipts;
          draw(run, false);
          HP.toast("Receipt removed.", "ok");
        }).catch((e) => HP.toast(
          e && e.code === "permission-denied"
            ? "Your role can't change this run."
            : "Couldn't remove that receipt.", "warn"));
      });
  }

  function say(el, msg, bad) {
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("is-bad", !!bad);
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const head = ["Slip", "Client", "Function date", "Receipts", "Spent (PHP)",
      "On paper (PHP)", "Unreceipted (PHP)"];
    const rows = list.map((r) => {
      const t = P.totals(r.items, r.receipts);
      return [r.slipNumber || "", r.clientName || "", r.functionDate || "",
        (r.receipts || []).length, t.actual, t.receiptTotal, Math.max(0, t.unreceipted)];
    });
    const csv = [head, ...rows].map((l) => l.map(HP.csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
})();
