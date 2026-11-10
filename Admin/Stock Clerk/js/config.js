/* HapagPamana · Stock Clerk — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.STOCK_CLERK_ROLES,
  verifiedKey: "hp_stock_verified",
  defaultRoleLabel: "Stock Clerk",

  shell: {
    brandSub: "Store Ledger",
    eyebrow: "Stores",
    nav: [
      { key: "receiving", href: "index.html", icon: "crates", label: "Receiving", badge: true },
      { key: "pantry", href: "pantry.html", icon: "shelf", label: "Pantry" },
      { key: "activity", href: "activity.html", icon: "logbook", label: "Activity" },
      { key: "liquidation", href: "liquidation.html", icon: "scales", label: "Liquidation" },
    ],
    export: {
      label: () => {
        const p = location.pathname;
        if (/liquidation\.html$/i.test(p)) return "Liquidation CSV";
        if (/pantry\.html$/i.test(p)) return "Pantry CSV";
        if (/activity\.html$/i.test(p)) return "Activity CSV";
        return "Receiving CSV";
      },
    },
    routeTransitions: true,
  },
};
