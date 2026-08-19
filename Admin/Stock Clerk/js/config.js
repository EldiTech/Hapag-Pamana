/* HapagPamana · Stock Clerk — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.STOCK_CLERK_ROLES,
  verifiedKey: "hp_stock_verified",
  defaultRoleLabel: "Stock Clerk",

  icons: {
    // Stacked crates — goods received into the store.
    crates: [
      '<rect x="3.2" y="12.8" width="7.4" height="7.4" rx="1.2"/><rect x="13.4" y="12.8" width="7.4" height="7.4" rx="1.2"/>',
      '<rect x="8.3" y="4.4" width="7.4" height="7.4" rx="1.2"/>',
    ],
    // Balance scales — the spend weighed against the slip.
    scales: [
      '<path d="M12 5.4v13.2"/><path d="M8.6 18.6h6.8"/><path d="M4.6 8.2h14.8"/><path d="M4.6 8.2 2.2 13.3a3.1 3.1 0 0 0 4.8 0L4.6 8.2Z"/><path d="M19.4 8.2 17 13.3a3.1 3.1 0 0 0 4.8 0L19.4 8.2Z"/>',
      '<circle cx="12" cy="4.1" r="1.3"/>',
    ],
    // A voucher with a torn foot — the receipt.
    slip: ['<path d="M5.6 3.2h12.8v17.6l-3.2-2.1-3.2 2.1-3.2-2.1-3.2 2.1V3.2Z"/><path d="M9 8h6M9 11.7h6"/>'],
    // Shelves with jars — the pantry itself.
    shelf: [
      '<path d="M3.4 4.2h17.2M3.4 12h17.2M3.4 19.8h17.2"/>',
      '<rect x="6.2" y="6.6" width="3.6" height="5.4" rx="0.9"/><rect x="13.4" y="7.8" width="4.2" height="4.2" rx="0.9"/><rect x="8.6" y="15" width="4.4" height="4.8" rx="0.9"/>',
    ],
    // A ledger page with a turned corner — the movement history.
    logbook: [
      '<path d="M5 3.4h9.6L19 7.8v12.8H5V3.4Z"/><path d="M14.2 3.4v4.6H19"/>',
      '<path d="M8 12.4h7.2M8 16h5"/>',
    ],
  },

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
