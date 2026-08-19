/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — SIMULATION MODE.

   Walk the room before the room exists. The designer draws a floor plan on
   the 2D sheet; this stands the plan up at full size and puts the designer
   inside it at eye height, so "can a waiter get between those two tables"
   is answered by walking it rather than by squinting at a diagram.

   ── One source of truth ─────────────────────────────────────────────────
   This module owns NO layout data. It is handed the same `{room, items}` the
   2D sheet is editing, and it builds its geometry with the SAME factory the
   3D preview uses (HPScene.buildFor / shellFor / buildOpenings). There is no
   simulation-side copy of a table's position that could drift from the plan's:
   move a table on the sheet, re-enter the simulation, and the table has
   moved. Exiting touches nothing — the editor is exactly as it was left.

   ── Collision ───────────────────────────────────────────────────────────
   Solids are derived from the plan, not from the meshes: each item becomes an
   oriented box in plan space, walls become the room's bounds, and doorways
   become gaps in those bounds — read from the same buildOpenings() that cut
   the holes you can see. Resolution is axis-separated so sliding along a
   table edge feels like sliding along a table edge rather than sticking.

   Public API (window.HPSim):
     available()               can this run?
     enter(layout, opts)       build and start the walkthrough
     exit()                    tear down, restore the page
     isRunning()
     setQuality(name)          LOW | MEDIUM | HIGH | ULTRA
     resetPosition()
     setView("fp"|"tp")        the eyes, or a boom behind an avatar
     view                      which of the two is running
   ════════════════════════════════════════════════════════════════ */
