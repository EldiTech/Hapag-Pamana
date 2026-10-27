/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — LAYOUT RULES.

   The numbers this desk judges a plan by, in ONE place.

   Before this file the trade's clearances lived in js/walkability.js, the
   piece catalogue lived in js/designer.js, and the heights the collision uses
   lived in js/nav.js — three files that all had to agree about what a buffet
   is and none of which said so out loud. A house that works to 1.4 m service
   aisles rather than 1.2 m had to be told three times.

   Everything below is DATA. No module here reads the scene, touches the DOM
   or holds state; it is read by:

     js/nav.js          heights and what is walk-through-able
     js/walkability.js  the clearances every warning is phrased against
     js/optimise.js     the constraints a recommendation is derived from
     js/scene3d.js      which builder dresses which kind
     js/designer.js     the palette, and the properties a kind may carry
     js/simulate.js     lighting presets, event types, what is inspectable

   ── On changing these ───────────────────────────────────────────────────
   The clearances are the trade's, not arbitrary: 1.2 m is a server with a
   tray passing between two seated backs, 0.9 m is one guest edging through,
   1.5 m is a route the whole room uses. Lowering one does not make a tight
   plan workable — it makes the warning stop.

   Public API (window.HPRules): plain frozen objects, documented below.
   ════════════════════════════════════════════════════════════════ */
