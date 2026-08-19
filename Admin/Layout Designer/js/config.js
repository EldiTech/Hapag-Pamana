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

  icons: {
    // A round banquet table seen from above — the plan's commonest piece.
    roundTable: [
      '<circle cx="12" cy="12" r="6.2"/><circle cx="12" cy="12" r="2.4"/>',
      '<circle cx="12" cy="3.6" r="1.3"/><circle cx="12" cy="20.4" r="1.3"/><circle cx="3.6" cy="12" r="1.3"/><circle cx="20.4" cy="12" r="1.3"/>',
    ],
    // A rectangular table with two chairs on the long sides.
    longTable: [
      '<rect x="4.4" y="8.2" width="15.2" height="7.6" rx="1.2"/>',
      '<circle cx="8.6" cy="5.4" r="1.3"/><circle cx="15.4" cy="5.4" r="1.3"/><circle cx="8.6" cy="18.6" r="1.3"/><circle cx="15.4" cy="18.6" r="1.3"/>',
    ],
    // A buffet line — a long counter with chafing dishes standing on it.
    buffet: [
      '<rect x="2.8" y="13.6" width="18.4" height="6.4" rx="1.1"/><path d="M6.4 13.6V11a1.6 1.6 0 0 1 1.6-1.6h2.4A1.6 1.6 0 0 1 12 11v2.6"/><path d="M13.6 13.6V11a1.6 1.6 0 0 1 1.6-1.6h1.6A1.6 1.6 0 0 1 18.4 11v2.6"/><path d="M9.2 7.4V5.6M16 7.4V5.6"/>',
    ],
    // The stage / backdrop — a raised platform with a draped arch behind it.
    stage: [
      '<path d="M3 20h18"/><rect x="5.2" y="15.6" width="13.6" height="4.4" rx="0.8"/><path d="M6.4 15.6V9.2a5.6 5.6 0 0 1 11.2 0v6.4"/>',
      '<path d="M9.6 15.6V9.6M14.4 15.6V9.6" />',
    ],
    // The dance floor — a parquet square.
    dance: [
      '<rect x="4" y="4" width="16" height="16" rx="1.2"/><path d="M12 4v16M4 12h16"/>',
    ],
    // A ruler — the venue's own dimensions.
    ruler: [
      '<rect x="2.6" y="7.4" width="18.8" height="9.2" rx="1.2"/><path d="M6.6 7.4v3M10.2 7.4v4.4M13.8 7.4v3M17.4 7.4v4.4"/>',
    ],
    // A crossed pair of place settings — the headcount the plan seats.
    cover: [
      '<path d="M7.4 3.6v7.2M7.4 3.6v0M5.4 3.6v3.4a2 2 0 0 0 4 0V3.6"/><path d="M7.4 10.8V20.4"/><path d="M16.6 20.4v-6.8h-2.2c0-4.6 1-9.2 2.2-10v16.8Z"/>',
    ],
    // A door standing ajar — where guests come in.
    door: [
      '<path d="M4.4 20.4h15.2"/><path d="M6.6 20.4V4.4l8.4-1.8v19.4l-8.4-1.6Z"/>',
      '<circle cx="12.9" cy="12.4" r=".95" fill="currentColor" stroke="none"/>',
    ],
    // A walking figure — the first-person walkthrough.
    walk: [
      '<circle cx="12.6" cy="4.1" r="1.9"/><path d="M11 21.6l1.5-5.4-2.4-2.6.9-4.6"/><path d="M10 9l3.4-1.4 2.3 3.1 2.9 1"/><path d="m12.5 16.2 3 5.4"/><path d="M10 9 6.6 11.2l-.9 3.2"/>',
    ],
    // A wireframe cube — the room stood up, i.e. the 3D view.
    cube: [
      '<path d="M12 2.6 20.8 7v10L12 21.4 3.2 17V7L12 2.6Z"/><path d="M3.2 7 12 11.4 20.8 7"/><path d="M12 11.4v10"/>',
    ],
    // A folded plan on a board — the saved drawing itself.
    plan: [
      '<path d="M3.6 6.2 9 4l6 2.2 5.4-2.2v13.8L15 20l-6-2.2-5.4 2.2V6.2Z"/><path d="M9 4v13.8M15 6.2V20"/>',
    ],
    // Four corner brackets pulling outward — expand to fullscreen.
    expand: [
      '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
    ],
    // Four corner brackets pulling inward — leave fullscreen.
    contract: [
      '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>',
    ],
    // Redo icon
    redo: [
      '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    ],
  },

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
