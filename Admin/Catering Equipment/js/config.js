/* HapagPamana · Catering Equipment — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.CATERING_EQUIPMENT_ROLES,
  verifiedKey: "hp_ceq_verified",
  defaultRoleLabel: "Catering Equipment",

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
