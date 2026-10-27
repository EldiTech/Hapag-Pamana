/* HapagPamana · Finance — Received.

   The end of the procurement line. The stock clerk files a run here once the
   goods are checked in and the spend reconciled; this page is where the
   production manager finds it, looks at the receipt photos the buyer
   attached, and ACKNOWLEDGES that the paper actually arrived.

   That acknowledgement is the point of the page. Until it exists, "filed with
   finance" is only the stores' word that the paperwork was handed over —
   nobody downstream can tell a run finance has genuinely received from one
   that stopped at the clerk's desk. The stamp is written onto the run itself
   (`acknowledged`), so the Purchasing and Stock Clerk boards can read it back
   without a second lookup.

   Reads `procurements` where stage = "filed". Requires the production_manager
   (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const P = window.HPProc;
  const F = window.HPFin;

  HP.shell.init();
  HP.shell.setPage({
    title: "Received",
    sub: "Runs the stores have filed here — the receipts behind the spend.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("rcvStats");
  const chipsEl = document.getElementById("rcvChips");
  const rowsEl = document.getElementById("rcvRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 250;

  let runs = [];
  let query = "";
  let filter = "todo";   // the desk's own queue opens first
  let loaded = false;
  let unsub = null;

  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(8, 6);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("Filed runs live in Firestore — connect Firebase to read them.");
      return;
    }
    // Only what the stores actually filed. No orderBy — that would need a
    // composite index alongside the stage filter; the slice is small and is
    // sorted here instead.
    unsub = db.collection("procurements").where("stage", "==", "filed").limit(LIVE_LIMIT)
      .onSnapshot((snap) => {
        runs = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        runs.sort((a, b) => filedAt(b) - filedAt(a)); // newest filing first
        loaded = true;
        renderAll();
      }, (e) => {
        const denied = e && (e.code === "permission-denied" ||
          /permission|insufficient/i.test(e.message || ""));
        statsEl.innerHTML = "";
        rowsEl.innerHTML = emptyRow(denied
          ? "Your role can't read the filed purchase runs."
          : "Couldn't reach Firestore — check your connection.");
        if (denied) HP.toast("Database access denied — check your Firestore rules.", "danger");
      });
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  const ts = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);
  const filedAt = (r) => ts(r.liquidation && r.liquidation.filedAt) || ts(r.updatedAt);
  const isAck = (r) => !!(r.acknowledged && r.acknowledged.at);
  const receiptsOf = (r) => (Array.isArray(r.receipts) ? r.receipts : []);

  function fmtDate(v) {
    const ms = ts(v);
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString("en-PH",
      { year: "numeric", month: "short", day: "numeric" });
  }
  function emptyRow(msg) {
    return `<tr><td colspan="8" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderChips(); renderRows(); }

  function renderStats() {
    const todo = runs.filter((r) => !isAck(r)).length;
    const paper = runs.reduce((s, r) => s + P.totals(r.items, r.receipts).receiptTotal, 0);
    // A gap between what a run spent and what its receipts account for is the
    // thing finance has to see before acknowledging anything.
    const gaps = runs.filter((r) => P.totals(r.items, r.receipts).unreceipted > 0).length;

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${n}">${n}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("inbox", todo, "Awaiting acknowledgement") +
      stat("slip", runs.length, "Runs filed here") +
      stat("peso", Math.round(paper), "Receipts on paper (₱)") +
      stat("scales", gaps, "Runs with an unreceipted gap"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      todo: runs.filter((r) => !isAck(r)).length,
      done: runs.filter(isAck).length,
      all: runs.length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("todo", "To acknowledge") + chip("done", "Acknowledged") + chip("all", "Everything");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    return runs.filter((r) => {
      if (filter === "todo" && isAck(r)) return false;
      if (filter === "done" && !isAck(r)) return false;
      if (!query) return true;
      return [r.slipNumber, r.clientName, r.kindOfFunction, r.filedByName]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(runs.length
        ? "Nothing here — try another filter or search."
        : "Nothing filed yet — runs appear once the stock clerk files a liquidation.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((r) => {
      const t = P.totals(r.items, r.receipts);
      const n = receiptsOf(r).length;
      const ack = isAck(r);
      return `
      <tr data-id="${HP.esc(r.id)}">
        <td><strong>${HP.esc(r.slipNumber || "—")}</strong></td>
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(r.clientName || "—")}</strong>
            <small>${HP.esc(r.kindOfFunction || "—")}</small>
          </div></div>
        </td>
        <td>${HP.esc(P.peso(Number(r.amount) || 0))}</td>
        <td>${HP.esc(P.peso(t.actual))}</td>
        <td>${n ? `${n} photo${n === 1 ? "" : "s"}` : `<span class="is-over">none</span>`}</td>
        <td>${HP.esc(r.filedByName || "—")}</td>
        <td>${ack
          ? `<span class="badge badge-ok"><span class="dot"></span>Acknowledged</span>`
          : `<span class="badge badge-gold">Awaiting</span>`}</td>
        <td class="row-actions">
          <button class="icon-btn" data-act="open" title="Open the receipts"
            aria-label="Open ${HP.esc(r.clientName || "run")}'s receipts"><span class="ic">${HP.icon("eye")}</span></button>
        </td>
      </tr>`;
    }).join(""));
    HP.hydrateIcons(rowsEl);

    const open = (id) => { const r = runs.find((x) => x.id === id); if (r) openRun(r); };
    rowsEl.querySelectorAll("[data-act='open']").forEach((b) =>
      b.addEventListener("click", (e) => { e.stopPropagation(); open(e.currentTarget.closest("tr").dataset.id); }));
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => { if (!e.target.closest("button")) open(tr.dataset.id); }));
  }

  /* ── The run drawer — the receipts, and the acknowledgement ─────────────
     Built to read like the stock clerk's own liquidation sheet (same figure
     block, same photo grid), so the two desks are looking at one document
     rather than two different renderings of it. */
  function openRun(r) {
    const t = P.totals(r.items, r.receipts);
    const receipts = receiptsOf(r);
    const ack = isAck(r);
    const gap = Math.max(0, t.unreceipted);

    HP.openModal(`Received · ${r.slipNumber || "run"}`, `
      <div class="rc-head">
        <p class="rc-client"><strong>${HP.esc(r.clientName || "—")}</strong>
          ${r.kindOfFunction ? ` · ${HP.esc(r.kindOfFunction)}` : ""}
          ${r.functionDate ? ` · ${HP.esc(r.functionDate)}` : ""}</p>
        <div class="rc-money">
          <span><small>Authorised</small><strong>${HP.esc(P.peso(Number(r.amount) || 0))}</strong></span>
          <span><small>Spent</small><strong>${HP.esc(P.peso(t.actual))}</strong></span>
          <span><small>On paper</small><strong>${HP.esc(P.peso(t.receiptTotal))}</strong></span>
          <span><small>Unreceipted</small><strong class="${gap > 0 ? "is-over" : ""}">${HP.esc(P.peso(gap))}</strong></span>
        </div>
      </div>

      <p class="ck-note">Filed by <strong>${HP.esc(r.filedByName || "—")}</strong>
        ${r.liquidation && r.liquidation.filedAt ? ` on ${HP.esc(fmtDate(r.liquidation.filedAt))}` : ""}.</p>

      ${gap > 0 ? `<p class="ck-note rcv-gap">${HP.esc(
        `₱${Math.round(gap).toLocaleString("en-PH")} of this run's spend has no receipt behind it. ` +
        `Acknowledging records that you received the paper as it stands — it does not close the gap.`)}</p>` : ""}

      <h4 class="rcv-h">Receipts${receipts.length ? ` (${receipts.length})` : ""}</h4>
      ${receipts.length ? `
        <div class="lq-thumbs rcv-thumbs">
          ${receipts.map((x, i) => `<figure data-photo="${i}">
            <img class="lq-thumb" src="${HP.esc(x.image)}"
              alt="Receipt${x.note ? " — " + HP.esc(x.note) : ""}" loading="lazy" />
            <figcaption>${HP.esc(P.peso(x.amount))}
              <small>${HP.esc(x.note || "—")}</small>
              <small class="rcv-by">${HP.esc(x.uploadedByName || "")}</small>
            </figcaption>
          </figure>`).join("")}
        </div>`
        : `<p class="empty">No receipt photo was attached to this run.</p>`}

      ${ack ? `
        <p class="ck-note rcv-ack">Acknowledged by <strong>${HP.esc(r.acknowledged.byName || "—")}</strong>
          on ${HP.esc(fmtDate(r.acknowledged.at))}.
          ${r.acknowledged.note ? `<br><small>${HP.esc(r.acknowledged.note)}</small>` : ""}</p>`
        : `
        <div class="field rcv-note">
          <label>Note (optional)</label>
          <input class="control" id="rcvNote" placeholder="e.g. originals filed in the Aug folder" />
        </div>`}`,
      ack
        ? `<button class="btn btn-ghost" data-close>Close</button>`
        : `<button class="btn btn-ghost" data-close>Cancel</button>
           <button class="btn btn-primary" id="rcvAck"><span class="ic">${HP.icon("check")}</span>Acknowledge receipt</button>`);

    const modal = document.querySelector(".modal");
    if (modal) modal.classList.add("modal--wide");
    HP.hydrateIcons(modal);

    // A receipt total is unreadable at thumbnail size — that is the whole
    // reason the photo exists, so every one opens full size.
    if (modal) modal.querySelectorAll(".rcv-thumbs img").forEach((img) =>
      img.addEventListener("click", () => window.open(img.src, "_blank")));

    const btn = document.getElementById("rcvAck");
    if (btn) btn.addEventListener("click", () => acknowledge(r));
  }

  /* ── The acknowledgement ────────────────────────────────────────────────
     Written once. Re-acknowledging would overwrite who first received the
     paper, so an already-stamped run opens read-only (no button above) and
     the write itself re-checks inside a transaction — two officers opening
     the same run at once must not race. */
  let saving = false;
  async function acknowledge(r) {
    if (saving) return;
    const noteEl = document.getElementById("rcvNote");
    const note = noteEl ? noteEl.value.trim() : "";
    saving = true;
    const btn = document.getElementById("rcvAck");
    if (btn) btn.disabled = true;
    try {
      const ref = db.collection("procurements").doc(r.id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw Object.assign(new Error("gone"), { code: "hp/gone" });
        const cur = snap.data() || {};
        if (cur.acknowledged && cur.acknowledged.at) {
          throw Object.assign(new Error("done"), { code: "hp/done", by: cur.acknowledged.byName });
        }
        tx.set(ref, {
          acknowledged: {
            at: firebase.firestore.FieldValue.serverTimestamp(),
            byUid: F.meUid(),
            byName: F.meName() || HP.user.name || "—",
            note,
            // What the paper accounted for at the moment it was received —
            // a later edit upstream can't quietly rewrite what was accepted.
            receiptCount: receiptsOf(cur).length,
            receiptTotal: P.totals(cur.items, cur.receipts).receiptTotal,
          },
          history: (Array.isArray(cur.history) ? cur.history : []).concat([{
            stage: "filed", at: Date.now(),
            byName: F.meName() || HP.user.name || "—",
            note: note ? `Receipts acknowledged — ${note}` : "Receipts acknowledged by finance",
          }]),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByName: F.meName() || HP.user.name || "—",
        }, { merge: true });
      });
      HP.closeModal();
      HP.toast("Receipts acknowledged.", "ok");
    } catch (e) {
      if (e && e.code === "hp/done") {
        HP.closeModal();
        HP.toast(`Already acknowledged${e.by ? ` by ${e.by}` : ""}.`, "warn");
      } else if (e && e.code === "hp/gone") {
        HP.toast("That run no longer exists.", "warn");
      } else {
        console.warn("HapagPamana: acknowledge —", e);
        HP.toast(e && e.code === "permission-denied"
          ? "Your role can't acknowledge this run."
          : "Couldn't save — check your connection.", "danger");
      }
    } finally {
      saving = false;
      if (btn) btn.disabled = false;
    }
  }

  /* ── Export ───────────────────────────────────────────────────────────── */
  function exportCSV() {
    const list = visible();
    if (!list.length) return HP.toast("Nothing to export.", "warn");
    const cell = HP.csvCell;
    const head = ["Slip", "Client", "Event", "Authorised (PHP)", "Spent (PHP)",
      "Receipts (PHP)", "Unreceipted (PHP)", "Photos", "Filed by", "Filed",
      "Acknowledged by", "Acknowledged", "Note"];
    const lines = [head.map(cell).join(",")];
    list.forEach((r) => {
      const t = P.totals(r.items, r.receipts);
      const a = r.acknowledged || {};
      lines.push([
        r.slipNumber || "", r.clientName || "", r.kindOfFunction || "",
        Number(r.amount) || 0, t.actual, t.receiptTotal, Math.max(0, t.unreceipted),
        receiptsOf(r).length, r.filedByName || "",
        fmtDate(r.liquidation && r.liquidation.filedAt),
        a.byName || "", a.at ? fmtDate(a.at) : "", a.note || "",
      ].map(cell).join(","));
    });
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_received.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Received runs exported as CSV.");
  }
})();
