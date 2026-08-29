/* HapagPamana · Content Moderator — dashboard configuration.
   Feeds the shared portal layer (../../assets/hp-guard.js, hp-core.js,
   hp-shell.js). Loads right after firebase-config.js, which defines the
   role lists referenced here. */
window.HP_DASHBOARD = {
  roles: window.MODERATOR_ROLES,
  verifiedKey: "hp_admin_verified",
  icons: {
    megaphone: [
      '<path d="M3 11l18-5v12L3 13v-2z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    ],
  },
  shell: {
    brandSub: "Heirloom Kitchen Ledger",
    eyebrow: "Content Moderation",
    nav: [
      { key: "overview",      href: "index.html",         icon: "grid",      label: "Overview" },
      { key: "announcements", href: "announcements.html", icon: "megaphone", label: "Announcements" },
      { key: "products",      href: "products.html",      icon: "dish",      label: "Products" },
      { key: "categories",    href: "categories.html",    icon: "tag",       label: "Categories" },
      { key: "packages",      href: "packages.html",      icon: "box",       label: "Packages" },
      { key: "setups",        href: "setups.html",        icon: "photo",     label: "Setups" },
      { key: "about",         href: "about.html",         icon: "book",      label: "About" },
      { key: "users",         href: "users.html",         icon: "users",     label: "Users" },
      { key: "allergens",     href: "allergens.html",     icon: "leaf",      label: "Allergens" },
      { key: "settings",      href: "settings.html",      icon: "gear",      label: "Settings" },
    ],
    // exportData lives on the content store (js/store.js) — resolve lazily.
    export: { label: "Export as JSON", fn: () => window.HP.exportData() },
    routeTransitions: true,
  },
};
