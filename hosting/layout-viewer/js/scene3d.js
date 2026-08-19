/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — the 3D view.

   The same floor plan the 2D sheet draws, stood up in the room. Nothing here
   invents data: every piece is extruded straight from the `layout.items` the
   designer already placed (metres, degrees), so what the plan says is where
   the model puts it. Chairs are generated from each piece's `seats` count,
   which is why the 3D view and the cover tally can never disagree.

   This is a MASSING MODEL, deliberately: clean geometry in the portal's own
   paper-and-gold palette, lit so the room reads at a glance. It answers
   "where does the stage go, and can the guests get past the buffet" — not
   "what will the linen look like". Photoreal would mean a GLTF furniture
   library and baked lighting, which is a different project.

   READ-ONLY by design. Editing lives in the 2D sheet, where a click means
   one unambiguous thing; a drag in a perspective view has to guess at depth,
   and a plan you can nudge by accident is worse than one you cannot.

   Public API (window.HPScene):
     available()          Three.js actually loaded?
     mount(el)            build renderer/scene into `el` (once)
     render(layout)       (re)build the room + pieces from a layout object
     setView(name)        glide to a camera preset
     views                the preset names, in filmstrip order
     thumbnails()         → { name: dataURL } for the filmstrip
     resize()             re-fit to the container
     dispose()            drop GPU resources and listeners
   ════════════════════════════════════════════════════════════════ */
