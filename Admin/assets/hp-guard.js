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

  const indicator = document.createElement("div");
  indicator.className = "auth-bar";
  const attach = () => (document.body || document.documentElement).appendChild(indicator);
  if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach);

  function dropSession() {
    sessionStorage.removeItem(VERIFIED_KEY);
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
    // Stash the read so hp-core.js (populateUser) can reuse it instead of
    // fetching the same users/{uid} document a second time on every page.
    window.__hpUserDoc = db.collection(window.USERS_COLLECTION).doc(user.uid).get();
    window.__hpUserDoc.then((snap) => {
      const data = snap.exists ? snap.data() : null;
      const ok = data && data.active !== false && ROLES.includes(data.role);
      if (ok) {
        sessionStorage.setItem(VERIFIED_KEY, "1");
        indicator.remove();
        removeGate();
      } else {
        auth.signOut().finally(bounce);
      }
    }).catch((e) => {
      if (e && e.code === "permission-denied") return void auth.signOut().finally(bounce);
      console.warn("HapagPamana: couldn't verify access —", e);
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
      '<button class="btn btn-primary" type="button">Try again</button></div>';
    gate.querySelector("button").addEventListener("click", () => { removeGate(); verify(user); });
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
    auth.signOut().finally(() => setTimeout(go, reduce ? 0 : 700));
  });
})();
