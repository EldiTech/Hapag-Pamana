/* HapagPamana · Staff portal access guard — ONE copy shared by every
   dashboard, parameterized by `window.HP_DASHBOARD` (each dashboard's
   js/config.js, loaded just before this file):
     roles        the staff roles allowed through (from firebase-config.js)
     verifiedKey  sessionStorage key marking a verified session

   Requires a signed-in user whose users/{uid}.role is in `roles`. Anyone
   else is signed out and sent back to the login — including staff whose
   role belongs to a different dashboard.

   While access is re-verified a slim gilt bar sits at the top of the page
   (the sign-in welcome veil already confirmed access once). Styles live in
   the shared global.css. If Firebase isn't configured, the guard is a
   no-op (local demo mode). */
(function () {
  "use strict";

  const CFG = window.HP_DASHBOARD || {};
  const VERIFIED_KEY = CFG.verifiedKey || "hp_staff_verified";
  const PROFILE_KEY = "hp_user_profile_v1";
  const PROFILE_TTL = 5 * 60 * 1000; // 5 minutes before immediate foreground re-check
  const ROLES = CFG.roles || [];

  function configured() {
    return (
      typeof firebase !== "undefined" &&
      window.firebaseConfig &&
      !String(window.firebaseConfig.apiKey || "").startsWith("PASTE")
    );
  }
  if (!configured()) return; // demo mode — open without auth

  if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  function readCachedProfile(uid) {
    try {
      const raw = sessionStorage.getItem(PROFILE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || (uid && p.uid !== uid)) return null;
      return p;
    } catch (_) {
      return null;
    }
  }

  function writeCachedProfile(user, data) {
    try {
      sessionStorage.setItem(PROFILE_KEY, JSON.stringify({
        uid: user.uid,
        email: user.email || "",
        displayName: user.displayName || "",
        name: (data && data.name) || "",
        role: (data && data.role) || "",
        active: !!(data && data.active !== false),
        ts: Date.now(),
      }));
    } catch (_) {}
  }

  const indicator = document.createElement("div");
  indicator.className = "auth-bar";
  // Only show the top verification bar when the session hasn't been verified yet
  // in this tab, avoiding visual loading flashes on every sidebar click.
  if (sessionStorage.getItem(VERIFIED_KEY) !== "1") {
    const attach = () => (document.body || document.documentElement).appendChild(indicator);
    if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);
  }

  function dropSession() {
    sessionStorage.removeItem(VERIFIED_KEY);
    sessionStorage.removeItem(PROFILE_KEY);
    // The Content Moderator keeps a content cache — clear it wherever it exists.
    if (window.HP && window.HP.clearCache) window.HP.clearCache();
  }
  function bounce() { dropSession(); location.replace("../../index.html"); }

  auth.onAuthStateChanged((user) => {
    if (!user) return bounce();
    verify(user);
  });

  /* Verify the signed-in user's role record. Only an authoritative "no" —
     a missing/deactivated/wrong-role record, or the rules refusing the read
     (permission-denied) — ends the session. A transient failure (offline, a
     Firestore hiccup) must NOT sign anyone out mid-shift: it shows a retry
     gate instead. bounce() runs via finally() so a rejected signOut() can
     never strand the visitor on a page they shouldn't see. */
  function verify(user) {
    const cached = readCachedProfile(user.uid);
    const cacheValid = cached && cached.active !== false && ROLES.includes(cached.role);

    if (cacheValid && Date.now() - (cached.ts || 0) < PROFILE_TTL) {
      sessionStorage.setItem(VERIFIED_KEY, "1");
      indicator.remove();
      removeGate();
      // Provide an immediate resolved snapshot for hp-core.js populateUser()
      window.__hpUserDoc = Promise.resolve({
        exists: true,
        data: () => ({ name: cached.name, role: cached.role, active: cached.active }),
      });
      // Re-verify silently in the background after initial page queries settle
      setTimeout(() => verifyFromNetwork(user, true), 1200);
      return;
    }

    verifyFromNetwork(user, false);
  }

  function verifyFromNetwork(user, silent) {
    // Stash the read so hp-core.js (populateUser) can reuse it instead of
    // fetching the same users/{uid} document a second time on every page.
    const req = db.collection(window.USERS_COLLECTION).doc(user.uid).get();
    if (!silent) window.__hpUserDoc = req;
    req.then((snap) => {
      const data = snap.exists ? snap.data() : null;
      const ok = data && data.active !== false && ROLES.includes(data.role);
      if (ok) {
        sessionStorage.setItem(VERIFIED_KEY, "1");
        writeCachedProfile(user, data);
        indicator.remove();
        removeGate();
      } else {
        auth.signOut().finally(bounce);
      }
    }).catch((e) => {
      if (e && e.code === "permission-denied") return void auth.signOut().finally(bounce);
      if (silent) return;
      console.warn("HapagPamana: couldn't verify access —", e);
      if (sessionStorage.getItem(VERIFIED_KEY) === "1") {
        indicator.remove();
        removeGate();
        return;
      }
      showRetryGate(user);
    });
  }

  // Full-screen gate shown when verification fails for transient reasons.
  let gate = null;
  function removeGate() { if (gate) { gate.remove(); gate = null; } }
  function showRetryGate(user) {
    if (gate) return;
    gate = document.createElement("div");
    gate.className = "auth-gate";
    gate.innerHTML = '<div class="ag-card"><p>Couldn\'t verify your access — check your connection.</p>' +
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:14px;">' +
      '<button class="btn btn-primary" type="button" id="hpGateRetry">Try again</button>' +
      '<button class="btn btn-ghost" type="button" id="hpGateLogin">Sign in again</button>' +
      '</div></div>';
    gate.querySelector("#hpGateRetry").addEventListener("click", () => { removeGate(); verify(user); });
    gate.querySelector("#hpGateLogin").addEventListener("click", bounce);
    (document.body || document.documentElement).appendChild(gate);
  }

  // ── Wire the sidebar "log out" to sign out (and clear the cache) first ────
  document.addEventListener("click", (e) => {
    const logout = e.target.closest(".side-logout");
    if (!logout) return;
    e.preventDefault();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce && window.HP && window.HP.leaveCurtain) window.HP.leaveCurtain("Signing out…");
    dropSession();
    const go = () => location.replace("../../index.html");
    const deactivate = window.HPAdminPush && window.HPAdminPush.deactivate
      ? window.HPAdminPush.deactivate()
      : Promise.resolve();
    deactivate.finally(() => auth.signOut().finally(() => setTimeout(go, reduce ? 0 : 700)));
  });
})();
