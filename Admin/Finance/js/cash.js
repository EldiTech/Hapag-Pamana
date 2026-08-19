/* HapagPamana · Finance — Petty Cash.

   The ingredient float and its ledger. The production manager opens the fund,
   tops it up, and corrects it after a recount; everything else moves on its
   own as slips are released and runs liquidated (see hp-cash.js).

   The balance shown here is never typed. It is the running total of the
   ledger below it, which is what makes it something you can count the cash
   box against at the end of the day.

   Requires the production_manager (or admin) role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;
  const C = window.HPCash;

  HP.shell.init();
  HP.shell.setPage({
    title: "Petty Cash",
    sub: "The ingredient float — topped up here, spent by the market run.",
    search: true,
    action: { label: "Top up", fn: () => openTopUp() },
  });

  const heroEl = document.getElementById("cashHero");
  const statsEl = document.getElementById("cashStats");
  const chipsEl = document.getElementById("cashChips");
  const rowsEl = document.getElementById("cashRows");
  const db = HP.ONLINE ? firebase.firestore() : null;
  const LIVE_LIMIT = 500;

  let fund = null;       // null = not opened yet
  let log = [];
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
      rowsEl.innerHTML = emptyRow("The float lives in Firestore — connect Firebase to use it.");
      return;
    }
    unsubs.push(db.collection("settings").doc(C.FUND_DOC).onSnapshot((snap) => {
      fund = snap.exists ? snap.data() : null;
      renderAll();
    }, (e) => { if (denied(e)) fail("Your role can't read the petty cash fund."); }));

    // No orderBy — a just-written entry has a null serverTimestamp until it
    // lands, and ordering server-side would drop it out of the window.
    unsubs.push(db.collection(C.LOG).limit(LIVE_LIMIT).onSnapshot((snap) => {
      log = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      log.sort((a, b) => C.entryTime(b) - C.entryTime(a));
      loaded = true;
      renderAll();
    }, (e) => {
      fail(denied(e)
        ? "Access denied — publish the updated Firestore rules (pettyCashLog), then reload."
        : "Couldn't reach Firestore — check your connection.");
    }));
  }
  const denied = (e) => e && (e.code === "permission-denied" ||
    /permission|insufficient/i.test((e && e.message) || ""));
  function fail(msg) {
    statsEl.innerHTML = "";
    rowsEl.innerHTML = emptyRow(msg);
    loaded = true;
  }
  window.addEventListener("beforeunload", () => unsubs.forEach((u) => { try { u(); } catch (_) {} }));

  function emptyRow(msg) {
    return `<tr><td colspan="6" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() { renderHero(); renderStats(); renderChips(); renderRows(); }

  function renderHero() {
    if (!fund) {
      heroEl.innerHTML = `
        <div class="pc-open">
          <h3>No float has been opened yet</h3>
          <p>Count the cash the house keeps for the market run and open the fund with it.
             From then on, releasing a requisition takes money out and liquidating the
             run brings the change back — every peso with a ledger entry behind it.</p>
          <button class="btn btn-primary" id="pcOpen"><span class="ic">${HP.icon("peso")}</span>Open the float</button>
        </div>`;
      HP.hydrateIcons(heroEl);
      const b = document.getElementById("pcOpen");
      if (b) b.addEventListener("click", openFund);
      return;
    }
    const st = C.stateOf(fund);
    heroEl.innerHTML = `
      <div class="pc-hero-in">
        <div class="pc-bal">
          <small>In the box</small>
          <strong class="${st === "empty" ? "is-over" : ""}">${HP.esc(C.peso(fund.balance))}</strong>
          <span class="badge ${C.STATE_BADGE[st]}">${HP.esc(C.STATE_LABEL[st])}</span>
        </div>
        <div class="pc-hero-meta">
          <p>Opened at ${HP.esc(C.peso(fund.opening))}${
            fund.updatedByName ? ` · last touched by ${HP.esc(fund.updatedByName)}` : ""}</p>
          <div class="pc-hero-acts">
            <button class="btn btn-primary" id="pcTop"><span class="ic">${HP.icon("plus")}</span>Top up</button>
            <button class="btn btn-ghost" id="pcAdj"><span class="ic">${HP.icon("scales")}</span>Correct after a recount</button>
          </div>
        </div>
      </div>`;
    HP.hydrateIcons(heroEl);
    document.getElementById("pcTop").addEventListener("click", openTopUp);
    document.getElementById("pcAdj").addEventListener("click", openAdjust);
  }

  function renderStats() {
    const inSum = log.filter((e) => Number(e.delta) > 0)
      .reduce((s, e) => s + Number(e.delta), 0);
    const outSum = log.filter((e) => Number(e.delta) < 0)
      .reduce((s, e) => s + Math.abs(Number(e.delta)), 0);
    const committed = log.filter((e) => e.reason === "release").length;
    const returned = log.filter((e) => e.reason === "settle" && Number(e.delta) > 0)
      .reduce((s, e) => s + Number(e.delta), 0);

    const stat = (ic, n, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${Math.round(n)}">${Math.round(n)}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("peso", inSum, "Cash in (₱)") +
      stat("scales", outSum, "Cash out (₱)") +
      stat("slip", committed, "Slips funded") +
      stat("undo", returned, "Change returned (₱)"))) HP.countUp(statsEl);
  }

  function renderChips() {
    const counts = {
      all: log.length,
      in: log.filter((e) => Number(e.delta) > 0).length,
      out: log.filter((e) => Number(e.delta) < 0).length,
      slips: log.filter((e) => e.reason === "release" || e.reason === "settle").length,
    };
    const chip = (key, label) =>
      `<button class="seg-btn ${filter === key ? "active" : ""}" data-chip="${key}">${label} <span class="seg-count">${counts[key]}</span></button>`;
    chipsEl.innerHTML = chip("all", "Everything") + chip("in", "Cash in") +
      chip("out", "Cash out") + chip("slips", "Requisitions");
    chipsEl.querySelectorAll("[data-chip]").forEach((b) =>
      b.addEventListener("click", () => { filter = b.dataset.chip; renderChips(); renderRows(); }));
  }

  function visible() {
    return log.filter((e) => {
      if (filter === "in" && !(Number(e.delta) > 0)) return false;
      if (filter === "out" && !(Number(e.delta) < 0)) return false;
      if (filter === "slips" && e.reason !== "release" && e.reason !== "settle") return false;
      if (!query) return true;
      return [e.slipNumber, e.clientName, e.note, e.byName, C.reasonLabel(e.reason)]
        .join(" ").toLowerCase().includes(query);
    });
  }

  function renderRows() {
    if (!loaded) return;
    const list = visible();
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(log.length
        ? "No movement matches — try another spelling or clear the filter."
        : "Nothing has moved yet — the ledger fills as slips are released and runs liquidated.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((e) => {
      const up = Number(e.delta) > 0;
      return `
      <tr>
        <td>${HP.esc(C.fmtWhen(e))}</td>
        <td><span class="pc-delta ${up ? "is-up" : "is-down"}">${HP.esc(C.signedPeso(e.delta))}</span></td>
        <td>${HP.esc(C.reasonLabel(e.reason))}${e.note ? `<br><small>${HP.esc(e.note)}</small>` : ""}</td>
        <td>${e.slipNumber ? `<strong>${HP.esc(e.slipNumber)}</strong>` : "—"}
          ${e.clientName ? `<br><small>${HP.esc(e.clientName)}</small>` : ""}</td>
        <td>${HP.esc(C.peso(e.after))}</td>
        <td>${HP.esc(e.byName || "—")}</td>
      </tr>`;
    }).join(""));
  }

  /* ── Opening, topping up, correcting ──────────────────────────────────── */
  function openFund() {
    HP.openModal("Open the petty cash float", `
      <div class="pn-form">
        <div class="field">
          <label>Cash counted in the box <span class="req">*</span></label>
          <input class="control" id="pcAmt" type="number" min="0" step="0.01" placeholder="0.00" />
          <p class="plan-hint">This is recorded as the opening balance. Every later movement
            is measured from it, so count before you type.</p>
        </div>
        <div class="field">
          <label>Note</label>
          <input class="control" id="pcNote" placeholder="e.g. float for August market runs" />
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="pcGo"><span class="ic">${HP.icon("check")}</span>Open the float</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));
    document.getElementById("pcGo").addEventListener("click", async () => {
      const amt = C.num(document.getElementById("pcAmt").value);
      if (!(amt >= 0)) return HP.toast("Enter the counted amount first.", "danger");
      const note = document.getElementById("pcNote").value.trim();
      await guard(async () => {
        const opening = C.round2(amt);
        const batch = db.batch();
        batch.set(db.collection("settings").doc(C.FUND_DOC), {
          balance: opening, opening,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedByName: HP.user.name || "—",
        }, { merge: true });
        // The ledger has no gap at the top: an audit can start from zero.
        batch.set(db.collection(C.LOG).doc(), C.logEntry({
          delta: opening, before: 0, after: opening,
          reason: "opening", note: note || "Float opened",
        }));
        await batch.commit();
      }, "The float is open.");
    });
  }

  function openTopUp() {
    if (!fund) return openFund();
    HP.openModal("Top up the float", `
      <div class="pn-form">
        <p class="pn-onhand">In the box <strong>${HP.esc(C.peso(fund.balance))}</strong></p>
        <div class="field">
          <label>Cash added <span class="req">*</span></label>
          <input class="control" id="pcAmt" type="number" min="0" step="0.01" placeholder="0.00" />
        </div>
        <div class="field">
          <label>Note</label>
          <input class="control" id="pcNote" placeholder="e.g. replenished from the August budget" />
        </div>
        <p class="pn-preview" id="pcPrev"></p>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="pcGo"><span class="ic">${HP.icon("check")}</span>Add to the float</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));
    const amtEl = document.getElementById("pcAmt");
    const prev = document.getElementById("pcPrev");
    amtEl.addEventListener("input", () => {
      const v = C.num(amtEl.value);
      prev.innerHTML = v > 0
        ? `${HP.esc(C.peso(fund.balance))} → <strong>${HP.esc(C.peso(C.round2(fund.balance) + v))}</strong>`
        : "";
    });
    document.getElementById("pcGo").addEventListener("click", async () => {
      const amt = C.num(amtEl.value);
      if (!(amt > 0)) return HP.toast("Enter the amount added.", "danger");
      const note = document.getElementById("pcNote").value.trim();
      await guard(() => C.move(db, Math.abs(amt), { reason: "topup", note }), "Float topped up.");
    });
  }

  function openAdjust() {
    HP.openModal("Correct the float", `
      <div class="pn-form">
        <p class="pn-onhand">The book says <strong>${HP.esc(C.peso(fund.balance))}</strong></p>
        <div class="field">
          <label>Cash actually counted <span class="req">*</span></label>
          <input class="control" id="pcAmt" type="number" min="0" step="0.01" placeholder="0.00" />
          <p class="plan-hint">Type what is really in the box. The difference is written to the
            ledger as a correction — the book is never quietly rewritten.</p>
        </div>
        <div class="field">
          <label>What the recount found <span class="req">*</span></label>
          <input class="control" id="pcNote" placeholder="e.g. ₱120 fare paid from the box, unrecorded" />
        </div>
        <p class="pn-preview" id="pcPrev"></p>
      </div>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="pcGo"><span class="ic">${HP.icon("check")}</span>Record the correction</button>`);
    HP.hydrateIcons(document.querySelector(".modal"));
    const amtEl = document.getElementById("pcAmt");
    const prev = document.getElementById("pcPrev");
    amtEl.addEventListener("input", () => {
      const v = C.num(amtEl.value);
      if (v === null || v < 0) { prev.innerHTML = ""; return; }
      const d = C.round2(v - C.round2(fund.balance));
      prev.innerHTML = d === 0
        ? `The book already agrees — nothing to record.`
        : `${HP.esc(C.peso(fund.balance))} → <strong>${HP.esc(C.peso(v))}</strong>
           <span class="pn-delta">(${HP.esc(C.signedPeso(d))})</span>`;
    });
    document.getElementById("pcGo").addEventListener("click", async () => {
      const counted = C.num(amtEl.value);
      const note = document.getElementById("pcNote").value.trim();
      if (counted === null || counted < 0) return HP.toast("Enter the counted amount.", "danger");
      if (!note) return HP.toast("Say what the recount found — a correction needs a reason.", "danger");
      const d = C.round2(counted - C.round2(fund.balance));
      if (!d) return HP.toast("The book already agrees with the box.", "warn");
      await guard(() => C.move(db, d, { reason: "adjust", note }), "Correction recorded.");
    });
  }

  let busy = false;
  async function guard(fn, okMsg) {
    if (busy) return;
    busy = true;
    const btn = document.getElementById("pcGo");
    if (btn) btn.disabled = true;
    try {
      await fn();
      HP.closeModal();
      HP.toast(okMsg, "ok");
    } catch (e) {
      console.warn("HapagPamana: petty cash —", e);
      HP.toast(e && e.code === "hp/nofund" ? "The float hasn't been opened yet."
        : denied(e) ? "Your role can't move the petty cash."
        : "Couldn't save — check your connection.", "danger");
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
    const head = ["When", "Movement (PHP)", "Reason", "Slip", "Client",
      "Balance before", "Balance after", "Note", "By"];
    const lines = [head.map(cell).join(",")];
    list.forEach((e) => lines.push([
      C.fmtWhen(e), C.round2(e.delta), C.reasonLabel(e.reason),
      e.slipNumber || "", e.clientName || "",
      C.round2(e.before), C.round2(e.after), e.note || "", e.byName || "",
    ].map(cell).join(",")));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_petty_cash.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Petty cash ledger exported as CSV.");
  }
})();
