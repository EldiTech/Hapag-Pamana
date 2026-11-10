/* HapagPamana · Layout Designer — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the role
   lists referenced here.

   This desk draws the floor plan a confirmed event is set up to. The plan is
   saved on the booking itself (bookings/{id}.layout), so the crew dressing the
   room reads the same record the designer drew — see js/designer.js. */
window.HP_DASHBOARD = {
  roles: window.LAYOUT_DESIGNER_ROLES,
  verifiedKey: "hp_layout_verified",
  defaultRoleLabel: "Layout Designer",

  shell: {
    brandSub: "Floor Plans",
    eyebrow: "Layout Design",
    nav: [
      { key: "overview", href: "#overview", icon: "ledger", label: "Overview" },
      { key: "designer", href: "#designer", icon: "plan", label: "Layout Designer", badge: true },
    ],
    export: { label: () => "Layout CSV" },
    routeTransitions: true,
  },
};
