/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — DRESSING THE ROOM.

   A setup on the Content Moderator's gallery is a photograph of a room that
   was actually dressed: a garden wedding, a gold gala, a rustic barn. This
   module reads the colours back out of that photograph and hands them to the
   3D view, so the plan can be seen in the scheme the couple chose rather
   than in the house's own paper-and-gold.

   ── Why the photo and not a colour picker ───────────────────────────────
   Because the photo is the data that already exists. A setup record is
   `{ title, image, visible }` — every one of them, going back. Asking the
   moderator to also enter five hex values would leave every existing setup
   themeless until someone went back through the gallery, and would ask a
   person to name a colour they can already see. The photograph IS the
   brief; this reads it.

   ── What comes out ──────────────────────────────────────────────────────
   Not a list of the five commonest pixels — that returns five near-identical
   creams for most banquet photography. The extractor clusters the image and
   then ASSIGNS the clusters to roles by what each role needs: linen wants
   the light, broad, unsaturated one; the accent wants the most colourful;
   uplight wants the most saturated dark. A role that finds no candidate
   falls back to the house palette, so a black-and-white photo dresses the
   room in the house scheme rather than in mud.

   Public API (window.HPTheme):
     fromImage(src)        → Promise<theme>   read a setup photo
     fromSetup(setup)      → Promise<theme>   ditto, with the title attached
     house()               → theme            the portal's own palette
     cache                 previously extracted themes, by image key
   ════════════════════════════════════════════════════════════════ */
