/* HapagPamana · Content Moderator — Users page.
   The app's member accounts (the `customers/{uid}` collection, written when a
   guest signs up in the app). See and search every member, ban / unban them
   (the app blocks a banned member at login and signs them out live), edit
   their profile details, and email them a password-reset link.

   Scope note: the sign-in email and password themselves live in Firebase Auth
   and can only be changed by the account owner or the server-side Admin SDK —
   never from a browser. So "edit credentials" here = profile fields (name,
   phone) + a password-reset email; the login email is shown read-only.

   Phone integrity: the app enforces one-account-per-number through the
   `customer_phones/{digits}` index. Editing a phone here keeps that index in
   step (claims the new number, releases the old one) using the same
   normalisation as the app's CustomerRepository._phoneKey. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "User Management",
    sub: "The app's member accounts — ban, unban and edit details.",
    search: true,
    action: { label: "Refresh", icon: "undo", fn: () => refresh() },
  });

  const statsEl = document.getElementById("userStats");
  const rowsEl = document.getElementById("userRows");

  const db = HP.ONLINE ? firebase.firestore() : null;
  const auth = HP.ONLINE ? firebase.auth() : null;

  /* The member list is paginated (Spark quota: reading every customer doc
     on each visit scales linearly with signups). Newest PAGE members load
     first; "Load more" appends the next page; "Refresh" restarts. Search
     only filters the loaded pages. */
  const PAGE = 50;
  let members = []; // [{ uid, name, email, phone, photo, banned, createdAt }]
  let cursor = null;       // last doc of the newest page fetched
  let done = false;        // every account is loaded
  let loadingMore = false;
  let totals = null;       // exact tallies from aggregate counts (cheap reads)
  let query = "";
  let loaded = false;

  // Skeletons while auth + the first fetch run.
  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(5, 5);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.ready.then(boot);

  async function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(
        "Member accounts live in Firestore — connect Firebase to manage them.");
      return;
    }
    await refresh();
  }

  async function refresh() {
    if (!db) return;
    members = []; cursor = null; done = false; loaded = false; totals = null;
    statsEl.innerHTML = HP.skel.stats(4);
    rowsEl.innerHTML = HP.skel.rows(5, 5);
    fetchTotals();
    await loadPage();
  }

  // Exact stat-strip tallies via aggregate counts (1 read per 1000 rows) —
  // the table itself stays paginated. Falls back to counting loaded rows.
  async function fetchTotals() {
    try {
      const col = db.collection("customers");
      const monthAgo = firebase.firestore.Timestamp.fromMillis(Date.now() - 30 * 864e5);
      const [all, banned, fresh] = await Promise.all([
        col.count().get(),
        col.where("banned", "==", true).count().get(),
        col.where("createdAt", ">=", monthAgo).count().get(),
      ]);
      totals = {
        total: all.data().count,
        banned: banned.data().count,
        fresh: fresh.data().count,
      };
    } catch (e) {
      console.warn("HapagPamana: aggregate counts unavailable — counting loaded rows.", e);
      totals = null;
    }
    if (loaded) renderStats();
  }

  // NB: orderBy(createdAt) excludes any legacy account missing that field,
  // and numeric-ms values sort after Timestamps (they surface on the last
  // pages). ts() below still renders both shapes.
  async function loadPage() {
    try {
      let q = db.collection("customers").orderBy("createdAt", "desc");
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.limit(PAGE).get();
      cursor = snap.docs[snap.docs.length - 1] || cursor;
      if (snap.size < PAGE) done = true;
      members = members.concat(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
      loaded = true;
      renderAll();
    } catch (e) {
      console.error("HapagPamana: couldn't load the members —", e);
      if (members.length) {
        HP.toast("Couldn't load more members — check your connection.", "danger");
        return;
      }
      statsEl.innerHTML = "";
      const denied = e && (e.code === "permission-denied" ||
        /permission|insufficient/i.test(e.message || ""));
      rowsEl.innerHTML = emptyRow(denied
        ? "Access denied — publish the updated Firestore rules (moderator access to customers), then reload."
        : "Couldn't reach the database. Check your connection and reload.");
      if (denied) HP.toast("Database access denied — update your Firestore rules.", "danger");
    }
  }

  async function loadMore() {
    if (loadingMore || done) return;
    loadingMore = true;
    renderRows();
    await loadPage();
    loadingMore = false;
    renderRows();
  }

  /* ── Small helpers ─────────────────────────────────────────────────── */
  // Accepts a Firestore Timestamp OR a plain numeric-ms value (older
  // accounts stored createdAt as Date.now()).
  const ts = (v) => {
    if (v && typeof v.toMillis === "function") return v.toMillis();
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  function fmtDate(v) {
    const ms = ts(v);
    if (!ms) return "—";
    return new Date(ms).toLocaleDateString("en-PH",
      { year: "numeric", month: "short", day: "numeric" });
  }

  // Audit stamp carried on every dashboard write to a customer profile.
  const auditStamp = () => ({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null,
  });

  // Mirrors the app's CustomerRepository._phoneKey — one canonical key per
  // number so "+63 917…", "0917…" and "917…" all collide in customer_phones.
  function phoneKey(phone) {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.startsWith("63") && d.length === 12) d = d.slice(2);
    else if (d.startsWith("0") && d.length === 11) d = d.slice(1);
    return d;
  }

  const displayName = (m) => (m.name || "").trim() || (m.email || "").trim() || "This member";

  function emptyRow(msg) {
    return `<tr><td colspan="5" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  function avatar(m) {
    const photo = String(m.photo || "");
    if (photo) return `<span class="thumb"><img src="${HP.esc(photo)}" alt=""></span>`;
    const initial = (String(m.name || m.email || "?").trim().charAt(0) || "?").toUpperCase();
    return `<span class="thumb">${HP.esc(initial)}</span>`;
  }

  /* ── Rendering ─────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderRows(); }

  function renderStats() {
    const monthAgo = Date.now() - 30 * 864e5;
    const total = totals ? totals.total : members.length;
    const banned = totals ? totals.banned : members.filter((m) => m.banned === true).length;
    const fresh = totals ? totals.fresh : members.filter((m) => ts(m.createdAt) >= monthAgo).length;

    const stat = (ic, num, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${num}">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    // Counts tally up on the strip's first paint only.
    if (HP.shell.paint(statsEl,
      stat("users", total, "Members") +
      stat("check", total - banned, "In good standing") +
      stat("ban", banned, "Banned") +
      stat("calendar", fresh, "Joined last 30 days"))) HP.countUp(statsEl);
  }

  function matches(m) {
    if (!query) return true;
    return [m.name, m.email, m.phone]
      .some((v) => String(v || "").toLowerCase().includes(query));
  }

  // The "load more" table foot — shown while more accounts may exist.
  function moreRowHTML() {
    if (done) return "";
    return `<tr><td colspan="5" class="table-empty">
      <button class="btn btn-ghost" id="loadMoreUsers" ${loadingMore ? "disabled" : ""}>
        <span class="ic">${HP.icon("undo")}</span>${loadingMore ? "Loading more members…" : "Load more members"}
      </button></td></tr>`;
  }
  function wireLoadMore() {
    const b = document.getElementById("loadMoreUsers");
    if (b) b.addEventListener("click", loadMore);
  }

  function renderRows() {
    if (!loaded) return;
    const list = members.filter(matches);
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(members.length
        ? "No members match your search."
        : "No member accounts yet — they appear here when guests sign up in the app.")
        + moreRowHTML();
      wireLoadMore();
      return;
    }
    HP.shell.paint(rowsEl, list.map((m) => `
      <tr class="${m.banned ? "row-banned" : ""}" data-uid="${HP.esc(m.uid)}">
        <td>
          <div class="cell-name">
            ${avatar(m)}
            <div>
              <strong>${HP.esc(m.name || "Unnamed")}</strong>
              <small>${HP.esc(m.email || "no email on file")}</small>
            </div>
          </div>
        </td>
        <td>${HP.esc(m.phone || "—")}</td>
        <td>${fmtDate(m.createdAt)}</td>
        <td>${m.banned
          ? `<span class="badge badge-danger"><span class="dot"></span>Banned</span>`
          : `<span class="badge badge-ok"><span class="dot"></span>Active</span>`}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="edit" title="Edit details" aria-label="Edit ${HP.esc(displayName(m))}"><span class="ic">${HP.icon("edit")}</span></button>
            <button class="icon-btn" data-act="reset" title="Send password-reset email" aria-label="Send ${HP.esc(displayName(m))} a password reset"><span class="ic">${HP.icon("mail")}</span></button>
            ${m.banned
              ? `<button class="icon-btn" data-act="unban" title="Lift the ban" aria-label="Unban ${HP.esc(displayName(m))}"><span class="ic">${HP.icon("check")}</span></button>`
              : `<button class="icon-btn danger" data-act="ban" title="Ban this member" aria-label="Ban ${HP.esc(displayName(m))}"><span class="ic">${HP.icon("ban")}</span></button>`}
          </div>
        </td>
      </tr>`).join("") + moreRowHTML());
    wireLoadMore();
    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onAction));
  }

  function onAction(e) {
    const btn = e.currentTarget;
    const uid = btn.closest("tr").dataset.uid;
    const m = members.find((x) => x.uid === uid);
    if (!m) return;
    if (btn.dataset.act === "edit") onEdit(m);
    else if (btn.dataset.act === "reset") onReset(m);
    else if (btn.dataset.act === "ban") onBan(m);
    else if (btn.dataset.act === "unban") onUnban(m);
  }

  /* ── Ban / unban ───────────────────────────────────────────────────── */
  function onBan(m) {
    HP.confirmModal("Ban member",
      `Ban ${displayName(m)}? They'll be signed out of the app and blocked from logging in until the ban is lifted. Their account and history are kept.`,
      async () => {
        try {
          await db.collection("customers").doc(m.uid).set({
            banned: true,
            bannedAt: firebase.firestore.FieldValue.serverTimestamp(),
            ...auditStamp(),
          }, { merge: true });
          m.banned = true;
          HP.toast(`${displayName(m)} is banned.`, "warn");
          renderAll();
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't ban the member — check the Firestore rules.", "danger");
        }
      });
  }

  function onUnban(m) {
    HP.confirmModal("Lift ban",
      `Lift the ban on ${displayName(m)}? They'll be able to log in to the app again right away.`,
      async () => {
        try {
          await db.collection("customers").doc(m.uid).set({
            banned: false,
            bannedAt: firebase.firestore.FieldValue.delete(),
            ...auditStamp(),
          }, { merge: true });
          m.banned = false;
          HP.toast(`${displayName(m)} can log in again.`);
          renderAll();
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't lift the ban — check the Firestore rules.", "danger");
        }
      }, false);
  }

  /* ── Password reset ────────────────────────────────────────────────── */
  function onReset(m) {
    const email = String(m.email || "").trim();
    if (!email) { HP.toast("This member has no email on file.", "danger"); return; }
    HP.confirmModal("Send password reset",
      `Email ${email} a link to choose a new password? Their current password keeps working until they use the link.`,
      async () => {
        try {
          await auth.sendPasswordResetEmail(email);
          HP.toast("Password-reset email sent.");
        } catch (e) {
          console.error(e);
          HP.toast(e && e.code === "auth/invalid-email"
            ? "That email address is invalid."
            : "Couldn't send the reset email.", "danger");
        }
      }, false);
  }

  /* ── Edit details ──────────────────────────────────────────────────── */
  function onEdit(m) {
    HP.openModal("Edit member", `
      <form id="userForm">
        <div class="field"><label>Full name <span class="req">*</span></label>
          <input class="control" name="name" maxlength="60" value="${HP.esc(m.name || "")}" placeholder="Member's name">
          <div class="field-error" data-err="name" hidden></div></div>
        <div class="field"><label>Phone <span class="req">*</span></label>
          <input class="control" name="phone" maxlength="20" value="${HP.esc(m.phone || "")}" placeholder="0917 123 4567">
          <div class="field-error" data-err="phone" hidden></div></div>
        <div class="field"><label>Login email</label>
          <input class="control" value="${HP.esc(m.email || "")}" disabled>
          <div class="field-hint">The sign-in email and password live in Firebase Auth and can't be
            changed from the dashboard — use “Send password reset” to let the member choose a new
            password themselves.</div></div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="userSave">Save changes</button>`);

    const f = document.getElementById("userForm");
    const submit = async () => {
      const name = f.name.value.trim();
      const phone = f.phone.value.trim();
      const okName = HP.setErr(f, "name", name ? "" : "Give the member a name.");
      const digits = phone.replace(/\D/g, "");
      const okPhone = HP.setErr(f, "phone",
        !phone ? "Enter the member's phone number."
        : digits.length < 7 ? "That phone number looks too short." : "");
      if (!okName || !okPhone) return;

      const saveBtn = document.getElementById("userSave");
      saveBtn.disabled = true;
      try {
        const saved = await saveEdit(m, name, phone, f);
        if (!saved) { saveBtn.disabled = false; return; } // phone taken — stay open
        HP.closeModal();
        HP.toast("Member updated.");
        renderAll();
      } catch (e) {
        console.error(e);
        saveBtn.disabled = false;
        HP.toast("Couldn't save the changes — check the Firestore rules.", "danger");
      }
    };
    document.getElementById("userSave").addEventListener("click", submit);
    f.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  }

  // Persists a profile edit. When the phone number actually changes, the
  // customer_phones uniqueness index moves with it inside a TRANSACTION —
  // the availability check and the claim commit atomically, so a number
  // signed up between check and save surfaces as "just claimed" instead of
  // silently double-claiming (or a cryptic rules error). Returns false
  // (with a field error) when the number belongs to another account.
  async function saveEdit(m, name, phone, form) {
    const ref = db.collection("customers").doc(m.uid);
    const oldKey = phoneKey(m.phone);
    const newKey = phoneKey(phone);

    if (newKey === oldKey) {
      await ref.set({ name, phone, ...auditStamp() }, { merge: true });
    } else {
      const idxRef = db.collection("customer_phones").doc(newKey);
      try {
        await db.runTransaction(async (tx) => {
          const taken = await tx.get(idxRef);
          if (taken.exists && taken.data().uid !== m.uid) {
            const err = new Error("phone taken"); err.code = "hp/phone-taken"; throw err;
          }
          if (!taken.exists) {
            tx.set(idxRef, {
              uid: m.uid,
              createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
          }
          if (oldKey) tx.delete(db.collection("customer_phones").doc(oldKey));
          tx.set(ref, { name, phone, ...auditStamp() }, { merge: true });
        });
      } catch (e) {
        if (e && e.code === "hp/phone-taken") {
          HP.setErr(form, "phone", "That phone number was just claimed by another account.");
          return false;
        }
        throw e;
      }
    }
    m.name = name;
    m.phone = phone;
    return true;
  }
})();
