/* HapagPamana · Orders — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.ORDER_MANAGER_ROLES,
  verifiedKey: "hp_orders_verified",
  defaultRoleLabel: "Order Manager",
  shell: {
    brandSub: "Order Ledger",
    eyebrow: "Order Management",
    nav: [
      { key: "orders", href: "index.html", icon: "ledger", label: "Orders", badge: true },
    ],
    // The page wires the handler itself (HP.shell.onExport) once its data is up.
    export: { label: "Export as CSV" },
  },
};
