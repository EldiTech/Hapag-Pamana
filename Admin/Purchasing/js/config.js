/* HapagPamana · Purchasing — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.PURCHASING_ROLES,
  verifiedKey: "hp_purchasing_verified",
  defaultRoleLabel: "Purchasing Staff",

  shell: {
    brandSub: "Market Ledger",
    eyebrow: "Purchasing",
    nav: [
      { key: "runs", href: "index.html", icon: "cart", label: "Purchase Runs", badge: true },
      { key: "receipts", href: "receipts.html", icon: "slip", label: "Receipts" },
    ],
    // Each page exports its own ledger; the pages wire the handler themselves
    // (HP.shell.onExport) once their data is up.
    export: { label: () => (/receipts\.html$/i.test(location.pathname) ? "Receipts CSV" : "Checklist CSV") },
    routeTransitions: true,
  },
};
