/* HapagPamana · Catering Equipment — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.CATERING_EQUIPMENT_ROLES,
  verifiedKey: "hp_ceq_verified",
  defaultRoleLabel: "Catering Equipment",

  icons: {
    // A stacked crate — equipment staged for an event.
    crate: [
      '<path d="M3.2 8.6h17.6v11.2H3.2V8.6Z"/><path d="M3.2 8.6 6.4 3.8h11.2l3.2 4.8"/>',
      '<path d="M3.2 13h17.6M10 8.6v11.2M14 8.6v11.2"/>',
    ],
    // A clipboard with a check — the prep checklist.
    checklist: [
      '<rect x="4.4" y="3.6" width="15.2" height="17.6" rx="1.6"/><path d="M9 3.2h6a1 1 0 0 1 1 1v1.6H8V4.2a1 1 0 0 1 1-1Z"/>',
      '<path d="m7.6 12 1.8 1.8L13 10.2M7.6 16.6h6.4"/>',
    ],
    // Shelves — the equipment inventory.
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
    brandSub: "Equipment Desk",
    eyebrow: "Catering Equipment",
    nav: [
      { key: "prep", href: "index.html", icon: "checklist", label: "Event Prep", badge: true },
      { key: "inventory", href: "inventory.html", icon: "shelf", label: "Inventory" },
    ],
    export: {
      label: () => (/inventory\.html$/i.test(location.pathname) ? "Inventory CSV" : "Event Prep CSV"),
    },
    routeTransitions: true,
  },
};
