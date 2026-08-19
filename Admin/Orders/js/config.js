/* HapagPamana · Orders — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.ORDER_MANAGER_ROLES,
  verifiedKey: "hp_orders_verified",
  defaultRoleLabel: "Marketing Admin",
  // Forecast nav icon — a rising trend line with an arrowhead, not part of
  // the shared icon set (hp-core.js) since only this dashboard uses it.
  icons: {
    trend: ['<path d="M3 17l6-6 4 4 8-8"/><path d="M15 6h6v6"/>'],
  },
  shell: {
    brandSub: "Order Ledger",
    eyebrow: "Order Management",
    nav: [
      { key: "orders", href: "index.html", icon: "ledger", label: "Orders", badge: true },
      { key: "calendar", href: "calendar.html", icon: "calendar", label: "Calendar" },
      { key: "forecast", href: "forecast.html", icon: "trend", label: "Forecast" },
    ],
    // The page wires the handler itself (HP.shell.onExport) once its data is up.
    export: { label: "Export as CSV" },
    routeTransitions: true,
  },
};