window.HPScene = (function () {
  "use strict";

  const T = window.THREE;
  const available = () => !!T;

  /* ── Palette ──────────────────────────────────────────────────────────
     Read off the live stylesheet rather than hardcoded, so the model wears
     the portal's own colours — and follows the dark variant when the token
     values swap under it. Falls back to the light theme's values if a token
     is missing (the CSS failed to load, say). */
  function token(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return new T.Color(v || fallback);
  }
  let C = {};
  function readPalette() {
    C = {
      floor:   token("--vellum", "#E7D8B5"),
      wall:    token("--paper-2", "#F8F1DE"),
      cloth:   token("--paper-3", "#FFFBF0"),
      wood:    token("--gold-deep", "#7B591F"),
      gold:    token("--gold", "#A9823C"),
      gilt:    token("--gilt", "#DCB661"),
      olive:   token("--olive", "#54582F"),
      ink:     token("--ink", "#33220F"),
      danger:  token("--danger", "#8C3320"),
      leaf:    token("--ok", "#5C7A33"),
    };
    // The canvas ground: a shade under the floor so the room reads as a room.
    C.bg = token("--paper", "#EFE3C6").clone().multiplyScalar(0.94);
  }

  /* ── Camera presets ───────────────────────────────────────────────────
     Each is expressed as a direction and a distance FACTOR relative to the
     room's own size, so a 9 m function room and a 24 m ballroom both frame
     themselves — a fixed metre distance would put one camera inside the wall
     and leave the other looking at a speck. */
  const VIEWS = {
    Perspective: { dir: [0, 0.82, 1.05], fit: 0.78, tilt: 0.30 },
    "Top View":  { dir: [0, 1, 0.001],   fit: 0.62, tilt: 0.50 },
    "Front View":{ dir: [0, 0.30, 1.25], fit: 0.72, tilt: 0.16 },
    "Left View": { dir: [-1.25, 0.30, 0], fit: 0.72, tilt: 0.16 },
    "Right View":{ dir: [1.25, 0.30, 0],  fit: 0.72, tilt: 0.16 },
  };
  const VIEW_NAMES = Object.keys(VIEWS);

  let renderer = null, scene = null, camera = null, host = null;
  let roomGroup = null, itemGroup = null;
  let room = { w: 24, h: 18 };
  const DOOR_H = 2.1;                 // clear height of an opening, metres
  const WALL_H = 4.2;                 // floor to ceiling, metres
  let openings = {};                  // { north|south|east|west: [{from,to}] }
  let closeRoom = false;              // draw the near wall too (walkthrough)
  // Created in mount(), not here: if Three.js never arrived this module must
  // still load and answer available() === false, rather than throwing at
  // evaluation and taking the whole page's script chain down with it.
  let target = null;                          // what the camera looks at
  let ease = null;                            // an in-flight camera glide
  let raf = 0, needsDraw = true;
  let currentView = "Perspective";
  const disposables = [];                     // geometries/materials we own

  /* ── The dressing ─────────────────────────────────────────────────────
     A setup chosen on the Content Moderator's gallery (js/theme.js reads its
     colours back out of the photograph) re-dresses the room. What it may
     touch is deliberately narrow: the LINEN, the DRAPE, the ACCENTS and the
     UPLIGHTING — the things a venue actually re-dresses between events.

     The floor, the walls, the ceiling and the timber are structural. A
     venue does not repaint its function room for a wedding, and a model that
     did would stop being a picture of THIS room and become a picture of
     someone else's photograph. Keeping the two sets apart in one place is
     what makes that line hold. */
  let theme = null;                 // null = the house's own scheme
  /* The shell (wall, floor) is in this list, held to a narrow high band by
     js/theme.js. It was left out at first on the reasoning that a venue does
     not repaint between events — true of paint, but a photograph of a bright
     ballroom is mostly its walls and its floor, and a room that keeps the
     house's dark vellum under a bright setup reads as the wrong venue. The
     tint is slight by construction; the structure is still the room's. */
  const DRESSED = ["cloth", "gold", "gilt", "leaf", "wine", "wall", "floor"];

  /* Which theme role each dressed material wears. `gold` and `gilt` are the
     room's two accent weights, so they take the accent at two strengths
     rather than both flattening to one. */
  function themeColor(name) {
    if (!theme) return null;
    const c = (hex) => new T.Color(hex);
    switch (name) {
      case "cloth": return theme.accent ? c(theme.accent) : c(theme.cloth);
      case "gold":  return c(theme.accent);
      // The brighter accent: the same colour lifted, so a gilt edge still
      // reads as a highlight against the sashes rather than vanishing.
      case "gilt":  return c(theme.accent).lerp(new T.Color(0xffffff), 0.35);
      case "leaf":  return c(theme.bloom);
      case "wine":  return c(theme.drape);
      case "wall":  return theme.wall ? c(theme.wall) : null;
      case "floor": return theme.floor ? c(theme.floor) : null;
      default:      return null;
    }
  }

  /* ── Materials ────────────────────────────────────────────────────────
     One material per finish, shared by every piece that wears it — a room of
     forty chairs should compile one material, not forty.

     ── On "PBR" here ────────────────────────────────────────────────────
     MeshStandardMaterial IS a physically-based model: roughness and metalness
     are the two parameters that decide how a surface answers light, and they
     are set below from what each finish actually is. Timber is rough and
     barely metallic; a gilt edge is smooth and very metallic; linen is rough
     and not metallic at all; glass is smooth, transmissive and near-white.

     What is deliberately NOT done is texture MAPS. A map for every finish is
     a dozen image downloads on a page whose whole promise is that it opens on
     the venue's own laptop and draws a floor plan. The brief asks for
     realistic materials without sacrificing performance (§3), and parameter
     realism is where nearly all of the read comes from at this scale — a
     tablecloth reads as cloth because it scatters light like cloth, not
     because you can count its threads from four metres up. */
  let M = null;
  function buildMaterials() {
    const std = (color, opts) => {
      const m = new T.MeshStandardMaterial(Object.assign({ color: color }, opts || {}));
      disposables.push(m);
      return m;
    };
    M = {
      floor:  std(C.floor, { roughness: 0.42, metalness: 0.08 }),
      wall:   std(C.wall,  { roughness: 0.92, metalness: 0.0, side: T.DoubleSide }),
      cloth:  std(C.cloth, { roughness: 0.75, metalness: 0.02 }),
      wood:   std(C.wood,  { roughness: 0.38, metalness: 0.18 }),
      gold:   std(C.gold,  { roughness: 0.28, metalness: 0.75 }),
      gilt:   std(C.gilt,  { roughness: 0.18, metalness: 0.90 }),
      olive:  std(C.olive, { roughness: 0.75 }),
      wine:   std(C.danger,{ roughness: 0.65 }),
      leaf:   std(C.leaf,  { roughness: 0.78 }),
      dark:   std(C.ink,   { roughness: 0.70 }),
      steel:  std(0xC3C7CB, { roughness: 0.28, metalness: 0.92 }),
      glass:  std(0xE8F0F2, { roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.40 }),
      screen: std(0x1A2430, { roughness: 0.20, metalness: 0.4,
                              emissive: new T.Color(0x2C4A66), emissiveIntensity: 0.65 }),
      matte:  std(0x22252A, { roughness: 0.90, metalness: 0.05 }),
    };
    if (theme) applyTheme();
  }

  /* ── Mount ────────────────────────────────────────────────────────────── */
  function mount(el) {
    if (!available() || !el) return false;
    if (renderer) { host = el; el.appendChild(renderer.domElement); resize(); return true; }
    host = el;
    target = new T.Vector3(0, 0, 0);
    readPalette();
    buildMaterials();

    renderer = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.domElement.className = "ld-3d-canvas";
    el.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.background = C.bg;
    scene.fog = new T.Fog(C.bg, 45, 180);

    camera = new T.PerspectiveCamera(46, 1, 0.1, 500);

    buildLights();
    roomGroup = new T.Group(); scene.add(roomGroup);
    itemGroup = new T.Group(); scene.add(itemGroup);

    wireOrbit();
    resize();
    loop();
    return true;
  }

  /* ── Lighting ─────────────────────────────────────────────────────────
     A warm key from the front-left with a soft shadow, a cool-ish fill from
     behind so the far side of every table isn't black, and a low ambient so
     nothing is ever fully unlit. Three lights, because a fourth costs a
     shadow pass and buys nothing a plan-reader would notice. */
  function buildLights() {
    scene.add(new T.HemisphereLight(0xfff3d8, 0x4a381f, 0.72));

    const key = new T.DirectionalLight(0xfff0cf, 1.05);
    key.position.set(-14, 22, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    key.shadow.bias = -0.0015;
    scene.add(key);
    scene.userData.key = key;

    const fill = new T.DirectionalLight(0xd8c9a8, 0.42);
    fill.position.set(16, 12, -14);
    scene.add(fill);
  }

  // The key light's shadow frustum has to cover the whole floor, or half the
  // room falls outside the shadow map and simply stops casting.
  function frameShadows() {
    const key = scene.userData.key;
    if (!key) return;
    const r = Math.max(room.w, room.h) * 0.75 + 4;
    const c = key.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.far = r * 4;
    c.updateProjectionMatrix();
    key.position.set(-room.w * 0.5, Math.max(room.w, room.h) * 0.9, room.h * 0.55);
    key.target.position.set(0, 0, 0);
    scene.add(key.target);
  }

  /* ── Building the room ────────────────────────────────────────────────
     The plan's coordinate space is 2D top-view metres with the origin at the
     room's top-left corner and +y running DOWN the sheet. The scene is
     centred on the origin with +z running "down" the room, so a piece at
     (x, y) sits at (x - w/2, y - h/2) in world space. Doing that conversion
     in ONE place is what keeps the two views agreeing.  */
  const toWorldX = (x) => x - room.w / 2;
  const toWorldZ = (y) => y - room.h / 2;

  let lastItems = [];
  function render(layout) {
    if (!renderer) return;
    const l = layout || {};
    const r = l.room || {};
    room = {
      w: Math.max(2, Number(r.w) || 24),
      h: Math.max(2, Number(r.h) || 18),
    };
    const list = Array.isArray(l.items) ? l.items : [];
    lastItems = list;
    openings = buildOpenings(list, room);
    closeRoom = false;
    // An overlay drawn against the PREVIOUS layout describes a room that no
    // longer stands. It is dropped here rather than re-measured, because the
    // analysis is the caller's to re-run and a stale heatmap is worse than
    // none — it would mark clear floor red.
    clearAnalysis();
    buildRoom();
    buildItems(list);
    frameShadows();
    setView(currentView, true);
    needsDraw = true;
  }

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.traverse((n) => { if (n.isMesh && n.geometry) n.geometry.dispose(); });
    }
  }

  /* Which wall a door belongs to, and the span it opens.

     A door is placed on the plan like any other piece; the wall it serves is
     whichever it sits nearest. Snapping to the nearest wall (rather than
     demanding the designer land it pixel-exactly on the line) is what makes a
     doorway placeable with the same drag as a table — and the result is
     shared with the walkthrough's collision, so the hole you can see is
     exactly the hole you can walk through.

     Returned in the WALL'S OWN axis, centred on the wall, matching the
     segment builder's coordinate space. */
  function buildOpenings(items, dims) {
    const out = { north: [], south: [], east: [], west: [] };
    const R = dims || room;
    /* Every kind of ACCESS cuts a hole: a guest doorway, a fire exit and a
       service entrance are all openings in a wall, and the only difference
       between them is what is written over the top. Asking the catalogue
       rather than testing for "door" is what stopped the emergency exit
       being drawn as a frame bolted to a solid wall — visible, marked, and
       impossible to walk through. */
    const RU = window.HPRules;
    const opens = (kind) => (RU
      ? (RU.roleOf(kind) === "access" && RU.pieceOf(kind).build !== null)
      : kind === "door");
    (items || []).forEach((it) => {
      if (!opens(String(it.kind))) return;
      const w = Math.max(0.3, Number(it.w) || 0.9);
      const h = Math.max(0.05, Number(it.h) || 0.25);
      const cx = (Number(it.x) || 0) + w / 2;
      const cy = (Number(it.y) || 0) + h / 2;
      // Distance to each wall; nearest wins.
      const d = { north: cy, south: R.h - cy, west: cx, east: R.w - cx };
      const side = Object.keys(d).reduce((a, b) => (d[a] <= d[b] ? a : b));
      // On a north/south wall the door's WIDTH spans the wall; on east/west
      // it is the piece's own height that runs along the wall.
      const along = (side === "north" || side === "south") ? cx : cy;
      const span = (side === "north" || side === "south") ? w : Math.max(w, h);
      const len = (side === "north" || side === "south") ? R.w : R.h;
      let c = along - len / 2;
      // West and south walls are drawn rotated, so their local axis runs the
      // other way — mirror the centre or the hole lands on the wrong end.
      if (side === "west" || side === "south") c = -c;
      out[side].push({ from: c - span / 2, to: c + span / 2 });
    });
    return out;
  }

  function buildRoom() {
    clearGroup(roomGroup);
    const { w, h } = room;

    const floor = new T.Mesh(new T.PlaneGeometry(w, h), M.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    roomGroup.add(floor);

    // A metre grid drawn on the floor, matching the 2D sheet's ruling — it is
    // the same measure, so the eye can carry a distance between the views.
    // Ruled in the room's own accent so the measure sits ON the themed floor
    // rather than across it — a house-gold grid over a cool floor reads as a
    // second drawing laid on top of the first.
    const gridCol = themeColor("gold") || C.gold;
    const grid = new T.GridHelper(Math.max(w, h), Math.max(w, h), gridCol, gridCol);
    grid.material.opacity = 0.18;
    grid.material.transparent = true;
    grid.position.y = 0.004;
    // Clip the helper's square to the room's actual rectangle.
    grid.scale.set(w / Math.max(w, h), 1, h / Math.max(w, h));
    roomGroup.add(grid);
    disposables.push(grid.material, grid.geometry);

    /* The walls, with the doorways cut out of them.

       A wall is built as a run of segments along its own axis, skipping the
       spans a door occupies and capping each opening with a lintel. Cutting
       the hole here (rather than parking an open-door prop against a solid
       wall) is what lets the walkthrough's collision treat a doorway as
       genuinely passable: the wall simply isn't there across that span.

       `openings` is a list of {axis, from, to} in the same metre space the
       plan uses, filled by buildOpenings() from the door items. */
    const wall = (span, wh, fix, ry, axis) => {
      const cuts = (openings[axis] || [])
        .slice()
        .sort((a, b) => a.from - b.from);
      const segs = [];
      let cursor = -span / 2;
      cuts.forEach((c) => {
        const from = Math.max(-span / 2, c.from);
        const to = Math.min(span / 2, c.to);
        if (to <= cursor) return;
        if (from > cursor) segs.push([cursor, from]);
        cursor = Math.max(cursor, to);
        // The lintel over the opening, so the wall reads as continuous above
        // head height instead of as a slot to the ceiling.
        const lw = to - from;
        if (lw > 0.05) {
          const l = new T.Mesh(new T.BoxGeometry(lw, WALL_H - DOOR_H, 0.1), M.wall);
          l.position.set(0, DOOR_H + (WALL_H - DOOR_H) / 2, 0);
          const holder = new T.Group();
          holder.add(l);
          l.position.x = (from + to) / 2;
          holder.position.copy(fix);
          holder.rotation.y = ry;
          holder.receiveShadow = true;
          roomGroup.add(holder);
        }
      });
      if (cursor < span / 2) segs.push([cursor, span / 2]);

      segs.forEach(([a, b]) => {
        const sw = b - a;
        if (sw <= 0.02) return;
        const m = new T.Mesh(new T.PlaneGeometry(sw, wh), M.wall);
        const holder = new T.Group();
        holder.add(m);
        m.position.set((a + b) / 2, wh / 2, 0);
        holder.position.copy(fix);
        holder.rotation.y = ry;
        m.receiveShadow = true;
        roomGroup.add(holder);
      });
    };
    // Back and the two sides. The near wall is left off in the PREVIEW so the
    // perspective view isn't looking at the inside of a box; the walkthrough
    // asks for it (closeRoom) because a missing wall is a hole a walker falls
    // out of.
    wall(w, WALL_H, new T.Vector3(0, 0, -h / 2), 0, "north");
    wall(h, WALL_H, new T.Vector3(-w / 2, 0, 0), Math.PI / 2, "west");
    wall(h, WALL_H, new T.Vector3(w / 2, 0, 0), -Math.PI / 2, "east");
    if (closeRoom) wall(w, WALL_H, new T.Vector3(0, 0, h / 2), Math.PI, "south");

    // A gilt skirting line where the walls meet the floor — the same hairline
    // the printed sheet rules its panels with.
    const skirt = new T.Mesh(new T.BoxGeometry(w, 0.12, 0.06), M.gilt);
    skirt.position.set(0, 0.06, -h / 2 + 0.03);
    roomGroup.add(skirt);

    // Gilt crown moulding at top of walls
    const crownN = new T.Mesh(new T.BoxGeometry(w, 0.14, 0.10), M.gilt);
    crownN.position.set(0, WALL_H - 0.07, -h / 2 + 0.05);
    roomGroup.add(crownN);

    const crownW = new T.Mesh(new T.BoxGeometry(h, 0.14, 0.10), M.gilt);
    crownW.rotation.y = Math.PI / 2;
    crownW.position.set(-w / 2 + 0.05, WALL_H - 0.07, 0);
    roomGroup.add(crownW);

    const crownE = new T.Mesh(new T.BoxGeometry(h, 0.14, 0.10), M.gilt);
    crownE.rotation.y = Math.PI / 2;
    crownE.position.set(w / 2 - 0.05, WALL_H - 0.07, 0);
    roomGroup.add(crownE);
  }

  /* ── Building the pieces ──────────────────────────────────────────────
     One builder per kind. Each returns a Group whose origin is the piece's
     own centre at floor level, so placement and rotation are the same three
     lines for every kind. */
  /* One place where a stored item becomes the shape a builder is handed.
     Both build paths (the preview's buildItems and the walkthrough's
     buildFor) go through it, so a new property is read once rather than in
     two places that can drift. */
  function normalise(raw) {
    return {
      kind: String(raw.kind || "other"),
      label: String(raw.label || ""),
      x: Number(raw.x) || 0,
      y: Number(raw.y) || 0,
      w: Math.max(0.2, Number(raw.w) || 1),
      h: Math.max(0.2, Number(raw.h) || 1),
      rot: Number(raw.rot) || 0,
      seats: Math.max(0, Math.round(Number(raw.seats) || 0)),
      // Which chair this table wears. Absent on every plan drawn before
      // chair types existed, which is exactly why it falls back rather than
      // being required — those plans keep the banquet chair they had.
      chair: raw.chair ? String(raw.chair) : null,
    };
  }

  /* Which 3D builder dresses a kind. The catalogue in js/rules.js names it,
     so a new kind is added there and appears here without this file
     enumerating it a second time. A kind with no builder — or a plan naming
     one this build doesn't have — falls through to the plain box, which is
     honest: something stands there and its footprint is right. */
  function builderFor(kind) {
    const RU = window.HPRules;
    const name = RU ? RU.pieceOf(kind).build : kind;
    if (name === null) return null;             // spawn: a position, not a prop
    return BUILD[name] || BUILD[kind] || BUILD.other;
  }

  function buildItems(items) {
    clearGroup(itemGroup);
    items.forEach((raw) => {
      const it = normalise(raw);
      const make = builderFor(it.kind);
      const g = make && make(it);
      if (!g) return;
      g.position.set(toWorldX(it.x + it.w / 2), 0, toWorldZ(it.y + it.h / 2));
      // The sheet's rotation is clockwise on a top-down view; a Y rotation in
      // world space runs the other way, hence the negation.
      g.rotation.y = -it.rot * Math.PI / 180;
      g.userData.item = raw;
      itemGroup.add(g);
    });
  }

  const mesh = (geo, mat, cast) => {
    const m = new T.Mesh(geo, mat);
    m.castShadow = cast !== false;
    m.receiveShadow = true;
    return m;
  };

  /* ── Chairs ───────────────────────────────────────────────────────────
     Five types, because a chiavari and a bar stool are not the same piece of
     furniture and a plan that says "banquet chairs" should look like one.
     Which type a table wears is the table's own `chair` property, defaulting
     to the house's banquet chair — so an existing plan that names no chair
     type gets exactly the chair it had before.

     Every one is tagged `userData.seat`: Simulation Mode's crowd
     (js/crowd.js) finds its seated guests by walking the built scene for
     these marks, so a guest sits on a chair that exists rather than at a
     position recomputed from the plan — one seat ring, not two. The tag also
     carries the seat HEIGHT, because a guest on a bar stool sits 30 cm
     higher than one on a banquet chair and the crowd has to know. */
  const CHAIR_BUILD = {
    // The house banquet chair: dressed in chair cover (clothing) matching table linen.
    pad(g) {
      const seat = mesh(new T.BoxGeometry(0.44, 0.06, 0.44), M.cloth);
      seat.position.y = 0.45;
      g.add(seat);
      const back = mesh(new T.BoxGeometry(0.44, 0.5, 0.06), M.cloth);
      back.position.set(0, 0.72, -0.18);
      g.add(back);
      const skirt = mesh(new T.BoxGeometry(0.44, 0.42, 0.44), M.cloth);
      skirt.position.set(0, 0.21, 0);
      g.add(skirt);
      // Gold/accent ribbon sash around chair back
      const sash = mesh(new T.BoxGeometry(0.46, 0.16, 0.09), M.gilt);
      sash.position.set(0, 0.64, -0.18);
      g.add(sash);
      // Back bow accent knot
      const knot = mesh(new T.SphereGeometry(0.06, 8, 8), M.gold);
      knot.position.set(0, 0.64, -0.23);
      g.add(knot);
      const legGeo = new T.BoxGeometry(0.05, 0.45, 0.05);
      [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach(([lx, lz]) => {
        const l = mesh(legGeo, M.wood);
        l.position.set(lx, 0.225, lz);
        g.add(l);
      });
      return 0.45;
    },

    // Chiavari: the gilt ballroom chair. Turned legs, a slatted back, a thin
    // cushion — the silhouette every wedding photograph has in it.
    slat(g) {
      const seat = mesh(new T.BoxGeometry(0.39, 0.05, 0.39), M.cloth);
      seat.position.y = 0.46;
      g.add(seat);
      const postGeo = new T.CylinderGeometry(0.022, 0.026, 0.46, 8);
      [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]].forEach(([lx, lz]) => {
        const l = mesh(postGeo, M.gilt);
        l.position.set(lx, 0.23, lz);
        g.add(l);
      });
      // The back: two uprights carrying four slender rails.
      [-0.16, 0.16].forEach((x) => {
        const up = mesh(new T.CylinderGeometry(0.021, 0.021, 0.55, 8), M.gilt);
        up.position.set(x, 0.735, -0.17);
        g.add(up);
      });
      for (let i = 0; i < 4; i++) {
        const rail = mesh(new T.CylinderGeometry(0.014, 0.014, 0.33, 6), M.gilt);
        rail.rotation.z = Math.PI / 2;
        rail.position.set(0, 0.56 + i * 0.11, -0.17);
        g.add(rail);
      }
      return 0.46;
    },

    // Modern: a moulded shell on a slim frame. One curved piece, no back rail.
    shell(g) {
      const seat = mesh(new T.BoxGeometry(0.46, 0.05, 0.44), M.olive);
      seat.position.y = 0.44;
      g.add(seat);
      const back = mesh(new T.BoxGeometry(0.46, 0.42, 0.05), M.olive);
      back.position.set(0, 0.66, -0.2);
      back.rotation.x = -0.14;      // a shell chair reclines
      g.add(back);
      const legGeo = new T.CylinderGeometry(0.018, 0.022, 0.44, 8);
      [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]].forEach(([lx, lz]) => {
        const l = mesh(legGeo, M.steel);
        l.position.set(lx, 0.22, lz);
        g.add(l);
      });
      return 0.44;
    },

    // Bar stool: a tall column, a footring, a small round seat. Sits at 0.75 m,
    // which is why it belongs at a cocktail table and nowhere else.
    stool(g) {
      const seat = mesh(new T.CylinderGeometry(0.18, 0.18, 0.06, 16), M.cloth);
      seat.position.y = 0.75;
      g.add(seat);
      const post = mesh(new T.CylinderGeometry(0.04, 0.05, 0.75, 10), M.steel);
      post.position.y = 0.375;
      g.add(post);
      const foot = mesh(new T.CylinderGeometry(0.19, 0.21, 0.03, 16), M.steel);
      foot.position.y = 0.02;
      g.add(foot);
      const ring = mesh(new T.TorusGeometry(0.15, 0.014, 6, 18), M.steel);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.22;
      g.add(ring);
      return 0.75;
    },

    // Executive: the wide upholstered chair a head table or a boardroom
    // wants. Arms, a tall back, a pedestal base.
    exec(g) {
      const seat = mesh(new T.BoxGeometry(0.5, 0.1, 0.48), M.wine);
      seat.position.y = 0.44;
      g.add(seat);
      const back = mesh(new T.BoxGeometry(0.5, 0.58, 0.08), M.wine);
      back.position.set(0, 0.78, -0.2);
      back.rotation.x = -0.08;
      g.add(back);
      [-0.27, 0.27].forEach((x) => {
        const arm = mesh(new T.BoxGeometry(0.05, 0.06, 0.36), M.dark);
        arm.position.set(x, 0.62, -0.04);
        g.add(arm);
        const post = mesh(new T.BoxGeometry(0.04, 0.16, 0.04), M.dark);
        post.position.set(x, 0.53, -0.04);
        g.add(post);
      });
      const column = mesh(new T.CylinderGeometry(0.05, 0.06, 0.38, 10), M.steel);
      column.position.y = 0.2;
      g.add(column);
      const base = mesh(new T.CylinderGeometry(0.26, 0.28, 0.04, 14), M.steel);
      base.position.y = 0.02;
      g.add(base);
      return 0.44;
    },
  };

  /* One chair of a named type. Falls back to the banquet chair for a name
     the catalogue doesn't know, so a hand-edited plan can't produce a table
     with invisible seats. */
  function chair(type) {
    const RU = window.HPRules;
    const spec = RU ? RU.chairOf(type) : null;
    const style = (spec && spec.style) || "pad";
    const g = new T.Group();
    const build = CHAIR_BUILD[style] || CHAIR_BUILD.pad;
    const seatH = build(g);
    g.userData.seat = true;
    g.userData.seatHeight = seatH;
    g.userData.chairType = (spec && spec.label) || "Banquet";
    return g;
  }

  /* Chairs evenly around a round table, each turned to face its centre.

     A chair is modelled facing its own +Z (the back sits at -Z), so a chair
     standing out at angle `a` has to be turned to point back INWARD — hence
     the half-turn on top of the angle. Without it every guest at a round
     table sits with their back to the cake. */
  function ringChairs(g, radius, n, type) {
    // A chair is ~0.42-0.5 m across; packed tighter than that on the ring
    // and neighbouring bodies clip through each other. When the seat count
    // would pack them closer than 0.6 m of arc, push the ring OUT rather
    // than letting chairs (and the guests on them) overlap.
    const MIN_ARC = 0.6;
    let r = radius + 0.34;
    if (n > 1) {
      const minR = (MIN_ARC * n) / (Math.PI * 2);
      r = Math.max(r, minR);
    }
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = chair(type);
      c.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      c.rotation.y = -a - Math.PI / 2;
      g.add(c);
    }
  }

  // Chairs down the two long sides of a rectangular table, split evenly.
  function sideChairs(g, w, d, n, type, oneSide) {
    if (!n) return;
    // A head table is sat at from one side only — the party faces the room.
    const sides = oneSide ? 1 : 2;
    const perSide = Math.ceil(n / sides);
    let placed = 0;
    for (let side = 0; side < sides && placed < n; side++) {
      const z = (side ? 1 : -1) * (d / 2 + 0.34);
      const count = Math.min(perSide, n - placed);
      // Same floor as ringChairs: don't let the plan's seat count pack
      // chairs closer than a body actually is.
      const span = Math.max(w - 0.5, (count - 1) * 0.6);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const c = chair(type);
        c.position.set((t - 0.5) * span, 0, z);
        c.rotation.y = side ? Math.PI : 0;
        g.add(c);
        placed++;
      }
    }
  }

  // A low centrepiece — a bowl and a few leaves, so a dressed table doesn't
  // read as a bare disc from above.
  function centrepiece(scale) {
    const g = new T.Group();
    const s = scale || 1;
    const bowl = mesh(new T.CylinderGeometry(0.1 * s, 0.07 * s, 0.12 * s, 12), M.gilt);
    bowl.position.y = 0.06 * s;
    g.add(bowl);
    const bloom = mesh(new T.SphereGeometry(0.16 * s, 12, 8), M.leaf);
    bloom.position.y = 0.22 * s;
    bloom.scale.y = 0.7;
    g.add(bloom);
    return g;
  }

  /* A place setting: a plate, cutlery either side, a glass. Small — 26 cm
     across — but it is the single thing that makes a dressed table read as
     laid for dinner rather than as a disc of linen. Built once per cover and
     only where a guest actually sits, so the count follows the seat count for
     free. */
  function placeSetting() {
    const g = new T.Group();
    const plate = mesh(new T.CylinderGeometry(0.13, 0.115, 0.012, 18), M.cloth, false);
    plate.receiveShadow = true;
    g.add(plate);
    const rim = mesh(new T.TorusGeometry(0.128, 0.006, 5, 20), M.gilt, false);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.008;
    g.add(rim);
    // Cutlery: a fork to the left, a knife to the right.
    [[-0.175, 0.017], [0.175, 0.017]].forEach(([x, w]) => {
      const c = mesh(new T.BoxGeometry(w, 0.004, 0.17), M.steel, false);
      c.position.set(x, 0.002, 0);
      g.add(c);
    });
    const glass = mesh(new T.CylinderGeometry(0.032, 0.024, 0.11, 10), M.glass, false);
    glass.position.set(0.13, 0.055, -0.14);
    g.add(glass);
    return g;
  }

  // Settings laid around a round table, on the same ring the chairs sit on.
  function ringSettings(g, radius, n, top) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = placeSetting();
      s.position.set(Math.cos(a) * (radius - 0.19), top, Math.sin(a) * (radius - 0.19));
      s.rotation.y = -a - Math.PI / 2;
      g.add(s);
    }
  }

  function sideSettings(g, w, d, n, top, oneSide) {
    if (!n) return;
    const sides = oneSide ? 1 : 2;
    const perSide = Math.ceil(n / sides);
    let placed = 0;
    for (let side = 0; side < sides && placed < n; side++) {
      const z = (side ? 1 : -1) * (d / 2 - 0.2);
      const count = Math.min(perSide, n - placed);
      for (let i = 0; i < count; i++) {
        const t = count === 1 ? 0.5 : i / (count - 1);
        const s = placeSetting();
        s.position.set((t - 0.5) * (w - 0.5), top, z);
        s.rotation.y = side ? Math.PI : 0;
        g.add(s);
        placed++;
      }
    }
  }

  /* A chafing dish: the water pan, the food pan, a hinged lid and the frame
     it stands in. This is the object that says "catering" faster than
     anything else in the room, so it is modelled rather than suggested. */
  function chafingDish(scale) {
    const g = new T.Group();
    const s = scale || 1;
    const frame = mesh(new T.BoxGeometry(0.54 * s, 0.02 * s, 0.36 * s), M.steel);
    frame.position.y = 0.01 * s;
    g.add(frame);
    [[-0.24, -0.15], [0.24, -0.15], [-0.24, 0.15], [0.24, 0.15]].forEach(([x, z]) => {
      const leg = mesh(new T.CylinderGeometry(0.012 * s, 0.012 * s, 0.16 * s, 6), M.steel);
      leg.position.set(x * s, 0.08 * s, z * s);
      g.add(leg);
    });
    const pan = mesh(new T.BoxGeometry(0.5 * s, 0.11 * s, 0.33 * s), M.steel);
    pan.position.y = 0.215 * s;
    g.add(pan);
    // The domed lid, tipped back as it is on a live service.
    const lid = mesh(new T.SphereGeometry(0.25 * s, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.steel);
    lid.scale.set(1, 0.44, 0.66);
    lid.position.y = 0.27 * s;
    lid.rotation.z = 0.12;
    g.add(lid);
    const knob = mesh(new T.SphereGeometry(0.022 * s, 8, 6), M.gilt);
    knob.position.set(0, 0.39 * s, 0);
    g.add(knob);
    return g;
  }

  // A short stack of plates — a serving line's start, and a service table's
  // whole reason for standing there.
  function plateStack(n, scale) {
    const g = new T.Group();
    const s = scale || 1;
    const count = n || 6;
    for (let i = 0; i < count; i++) {
      const p = mesh(new T.CylinderGeometry(0.115 * s, 0.11 * s, 0.014 * s, 14), M.cloth, i === count - 1);
      p.position.y = i * 0.016 * s;
      g.add(p);
    }
    return g;
  }

  // A cylindrical drink dispenser with a tap — the beverage station's mark.
  function dispenser(scale) {
    const g = new T.Group();
    const s = scale || 1;
    const base = mesh(new T.CylinderGeometry(0.13 * s, 0.15 * s, 0.04 * s, 14), M.steel);
    base.position.y = 0.02 * s;
    g.add(base);
    const body = mesh(new T.CylinderGeometry(0.115 * s, 0.115 * s, 0.34 * s, 16), M.glass);
    body.position.y = 0.21 * s;
    g.add(body);
    const lid = mesh(new T.CylinderGeometry(0.125 * s, 0.115 * s, 0.035 * s, 16), M.steel);
    lid.position.y = 0.395 * s;
    g.add(lid);
    const tap = mesh(new T.CylinderGeometry(0.016 * s, 0.016 * s, 0.09 * s, 8), M.steel);
    tap.rotation.x = Math.PI / 2;
    tap.position.set(0, 0.09 * s, 0.11 * s);
    g.add(tap);
    return g;
  }

  // A run of cups beside a dispenser.
  function cupRow(n, s) {
    const g = new T.Group();
    for (let i = 0; i < (n || 4); i++) {
      const c = mesh(new T.CylinderGeometry(0.033 * s, 0.026 * s, 0.085 * s, 10), M.cloth, false);
      c.position.set((i - (n - 1) / 2) * 0.08 * s, 0.042 * s, 0);
      g.add(c);
    }
    return g;
  }

  /* A cloth-skirted counter — the base every serving piece in the room
     stands on. Buffet, dessert, beverage, registration and service tables
     differ in what is ON them, not in what they are, so the box and its
     timber lip are built once here. */
  function counter(w, d, height, top) {
    const g = new T.Group();
    const h = height || 0.9;
    const body = mesh(new T.BoxGeometry(w, h, d), M.cloth);
    body.position.y = h / 2;
    g.add(body);
    const lip = mesh(new T.BoxGeometry(w, 0.05, d + 0.06), top || M.wood);
    lip.position.y = h + 0.02;
    g.add(lip);
    return g;
  }

  const BUILD = {
    round(it) {
      const g = new T.Group();
      const r = it.w / 2;
      const top = mesh(new T.CylinderGeometry(r, r, 0.06, 36), M.cloth);
      top.position.y = 0.75;
      g.add(top);
      // The cloth falling to the floor — a slight taper reads as drape.
      const skirt = mesh(new T.CylinderGeometry(r, r * 0.98, 0.75, 36, 1, true), M.cloth);
      skirt.position.y = 0.375;
      g.add(skirt);
      g.add(centrepiece(Math.max(0.8, r)));
      ringChairs(g, r, it.seats, it.chair);
      ringSettings(g, r, it.seats, 0.785);
      return g;
    },

    rect(it) {
      const g = new T.Group();
      // A head table is laid and sat at from one side only.
      const oneSide = it.kind === "head";
      const top = mesh(new T.BoxGeometry(it.w, 0.06, it.h), M.cloth);
      top.position.y = 0.75;
      g.add(top);
      const skirt = mesh(new T.BoxGeometry(it.w, 0.75, it.h), M.cloth);
      skirt.position.y = 0.375;
      g.add(skirt);
      // A runner of blooms down a long table, spaced about every 1.2 m.
      const n = Math.max(1, Math.round(it.w / 1.2));
      for (let i = 0; i < n; i++) {
        const c = centrepiece(0.85);
        // On a one-sided table the flowers sit on the guests' far edge, so
        // they dress the side the room sees rather than block the party.
        c.position.set((n === 1 ? 0 : (i / (n - 1) - 0.5) * (it.w - 0.6)), 0.78,
                       oneSide ? it.h / 2 - 0.2 : 0);
        g.add(c);
      }
      sideChairs(g, it.w, it.h, it.seats, it.chair, oneSide);
      sideSettings(g, it.w, it.h, it.seats, 0.785, oneSide);
      return g;
    },

    /* A poseur: a tall slim column under a small round top, with a cloth to
       the floor. Nobody sits; four people stand at it, which is what the
       catalogue's `standing` count means. */
    cocktail(it) {
      const g = new T.Group();
      const r = Math.max(0.25, it.w / 2);
      const H = 1.05;
      const top = mesh(new T.CylinderGeometry(r, r, 0.05, 24), M.cloth);
      top.position.y = H;
      g.add(top);
      const rim = mesh(new T.TorusGeometry(r, 0.012, 6, 26), M.gilt);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = H + 0.026;
      g.add(rim);
      const drape = mesh(new T.CylinderGeometry(r * 0.92, r * 0.62, H, 20, 1, true), M.cloth);
      drape.position.y = H / 2;
      g.add(drape);
      // A couple of glasses left on it, because a poseur always has some.
      [[-0.13, 0.08], [0.11, -0.09]].forEach(([dx, dz]) => {
        const glass = mesh(new T.CylinderGeometry(0.03, 0.022, 0.13, 10), M.glass, false);
        glass.position.set(dx, H + 0.09, dz);
        g.add(glass);
      });
      // Stools, when the plan gives it seats.
      if (it.seats) ringChairs(g, r, Math.min(it.seats, 4), it.chair || "stool");
      return g;
    },

    buffet(it) {
      const g = new T.Group();
      g.add(counter(it.w, it.h, 0.9));
      // Chafing dishes down the line, with plates and serving tongs at the
      // head of it — a serving line as a guest meets it.
      const n = Math.max(1, Math.floor(it.w / 0.85));
      const span = it.w - 0.7;
      for (let i = 0; i < n; i++) {
        const x = (n === 1 ? 0 : (i / (n - 1) - 0.5) * span);
        const dish = chafingDish(Math.min(1, it.h / 0.8));
        dish.position.set(x, 0.95, 0);
        g.add(dish);
      }
      // Plates stacked at the near end — where the queue starts.
      const plates = plateStack(7, 1);
      plates.position.set(-it.w / 2 + 0.24, 0.95, it.h * 0.12);
      g.add(plates);
      // A cutlery caddy at the far end, where the queue leaves.
      const caddy = mesh(new T.BoxGeometry(0.2, 0.12, 0.16), M.steel);
      caddy.position.set(it.w / 2 - 0.2, 1.01, it.h * 0.1);
      g.add(caddy);
      for (let i = 0; i < 3; i++) {
        const fork = mesh(new T.BoxGeometry(0.014, 0.14, 0.014), M.steel, false);
        fork.position.set(it.w / 2 - 0.24 + i * 0.04, 1.11, it.h * 0.1);
        g.add(fork);
      }
      return g;
    },

    /* A dessert table: a tiered stand, a cake, small plates. Lower and
       shorter than a buffet, because it is a display rather than a line. */
    dessert(it) {
      const g = new T.Group();
      g.add(counter(it.w, it.h, 0.85, M.gilt));
      const top = 0.9;
      // A three-tier stand at the centre.
      const stand = new T.Group();
      [[0.24, 0], [0.18, 0.22], [0.12, 0.42]].forEach(([r, y]) => {
        const tier = mesh(new T.CylinderGeometry(r, r, 0.02, 20), M.cloth);
        tier.position.y = y;
        stand.add(tier);
        // A ring of small cakes on each tier.
        const count = Math.max(4, Math.round(r * 22));
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const cake = mesh(new T.CylinderGeometry(0.026, 0.03, 0.045, 8), M.wine, false);
          cake.position.set(Math.cos(a) * (r - 0.05), y + 0.033, Math.sin(a) * (r - 0.05));
          stand.add(cake);
        }
      });
      const post = mesh(new T.CylinderGeometry(0.014, 0.014, 0.44, 8), M.gilt);
      post.position.y = 0.22;
      stand.add(post);
      stand.position.y = top;
      g.add(stand);
      // Small plates each side.
      [-1, 1].forEach((s) => {
        const p = plateStack(5, 0.8);
        p.position.set(s * (it.w / 2 - 0.25), top, 0);
        g.add(p);
      });
      return g;
    },

    /* A beverage station: dispensers and cups on a skirted counter. Also
       serves the coffee station — the same furniture, and the catalogue
       points both at this builder. */
    beverage(it) {
      const g = new T.Group();
      g.add(counter(it.w, it.h, 0.92, M.steel));
      const top = 0.97;
      const n = Math.max(1, Math.min(3, Math.floor(it.w / 0.55)));
      for (let i = 0; i < n; i++) {
        const x = (n === 1 ? -it.w * 0.15 : (i / (n - 1) - 0.5) * (it.w - 0.5));
        const d = dispenser(1);
        d.position.set(x, top, -it.h * 0.08);
        g.add(d);
      }
      const cups = cupRow(5, 1);
      cups.position.set(it.w / 2 - 0.28, top, it.h * 0.16);
      g.add(cups);
      return g;
    },

    /* A service or registration table: a plain skirted counter with the
       things staff keep on it. Kept deliberately sparse — this is back-of-
       house furniture, and dressing it would make it read as a buffet. */
    service(it) {
      const g = new T.Group();
      g.add(counter(it.w, it.h, 0.85));
      const top = 0.9;
      const plates = plateStack(5, 0.9);
      plates.position.set(-it.w * 0.25, top, 0);
      g.add(plates);
      // A tray and a folded cloth at the other end.
      const tray = mesh(new T.BoxGeometry(Math.min(0.44, it.w * 0.4), 0.03, Math.min(0.3, it.h * 0.6)), M.steel);
      tray.position.set(it.w * 0.22, top + 0.015, 0);
      g.add(tray);
      return g;
    },

    /* A waste station: a lidded bin beside a recycling bin, which is what a
       catering floor actually needs and what a plan usually forgets. */
    trash(it) {
      const g = new T.Group();
      const bins = it.w >= 0.7 ? 2 : 1;
      for (let i = 0; i < bins; i++) {
        const x = bins === 1 ? 0 : (i - 0.5) * Math.min(0.42, it.w / 2);
        const body = mesh(new T.CylinderGeometry(0.17, 0.15, 0.72, 14), i ? M.olive : M.matte);
        body.position.set(x, 0.36, 0);
        g.add(body);
        const lid = mesh(new T.CylinderGeometry(0.185, 0.175, 0.05, 14), M.matte);
        lid.position.set(x, 0.745, 0);
        g.add(lid);
        // The swing flap, so it reads as a bin and not as a drum.
        const slot = mesh(new T.BoxGeometry(0.2, 0.012, 0.12), M.dark, false);
        slot.position.set(x, 0.772, 0);
        g.add(slot);
      }
      return g;
    },

    stage(it) {
      const g = new T.Group();
      const deck = mesh(new T.BoxGeometry(it.w, 0.4, it.h), M.wood);
      deck.position.y = 0.2;
      g.add(deck);
      const face = mesh(new T.BoxGeometry(it.w, 0.4, 0.04), M.gilt);
      face.position.set(0, 0.2, it.h / 2 + 0.02);
      g.add(face);
      // The draped backdrop behind the deck, gathered into folds.
      const folds = Math.max(6, Math.round(it.w * 2));
      for (let i = 0; i < folds; i++) {
        const x = (i / (folds - 1) - 0.5) * it.w;
        const drape = mesh(new T.CylinderGeometry(0.09, 0.09, 3.4, 8, 1, false, 0, Math.PI), M.cloth);
        drape.position.set(x, 1.7, -it.h / 2 + 0.1);
        drape.rotation.y = Math.PI;
        g.add(drape);
      }
      const pelmet = mesh(new T.BoxGeometry(it.w + 0.2, 0.24, 0.24), M.gilt);
      pelmet.position.set(0, 3.5, -it.h / 2 + 0.1);
      g.add(pelmet);
      // Two steps at the front, where the couple walks up.
      [0.13, 0.26].forEach((y, i) => {
        const st = mesh(new T.BoxGeometry(Math.min(2.2, it.w * 0.4), 0.13, 0.34), M.wood);
        st.position.set(0, y - 0.065, it.h / 2 + 0.17 + (1 - i) * 0.34);
        g.add(st);
      });
      return g;
    },

    dance(it) {
      const g = new T.Group();
      // Parquet: a checker of two woods, laid a metre square, sitting just
      // proud of the floor so it reads as a laid surface.
      const cols = Math.max(1, Math.round(it.w));
      const rows = Math.max(1, Math.round(it.h));
      const cw = it.w / cols, ch = it.h / rows;
      const tile = new T.BoxGeometry(cw * 0.97, 0.05, ch * 0.97);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const m = mesh(tile, (i + j) % 2 ? M.wood : M.gold, false);
          m.receiveShadow = true;
          m.position.set((i + 0.5) * cw - it.w / 2, 0.025, (j + 0.5) * ch - it.h / 2);
          g.add(m);
        }
      }
      return g;
    },

    bar(it) {
      const g = new T.Group();
      const body = mesh(new T.BoxGeometry(it.w, 1.1, it.h), M.wine);
      body.position.y = 0.55;
      g.add(body);
      const top = mesh(new T.BoxGeometry(it.w + 0.1, 0.07, it.h + 0.1), M.wood);
      top.position.y = 1.13;
      g.add(top);
      // Bottles on the back edge.
      const n = Math.max(2, Math.floor(it.w / 0.35));
      for (let i = 0; i < n; i++) {
        const b = mesh(new T.CylinderGeometry(0.045, 0.05, 0.3, 8), M.olive);
        b.position.set((i / (n - 1) - 0.5) * (it.w - 0.3), 1.31, -it.h / 4);
        g.add(b);
      }
      return g;
    },

    decor(it) {
      const g = new T.Group();
      const r = it.w / 2;
      const pot = mesh(new T.CylinderGeometry(r * 0.8, r * 0.6, 0.45, 14), M.gilt);
      pot.position.y = 0.225;
      g.add(pot);
      const foliage = mesh(new T.SphereGeometry(Math.max(0.3, r * 1.15), 14, 10), M.leaf);
      foliage.position.y = 0.45 + r * 0.9;
      foliage.scale.y = 1.25;
      g.add(foliage);
      return g;
    },

    /* A DJ booth: a skirted desk with a controller and two monitors on it,
       and a pair of small speakers facing the room. */
    dj(it) {
      const g = new T.Group();
      const H = 0.95;
      const desk = mesh(new T.BoxGeometry(it.w, H, it.h), M.matte);
      desk.position.y = H / 2;
      g.add(desk);
      const face = mesh(new T.BoxGeometry(it.w + 0.04, 0.34, 0.02), M.gilt);
      face.position.set(0, H - 0.2, it.h / 2 + 0.02);
      g.add(face);
      // The controller.
      const deck = mesh(new T.BoxGeometry(Math.min(0.7, it.w * 0.55), 0.06, Math.min(0.36, it.h * 0.6)), M.dark);
      deck.position.set(0, H + 0.03, 0);
      g.add(deck);
      [-0.19, 0.19].forEach((x) => {
        const jog = mesh(new T.CylinderGeometry(0.09, 0.09, 0.02, 16), M.steel);
        jog.position.set(x, H + 0.07, 0);
        g.add(jog);
      });
      // Two small monitors angled up at the operator.
      [-1, 1].forEach((s) => {
        const scr = mesh(new T.BoxGeometry(0.3, 0.19, 0.02), M.screen, false);
        scr.position.set(s * it.w * 0.3, H + 0.18, -it.h * 0.24);
        scr.rotation.x = 0.32;
        g.add(scr);
      });
      return g;
    },

    /* A speaker on a pole stand — the shape that says "PA" from across a
       room. Tilted down at the crowd, as one is actually flown. */
    speaker(it) {
      const g = new T.Group();
      const H = 1.55;
      // The tripod.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = mesh(new T.CylinderGeometry(0.014, 0.018, 0.62, 6), M.matte);
        leg.position.set(Math.cos(a) * 0.16, 0.3, Math.sin(a) * 0.16);
        leg.rotation.z = -Math.cos(a) * 0.45;
        leg.rotation.x = Math.sin(a) * 0.45;
        g.add(leg);
      }
      const pole = mesh(new T.CylinderGeometry(0.022, 0.026, H, 8), M.matte);
      pole.position.y = H / 2;
      g.add(pole);
      const box = mesh(new T.BoxGeometry(0.3, 0.5, 0.28), M.matte);
      box.position.y = H + 0.2;
      box.rotation.x = 0.16;
      g.add(box);
      // The driver and the horn, so the cabinet has a front.
      const driver = mesh(new T.CylinderGeometry(0.1, 0.1, 0.02, 16), M.dark, false);
      driver.rotation.x = Math.PI / 2 + 0.16;
      driver.position.set(0, H + 0.14, 0.144);
      g.add(driver);
      const horn = mesh(new T.BoxGeometry(0.18, 0.07, 0.02), M.dark, false);
      horn.position.set(0, H + 0.36, 0.15);
      horn.rotation.x = 0.16;
      g.add(horn);
      return g;
    },

    /* An LED wall: a dark panel on a truss frame, with an emissive face so
       it reads as switched on. Height comes from the catalogue's `top`, and
       the plan's depth is the frame's footprint. */
    screen(it) {
      const g = new T.Group();
      const H = 2.2, base = 0.35;
      const panel = mesh(new T.BoxGeometry(it.w, H, Math.max(0.08, it.h * 0.4)), M.matte);
      panel.position.y = base + H / 2;
      g.add(panel);
      const face = mesh(new T.PlaneGeometry(it.w - 0.1, H - 0.1), M.screen, false);
      face.position.set(0, base + H / 2, Math.max(0.08, it.h * 0.4) / 2 + 0.006);
      g.add(face);
      // The truss legs.
      [-1, 1].forEach((s) => {
        const leg = mesh(new T.BoxGeometry(0.09, base, 0.09), M.matte);
        leg.position.set(s * (it.w / 2 - 0.12), base / 2, 0);
        g.add(leg);
        const foot = mesh(new T.BoxGeometry(0.36, 0.04, Math.max(0.4, it.h)), M.matte);
        foot.position.set(s * (it.w / 2 - 0.12), 0.02, 0);
        g.add(foot);
      });
      return g;
    },

    /* A photo booth: a draped backdrop on a frame with a camera on a stand
       in front of it, and a small prop table. */
    photo(it) {
      const g = new T.Group();
      const H = 2.1;
      // The backdrop.
      const cloth = mesh(new T.BoxGeometry(it.w, H, 0.06), M.wine);
      cloth.position.set(0, H / 2, -it.h / 2 + 0.05);
      g.add(cloth);
      [-1, 1].forEach((s) => {
        const post = mesh(new T.CylinderGeometry(0.03, 0.035, H + 0.1, 8), M.matte);
        post.position.set(s * it.w / 2, (H + 0.1) / 2, -it.h / 2 + 0.05);
        g.add(post);
      });
      const bar = mesh(new T.CylinderGeometry(0.025, 0.025, it.w, 8), M.matte);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, H + 0.08, -it.h / 2 + 0.05);
      g.add(bar);
      // A gilt arch of blooms over it — what a booth is actually dressed with.
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const bloom = mesh(new T.SphereGeometry(0.075, 8, 6), i % 2 ? M.leaf : M.gilt, false);
        bloom.position.set((t - 0.5) * it.w * 0.94,
                           H + 0.05 + Math.sin(t * Math.PI) * 0.14,
                           -it.h / 2 + 0.11);
        g.add(bloom);
      }
      // The camera on its tripod, facing the backdrop.
      const pole = mesh(new T.CylinderGeometry(0.02, 0.026, 1.35, 8), M.matte);
      pole.position.set(0, 0.675, it.h / 2 - 0.2);
      g.add(pole);
      const cam = mesh(new T.BoxGeometry(0.22, 0.15, 0.16), M.matte);
      cam.position.set(0, 1.42, it.h / 2 - 0.2);
      g.add(cam);
      const lens = mesh(new T.CylinderGeometry(0.055, 0.06, 0.1, 12), M.dark);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 1.42, it.h / 2 - 0.29);
      g.add(lens);
      return g;
    },

    /* An emergency exit. The same clear opening a doorway is — a hole is a
       hole — but marked: a green running-man sign over the head, which is
       exactly how it is found in a room, and the only reason to draw it
       differently from any other door. */
    exit(it) {
      const g = BUILD.door(it);
      const H = 2.1;
      const board = mesh(new T.BoxGeometry(Math.min(0.42, it.w * 0.5), 0.16, 0.03), M.leaf, false);
      board.position.set(0, H + 0.24, 0);
      g.add(board);
      // The pictogram, blocked in rather than drawn: a pale figure and an
      // arrow on the green ground, legible at walking distance.
      const figure = mesh(new T.BoxGeometry(0.05, 0.1, 0.008), M.cloth, false);
      figure.position.set(-0.08, H + 0.24, 0.018);
      g.add(figure);
      const arrow = mesh(new T.BoxGeometry(0.12, 0.03, 0.008), M.cloth, false);
      arrow.position.set(0.06, H + 0.24, 0.018);
      g.add(arrow);
      return g;
    },

    /* A doorway is a HOLE, not an object: a frame and a threshold, with the
       opening left clear so the walkthrough can walk through it. It carries no
       leaf — an open door is what a guest meets on the night, and a closed one
       drawn here would only read as a wall. */
    door(it) {
      const g = new T.Group();
      const H = 2.1, JAMB = 0.09;
      const jamb = (sx) => {
        const m = mesh(new T.BoxGeometry(JAMB, H, Math.max(0.12, it.h)), M.wood);
        m.position.set(sx * (it.w / 2 - JAMB / 2), H / 2, 0);
        g.add(m);
      };
      jamb(-1); jamb(1);
      const head = mesh(new T.BoxGeometry(it.w, 0.12, Math.max(0.12, it.h)), M.wood);
      head.position.y = H + 0.06;
      g.add(head);
      const sill = mesh(new T.BoxGeometry(it.w, 0.02, Math.max(0.12, it.h)), M.gilt, false);
      sill.position.y = 0.01;
      g.add(sill);
      return g;
    },

    // The start point is a position, never a prop. Nothing is built for it —
    // rendering a marker would put a floating disc in the middle of a
    // walkthrough whose whole purpose is to look like the real room.
    spawn() { return null; },

    other(it) {
      const g = new T.Group();
      const box = mesh(new T.BoxGeometry(it.w, 0.8, it.h), M.olive);
      box.position.y = 0.4;
      g.add(box);
      return g;
    },
  };

  /* ── Camera ───────────────────────────────────────────────────────────
     A preset is a direction and a fit factor. The distance is solved from the
     room's size and the camera's own field of view, so every room frames the
     same way whatever its dimensions. */
  function viewPose(name) {
    const v = VIEWS[name] || VIEWS.Perspective;
    const span = Math.max(room.w, room.h);
    const fov = camera.fov * Math.PI / 180;
    const dist = (span / 2) / Math.tan(fov / 2) / Math.max(0.35, v.fit);
    const dir = new T.Vector3(v.dir[0], v.dir[1], v.dir[2]).normalize();
    const look = new T.Vector3(0, span * v.tilt * 0.12, 0);
    return { pos: dir.multiplyScalar(dist).add(look), look };
  }

  function setView(name, immediate) {
    if (!camera) return;
    if (!VIEWS[name]) name = "Perspective";
    currentView = name;
    const pose = viewPose(name);
    if (immediate || prefersReducedMotion()) {
      camera.position.copy(pose.pos);
      target.copy(pose.look);
      camera.lookAt(target);
      ease = null;
    } else {
      ease = {
        fromPos: camera.position.clone(), toPos: pose.pos,
        fromLook: target.clone(), toLook: pose.look,
        t0: performance.now(), dur: 560,
      };
    }
    needsDraw = true;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* Orbit: drag to swing around the room, wheel to pull in and out. Deliberately
     minimal — no OrbitControls dependency, because the whole interaction is
     "look at it from over there", and pitch is clamped so the camera can never
     end up under the floor looking up through it. */
  function wireOrbit() {
    const el = renderer.domElement;
    let drag = null;

    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      const off = camera.position.clone().sub(target);
      drag = {
        x: e.clientX, y: e.clientY,
        radius: off.length(),
        theta: Math.atan2(off.x, off.z),
        phi: Math.acos(Math.min(1, Math.max(-1, off.y / off.length()))),
      };
      el.classList.add("is-orbiting");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag) return;
      ease = null; // the hand wins over an in-flight glide
      const dx = (e.clientX - drag.x) / el.clientWidth;
      const dy = (e.clientY - drag.y) / el.clientHeight;
      const theta = drag.theta - dx * Math.PI * 2;
      const phi = Math.min(Math.PI / 2 - 0.04, Math.max(0.08, drag.phi + dy * Math.PI));
      camera.position.set(
        target.x + drag.radius * Math.sin(phi) * Math.sin(theta),
        target.y + drag.radius * Math.cos(phi),
        target.z + drag.radius * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
      needsDraw = true;
    });
    const end = (e) => {
      if (!drag) return;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      drag = null;
      el.classList.remove("is-orbiting");
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);

    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      ease = null;
      const off = camera.position.clone().sub(target);
      const span = Math.max(room.w, room.h);
      const len = Math.min(span * 3.5, Math.max(span * 0.25, off.length() * (1 + Math.sign(e.deltaY) * 0.12)));
      camera.position.copy(target).add(off.setLength(len));
      camera.lookAt(target);
      needsDraw = true;
    }, { passive: false });
  }

  /* ── Loop ─────────────────────────────────────────────────────────────
     Draws only when something moved. A floor plan is a still image most of
     the time, and a idle 60 fps loop on an admin page is a laptop fan. */
  function loop() {
    raf = requestAnimationFrame(loop);
    if (ease) {
      const k = Math.min(1, (performance.now() - ease.t0) / ease.dur);
      const e = 1 - Math.pow(1 - k, 3); // ease-out cubic, matching --ease
      camera.position.lerpVectors(ease.fromPos, ease.toPos, e);
      target.lerpVectors(ease.fromLook, ease.toLook, e);
      camera.lookAt(target);
      if (k >= 1) ease = null;
      needsDraw = true;
    }
    if (!needsDraw) return;
    needsDraw = false;
    renderer.render(scene, camera);
  }

  function resize() {
    if (!renderer || !host) return;
    const w = Math.max(240, host.clientWidth);
    const h = Math.max(240, host.clientHeight || Math.round(w * 0.62));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    needsDraw = true;
  }

  /* ── Filmstrip thumbnails ─────────────────────────────────────────────
     Each preset rendered once at thumbnail size off the same scene, then the
     camera put back where it was. `preserveDrawingBuffer` on the renderer is
     what makes toDataURL legal here. */
  function thumbnails() {
    if (!renderer) return {};
    const out = {};
    const savedPos = camera.position.clone();
    const savedTarget = target.clone();
    const savedAspect = camera.aspect;
    const size = renderer.getSize(new T.Vector2());

    renderer.setSize(224, 140, false);
    camera.aspect = 224 / 140;
    VIEW_NAMES.forEach((name) => {
      const pose = viewPose(name);
      camera.position.copy(pose.pos);
      camera.lookAt(pose.look);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      out[name] = renderer.domElement.toDataURL("image/jpeg", 0.72);
    });

    renderer.setSize(size.x, size.y, false);
    camera.aspect = savedAspect;
    camera.position.copy(savedPos);
    target.copy(savedTarget);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    needsDraw = true;
    return out;
  }

  /* Repaint the whole model in the current STYLESHEET's tokens — the portal's
     dark variant swaps them under us, and a light-paper room on a dark page
     is a hole in the sheet.

     The setup's dressing is re-applied on top afterwards, never dropped: a
     designer who flips the portal to dark mode is changing the paper the plan
     is drawn on, not the linen the couple chose. */
  function refreshTheme(layout) {
    if (!renderer) return;
    readPalette();
    scene.background = C.bg;
    if (scene.fog) scene.fog.color = C.bg;
    M.floor.color = C.floor; M.wall.color = C.wall; M.cloth.color = C.cloth;
    M.wood.color = C.wood; M.gold.color = C.gold; M.gilt.color = C.gilt;
    M.olive.color = C.olive; M.wine.color = C.danger; M.leaf.color = C.leaf;
    M.dark.color = C.ink;
    applyTheme();
    if (layout) render(layout);
    needsDraw = true;
  }

  /* ── Wearing a setup ──────────────────────────────────────────────────
     Applied to the shared MATERIALS, not to the meshes: every tablecloth in
     the room is one `M.cloth`, so re-dressing forty tables is four colour
     writes and no rebuild. That is also why the walkthrough picks the change
     up for free — it renders the same materials this module owns. */
  function applyTheme() {
    if (!M) return;
    DRESSED.forEach((name) => {
      const col = themeColor(name);
      if (col && M[name]) {
        M[name].color.copy(col);
        M[name].needsUpdate = true;
      }
    });
    if (roomGroup && roomGroup.children.length) buildRoom();
    if (itemGroup && itemGroup.children.length && lastItems.length) buildItems(lastItems);
    needsDraw = true;
  }

  /* Dress the room in a setup's scheme, or hand back the house's own with
     null. Takes the theme object js/theme.js extracts; stores it so a later
     stylesheet change (dark mode) can re-apply it rather than losing it. */
  function setTheme(next) {
    theme = next || null;
    if (!M) { readPalette(); buildMaterials(); }
    if (!theme) {
      readPalette();
      M.cloth.color.copy(C.cloth); M.gold.color.copy(C.gold); M.gilt.color.copy(C.gilt);
      M.leaf.color.copy(C.leaf); M.wine.color.copy(C.danger);
      M.wall.color.copy(C.wall); M.floor.color.copy(C.floor);
      Object.keys(M).forEach((k) => { if (M[k]) M[k].needsUpdate = true; });
      if (roomGroup && roomGroup.children.length) buildRoom();
      if (itemGroup && itemGroup.children.length && lastItems.length) buildItems(lastItems);
      needsDraw = true;
      return theme;
    }
    applyTheme();
    return theme;
  }

  function dispose() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (roomGroup) clearGroup(roomGroup);
    if (itemGroup) clearGroup(itemGroup);
    disposables.forEach((d) => { if (d && d.dispose) d.dispose(); });
    disposables.length = 0;
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    renderer = scene = camera = host = null;
  }

  /* ── Shared with the walkthrough (js/simulate.js) ─────────────────────
     Simulation Mode is a different camera on the SAME model, not a second
     model. It borrows the geometry factory, the palette reader and the
     coordinate conversion from here, so a chair is built by one function in
     one file and a table's world position is computed by one formula — which
     is what stops the preview and the walkthrough from ever disagreeing about
     where anything stands.

     `buildFor` takes an explicit room rather than reading this module's, so
     the walkthrough can build its own scene without disturbing the preview's
     (the two can be alive at once — the preview is still mounted behind the
     simulation overlay). */
  function buildFor(roomDims, rawItems) {
    if (!available()) return null;
    if (!M) { readPalette(); buildMaterials(); }
    const prev = room;
    room = { w: Math.max(2, Number(roomDims.w) || 24), h: Math.max(2, Number(roomDims.h) || 18) };
    const g = new T.Group();
    (rawItems || []).forEach((raw) => {
      const it = normalise(raw);
      const make = builderFor(it.kind);
      const built = make && make(it);
      if (!built) return;
      built.position.set(toWorldX(it.x + it.w / 2), 0, toWorldZ(it.y + it.h / 2));
      built.rotation.y = -it.rot * Math.PI / 180;
      // The source item rides along, so the walkthrough's proximity panel can
      // name what the player is standing next to without a parallel lookup.
      built.userData.item = raw;
      g.add(built);
    });
    room = prev;
    return g;
  }

  /* The same wall/floor shell the preview draws, built against a given room —
     but closed on all four sides, because a walkthrough with a missing wall is
     a room you can walk out of. Doorways are cut from the SAME buildOpenings()
     the collision system reads, so every hole you can see is one you can pass
     and every wall you can see stops you. */
  function shellFor(roomDims, items, opts) {
    if (!available()) return null;
    if (!M) { readPalette(); buildMaterials(); }
    const o = opts || {};
    const prev = room, prevGroup = roomGroup, prevOpen = openings, prevClose = closeRoom;
    room = { w: Math.max(2, Number(roomDims.w) || 24), h: Math.max(2, Number(roomDims.h) || 18) };
    openings = buildOpenings(items || [], room);
    closeRoom = o.closed !== false;
    roomGroup = new T.Group();
    buildRoom();
    if (o.ceiling) addCeiling(roomGroup, room);
    const g = roomGroup;
    room = prev; roomGroup = prevGroup; openings = prevOpen; closeRoom = prevClose;
    return g;
  }

  /* ── The analysis overlay ─────────────────────────────────────────────
     ANALYZE mode (brief §16), drawn on the floor of whichever scene asks for
     it — the preview or the walkthrough, both, or neither.

     Two layers:

       · the WALKABILITY HEATMAP — one quad per grid cell, coloured by the
         width of floor actually available there. The widths come from
         nav.widthField(), measured by walking rays across the real grid, so
         a red patch is a place the simulator would genuinely refuse to let a
         body through. It is not a painted-on decoration, which §8 explicitly
         rules out.

       · the ISSUE MARKERS — a ring on the floor under every finding the
         report produced, in the severity's own colour, so a warning in the
         list has a place in the room.

     Drawn as ONE merged geometry per layer rather than a mesh per cell: a
     24 × 18 m room at half-metre sampling is 1700 quads, and 1700 draw calls
     would cost more than the analysis it is showing. */
  let overlayGroup = null;

  function buildHeatGeometry(field, grid, cell) {
    const RU = window.HPRules;
    const positions = [];
    const colours = [];
    const col = new T.Color();
    const half = cell / 2;
    for (let j = 0; j < grid.rows; j++) {
      for (let i = 0; i < grid.cols; i++) {
        const idx = j * grid.cols + i;
        if (!grid.walk[idx]) continue;
        const width = field[idx];
        const band = RU ? RU.bandFor(width) : { colour: 0x5C9A3F };
        col.setHex(band.colour);
        const p = grid.toPoint(i, j);
        const x = p.x - room.w / 2, z = p.y - room.h / 2;
        // Two triangles per cell, wound so the quad faces up.
        const quad = [
          [x - half, z - half], [x + half, z - half], [x + half, z + half],
          [x - half, z - half], [x + half, z + half], [x - half, z + half],
        ];
        quad.forEach(([qx, qz]) => {
          positions.push(qx, 0, qz);
          colours.push(col.r, col.g, col.b);
        });
      }
    }
    if (!positions.length) return null;
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
    return geo;
  }

  /* Show the analysis. `report` is whatever js/walkability.js returned, with
     `heat` present when the caller asked for it. Passing null clears. */
  function showAnalysis(report, opts) {
    clearAnalysis();
    if (!report || !scene) { needsDraw = true; return; }
    const o = opts || {};
    overlayGroup = new T.Group();
    overlayGroup.name = "hp-analysis";

    if (report.heat && report.heat.field && report.heat.grid) {
      const grid = report.heat.grid;
      const geo = buildHeatGeometry(report.heat.field, grid, grid.cell);
      if (geo) {
        const mat = new T.MeshBasicMaterial({
          vertexColors: true, transparent: true,
          opacity: o.heatOpacity != null ? o.heatOpacity : 0.42,
          depthWrite: false, side: T.DoubleSide,
        });
        const heat = new T.Mesh(geo, mat);
        // Just clear of the floor and of the metre grid ruled on it.
        heat.position.y = 0.012;
        heat.renderOrder = 2;
        overlayGroup.add(heat);
      }
    }

    // A ring under every finding that has a place in the room.
    const SEV = { high: 0xC0392B, medium: 0xE0A526, low: 0x8A8F6A };
    (report.findings || []).forEach((f) => {
      const at = f.at;
      if (!at) return;
      const colour = SEV[f.severity] || SEV.low;
      const ring = new T.Mesh(
        new T.RingGeometry(0.5, 0.72, 28),
        new T.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.85,
                                  side: T.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(at.x - room.w / 2, 0.02, at.y - room.h / 2);
      ring.renderOrder = 3;
      ring.userData.finding = f.id;
      overlayGroup.add(ring);
      // A short post, so a marker on a crowded floor is visible from a low
      // camera as well as from above.
      const post = new T.Mesh(
        new T.CylinderGeometry(0.028, 0.028, 1.5, 6),
        new T.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55, depthWrite: false }));
      post.position.set(at.x - room.w / 2, 0.75, at.y - room.h / 2);
      post.renderOrder = 3;
      overlayGroup.add(post);
    });

    // Congestion, as a filled disc rather than a ring — it is an AREA, and
    // drawing it as a point would understate what the report measured.
    (report.congestion || []).forEach((h) => {
      if (h.level === "fair") return;
      const r = Math.max(0.6, Math.sqrt(h.area / Math.PI));
      const disc = new T.Mesh(
        new T.CircleGeometry(r, 30),
        new T.MeshBasicMaterial({
          color: h.level === "critical" ? 0xC0392B : 0xE0A526,
          transparent: true, opacity: 0.3, depthWrite: false, side: T.DoubleSide }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(h.x - room.w / 2, 0.016, h.y - room.h / 2);
      disc.renderOrder = 2;
      overlayGroup.add(disc);
    });

    scene.add(overlayGroup);
    needsDraw = true;
  }

  function clearAnalysis() {
    if (!overlayGroup) return;
    overlayGroup.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
    });
    if (overlayGroup.parent) overlayGroup.parent.remove(overlayGroup);
    overlayGroup = null;
    needsDraw = true;
  }

  /* Glide the camera to a place on the floor — how clicking an issue in the
     report gets the designer looking at it (brief §16). Plan metres in,
     because that is the space every finding is expressed in. */
  function focusOn(planX, planY, opts) {
    if (!camera) return;
    const o = opts || {};
    const look = new T.Vector3(planX - room.w / 2, o.height || 0.9, planY - room.h / 2);
    const dist = o.distance || Math.min(9, Math.max(room.w, room.h) * 0.45);
    // Approached from above and to one side, so the marker isn't hidden by
    // whatever is standing next to it.
    const pos = look.clone().add(new T.Vector3(dist * 0.55, dist * 0.72, dist * 0.62));
    if (prefersReducedMotion()) {
      camera.position.copy(pos);
      target.copy(look);
      camera.lookAt(target);
      ease = null;
    } else {
      ease = {
        fromPos: camera.position.clone(), toPos: pos,
        fromLook: target.clone(), toLook: look,
        t0: performance.now(), dur: 620,
      };
    }
    needsDraw = true;
  }

  /* A ceiling for the walkthrough only. The preview must never have one — it
     looks down into the room, and a lid would show it an empty rectangle. */
  function addCeiling(group, dims) {
    const ceil = new T.Mesh(new T.PlaneGeometry(dims.w, dims.h), M.wall);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = WALL_H;
    group.add(ceil);
    // A run of warm downlights, so the room is lit from where a room is lit.
    const cols = Math.max(2, Math.round(dims.w / 6));
    const rows = Math.max(2, Math.round(dims.h / 6));
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = (i + 0.5) * (dims.w / cols) - dims.w / 2;
        const z = (j + 0.5) * (dims.h / rows) - dims.h / 2;
        const fitting = new T.Mesh(new T.CylinderGeometry(0.17, 0.2, 0.06, 12), M.gilt);
        fitting.position.set(x, WALL_H - 0.06, z);
        group.add(fitting);
      }
    }
  }

  return {
    available,
    mount,
    render,
    setView,
    resize,
    thumbnails,
    refreshTheme,
    setTheme,
    get theme() { return theme; },
    dispose,
    views: VIEW_NAMES,
    get view() { return currentView; },

    // ANALYZE mode — the heatmap and the issue markers.
    showAnalysis,
    clearAnalysis,
    focusOn,

    // Shared factory — see the note above.
    buildFor,
    shellFor,
    buildOpenings,
    chair,
    // The plan→world conversion, exported so the walkthrough places its player
    // with the SAME formula the geometry is placed by. A second copy of this
    // arithmetic is exactly how a 2D plan and a 3D view start disagreeing.
    toWorld(x, y, dims) {
      const R = dims || room;
      return { x: x - R.w / 2, z: y - R.h / 2 };
    },
    DOOR_H,
    WALL_H,
    materials() { if (!M) { readPalette(); buildMaterials(); } return M; },
    palette() { if (!C.floor) readPalette(); return C; },
    THREE: T,
  };
})();
