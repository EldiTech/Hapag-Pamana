/* ════════════════════════════════════════════════════════════════
   HapagPamana · Staff portal CORE — ONE copy shared by every dashboard.
   The non-visual half of each dashboard: Firebase init, the icon set,
   esc(), the CSV cell writer, toast / modal primitives, motion helpers,
   skeletons, the signed-in identity and the auth-gated `ready` promise —
   exposed on `window.HP`.

   Parameterized per dashboard by `window.HP_DASHBOARD` (js/config.js):
     defaultRoleLabel  sidebar identity fallback ("Moderator", …)
     icons             optional { name: [paths, extraPaths] } additions
   (roles/verifiedKey feed hp-guard.js; shell feeds hp-shell.js.)

   The Content Moderator layers its Firestore content store on top
   (its js/store.js re-points HP.ready at the data-ready promise and adds
   HP.store & friends). The other dashboards stream their collections
   live and deliberately carry NO content store or IndexedDB cache.

   Load order on every page:
     firebase-*-compat → ../../firebase-config.js → ../js/config.js
     → ../../assets/hp-guard.js → hp-core.js → hp-shell.js
     → [dashboard extras] → ../js/<page>.js
   ════════════════════════════════════════════════════════════════ */
window.HP = (function () {
  "use strict";

  const CFG = window.HP_DASHBOARD || {};

  /* ── Icons (inline SVG) — the union set for all three dashboards ─────── */
  const P = (d, extra) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}${extra || ""}</svg>`;
  const ICONS = {
    grid:   P('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    dish:   P('<path d="M4 11h16a8 8 0 0 0-16 0Z"/><path d="M2 11h20"/><path d="M12 11V4"/><path d="M6 21h12"/>'),
    tag:    P('<path d="M3 11.5V4a1 1 0 0 1 1-1h7.5L21 12.5 12.5 21 3 11.5Z"/><circle cx="7.5" cy="7.5" r="1.4"/>'),
    box:    P('<path d="M3.3 7 12 12l8.7-5"/><path d="M12 12v9"/><path d="M21 8.5v7l-9 5-9-5v-7l9-5 9 5Z"/>'),
    mail:   P('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
    gear:   P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.17V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15H4.5a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 11 4.6h0A1.65 1.65 0 0 0 12 3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 19 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9"/>'),
    menu:   P('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    search: P('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>'),
    plus:   P('<path d="M12 5v14M5 12h14"/>'),
    edit:   P('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"/>'),
    pencil: P('<path d="M4 20l4.3-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="M13.6 7.4l3 3"/>'),
    trash:  P('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
    close:  P('<path d="M6 6l12 12M18 6 6 18"/>'),
    check:  P('<path d="M20 6 9 17l-5-5"/>'),
    undo:   P('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
    download: P('<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>'),
    logout: P('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>'),
    phone:  P('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>'),
    users:  P('<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M21 20a6 6 0 0 0-4-5.6"/>'),
    ban:    P('<circle cx="12" cy="12" r="9"/><path d="M5.7 5.7l12.6 12.6"/>'),
    peso:   P('<path d="M7 21V4h6a4.5 4.5 0 0 1 0 9H7"/><path d="M4 9h9M4 13h9"/>'),
    calendar: P('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>'),
    clock:  P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
    star:   P('<path d="M12 3.2l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.7 6.9 19.2l1-5.8L3.7 9.3l5.8-.8L12 3.2Z"/>'),
    photo:  P('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M9 5l1.5-2h3L15 5"/>'),
    upload: P('<path d="M12 15V3"/><path d="M17 8l-5-5-5 5"/><path d="M4 21h16"/>'),
    eye:    P('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'),
    pin:    P('<path d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
    party:  P('<path d="M5.2 12.8 3 21l8.2-2.2"/><path d="M5.2 12.8 11.2 18.8"/><path d="M8.6 9.4c2.5-2.5 6.3-3.2 8.4-1.1s1.4 5.9-1.1 8.4"/><path d="M14.5 3.5v.01M20.5 9.5v.01M18.5 5.5l.01-.01"/>'),
    // Orders — a ledger sheet with ruled lines and a check.
    ledger: P('<path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M9 7h6M9 11h6"/><path d="M9 15.5l1.6 1.6L14 13.7"/>'),
    // Prep board — a chef's toque.
    hat:    P('<path d="M6.8 11.6a4.1 4.1 0 0 1 .7-8 5.2 5.2 0 0 1 9 0 4.1 4.1 0 0 1 .7 8"/><path d="M6.8 11.4V18h10.4v-6.6"/><path d="M6.8 15h10.4"/>'),
    // Ingredients — a market basket.
    basket: P('<path d="M4.8 10h14.4l-1.6 9.5H6.4L4.8 10Z"/><path d="M3 10h18"/><path d="M9 10l3-6.5L15 10"/><path d="M9.8 13.5v3M14.2 13.5v3"/>'),
    // Recipe book — a bound ledger of dishes.
    book:   P('<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17.5H6.5A2.5 2.5 0 0 0 4 22V4.5Z"/><path d="M20 17H6.5A2.5 2.5 0 0 0 4 19.5"/><path d="M9 7h7M9 10.5h5"/>'),
    printer: P('<path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="7"/>'),
    // ── Food category icons (used by the menu categories) ──
    // Each silhouette is deliberately distinct so the bowl-based categories
    // (salad / soup / pasta / rice) don't read as the same shape.
    salad:  P('<path d="M3 12.5h18"/><path d="M4 12.5c0 4.1 3.6 7 8 7s8-2.9 8-7"/><path d="M9.6 12c-2-.8-3-3-2.2-5 2 .6 3.2 2.8 2.2 5Z"/><path d="M12.4 11.7c-1.4-1.7-1.2-4.2.5-5.8 1.4 1.6 1.5 4.1.1 5.8Z"/><path d="M14.8 12c2-.8 3-3 2.2-5-2 .6-3.2 2.8-2.2 5Z"/>', '<circle cx="9.9" cy="11.4" r=".9" fill="currentColor" stroke="none"/><circle cx="14.3" cy="11.2" r=".9" fill="currentColor" stroke="none"/>'),
    leaf:   P('<path d="M4.5 19.5C4.5 11.5 9.5 5.5 19.5 4.5c.8 8-4 14.5-12.5 15"/><path d="M4.5 19.5c3.5-1.1 6.9-4.5 9.5-9.5"/><path d="m9.7 16 2-2M11.6 13.4l2-2"/>'),
    fish:   P('<path d="M3.5 12C7 7.8 13 7.8 16.5 12 13 16.2 7 16.2 3.5 12Z"/><path d="M16.5 12 21 8.8v6.4Z"/><path d="M10.6 8.6c-1.5 1.5-1.5 5.3 0 6.8"/>', '<circle cx="6.6" cy="10.7" r=".9" fill="currentColor" stroke="none"/>'),
    // Pork — a full pig face (head, ears, snout, eyes) so it reads instantly.
    meat:   P('<circle cx="12" cy="12.7" r="7.6"/><path d="M6.9 7.1 5.3 3.7l4 1"/><path d="M17.1 7.1l1.6-3.4-4 1"/><ellipse cx="12" cy="13.6" rx="3.5" ry="2.5"/>', '<ellipse cx="10.7" cy="13.6" rx=".65" ry="1.1" fill="currentColor" stroke="none"/><ellipse cx="13.3" cy="13.6" rx=".65" ry="1.1" fill="currentColor" stroke="none"/><circle cx="8.7" cy="9.9" r=".9" fill="currentColor" stroke="none"/><circle cx="15.3" cy="9.9" r=".9" fill="currentColor" stroke="none"/>'),
    // Chicken — a drumstick drawn as ONE outline: meat lobe tapering into a
    // neck that ends in the two-knob bone (a detached circle + stick reads as
    // a magnifying glass). Two filled seasoning dots sell it as food.
    drumstick: P('<path d="M18.9 5.1c2.1 2.1 1.9 5.7-.4 8-1.6 1.6-3.8 2.3-5.8 1.9l-2.4 2.4c.5 1-.1 2.1-1.2 2.4-.4.1-.9.1-1.3-.1-.2.4-.5.7-.9.9-1 .5-2.2.1-2.7-.9-.3-.7-.2-1.5.3-2.1.2-.4.5-.7.9-.9-.2-.4-.2-.9-.1-1.3.3-1.1 1.4-1.7 2.4-1.2l2.4-2.4c-.4-2 .3-4.2 1.9-5.8 2.3-2.3 5.9-2.5 8-.4Z"/>', '<circle cx="14.1" cy="7.1" r=".85" fill="currentColor" stroke="none"/><circle cx="16.9" cy="9.4" r=".85" fill="currentColor" stroke="none"/>'),
    // Beef — a steak with grill marks and a round bone.
    steak:  P('<path d="M5 11.4c-.4-3 2.1-5.2 5.6-5.5 4.4-.4 8.4 1.6 8.9 5.1.4 3-2.1 5.6-5.6 6-4.4.6-8.4-1.6-8.9-5.6Z"/><circle cx="16" cy="9.8" r="1.7"/><path d="m8.4 10.6 3.5 3.5M11.4 9.3l3.5 3.5"/>'),
    // Seafood — a prawn: fat curled body with segment ticks, tail fan, antennae.
    shrimp: P('<path d="M17.5 6.2H9.4a5.9 5.9 0 0 0 0 11.8h2.4"/><path d="M17.5 6.2a3 3 0 0 1 0 6H9.9"/><path d="M11.8 18c2.9-.9 4.9-2.9 5.5-5.9"/><path d="m11.8 18-2-1.5M11.8 18l-1.9 1.6"/><path d="M18.9 6.2c1.5-.3 2.6-1 3.1-2.2M18.9 6.5c1.3.5 2.7.4 3.6-.2"/>', '<circle cx="17" cy="9.2" r=".9" fill="currentColor" stroke="none"/>'),
    soup:   P('<path d="M2.5 13.5h19"/><path d="M3.5 13.5c0 4 3.8 7 8.5 7s8.5-3 8.5-7"/><path d="M8.5 10c-1-1-1-2.5 0-3.5M12 10c-1-1-1-2.5 0-3.5M15.5 10c-1-1-1-2.5 0-3.5"/>'),
    // Pasta — a fork twirling noodles (the only icon with a fork).
    pasta:  P('<path d="M9.4 4v4.2M12 4v4.2M14.6 4v4.2"/><path d="M9.4 8.2c0 1.6 1.1 2.6 2.6 2.6s2.6-1 2.6-2.6"/><path d="M12 10.8V20"/><path d="M6.6 13.4c0-1.7 2.4-2.8 5.4-2.8s5.4 1.1 5.4 2.8-2.4 2.8-5.4 2.8"/><path d="M7.5 16.2c1.1.9 2.8 1.4 4.5 1.4"/>'),
    // Noodles — a bowl with chopsticks lifting strands (Pasta keeps the fork,
    // Rice keeps the mound + grains, so the three bowls stay distinct).
    noodles: P('<path d="M3 13.5h18"/><path d="M4 13.5c0 4 3.6 6.8 8 6.8s8-2.8 8-6.8"/><path d="M8.2 13.5c-.7-2.4.7-4.3 0-6.7M11.5 13.5c-.7-2.6.7-4.7 0-7.3M14.8 13.5c-.7-2.4.7-4.3 0-6.7"/><path d="M18.2 2.8 7.6 6.2M19.4 4.8 8.6 8.2"/>'),
    // Rice — a bowl of mounded rice with crossed chopsticks.
    rice:   P('<path d="M3 13.5h18"/><path d="M4 13.5c0 4 3.6 6.8 8 6.8s8-2.8 8-6.8"/><path d="M5.5 13.5c0-3 2.9-5 6.5-5s6.5 2 6.5 5"/><path d="M13.5 9 21 4M15 10.3 22 6"/>', '<circle cx="9.5" cy="11.4" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="10.8" r=".7" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11.4" r=".7" fill="currentColor" stroke="none"/>'),
    // Dessert — a candled celebration cake on a plate (nothing bin-shaped).
    cake:   P('<path d="M4.4 20.3v-5.9c0-1 .8-1.9 1.9-1.9h11.4c1 0 1.9.8 1.9 1.9v5.9"/><path d="M2.8 20.5h18.4"/><path d="M4.4 16.2s.6-1.1 1.9-1.1 1.9 1.5 3.2 1.5 1.9-1.5 3.2-1.5 1.9 1.5 3.2 1.5 1.8-1.1 1.8-1.1"/><path d="M8 12.5v-2.3M12 12.5V9.9M16 12.5v-2.3"/><path d="M8 7.4h.01M12 6.9h.01M16 7.4h.01"/>'),
    // Drinks — a takeaway cup: lid, slanted straw, a bubble line in the drink.
    cup:    P('<path d="M7.2 9.2 8.5 20.3c.1.9.8 1.5 1.7 1.5h3.6c.9 0 1.6-.6 1.7-1.5L16.8 9.2"/><path d="M6.1 9.2h11.8"/><path d="m12.4 9.2 1.5-6 2.7.6"/><path d="M8 13.6c1.3.9 2.7 1.3 4 1.3s2.7-.4 4-1.3"/>'),
    skewer: P('<path d="M5 19 19 5"/><path d="m18.2 5.8 2-2M4.8 19.2l-2 2"/><circle cx="8.6" cy="15.4" r="2.1"/><circle cx="12" cy="12" r="2.1"/><circle cx="15.4" cy="8.6" r="2.1"/>'),
    // Sandwich — dome top bread, two filling layers, flat bottom bread.
    sandwich: P('<path d="M3 11C3 7 7 5 12 5s9 2 9 6"/><path d="M3 11h18"/><path d="M3 14.5h18"/><path d="M3 17h18"/><path d="M3 17v2.5c0 .8.7 1.5 1.5 1.5h15c.8 0 1.5-.7 1.5-1.5V17"/>'),
  };
  // A dashboard may bring icons of its own: { name: [paths, extraPaths] }.
  Object.keys(CFG.icons || {}).forEach((k) => {
    const v = CFG.icons[k];
    ICONS[k] = Array.isArray(v) ? P(v[0], v[1]) : String(v);
  });
  function icon(name) { return ICONS[name] || ""; }
  // Replace every static [data-icon] placeholder inside `root` with its SVG.
  function hydrateIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // CSV cell writer shared by every export: quotes doubled, and any value
  // Excel would run as a formula (= + - @ or tab/CR lead) prefixed with '
  // so customer-typed text can't execute on a staff machine.
  const csvCell = (v) => {
    const s = String(v ?? "");
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`;
  };

  // Firebase handle (null ⇒ offline/demo mode). Firebase + config are loaded
  // by the page before this script; we guard initializeApp so this file is
  // safe to load on its own.
  const FB = (function () {
    const cfg = window.firebaseConfig;
    if (typeof firebase === "undefined" || !cfg || String(cfg.apiKey || "").startsWith("PASTE")) return null;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    return { auth: firebase.auth(), db: firebase.firestore() };
  })();
  const ONLINE = !!FB;

  /* ── Signed-in user (sidebar identity + greeting) ────────────────────── */
  const ROLE_LABEL = {
    content_moderator: "Content Moderator",
    order_manager: "Order Manager",
    master_chef: "Master Chef",
    admin: "Administrator",
  };
  const DEFAULT_ROLE = CFG.defaultRoleLabel || "Staff";
  const user = { name: "Signed in", role: DEFAULT_ROLE, initial: "·", greet: "" };

  // Paint the current user into the sidebar (no-op if the shell isn't built
  // yet, so this is safe to call before or after hp-shell.js runs).
  function applyUser() {
    const a = document.getElementById("userAvatar");
    const n = document.getElementById("userName");
    const r = document.getElementById("userRole");
    if (n) n.textContent = user.name;
    if (r) r.textContent = user.role;
    if (a) a.textContent = user.initial;
  }
  function setUser(name, roleLabel) {
    const safe = (name || "Signed in").trim() || "Signed in";
    user.name = safe;
    user.role = roleLabel || DEFAULT_ROLE;
    user.initial = (safe.charAt(0) || "·").toUpperCase();
    user.greet = safe.split(/\s+/)[0];
    applyUser();
  }
  // Read the signed-in user's role record and show their name + role label.
  // hp-guard.js already fetches the same document on every page (the role
  // check) and stashes its promise on window.__hpUserDoc — reuse it instead
  // of paying a second read for the same data.
  async function populateUser(authUser) {
    const emailName = (authUser.email || "").split("@")[0];
    try {
      const snap = await (window.__hpUserDoc
        || FB.db.collection(window.USERS_COLLECTION).doc(authUser.uid).get());
      const d = snap.exists ? snap.data() : {};
      setUser(d.name || authUser.displayName || emailName, ROLE_LABEL[d.role] || DEFAULT_ROLE);
    } catch {
      setUser(authUser.displayName || emailName, DEFAULT_ROLE);
    }
  }

  /* ── Leaving curtain (logout / hand-off) ─────────────────────────────────
     A full-screen brown veil matching the sign-in welcome curtain. Shown over
     the current page before navigating away (e.g. on sign-out) so the exit
     reads as a deliberate fade, not a hard cut. */
  function leaveCurtain(text) {
    const el = document.createElement("div");
    el.className = "auth-gate leave-veil";
    el.innerHTML = `<div class="ag-card"><div class="ag-spin"></div><p>${esc(text || "Signing out…")}</p></div>`;
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  /* ── Motion helpers ──────────────────────────────────────────────────────
     The global stylesheet's reduced-motion rule kills CSS animations, but it
     can't reach JS-driven motion (WAAPI, rAF count-ups) — every JS animation
     below and in the pages gates on reduceMotion() instead. */
  function reduceMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // Count every [data-count] figure inside `scope` up from 0 — the ledger
  // tallying itself. Reduced-motion users get the final value immediately.
  function countUp(scope) {
    if (!scope) return;
    scope.querySelectorAll("[data-count]").forEach((el) => {
      const to = Number(el.dataset.count) || 0;
      if (reduceMotion() || !to) { el.textContent = String(to); return; }
      const dur = 650, t0 = performance.now();
      (function step(t) {
        const k = Math.min((t - t0) / dur, 1);
        el.textContent = String(Math.round(k * to));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  }

  // Fade a card out just before a delete repaint removes it, so the deletion
  // reads as "this one left" instead of a blink. Resolves once the exit
  // animation ends (immediately under reduced motion or without an element).
  function animateOut(el) {
    return new Promise((resolve) => {
      if (!el || reduceMotion()) return resolve();
      el.style.pointerEvents = "none";
      el.classList.add("item-leave");
      el.addEventListener("animationend", () => resolve(), { once: true });
      setTimeout(resolve, 350); // safety net if the animation never fires
    });
  }

  /* ── Toast ───────────────────────────────────────────────────────────── */
  function toast(msg, type = "ok") {
    const wrap = document.getElementById("toastWrap");
    if (!wrap) return;
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.innerHTML = `<span class="ic">${icon(type === "danger" ? "trash" : "check")}</span>${esc(msg)}`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      t.addEventListener("animationend", () => {
        // Collapse the vacated slot so any toasts above settle instead of snapping.
        if (reduceMotion() || !t.animate) return t.remove();
        t.style.overflow = "hidden";
        const fall = t.animate(
          [{ height: t.offsetHeight + "px", marginBottom: "0px" },
           { height: "0px", marginBottom: "-10px" }], // -10px absorbs the stack gap
          { duration: 160, easing: "ease" });
        fall.onfinish = () => t.remove();
      }, { once: true });
    }, 2600);
  }

  /* ── Modal ───────────────────────────────────────────────────────────── */
  function modalRoot() { return document.getElementById("modalRoot"); }
  function openModal(title, bodyHTML, footHTML) {
    const root = modalRoot();
    root.hidden = false;
    root.classList.remove("closing"); // cancel a still-animating close
    root.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <h3>${esc(title)}</h3>
          <button class="icon-btn" data-close aria-label="Close"><span class="ic">${icon("close")}</span></button>
        </div>
        <div class="modal-body">${bodyHTML}</div>
        ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ""}
      </div>`;
    root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
    root.addEventListener("mousedown", onBackdrop);
    document.addEventListener("keydown", onEsc);
    const first = root.querySelector("input, select, textarea, button:not([data-close])");
    if (first) first.focus();
  }
  function onBackdrop(e) { if (e.target === modalRoot()) closeModal(); }
  function onEsc(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() {
    const root = modalRoot();
    root.removeEventListener("mousedown", onBackdrop);
    document.removeEventListener("keydown", onEsc);
    if (root.hidden) return;
    const modal = root.querySelector(".modal");
    if (!modal || reduceMotion()) { root.hidden = true; root.innerHTML = ""; return; }
    // Reverse the entrance: the card drops away while the backdrop lifts.
    root.classList.add("closing");
    modal.addEventListener("animationend", () => {
      if (!root.classList.contains("closing")) return; // a new modal took over
      root.classList.remove("closing");
      root.hidden = true; root.innerHTML = "";
    }, { once: true });
  }
  // Print just the open modal (booking sheet, plan sheet, shopping list).
  // A body flag scopes the @media print rules in global.css, so a plain
  // Ctrl+P with no modal open still prints the whole page normally.
  function printModal() {
    const done = () => document.body.classList.remove("hp-print-modal");
    window.addEventListener("afterprint", done, { once: true });
    document.body.classList.add("hp-print-modal");
    window.print();
    setTimeout(done, 2000); // safety net — some browsers skip afterprint
  }

  function confirmModal(title, message, onYes, danger = true) {
    openModal(title,
      `<p class="modal-text">${esc(message)}</p>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirmYes">Confirm</button>`);
    document.getElementById("confirmYes").addEventListener("click", () => { closeModal(); onYes(); });
  }

  // Form-field error helper shared by the CRUD modals.
  function setErr(form, field, msg) {
    const input = form.querySelector(`[name="${field}"]`);
    const box = form.querySelector(`[data-err="${field}"]`);
    if (input) input.classList.toggle("invalid", !!msg);
    if (box) { box.hidden = !msg; box.textContent = msg; }
    return !msg;
  }

  /* ── Skeleton placeholders (shown while data loads) ─────────────────────── */
  const rep = (n, html) => Array.from({ length: n }, () => html).join("");
  const skel = {
    stats: (n = 4) => rep(n, `<div class="stat sk-stat"><div class="skeleton sk-ic"></div><div class="skeleton sk-num"></div><div class="skeleton sk-line short"></div></div>`),
    cards: (n = 6) => rep(n, `<div class="skeleton sk-card"></div>`),
    rows: (n = 6, cols = 5) => rep(n, `<tr>${`<td><div class="skeleton sk-line"></div></td>`.repeat(cols)}</tr>`),
  };

  /* ── Boot: resolves once the signed-in user is known ─────────────────────
     The access guard (hp-guard.js) bounces unauthorized visitors; here we
     only wait for sign-in, because the Firestore rules require an
     authenticated staff member before anything may be read. The Content
     Moderator's store (js/store.js) re-points HP.ready at its data-ready
     promise, which builds on this one. */
  const ready = new Promise((resolve) => {
    if (ONLINE) {
      let booted = false;
      FB.auth.onAuthStateChanged((authUser) => {
        if (!authUser || booted) return;
        booted = true;
        // Sidebar identity is cosmetic — let it land whenever it lands rather
        // than serializing a Firestore read ahead of the content.
        populateUser(authUser);
        resolve({ user: authUser, online: true });
      });
    } else {
      setUser("Local demo", "Preview mode");
      resolve({ user: null, online: false });
    }
  });

  /* ── Public API ──────────────────────────────────────────────────────── */
  return {
    ONLINE,
    FB,
    ready,
    icon,
    ICONS,
    hydrateIcons,
    skel,
    esc,
    csvCell,
    toast,
    reduceMotion,
    countUp,
    animateOut,
    leaveCurtain,
    openModal,
    closeModal,
    confirmModal,
    printModal,
    setErr,
    applyUser,
    get user() { return user; },
  };
})();
