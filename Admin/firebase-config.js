/* HapagPamana · Firebase Web config (shared by the login + Content Moderator).
   Values from Firebase console → Project settings → Your apps → Web. */
window.firebaseConfig = {
  apiKey: "AIzaSyDokGGoVNFZIJujMFC52yzkOTnG_sxeT4E",
  authDomain: "hapagpamana-39687.firebaseapp.com",
  projectId: "hapagpamana-39687",
  storageBucket: "hapagpamana-39687.firebasestorage.app",
  messagingSenderId: "369246306524",
  appId: "1:369246306524:web:f3a4b31aa39e8370b97419",
  measurementId: "G-S4PRHFNPWH",
};

/* ── Firestore transport ──────────────────────────────────────────────────
   Firestore normally streams over WebChannel. Some networks, proxies and
   browser shields break that long-lived connection: the 'Listen' channel
   404s and the SDK reports "client is offline" even though plain reads work.
   Long polling is the supported fallback for exactly that case.

   Force is used rather than auto-detect: detection has to attempt a
   WebChannel handshake and recognise the failure first, and a 404 (rather
   than a clean timeout) is a failure shape it can misread — so it never
   switches. The two flags are mutually exclusive; passing both throws.

   This runs here — after the SDK, before every other script — because
   settings() must be called before anything reads or writes. firebase.
   firestore() hands back one shared instance, so doing it once covers the
   login and all four dashboards. */
(function () {
  if (typeof firebase === "undefined" || !firebase.firestore) return;
  if (String(window.firebaseConfig.apiKey || "").startsWith("PASTE")) return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    firebase.firestore().settings({ experimentalForceLongPolling: true });
  } catch (e) {
    // Never let a transport tweak stop the portal from loading.
    console.warn("HapagPamana: couldn't set Firestore transport —", e);
  }
})();

/* Firestore collection holding role records, keyed by the user's auth UID:
   users/{uid} = { email, role, name, active }                              */
window.USERS_COLLECTION = "users";

/* Role-based access — four staff roles, each with its own dashboard:
     content_moderator  → Content Moderator (menu content, users, settings)
     marketing_admin    → Orders (every booking filed from the app)
     master_chef        → Master Chef (ingredient plans for confirmed orders)
     production_manager → Finance (costs the kitchen's plans, releases the
                          requisition slips the market run is bought against)
   `admin` may enter all of them; the login lands them on the Content
   Moderator. `owner` may also enter all of them, and lands on the Owner hub
   (Owner/html/index.html), which links out to every dashboard below.

   The superseded strings (order_manager → marketing_admin, finance →
   production_manager) are still accepted so staff whose users/{uid} record
   has not been migrated yet keep their access. Drop them from these lists
   once every record carries the new role. */
window.MODERATOR_ROLES = ["content_moderator", "admin", "owner"];
window.ORDER_MANAGER_ROLES = ["marketing_admin", "order_manager", "admin", "owner"];
window.MASTER_CHEF_ROLES = ["master_chef", "admin", "owner"];
window.FINANCE_ROLES = ["production_manager", "finance", "admin", "owner"];

/* Procurement desks — they pick the released requisition up from Finance and
   walk it to the shelf. The stages themselves live in assets/hp-procurement.js. */
window.PURCHASING_ROLES = ["purchasing_staff", "admin", "owner"];
window.STOCK_CLERK_ROLES = ["stock_clerk", "admin", "owner"];

/* Service floor — the food's journey from the kitchen to the event. The team
   leader cooks and packs, then asks logistics to release it; logistics
   releases and confirms delivery. The stages live in assets/hp-fulfilment.js. */
window.TEAM_LEADER_ROLES = ["team_leader", "admin", "owner"];
window.LOGISTICS_ROLES = ["logistics", "admin", "owner"];

/* Catering Equipment — preps the gear a confirmed event needs: tables,
   chafing dishes, linens and the like. Reads the same confirmed bookings
   Team Leader and Logistics do, independently of their cook/dispatch rail,
   and keeps its own inventory (equipmentCategories/equipmentItems/
   equipmentLog) so a checklist can be built per event. */
window.CATERING_EQUIPMENT_ROLES = ["catering_equipment", "admin", "owner"];

/* The layout designer draws the floor plan a confirmed event is set up to:
   tables, buffet lines, the stage, the dance floor — where each piece stands
   in the venue, and how many guests it seats. The plan lives on the booking
   (bookings/{id}.layout), so the crew setting the room up reads the same
   record the desk drew. */
window.LAYOUT_DESIGNER_ROLES = ["layout_designer", "admin", "owner"];

/* The owner oversees every desk above — same universal reach as `admin`,
   but lands on its own hub dashboard instead of the Content Moderator. */
window.OWNER_ROLES = ["owner"];

/* Where the login sends each role after sign-in (relative to Admin/). */
window.ROLE_HOMES = {
  content_moderator: "Content%20Moderator/html/index.html",
  marketing_admin: "Orders/html/index.html",
  order_manager: "Orders/html/index.html", // superseded
  master_chef: "Master%20Chef/html/index.html",
  production_manager: "Finance/html/index.html",
  finance: "Finance/html/index.html", // superseded
  purchasing_staff: "Purchasing/html/index.html",
  stock_clerk: "Stock%20Clerk/html/index.html",
  team_leader: "Team%20Leader/html/index.html",
  logistics: "Logistics/html/index.html",
  layout_designer: "Layout%20Designer/html/index.html",
  catering_equipment: "Catering%20Equipment/html/index.html",
  admin: "Content%20Moderator/html/index.html",
  owner: "Owner/html/index.html",
};
