/* HapagPamana · Team Leader — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.TEAM_LEADER_ROLES,
  verifiedKey: "hp_tl_verified",
  defaultRoleLabel: "Team Leader",

  icons: {
    // A covered cloche — the food being prepared.
    cloche: [
      '<path d="M3.2 18.4h17.6"/><path d="M4.8 15.6a7.2 7.2 0 0 1 14.4 0"/>',
      '<circle cx="12" cy="7.2" r="1.2"/>',
    ],
    // A delivery truck — the release logistics drives.
    truck: [
      '<path d="M2.8 6.4h10.4v9.2H2.8V6.4Z"/><path d="M13.2 9.6h3.9l3.1 3v3h-7V9.6Z"/>',
      '<circle cx="6.6" cy="18" r="1.9"/><circle cx="16.6" cy="18" r="1.9"/>',
    ],
    // A signpost — where an order stands on the rail.
    milestone: [
      '<path d="M6.4 3.4v17.2"/><path d="M6.4 5.2h11.2l-2.2 3 2.2 3H6.4"/>',
    ],
  },

  shell: {
    brandSub: "Service Floor",
    eyebrow: "Operations",
    nav: [
      { key: "board", href: "index.html", icon: "cloche", label: "Order Board", badge: true },
    ],
    export: { label: () => "Order Board CSV" },
    routeTransitions: true,
  },
};