window.HPRules = (function () {
  "use strict";

  /* ── Clearances, metres ───────────────────────────────────────────────
     Every distance the analysis measures against. Edge to edge, always —
     a clearance is the gap between two things, never a centre distance. */
  const CLEAR = {
    service: 1.2,       // a server with a tray between two seated backs
    guest: 0.9,         // one guest edging between two pieces
    main: 1.5,          // the main circulation route through the room
    chairPull: 0.75,    // floor a chair needs when pulled out from a table
    doorSwing: 1.2,     // clear floor immediately inside a doorway
    emergency: 1.5,     // clear floor at a fire exit — never negotiable
    wall: 0.6,          // a piece hard against a wall traps whoever sits there
    stageFront: 2.0,    // the approach to a stage, for the party going up
    buffetQueue: 1.4,   // standing room along a serving line
    barQueue: 1.2,      // standing room at a bar
    danceEdge: 1.0,     // floor around a dance floor, so it isn't boxed in
  };

  /* Capacity planning, m² per guest. The area a room needs BEFORE furniture
     — the number a venue quotes when asked "will 120 fit". */
  const AREA = {
    seatedRound: 1.5,   // banquet rounds with service aisles
    seatedLong: 1.3,    // long tables, tighter
    cocktail: 0.9,      // standing reception
    theatre: 0.8,       // rows of chairs, no tables
    absoluteMin: 0.65,  // below this the room is a crush at any layout
  };

  /* ── The catalogue ────────────────────────────────────────────────────
     Every kind of thing that can stand on a floor plan. One entry defines
     it everywhere: its default size, what it seats, how tall it stands for
     collision, whether it is walked around or through, which 3D builder
     dresses it, and which icon the palette shows.

     `group` sorts the palette drawer. `top` is the collision height in
     metres — anything at or under nav's STEP (0.45) is stepped over rather
     than walked around, which is how a stage deck and a dance floor differ
     from a table.

     `analysis` names the roles the spatial engine cares about:
       seating   — carries covers, wants service clearance
       service   — staff work at it, wants queuing room (buffet, bar)
       feature   — the room is arranged around it (stage, dance floor)
       access    — a way in or out (door, emergency exit)
       fixture   — everything else standing on the floor

     Legacy note: the first ten kinds are the ones plans in the wild already
     carry. Their `kind` strings must never change — a stored plan names its
     pieces by them. */
  const PIECES = [
    /* ── Tables ─────────────────────────────────────────────────────── */
    { kind: "round", group: "Tables", label: "Round Table", icon: "roundTable",
      shape: "round", w: 1.5, h: 1.5, seats: 8, top: 1.1, build: "round",
      analysis: "seating", legacy: true,
      seatRule: { perimeter: true, pitch: 0.62 } },

    { kind: "rect", group: "Tables", label: "Long Table", icon: "longTable",
      shape: "rect", w: 1.8, h: 0.75, seats: 6, top: 1.1, build: "rect",
      analysis: "seating", legacy: true,
      seatRule: { sides: true, pitch: 0.62 } },

    { kind: "square", group: "Tables", label: "Square Table", icon: "longTable",
      shape: "rect", w: 1.2, h: 1.2, seats: 4, top: 1.1, build: "rect",
      analysis: "seating", seatRule: { sides: true, pitch: 0.62 } },

    { kind: "cocktail", group: "Tables", label: "Cocktail Table", icon: "cup",
      shape: "round", w: 0.7, h: 0.7, seats: 0, top: 1.1, build: "cocktail",
      analysis: "seating", standing: 4 },

    { kind: "head", group: "Tables", label: "Head Table", icon: "longTable",
      shape: "rect", w: 3.6, h: 0.9, seats: 8, top: 1.1, build: "rect",
      analysis: "seating", seatRule: { oneSide: true, pitch: 0.68 } },

    { kind: "registration", group: "Tables", label: "Registration", icon: "longTable",
      shape: "rect", w: 1.8, h: 0.7, seats: 2, top: 1.0, build: "service",
      analysis: "service" },

    { kind: "gift", group: "Tables", label: "Gift Table", icon: "longTable",
      shape: "rect", w: 1.5, h: 0.7, seats: 0, top: 1.0, build: "service",
      analysis: "fixture" },

    /* ── Catering ───────────────────────────────────────────────────── */
    { kind: "buffet", group: "Catering", label: "Buffet", icon: "buffet",
      shape: "rect", w: 4.0, h: 0.8, seats: 0, top: 1.1, build: "buffet",
      analysis: "service", servesPerMetre: 15 },

    { kind: "dessert", group: "Catering", label: "Dessert Table", icon: "buffet",
      shape: "rect", w: 2.0, h: 0.8, seats: 0, top: 1.1, build: "dessert",
      analysis: "service", servesPerMetre: 20 },

    { kind: "bar", group: "Catering", label: "Bar", icon: "cup",
      shape: "rect", w: 2.4, h: 0.8, seats: 0, top: 1.15, build: "bar",
      analysis: "service", legacy: true, servesPerMetre: 12 },

    { kind: "beverage", group: "Catering", label: "Beverage Station", icon: "cup",
      shape: "rect", w: 1.6, h: 0.7, seats: 0, top: 1.15, build: "beverage",
      analysis: "service", servesPerMetre: 18 },

    { kind: "coffee", group: "Catering", label: "Coffee Station", icon: "cup",
      shape: "rect", w: 1.2, h: 0.7, seats: 0, top: 1.15, build: "beverage",
      analysis: "service", servesPerMetre: 14 },

    { kind: "service", group: "Catering", label: "Service Table", icon: "buffet",
      shape: "rect", w: 1.5, h: 0.7, seats: 0, top: 0.95, build: "service",
      analysis: "service", staffOnly: true },

    { kind: "trash", group: "Catering", label: "Waste Station", icon: "box",
      shape: "rect", w: 0.8, h: 0.6, seats: 0, top: 0.95, build: "trash",
      analysis: "fixture" },

    /* ── Event ──────────────────────────────────────────────────────── */
    { kind: "stage", group: "Event", label: "Stage", icon: "stage",
      shape: "rect", w: 6.0, h: 3.0, seats: 0, top: 0.4, build: "stage",
      analysis: "feature", legacy: true },

    { kind: "dance", group: "Event", label: "Dance Floor", icon: "dance",
      shape: "rect", w: 5.0, h: 5.0, seats: 0, top: 0.05, build: "dance",
      analysis: "feature", legacy: true, passable: true },

    { kind: "dj", group: "Event", label: "DJ Booth", icon: "stage",
      shape: "rect", w: 1.8, h: 0.9, seats: 0, top: 1.2, build: "dj",
      analysis: "feature" },

    { kind: "speaker", group: "Event", label: "Speaker", icon: "stage",
      shape: "rect", w: 0.5, h: 0.5, seats: 0, top: 1.8, build: "speaker",
      analysis: "fixture" },

    { kind: "screen", group: "Event", label: "LED Screen", icon: "stage",
      shape: "rect", w: 3.0, h: 0.3, seats: 0, top: 2.6, build: "screen",
      analysis: "feature" },

    { kind: "photo", group: "Event", label: "Photo Booth", icon: "stage",
      shape: "rect", w: 2.0, h: 1.4, seats: 0, top: 2.2, build: "photo",
      analysis: "feature" },

    { kind: "decor", group: "Event", label: "Decor", icon: "leaf",
      shape: "round", w: 0.8, h: 0.8, seats: 0, top: 1.4, build: "decor",
      analysis: "fixture", legacy: true },

    /* ── Access ─────────────────────────────────────────────────────── */
    { kind: "door", group: "Access", label: "Doorway", icon: "door",
      shape: "rect", w: 0.9, h: 0.25, seats: 0, top: 0, build: "door",
      analysis: "access", legacy: true, passable: true, noSeats: true },

    { kind: "exit", group: "Access", label: "Emergency Exit", icon: "door",
      shape: "rect", w: 1.2, h: 0.25, seats: 0, top: 0, build: "exit",
      analysis: "access", passable: true, noSeats: true, emergency: true },

    { kind: "kitchen", group: "Access", label: "Service Entrance", icon: "door",
      shape: "rect", w: 1.2, h: 0.25, seats: 0, top: 0, build: "door",
      analysis: "access", passable: true, noSeats: true, staffOnly: true },

    { kind: "spawn", group: "Access", label: "Start Point", icon: "pin",
      shape: "round", w: 0.6, h: 0.6, seats: 0, top: 0, build: null,
      analysis: "access", legacy: true, passable: true, noSeats: true, unique: true },

    { kind: "other", group: "Access", label: "Other", icon: "box",
      shape: "rect", w: 1.2, h: 1.2, seats: 0, top: 0.9, build: "other",
      analysis: "fixture", legacy: true },
  ];

  const BY_KIND = Object.create(null);
  PIECES.forEach((p) => { BY_KIND[p.kind] = p; });

  /* A kind that isn't in the catalogue falls back to "other" rather than
     throwing — a plan hand-edited in the console, or written by a newer
     build of this desk, must still open. */
  const pieceOf = (kind) => BY_KIND[String(kind)] || BY_KIND.other;
  const isPassable = (kind) => !!pieceOf(kind).passable;
  const heightOf = (kind) => {
    const p = pieceOf(kind);
    return typeof p.top === "number" ? p.top : 0.9;
  };
  const roleOf = (kind) => pieceOf(kind).analysis || "fixture";
  const kindsWithRole = (role) => PIECES.filter((p) => p.analysis === role).map((p) => p.kind);

  const GROUPS = ["Tables", "Catering", "Event", "Access"];

  /* ── Chairs ───────────────────────────────────────────────────────────
     A chair type is a look and a footprint, chosen per table. The footprint
     is what the analysis uses for chair-pull clearance; the look is what
     js/scene3d.js builds. */
  const CHAIRS = {
    banquet:   { label: "Banquet",   w: 0.45, d: 0.45, back: 0.50, style: "pad" },
    chiavari:  { label: "Chiavari",  w: 0.41, d: 0.41, back: 0.55, style: "slat" },
    modern:    { label: "Modern",    w: 0.46, d: 0.46, back: 0.44, style: "shell" },
    stool:     { label: "Bar Stool", w: 0.36, d: 0.36, back: 0.18, style: "stool" },
    executive: { label: "Executive", w: 0.52, d: 0.52, back: 0.58, style: "exec" },
  };
  const CHAIR_NAMES = Object.keys(CHAIRS);
  const DEFAULT_CHAIR = "banquet";
  const chairOf = (name) => CHAIRS[String(name)] || CHAIRS[DEFAULT_CHAIR];

  /* ── Seating capacity ─────────────────────────────────────────────────
     What a table of a given size CAN seat, from its own geometry — so the
     desk can tell a designer that a 1.5 m round comfortably takes eight and
     a 1.8 m round takes ten, instead of accepting whatever was typed.

     Round: the circumference divided by the pitch one guest occupies.
     Rect:  the two long sides, less the corners nobody sits at.
     Head:  one side only, because the party faces the room. */
  function capacityOf(item) {
    const def = pieceOf(item && item.kind);
    const rule = def.seatRule;
    if (!rule) return 0;
    const w = Math.max(0.2, Number(item.w) || def.w);
    const h = Math.max(0.2, Number(item.h) || def.h);
    const pitch = rule.pitch || 0.62;
    /* Floored with a millimetre of slack.

       A table sized to take exactly N guests lands on a division that binary
       floating point rounds a hair BELOW the integer — 3.4 / 0.68 comes out
       4.999999999999999 — and a bare floor() then reports N−1. A 3.6 m head
       table would be described as seating four when it seats five, which is
       the kind of quiet arithmetic error that ends with a chair missing on
       the night. The slack is far smaller than any real tolerance. */
    const fit = (span) => Math.floor(span / pitch + 1e-6);
    if (rule.perimeter) return Math.max(2, fit(Math.PI * w));
    const perSide = Math.max(1, fit(w - 0.2));
    if (rule.oneSide) return perSide;
    // Long sides plus one at each end when the table is deep enough to sit at.
    const ends = h >= 0.8 ? Math.max(0, fit(h - 0.2)) * 2 : 0;
    return perSide * 2 + ends;
  }

  /* ── Event types ──────────────────────────────────────────────────────
     What a kind of function wants from a room. These INFORM the analysis
     and the optimiser — they never force a layout. A designer who wants a
     dance floor at a conference gets one; the report simply stops asking
     for the ones this type doesn't need.

     `wants`   — pieces the type expects, flagged when missing (advisory).
     `area`    — m² per guest for the capacity check.
     `lighting`— which preset the walkthrough opens with.
     `spine`   — the main-route clearance this type works to. */
  const EVENT_TYPES = {
    wedding: {
      label: "Wedding", area: AREA.seatedRound, lighting: "WEDDING", spine: 1.6,
      wants: ["stage", "dance", "buffet", "head", "door"],
      note: "A head table facing the room, a dance floor central, buffet clear of both.",
    },
    birthday: {
      label: "Birthday", area: AREA.seatedRound, lighting: "PARTY", spine: 1.5,
      wants: ["dance", "buffet", "dessert", "door"],
      note: "Dessert table on show, dance floor near the music.",
    },
    corporate: {
      label: "Corporate Event", area: AREA.seatedLong, lighting: "CORPORATE", spine: 1.6,
      wants: ["stage", "screen", "registration", "coffee", "door"],
      note: "Sightlines to the screen matter more than the dance floor.",
    },
    conference: {
      label: "Conference", area: AREA.theatre, lighting: "CORPORATE", spine: 1.8,
      wants: ["stage", "screen", "registration", "coffee", "exit"],
      note: "Rows, wide aisles, and a registration desk that doesn't block the door.",
    },
    graduation: {
      label: "Graduation", area: AREA.seatedRound, lighting: "DAYLIGHT", spine: 1.8,
      wants: ["stage", "screen", "door", "exit"],
      note: "A broad approach to the stage — the whole room walks up it.",
    },
    buffetCatering: {
      label: "Buffet Catering", area: AREA.seatedRound, lighting: "DAYLIGHT", spine: 1.6,
      wants: ["buffet", "beverage", "service", "trash", "door"],
      note: "Two serving lines beat one long one; keep the staff route off the guest route.",
    },
    party: {
      label: "Party", area: AREA.cocktail, lighting: "PARTY", spine: 1.4,
      wants: ["dance", "bar", "dj", "cocktail", "door"],
      note: "Standing room, a bar guests can reach, cocktail tables to put a glass down.",
    },
  };
  const EVENT_NAMES = Object.keys(EVENT_TYPES);
  const DEFAULT_EVENT = "wedding";
  const eventOf = (name) => EVENT_TYPES[String(name)] || EVENT_TYPES[DEFAULT_EVENT];

  /* Guess the type from the booking's own "kind of function" free text, so a
     designer who never touches the selector still gets sensible defaults. */
  function guessEvent(text) {
    const s = String(text || "").toLowerCase();
    if (/wed|kasal|nuptial|reception/.test(s)) return "wedding";
    if (/debut|birth|kaarawan|anniv/.test(s)) return "birthday";
    if (/confer|summit|convention|seminar/.test(s)) return "conference";
    if (/corp|company|launch|meeting|awards/.test(s)) return "corporate";
    if (/grad|recogn|commence/.test(s)) return "graduation";
    if (/party|fiesta|social|christmas/.test(s)) return "party";
    if (/buffet|cater|lunch|dinner/.test(s)) return "buffetCatering";
    return DEFAULT_EVENT;
  }

  /* ── Lighting presets ─────────────────────────────────────────────────
     Read by js/simulate.js's rig. Each is a physically believable room, not
     a colour wash: `ambient` is the light nothing is ever darker than,
     `key` is the directional shape, `lamp` is what the ceiling fittings
     carry, and `exposure` is the tone-mapping the room is graded at.

     `lampColour` is a HUE the gel takes; its saturation is capped and its
     lightness floored in simulate.js so a bold scheme never darkens the
     room below working light. */
  const LIGHTING = {
    DAYLIGHT: {
      label: "Daylight",
      ambient: { sky: 0xFFF6E8, ground: 0x7A6A50, intensity: 0.78 },
      key: { colour: 0xFFF8E8, intensity: 0.95, elevation: 0.85 },
      lamp: { colour: 0xFFF3DC, intensity: 0.9, distance: 22 },
      exposure: 1.22, fogDensity: 0.0,
      note: "Full house lights, as a room is set up and inspected.",
    },
    EVENING: {
      label: "Evening",
      ambient: { sky: 0xF6E0BE, ground: 0x4A3A28, intensity: 0.52 },
      key: { colour: 0xFFE2B0, intensity: 0.62, elevation: 0.55 },
      lamp: { colour: 0xFFDFA8, intensity: 1.7, distance: 20 },
      exposure: 1.12, fogDensity: 0.006,
      note: "Chandeliers carrying the room after sunset.",
    },
    WEDDING: {
      label: "Wedding",
      ambient: { sky: 0xFFEFDC, ground: 0x5C4632, intensity: 0.58 },
      key: { colour: 0xFFEDD2, intensity: 0.72, elevation: 0.7 },
      lamp: { colour: 0xFFE8C4, intensity: 1.6, distance: 21 },
      exposure: 1.18, fogDensity: 0.004,
      note: "Warm and even — the light a reception is photographed in.",
    },
    CORPORATE: {
      label: "Corporate",
      ambient: { sky: 0xF2F4F8, ground: 0x5A5C60, intensity: 0.72 },
      key: { colour: 0xF6F8FC, intensity: 0.9, elevation: 0.8 },
      lamp: { colour: 0xF0F3F8, intensity: 1.1, distance: 22 },
      exposure: 1.2, fogDensity: 0.0,
      note: "Neutral white, so a screen and a face both read correctly.",
    },
    PARTY: {
      label: "Party",
      ambient: { sky: 0xE8DCF2, ground: 0x3A2E42, intensity: 0.46 },
      key: { colour: 0xE6D8F4, intensity: 0.5, elevation: 0.45 },
      lamp: { colour: 0xFFD8E8, intensity: 1.9, distance: 18 },
      exposure: 1.08, fogDensity: 0.012,
      note: "Dimmed with colour in the uplighting — still bright enough to walk.",
    },
  };
  const LIGHTING_NAMES = Object.keys(LIGHTING);
  const DEFAULT_LIGHTING = "WEDDING";
  const lightingOf = (n) => LIGHTING[String(n)] || LIGHTING[DEFAULT_LIGHTING];

  /* ── Camera ───────────────────────────────────────────────────────────
     The walkthrough's body and both its cameras, in one place so first and
     third person cannot drift apart. Metres and m/s. */
  const CAMERA = {
    eye: 1.68,          // standing eye height
    crouchEye: 1.05,
    radius: 0.28,       // shoulder half-width — nav.js's BODY_R reads this value directly
    walk: 1.45,         // an unhurried indoor pace, m/s
    sprint: 3.1,
    accel: 12,
    friction: 11,
    gravity: 18,
    jump: 4.4,
    step: 0.35,         // obstacles under this are stepped over
    boom: 3.1,          // third person: distance behind the avatar
    boomMin: 0.85,
    boomHeight: 1.62,
    boomSide: 0.42,
    boomEase: 9,
    camRadius: 0.22,
    fov: 72,
    interactRange: 2.4, // how close before [E] Inspect appears
  };

  /* ── Simulation ───────────────────────────────────────────────────────
     Crowd behaviour and the congestion thresholds the flow report uses. */
  const SIM = {
    density: {
      NONE:   { label: "Empty room", seated: 0,    walkers: 0 },
      SPARSE: { label: "Arriving",   seated: 0.35, walkers: 4 },
      HALF:   { label: "Half full",  seated: 0.6,  walkers: 7 },
      FULL:   { label: "Full house", seated: 0.94, walkers: 11 },
    },
    // Guests per square metre at which a patch of floor is a problem.
    congestion: { moderate: 1.4, critical: 2.2 },
    // How long a guest waits at a serving line, seconds per guest served.
    queueRate: { buffet: 12, bar: 9, beverage: 6, coffee: 8, dessert: 7 },
    walkerSpeed: { guest: 0.95, staff: 1.2 },
  };

  /* ── Heatmap bands ────────────────────────────────────────────────────
     What GREEN / YELLOW / RED mean on the walkability overlay. Expressed as
     clear-floor width in metres, so the colour on the floor and the number
     in the report are the same measurement. */
  const HEAT = [
    { max: CLEAR.guest,   band: "critical", colour: 0xC0392B, label: "Impassable" },
    { max: CLEAR.service, band: "moderate", colour: 0xE0A526, label: "Tight" },
    { max: CLEAR.main,    band: "fair",     colour: 0xBFC94A, label: "Adequate" },
    { max: Infinity,      band: "good",     colour: 0x5C9A3F, label: "Clear" },
  ];
  const bandFor = (width) => HEAT.find((b) => width < b.max) || HEAT[HEAT.length - 1];

  /* ── Optimiser ────────────────────────────────────────────────────────
     What a recommendation may do, and how hard it may try. Bounded on
     purpose: a tool that shunts a plan four metres to satisfy an aisle has
     stopped being a suggestion. */
  const OPTIMISE = {
    maxNudge: 1.5,      // metres a piece may be moved by one recommendation
    stepNudge: 0.25,    // the grid the search moves on — the sheet's own
    maxRotate: 90,      // degrees
    maxSuggestions: 12,
    minGain: 0.1,       // metres of clearance won, below which it isn't worth it
  };

  return Object.freeze({
    CLEAR, AREA, PIECES, GROUPS, BY_KIND,
    CHAIRS, CHAIR_NAMES, DEFAULT_CHAIR, chairOf,
    EVENT_TYPES, EVENT_NAMES, DEFAULT_EVENT, eventOf, guessEvent,
    LIGHTING, LIGHTING_NAMES, DEFAULT_LIGHTING, lightingOf,
    CAMERA, SIM, HEAT, bandFor, OPTIMISE,
    pieceOf, isPassable, heightOf, roleOf, kindsWithRole, capacityOf,
  });
})();
