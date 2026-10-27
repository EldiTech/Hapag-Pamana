/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — rigged crowd models.

   Loads the Mixamo character once (skeleton + mesh) and its animation
   clips (idle, walking, a few sitting variants), then hands out cheap
   SkeletonUtils clones for js/crowd.js to place and animate. One GPU
   upload for the mesh no matter how many guests are in the room.

   Public API (window.HPModels):
     available()   Three + FBXLoader present?
     ready()        has load() finished?
     load()         fetch + parse the FBX set, once (idempotent)
     spawn()         → { root, mixer, actions } a fresh clone, posed and wired
     actionNames     the clip names spawn() actions are keyed by
   ════════════════════════════════════════════════════════════════ */
window.HPModels = (function () {
  "use strict";

  const T = window.THREE;
  // Forced off: "Polish primitives only" — the rigged Mixamo crowd is
  // parked here (code intact, untouched otherwise) rather than removed, in
  // case a clean set of exports shows up later. Every caller already
  // treats a false available() as "no rig, use the code-built figures" —
  // that fallback is what js/crowd.js's figure()/waiter() path is for, and
  // it needs no changes to carry the whole crowd on its own.
  const available = () => false;

  const BASE = "../models/";
  const FILES = {
    character: "character.fbx",
    idle: "idle.fbx",
    walking: "walking.fbx",
    sitting_talking: "sitting_talking.fbx",
  };
  // Mixamo exports at roughly this height (cm-scale units); scaled to the
  // room's metres so a guest stands about as tall as the procedural figure
  // it replaces.
  const TARGET_HEIGHT = 1.72;

  let loading = null;      // in-flight promise, so concurrent callers share it
  let loaded = false;
  let baseRoot = null;      // the character, never itself placed in the scene
  let baseScale = 1;
  let clips = {};           // name -> AnimationClip
  let idleIsWalkFallback = false;   // true when idle.fbx's clip was empty
  let seatDrops = {};       // sitting clip name -> world-space Y its pelvis rests at

  // A Mixamo sitting clip animates the Hips bone down onto whatever chair
  // height Mixamo's own preview scene used — not this room's chairs, which
  // range from a 0.44 m banquet seat to a 0.75 m stool. Placing a rigged
  // guest's root at y=0 (as if standing) leaves the clip's own seat height
  // baked in regardless of the actual chair under them, which is what put
  // guests floating above low chairs with their legs still reaching for a
  // taller one that isn't there.
  //
  // Measured once per clip rather than guessed: a throwaway clone, posed
  // mid-clip and never added to the scene, gives the Hips bone's resting
  // world Y with the root still at the origin — exactly the amount a real
  // guest's root has to be shifted by to put that same Hips bone on THIS
  // chair's own seat top instead of Mixamo's.
  function measureSeatDrops() {
    if (!T.SkeletonUtils || !baseRoot) return;
    SITTING_NAMES.forEach((name) => {
      const clip = clips[name];
      if (!clip || !clip.tracks.length) return;
      const probe = T.SkeletonUtils.clone(baseRoot);
      probe.scale.setScalar(baseScale);
      probe.position.set(0, 0, 0);
      probe.updateMatrixWorld(true);
      const mixer = new T.AnimationMixer(probe);
      mixer.clipAction(clip).play();
      // Sampled from the settled back end of the clip, not its midpoint —
      // the clip's front holds the walk-up-and-sit-down transition, and a
      // Hips reading taken mid-transition would seat every guest at the
      // wrong height (see crowd.js: seatRiggedGuest, same 70% clamp).
      mixer.update(clip.duration * 0.85);
      probe.updateMatrixWorld(true);
      let hipsY = null;
      probe.traverse((n) => {
        if (hipsY === null && n.isBone && /Hips$/.test(n.name)) {
          const p = new T.Vector3();
          n.getWorldPosition(p);
          hipsY = p.y;
        }
      });
      if (hipsY !== null) seatDrops[name] = hipsY;
      mixer.stopAllAction();
    });
  }

  function loadFBX(loader, name) {
    return new Promise((resolve, reject) => {
      loader.load(BASE + FILES[name], resolve, undefined, reject);
    });
  }

  function load() {
    if (loaded) return Promise.resolve(true);
    if (loading) return loading;
    if (!available()) return Promise.resolve(false);

    const loader = new T.FBXLoader();
    loading = Promise.all([
      loadFBX(loader, "character"),
      loadFBX(loader, "idle"),
      loadFBX(loader, "walking"),
      loadFBX(loader, "sitting_talking"),
    ]).then(([character, idle, walking, sittingTalking]) => {
      baseRoot = character;
      baseRoot.traverse((n) => {
        if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; }
      });

      // Scale once, from the loaded mesh's own bounding box, so a different
      // Mixamo export (a taller/shorter character) still lands at the
      // room's own human scale instead of whatever units Mixamo shipped.
      const box = new T.Box3().setFromObject(baseRoot);
      const h = box.max.y - box.min.y;
      baseScale = h > 0 ? TARGET_HEIGHT / h : 0.01;

      // A bad Mixamo export (skeleton exported "without animation") ships a
      // clip with zero tracks — the mixer plays it, but with nothing to
      // drive the bones a played empty clip holds the rig's bind pose, i.e.
      // a T-pose, forever. Caught here rather than left to surface as a
      // silent T-posed stander: fall back to the walking clip, paused at
      // frame 0 in spawn() below, which is a real standing frame instead of
      // the bind pose.
      const idleClip = idle.animations[0];
      const idleBroken = !idleClip || !idleClip.tracks || !idleClip.tracks.length;
      if (idleBroken) {
        console.warn("HPModels: idle.fbx has no animation tracks — standing guests will use a paused walking frame until it's re-exported.");
      }

      clips = {
        idle: idleBroken ? walking.animations[0] : idleClip,
        walking: walking.animations[0],
        sitting_talking: sittingTalking.animations[0],
      };
      idleIsWalkFallback = idleBroken;
      measureSeatDrops();

      loaded = true;
      return true;
    }).catch((err) => {
      console.warn("HPModels: FBX load failed, crowd falls back to primitives.", err);
      loading = null;
      return false;
    });
    return loading;
  }

  // sitting.fbx and sitting_pointing.fbx were dropped from the model set
  // entirely (deleted from models/, no longer in FILES above): sitting.fbx's
  // export left every guest crouched half off the chair rather than resting
  // back in the seat — a bad take, confirmed by isolating each clip in turn
  // — and sitting_pointing's extended arm reached past a banquet chair's own
  // footprint into the neighbouring seat or the table. Re-add both to FILES
  // and here once re-exported from Mixamo.
  const SITTING_NAMES = ["sitting_talking"];

  /* Mixamo ships its default character in one placeholder skin — a flat
     pink mannequin material, never meant to be the final look. Recolouring
     it here (rather than leaving the Mixamo texture) is what keeps the
     rigged crowd wearing the room's own palette instead of reading as
     untextured test dummies. Every mesh on the clone gets its own material
     instance first — clones start out SHARING the base's materials, and
     recolouring a shared one would recolour every guest at once. */
  function recolour(root, tint) {
    root.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      const fresh = mats.map((m) => {
        const c = m.clone();
        c.color = new T.Color(tint);
        c.map = null;          // drop the Mixamo placeholder texture
        return c;
      });
      n.material = Array.isArray(n.material) ? fresh : fresh[0];
    });
  }

  /* A fresh instance: SkeletonUtils.clone gives it its own skeleton (so two
     guests can play different clips), the mixer drives whichever named
     action is playing, and every clip is registered up front so switching
     is a crossFade rather than a re-bind.

     `tint` is the caller's — js/crowd.js owns the room's actual palette
     (the house scheme or a chosen setup's colours), so the model loader
     takes whatever colour it's handed rather than picking its own. */
  function spawn(tint) {
    if (!loaded || !baseRoot) return null;
    const root = T.SkeletonUtils.clone(baseRoot);
    root.scale.setScalar(baseScale);
    // A falsy check would skip a guest whose palette colour happens to be
    // pure black (0x000000, a valid colour but a falsy number) — checking
    // for "was one passed at all" instead.
    if (tint !== undefined && tint !== null) recolour(root, tint);
    const mixer = new T.AnimationMixer(root);
    const actions = {};
    Object.keys(clips).forEach((name) => {
      if (!clips[name]) return;
      actions[name] = mixer.clipAction(clips[name]);
    });
    // The idle fallback is the walking clip itself. A Mixamo walk loop has
    // no neutral "feet together" frame to pause on — every frame is some
    // mid-stride pose, so freezing it (as tried first) just swaps a T-pose
    // for a figure frozen leaning into a step, which reads just as wrong on
    // a "standing" guest. Left running at a crawl instead: still technically
    // striding, but slow enough to read as shifting weight while standing
    // rather than a stuck lunge. Beats a T-pose while idle.fbx waits on a
    // proper re-export.
    if (idleIsWalkFallback && actions.idle) {
      actions.idle.play();
      actions.idle.timeScale = 0.06;
    }
    return { root, mixer, actions };
  }

  /* ── Procedural sitting, on the rigged skeleton ─────────────────────────
     Every Mixamo sitting export tried so far has shipped broken in some
     way — idle.fbx with no tracks, sitting.fbx crouched off the chair,
     sitting_talking.fbx clean everywhere except the frames its own gesture
     leans into. A baked clip can only ever be as good as its own worst
     frame, and this app has burned through three of them.

     This instead poses the standard Mixamo bone names directly, the same
     hip-forward/knee-back-to-compensate arithmetic js/crowd.js already uses
     to sit the PRIMITIVE figures — ported to rotate real bones instead of
     primitive groups. A rotation computed from the chair's own seat height
     can't have a bad frame: there's no clip to scrub through, so there's
     nothing in it to go wrong. It costs the small idle motion a mocap clip
     gives for free, but every guest lands seated correctly on every chair,
     which none of the three exports have managed on their own. */
  const BONES = {
    hipsL: "LeftUpLeg", kneeL: "LeftLeg",
    hipsR: "RightUpLeg", kneeR: "RightLeg",
    shoulderL: "LeftArm", shoulderR: "RightArm",
    elbowL: "LeftForeArm", elbowR: "RightForeArm",
    spine: "Spine",
  };

  // Mixamo prefixes every bone with "mixamorig" on some exports and not
  // others (depends on the export's "without skin" option) — matched by
  // suffix so either shape resolves, rather than assuming one.
  function findBones(root) {
    const want = {}; Object.keys(BONES).forEach((k) => { want[BONES[k]] = k; });
    const found = {};
    root.traverse((n) => {
      if (!n.isBone) return;
      const bare = n.name.replace(/^mixamorig/, "");
      if (want[bare] && !found[want[bare]]) found[want[bare]] = n;
    });
    return found;
  }

  /* Sit a rigged instance down procedurally: hip pitched forward, knee bent
     back by the same angle so the shin still hangs straight to the floor
     regardless of how far forward the thigh swings (identical reasoning to
     crowd.js's HIP_ANGLE/knee solve for the primitive figures — a fixed
     knee angle only cancels the hip correctly at one thigh angle and
     splays the shin for any other), forearms folded in toward a table.
     `pad` is the actual chair's own seat height — read here only to decide
     a stool-perch vs a banquet-chair fold, the same `perched` threshold
     crowd.js uses; the ROOT's height on that chair is still handled by
     crowd.js positioning the root at the seat top directly; a procedural
     pose has no baked hip-drop to correct for, unlike a clip. */
  function poseSitting(root, pad) {
    const b = findBones(root);
    if (!b.hipsL || !b.hipsR) return false;
    const perched = pad > 0.6;
    const HIP_ANGLE = perched ? 0.2 : 1.4;   // bone-local +X is forward-down on a Mixamo leg
    [[b.hipsL, b.kneeL], [b.hipsR, b.kneeR]].forEach(([hip, knee], i) => {
      if (!hip) return;
      hip.rotation.x = HIP_ANGLE;
      if (knee) knee.rotation.x = -HIP_ANGLE + (perched ? 0 : 0.25);
      hip.rotation.z = (i ? -1 : 1) * (Math.random() * 0.05);
    });
    if (b.shoulderL) { b.shoulderL.rotation.z = 1.15; b.shoulderL.rotation.x = 0.15; }
    if (b.shoulderR) { b.shoulderR.rotation.z = -1.15; b.shoulderR.rotation.x = 0.15; }
    if (b.elbowL) b.elbowL.rotation.y = -1.1;
    if (b.elbowR) b.elbowR.rotation.y = 1.1;
    if (b.spine) b.spine.rotation.x = 0.08;
    return true;
  }

  return {
    available,
    ready: () => loaded,
    load,
    spawn,
    randomSittingAction: () => SITTING_NAMES[(Math.random() * SITTING_NAMES.length) | 0],
    actionNames: Object.keys(FILES).filter((k) => k !== "character"),
    get idleIsFallback() { return idleIsWalkFallback; },
    // How far below a chair's own seat top a rigged guest's root has to be
    // placed so that clip's Hips bone lands ON that seat rather than
    // wherever Mixamo's own authoring chair put it. 0 (no correction) for a
    // clip that wasn't measured — better than crashing crowd.js.
    seatDropOf: (name) => (typeof seatDrops[name] === "number" ? seatDrops[name] : 0),
    poseSitting,
  };
})();
