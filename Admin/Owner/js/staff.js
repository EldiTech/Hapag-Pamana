/* HapagPamana · Owner — Staff Accounts.
   Mints a staff login in one step: a Firebase Auth account + its users/{uid}
   role record (firestore.rules: isAdmin() covers both admin and owner, so
   the owner can create() here same as an admin could already). Also lists
   every staff record, lets the owner retire (active:false) or reinstate one,
   and re-roll a lost password.

   Auth accounts can't be minted with the normal signed-in SDK instance —
   createUserWithEmailAndPassword signs the CALLER in as the new account,
   which would boot the owner out mid-task. A second, throwaway Firebase app
   instance sidesteps that: it creates the user on its own auth state, then
   is torn down immediately, leaving the owner's session on the primary app
   untouched. No Cloud Functions project exists in this repo yet — this is
   the client-only path until one does. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Staff Accounts",
    sub: "Create staff logins and assign them to a department.",
    search: true,
    action: { label: "Add staff", icon: "plus", fn: () => onCreate() },
  });

  const statsEl = document.getElementById("staffStats");
  const rowsEl = document.getElementById("staffRows");

  const db = HP.ONLINE ? firebase.firestore() : null;

  // The 9 real assignable departments — admin/owner excluded here (minting
  // another owner/admin from this form isn't the job of "assign a department").
  const DEPARTMENTS = [
    "content_moderator", "marketing_admin", "master_chef", "production_manager",
    "purchasing_staff", "stock_clerk", "team_leader", "logistics",
    "layout_designer", "catering_equipment",
  ];
  const label = (role) => HP.ROLE_LABEL[role] || role;

  let staff = []; // [{ uid, name, email, role, active }]
  let query = "";
  let loaded = false;

  statsEl.innerHTML = HP.skel.stats(3);
  rowsEl.innerHTML = HP.skel.rows(5, 4);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.ready.then(boot);

  async function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow("Staff accounts live in Firestore — connect Firebase to manage them.");
      return;
    }
    await refresh();
  }

  async function refresh() {
    if (!db) return;
    try {
      const snap = await db.collection(window.USERS_COLLECTION || "users").get();
      staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    } catch (e) {
      console.error(e);
      rowsEl.innerHTML = emptyRow("Couldn't load staff accounts — check the Firestore rules.");
      return;
    }
    loaded = true;
    renderAll();
  }

  /* ── Random password generator ────────────────────────────────────────
     16 chars drawn from a no-lookalike alphabet (no 0/O/1/l/I) via
     crypto.getRandomValues — good enough entropy for a one-time credential
     the staff member resets on first login. */
  function generatePassword() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    const bytes = new Uint32Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  }

  /* ── Helpers ───────────────────────────────────────────────────────── */
  function emptyRow(msg) {
    return `<tr><td colspan="4" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }
  function avatar(m) {
    const initial = (String(m.name || m.email || "?").trim().charAt(0) || "?").toUpperCase();
    return `<span class="thumb">${HP.esc(initial)}</span>`;
  }
  function matches(m) {
    if (!query) return true;
    return [m.name, m.email, label(m.role)].some((v) => String(v || "").toLowerCase().includes(query));
  }
  const displayName = (m) => (m.name || "").trim() || (m.email || "").trim() || "This account";

  /* ── Rendering ─────────────────────────────────────────────────────── */
  function renderAll() { renderStats(); renderRows(); }

  function renderStats() {
    const total = staff.length;
    const active = staff.filter((m) => m.active !== false).length;
    const stat = (ic, num, lbl) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${num}">${num}</div>
        <div class="stat-label">${lbl}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("users", total, "Staff accounts") +
      stat("check", active, "Active") +
      stat("ban", total - active, "Retired"))) HP.countUp(statsEl);
  }

  function renderRows() {
    if (!loaded) return;
    const list = staff.filter(matches);
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(staff.length
        ? "No staff match your search."
        : "No staff accounts yet — add one to get started.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((m) => `
      <tr class="${m.active === false ? "row-banned" : ""}" data-uid="${HP.esc(m.uid)}">
        <td>
          <div class="cell-name">
            ${avatar(m)}
            <div>
              <strong>${HP.esc(m.name || "Unnamed")}</strong>
              <small>${HP.esc(m.email || "no email on file")}</small>
            </div>
          </div>
        </td>
        <td>${HP.esc(label(m.role))}</td>
        <td>${m.active === false
          ? `<span class="badge badge-danger"><span class="dot"></span>Retired</span>`
          : `<span class="badge badge-ok"><span class="dot"></span>Active</span>`}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="reset" title="Send password-reset email" aria-label="Send ${HP.esc(displayName(m))} a password reset"><span class="ic">${HP.icon("mail")}</span></button>
            ${m.active === false
              ? `<button class="icon-btn" data-act="reinstate" title="Reinstate" aria-label="Reinstate ${HP.esc(displayName(m))}"><span class="ic">${HP.icon("check")}</span></button>`
              : `<button class="icon-btn danger" data-act="retire" title="Retire" aria-label="Retire ${HP.esc(displayName(m))}"><span class="ic">${HP.icon("ban")}</span></button>`}
          </div>
        </td>
      </tr>`).join(""));
    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onAction));
  }

  function onAction(e) {
    const btn = e.currentTarget;
    const uid = btn.closest("tr").dataset.uid;
    const m = staff.find((x) => x.uid === uid);
    if (!m) return;
    if (btn.dataset.act === "reset") onReset(m);
    else if (btn.dataset.act === "retire") onRetire(m);
    else if (btn.dataset.act === "reinstate") onReinstate(m);
  }

  /* ── Create ────────────────────────────────────────────────────────── */
  function onCreate() {
    let pw = generatePassword();

    HP.openModal("Add staff", `
      <form id="staffForm" novalidate>
        <div class="field"><label>Full name <span class="req">*</span></label>
          <input class="control" name="name" maxlength="60" placeholder="Staff member's name">
          <div class="field-error" data-err="name" hidden></div></div>
        <div class="field"><label>Login email <span class="req">*</span></label>
          <input class="control" name="email" type="email" placeholder="name@hapagpamana.com">
          <div class="field-error" data-err="email" hidden></div></div>
        <div class="field"><label>Department <span class="req">*</span></label>
          <select class="control" name="role">
            ${DEPARTMENTS.map((r) => `<option value="${r}">${HP.esc(label(r))}</option>`).join("")}
          </select>
          <div class="field-hint">Which dashboard this account can sign into.</div></div>
        <div class="field"><label>Password</label>
          <input class="control" name="password" value="${HP.esc(pw)}" readonly>
          <div class="field-hint">Generated automatically — shown once. Copy it now and hand it to the
            staff member; they can change it after signing in. "Regenerate" swaps in a new one.</div></div>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button type="button" class="btn btn-ghost" id="staffRegen">Regenerate password</button>
       <button class="btn btn-primary" id="staffSave">Create account</button>`);

    const f = document.getElementById("staffForm");
    document.getElementById("staffRegen").addEventListener("click", () => {
      pw = generatePassword();
      f.password.value = pw;
    });

    const submit = async () => {
      const name = f.name.value.trim();
      const email = f.email.value.trim();
      const role = f.role.value;
      const okName = HP.setErr(f, "name", name ? "" : "Give the staff member a name.");
      const okEmail = HP.setErr(f, "email",
        !email ? "Enter a login email." : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "That email looks invalid." : "");
      if (!okName || !okEmail) return;

      const saveBtn = document.getElementById("staffSave");
      saveBtn.disabled = true;
      try {
        await createStaffAccount({ name, email, role, password: f.password.value });
        HP.closeModal();
        HP.toast(`${name} can now sign in.`);
        await refresh();
      } catch (e) {
        console.error(e);
        saveBtn.disabled = false;
        HP.toast(authErrorMessage(e), "danger");
      }
    };
    document.getElementById("staffSave").addEventListener("click", submit);
    f.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  }

  // Creates the Auth user on a throwaway secondary app instance (so the
  // owner's own session on the default app is untouched), writes the
  // users/{uid} role record, then tears the secondary instance down.
  async function createStaffAccount({ name, email, role, password }) {
    const secondary = firebase.initializeApp(window.firebaseConfig, "hp-staff-create-" + Date.now());
    try {
      const cred = await secondary.auth().createUserWithEmailAndPassword(email, password);
      const uid = cred.user.uid;
      await secondary.auth().signOut();
      await db.collection(window.USERS_COLLECTION || "users").doc(uid).set({
        name, email, role, active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null,
      });
    } finally {
      await secondary.delete();
    }
  }

  function authErrorMessage(e) {
    if (e && e.code === "auth/email-already-in-use") return "That email already has an account.";
    if (e && e.code === "auth/invalid-email") return "That email address is invalid.";
    if (e && e.code === "auth/weak-password") return "That password is too weak — regenerate and try again.";
    return "Couldn't create the account — check the Firestore rules.";
  }

  /* ── Retire / reinstate ────────────────────────────────────────────── */
  function onRetire(m) {
    HP.confirmModal("Retire staff account",
      `Retire ${displayName(m)}? They'll be blocked from signing in until reinstated. The account itself is kept.`,
      async () => {
        try {
          await db.collection(window.USERS_COLLECTION || "users").doc(m.uid).update({ active: false });
          m.active = false;
          HP.toast(`${displayName(m)} is retired.`, "warn");
          renderAll();
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't retire the account — check the Firestore rules.", "danger");
        }
      });
  }

  function onReinstate(m) {
    HP.confirmModal("Reinstate staff account",
      `Reinstate ${displayName(m)}? They'll be able to sign in again right away.`,
      async () => {
        try {
          await db.collection(window.USERS_COLLECTION || "users").doc(m.uid).update({ active: true });
          m.active = true;
          HP.toast(`${displayName(m)} can sign in again.`);
          renderAll();
        } catch (e) {
          console.error(e);
          HP.toast("Couldn't reinstate the account — check the Firestore rules.", "danger");
        }
      }, false);
  }

  /* ── Password reset ────────────────────────────────────────────────── */
  function onReset(m) {
    const email = String(m.email || "").trim();
    if (!email) { HP.toast("This account has no email on file.", "danger"); return; }
    HP.confirmModal("Send password reset",
      `Email ${email} a link to choose a new password? Their current password keeps working until they use the link.`,
      async () => {
        try {
          await HP.FB.auth.sendPasswordResetEmail(email);
          HP.toast("Password-reset email sent.");
        } catch (e) {
          console.error(e);
          HP.toast(e && e.code === "auth/invalid-email"
            ? "That email address is invalid."
            : "Couldn't send the reset email.", "danger");
        }
      }, false);
  }
})();
