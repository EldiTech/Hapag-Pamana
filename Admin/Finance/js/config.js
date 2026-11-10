/* HapagPamana · Finance — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.FINANCE_ROLES,
  verifiedKey: "hp_finance_verified",
  defaultRoleLabel: "Production Manager",

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
