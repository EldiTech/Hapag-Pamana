/* HapagPamana · Owner — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here.

   The owner oversees every desk: Overview is a hub that links out to each
   of the nine staff dashboards (their own guard re-verifies `owner`
   against that dashboard's roles list on arrival, the same way `admin`
   already crosses between dashboards today). Staff Accounts is the one page
   that stays local — it mints and manages the users/{uid} records those
   dashboards gate on. */
window.HP_DASHBOARD = {
  roles: window.OWNER_ROLES,
  verifiedKey: "hp_owner_verified",
  defaultRoleLabel: "Owner",
  shell: {
    brandSub: "Owner's Ledger",
    eyebrow: "Overview",
    nav: [
      { key: "overview", href: "index.html", icon: "grid", label: "Overview" },
      { key: "staff", href: "staff.html", icon: "users", label: "Staff Accounts" },
      { key: "moderator", href: "../../Content%20Moderator/html/index.html", icon: "dish", label: "Content Moderator" },
      { key: "orders", href: "../../Orders/html/index.html", icon: "ledger", label: "Orders" },
      { key: "chef", href: "../../Master%20Chef/html/index.html", icon: "hat", label: "Master Chef" },
      { key: "finance", href: "../../Finance/html/index.html", icon: "peso", label: "Finance" },
      { key: "purchasing", href: "../../Purchasing/html/index.html", icon: "box", label: "Purchasing" },
      { key: "stock", href: "../../Stock%20Clerk/html/index.html", icon: "box", label: "Stock Clerk" },
      { key: "team", href: "../../Team%20Leader/html/index.html", icon: "hat", label: "Team Leader" },
      { key: "logistics", href: "../../Logistics/html/index.html", icon: "box", label: "Logistics" },
      { key: "equipment", href: "../../Catering%20Equipment/html/index.html", icon: "box", label: "Catering Equipment" },
      { key: "layout", href: "../../Layout%20Designer/html/index.html", icon: "grid", label: "Layout Designer" },
    ],
    routeTransitions: true,
  },
};
