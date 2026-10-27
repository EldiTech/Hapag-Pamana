/* HapagPamana Layout Designer — cached Blender-authored GLB prototypes. */
window.HPAssets3D = (function () {
  "use strict";

  const T = window.THREE;
const URL = "../models/layout/hapag-layout-library.glb?v=20261027-blender-only-reverted-waiter";
  const DEFAULTS = Object.freeze({
    round: [1.5, 1.5], rect: [1.8, 0.75], cocktail: [0.7, 0.7],
    buffet: [4.0, 0.8], dessert: [2.0, 0.8], beverage: [1.6, 0.7],
    service: [1.5, 0.7], trash: [0.8, 0.6], stage: [6.0, 3.0],
    dance: [5.0, 5.0], bar: [2.4, 0.8], decor: [0.8, 0.8],
    dj: [1.8, 0.9], speaker: [0.5, 0.5], screen: [3.0, 0.3],
    photo: [2.0, 1.4], door: [0.9, 0.25], exit: [1.2, 0.25],
    other: [1.2, 1.2],
  });

  const prototypes = Object.create(null);
  const materials = Object.create(null);
  const footprints = Object.create(null);
  let loading = null;
  let loaded = false;

  const available = () => !!(T && T.GLTFLoader);

  function index(gltf) {
    /* Blender can export collection/empty nodes between the scene and an
       ASSET_* root. Walk the complete scene graph instead of assuming every
       asset is a direct child of gltf.scene. */
    const roots = [];
    gltf.scene.traverse((node) => {
      if (!node.name || node.name.indexOf("ASSET_") !== 0) return;
      roots.push(node);
    });
    roots.forEach((node) => {
      const key = node.name.slice(6);
      node.position.set(0, 0, 0);
      node.rotation.set(0, 0, 0);
      node.scale.set(1, 1, 1);
      node.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(node);
      const size = bounds.getSize(new T.Vector3());
      const fallback = DEFAULTS[key] || [1.2, 1.2];
      footprints[key] = {
        w: Number.isFinite(size.x) && size.x > 0.05 ? size.x : fallback[0],
        h: Number.isFinite(size.z) && size.z > 0.05 ? size.z : fallback[1],
        top: Number.isFinite(size.y) && size.y > 0.05 ? size.y : 0.9,
      };
      node.traverse((part) => {
        if (!part.isMesh) return;
        part.castShadow = true;
        part.receiveShadow = true;
        part.userData.hpSharedAsset = true;
        const list = Array.isArray(part.material) ? part.material : [part.material];
        list.forEach((mat) => { if (mat && mat.name) materials[mat.name] = mat; });
      });
      prototypes[key] = node;
    });
    loaded = Object.keys(prototypes).length > 0;
    window.dispatchEvent(new CustomEvent("hpassets3dready", {
      detail: { count: Object.keys(prototypes).length },
    }));
    return loaded;
  }

  function load() {
    if (loaded) return Promise.resolve(true);
    if (loading) return loading;
    if (!available()) return Promise.resolve(false);
    loading = new Promise((resolve) => {
      new T.GLTFLoader().load(URL, (gltf) => resolve(index(gltf)), undefined, (err) => {
        console.warn("HPAssets3D: Blender GLB unavailable; 3D items will remain unavailable.", err);
        loading = null;
        resolve(false);
      });
    });
    return loading;
  }

  function clone(key, item) {
    const source = prototypes[key];
    if (!source) return null;
    const copy = source.clone(true);
    copy.position.set(0, 0, 0);
    copy.rotation.set(0, 0, 0);
    copy.userData.hpSharedAsset = true;
    copy.traverse((part) => { part.userData.hpSharedAsset = true; });
    const dims = DEFAULTS[key] || (footprints[key] && [footprints[key].w, footprints[key].h]);
    if (dims && item) {
      copy.scale.set(
        Math.max(0.01, Number(item.w) || dims[0]) / dims[0],
        1,
        Math.max(0.01, Number(item.h) || dims[1]) / dims[1]
      );
    }
    return copy;
  }

  /* Runtime catalogue for the Layout Designer. The GLB is the source of
     truth for newly exported Blender roots; known roots keep their richer
     rules.js definitions, while unknown roots can still become selectable
     generic fixtures with their measured floor footprint. */
  function catalog() {
    return Object.keys(prototypes)
      .filter((key) => key !== "setting" && key !== "waiter" && key.indexOf("chair_") !== 0)
      .map((key) => Object.assign({ key }, footprints[key] || {}));
  }

  function colour(name, value) {
    const mat = materials[name];
    if (!mat || !value || !mat.color) return;
    mat.color.copy(value.isColor ? value : new T.Color(value));
    mat.needsUpdate = true;
  }

  function applyPalette(p) {
    if (!p) return;
    colour("HP_Cloth", p.cloth);
    colour("HP_Cream", p.cream || p.cloth);
    colour("HP_Wood", p.wood);
    colour("HP_WoodLight", p.woodLight || p.wood);
    colour("HP_Gold", p.gold);
    colour("HP_Wine", p.wine);
    colour("HP_Olive", p.olive);
    colour("HP_Leaf", p.leaf);
    colour("HP_Dark", p.dark);
  }

  return Object.freeze({
    available,
    load,
    ready: () => loaded,
    has: (key) => !!prototypes[key],
    clone,
    catalog,
    applyPalette,
    keys: () => Object.keys(prototypes),
    url: URL,
  });
})();
