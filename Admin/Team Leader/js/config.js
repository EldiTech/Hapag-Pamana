/* HapagPamana · Team Leader — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.TEAM_LEADER_ROLES,
  verifiedKey: "hp_tl_verified",
  defaultRoleLabel: "Team Leader",

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
