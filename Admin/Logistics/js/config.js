/* HapagPamana · Logistics — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.LOGISTICS_ROLES,
  verifiedKey: "hp_log_verified",
  defaultRoleLabel: "Logistics",

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
