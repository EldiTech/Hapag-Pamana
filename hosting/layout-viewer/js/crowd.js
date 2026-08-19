/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — the CROWD.

   An empty ballroom answers "does the stage fit". A ballroom with people in
   it answers the question the designer actually came with: does the room
   WORK on the night. A 1.2 m aisle looks generous on a plan and looks very
   different with a chair pushed back into it and a waiter coming the other
   way. This module puts that night into the walkthrough.

   ── What it owns, and what it does not ──────────────────────────────────
   Nothing about the LAYOUT. It reads the built scene and the same nav model
   the collision uses, and it adds only figures. It never writes to
   `layout.items`, never renders in the 2D sheet, never appears in the
   preview, and is torn down with the walkthrough. Turn people off and the
   room is the room the plan describes, unchanged.

   ── Where the seated guests come from ───────────────────────────────────
   Not from the plan's `seats` count re-read here — from the CHAIRS that
   js/scene3d.js already generated from that count and tagged
   `userData.seat`. A guest is placed on a chair that exists, facing the way
   that chair faces. A table that seats eight therefore seats eight guests,
   necessarily, because both come from one ring of chairs.

   ── Where the walkers go ────────────────────────────────────────────────
   Through js/nav.js — the same A* grid, over the same AABB solids, that the
   player is stopped by and the walkability report plans against. A waiter
   who threads a gap proves the gap is threadable. One model, three readers.

   Public API (window.HPCrowd):
     available()                       can this run?
     populate(scene, layout, opts)     fill the room; returns a count
     update(dt, eye)                   step the crowd one frame
     setDensity(name)                  NONE | SPARSE | HALF | FULL
     density                           the current name
     clear()                           remove every figure, dispose geometry
     count()                           figures currently in the room
   ════════════════════════════════════════════════════════════════ */
