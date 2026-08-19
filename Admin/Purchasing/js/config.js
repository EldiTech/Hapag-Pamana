/* HapagPamana · Purchasing — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.PURCHASING_ROLES,
  verifiedKey: "hp_purchasing_verified",
  defaultRoleLabel: "Purchasing Staff",

  /* Two icons the other dashboards never needed. */
  icons: {
    // A market basket — the run itself.
    cart: [
      '<path d="M3.4 4.2h2.1l2.4 10.4h9.2l2.1-7.4H7"/>',
      '<circle cx="9.6" cy="19" r="1.4"/><circle cx="16.8" cy="19" r="1.4"/>',
    ],
    // A ticked slip — the checklist.
    checklist: [
      '<path d="M6 3.4h12v17.2H6V3.4Z"/><path d="M9.2 8.4l1.5 1.5 3-3.1"/>',
      '<path d="M9.2 14.6l1.5 1.5 3-3.1"/>',
    ],
    // A voucher with a torn foot — the receipt. (Finance draws its own copy of
    // this for the requisition slip; core has no shared one to borrow.)
    slip: ['<path d="M5.6 3.2h12.8v17.6l-3.2-2.1-3.2 2.1-3.2-2.1-3.2 2.1V3.2Z"/><path d="M9 8h6M9 11.7h6"/>'],
  },

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
