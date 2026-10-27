/* HapagPamana · Finance — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.FINANCE_ROLES,
  verifiedKey: "hp_finance_verified",
  defaultRoleLabel: "Production Manager",

  /* Two icons the other dashboards never needed. */
  icons: {
    // Balance scales — the kitchen's list weighed against the money.
    scales: [
      '<path d="M12 5.4v13.2"/><path d="M8.6 18.6h6.8"/><path d="M4.6 8.2h14.8"/><path d="M4.6 8.2 2.2 13.3a3.1 3.1 0 0 0 4.8 0L4.6 8.2Z"/><path d="M19.4 8.2 17 13.3a3.1 3.1 0 0 0 4.8 0L19.4 8.2Z"/>',
      '<circle cx="12" cy="4.1" r="1.3"/>',
    ],
    // A voucher with a torn foot — the requisition slip.
    slip: ['<path d="M5.6 3.2h12.8v17.6l-3.2-2.1-3.2 2.1-3.2-2.1-3.2 2.1V3.2Z"/><path d="M9 8h6M9 11.7h6"/>'],
    // A coin purse with a clasp — the ingredient float.
    purse: ['<path d="M4.2 9.4h15.6l1.1 9.2a1.6 1.6 0 0 1-1.6 1.8H4.7a1.6 1.6 0 0 1-1.6-1.8l1.1-9.2Z"/><path d="M8.2 9.4V6.9a3.8 3.8 0 0 1 7.6 0v2.5"/>'],
    // An open tray with paper landing in it — the runs the stores filed here.
    inbox: [
      '<path d="M3.4 13.6h4.2l1.5 2.6h5.8l1.5-2.6h4.2"/><path d="M5.6 4.6h12.8l2.2 9v5.8H3.4v-5.8l2.2-9Z"/>',
      '<path d="M12 4.2v5.6m0 0 2.2-2.2M12 9.8 9.8 7.6"/>',
    ],
  },

  shell: {
    brandSub: "Costing Ledger",
    eyebrow: "Finance",
    nav: [
      { key: "costing", href: "index.html", icon: "scales", label: "Costing Board", badge: true },
      { key: "slips", href: "requisitions.html", icon: "slip", label: "Requisitions" },
      { key: "received", href: "received.html", icon: "inbox", label: "Received" },
      { key: "cash", href: "cash.html", icon: "purse", label: "Petty Cash" },
    ],
    // Each page exports its own ledger; the pages wire the handler themselves
    // (HP.shell.onExport) once their data is up.
    export: {
      label: () => {
        const p = location.pathname;
        if (/requisitions\.html$/i.test(p)) return "Requisitions CSV";
        if (/received\.html$/i.test(p)) return "Received CSV";
        return "Costings CSV";
      },
    },
    routeTransitions: true,
  },
};