window.HPCrowd = (function () {
  "use strict";

  const T = window.THREE;
  const S = window.HPScene;
  const N = window.HPNav;
  // The house's own numbers — densities, queue rates, walking speeds. Read
  // defensively: the crowd is optional to the walkthrough, and the rules file
  // being absent must degrade it rather than break it.
  const RU = window.HPRules || null;
  const available = () => !!(T && S && N && S.available());

  /* ── Proportions ──────────────────────────────────────────────────────
     A figure is a MASSING body, matching the room's massing furniture: the
     silhouette and the height are honest, the face is not modelled. That is
     deliberate — a half-detailed face reads as a mannequin and pulls the eye
     away from the thing being judged, which is the space around it. */
  const STAND_H = 1.72;      // crown of the head, metres
  const SEAT_PAD = 0.45;     // chair seat height in scene3d.js — sit on it
  // Shoulder half-width, a touch under nav's own body radius — deliberately
  // narrower (a crowd figure is massing, not the exact width nav sweeps the
  // player's body at), but derived from nav's number rather than a second
  // independent literal, so tuning nav's BODY_R carries this one with it
  // instead of the two silently drifting apart. This is also the radius
  // separateWalkers() sweeps a walker's give-way nudge through N.resolve()
  // with, so it is a real collision number, not just a modelling one.
  const BODY_R = N ? N.BODY_R * 0.857 : 0.24;

  /* Chibi limb lengths, named once so figure()'s own construction, the
     seated-guest hip math, and waiter()'s tray-hand offset all read the
     same numbers instead of three copies that can drift out of sync with
     each other — which is exactly how the last pass here broke (one spot
     kept the old 0.86 hip height after the legs it was measuring had
     already been shortened). */
  const THIGH_LEN = 0.28, SHIN_LEN = 0.28;
  const HIP_Y = THIGH_LEN + SHIN_LEN + 0.02;   // hip pivot height standing, feet on the floor
  const TORSO_LEN = 0.42;
  const TORSO_TOP = HIP_Y + TORSO_LEN;
  const SHOULDER_Y = TORSO_TOP - 0.02;
  const UPPER_LEN = 0.16, FORE_LEN = 0.16;
  const HEAD_R = 0.155;

  /* How full the room is. A designer checks a plan at more than one load:
     half-capacity is where a layout usually still looks fine, and FULL is
     where the aisle it left turns out to be a queue. */
  const DENSITY = (RU && RU.SIM && RU.SIM.density) || {
    NONE:   { label: "Empty room", seated: 0,    walkers: 0 },
    SPARSE: { label: "Arriving",   seated: 0.35, walkers: 4 },
    HALF:   { label: "Half full",  seated: 0.6,  walkers: 7 },
    FULL:   { label: "Full house", seated: 0.94, walkers: 11 },
  };
  const DENSITY_NAMES = Object.keys(DENSITY);

  /* Dress. Guests wear the room's own palette so the crowd reads as part of
     the same drawing; staff wear one flat dark tone, because the whole point
     of spotting a waiter across a room is that you can spot a waiter across
     a room. */
  let MATS = null;
  let matsKey = "";           // what the cached wardrobe was cut for

  /* Guests dress from the room's CURRENT scheme, not from the stylesheet: a
     room dressed for a burgundy barn should have burgundy in the crowd, or
     the people read as visitors from another event. When a setup is chosen
     (js/theme.js) its accent, bloom and drape become the wardrobe; with no
     setup the house's own tokens do, exactly as before.

     Re-cut when the scheme changes, hence the key — rebuilding a wardrobe on
     every figure would compile a material per guest. */
  function buildMaterials() {
    const C = S.palette();
    const th = S.theme || null;
    const key = th ? [th.accent, th.bloom, th.drape, th.cloth].join("|") : "house";
    if (MATS && matsKey === key) return MATS;

    const std = (c, rough) => new T.MeshStandardMaterial({ color: c, roughness: rough == null ? 0.82 : rough });
    const tint = (base, k) => new T.Color(base).lerp(new T.Color(0xffffff), k);
    const col = (hex, fallback) => (hex ? new T.Color(hex) : fallback);

    // The scheme's own three colours, plus lighter mixes of them — a crowd
    // in one flat shade looks like a uniform, not like guests.
    const accent = col(th && th.accent, C.gold);
    const bloom  = col(th && th.bloom,  C.olive);
    const drape  = col(th && th.drape,  C.danger);

    MATS = {
      skin: std(0xC9A282, 0.9),
      hair: std(0x2B1D12, 0.95),
      staff: std(0x241A10, 0.7),
      staffShirt: std(0xF2EADA, 0.85),
      tray: std(col(th && th.accent, C.gilt), 0.35),
      guest: [
        std(bloom), std(drape), std(accent),
        std(tint(bloom, 0.35)), std(tint(drape, 0.4)),
        std(tint(C.ink, 0.55)), std(tint(accent, 0.3)),
      ],
      // The avatar's own coat: the scheme's accent, so the person the
      // designer is steering belongs to the event they are walking.
      avatar: std(accent, 0.78),
    };
    matsKey = key;
    return MATS;
  }

  /* ── State ────────────────────────────────────────────────────────────
     Flat and module-scoped, matching js/simulate.js: there is one room on
     screen and one crowd in it. */
  let group = null;          // everything this module has added to the scene
  let scene = null;
  let room = { w: 24, h: 18 };
  let layout = null;
  let solids = [];
  let navGrid = null;
  let seated = [];           // { mesh, phase, table }
  let walkers = [];          // { mesh, path, leg, t, speed, kind, pause }
  let density = "HALF";
  let clock = 0;

  /* ── A figure ─────────────────────────────────────────────────────────
     Built from primitives, one group per person, origin at the FLOOR under
     them so a seated figure and a standing one are placed by the same
     arithmetic. Arms and head are kept as named children so the idle motion
     has something to move without rebuilding geometry every frame. */
  /* ── Variation ────────────────────────────────────────────────────────
     A room of forty identical bodies reads as a rendering error, and the
     brief asks (§4) that guests not be visibly the same person repeated.

     The variation is DATA, generated per guest and applied to one builder,
     rather than a library of hand-modelled characters: height, build, skin
     tone, hair and dress are drawn from ranges, and the builder scales the
     same primitives to them. That gets a crowd that never repeats exactly,
     at the cost of one object per person and no extra geometry.

     `frame` is the shape of the body — "slim", "average", "broad" — and
     "fem" carries a narrower shoulder and a longer hem, which at massing
     scale is what actually distinguishes the silhouettes. It is a shape
     option, not a claim about who any guest is. */
  const SKINS = [0xF0D2B4, 0xE3B992, 0xC9A282, 0xA97C56, 0x8A5E3C, 0x6B4429];
  const HAIRS = [0x1A1108, 0x2B1D12, 0x4A3320, 0x6B4A2A, 0x8A6A3E, 0x3A3A3C];
  const FRAMES = {
    slim:    { girth: 0.86, shoulder: 0.92, height: 1.0 },
    average: { girth: 1.0,  shoulder: 1.0,  height: 1.0 },
    broad:   { girth: 1.18, shoulder: 1.12, height: 0.99 },
  };
  const FRAME_NAMES = Object.keys(FRAMES);

  function randomLook() {
    const fem = Math.random() < 0.5;
    return {
      fem,
      frame: FRAME_NAMES[(Math.random() * FRAME_NAMES.length) | 0],
      // ±7% on the height, which at 1.72 m is a 24 cm spread across a room.
      scale: 0.93 + Math.random() * 0.14,
      skin: SKINS[(Math.random() * SKINS.length) | 0],
      hair: HAIRS[(Math.random() * HAIRS.length) | 0],
      // Long hair on roughly two thirds of the figures with the narrower
      // frame — a visible difference at massing scale, which the head shape
      // alone is not.
      longHair: fem ? Math.random() < 0.68 : Math.random() < 0.08,
    };
  }

  /* Skin and hair materials are cached by colour: six tones and six hair
     colours is twelve materials for a room of any size, rather than two per
     guest. */
  const toneCache = Object.create(null);
  function tone(hex, rough) {
    const key = hex + "|" + rough;
    if (!toneCache[key]) {
      toneCache[key] = new T.MeshStandardMaterial({ color: hex, roughness: rough });
    }
    return toneCache[key];
  }

  function figure(opts) {
    const o = opts || {};
    const M = buildMaterials();
    const look = o.look || randomLook();
    const F = FRAMES[look.frame] || FRAMES.average;
    const cloth = o.material || M.guest[(Math.random() * M.guest.length) | 0];
    const skinMat = o.skin || tone(look.skin, 0.9);
    const hairMat = o.hairMaterial || tone(look.hair, 0.95);
    const g = new T.Group();

    const add = (geo, mat, y, cast) => {
      const m = new T.Mesh(geo, mat);
      m.castShadow = cast !== false;
      m.receiveShadow = true;
      m.position.y = y;
      g.add(m);
      return m;
    };

    const addPart = (parent, geo, mat, x, y, z, cast) => {
      const m = new T.Mesh(geo, mat);
      m.castShadow = cast !== false;
      m.receiveShadow = true;
      m.position.set(x || 0, y || 0, z || 0);
      parent.add(m);
      return m;
    };

    // Legs: a thigh from the hip and a shin from the knee, so a seated leg
    // FOLDS instead of swinging its whole 0.82 m length out straight — a
    // one-piece leg rotated forward at the hip reaches as far forward as it
    // is long, which plants a knee-high beam through the table it's sat at.
    const thighGeo = new T.CylinderGeometry(0.095 * F.girth, 0.084 * F.girth, THIGH_LEN, 10);
    const shinGeo = new T.CylinderGeometry(0.084 * F.girth, 0.078 * F.girth, SHIN_LEN, 10);
    const legs = [];
    const stance = 0.13 * F.shoulder;
    [-stance, stance].forEach((x) => {
      const hip = new T.Group();
      hip.position.set(x, HIP_Y, 0);
      const thigh = new T.Mesh(thighGeo, o.legMaterial || M.staff);
      thigh.castShadow = true;
      thigh.position.y = -THIGH_LEN / 2;
      hip.add(thigh);

      // The knee: a joint at the thigh's own end, carrying the shin and the
      // foot. Rotating it independently of the hip is what lets a seated leg
      // bend TWICE — forward at the hip, back down at the knee — and land
      // under the chair instead of past it.
      const knee = new T.Group();
      knee.position.y = -THIGH_LEN;
      const shin = new T.Mesh(shinGeo, o.legMaterial || M.staff);
      shin.castShadow = true;
      shin.position.y = -SHIN_LEN / 2;
      knee.add(shin);
      const shoe = new T.Mesh(new T.BoxGeometry(0.14 * F.girth, 0.05, 0.26), o.legMaterial || M.staff);
      shoe.castShadow = true;
      shoe.position.set(0, -SHIN_LEN - 0.025, 0.08);
      shoe.rotation.x = -0.08;
      knee.add(shoe);
      hip.add(knee);

      g.add(hip);
      legs.push({ hip, knee });
    });

    // Torso: a soft, barely-tapered cylinder — chibi proportions read from
    // a round body, not a waist. Anchored to sit right on top of the hip
    // pivot, so shortening/lengthening TORSO_LEN never leaves a gap or an
    // overlap at the hip regardless of what the legs are doing.
    const torso = add(new T.CylinderGeometry(
      0.24 * F.shoulder * (look.fem ? 0.96 : 1),
      0.21 * F.girth * (look.fem ? 1.04 : 1), TORSO_LEN, 12), cloth, HIP_Y + TORSO_LEN / 2);
    add(new T.SphereGeometry(0.2 * F.girth, 10, 8), cloth, HIP_Y + 0.05).scale.set(1.05, 0.78, 0.92);
    // Shoulders, so the top of the torso isn't a flat lid.
    add(new T.SphereGeometry(0.24 * F.shoulder, 12, 8), cloth, TORSO_TOP).scale.set(1, 0.5, 0.8);

    // Almost no neck — the head sits low, close over the shoulders, which
    // is most of what reads as "chibi" from across a room.
    const neck = add(new T.CylinderGeometry(0.06, 0.07, 0.03, 8), skinMat, TORSO_TOP + 0.01);
    const head = new T.Group();
    const headY = TORSO_TOP + HEAD_R * 0.85;
    head.position.y = headY;
    const skull = new T.Mesh(new T.SphereGeometry(HEAD_R, 14, 10), skinMat);
    skull.castShadow = true;
    skull.scale.set(1, 1.05, 0.95);
    head.add(skull);
    const face = new T.Mesh(new T.SphereGeometry(HEAD_R * 0.71, 10, 8), skinMat);
    face.castShadow = true;
    face.scale.set(0.92, 0.68, 0.55);
    face.position.set(0, -0.018, HEAD_R * 0.71);
    head.add(face);
    addPart(head, new T.SphereGeometry(0.016, 8, 6), tone(0x1A1108, 0.95), -0.035, 0.012, HEAD_R * 0.92, true);
    addPart(head, new T.SphereGeometry(0.016, 8, 6), tone(0x1A1108, 0.95), 0.035, 0.012, HEAD_R * 0.92, true);
    const nose = addPart(head, new T.CylinderGeometry(0.012, 0.015, 0.045, 6), tone(0x7A5238, 0.92), 0, -0.01, HEAD_R * 1.02, true);
    nose.rotation.x = Math.PI / 2;
    addPart(head, new T.SphereGeometry(0.018, 8, 6), skinMat, -0.075, 0.0, 0.02, true);
    addPart(head, new T.SphereGeometry(0.018, 8, 6), skinMat, 0.075, 0.0, 0.02, true);
    const hair = new T.Mesh(
      new T.SphereGeometry(HEAD_R * 1.06, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
    hair.castShadow = true;
    hair.scale.set(1, 1.1, 0.98);
    hair.position.y = 0.012;
    head.add(hair);
    if (look.longHair) {
      // A fall of hair down the back of the head and neck.
      const fall = new T.Mesh(new T.SphereGeometry(HEAD_R * 1.1, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
      fall.castShadow = true;
      fall.scale.set(0.98, 1.9, 0.9);
      fall.position.set(0, -0.09, -0.028);
      head.add(fall);
    }
    g.add(head);

    // Arms hang from the shoulder joint, so a swing is a rotation rather
    // than a position rewrite. Bent at the elbow the same way a leg bends at
    // the knee: an upper arm from the shoulder, a forearm from the elbow at
    // the upper arm's own end — so a raised/reaching pose folds instead of
    // swinging a single 0.6 m rod straight out into a T-pose.
    const upperGeo = new T.CylinderGeometry(0.068 * F.girth, 0.062 * F.girth, UPPER_LEN, 10);
    const foreGeo = new T.CylinderGeometry(0.062 * F.girth, 0.054 * F.girth, FORE_LEN, 10);
    const arms = [];
    const reach = 0.27 * F.shoulder;
    [-reach, reach].forEach((x) => {
      const sh = new T.Group();
      sh.position.set(x, SHOULDER_Y, 0);
      const upper = new T.Mesh(upperGeo, cloth);
      upper.castShadow = true;
      upper.position.y = -UPPER_LEN / 2;
      sh.add(upper);

      const elbow = new T.Group();
      elbow.position.y = -UPPER_LEN;
      const fore = new T.Mesh(foreGeo, skinMat);
      fore.castShadow = true;
      fore.position.y = -FORE_LEN / 2;
      elbow.add(fore);
      const hand = new T.Mesh(new T.SphereGeometry(0.038 * F.girth, 8, 6), skinMat);
      hand.castShadow = true;
      hand.position.set(0, -FORE_LEN - 0.01, 0.01);
      elbow.add(hand);
      sh.add(elbow);

      sh.userData.elbow = elbow;
      g.add(sh);
      arms.push(sh);
    });

    // Height is applied to the whole figure last, so every proportion above
    // is written once at the reference height and scaled together.
    if (!o.noScale) g.scale.setScalar(look.scale * F.height);

    g.userData.parts = { head, arms, legs, torso, neck };
    g.userData.look = look;
    return g;
  }

  /* ── Props a guest can be holding ─────────────────────────────────────
     The difference between "eating" and "sitting" is a plate; between
     "drinking" and "talking" is a glass. Each is a couple of primitives
     parented to a hand, built once per guest that gets one and left there —
     an animation that had to create and destroy geometry every few seconds
     would allocate its way through a walkthrough. */
  function handProp(kind) {
    const M = buildMaterials();
    const g = new T.Group();
    if (kind === "glass") {
      const glass = new T.Mesh(new T.CylinderGeometry(0.032, 0.024, 0.11, 8), M.tray);
      glass.castShadow = true;
      g.add(glass);
    } else if (kind === "plate") {
      const plate = new T.Mesh(new T.CylinderGeometry(0.1, 0.09, 0.012, 12), M.staffShirt);
      plate.castShadow = true;
      g.add(plate);
    } else if (kind === "phone") {
      const phone = new T.Mesh(new T.BoxGeometry(0.075, 0.14, 0.01), M.staff);
      phone.castShadow = true;
      g.add(phone);
    } else {
      return null;
    }
    return g;
  }

  /* A waiter: the same body in service dress, with a tray carried flat on
     one palm, held out from the chest — the classic one-hand carry, the
     other arm free. The tray is what makes a figure read as staff at fifty
     metres, before any of the tailoring is visible. */
  function waiter() {
    const M = buildMaterials();
    const g = figure({ material: M.staffShirt, legMaterial: M.staff });
    const p = g.userData.parts;

    // A dark waistcoat over the shirt. Sized a fixed margin OVER the torso's
    // own radius (figure()'s taper, same F.shoulder/F.girth factors) rather
    // than a flat constant — a flat size only cleared a mid-frame torso and
    // z-fought (a flickering seam) against any broader or narrower build.
    const look = g.userData.look;
    const F = FRAMES[look.frame] || FRAMES.average;
    const vestTopR = 0.24 * F.shoulder * (look.fem ? 0.96 : 1) + 0.02;
    const vestBotR = 0.21 * F.girth * (look.fem ? 1.04 : 1) + 0.02;
    const vestLen = TORSO_LEN * 0.82;
    const vest = new T.Mesh(new T.CylinderGeometry(vestTopR, vestBotR, vestLen, 10), M.staff);
    vest.castShadow = true;
    vest.position.y = HIP_Y + TORSO_LEN - vestLen / 2 + 0.03;
    g.add(vest);

    // A rounded collar standing proud of the neckline — a ring of the
    // shirt's own colour, wider than the neck, sitting where collar meets
    // throat.
    const collar = new T.Mesh(new T.TorusGeometry(0.075, 0.018, 8, 14), M.staffShirt);
    collar.castShadow = true;
    collar.position.y = TORSO_TOP + 0.02;
    collar.rotation.x = Math.PI / 2;
    g.add(collar);

    // Two button studs down the vest's own centreline.
    const vestTopY = vest.position.y + vestLen / 2;
    [vestTopY - 0.08, vestTopY - 0.2].forEach((y) => {
      const btn = new T.Mesh(new T.SphereGeometry(0.016, 8, 6), M.staffShirt);
      btn.position.set(0, y, vestTopR + 0.02);
      g.add(btn);
    });

    // A name badge, plate-flat, pinned over the chest.
    const badge = new T.Mesh(new T.BoxGeometry(0.1, 0.032, 0.008), M.tray);
    badge.castShadow = true;
    badge.position.set(0.1, vestTopY - 0.05, vestTopR + 0.02);
    g.add(badge);

    // Cuffs: a light band at each wrist, where the shirt sleeve shows past
    // the vest.
    p.arms.forEach((sh) => {
      const cuff = new T.Mesh(new T.CylinderGeometry(0.058 * F.girth, 0.058 * F.girth, 0.035, 8), M.staffShirt);
      cuff.castShadow = true;
      cuff.position.y = -FORE_LEN + 0.03;
      sh.userData.elbow.add(cuff);
    });

    // One arm carries: the shoulder swings the upper arm up and across the
    // body (X lifts it, Y sweeps it inward — Y rather than a second Z is
    // what actually carries the hand toward the midline, since a shoulder Z
    // and an elbow Z on the same joint chain don't compose the way a flat
    // "swing inward" reads), the elbow folds so the forearm comes back
    // across the chest. The other arm hangs loose, free to swing with the
    // stride.
    const trayArm = p.arms[1];
    trayArm.rotation.set(-0.8, -0.4, 0);
    trayArm.userData.elbow.rotation.set(-1.5, 0, 0);
    const carryElbow = trayArm.userData.elbow;

    const freeArm = p.arms[0];
    freeArm.rotation.set(-0.05, 0, 0);

    // The tray set rides on the hand, but the hand's own orientation by this
    // point is tipped well off level (two compounded joint rotations). A
    // child group takes the hand's LOCAL rotation needed to cancel that:
    // the inverse of the elbow's total world rotation, computed from the
    // live quaternions rather than hand-fitted Euler numbers, so the tray
    // stays visually level regardless of which carry angles are chosen
    // above.
    g.updateWorldMatrix(true, true);
    const worldQ = new T.Quaternion();
    carryElbow.getWorldQuaternion(worldQ);
    // The figure's own root has no rotation at build time (that's applied
    // by whatever places it in the room later), so the elbow's world
    // quaternion here is really just shoulder * elbow — exactly the local
    // chain this needs to cancel.
    const levelQ = worldQ.clone().invert();
    const traySet = new T.Group();
    traySet.quaternion.copy(levelQ);
    traySet.position.set(0, -FORE_LEN - 0.01, 0.01);
    carryElbow.add(traySet);

    // Sits ON the hand — the hand sphere is at elbow-local
    // (0, -FORE_LEN - 0.01, 0.01); the tray's own thickness is added on top
    // so it reads as balanced on the palm instead of skewered through it.
    const tray = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.02, 16), M.tray);
    tray.castShadow = true;
    tray.position.y = 0.05;
    traySet.add(tray);
    // A covered dish in the middle, so the tray is carrying something.
    const domeBase = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.02, 12), M.staffShirt);
    domeBase.position.y = 0.08;
    traySet.add(domeBase);
    const dome = new T.Mesh(new T.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.staffShirt);
    dome.castShadow = true;
    dome.position.y = 0.09;
    traySet.add(dome);
    const knob = new T.Mesh(new T.SphereGeometry(0.012, 8, 6), M.tray);
    knob.position.y = 0.14;
    traySet.add(knob);
    g.userData.tray = tray;
    g.userData.staff = true;
    g.userData.trayArmIndex = 1;
    return g;
  }

  /* ── Seating the room ─────────────────────────────────────────────────
     Every tagged chair in the built scene is a candidate. They are collected
     in world space (a chair's own transform is nested inside its table's
     group and its table's rotation), shuffled, and then the density's share
     is filled — shuffled rather than filled in order, so a half-full room
     looks like a half-full room instead of one side seated and one side
     bare. */
  function collectChairs(root) {
    const out = [];
    const pos = new T.Vector3();
    const quat = new T.Quaternion();
    const scl = new T.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((n) => {
      if (!n.userData || !n.userData.seat) return;
      n.matrixWorld.decompose(pos, quat, scl);
      // The chair's facing, as a yaw: its local -Z, turned into the world.
      const fwd = new T.Vector3(0, 0, 1).applyQuaternion(quat);
      out.push({
        x: pos.x, z: pos.z, yaw: Math.atan2(fwd.x, fwd.z),
        // How high this particular chair's seat is. A bar stool is 30 cm
        // taller than a banquet chair, and a guest placed at a fixed height
        // would either float above one or sink into the other. Read from the
        // chair the scene actually built, never assumed.
        pad: typeof n.userData.seatHeight === "number" ? n.userData.seatHeight : SEAT_PAD,
      });
    });
    return out;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* What a seated guest is doing. Weighted the way a table actually looks
     part-way through a service: most people talking, a few eating, a couple
     with a drink, one taking a photograph. Each is a pose plus a motion, and
     both are cheap — a rotation on a joint, not a skeletal animation. */
  const SEATED_ACTS = [
    { act: "talking",  weight: 40, prop: null },
    { act: "eating",   weight: 22, prop: "plate" },
    { act: "drinking", weight: 16, prop: "glass" },
    { act: "waiting",  weight: 15, prop: null },
    { act: "photo",    weight: 7,  prop: "phone" },
  ];
  const ACT_TOTAL = SEATED_ACTS.reduce((n, a) => n + a.weight, 0);

  function pickAct() {
    let r = Math.random() * ACT_TOTAL;
    for (let i = 0; i < SEATED_ACTS.length; i++) {
      r -= SEATED_ACTS[i].weight;
      if (r <= 0) return SEATED_ACTS[i];
    }
    return SEATED_ACTS[0];
  }

  /* A rigged guest, when the Mixamo set has loaded: the sitting clip IS the
     pose, so none of the hip/knee/arm arithmetic below applies — the model
     was animated sitting in a chair, not swung into one. Falls through to
     the procedural figure() when the models aren't ready (still loading,
     or the fetch failed), so the room is never empty while they load. */
  function seatRiggedGuest(c) {
    const M = window.HPModels;
    if (!M || !M.ready()) return null;
    const mats = buildMaterials();
    const tint = mats.guest[(Math.random() * mats.guest.length) | 0].color.getHex();
    if (window.HP_DEBUG_TINT) console.log("seatRiggedGuest tint:", tint.toString(16));
    const inst = M.spawn(tint);
    if (!inst) return null;
    // Every Mixamo sitting export tried here shipped broken in some way —
    // see models.js's poseSitting doc comment for the history. Posed
    // procedurally instead: the same bones a clip would have driven, rotated
    // directly by chair-height-aware arithmetic, so there is no clip frame
    // left to be a bad one. Falls back to whatever sitting clip is still
    // registered (if any) only if the rig doesn't match the expected Mixamo
    // bone names — belt and suspenders, not the normal path.
    const pad0 = typeof c.pad === "number" ? c.pad : SEAT_PAD;
    const posedProcedurally = M.poseSitting(inst.root, pad0);
    let clipName = null;
    if (!posedProcedurally) {
      clipName = M.randomSittingAction();
      const action = inst.actions[clipName];
      if (action) {
        const dur = action.getClip().duration;
        action.reset().play();
        action.time = dur * 0.7 + Math.random() * dur * 0.3;
        action.paused = true;
      }
    }
    // A procedural pose keeps the feet on the floor and folds the knees to
    // bring the hips up to the seat — the same physical arrangement a real
    // sitting body has, so the root belongs at floor level (y=0), not
    // shifted to the chair height itself. Only the clip fallback path needs
    // a manual shift: a baked clip's Hips sits at whatever height ITS OWN
    // root implies, unrelated to this chair, and has to be corrected after
    // the fact rather than being correct by construction. See models.js:
    // measureSeatDrops.
    const pad = pad0;
    const seatDrop = (!posedProcedurally && clipName) ? M.seatDropOf(clipName) : 0;
    inst.root.position.set(c.x, posedProcedurally ? 0 : (pad - seatDrop), c.z);
    inst.root.rotation.y = c.yaw + (Math.random() - 0.5) * 0.5 + Math.PI;
    group.add(inst.root);
    seated.push({
      mesh: inst.root,
      rigged: true,
      mixer: inst.mixer,
      act: clipName,
      phase: Math.random() * Math.PI * 2,
    });
    return true;
  }

  function seatGuests(chairs, share) {
    const take = Math.round(chairs.length * share);
    shuffle(chairs).slice(0, take).forEach((c) => {
      if (seatRiggedGuest(c)) return;
      const g = figure({});
      const p = g.userData.parts;

      /* Sitting, in three moves: the thigh swings forward at the hip, the
         shin swings back down at the knee, and everything above the hip
         drops by exactly the distance the hip itself dropped. The hip/knee
         pair is what keeps a bent leg's REACH short — a single rigid leg
         rotated forward at the hip would plant its far end wherever its
         full length lands, table or no table. */
      const HIP_STAND = HIP_Y;              // matches figure()'s hip group
      const pad = typeof c.pad === "number" ? c.pad : SEAT_PAD;
      const HIP_SEATED = pad;              // hip pivot level with the seat top itself
      const drop = HIP_STAND - HIP_SEATED;

      // A stool is sat on with the legs down; a chair with them forward and
      // the knee folded back to bring the foot back under the seat. The
      // knee angle is chosen relative to the hip's own, so the shin always
      // ends up hanging straight down to the floor no matter how far
      // forward the thigh swings — a fixed knee angle only cancelled the
      // hip correctly for one particular thigh angle and left the shin
      // splayed out for any other, which is what let a seated guest's leg
      // float clear of the chair instead of tucking under it.
      const perched = pad > 0.6;
      const HIP_ANGLE = perched ? -0.2 : -1.4;
      p.legs.forEach(({ hip, knee }, i) => {
        hip.rotation.x = HIP_ANGLE;
        // Shin's world angle = hip + knee; solving for a shin that hangs
        // straight down (world angle 0) gives knee = -hip, then a small
        // extra fold so the foot tucks back under the seat rather than
        // landing exactly under the knee.
        knee.rotation.x = -HIP_ANGLE - (perched ? 0 : 0.25);
        hip.position.y = HIP_SEATED;
        // A hair of asymmetry, so eight guests at one table are not one
        // guest drawn eight times.
        hip.rotation.z = (i ? -1 : 1) * Math.random() * 0.06;
      });
      // Seated arms have no elbow, so the rest angle has to stay shallow — a
      // 0.6 m rigid arm swung much past this reaches past the plate in
      // front of the guest and into the middle of the table.
      p.arms.forEach((sh, i) => { sh.rotation.x = -0.5; sh.rotation.z = (i ? -1 : 1) * 0.12; });

      /* Lowered child by child rather than by moving the whole group: the
         group's origin is the FLOOR under the figure, and dropping that
         would take the feet down through it. The legs have already been
         placed by hand above, so everything else is what moves. */
      const hipGroups = p.legs.map((l) => l.hip);
      g.children.forEach((ch) => {
        if (hipGroups.indexOf(ch) >= 0) return;
        ch.position.y -= drop;
      });
      g.position.set(c.x, 0, c.z);

      // A chair faces its table; the guest faces the way the chair faces,
      // turned a few degrees off so a table of eight isn't eight identical
      // statues. Read off the chair's own world transform, never recomputed
      // from the angle — a guest can't end up facing somewhere the chair
      // under them isn't.
      g.rotation.y = c.yaw + (Math.random() - 0.5) * 0.5;

      // What this one is doing, and whatever they are holding to do it.
      const chosen = pickAct();
      if (chosen.prop) {
        const prop = handProp(chosen.prop);
        if (prop) {
          // Carried in the hand, at the forearm's own end — the elbow fold
          // below is what keeps a raised prop from swinging the whole arm's
          // reach out into the table.
          prop.position.set(0, -FORE_LEN + 0.02, 0.06);
          p.arms[1].userData.elbow.add(prop);
          p.arms[1].rotation.x = chosen.act === "photo" ? -0.55 : -0.4;
          p.arms[1].userData.elbow.rotation.x = chosen.act === "photo" ? -0.9 : -0.7;
        }
      }
      if (chosen.act === "photo") {
        // Both hands up on the phone, elbows folded in, head level with it.
        p.arms[0].rotation.x = -0.5;
        p.arms[0].rotation.z = -0.3;
        p.arms[0].userData.elbow.rotation.x = -0.9;
        p.arms[1].rotation.z = 0.3;
      }

      group.add(g);
      seated.push({
        mesh: g,
        parts: p,
        act: chosen.act,
        phase: Math.random() * Math.PI * 2,
        rate: 0.55 + Math.random() * 0.5,     // each guest breathes at its own pace
        baseYaw: g.rotation.y,
        armRest: p.arms.map((a) => a.rotation.x),
        turn: 0, nextTurn: 2 + Math.random() * 9,
        // A talker gestures in bursts rather than continuously; the timer is
        // what makes a table look like a conversation.
        gesture: 0, nextGesture: Math.random() * 6,
      });
    });
  }

  /* ── The walkers ──────────────────────────────────────────────────────
     Staff and standing guests, each on an A* route between two open points.
     Routes are found once and walked; when one runs out a new destination is
     picked and the next route is found. Pathing is nav's, so a walker cannot
     take a line the player couldn't. */
  function openPoints(n) {
    const pts = [];
    let guard = n * 60;
    while (pts.length < n && guard-- > 0) {
      const x = 0.8 + Math.random() * (room.w - 1.6);
      const y = 0.8 + Math.random() * (room.h - 1.6);
      // A metre of elbow room, so nobody spawns wedged against a table.
      if (N.clearanceAt(solids, x, y) < 0.55) continue;
      pts.push({ x, y });
    }
    return pts;
  }

  // A tray, parented to the rigged model's own right-hand bone (Mixamo's
  // standard rig name) so it rides the walk/idle animation instead of being
  // posed by hand — the model owns the arm now, not this module.
  function attachTray(root) {
    const M = window.HPModels;
    const mats = buildMaterials();
    let hand = null;
    root.traverse((n) => { if (!hand && /RightHand$/.test(n.name)) hand = n; });
    if (!hand) return;
    const tray = new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.02, 16), mats.tray);
    tray.castShadow = true;
    tray.rotation.x = Math.PI / 2;      // held roughly level in a Mixamo hand's local frame
    tray.position.set(0, 0.02, 0.08);
    hand.add(tray);
  }

  function addRiggedWalker(p, isStaff) {
    const M = window.HPModels;
    if (!M || !M.ready()) return null;
    const mats = buildMaterials();
    const tint = isStaff
      ? mats.staffShirt.color.getHex()
      : mats.guest[(Math.random() * mats.guest.length) | 0].color.getHex();
    const inst = M.spawn(tint);
    if (!inst) return null;
    if (isStaff) attachTray(inst.root);
    const w = S.toWorld(p.x, p.y, room);
    inst.root.position.set(w.x, 0, w.z);
    inst.root.rotation.y = Math.random() * Math.PI * 2;
    group.add(inst.root);
    const idle = inst.actions.idle, walk = inst.actions.walking;
    if (idle) idle.play();
    return {
      mesh: inst.root,
      rigged: true,
      mixer: inst.mixer,
      idleAction: idle,
      walkAction: walk,
      moving: false,
      staff: isStaff,
      at: { x: p.x, y: p.y },
      path: null, leg: 0, t: 0,
      speed: isStaff ? 1.15 + Math.random() * 0.2 : 0.85 + Math.random() * 0.25,
      pause: Math.random() * 3,
      step: Math.random() * Math.PI * 2,
    };
  }

  function addWalkers(n) {
    const spots = openPoints(n);
    spots.forEach((p, i) => {
      // Roughly half staff at a full load — a service brigade, not a mob.
      const isStaff = i % 2 === 0;
      const rigged = addRiggedWalker(p, isStaff);
      if (rigged) { walkers.push(rigged); route(rigged); return; }

      const g = isStaff ? waiter() : figure({});
      const w = S.toWorld(p.x, p.y, room);
      g.position.set(w.x, 0, w.z);
      g.rotation.y = Math.random() * Math.PI * 2;
      group.add(g);
      const walker = {
        mesh: g,
        parts: g.userData.parts,
        staff: isStaff,
        at: { x: p.x, y: p.y },
        path: null, leg: 0, t: 0,
        speed: isStaff ? 1.15 + Math.random() * 0.2 : 0.85 + Math.random() * 0.25,
        pause: Math.random() * 3,
        step: Math.random() * Math.PI * 2,
      };
      walkers.push(walker);
      route(walker);
    });
  }

  /* A destination worth walking to. Staff work the service pieces — buffet,
     bar, the tables they serve; guests drift between the buffet, the bar and
     the dance floor. Falling back to open floor keeps a walker moving in a
     room that has none of those pieces on it yet. */
  const STAFF_KINDS = ["buffet", "bar", "round", "rect", "head", "square",
                       "service", "beverage", "coffee", "dessert", "kitchen", "trash"];
  const GUEST_KINDS = ["buffet", "bar", "dance", "stage", "beverage", "coffee",
                       "dessert", "cocktail", "photo"];

  function pickGoal(w) {
    const kinds = w.staff ? STAFF_KINDS : GUEST_KINDS;
    const candidates = [];
    solids.forEach((s) => {
      if (kinds.indexOf(String(s.kind)) < 0) return;
      candidates.push(s);
    });
    // Dance floors and stages are passable, so they are not in `solids` —
    // read them straight off the plan and aim at their centre.
    (layout.items || []).forEach((it) => {
      const k = String(it.kind);
      if (kinds.indexOf(k) < 0 || (k !== "dance" && k !== "stage")) return;
      const cw = Math.max(0.2, Number(it.w) || 1), ch = Math.max(0.2, Number(it.h) || 1);
      candidates.push({ x0: Number(it.x) || 0, y0: Number(it.y) || 0,
                        x1: (Number(it.x) || 0) + cw, y1: (Number(it.y) || 0) + ch, kind: k });
    });
    if (!candidates.length) {
      const p = openPoints(1)[0];
      return p || { x: room.w / 2, y: room.h / 2 };
    }
    const s = candidates[(Math.random() * candidates.length) | 0];
    const kind = String(s.kind);
    const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2;

    /* A serving line is QUEUED at, not milled around.

       Guests heading for a buffet or a bar join the back of whatever line is
       already there: the approach point is offset along the piece's long
       axis by however many people are already queuing, on its serving side.
       That is what turns a popular buffet into a visible queue in the
       walkthrough — the same queue js/walkability.js predicts from the route
       crossings, now standing in the room. */
    if (QUEUE_KINDS[kind] && !w.staff) {
      const alongX = (s.x1 - s.x0) >= (s.y1 - s.y0);
      const depth = (alongX ? (s.y1 - s.y0) : (s.x1 - s.x0)) / 2 + 0.85;
      // Which side of the line to queue on: the one with more open floor.
      const sideA = alongX ? { x: cx, y: cy - depth } : { x: cx - depth, y: cy };
      const sideB = alongX ? { x: cx, y: cy + depth } : { x: cx + depth, y: cy };
      const side = N.clearanceAt(solids, sideA.x, sideA.y) >= N.clearanceAt(solids, sideB.x, sideB.y)
        ? sideA : sideB;
      const key = kind + "@" + Math.round(cx * 4) + "," + Math.round(cy * 4);
      const ahead = queues[key] || 0;
      queues[key] = ahead + 1;
      w.queueKey = key;
      // Back of the line, 0.55 m a head, running along the serving edge.
      const run = Math.min(ahead * 0.55, Math.max(s.x1 - s.x0, s.y1 - s.y0) + 2.4);
      const back = alongX
        ? { x: s.x0 + 0.4 + run, y: side.y }
        : { x: side.x, y: s.y0 + 0.4 + run };
      return back;
    }

    // Everything else: approach the clear floor BESIDE a piece, never its
    // centre — the centre of a buffet is inside the buffet, and nav would
    // only snap out of it.
    const a = Math.random() * Math.PI * 2;
    const reach = Math.max(s.x1 - s.x0, s.y1 - s.y0) / 2 + 0.75;
    return { x: cx + Math.cos(a) * reach, y: cy + Math.sin(a) * reach };
  }

  /* Which pieces form a queue. A dance floor does not; a bar does. */
  const QUEUE_KINDS = { buffet: 1, bar: 1, beverage: 1, coffee: 1, dessert: 1 };
  /* How many walkers are currently committed to each line. Kept as a plain
     count rather than a list of members: the only question asked of it is
     "how far back does the next arrival stand", and a walker that leaves
     decrements it. */
  let queues = Object.create(null);

  // Give up a place in a line. Called when a walker leaves the queue it
  // joined, so the next arrival stands where this one was rather than behind
  // a ghost that walked off ten seconds ago.
  function leaveQueue(w) {
    if (!w.queueKey) return;
    queues[w.queueKey] = Math.max(0, (queues[w.queueKey] || 1) - 1);
    w.queueKey = null;
  }

  function route(w) {
    if (!navGrid) navGrid = N.grid(layout, { solids: solids });
    leaveQueue(w);
    const goal = pickGoal(w);
    const path = N.findPath(navGrid, w.at, goal, { snap: 4 });
    if (!path || path.length < 2) { w.path = null; w.pause = 1 + Math.random() * 2; return; }
    w.path = path;
    w.leg = 0;
    w.t = 0;
  }

  /* ── The step ─────────────────────────────────────────────────────────
     Walkers advance along their route at their own pace; seated guests
     breathe and occasionally look around. Both are driven by one clock, and
     both are cheap: no per-frame allocation, no raycasts, no physics. The
     crowd must never be the reason the walkthrough drops a frame — a laggy
     room is a room the designer stops walking. */
  function update(dt, eye) {
    if (!group) return;
    if (window.HP_FREEZE) return;
    clock += dt;

    for (let i = 0; i < seated.length; i++) {
      const s = seated[i];
      if (s.rigged) { s.mixer.update(dt); continue; }
      // Breathing: a slow rise and fall through the shoulders.
      const b = Math.sin(clock * s.rate + s.phase);
      s.parts.torso.scale.y = 1 + b * 0.014;
      // A small head sway, and now and then a proper look to one side —
      // that second one is what stops a seated table reading as furniture.
      s.parts.head.rotation.y = Math.sin(clock * 0.5 + s.phase) * 0.13 + s.turn;
      s.parts.head.rotation.x = b * 0.03;
      s.nextTurn -= dt;
      if (s.nextTurn <= 0) {
        s.turn = (Math.random() - 0.5) * 1.1;
        s.nextTurn = 3 + Math.random() * 10;
      } else {
        s.turn *= 1 - Math.min(1, dt * 0.55);   // ease back to facing the table
      }
      // The whole body leans a hair with the head — a person turning to talk
      // turns their shoulders too.
      s.mesh.rotation.y = s.baseYaw + s.turn * 0.35;
      seatedAct(s, dt);
    }

    for (let i = 0; i < walkers.length; i++) stepWalker(walkers[i], dt, eye);
    separateWalkers();
  }

  /* Walker-vs-walker: each one's route was planned against the room's own
     furniture, never against each other, so two paths that cross can land
     two bodies on the same square metre with nothing here to stop it. A
     simple pairwise push-apart, same shape as the player-avoidance nudge
     below — O(n²) over the mesh positions actually walked to this frame,
     which is fine at crowd scale (a dozen walkers at FULL density, never
     hundreds): the alternative, a spatial grid, buys nothing a handful of
     guests can't already afford to skip.

     The push itself is a raw vector with no guarantee of clearing a solid —
     the same fact the give-way nudge below is built around. Two walkers
     sidestepping each other next to a table edge can otherwise be shoved
     straight through it. Resolved through the same AABB sweep (nav.resolve)
     before the position is written, so a walker separating from another
     slides along whatever it's pushed into instead of clipping through it. */
  const MIN_APART = 0.5;
  function separateWalkers() {
    for (let i = 0; i < walkers.length; i++) {
      const wa = walkers[i], a = wa.mesh;
      for (let j = i + 1; j < walkers.length; j++) {
        const wb = walkers[j], b = wb.mesh;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        if (d >= MIN_APART || d < 1e-4) continue;
        const push = (MIN_APART - d) * 0.5;
        const nx = dx / d, nz = dz / d;

        const pa = wa.at || { x: a.position.x + room.w / 2, y: a.position.z + room.h / 2 };
        const pb = wb.at || { x: b.position.x + room.w / 2, y: b.position.z + room.h / 2 };
        let aTo = { x: pa.x - nx * push, y: pa.y - nz * push };
        let bTo = { x: pb.x + nx * push, y: pb.y + nz * push };
        if (N && solids) {
          aTo = N.resolve(solids, pa, aTo, BODY_R, room);
          bTo = N.resolve(solids, pb, bTo, BODY_R, room);
        }
        wa.at = { x: aTo.x, y: aTo.y };
        wb.at = { x: bTo.x, y: bTo.y };
        const wA = S.toWorld(aTo.x, aTo.y, room), wB = S.toWorld(bTo.x, bTo.y, room);
        a.position.x = wA.x; a.position.z = wA.z;
        b.position.x = wB.x; b.position.z = wB.z;
      }
    }
  }

  /* What a seated guest is visibly DOING, on top of the breathing every one
     of them does. Each act is a small motion on a joint that is already
     posed — nothing here re-poses a body or allocates anything, because it
     runs for every seated guest every frame and a room at a full house is a
     hundred of them.

     `eating` and `drinking` bring the hand to the mouth on a cycle rather
     than holding it there: a figure frozen with a glass at its lips reads as
     a mannequin, and the motion is the whole of what says "mid-service". */
  function seatedAct(s, dt) {
    const arms = s.parts.arms;
    const rest = s.armRest;
    switch (s.act) {
      case "eating": {
        // A slow lift and return, with a pause at the bottom — the rhythm of
        // someone actually working through a plate.
        const cycle = (Math.sin(clock * 0.85 + s.phase) + 1) / 2;
        const lift = Math.pow(cycle, 2.2) * 0.3;
        arms[1].rotation.x = rest[1] - lift;
        s.parts.head.rotation.x += lift * 0.12;
        break;
      }
      case "drinking": {
        // Longer between sips than between forkfuls, and a fuller lift.
        const cycle = (Math.sin(clock * 0.42 + s.phase) + 1) / 2;
        const lift = Math.pow(cycle, 4) * 0.35;
        arms[1].rotation.x = rest[1] - lift;
        s.parts.head.rotation.x -= lift * 0.1;
        break;
      }
      case "photo": {
        // Held up steady, with the tiny drift of a hand holding a phone.
        arms[0].rotation.x = rest[0] - 0.45 + Math.sin(clock * 1.6 + s.phase) * 0.015;
        arms[1].rotation.x = rest[1] - 0.5 + Math.cos(clock * 1.4 + s.phase) * 0.015;
        break;
      }
      case "talking": {
        // Gestures in bursts. Between them the hands rest, which is what
        // makes the bursts read as speech rather than as a wave.
        s.nextGesture -= dt;
        if (s.nextGesture <= 0) {
          s.gesture = 0.8 + Math.random() * 1.6;      // seconds of gesturing
          s.nextGesture = 3 + Math.random() * 7;
        }
        if (s.gesture > 0) {
          s.gesture -= dt;
          const swing = Math.sin(clock * 4.2 + s.phase) * 0.16;
          arms[1].rotation.x = rest[1] - 0.2 + swing;
          arms[0].rotation.x = rest[0] - 0.06 - swing * 0.4;
        } else {
          arms[0].rotation.x += (rest[0] - arms[0].rotation.x) * Math.min(1, dt * 3);
          arms[1].rotation.x += (rest[1] - arms[1].rotation.x) * Math.min(1, dt * 3);
        }
        break;
      }
      default:
        // Waiting: hands still, the body's own breathing carrying it.
        break;
    }
  }

  // Idle <-> walking, on a rigged walker, only when the state actually
  // changes — crossFadeTo every frame would restart the blend every frame.
  function setRiggedMoving(w, moving) {
    if (w.moving === moving) return;
    w.moving = moving;
    const from = moving ? w.idleAction : w.walkAction;
    const to = moving ? w.walkAction : w.idleAction;
    if (!to) return;
    to.reset().play();
    // idle.fbx's broken export falls back to the walking clip at a crawl
    // (see models.js) — reset() above cleared that crawl's timeScale along
    // with everything else, so a walker settling back to "idle" would
    // otherwise resume striding at full walking speed while standing still.
    if (!moving && to === w.idleAction && window.HPModels && window.HPModels.idleIsFallback) {
      to.timeScale = 0.06;
    }
    if (from) from.crossFadeTo(to, 0.25, false);
  }

  function stepWalker(w, dt, eye) {
    if (w.rigged) w.mixer.update(dt);
    if (w.pause > 0) {
      w.pause -= dt;
      if (w.rigged) setRiggedMoving(w, false); else idlePose(w, dt);
      if (w.pause <= 0 && !w.path) route(w);
      return;
    }
    if (!w.path) { route(w); return; }

    const from = w.path[w.leg];
    const to = w.path[w.leg + 1];
    if (!to) {
      /* Arrived. A guest who walked to a serving line waits the time it
         takes to be served — the rate comes from LAYOUT_RULES, so a bar
         (9 s a head) clears faster than a buffet (12 s) and the two lines
         look different in the room, as they do on the night. Everyone else
         simply stands a moment before choosing somewhere new to be. */
      w.path = null;
      if (w.queueKey) {
        const kind = w.queueKey.split("@")[0];
        const rate = (RU && RU.SIM.queueRate[kind]) || 10;
        const ahead = Math.max(0, (queues[w.queueKey] || 1) - 1);
        w.pause = rate * 0.35 + ahead * rate * 0.25 + Math.random() * 2;
      } else {
        w.pause = 1.5 + Math.random() * 4;
      }
      return;
    }

    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1e-6;
    w.t += (w.speed * dt) / len;
    if (w.t >= 1) {
      w.leg++;
      w.t = 0;
      w.at = { x: to.x, y: to.y };
      return;
    }

    const px = from.x + dx * w.t;
    const py = from.y + dy * w.t;
    w.at = { x: px, y: py };

    /* Give way to the player. A figure that walks straight through the
       person walking the room breaks the one thing this is for; a figure
       that steps aside is also the honest answer to "is there room for two
       people here" — if there isn't, you will see them squeeze. */
    let ox = 0, oz = 0;
    if (eye) {
      const me = { x: eye.x + room.w / 2, y: eye.z + room.h / 2 };
      const gx = px - me.x, gy = py - me.y;
      const d = Math.hypot(gx, gy);
      if (d < 1.1 && d > 1e-3) {
        const push = (1.1 - d) * 0.9;
        ox = (gx / d) * push;
        oz = (gy / d) * push;
        // Slowed as well as nudged — people don't sidestep at full pace.
        w.t -= (w.speed * dt) / len * 0.5;
      }
    }

    // The A* route was planned to clear every solid, but the sidestep above
    // is a raw push vector with no such guarantee — nudged 1.1 m from the
    // player, a walker on a route already hugging a table's edge can be
    // shoved straight through it. Resolved through the same AABB sweep the
    // player's own movement uses (nav.resolve) before the position is
    // written, so a walker giving way slides along whatever it's nudged
    // into instead of clipping through it.
    let nx = px + ox, ny = py + oz;
    if ((ox || oz) && N && solids) {
      const settled = N.resolve(solids, { x: px, y: py }, { x: nx, y: ny }, BODY_R, room);
      nx = settled.x; ny = settled.y;
    }

    const world = S.toWorld(nx, ny, room);
    w.mesh.position.set(world.x, 0, world.z);
    // Face the direction of travel, turned into it rather than snapped, so a
    // corner in the route doesn't spin the figure on the spot.
    const want = Math.atan2(dx, dy);
    let diff = want - w.mesh.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    w.mesh.rotation.y += diff * Math.min(1, dt * 6);

    if (w.rigged) {
      // The clip supplies its own stride and bob; this module only owns
      // where the root sits and which way it faces.
      setRiggedMoving(w, true);
      return;
    }

    // The walk cycle: legs and the free arm counter-swinging, in step with
    // the actual pace, so a figure held up by the player stops moving its
    // legs instead of moon-walking on the spot. The gait itself lives in
    // walkCycle() and is shared with the third-person avatar — one walk in
    // the room, not one per module.
    w.step += dt * w.speed * 4.4;
    gait(w.mesh, w.step, w.staff);
    // A gentle bob, so the body rises on each step.
    w.mesh.position.y = Math.abs(Math.sin(w.step)) * 0.022;
  }

  /* The gait. Legs counter-swing, and the free arm swings against them — a
     waiter's tray arm stays fixed in its carry pose regardless, since the
     tray is a one-hand palm carry now (see waiter()) and only that one arm
     is spoken for. One function, applied to any figure this module built,
     whether it is a guest crossing the room or the avatar the designer is
     steering in third person.

     `dist` is a phase, not a time: it is advanced by distance travelled, so
     a figure that stops moving stops striding instead of walking on the
     spot, and one that is slowed by the crowd strides slower. */
  function gait(fig, dist, staff) {
    const p = fig && fig.userData && fig.userData.parts;
    if (!p) return;
    const swing = Math.sin(dist) * 0.42;
    p.legs[0].hip.rotation.x = swing;
    p.legs[1].hip.rotation.x = -swing;
    // The knee bends on the back-swing only (a straight leg on the
    // forward-swing, a slight lift on the way back) — a fixed-length thigh
    // rotated alone would drag the shin's full length through the floor.
    p.legs[0].knee.rotation.x = Math.max(0, -swing) * 0.9;
    p.legs[1].knee.rotation.x = Math.max(0, swing) * 0.9;
    const trayIdx = staff ? (fig.userData.trayArmIndex == null ? 1 : fig.userData.trayArmIndex) : -1;
    if (trayIdx !== 0) p.arms[0].rotation.x = -swing * 0.55;
    if (trayIdx !== 1) p.arms[1].rotation.x = swing * 0.55;
  }

  // Standing still: the walk cycle eases out rather than freezing mid-stride.
  function idlePose(w, dt) {
    const k = Math.min(1, dt * 4);
    w.parts.legs.forEach(({ hip, knee }) => {
      hip.rotation.x += (0 - hip.rotation.x) * k;
      knee.rotation.x += (0 - knee.rotation.x) * k;
    });
    // The tray arm stays fixed in its carry pose; the free arm (staff or
    // not) eases toward a hang like anyone else's.
    const trayIdx = w.staff ? (w.mesh.userData.trayArmIndex == null ? 1 : w.mesh.userData.trayArmIndex) : -1;
    w.parts.arms.forEach((a, i) => {
      if (i === trayIdx) return;
      a.rotation.x += (0 - a.rotation.x) * k;
    });
    w.mesh.position.y += (0 - w.mesh.position.y) * k;
  }

  /* ── Filling and emptying ─────────────────────────────────────────────── */
  function populate(hostScene, plan, opts) {
    if (!available() || !hostScene || !plan) return 0;
    clear();
    const o = opts || {};
    scene = hostScene;
    layout = { room: plan.room, items: (plan.items || []).slice() };
    room = { w: Math.max(2, Number(plan.room.w) || 24), h: Math.max(2, Number(plan.room.h) || 18) };
    if (o.density && DENSITY[o.density]) density = o.density;
    solids = o.solids || N.solidsOf(layout);
    navGrid = null;
    // A fresh room has no lines standing in it. Carrying the old counts over
    // would seat the first arrivals at the back of a queue that isn't there.
    queues = Object.create(null);

    const d = DENSITY[density];
    group = new T.Group();
    group.name = "hp-crowd";
    scene.add(group);

    if (d.seated > 0) {
      // The chairs the room was built with — found in the live scene, so a
      // guest can only ever be sat where scene3d.js actually put a chair.
      seatGuests(collectChairs(scene), d.seated);
    }
    if (d.walkers > 0) addWalkers(d.walkers);

    return seated.length + walkers.length;
  }

  function clear() {
    // Rigged clones share their geometry/skeleton with the one loaded model
    // (SkeletonUtils.clone doesn't copy buffers) — disposing it here would
    // blank out every future spawn, not just the figures leaving now. Only
    // the procedural figures own geometry outright.
    seated.forEach((s) => { if (s.mixer) s.mixer.stopAllAction(); });
    walkers.forEach((w) => { if (w.mixer) w.mixer.stopAllAction(); });
    if (group) {
      group.traverse((n) => {
        if (n.isMesh && n.geometry && !n.isSkinnedMesh) n.geometry.dispose();
      });
      if (group.parent) group.parent.remove(group);
    }
    group = null;
    seated = [];
    walkers = [];
    navGrid = null;
    queues = Object.create(null);
  }

  /* Changing density rebuilds the crowd rather than adding to it: the seated
     share is a proportion of the chairs, and topping one up would seat the
     new guests wherever the last shuffle happened to leave gaps. */
  function setDensity(name) {
    if (!DENSITY[name] || name === density) return;
    density = name;
    if (scene && layout) populate(scene, layout, { density: name, solids: solids });
  }

  return {
    available,
    populate,
    update,
    clear,
    setDensity,

    /* ── Shared with the walkthrough (js/simulate.js) ──────────────────
       Third person needs a BODY, and the room already has a body: the same
       one every guest in it wears. Handing the builder over rather than
       modelling a second one means the avatar walks with the crowd's walk,
       is the crowd's height, and re-dresses with the crowd when a setup is
       chosen — a walkthrough where the person you are looks different from
       the people you pass would read as two rooms composited together.

       `walkCycle` is the crowd's own gait, exported for the same reason:
       the avatar's legs and the guests' legs must move by one function, or
       the room's motion has two accents in it. */
    figure,
    waiter,
    walkCycle: gait,
    materials: buildMaterials,
    STAND_H,
    count: () => seated.length + walkers.length,
    _debugSeated: () => seated,
    seatedCount: () => seated.length,
    walkerCount: () => walkers.length,
    DENSITY_NAMES,
    DENSITY,
    get density() { return density; },

    /* Who is standing in which line, right now. Read by the simulation's
       status panel so "BUFFET — estimated queue: 6" is the number of people
       actually queuing in the room rather than a guess made beside it. */
    queueCounts() {
      const out = [];
      Object.keys(queues).forEach((key) => {
        if (!queues[key]) return;
        out.push({ kind: key.split("@")[0], waiting: queues[key] });
      });
      return out.sort((a, b) => b.waiting - a.waiting);
    },
  };
})();
