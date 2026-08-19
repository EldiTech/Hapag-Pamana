/* HapagPamana · petty cash — the production manager's ingredient float.

   The money the house keeps on hand for the market run, and the record of
   where it went. Two documents:

     settings/pettyCash
       { balance, opening, updatedAt, updatedByName }
       What is in the box right now.

     pettyCashLog/{id}
       { delta, before, after, reason, note, bookingId, clientName,
         slipNumber, byUid, byName, at, atLocal }
       Every movement, append-only — the balance is the running total of this
       list, and a balance that can move without a trace is one nobody can
       count against the box at the end of the day.

   THE CYCLE the flow actually models:

     top up      +  cash put into the box
     release     −  a slip is cut: that money is committed to the buyer
     settle      ±  the run is liquidated: the difference between what was
                    authorised and what was really spent comes back (or, if
                    the buyer overspent, is taken out)
     adjust      ±  a recount corrected the box

   Releasing deducts rather than waiting for the spend, because the cash
   physically leaves the box when it is handed over. Between release and
   liquidation the fund must NOT still count that money as available — which
   is exactly the mistake a spend-only model makes.

   Loads after hp-core.js. Exposed on window.HPCash. Writing requires the
   production_manager (or admin) role — see firestore.rules. */
window.HPCash = (function () {
  "use strict";
  const HP = window.HP;

  const FUND_DOC = "pettyCash";      // settings/pettyCash
  const LOG = "pettyCashLog";

  const REASONS = {
    topup:   { label: "Top-up",            hint: "Cash added to the box." },
    release: { label: "Slip released",     hint: "Committed to a buyer against a requisition." },
    settle:  { label: "Liquidation",       hint: "Change returned, or an overspend taken out." },
    adjust:  { label: "Correction",        hint: "A recount disagreed with the book." },
    opening: { label: "Opening balance",   hint: "The float as first counted." },
  };
  const reasonLabel = (k) => (REASONS[k] || { label: k || "—" }).label;

  /* Pesos, kept to whole centavos. Money must not accumulate binary float
     dust across hundreds of movements — a balance of 7819.999999 is one
     nobody can reconcile against a cash box. */
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  const peso = (n) => (n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—" : "₱" + round2(n).toLocaleString("en-PH", { maximumFractionDigits: 2 }));
  const signedPeso = (n) => {
    const v = round2(n);
    return (v > 0 ? "+" : v < 0 ? "−" : "") + peso(Math.abs(v));
  };

  /* How healthy the float is. `low` is deliberately relative to the fund's
     own opening figure rather than a hard number: a ₱5,000 float and a
     ₱50,000 float do not run low at the same peso. */
  function stateOf(fund) {
    const bal = round2(fund && fund.balance);
    const opening = round2(fund && fund.opening);
    if (bal <= 0) return "empty";
    if (opening > 0 && bal <= opening * 0.2) return "low";
    return "ok";
  }
  const STATE_LABEL = { empty: "Empty", low: "Running low", ok: "Funded" };
  const STATE_BADGE = { empty: "badge-warn", low: "badge-gold", ok: "badge-ok" };

  /* One ledger entry, stamped in one place so every writer agrees on shape.
     `before`/`after` are computed by the caller from the value it actually
     wrote — never re-read afterwards, which would race another officer. */
  function logEntry(o) {
    return {
      delta: round2(o.delta),
      before: round2(o.before),
      after: round2(o.after),
      reason: o.reason || "adjust",
      note: String(o.note || "").trim(),
      // Present when the movement belongs to a requisition.
      bookingId: o.bookingId || null,
      clientName: o.clientName || null,
      slipNumber: o.slipNumber || null,
      byUid: (HP.FB && HP.FB.auth.currentUser) ? HP.FB.auth.currentUser.uid : null,
      byName: (HP.user && HP.user.name) || "—",
      at: firebase.firestore.FieldValue.serverTimestamp(),
      // A client clock too: serverTimestamp reads null until the write lands,
      // and the ledger has to sort the moment it paints.
      atLocal: Date.now(),
    };
  }
  const entryTime = (e) => {
    const t = e && e.at;
    if (t && typeof t.toMillis === "function") return t.toMillis();
    return Number(e && e.atLocal) || 0;
  };
  function fmtWhen(e) {
    const ms = entryTime(e);
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  /* ── The one way the balance ever moves ──────────────────────────────────
     A transaction, always: two officers releasing slips at the same moment
     must not both compute `after` from the same stale `before`. The fund doc
     and its ledger entry are written together, so a balance can never exist
     without the entry that explains it.

     `delta` is signed by the caller — release passes a negative, top-up a
     positive — because only the caller knows which way the cash went.

     Returns the new balance. Throws {code:"hp/nofund"} if the fund has not
     been opened yet, so callers can say so rather than inventing a float. */
  async function move(db, delta, meta) {
    const d = round2(delta);
    const ref = db.collection("settings").doc(FUND_DOC);
    const logRef = db.collection(LOG).doc();
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw Object.assign(new Error("no fund"), { code: "hp/nofund" });
      const cur = snap.data() || {};
      const before = round2(cur.balance);
      const after = round2(before + d);
      tx.set(ref, {
        balance: after,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedByName: (HP.user && HP.user.name) || "—",
      }, { merge: true });
      tx.set(logRef, logEntry(Object.assign({ delta: d, before, after }, meta || {})));
      return after;
    });
  }

  /* Releasing a slip commits cash to a buyer. Deliberately NOT blocked when
     the fund cannot cover it: the slip is finance's decision and the money
     may be coming from elsewhere. The balance is allowed to go negative so
     the overdraw is visible in the ledger rather than hidden by a refusal. */
  const release = (db, amount, meta) =>
    move(db, -Math.abs(round2(amount)), Object.assign({ reason: "release" }, meta));

  /* Liquidation settles the difference. authorised − spent: positive means
     change came back, negative means the buyer overspent and the box owes
     it. A zero difference writes nothing — an entry saying "±₱0" is noise in
     a ledger meant to be read. */
  function settle(db, authorised, spent, meta) {
    const diff = round2(round2(authorised) - round2(spent));
    if (!diff) return Promise.resolve(null);
    return move(db, diff, Object.assign({ reason: "settle" }, meta));
  }

  return {
    FUND_DOC, LOG, REASONS, reasonLabel,
    num, round2, peso, signedPeso,
    stateOf, STATE_LABEL, STATE_BADGE,
    logEntry, entryTime, fmtWhen,
    move, release, settle,
  };
})();
