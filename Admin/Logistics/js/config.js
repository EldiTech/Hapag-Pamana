/* HapagPamana · Logistics — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.LOGISTICS_ROLES,
  verifiedKey: "hp_log_verified",
  defaultRoleLabel: "Logistics",

  icons: {
    // A delivery truck — the release this desk drives.
    truck: [
      '<path d="M2.8 6.4h10.4v9.2H2.8V6.4Z"/><path d="M13.2 9.6h3.9l3.1 3v3h-7V9.6Z"/>',
      '<circle cx="6.6" cy="18" r="1.9"/><circle cx="16.6" cy="18" r="1.9"/>',
    ],
    // A covered cloche — the food the kitchen hands over.
    cloche: [
      '<path d="M3.2 18.4h17.6"/><path d="M4.8 15.6a7.2 7.2 0 0 1 14.4 0"/>',
      '<circle cx="12" cy="7.2" r="1.2"/>',
    ],
    // A signpost — where an order stands on the rail.
    milestone: ['<path d="M6.4 3.4v17.2"/><path d="M6.4 5.2h11.2l-2.2 3 2.2 3H6.4"/>'],
    // A stacked crate — the equipment pickup queue (Catering Equipment's
    // own icon, mirrored here for the same lane on this page).
    crate: [
      '<path d="M3.2 8.6h17.6v11.2H3.2V8.6Z"/><path d="M3.2 8.6 6.4 3.8h11.2l3.2 4.8"/>',
      '<path d="M3.2 13h17.6M10 8.6v11.2M14 8.6v11.2"/>',
    ],
  },

  shell: {
    brandSub: "Dispatch Desk",
    eyebrow: "Logistics",
    nav: [
      { key: "dispatch", href: "index.html", icon: "truck", label: "Dispatch", badge: true },
    ],
    export: { label: () => "Dispatch CSV" },
    routeTransitions: true,
  },
};