window.HPTheme = (function () {
  "use strict";

  const S = () => window.HPScene;

  /* The sample grid. 48×48 is about 2 300 pixels — enough that a chair sash
     occupying 3% of a photo still lands its own cluster, small enough that
     the whole extraction is a few milliseconds and can run on selection
     rather than needing a build step. */
  const GRID = 48;
  const K = 6;              // clusters; five roles plus one for the wall/floor
  const ITERS = 12;         // k-means passes — converges well before this

  /* ── Colour helpers ───────────────────────────────────────────────────
     Working in HSL for the role assignment, because the questions being
     asked are "how colourful is this" and "how light is this", and those are
     one channel each in HSL and three coupled ones in RGB. */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h, s, l };
  }

  function hslToHex(h, s, l) {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(v * 255);
    };
    return rgb(f(0), f(8), f(4));
  }

  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  const rgb = (r, g, b) => "#" + hex2(r) + hex2(g) + hex2(b);

  /* A colour with so little saturation that its HUE is noise. Below this a
     cluster is a grey, and its hue is whatever rounding the camera's sensor
     happened to do — pushing it up to a band's minimum would invent a colour
     the photograph does not contain. */
  const GREY = 0.06;

  /* Nudge a colour into a range that WORKS as a finish. A tablecloth pulled
     straight out of a photograph carries that photograph's exposure with it;
     dropped into a lit 3D room it comes back either black or blown out. Each
     role clamps lightness and saturation to the band its material can
     actually render in.

     The one thing it will NOT do is raise a grey into a colour. A band's
     saturation floor exists to stop a washed-out sash reading as beige, not
     to tint a black-and-white photograph — so a cluster under GREY keeps its
     own (absent) saturation and comes back grey, which is what the photo
     says. Returns null when the fitted colour would be a lie. */
  function fit(c, band, allowGrey) {
    const h = rgbToHsl(c.r, c.g, c.b);
    if (h.s < GREY && !allowGrey) return null;
    const s = h.s < GREY ? h.s : Math.max(band.s[0], Math.min(band.s[1], h.s));
    const l = Math.max(band.l[0], Math.min(band.l[1], h.l));
    return hslToHex(h.h, s, l);
  }

  /* ── Sampling ─────────────────────────────────────────────────────────
     The photo drawn small onto a canvas and read back. Downscaling in the
     browser's own resampler is both faster and better than sampling every
     nth pixel by hand — it averages rather than picks, so a single stray
     highlight can't become a cluster of its own. */
  function sample(img) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = GRID;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, GRID, GRID);
    let data;
    try {
      data = cx.getImageData(0, 0, GRID, GRID).data;
    } catch (e) {
      // A cross-origin image taints the canvas. Setup photos are stored as
      // inline data URLs so this shouldn't fire, but a themed room is not
      // worth throwing a page over.
      return null;
    }
    const pts = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;                 // skip transparency
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Near-black and near-white are the photograph's shadows and its
      // blown highlights, not its scheme. They dominate a mean if kept.
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 18 || mn > 246) continue;
      pts.push({ r, g, b });
    }
    return pts.length > 24 ? pts : null;
  }

  /* ── k-means ──────────────────────────────────────────────────────────
     Plain Lloyd's algorithm in RGB. Seeded by spreading the initial centres
     across the sorted-by-luminance samples rather than at random: a random
     seed on a photograph of a mostly-cream room lands three centres inside
     the same cream and returns a palette of one colour, and it returns a
     DIFFERENT one-colour palette every time the designer reopens the
     picker. Deterministic seeding means the same photo always themes the
     same way, which matters more here than cluster quality. */
  function cluster(pts) {
    const lum = (p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;
    const sorted = pts.slice().sort((a, b) => lum(a) - lum(b));
    let centres = [];
    for (let i = 0; i < K; i++) {
      const p = sorted[Math.floor(((i + 0.5) / K) * sorted.length)];
      centres.push({ r: p.r, g: p.g, b: p.b });
    }

    let assign = new Int32Array(pts.length);
    for (let it = 0; it < ITERS; it++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        let best = 0, bestD = Infinity;
        for (let c = 0; c < centres.length; c++) {
          const q = centres[c];
          const d = (p.r - q.r) ** 2 + (p.g - q.g) ** 2 + (p.b - q.b) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
        if (assign[i] !== best) { assign[i] = best; moved = true; }
      }
      const sums = centres.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
      for (let i = 0; i < pts.length; i++) {
        const s = sums[assign[i]], p = pts[i];
        s.r += p.r; s.g += p.g; s.b += p.b; s.n++;
      }
      centres = centres.map((c, i) => (sums[i].n
        ? { r: sums[i].r / sums[i].n, g: sums[i].g / sums[i].n, b: sums[i].b / sums[i].n }
        : c));
      if (!moved) break;
    }

    // Each cluster with the share of the image it covers — the weight is what
    // separates "the linen" from "one napkin".
    const counts = centres.map(() => 0);
    for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
    return centres.map((c, i) => {
      const h = rgbToHsl(c.r, c.g, c.b);
      return { r: c.r, g: c.g, b: c.b, share: counts[i] / pts.length, h: h.h, s: h.s, l: h.l };
    }).filter((c) => c.share > 0.01);
  }

  /* ── Roles ────────────────────────────────────────────────────────────
     The bands each finish has to land in to read as that finish under the
     room's warm lighting. These are the difference between "the photo's
     colours" and "a room dressed in the photo's colours". */
  const BAND = {
    cloth:  { s: [0.02, 0.85], l: [0.20, 0.94] },   // linen: pale, rich, or deep tablecloths
    accent: { s: [0.20, 0.90], l: [0.25, 0.75] },   // sashes, runners, bar
    drape:  { s: [0.10, 0.65], l: [0.18, 0.65] },   // stage backdrop
    bloom:  { s: [0.15, 0.80], l: [0.25, 0.70] },   // floral accents
    uplight:{ s: [0.25, 1.00], l: [0.35, 0.75] },   // wall lighting
    wall:   { s: [0.02, 0.35], l: [0.45, 0.94] },
    floor:  { s: [0.02, 0.40], l: [0.35, 0.88] },
  };

  /* Pick the cluster that best fits a role, by a small scoring function per
     role rather than by rank order. Scoring beats ranking because the roles
     want genuinely different things — the linen wants the BIGGEST pale area
     and the accent wants the most saturated one regardless of size, and a
     single sort can't serve both. */
  function assignRoles(cl) {
    const used = new Set();
    /* Prefer a cluster no other role has taken — four roles reading the same
       dominant colour would theme the whole room one flat shade. But a photo
       with only three colours in it has only three colours in it, and a role
       left empty falls back to the HOUSE scheme, which is worse: a burgundy
       barn would get a green house bloom sitting in the middle of it. So an
       exhausted role re-uses the best-scoring cluster it can see, and the
       band it is fitted through pulls that shared colour somewhere different
       enough to read as its own finish. */
    const pick = (score) => {
      let best = null, bestV = -Infinity;
      let anyBest = null, anyV = -Infinity;
      cl.forEach((c, i) => {
        const v = score(c);
        if (v > anyV) { anyV = v; anyBest = i; }
        if (used.has(i)) return;
        if (v > bestV) { bestV = v; best = i; }
      });
      const chosen = best != null ? best : anyBest;
      if (chosen == null) return null;
      used.add(chosen);
      return cl[chosen];
    };

    // Linen: pale and broad. Lightness carries most of the weight, area
    // breaks the ties — the cloth is usually the largest light thing in a
    // banquet photograph.
    const cloth = pick((c) => c.l * 2.2 + c.share * 1.4 - c.s * 0.7);
    // Accent: the most colourful thing in the room, whatever its size. This
    // is the sash, the runner, the charger plate — the decision the couple
    // actually made.
    const accent = pick((c) => c.s * 2.6 + (1 - Math.abs(c.l - 0.48)) * 0.9);
    // Drape: darker, still with some colour in it — the backdrop reads as
    // depth behind the stage, so it must not compete with the accent.
    const drape = pick((c) => (1 - c.l) * 1.8 + c.s * 0.7 + c.share * 0.5);
    // Bloom: colourful and mid — what is left of the florals.
    const bloom = pick((c) => c.s * 1.7 + (1 - Math.abs(c.l - 0.5)) * 1.1);
    /* The shell, chosen from EVERY cluster rather than from what the dressed
       roles left behind.

       A wall and a floor are the two largest surfaces in any photograph of a
       room, and in a bright ballroom the wall, the ceiling and the linen are
       all the same cream — so the wall's best match is usually a cluster the
       linen has already taken. Making it queue behind four other roles hands
       it whatever scrap is left, which is how a photograph of a bright cream
       ballroom produced a grey wall darker than the house's own. Sharing is
       correct here: the band each is fitted through keeps them distinct. */
    const best = (score) => {
      let win = null, winV = -Infinity;
      cl.forEach((c) => { const v = score(c); if (v > winV) { winV = v; win = c; } });
      return win;
    };
    const wall = best((c) => c.l * 2.4 + c.share * 1.1 - c.s * 1.3);
    /* The floor wants a large, UNSATURATED, light surface. Area alone is not
       enough: in a ballroom shot the widest single band is usually the gold
       of the chairs and linens, and letting area win handed the floor that
       gold — a bright room walked on a floor darker than the house's own.
       Lightness is weighted above area, and saturation is penalised hard,
       because a floor is the one surface in the room that is never the
       scheme's colour. */
    const floor = best((c) => c.l * 1.9 + c.share * 1.0 - c.s * 2.2);
    // Uplight re-uses the accent's HUE rather than claiming a cluster: a
    // wash on the wall is the scheme's colour at full saturation, and
    // spending a cluster on it would take one away from a surface.
    return { cloth, accent, drape, bloom, wall, floor };
  }

  /* How bright the ROOM in the photograph is, 0..1 — the area-weighted mean
     lightness of everything read.

     This is the difference between a candlelit barn and a midday ballroom,
     and it is a property of the whole image rather than of any one cluster,
     so it is measured here rather than assigned to a role. The walkthrough
     uses it to set its exposure: a photograph of a bright room should walk
     as a bright room. */
  function brightnessOf(cl) {
    let sum = 0, w = 0;
    cl.forEach((c) => { sum += c.l * c.share; w += c.share; });
    return w ? sum / w : 0.5;
  }

  /* The house scheme, read off the live stylesheet — the fallback for every
     role that finds nothing, and the theme the room wears with no setup
     chosen. */
  function house() {
    const Sc = S();
    const C = Sc && Sc.available() ? Sc.palette() : null;
    const hx = (c, fb) => (c && c.getHexString ? "#" + c.getHexString() : fb);
    return {
      id: "", title: "House scheme", image: "",
      cloth:   hx(C && C.cloth, "#FFFBF0"),
      accent:  hx(C && C.gold,  "#A9823C"),
      drape:   hx(C && C.cloth, "#FFFBF0"),
      bloom:   hx(C && C.leaf,  "#5C7A33"),
      uplight: hx(C && C.gilt,  "#DCB661"),
      wall:    hx(C && C.wall,  "#F8F1DE"),
      floor:   hx(C && C.floor, "#E7D8B5"),
      brightness: 0.62,
      swatch:  [],
      house: true,
    };
  }

  /* ── The public read ──────────────────────────────────────────────────
     Cached by image, because the picker shows every setup's swatch strip at
     once and re-clustering six photographs on every repaint is work the
     answer never changes for. */
  const cache = Object.create(null);
  const keyOf = (src) => (src || "").slice(-96);

  function fromImage(src) {
    if (!src) return Promise.resolve(house());
    const key = keyOf(src);
    if (cache[key]) return Promise.resolve(cache[key]);

    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const pts = sample(img);
        const base = house();
        if (!pts) return resolve(base);
        const cl = cluster(pts);
        if (!cl.length) return resolve(base);

        const r = assignRoles(cl);
        /* Linen and drape are allowed to come back grey — a white cloth and a
           charcoal backdrop are both real and both common. The accent and the
           bloom are not: those roles exist to carry the scheme's COLOUR, and
           a grey one means the photograph had no scheme to read, so they fall
           back to the house. That is the whole of the black-and-white case. */
        const cloth  = r.cloth  && fit(r.cloth,  BAND.cloth, true);
        const drape  = r.drape  && fit(r.drape,  BAND.drape, true);
        const accent = r.accent && fit(r.accent, BAND.accent);
        const bloom  = r.bloom  && fit(r.bloom,  BAND.bloom);
        // The shell is allowed to be grey: most function rooms have cream or
        // grey walls and a neutral floor, and that is a real reading, not the
        // absence of one.
        const wall   = r.wall   && fit(r.wall,   BAND.wall, true);
        const floorC = r.floor  && fit(r.floor,  BAND.floor, true);

        const theme = {
          id: "", title: "", image: src,
          cloth:  cloth  || base.cloth,
          accent: accent || base.accent,
          drape:  drape  || base.drape,
          bloom:  bloom  || base.bloom,
          wall:   wall   || base.wall,
          floor:  floorC || base.floor,
          // How bright the photographed room is. The walkthrough reads this
          // to set its exposure — see gelFor/exposureFor in js/simulate.js.
          brightness: brightnessOf(cl),
          // The wash takes the accent's hue at the band's own saturation, so
          // the uplighting and the sashes are visibly the same decision. With
          // no accent to take a hue from there is no scheme to wash the walls
          // in, and the house's own warm gilt is the honest answer.
          uplight: (accent && r.accent)
            ? hslToHex(r.accent.h,
                Math.max(BAND.uplight.s[0], Math.min(BAND.uplight.s[1], r.accent.s * 1.35)),
                Math.max(BAND.uplight.l[0], Math.min(BAND.uplight.l[1], 0.56)))
            : base.uplight,
          // The clusters themselves, biggest first — the picker's swatch
          // strip, so a designer can see what was read before committing.
          swatch: cl.slice().sort((a, b) => b.share - a.share).slice(0, 5)
            .map((c) => rgb(c.r, c.g, c.b)),
          // A photograph with no colour in it read no scheme, whatever it
          // read in the way of greys. The picker says so rather than offering
          // a "theme" that is the house scheme with extra steps.
          house: !accent,
        };
        cache[key] = theme;
        resolve(theme);
      };
      // A photo that won't load themes as the house, silently: the gallery
      // already shows a broken thumbnail, and a second complaint here adds
      // nothing the designer can act on.
      img.onerror = () => resolve(house());
      img.src = src;
    });
  }

  function fromSetup(setup) {
    if (!setup) return Promise.resolve(house());
    return fromImage(setup.image).then((t) => Object.assign({}, t, {
      id: setup.id || "",
      title: setup.title || "",
    }));
  }

  return { fromImage, fromSetup, house, cache, rgbToHsl, hslToHex };
})();