window.HPSim = (function () {
  "use strict";

  const S = window.HPScene;
  const T = window.THREE;
  const RU = window.HPRules;
  const available = () => !!(T && S && S.available());

  /* The crowd (js/crowd.js) is OPTIONAL: if the file didn't load, the
     walkthrough is the empty room it has always been rather than a broken
     one. Resolved on use, not at evaluation — script order between the two
     is a page's business, and a module that captured a missing neighbour at
     load time would stay broken for the life of the tab. */
  const crowd = () => {
    const c = window.HPCrowd;
    return c && c.available() ? c : null;
  };

  /* ── Human dimensions ─────────────────────────────────────────────────
     A walkthrough is only useful if the body doing the walking is the size of
     a body. These are the numbers everything else is measured against — eye
     height decides what reads as "over the table", and radius decides whether
     a 0.9 m gap feels like a gap. */
  /* Sourced from LAYOUT_RULES (js/rules.js) so the body the designer walks
     and the body the analysis measures clearances against are described by
     one set of numbers. The literals are the fallback for a page where that
     file failed to load — the walkthrough still runs, at the dimensions it
     always had. */
  const CAM = (RU && RU.CAMERA) || {};
  const EYE = CAM.eye || 1.68;          // eye height, metres — a standing adult
  const CROUCH_EYE = CAM.crouchEye || 1.05;
  const RADIUS = CAM.radius || 0.28;    // shoulder half-width for collision
  const WALK = CAM.walk || 1.45;        // m/s — an unhurried indoor pace
  const SPRINT = CAM.sprint || 3.1;
  const ACCEL = CAM.accel || 12;        // m/s² — how fast the pace is reached
  const FRICTION = CAM.friction || 11;
  const GRAVITY = CAM.gravity || 18;
  const JUMP = CAM.jump || 4.4;
  const STEP = CAM.step || 0.35;        // obstacles under this are stepped over
  const INTERACT_RANGE = CAM.interactRange || 2.4;

  /* ── Third person ─────────────────────────────────────────────────────
     The same walk, watched from behind. It answers a question first person
     cannot: how much room a BODY takes up. Standing in a 0.9 m gap at eye
     height feels fine; seeing your own shoulders in it is the honest read,
     and it is the view a designer instinctively wants when judging whether
     an aisle is an aisle.

     The camera rides a boom behind and above the avatar's shoulders. The
     offset is to the right so the body doesn't sit dead-centre hiding the
     thing being walked toward. */
  const BOOM = CAM.boom || 3.1;          // metres behind the avatar, at rest
  const BOOM_MIN = CAM.boomMin || 0.85;  // how close it may be pulled by a wall
  const BOOM_H = CAM.boomHeight || 1.62; // the pivot's height — the shoulders
  const BOOM_SIDE = CAM.boomSide || 0.42;// over-the-shoulder offset, metres
  const BOOM_EASE = CAM.boomEase || 9;   // how fast the boom springs back
  const CAM_R = CAM.camRadius || 0.22;   // the camera's own radius, for collision
  /* Third person is also an OBSERVATION view (brief §11): a designer
     reviewing a layout wants to pull the camera back and lift it, not just
     follow a body around. The boom's length and height are therefore
     adjustable at run time, within limits that keep it a walkthrough camera
     rather than an orbit control — the 3D tab already does orbiting. */
  const BOOM_RANGE = { min: 1.6, max: 9.0 };
  const BOOM_LIFT_RANGE = { min: 0, max: 6.0 };
  let boomWant = BOOM;       // the length the designer has asked for
  let boomLift = 0;          // extra height on the pivot — the elevated view

  const QUALITY = {
    LOW:    { shadows: false, shadowMap: 512,  pixelRatio: 1,   fov: 72, aa: false, fog: true },
    MEDIUM: { shadows: true,  shadowMap: 1024, pixelRatio: 1.25, fov: 72, aa: true,  fog: true },
    HIGH:   { shadows: true,  shadowMap: 2048, pixelRatio: 1.6, fov: 72, aa: true,  fog: true },
    ULTRA:  { shadows: true,  shadowMap: 4096, pixelRatio: 2,   fov: 70, aa: true,  fog: true },
  };
  const QUALITY_NAMES = Object.keys(QUALITY);

  // A sensible default for the machine we happen to be on. Guessing from core
  // count and DPR is crude, but it beats defaulting ULTRA onto a laptop and
  // handing the designer a slideshow the first time they press SIMULATE.
  function autoQuality() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    if (cores <= 2 || mem <= 2) return "LOW";
    if (cores <= 4 || mem <= 4) return "MEDIUM";
    return "HIGH";
  }

  /* ── State ────────────────────────────────────────────────────────────
     Deliberately flat and module-scoped: there is only ever one walkthrough
     on screen, and threading a context object through the input handlers
     would buy nothing but ceremony. */
  let running = false;
  let renderer = null, scene = null, camera = null;
  let host = null, overlay = null;
  let layout = null, room = { w: 24, h: 18 };
  let solids = [];           // AABB boxes in PLAN metres (from HPNav)
  let gaps = { north: [], south: [], east: [], west: [] };   // shell's axis
  let planGaps = { north: [], south: [], east: [], west: [] }; // plan's edges
  let navGrid = null;        // A* grid, built on first route request
  let quality = autoQuality();
  // How full the room is. HALF by default: an empty room flatters a plan,
  // and a packed one is the exception rather than the case to design for.
  let density = "HALF";
  /* Which lighting preset the room is under. Defaults to the event type's
     own — a wedding opens warm, a conference opens neutral — and is changed
     from the HUD without rebuilding anything. */
  let lighting = (RU && RU.DEFAULT_LIGHTING) || "WEDDING";
  let eventType = (RU && RU.DEFAULT_EVENT) || "wedding";
  /* ANALYZE mode: the report currently on screen, or null. Owned here rather
     than by the caller because the overlay, the status panel and the issue
     list are three views of one object and they must never disagree. */
  let report = null;
  let analyzing = false;
  /* "fp" — the camera IS the eyes. "tp" — the camera rides a boom behind an
     avatar. Both drive the SAME player body through the same collision; the
     only difference is where the camera sits and whether a body is drawn. */
  let view = "fp";
  let avatar = null;         // the third-person body, built on first use
  let boom = BOOM;           // the boom's live length, eased toward BOOM
  let avatarStep = 0;        // the avatar's gait phase, advanced by distance
  let raf = 0, last = 0;
  let onExitCb = null;
  let pax = 0;               // the booked headcount, for the capacity check
  let venueName = "";        // shown in the HUD's top-left
  let clockTimer = 0;        // the HUD clock's interval, cleared on exit

  // Vectors are created in placePlayer(), not here: this file must load even
  // when Three.js didn't, so available() can answer false instead of the
  // module throwing at evaluation.
  const player = {
    pos: null,
    vel: null,
    yaw: 0, pitch: 0,
    onGround: true,
    crouch: false,
    bob: 0,
    spawn: { x: 0, z: 0, yaw: 0 },
  };
  const keys = Object.create(null);

  /* ── Entering ─────────────────────────────────────────────────────────── */
  function enter(plan, opts) {
    if (!available()) return false;
    if (running) return true;
    const o = opts || {};
    onExitCb = o.onExit || null;
    layout = {
      room: { w: Math.max(2, Number(plan.room.w) || 24), h: Math.max(2, Number(plan.room.h) || 18) },
      items: (plan.items || []).slice(),
    };
    room = layout.room;
    if (o.quality && QUALITY[o.quality]) quality = o.quality;
    // The event this room is dressed for. It decides which lighting preset
    // the walkthrough opens under and which clearances the analysis works
    // to — both overridable from the HUD once inside.
    if (o.event && RU && RU.EVENT_TYPES[o.event]) {
      eventType = o.event;
      if (!o.lighting) lighting = RU.eventOf(eventType).lighting;
    }
    if (o.lighting && RU && RU.LIGHTING[o.lighting]) lighting = o.lighting;
    pax = Number(o.pax) || 0;
    venueName = String(o.title || "");

    buildOverlay();
    buildRenderer();
    buildScene();
    buildSolids();
    // People go in after the solids, because the crowd walks the same AABB
    // model the player is stopped by — handing them over rather than letting
    // it derive its own is what keeps one set of boxes in the room.
    populateCrowd();
    // The rigged Mixamo set loads in the background — populateCrowd() has
    // already filled the room with the procedural fallback by the time this
    // resolves, so the room is re-populated once to upgrade to the real
    // models rather than leaving guests fetched too late to use them. Only
    // if the walkthrough is still the one that asked — a quick exit before
    // the fetch lands must not repopulate a torn-down scene.
    if (window.HPModels && window.HPModels.available() && !window.HPModels.ready()) {
      window.HPModels.load().then((ok) => {
        if (ok && running) populateCrowd();
      });
    }
    placePlayer();
    // Third person survives a re-entry (a quality change tears the scene down
    // and builds it again): the view is remembered, so the body it needs has
    // to be rebuilt into the NEW scene rather than left on the old one.
    if (view === "tp") { buildAvatar(); boom = BOOM; }
    if (overlay) overlay.classList.toggle("is-third", view === "tp");
    bindInput();

    running = true;
    last = performance.now();
    loop();
    // The pointer is grabbed on the first click rather than immediately:
    // browsers refuse a pointer-lock request that isn't a direct response to
    // a gesture, and a refused request leaves the walkthrough looking frozen.
    return true;
  }

  function exit() {
    if (!running) return;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    unbindInput();
    if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
    const C = crowd();
    if (C) C.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

    if (scene) {
      scene.traverse((n) => {
        if (n.isMesh && n.geometry) n.geometry.dispose();
      });
    }
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.classList.remove("hp-sim-open");
    renderer = scene = camera = overlay = host = null;
    // The avatar's geometry was disposed with the rest of the scene above; the
    // reference must go too, or re-entering adds a body belonging to a scene
    // that no longer exists.
    avatar = null;
    boom = BOOM;
    boomWant = BOOM;
    boomLift = 0;
    solids = [];
    // The analysis belonged to a scene that no longer exists. Its overlay
    // went with the scene; the report goes here, so re-entering doesn't open
    // showing findings measured against the previous room.
    report = null;
    analyzing = false;
    routeLine = null;
    lights.hemi = lights.key = lights.ceiling = lights.ambient = null;
    lights.lamps = [];
    const cb = onExitCb;
    onExitCb = null;
    if (cb) cb();
  }

  /* ── The renderer ─────────────────────────────────────────────────────── */
  function buildRenderer() {
    const q = QUALITY[quality];
    renderer = new T.WebGLRenderer({ antialias: q.aa, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    if ("outputColorSpace" in renderer) renderer.outputColorSpace = T.SRGBColorSpace;
    /* Filmic tone mapping with the exposure pushed up. Without it the room is
       rendered linearly and clipped: the lit patches blow out while everything
       between the lamps falls away to black, which is exactly the picture a
       walkthrough must not give. ACES rolls the highlights off instead, so the
       exposure can be raised until the FLOOR of the room is legible without
       the tablecloths going to paper white. */
    if ("toneMapping" in renderer) {
      renderer.toneMapping = T.ACESFilmicToneMapping;
      const P = RU ? RU.lightingOf(lighting) : null;
      renderer.toneMappingExposure = exposureFor(S.theme, P ? P.exposure : null);
    }
    renderer.domElement.className = "hp-sim-canvas";
    host.appendChild(renderer.domElement);

    camera = new T.PerspectiveCamera(q.fov, 1, 0.05, 400);
    resize();
  }

  /* ── The scene ────────────────────────────────────────────────────────
     Built entirely from the shared factory. The only thing this module adds
     is the lighting rig and the closed shell, because a walkthrough needs a
     ceiling and a fourth wall that the top-down preview must not have. */
  function buildScene() {
    const C = S.palette();
    scene = new T.Scene();
    scene.background = C.bg;

    /* Fog, kept well back. The preview's fog exists to soften a far wall seen
       from outside the room; inside it, fog starting at 12 m sits between the
       walker and the far end of any hall bigger than a living room, and every
       surface past it is washed toward the page's own background — which in
       the portal's dark variant is nearly black. That is a fog bank, not a
       room. It now starts past the far wall and is skipped entirely in a
       small room, where nothing is ever far enough away to need it. */
    const span = Math.hypot(room.w, room.h);
    if (QUALITY[quality].fog && span > 26) {
      scene.fog = new T.Fog(C.bg, span * 0.75, span * 1.8);
    }

    // Walls, floor, doorway openings and ceiling — one call, same geometry
    // the preview draws, closed up for walking.
    const shell = S.shellFor(room, layout.items, { closed: true, ceiling: true });
    if (shell) scene.add(shell);

    // Every piece on the plan, placed by the shared conversion.
    const props = S.buildFor(room, layout.items);
    if (props) scene.add(props);

    buildLights();
  }

  /* Interior lighting: a broad warm ambient so nothing is pitch black, a
     soft key from above for shape, and point lights under the ceiling
     fittings the shell drew — lit from where the room is actually lit.

     ── Why the room must not be dim ────────────────────────────────────
     This is a WORKING view, not a mood board. A designer is here to judge
     whether an aisle is wide enough and whether the stage reads from the
     back of the room, and neither question survives a picture they have to
     squint at. A real function room at full house lights is BRIGHT; the rig
     below aims at that rather than at candlelight, and the setup's scheme
     tints it without ever being allowed to darken it (see gelFor). */
  /* ── Lighting presets ─────────────────────────────────────────────────
     Five rooms, one rig (brief §19). Each preset in LAYOUT_RULES describes a
     believable lighting state — the ambient nothing is darker than, the key
     that gives shape, what the ceiling fittings carry, and the exposure the
     whole thing is graded at. Changing preset re-aims THIS rig rather than
     rebuilding the scene, so the switch is instant and the walkthrough never
     stutters when a designer flicks between daylight and evening to check
     whether the stage still reads.

     What a preset may NOT do is turn the room into a colour. §19 is explicit
     about that, and it is also the practical point: a designer here is
     judging whether an aisle is wide enough, and that judgement does not
     survive a room bathed in magenta. Saturation is capped and lightness
     floored on every gel — see gelFor. */
  const lights = { hemi: null, key: null, lamps: [], ceiling: null, ambient: null };

  function buildLights() {
    const q = QUALITY[quality];
    const P = RU ? RU.lightingOf(lighting) : null;

    /* The ambient floor — enough that nothing is ever crushed to black, and
       no more. Pushed higher it flattens the room: every surface arrives at
       the same value and the shapes stop reading, which costs the designer
       the depth cue they judge distance by. The ground tone is warm rather
       than near-black, or every underside in the room reads as soot. */
    const amb = (P && P.ambient) || { sky: 0xfff4e0, ground: 0x6b5a42, intensity: 0.62 };
    lights.hemi = new T.HemisphereLight(amb.sky, amb.ground, amb.intensity);
    scene.add(lights.hemi);

    const keySpec = (P && P.key) || { colour: 0xfff0cf, intensity: 0.8, elevation: 0.7 };
    const key = new T.DirectionalLight(keySpec.colour, keySpec.intensity);
    const span = Math.max(room.w, room.h);
    key.position.set(-room.w * 0.4, span * keySpec.elevation, room.h * 0.4);
    if (q.shadows) {
      key.castShadow = true;
      key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      const r = Math.max(room.w, room.h) * 0.7;
      const c = key.shadow.camera;
      c.left = -r; c.right = r; c.top = r; c.bottom = -r;
      c.near = 0.5; c.far = span * 2 + 20;
      c.updateProjectionMatrix();
      key.shadow.bias = -0.0018;
      // A small normal bias on top of the depth bias: without it a soft PCF
      // shadow acnes on the curved surfaces — every tablecloth in the room.
      if ("normalBias" in key.shadow) key.shadow.normalBias = 0.02;
    }
    scene.add(key);
    lights.key = key;

    /* The wash on the walls. With a setup chosen, the room's uplighting is
       gelled to that scheme — it is the single biggest thing a photograph of
       a dressed room shows, and a warm-white walkthrough of a plan themed
       plum reads as the wrong room. The preset's own lamp colour is the base
       when no setup is chosen. */
    const lampSpec = (P && P.lamp) || { colour: 0xffe6b8, intensity: 1.5, distance: 22 };
    const lampColour = gelFor(S.theme, lampSpec.colour);

    /* Chandeliers on a grid. Their count is capped: a 24 × 18 m hall wants
       about a dozen, and every extra point light is another pass over every
       lit fragment — the cap is what keeps LOW playable on a laptop.

       LOW gets none, so it needs the loss made up in the ambient — otherwise
       turning the quality down turns the lights off, which is not what a
       quality setting means. */
    const budget = quality === "LOW" ? 0 : quality === "MEDIUM" ? 4 : quality === "HIGH" ? 8 : 12;
    lights.lamps = [];
    if (!budget) {
      lights.ambient = new T.AmbientLight(lampColour, 0.35);
      scene.add(lights.ambient);
    }

    const cols = Math.max(2, Math.round(room.w / 6));
    const rows = Math.max(2, Math.round(room.h / 6));
    let placed = 0;
    for (let i = 0; i < cols && placed < budget; i++) {
      for (let j = 0; j < rows && placed < budget; j++, placed++) {
        const x = (i + 0.5) * (room.w / cols) - room.w / 2;
        const z = (j + 0.5) * (room.h / rows) - room.h / 2;
        // Hung well clear of the ceiling. At 0.3 m a point light with decay 2
        // puts almost nothing on the plane above it, and the walkthrough's
        // ceiling came back black — a lid of shadow over a lit room.
        const lamp = new T.PointLight(lampColour, lampSpec.intensity, lampSpec.distance, 2);
        lamp.position.set(x, S.WALL_H - 0.9, z);
        scene.add(lamp);
        lights.lamps.push(lamp);
      }
    }

    /* The ceiling's own light. A downward point light leaves the plane it
       hangs from unlit whatever its intensity, so the ceiling is washed
       separately — dimmer than the room, which is how a ceiling looks, but
       never black. */
    const up = new T.DirectionalLight(0xfff0d8, 0.28);
    up.position.set(0, 0.2, 0);
    up.target.position.set(0, S.WALL_H, 0);
    scene.add(up);
    scene.add(up.target);
    lights.ceiling = up;
  }

  /* Re-aim the rig at a different preset. Nothing is rebuilt: the lights
     already in the scene take the new preset's colours and intensities, and
     the renderer takes its exposure. That is what makes flicking between
     DAYLIGHT and EVENING instant, and it is also why the shadow map — fixed
     at construction — is untouched by a preset change. */
  function setLighting(name) {
    if (!RU || !RU.LIGHTING[name]) return lighting;
    lighting = name;
    if (!running || !scene) return lighting;
    const P = RU.lightingOf(name);

    if (lights.hemi) {
      lights.hemi.color.setHex(P.ambient.sky);
      lights.hemi.groundColor.setHex(P.ambient.ground);
      lights.hemi.intensity = P.ambient.intensity;
    }
    if (lights.key) {
      lights.key.color.setHex(P.key.colour);
      lights.key.intensity = P.key.intensity;
      const span = Math.max(room.w, room.h);
      lights.key.position.set(-room.w * 0.4, span * P.key.elevation, room.h * 0.4);
    }
    const lampColour = gelFor(S.theme, P.lamp.colour);
    lights.lamps.forEach((l) => {
      l.color.copy(lampColour);
      l.intensity = P.lamp.intensity;
      l.distance = P.lamp.distance;
    });
    if (lights.ambient) lights.ambient.color.copy(lampColour);

    if (renderer && "toneMapping" in renderer) {
      renderer.toneMappingExposure = exposureFor(S.theme, P.exposure);
    }
    // Fog follows the preset: a party room has a little haze in it and a
    // daylit one has none. Kept well back either way — see buildScene.
    const span = Math.hypot(room.w, room.h);
    if (scene.fog) {
      if (P.fogDensity > 0) {
        scene.fog.near = span * (0.75 - P.fogDensity * 12);
        scene.fog.far = span * 1.8;
      } else {
        scene.fog.near = span * 0.9;
        scene.fog.far = span * 2.4;
      }
    }
    return lighting;
  }

  /* A stage gel, not a paint pot.

     A saturated colour carries far less LIGHT than a warm white — #e13d94
     delivers about 0.44 of what #ffe6b8 does — so gelling the lamps to a
     bold scheme and keeping the same intensity darkens the whole room. The
     fix is the one a lighting designer uses: keep the HUE, push the gel back
     up toward white until it carries the light a working room needs. The
     scheme still reads; the room stays legible. */
  /* Exposure, taken from how bright the SETUP PHOTOGRAPH is.

     A gold ballroom shot under full house lights and a barn shot at dusk are
     two different rooms, and walking both at one exposure makes one of them a
     lie. `brightness` is the photo's own area-weighted lightness (js/theme.js);
     it is mapped to a deliberately narrow exposure range, because the job is
     to follow the reference, not to reproduce a photographer's exposure
     mistakes. The floor of the range is still a room you can see. */
  function exposureFor(t, base) {
    const b0 = base != null ? base : 1.15;
    const b = t && typeof t.brightness === "number" ? t.brightness : null;
    if (b == null) return b0;
    // 0.35 (dim) → −0.13, 0.62 (typical) → 0, 0.85 (bright) → +0.14 on the
    // preset's own exposure, so the photograph shifts the grade rather than
    // replacing it.
    return Math.max(0.95, Math.min(1.4, b0 + (b - 0.62) * 0.62));
  }

  function gelFor(t, houseHex) {
    const house = new T.Color(houseHex != null ? houseHex : 0xffe6b8);
    if (!t || !t.uplight) return house;
    const gel = new T.Color(t.uplight);
    const hsl = { h: 0, s: 0, l: 0 };
    gel.getHSL(hsl);
    // Saturation capped and lightness floored: enough colour to read as a
    // wash, enough light to see the room by.
    gel.setHSL(hsl.h, Math.min(hsl.s, 0.45), Math.max(hsl.l, 0.72));
    return gel;
  }

  /* ── Collision ────────────────────────────────────────────────────────
     The AABB model and its resolution live in js/nav.js, and the walkthrough
     borrows them rather than carrying a copy. That is what guarantees the
     wall the walker is stopped by and the wall the route-finder plans around
     are the same wall: one set of boxes, read by both.

     Nav works in PLAN metres (origin at the room's top-left, +y down the
     sheet); the walkthrough works in WORLD metres (origin at the room's
     centre, +z down the room). The two conversions below are the whole of the
     difference, and they are the only place it exists. */
  const N = window.HPNav;
  const toPlan = (wx, wz) => ({ x: wx + room.w / 2, y: wz + room.h / 2 });
  const toWorld = (px, py) => ({ x: px - room.w / 2, z: py - room.h / 2 });

  function buildSolids() {
    solids = N.solidsOf(layout);
    gaps = S.buildOpenings(layout.items, room);
    // The shell's gap list is expressed on each wall's own axis, centred and
    // mirrored for the two walls drawn rotated. Nav's resolve() wants the
    // same spans measured along the plan's edges, so they are un-mirrored and
    // shifted here — once, rather than at every collision test.
    const along = (side, list) => {
      const len = (side === "north" || side === "south") ? room.w : room.h;
      return (list || []).map((g) => {
        let from = g.from, to = g.to;
        if (side === "west" || side === "south") { const f = -to, t = -from; from = f; to = t; }
        return { from: from + len / 2, to: to + len / 2 };
      });
    };
    planGaps = {
      north: along("north", gaps.north), south: along("south", gaps.south),
      east: along("east", gaps.east), west: along("west", gaps.west),
    };
    navGrid = null; // rebuilt lazily by the route helpers
  }

  /* ── The crowd ────────────────────────────────────────────────────────
     Guests in the chairs the plan seats and staff working the room, so what
     the designer walks is the night rather than the furniture. The crowd is
     handed the solids the collision already built — one AABB model, read by
     the player, the route-finder and every figure in the room. */
  function populateCrowd() {
    const C = crowd();
    if (!C) return;
    C.populate(scene, layout, { density: density, solids: solids });
  }

  function setDensity(name) {
    const C = crowd();
    if (!C || C.DENSITY_NAMES.indexOf(name) < 0) return;
    density = name;
    if (running) C.setDensity(name);
  }

  /* ── Spawn ────────────────────────────────────────────────────────────
     Preferred order, per the brief: the designer's own start point, then a
     doorway (you arrive through the door), then the clearest open floor. */
  function placePlayer() {
    player.pos = new T.Vector3();
    player.vel = new T.Vector3();

    const spawnItem = layout.items.find((i) => String(i.kind) === "spawn");
    if (spawnItem) {
      const w = S.toWorld((Number(spawnItem.x) || 0) + (Number(spawnItem.w) || 0.6) / 2,
                          (Number(spawnItem.y) || 0) + (Number(spawnItem.h) || 0.6) / 2, room);
      player.spawn = { x: w.x, z: w.z, yaw: (Number(spawnItem.rot) || 0) * Math.PI / 180 };
    } else {
      const door = layout.items.find((i) => String(i.kind) === "door");
      if (door) {
        /* A pace straight in from the door's OWN wall, facing into the room.
           Stepping toward the room's centre instead would walk a corner door
           diagonally into whatever is standing beside it — and would put the
           visitor down somewhere the walkability report didn't check. */
        const cx = (Number(door.x) || 0) + (Number(door.w) || 0.9) / 2;
        const cy = (Number(door.y) || 0) + (Number(door.h) || 0.25) / 2;
        const dist = { north: cy, south: room.h - cy, west: cx, east: room.w - cx };
        const side = Object.keys(dist).reduce((a, b) => (dist[a] <= dist[b] ? a : b));
        const step = 1.4;
        const at = side === "north" ? { x: cx, y: cy + step }
                 : side === "south" ? { x: cx, y: cy - step }
                 : side === "west" ? { x: cx + step, y: cy }
                 : { x: cx - step, y: cy };
        const w = toWorld(at.x, at.y);
        // Face the middle of the room — where the event is.
        player.spawn = { x: w.x, z: w.z, yaw: Math.atan2(-w.x, -w.z) };
      } else {
        player.spawn = openestSpot();
      }
    }
    resetPosition();
  }

  /* The clearest patch of floor: the sample point furthest from any solid.
     Used only when the plan names no door and no start point — a fallback
     that still never drops the visitor inside a table. Measured with nav's
     clearance, in plan space, then converted once on the way out. */
  function openestSpot() {
    let best = { x: room.w / 2, y: room.h - 1.5, d: -1 };
    const step = 0.75;
    for (let x = 1; x < room.w - 1; x += step) {
      for (let y = 1; y < room.h - 1; y += step) {
        const d = N.clearanceAt(solids, x, y);
        if (d > best.d) best = { x, y, d };
      }
    }
    const w = toWorld(best.x, best.y);
    // Face the middle of the room, which is where the event is.
    return { x: w.x, z: w.z, yaw: Math.atan2(-w.x, -w.z) };
  }

  function resetPosition() {
    if (!player.pos) return;
    player.pos.set(player.spawn.x, EYE, player.spawn.z);
    player.vel.set(0, 0, 0);
    player.yaw = player.spawn.yaw || 0;
    player.pitch = 0;
    player.onGround = true;
    syncCamera();
  }

  /* ── Input ────────────────────────────────────────────────────────────── */
  const onKeyDown = (e) => {
    if (!running) return;
    /* Esc is two presses, and the order matters: the browser takes the first
       one to release the pointer (it does this itself, before this handler
       ever runs). The second — when the pointer is already free — is the one
       that means "leave". Exiting on the first would make every accidental
       Esc throw the designer out of a walkthrough they were mid-way through. */
    if (e.code === "Escape") {
      if (!document.pointerLockElement) exit();
      return;
    }
    // V flips between the eyes and the boom, without leaving the mouse.
    if (e.code === "KeyV") {
      setView(view === "fp" ? "tp" : "fp");
      return;
    }
    // E inspects whatever is within reach, and closes the card again.
    if (e.code === "KeyE") {
      toggleInspect();
      return;
    }
    // Q toggles the analysis overlay without leaving the room.
    if (e.code === "KeyQ") {
      setAnalyze(!analyzing);
      const btn = overlay && overlay.querySelector("#hpSimAnalyze");
      if (btn) btn.classList.toggle("is-on", analyzing);
      return;
    }
    keys[e.code] = true;
    // Stop the page scrolling under the walkthrough.
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].indexOf(e.code) >= 0) e.preventDefault();
  };
  const onKeyUp = (e) => { keys[e.code] = false; };

  const onMouseMove = (e) => {
    if (!running || document.pointerLockElement !== renderer.domElement) return;
    const sens = 0.0022;
    player.yaw -= e.movementX * sens;
    player.pitch -= e.movementY * sens;
    // Just short of straight up/down: at exactly ±90° the look direction and
    // the up vector are parallel and the view rolls.
    const lim = Math.PI / 2 - 0.02;
    player.pitch = Math.max(-lim, Math.min(lim, player.pitch));
  };

  const onCanvasClick = () => {
    if (!running) return;
    if (document.pointerLockElement !== renderer.domElement) {
      const p = renderer.domElement.requestPointerLock();
      // Chrome returns a promise that rejects if the gesture was consumed;
      // swallowing it keeps a harmless race out of the console.
      if (p && p.catch) p.catch(() => {});
    }
  };

  const onLockChange = () => {
    const locked = document.pointerLockElement === renderer.domElement;
    if (overlay) overlay.classList.toggle("is-locked", locked);
    if (!locked) for (const k in keys) keys[k] = false; // don't run on forever
  };

  const onResize = () => resize();

  /* The wheel adjusts the third-person boom (§11: adjustable camera
     distance). In first person there is no boom to adjust, so the wheel is
     left alone — hijacking it there would do nothing visible and would only
     stop the page scrolling for no reason.

     Shift+wheel lifts the pivot instead of lengthening the boom, which is
     the "optional elevated view" the brief asks for: the same walk, watched
     from above, for judging a whole floor at once. */
  const onWheel = (e) => {
    if (!running || view !== "tp") return;
    e.preventDefault();
    const dir = Math.sign(e.deltaY);
    if (e.shiftKey) {
      boomLift = Math.max(BOOM_LIFT_RANGE.min,
                          Math.min(BOOM_LIFT_RANGE.max, boomLift + dir * 0.4));
    } else {
      boomWant = Math.max(BOOM_RANGE.min,
                          Math.min(BOOM_RANGE.max, boomWant * (1 + dir * 0.12)));
    }
    syncCamera();
  };

  function bindInput() {
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("resize", onResize);
    renderer.domElement.addEventListener("click", onCanvasClick);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    bindTouch();
  }
  function unbindInput() {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("pointerlockchange", onLockChange);
    window.removeEventListener("resize", onResize);
    if (renderer && renderer.domElement) {
      renderer.domElement.removeEventListener("wheel", onWheel);
    }
    for (const k in keys) delete keys[k];
  }

  /* Touch: a left-half virtual stick to walk, a right-half drag to look. Only
     wired on a touch device — a laptop with a touchscreen still gets the
     mouse-and-keyboard walkthrough the desktop brief asks for, because both
     can be true and the pointer lock is the better experience. */
  const touch = { move: null, look: null, mx: 0, mz: 0 };
  function bindTouch() {
    if (!("ontouchstart" in window)) return;
    overlay.classList.add("is-touch");
    const el = renderer.domElement;
    el.addEventListener("touchstart", (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth / 2 && !touch.move)
          touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
        else if (!touch.look)
          touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
      for (const t of e.changedTouches) {
        if (touch.move && t.identifier === touch.move.id) {
          const dx = (t.clientX - touch.move.x) / 60;
          const dy = (t.clientY - touch.move.y) / 60;
          touch.mx = Math.max(-1, Math.min(1, dx));
          touch.mz = Math.max(-1, Math.min(1, dy));
        } else if (touch.look && t.identifier === touch.look.id) {
          player.yaw -= (t.clientX - touch.look.x) * 0.006;
          player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - (t.clientY - touch.look.y) * 0.006));
          touch.look.x = t.clientX; touch.look.y = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; }
        if (touch.look && t.identifier === touch.look.id) touch.look = null;
      }
    };
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", end, { passive: true });
  }

  /* ── The step ─────────────────────────────────────────────────────────
     Acceleration toward a desired velocity rather than a straight position
     add: that is what makes the camera feel like a person starting to walk
     instead of a diagram sliding. Friction brings it back to rest. */
  function step(dt) {
    const sprint = keys.ShiftLeft || keys.ShiftRight;
    player.crouch = !!(keys.ControlLeft || keys.KeyC);

    let fwd = 0, strafe = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1;
    if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) strafe += 1;
    if (keys.KeyA || keys.ArrowLeft) strafe -= 1;
    if (touch.mz) fwd -= touch.mz;
    if (touch.mx) strafe += touch.mx;

    const len = Math.hypot(fwd, strafe);
    if (len > 1) { fwd /= len; strafe /= len; }

    const speed = (player.crouch ? WALK * 0.5 : sprint ? SPRINT : WALK);
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    // Forward is -Z in Three.js's convention; yaw rotates it into the world.
    const wishX = (-sin * fwd) + (cos * strafe);
    const wishZ = (-cos * fwd) + (-sin * strafe);

    const wish = new T.Vector3(wishX, 0, wishZ);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const a = (wish.lengthSq() > 0 ? ACCEL : FRICTION) * dt;
    player.vel.x += (wish.x - player.vel.x) * Math.min(1, a);
    player.vel.z += (wish.z - player.vel.z) * Math.min(1, a);

    // Vertical: only ever a jump and the fall back from it.
    if (keys.Space && player.onGround) { player.vel.y = JUMP; player.onGround = false; }
    player.vel.y -= GRAVITY * dt;

    // Movement is resolved in PLAN space, by nav's AABB sweep — the same call
    // the walkability check plans routes against.
    const feet = player.pos.y - (player.crouch ? CROUCH_EYE : EYE);
    const from = toPlan(player.pos.x, player.pos.z);
    const to = toPlan(player.pos.x + player.vel.x * dt, player.pos.z + player.vel.z * dt);
    const hit = N.resolve(solids, from, to, RADIUS, room, planGaps, feet);
    // A blocked axis loses its speed, so you don't accelerate into a wall and
    // then rocket sideways the moment it clears.
    if (hit.hitX) player.vel.x = 0;
    if (hit.hitY) player.vel.z = 0;
    const w = toWorld(hit.x, hit.y);
    player.pos.x = w.x;
    player.pos.z = w.z;

    const eye = player.crouch ? CROUCH_EYE : EYE;
    const floor = N.floorAt(solids, hit.x, hit.y);
    player.pos.y += player.vel.y * dt;
    if (player.pos.y <= floor + eye) {
      player.pos.y = floor + eye;
      player.vel.y = 0;
      player.onGround = true;
    }

    // Head bob — a small vertical sway in step with the pace. It is what
    // separates "walking" from "gliding", and it is scaled by actual speed so
    // standing still is perfectly still.
    const planar = Math.hypot(player.vel.x, player.vel.z);
    player.bob += dt * planar * 1.9;
    // Head bob belongs to the EYES. In third person the camera is on a boom
    // watching a body, and bobbing it would shake the room rather than the
    // walker — the body's own gait carries the motion instead.
    const bob = (view === "fp" && player.onGround)
      ? Math.sin(player.bob) * 0.022 * Math.min(1, planar / WALK)
      : 0;
    if (view === "tp") stepAvatar(dt, planar);
    syncCamera(bob);
  }

  /* The avatar follows the body the collision already resolved — it is drawn
     AT the player, never steered separately, so what you see walking is
     exactly what is being stopped by the tables. */
  function stepAvatar(dt, planar) {
    // Visibility is owned by syncCamera, which is the only thing that knows
    // how close the boom has been pulled — see the note there.
    const a = avatar || buildAvatar();
    if (!a) return;

    const eye = player.crouch ? CROUCH_EYE : EYE;
    a.position.set(player.pos.x, player.pos.y - eye, player.pos.z);

    /* Facing. Standing still the body holds the camera's yaw, so the avatar
       faces where the designer is looking. Moving, it turns toward the
       direction of TRAVEL — strafing sideways down an aisle should show a
       body walking sideways, which is the shape that has to fit. */
    let want = player.yaw;
    if (planar > 0.15) want = Math.atan2(player.vel.x, player.vel.z) + Math.PI;
    let diff = want - a.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    a.rotation.y += diff * Math.min(1, dt * 9);

    // Crouching drops the whole body rather than re-posing it: the gap being
    // judged is at the shoulders either way.
    a.scale.y = player.crouch ? CROUCH_EYE / EYE : 1;

    // The gait, advanced by DISTANCE — the crowd's own walk cycle, so the
    // avatar and the guests it passes move by one function.
    const C = crowd();
    avatarStep += planar * dt * 3.1;
    if (C && C.walkCycle) C.walkCycle(a, avatarStep, false);
    // In the air the legs stop striding; a figure pedalling through a jump
    // reads as a bug.
    if (!player.onGround && C && C.walkCycle) C.walkCycle(a, 0, false);
  }

  function syncCamera(bob) {
    if (!camera) return;

    if (view === "fp") {
      camera.position.set(player.pos.x, player.pos.y + (bob || 0), player.pos.z);
      camera.rotation.set(0, 0, 0);
      camera.rotateY(player.yaw);
      camera.rotateX(player.pitch);
      return;
    }

    /* Third person. The pivot is the avatar's shoulders; the camera sits at
       the end of a boom swung by the same yaw and pitch the eyes would use,
       so the controls feel identical and the crosshair still points where
       the body is facing. */
    const eye = player.crouch ? CROUCH_EYE : EYE;
    const feet = player.pos.y - eye;
    // The pivot rides at the shoulders, lifted by however much the designer
    // has raised it for an overview.
    const pivot = new T.Vector3(player.pos.x, feet + BOOM_H + boomLift, player.pos.z);

    // The direction the camera looks: the same forward vector first person
    // uses, so switching view never changes where you are aiming.
    const cp = Math.cos(player.pitch), sp = Math.sin(player.pitch);
    const fwd = new T.Vector3(-Math.sin(player.yaw) * cp, sp, -Math.cos(player.yaw) * cp);
    // The shoulder the camera looks over.
    const right = new T.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    const anchor = pivot.clone().addScaledVector(right, BOOM_SIDE);

    // How long the boom may be before it puts the camera through a wall or
    // inside a table. Walked out from the anchor rather than swept as a ray,
    // because nav's model is a set of boxes in plan space and a march is both
    // simpler and honest about the room's own collision.
    const want = clearBoom(anchor, fwd, boomWant);
    // Snapping IN is immediate — a frame of camera inside a wall is a frame
    // of seeing through the room. Springing back OUT is eased, or every
    // doorway would fling the camera.
    boom = want < boom ? want : boom + (want - boom) * Math.min(1, BOOM_EASE * 0.016);

    camera.position.copy(anchor).addScaledVector(fwd, -boom);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(player.yaw);
    camera.rotateX(player.pitch);

    /* Backed into a corner the boom collapses toward zero, which puts the
       camera inside the avatar's own head — a screenful of the back of a
       skull. Below BOOM_MIN the body is simply not drawn: the view degrades
       to first person, which is what standing in a corner actually looks
       like, rather than to a texture. */
    if (avatar) avatar.visible = boom > BOOM_MIN;
  }

  /* How far the boom can extend before the camera is inside something.

     Marched in 12 cm steps back along the look direction, testing each
     against the SAME solids and walls the body collides with — so the camera
     is stopped by the room the plan describes, not by a second guess at it.
     The first blocked sample ends the boom one step short.

     BOOM_MIN is deliberately NOT applied here. It is the shortest boom worth
     easing back out from, not a floor the geometry has to respect: clamping
     a blocked march up to it is exactly how a camera ends up behind the wall
     it just collided with. A body backed into a corner gets a boom of zero —
     which is first person, which is the honest picture of standing in a
     corner. */
  function clearBoom(anchor, fwd, max) {
    const stepLen = 0.12;
    const n = Math.ceil(max / stepLen);
    let last = 0;
    for (let i = 1; i <= n; i++) {
      const d = Math.min(max, i * stepLen);
      const x = anchor.x - fwd.x * d;
      const y = anchor.y - fwd.y * d;
      const z = anchor.z - fwd.z * d;
      // Out through a wall, or up through the ceiling / down through the
      // floor. The room's shell is closed in the walkthrough, so a camera
      // outside it sees the back of the building.
      const half = { x: room.w / 2 - CAM_R, z: room.h / 2 - CAM_R };
      if (Math.abs(x) > half.x || Math.abs(z) > half.z) break;
      if (y < 0.25 || y > S.WALL_H - CAM_R) break;
      // Inside a piece of furniture, tested at the camera's own height so a
      // boom passing OVER a table is not stopped by it.
      const p = toPlan(x, z);
      if (N.clearanceAt(solids, p.x, p.y) <= CAM_R && N.floorAt(solids, p.x, p.y) > y - CAM_R) break;
      last = d;
    }
    return last;
  }

  /* ── Proximity panel ──────────────────────────────────────────────────
     What the visitor is standing next to, named from the plan's own item.
     Deliberately quiet: it appears only within arm's reach of a real piece
     and never sits in the middle of the view. */
  /* ── Interaction ──────────────────────────────────────────────────────
     Brief §13: a consistent prompt, shown only when it means something.

     Walking near a piece raises a small "[E] Inspect" hint at the foot of
     the reticle — nothing more. Pressing E opens the card: what the piece
     is, what it seats, how far it is from the places that matter, and
     whether the analysis has anything to say about it. Pressing E again, or
     walking away, closes it.

     The prompt is deliberately NOT a permanent panel of information. §13 is
     explicit that the screen must not be cluttered, and the reason is the
     one the whole walkthrough exists for: the room is the thing being
     judged, and a HUD that covers it defeats the exercise. */
  let nearEl = null, promptEl = null;
  let nearId = null;         // what is currently within reach
  let nearItem = null;
  let inspecting = null;     // the id of the piece whose card is open

  const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

  /* What the player is standing next to — the nearest solid within reach,
     measured edge to edge so a big table is "near" from its edge rather than
     from its centre. */
  function findNear() {
    const me = toPlan(player.pos.x, player.pos.z);
    let best = null, bestD = INTERACT_RANGE;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const dx = Math.max(s.x0 - me.x, 0, me.x - s.x1);
      const dy = Math.max(s.y0 - me.y, 0, me.y - s.y1);
      const d = Math.hypot(dx, dy);
      if (d < bestD) { bestD = d; best = s.item; }
    }
    return best;
  }

  function updateNear() {
    if (!nearEl || !promptEl) return;
    const best = findNear();
    const id = best ? best.id : null;
    if (id === nearId) return;
    nearId = id;
    nearItem = best;

    // Walking away from the piece whose card is open closes it — a card
    // describing something behind you is a card in the way.
    if (inspecting && inspecting !== id) closeInspect();

    if (!best) {
      promptEl.hidden = true;
      return;
    }
    const esc = window.HP ? window.HP.esc : (s) => s;
    promptEl.hidden = false;
    promptEl.innerHTML = `<b>E</b> Inspect <span>${esc(best.label || best.kind)}</span>`;
  }

  function toggleInspect() {
    if (inspecting) return closeInspect();
    if (!nearItem) return;
    openInspect(nearItem);
  }

  function closeInspect() {
    inspecting = null;
    if (nearEl) { nearEl.hidden = true; nearEl.innerHTML = ""; }
  }

  /* The inspection card. Everything on it is MEASURED — the distances are
     walked with A* over the same grid the body moves on, not straight lines,
     because "9.4 m to the stage" is only useful if it is the distance a
     guest actually covers. */
  function openInspect(it) {
    if (!nearEl || !it) return;
    inspecting = it.id;
    const esc = window.HP ? window.HP.esc : (s) => s;
    const kind = String(it.kind || "");
    const def = RU ? RU.pieceOf(kind) : { label: kind };
    const facts = [];

    facts.push(`<span>Type</span><b>${esc(def.label || kind)}</b>`);
    if (it.seats) {
      const able = RU ? RU.capacityOf(it) : 0;
      facts.push(`<span>Capacity</span><b>${it.seats} guests</b>`);
      // What the table's own geometry says it can take. Worth showing when
      // it disagrees with what was typed — a 1.5 m round laid for twelve is
      // a table nobody can eat at.
      if (able && Math.abs(able - it.seats) >= 2) {
        facts.push(`<span>Comfortable at</span><b class="is-warn">${able} guests</b>`);
      }
    }
    if (def.shape === "round") facts.push(`<span>Diameter</span><b>${round2(it.w)} m</b>`);
    else facts.push(`<span>Size</span><b>${round2(it.w)} × ${round2(it.h)} m</b>`);
    if (def.servesPerMetre) {
      const run = Math.max(it.w, it.h);
      facts.push(`<span>Serves</span><b>≈${Math.round(run * def.servesPerMetre)} guests</b>`);
    }
    if (it.chair && RU) {
      facts.push(`<span>Chairs</span><b>${esc(RU.chairOf(it.chair).label)}</b>`);
    }

    // Walking distances to the pieces a guest at this table cares about.
    const legs = walkDistancesFrom(it);
    legs.forEach((l) => {
      facts.push(`<span>To ${esc(l.label)}</span><b>${l.metres} m</b>`);
    });

    // Clearance around it, and whatever the analysis said about it.
    const c = itemCentre(it);
    const width = window.HPNav.corridorWidth
      ? window.HPNav.corridorWidth(routeGrid(), c.x, c.y, 6) : null;
    const mine = report
      ? report.findings.filter((f) => f.item && f.item.id === it.id)
      : [];
    const status = mine.length
      ? (mine.some((f) => f.severity === "high") ? "bad" : "warn")
      : "ok";
    const verdict = mine.length
      ? mine[0].title
      : "No issues found";

    nearEl.hidden = false;
    nearEl.innerHTML = `
      <div class="hp-sim-card-head">
        <strong>${esc(it.label || def.label || kind)}</strong>
        <span class="hp-sim-status is-${status}">${esc(verdict)}</span>
      </div>
      <dl>${facts.join("")}</dl>
      ${mine.length ? `<ul class="hp-sim-card-issues">${
        mine.slice(0, 3).map((f) => `<li class="sev-${f.severity}">${esc(f.detail)}</li>`).join("")
      }</ul>` : ""}
      <div class="hp-sim-card-foot">
        <button class="hp-sim-btn hp-sim-btn--sm" data-guide-item="${esc(it.id)}">Guide me here</button>
        <span class="hp-sim-card-hint"><b>E</b> Close</span>
      </div>`;
    const guide = nearEl.querySelector("[data-guide-item]");
    if (guide) guide.addEventListener("click", () => {
      const r = guideToItem(it.id);
      const toast = window.HP && window.HP.toast;
      if (toast) toast(r.ok ? `${r.label} — ${r.metres} m on foot.` : r.reason, r.ok ? "ok" : "warn");
    });
  }

  const itemCentre = (it) => ({
    x: (Number(it.x) || 0) + (Number(it.w) || 1) / 2,
    y: (Number(it.y) || 0) + (Number(it.h) || 1) / 2,
  });

  /* How far it is, ON FOOT, from a piece to the landmarks that matter. A
     straight line would flatter every plan with a table in the way of it. */
  function walkDistancesFrom(it) {
    const N2 = window.HPNav;
    if (!N2) return [];
    const from = itemCentre(it);
    const want = ["stage", "buffet", "bar", "door", "exit", "dance"];
    const out = [];
    want.forEach((kind) => {
      if (String(it.kind) === kind) return;
      let goal = null, bestD = Infinity;
      (layout.items || []).forEach((other) => {
        if (String(other.kind) !== kind) return;
        const c = itemCentre(other);
        const d = Math.hypot(c.x - from.x, c.y - from.y);
        if (d < bestD) { bestD = d; goal = { at: c, item: other }; }
      });
      if (!goal) return;
      const path = N2.findPath(routeGrid(), from, goal.at, { snap: 4 });
      if (!path || path.length < 2) return;
      let len = 0;
      for (let i = 1; i < path.length; i++) {
        len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      }
      const def = RU ? RU.pieceOf(kind) : { label: kind };
      out.push({ label: (def.label || kind).toLowerCase(), metres: Math.round(len * 10) / 10 });
    });
    return out.slice(0, 4);
  }

  /* ── Guided routes (A*) ───────────────────────────────────────────────
     "Show me the way to the buffet" — the walkthrough asks nav for the
     shortest walkable route from where the visitor is standing to a chosen
     piece, and lays it on the floor as a gilt ribbon.

     This is the same A* the walkability report runs, on the same grid built
     from the same AABB boxes the collision uses. A route drawn here is
     therefore a route that can be walked: if the ribbon threads a gap, the
     player fits through that gap, because both answers come from one model. */
  let routeLine = null;
  let routeGoal = null;      // where the live route ends, for the HUD's arrow
  let routeArrows = [];      // the chevrons along it, animated by the loop

  // The A* grid, built on first use and reused. Every route in the
  // walkthrough — guide-me-to, the inspection card's distances, the crowd's
  // own errands — comes off this one grid.
  function routeGrid() {
    if (!navGrid) navGrid = N.grid(layout, { solids: solids });
    return navGrid;
  }

  /* Where "Guide me to…" can send you. Each destination is a KIND on the
     plan; the nearest instance wins. Restroom and service area are listed
     because the brief asks for them (§12) and resolve to whatever the plan
     actually marks — a room with no restroom marked says so plainly rather
     than silently offering a menu entry that does nothing. */
  const GUIDE_TARGETS = [
    { key: "door", label: "Entrance" },
    { key: "stage", label: "Stage" },
    { key: "buffet", label: "Buffet" },
    { key: "beverage", label: "Beverage station" },
    { key: "bar", label: "Bar" },
    { key: "registration", label: "Registration" },
    { key: "dance", label: "Dance floor" },
    { key: "exit", label: "Emergency exit" },
    { key: "kitchen", label: "Service area" },
    { key: "round", label: "Nearest table" },
  ];

  function guideTo(kind) {
    clearRoute();
    const grid = routeGrid();
    const me = toPlan(player.pos.x, player.pos.z);

    // The nearest piece of that kind, by straight-line distance — then A*
    // finds the walking route to it, which may be much longer. Passable
    // kinds (a doorway, a dance floor) are not in `solids`, so the plan is
    // read directly rather than the collision model.
    let goal = null, bestD = Infinity;
    (layout.items || []).forEach((it) => {
      if (String(it.kind) !== kind) return;
      const c = itemCentre(it);
      const d = Math.hypot(c.x - me.x, c.y - me.y);
      if (d < bestD) { bestD = d; goal = { x: c.x, y: c.y, item: it }; }
    });
    if (!goal) {
      const def = RU ? RU.pieceOf(kind) : { label: kind };
      return { ok: false, reason: `Nothing on this plan is marked as a ${String(def.label || kind).toLowerCase()}.` };
    }
    return routeTo(goal, grid, me);
  }

  // The same thing, aimed at one named piece — what the inspection card's
  // "Guide me here" presses.
  function guideToItem(id) {
    clearRoute();
    const it = (layout.items || []).find((i) => i.id === id);
    if (!it) return { ok: false, reason: "That piece is no longer on the plan." };
    const c = itemCentre(it);
    return routeTo({ x: c.x, y: c.y, item: it }, routeGrid(), toPlan(player.pos.x, player.pos.z));
  }

  function routeTo(goal, grid, from) {
    // Aim for the clear floor beside the piece, not its centre — the centre is
    // inside a solid, and standing ON the buffet is not the instruction.
    const path = N.findPath(grid, from, goal, { snap: 5 });
    if (!path || path.length < 2) {
      return { ok: false, reason: "No walkable route — something is blocking the way." };
    }
    drawRoute(path);
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    }
    const def = RU ? RU.pieceOf(goal.item.kind) : {};
    const label = goal.item.label || def.label || goal.item.kind;
    routeGoal = { x: goal.x, y: goal.y, label: label };
    return { ok: true, metres: Math.round(len * 10) / 10, label: label };
  }

  /* The route as a ribbon just above the floor, bright enough to follow and
     thin enough not to become the thing you are looking at — with chevrons
     along it pointing the way, because a line tells you where the route runs
     and an arrow tells you which end of it you are meant to walk toward. */
  function drawRoute(path) {
    const pts = [];
    path.forEach((p) => {
      const w = toWorld(p.x, p.y);
      pts.push(new T.Vector3(w.x, 0.03, w.z));
    });
    const C = S.palette();
    const geo = new T.BufferGeometry().setFromPoints(pts);
    const mat = new T.LineBasicMaterial({ color: C.gilt, transparent: true, opacity: 0.95 });
    routeLine = new T.Line(geo, mat);
    scene.add(routeLine);

    /* Chevrons every 1.5 m along the route, each turned to face the way the
       route goes there. Built once and animated by opacity in the loop, so
       following the line is a matter of watching the arrows run ahead of you
       rather than of working out which way the ribbon is pointing. */
    routeArrows = [];
    const arrowGeo = new T.ConeGeometry(0.14, 0.34, 4);
    const spacing = 1.5;
    let carried = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const seg = a.distanceTo(b);
      const dir = b.clone().sub(a).normalize();
      const yaw = Math.atan2(dir.x, dir.z);
      let along = spacing - carried;
      while (along < seg) {
        const at = a.clone().addScaledVector(dir, along);
        const arrow = new T.Mesh(arrowGeo, new T.MeshBasicMaterial({
          color: C.gilt, transparent: true, opacity: 0.85, depthWrite: false }));
        arrow.position.set(at.x, 0.14, at.z);
        // A cone points along its own +Y; laid down and turned, it points
        // along the route.
        arrow.rotation.set(Math.PI / 2, 0, 0);
        arrow.rotateOnWorldAxis(new T.Vector3(0, 1, 0), yaw);
        arrow.renderOrder = 4;
        routeLine.add(arrow);
        routeArrows.push({ mesh: arrow, phase: routeArrows.length * 0.35 });
        along += spacing;
      }
      carried = seg - (along - spacing);
    }

    // A marker at the destination, so the end of the ribbon reads as a place.
    const end = pts[pts.length - 1];
    const ring = new T.Mesh(
      new T.RingGeometry(0.28, 0.42, 24),
      new T.MeshBasicMaterial({ color: C.gilt, transparent: true, opacity: 0.8, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(end.x, 0.04, end.z);
    routeLine.add(ring);
    // A post at the destination, visible over the furniture between here and
    // there — the thing a route is actually followed by at eye height.
    const post = new T.Mesh(
      new T.CylinderGeometry(0.035, 0.035, 2.2, 6),
      new T.MeshBasicMaterial({ color: C.gilt, transparent: true, opacity: 0.5, depthWrite: false }));
    post.position.set(end.x, 1.1, end.z);
    routeLine.add(post);
  }

  // The chevrons pulse in sequence, running toward the destination.
  function animateRoute() {
    if (!routeArrows.length) return;
    for (let i = 0; i < routeArrows.length; i++) {
      const a = routeArrows[i];
      a.mesh.material.opacity = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(performance.now() * 0.003 - a.phase));
    }
  }

  function clearRoute() {
    routeArrows = [];
    routeGoal = null;
    if (!routeLine) return;
    routeLine.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) n.material.dispose();
    });
    scene.remove(routeLine);
    routeLine = null;
  }

  /* ── ANALYZE mode ─────────────────────────────────────────────────────
     Brief §16. The walkthrough runs the same analysis the 2D desk runs, on
     the same layout, and lays its findings on the floor: the walkability
     heatmap under your feet, a marker over every issue, and the numbers in a
     panel you can expand.

     Turning it on does not change the room. Nothing moves, nothing is
     recoloured except the floor overlay, and turning it off leaves the
     walkthrough exactly as it was — the analysis is a lens, not an edit. */
  function runAnalysis() {
    const W = window.HPWalk;
    if (!W) return null;
    report = W.analyse(layout, { pax: pax, event: eventType, heat: true });
    return report;
  }

  function setAnalyze(on) {
    analyzing = !!on;
    if (!scene) return analyzing;
    if (!analyzing) {
      S.clearAnalysis();
      renderStatus();
      if (overlay) overlay.classList.remove("is-analyzing");
      return analyzing;
    }
    if (!report) runAnalysis();
    // The overlay is drawn into THIS scene, not the preview's — showAnalysis
    // writes to whichever scene the module currently holds, and during a
    // walkthrough that is the walkthrough's.
    S.showAnalysis(report, { heatOpacity: 0.38 });
    renderStatus();
    if (overlay) overlay.classList.add("is-analyzing");
    return analyzing;
  }

  /* ── The status panel ─────────────────────────────────────────────────
     Brief §15: the room's numbers, and a warnings count that opens into the
     actual warnings. Collapsed to a single line by default, because the
     walkthrough's whole point is the room rather than the dashboard. */
  let statusEl = null;
  let statusOpen = false;

  function renderStatus() {
    if (!statusEl) return;
    const esc = window.HP ? window.HP.esc : (s) => s;
    const C = crowd();
    const m = report ? report.metrics : null;
    const guests = C ? C.count() : 0;

    if (!m) {
      statusEl.innerHTML = `
        <button class="hp-sim-status-toggle" id="hpSimStatusToggle">
          <span class="hp-sim-status-dot"></span>Simulation status
        </button>`;
      wireStatusToggle();
      return;
    }

    const band = (v) => (v >= 85 ? "is-ok" : v >= 60 ? "is-warn" : "is-bad");
    const access = m.reachablePct >= 98 ? "GOOD" : m.reachablePct >= 85 ? "FAIR" : "POOR";
    const warn = report.counts.high + report.counts.medium;

    const rows = [
      ["Guests in room", guests],
      ["Seats", m.seats + (m.standing ? ` + ${m.standing} standing` : "")],
      ["Tables", m.tables],
      ["Venue capacity", m.roomCapacity],
    ];
    if (m.pax) rows.splice(1, 0, ["Booked", m.pax]);

    statusEl.innerHTML = `
      <button class="hp-sim-status-toggle" id="hpSimStatusToggle" aria-expanded="${statusOpen}">
        <span class="hp-sim-status-dot ${band(m.walkabilityPct)}"></span>
        Walkability ${m.walkabilityPct}%
        ${warn ? `<b class="hp-sim-status-warn">${warn}</b>` : ""}
      </button>
      <div class="hp-sim-status-body"${statusOpen ? "" : " hidden"}>
        <dl class="hp-sim-status-grid">
          ${rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join("")}
        </dl>
        <dl class="hp-sim-status-grid hp-sim-status-grid--split">
          <div><span>Walkability</span><b class="${band(m.walkabilityPct)}">${m.walkabilityPct}%</b></div>
          <div><span>Accessibility</span><b class="${band(m.reachablePct)}">${access}</b></div>
          <div><span>Congestion</span><b class="${m.congestionAreas ? "is-warn" : "is-ok"}">${
            m.congestionAreas ? `${m.congestionAreas} area${m.congestionAreas === 1 ? "" : "s"}` : "None"}</b></div>
          <div><span>Main route</span><b>${m.spineWidth != null ? m.spineWidth + " m" : "—"}</b></div>
        </dl>
        ${report.findings.length ? `
          <button class="hp-sim-status-warnings" id="hpSimWarnToggle">
            Warnings <b>${report.findings.length}</b>
          </button>
          <ul class="hp-sim-status-list" id="hpSimWarnList" hidden>
            ${report.findings.slice(0, 12).map((f) => `
              <li class="sev-${f.severity}"${f.at ? ` data-goto="${f.id}"` : ""}>
                <strong>${esc(f.title)}</strong>
                <span>${esc(f.detail)}</span>
                ${f.need != null ? `<em>wants ${f.need} m · has ${f.got} m</em>` : ""}
              </li>`).join("")}
          </ul>` : `<p class="hp-sim-status-clean">Nothing standing in a guest's way.</p>`}
      </div>`;

    wireStatusToggle();
    const wt = statusEl.querySelector("#hpSimWarnToggle");
    const wl = statusEl.querySelector("#hpSimWarnList");
    if (wt && wl) wt.addEventListener("click", () => { wl.hidden = !wl.hidden; });
    // Clicking a warning walks the route to it — the walkthrough's own
    // version of "focus the camera on the affected object" (§16). A designer
    // inside the room wants to be TAKEN there, not shown it from above.
    statusEl.querySelectorAll("[data-goto]").forEach((li) => {
      li.addEventListener("click", () => {
        const f = report.findings.find((x) => x.id === li.dataset.goto);
        if (!f || !f.at) return;
        clearRoute();
        const r = routeTo({ x: f.at.x, y: f.at.y, item: f.item || { kind: "other", label: f.title } },
                          routeGrid(), toPlan(player.pos.x, player.pos.z));
        const toast = window.HP && window.HP.toast;
        if (toast) toast(r.ok ? `${f.title} — ${r.metres} m away. Follow the gold line.` : r.reason,
                         r.ok ? "ok" : "warn");
      });
    });
  }

  function wireStatusToggle() {
    const t = statusEl && statusEl.querySelector("#hpSimStatusToggle");
    if (!t) return;
    t.addEventListener("click", () => {
      statusOpen = !statusOpen;
      renderStatus();
    });
  }

  /* ── Loop ─────────────────────────────────────────────────────────────── */
  function loop() {
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    // Clamped: a backgrounded tab returns with a half-second delta, and an
    // unclamped step would teleport the player through a wall on the frame
    // the tab regains focus.
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // One body, both views — the step is the same in first and third person.
    step(dt);
    // The crowd is stepped in every view: a room where nobody moves is the
    // same still diagram the preview already is.
    const C = crowd();
    if (C) C.update(dt, player.pos);
    updateNear();
    animateRoute();
    updateCompass();
    renderer.render(scene, camera);
  }

  /* The direction indicator (§12): while a route is live, a small arrow at
     the edge of the reticle points at the destination and the distance to it
     counts down. It is what keeps a route followable when the ribbon is
     behind a table or off the bottom of the screen. */
  let compassEl = null;
  function updateCompass() {
    if (!compassEl) return;
    if (!routeGoal) {
      if (!compassEl.hidden) compassEl.hidden = true;
      return;
    }
    const me = toPlan(player.pos.x, player.pos.z);
    const dx = routeGoal.x - me.x, dy = routeGoal.y - me.y;
    const dist = Math.hypot(dx, dy);
    // Arrived: the route has done its job, so it clears itself rather than
    // leaving a ribbon under the designer's feet.
    if (dist < 1.2) {
      clearRoute();
      compassEl.hidden = true;
      const toast = window.HP && window.HP.toast;
      if (toast) toast("You're there.", "ok");
      return;
    }
    /* The bearing to the goal, relative to where the player is LOOKING. The
       world's yaw and the plan's angle run opposite ways (the plan's +y goes
       down the sheet), which is the whole of the conversion below. */
    const want = Math.atan2(dx, -dy);
    let rel = want - (-player.yaw);
    while (rel > Math.PI) rel -= Math.PI * 2;
    while (rel < -Math.PI) rel += Math.PI * 2;

    compassEl.hidden = false;
    const arrow = compassEl.querySelector(".hp-sim-compass-arrow");
    const text = compassEl.querySelector(".hp-sim-compass-text");
    if (arrow) arrow.style.transform = `rotate(${rel * 180 / Math.PI}deg)`;
    if (text) text.textContent = `${routeGoal.label} · ${Math.round(dist)} m`;
  }

  function resize() {
    if (!renderer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function setQuality(name) {
    if (!QUALITY[name] || name === quality) return;
    quality = name;
    if (!running) return;
    // Rebuilding is the honest way to change quality: shadow map size and
    // antialiasing are fixed at renderer construction, and a half-applied
    // preset would report a setting the picture doesn't have.
    const keep = { pos: player.pos.clone(), yaw: player.yaw, pitch: player.pitch };
    const plan = layout, cb = onExitCb;
    onExitCb = null;
    exit();
    enter(plan, { quality: name, onExit: cb });
    player.pos.copy(keep.pos);
    player.yaw = keep.yaw;
    player.pitch = keep.pitch;
    syncCamera();
  }

  /* ── Switching view ───────────────────────────────────────────────────
     The body is unchanged by this: the player's position, velocity and
     collision are identical in both, so stepping into third person to check
     a gap and back out again cannot move you. Only the camera and whether an
     avatar is drawn differ. */
  function setView(next) {
    const want = next === "tp" ? "tp" : "fp";
    if (want === view) return view;
    view = want;
    if (view === "tp") {
      buildAvatar();
      boom = boomWant;
    } else if (avatar) {
      avatar.visible = false;
    }
    if (overlay) overlay.classList.toggle("is-third", view === "tp");
    const btn = overlay && overlay.querySelector("#hpSimView");
    if (btn) btn.textContent = view === "tp" ? "3rd person" : "1st person";
    syncCamera();
    return view;
  }

  /* The avatar, built from the crowd's own figure factory (js/crowd.js) so
     the person being steered is the same build, height and gait as everyone
     they walk past — and re-dresses with them when a setup is chosen. Built
     lazily: a designer who never leaves first person never pays for it. */
  function buildAvatar() {
    const C = crowd();
    if (!C || !C.figure) return null;
    if (avatar) { avatar.visible = true; return avatar; }
    const mats = C.materials ? C.materials() : null;
    avatar = C.figure(mats && mats.avatar ? { material: mats.avatar } : {});
    // The body must not throw a shadow onto the camera's own view of it, but
    // it should still ground the figure in the room.
    avatar.traverse((n) => { if (n.isMesh) n.castShadow = true; });
    scene.add(avatar);
    return avatar;
  }

  /* Kept for the module's older callers, and because "which view" is a
     sensible thing to ask the walkthrough from outside it. */
  function setMode(next) {
    return setView(next === "tp" || next === "third" ? "tp" : "fp");
  }

  /* ── The overlay ──────────────────────────────────────────────────────
     Minimal by intent (brief §5): the room fills the screen, and the chrome is
     a header, a hint line and a small control cluster. Built in JS rather than
     in the page's template because it only exists while walking. */
  /* The HUD's four corners, per §14. The old footer put fourteen controls in
     one strip; this splits them by what they are FOR:

       top left      what this is and what room it is        (identity)
       top right     the time and the simulation's state     (status)
       bottom left   the keys                                (reference)
       bottom right  the controls                            (action)

     Every control is now one of seven buttons of equal weight, with the
     selects folded into popovers behind them, so the strip reads as a row of
     tools rather than as a form. The room is what fills the screen. */
  function buildOverlay() {
    document.body.classList.add("hp-sim-open");
    overlay = document.createElement("div");
    overlay.className = "hp-sim";
    const esc = window.HP ? window.HP.esc : (s) => s;
    const dims = `${round2(room.w)} × ${round2(room.h)} m`;

    overlay.innerHTML = `
      <div class="hp-sim-stage" id="hpSimStage"></div>

      <header class="hp-sim-top">
        <div class="hp-sim-id">
          <span class="hp-sim-badge"><span class="hp-sim-dot"></span>Simulation Mode</span>
          <strong class="hp-sim-title" id="hpSimTitle">${esc(venueName)}</strong>
          <small class="hp-sim-dims" id="hpSimDims">${dims}</small>
        </div>
        <div class="hp-sim-state">
          <span class="hp-sim-clock" id="hpSimClock"></span>
          <span class="hp-sim-status-wrap" id="hpSimStatus"></span>
        </div>
      </header>

      <div class="hp-sim-card" id="hpSimNear" hidden></div>

      <div class="hp-sim-reticle" aria-hidden="true"></div>
      <div class="hp-sim-hint" id="hpSimHint" hidden></div>

      <div class="hp-sim-compass" id="hpSimCompass" hidden>
        <span class="hp-sim-compass-arrow">▲</span>
        <span class="hp-sim-compass-text"></span>
      </div>

      <div class="hp-sim-prompt" id="hpSimPrompt">
        <strong>Click to look around</strong>
        <span>WASD to walk · Shift to sprint · Esc to release the pointer</span>
      </div>

      <footer class="hp-sim-foot">
        <div class="hp-sim-keys">
          <div><b>WASD</b> Move</div>
          <div><b>Mouse</b> Look</div>
          <div><b>Shift</b> Sprint</div>
          <div><b>E</b> Interact</div>
          <div><b>Q</b> Analyse</div>
          <div><b>V</b> View</div>
          <div><b>Esc</b> Menu</div>
        </div>

        <div class="hp-sim-tools">
          <div class="hp-sim-tool">
            <button class="hp-sim-btn" data-pop="quality">Quality</button>
            <div class="hp-sim-pop" data-for="quality" hidden>
              ${QUALITY_NAMES.map((q) => `
                <button class="hp-sim-opt${q === quality ? " is-on" : ""}" data-quality="${q}">${q}</button>`).join("")}
              <hr />
              <span class="hp-sim-pop-label">Lighting</span>
              ${(RU ? RU.LIGHTING_NAMES : []).map((n) => `
                <button class="hp-sim-opt${n === lighting ? " is-on" : ""}" data-light="${n}">${
                  esc(RU.LIGHTING[n].label)}</button>`).join("")}
              ${crowd() ? `<hr /><span class="hp-sim-pop-label">People</span>
                ${Object.keys((RU && RU.SIM.density) || {}).map((d) => `
                  <button class="hp-sim-opt${d === density ? " is-on" : ""}" data-people="${d}">${
                    esc(RU.SIM.density[d].label)}</button>`).join("")}` : ""}
            </div>
          </div>

          <div class="hp-sim-tool">
            <button class="hp-sim-btn" id="hpSimView">${view === "tp" ? "3rd person" : "1st person"}</button>
          </div>

          <div class="hp-sim-tool">
            <button class="hp-sim-btn" data-pop="guide">Guide</button>
            <div class="hp-sim-pop" data-for="guide" hidden>
              ${GUIDE_TARGETS.map((t) => `
                <button class="hp-sim-opt" data-guide="${t.key}">${esc(t.label)}</button>`).join("")}
              <hr />
              <button class="hp-sim-opt" data-guide="">Clear route</button>
            </div>
          </div>

          <button class="hp-sim-btn" id="hpSimAnalyze">Analyse</button>
          <button class="hp-sim-btn" id="hpSimReset">Reset</button>
          <button class="hp-sim-btn" id="hpSimHide">Hide UI</button>
          <button class="hp-sim-btn" id="hpSimFull">Fullscreen</button>
          <button class="hp-sim-btn is-exit" id="hpSimExit">Exit</button>
        </div>
      </footer>`;

    document.body.appendChild(overlay);
    host = overlay.querySelector("#hpSimStage");
    nearEl = overlay.querySelector("#hpSimNear");
    promptEl = overlay.querySelector("#hpSimHint");
    compassEl = overlay.querySelector("#hpSimCompass");
    statusEl = overlay.querySelector("#hpSimStatus");
    renderStatus();

    const clock = overlay.querySelector("#hpSimClock");
    const tick = () => {
      if (!clock || !clock.isConnected) return;
      clock.textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    };
    tick();
    // Cleared on exit — an interval left running against a removed node is a
    // small leak that survives every re-entry.
    clockTimer = setInterval(tick, 30000);

    wireOverlay();
  }

  /* The popovers: one open at a time, closed by pressing anywhere else. Kept
     as plain DOM rather than a select, because a native select inside a
     pointer-locked canvas opens behind the lock on some browsers and reads
     as a dead control. */
  function wireOverlay() {
    const closePops = (except) => {
      overlay.querySelectorAll(".hp-sim-pop").forEach((p) => {
        if (p !== except) p.hidden = true;
      });
    };

    overlay.querySelectorAll("[data-pop]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const pop = overlay.querySelector(`.hp-sim-pop[data-for="${btn.dataset.pop}"]`);
        if (!pop) return;
        const wasHidden = pop.hidden;
        closePops(pop);
        pop.hidden = !wasHidden;
        // A popover is a decision to make with the mouse, so the pointer is
        // released rather than left captured behind it.
        if (!pop.hidden && document.pointerLockElement) document.exitPointerLock();
      });
    });
    overlay.addEventListener("click", (e) => {
      if (!e.target.closest(".hp-sim-pop") && !e.target.closest("[data-pop]")) closePops(null);
    });

    const mark = (sel, attr, value) => {
      overlay.querySelectorAll(sel).forEach((b) => {
        b.classList.toggle("is-on", b.dataset[attr] === value);
      });
    };

    overlay.querySelectorAll("[data-quality]").forEach((b) => {
      b.addEventListener("click", () => {
        setQuality(b.dataset.quality);
        mark("[data-quality]", "quality", b.dataset.quality);
      });
    });

    overlay.querySelectorAll("[data-light]").forEach((b) => {
      b.addEventListener("click", () => {
        setLighting(b.dataset.light);
        mark("[data-light]", "light", b.dataset.light);
        const toast = window.HP && window.HP.toast;
        if (toast && RU) toast(RU.lightingOf(lighting).note, "ok");
      });
    });

    overlay.querySelectorAll("[data-people]").forEach((b) => {
      b.addEventListener("click", () => {
        setDensity(b.dataset.people);
        mark("[data-people]", "people", b.dataset.people);
        const C = crowd(), toast = window.HP && window.HP.toast;
        if (!C || !toast) return;
        const n = C.count();
        toast(n ? `${C.seatedCount()} seated · ${C.walkerCount()} on their feet.` : "Room cleared.", "ok");
        renderStatus();
      });
    });

    overlay.querySelectorAll("[data-guide]").forEach((b) => {
      b.addEventListener("click", () => {
        const kind = b.dataset.guide;
        overlay.querySelectorAll(".hp-sim-pop").forEach((p) => { p.hidden = true; });
        if (!kind) { clearRoute(); return; }
        const r = guideTo(kind);
        const toast = window.HP && window.HP.toast;
        if (!r.ok) { if (toast) toast(r.reason, "warn"); return; }
        if (toast) toast(`${r.label} — ${r.metres} m on foot. Follow the gold line.`, "ok");
      });
    });

    overlay.querySelector("#hpSimAnalyze").addEventListener("click", (e) => {
      setAnalyze(!analyzing);
      e.currentTarget.classList.toggle("is-on", analyzing);
      const toast = window.HP && window.HP.toast;
      if (toast && analyzing && report) {
        const w = report.counts.high + report.counts.medium;
        toast(w ? `${w} thing${w === 1 ? "" : "s"} to look at — see the status panel.`
                : "Nothing standing in a guest's way.", w ? "warn" : "ok");
      }
    });

    overlay.querySelector("#hpSimExit").addEventListener("click", exit);
    overlay.querySelector("#hpSimView").addEventListener("click", () =>
      setView(view === "fp" ? "tp" : "fp"));
    overlay.querySelector("#hpSimReset").addEventListener("click", resetPosition);
    overlay.querySelector("#hpSimHide").addEventListener("click", (e) => {
      overlay.classList.toggle("is-bare");
      e.currentTarget.textContent = overlay.classList.contains("is-bare") ? "Show UI" : "Hide UI";
    });
    overlay.querySelector("#hpSimFull").addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else if (overlay.requestFullscreen) overlay.requestFullscreen().catch(() => {});
    });
  }

  function setTitle(text) {
    venueName = String(text || "");
    const el = overlay && overlay.querySelector("#hpSimTitle");
    if (el) el.textContent = venueName;
  }

  return {
    available,
    enter,
    exit,
    isRunning: () => running,
    setQuality,
    setDensity,
    setMode,
    setView,
    get view() { return view; },
    resetPosition,
    setTitle,
    guideTo,
    guideToItem,
    clearRoute,
    setLighting,
    setAnalyze,
    runAnalysis,
    get lighting() { return lighting; },
    get analyzing() { return analyzing; },
    get report() { return report; },
    QUALITY_NAMES,
    get quality() { return quality; },
  };
})();
