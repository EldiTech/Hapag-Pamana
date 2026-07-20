/* HapagPamana · Master Chef — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.MASTER_CHEF_ROLES,
  verifiedKey: "hp_chef_verified",
  defaultRoleLabel: "Master Chef",
  shell: {
    brandSub: "Kitchen Ledger",
    eyebrow: "The Kitchen",
    nav: [
      { key: "prep",    href: "index.html",   icon: "hat",  label: "Prep Board", badge: true },
      { key: "recipes", href: "recipes.html", icon: "book", label: "Recipe Book" },
    ],
    // Each kitchen page exports something different; the pages wire the
    // handler themselves (HP.shell.onExport).
    export: { label: () => (/recipes\.html$/i.test(location.pathname) ? "Recipes CSV" : "Shopping list CSV") },
  },
};
