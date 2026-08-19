/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — NAVIGATION.

   The floor plan, understood as a space a body moves through. Two things
   live here, and they are deliberately the same two things:

     · AABB collision — every piece on the plan as an axis-aligned box, and
       the swept resolution that stops a walker at its edge;
     · A* pathfinding — a walkable grid derived from those same boxes, and
       the shortest route across it.

   Keeping them in one module is the point. If collision used the meshes and
   pathfinding used the plan, the simulator would stop you at an edge the
   route-finder was happily walking through. Here, `solidsOf()` builds the
   boxes once and BOTH systems read them, so "can I walk there" has exactly
   one answer.

   Everything is in PLAN METRES with the origin at the room's top-left — the
   coordinate space the 2D sheet already uses. Callers that need world space
   (the 3D walkthrough) convert on the way out, using HPScene.toWorld, so the
   conversion also exists in only one place.

   ── Why AABB, and not the rotated rectangle ─────────────────────────────
   A rotated table gets the axis-aligned box around its rotated footprint,
   which is slightly generous at 45°. That is the right direction to be wrong:
   it can say "you couldn't quite squeeze past", never "you walked through a
   table leg". Exactness here would cost an SAT test per piece per frame and
   buy a few centimetres nobody is measuring.

   Public API (window.HPNav):
     solidsOf(layout, opts)      → [{x0,y0,x1,y1,top,item,kind}]
     resolve(solids, from, to, r, bounds, gaps)  → {x,y,hitX,hitY}
     grid(layout, opts)          → walkable grid + helpers
     findPath(grid, from, to)    → [{x,y}] in metres, or null
     reachable(grid, from)       → flood-filled reachable cell count
     clearanceAt(solids, x, y)   → metres to the nearest solid
   ════════════════════════════════════════════════════════════════ */
window.HPNav = (function () {
  "use strict";

  /* Which pieces are walked THROUGH and how tall each stands now come from
     the catalogue in js/rules.js, so a new kind is defined once rather than
     being added here, in the 3D builder and in the palette separately.

     The fallbacks below are what this module used before that file existed;
     they are kept so nav still answers correctly if rules.js failed to load,
     rather than treating every piece in the room as thin air. */
  const R = window.HPRules || null;

  /* A guest's shoulders. Every clearance number in this file is measured
     against a body this wide, which is why 1.2 m reads as "a service aisle"
     and 0.6 m reads as "nobody is getting through there". Read from
     js/rules.js's own CAMERA.radius — the walkthrough body's own size —
     rather than a second literal here: the player's actual collision sweep
     (js/simulate.js) already reads that same number, so this module's
     "every clearance is measured against a body this wide" claim would be
     false the moment the two values were tuned separately. 0.28 is kept
     only as the fallback if rules.js failed to load. */
  const BODY_R = (R && R.CAMERA && R.CAMERA.radius) || 0.28;
  const CELL = 0.25;          // pathfinding grid resolution, metres
  const SQRT2 = Math.SQRT2;
  const PASSABLE = { spawn: 1, dance: 1, door: 1, exit: 1, kitchen: 1 };
  const HEIGHT = {
    round: 1.1, rect: 1.1, buffet: 1.1, bar: 1.15,
    stage: 0.4, decor: 1.4, other: 0.9,
  };
  const STEP = 0.45;          // a stage deck is a step up, not a wall

  const passableKind = (k) => (R ? R.isPassable(k) : !!PASSABLE[k]);
  const heightOfKind = (k) => {
    if (R) return R.heightOf(k);
    return HEIGHT[k] != null ? HEIGHT[k] : 0.9;
  };

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  /* ── AABB solids ──────────────────────────────────────────────────────
     One box per impassable piece, in plan metres. `top` carries the height so
     a caller standing on a stage deck can be let through the deck's own box. */
  function solidsOf(layout, opts) {
    const o = opts || {};
    const out = [];
    (((layout && layout.items) || [])).forEach((it) => {
      const kind = String(it.kind || "other");
      if (passableKind(kind) && !o.includePassable) return;

      const w = Math.max(0.05, num(it.w, 1));
      const h = Math.max(0.05, num(it.h, 1));
      const cx = num(it.x, 0) + w / 2;
      const cy = num(it.y, 0) + h / 2;
      const rot = num(it.rot, 0) * Math.PI / 180;
      // The axis-aligned box around the rotated footprint.
      const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      const hw = (w * c + h * s) / 2;
      const hh = (w * s + h * c) / 2;

      out.push({
        x0: cx - hw, y0: cy - hh,
        x1: cx + hw, y1: cy + hh,
        top: heightOfKind(kind),
        kind, item: it,
      });
    });
    return out;
  }

  /* ── AABB resolution ──────────────────────────────────────────────────
     A step from `from` to `to` for a body of radius `r`, resolved one axis at
     a time. Axis separation is what produces sliding: blocked northward, the
     eastward part of the motion survives, which is how a body actually moves
     along the edge of a table rather than sticking to it.

     `bounds` is the room; `gaps` are the doorways in it, so a wall crossing
     inside an opening is allowed through. `feet` lets a caller standing on a
     low solid (a stage) pass over it. */
  function resolve(solids, from, to, r, bounds, gaps, feet) {
    const R = r != null ? r : BODY_R;
    const out = { x: to.x, y: to.y, hitX: false, hitY: false };
    const foot = feet || 0;

    if (bounds) {
      const g = gaps || {};
      const within = (list, at) => {
        for (let i = 0; i < (list || []).length; i++) {
          if (at > list[i].from + R * 0.6 && at < list[i].to - R * 0.6) return true;
        }
        return false;
      };
      // Walls, unless the crossing happens inside a doorway.
      if (out.x < R && !within(g.west, out.y)) { out.x = R; out.hitX = true; }
      if (out.x > bounds.w - R && !within(g.east, out.y)) { out.x = bounds.w - R; out.hitX = true; }
      if (out.y < R && !within(g.north, out.x)) { out.y = R; out.hitY = true; }
      if (out.y > bounds.h - R && !within(g.south, out.x)) { out.y = bounds.h - R; out.hitY = true; }
    }

    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (foot > s.top - 0.02) continue;    // standing above it

      // X against the position already settled in Y.
      if (out.x + R > s.x0 && out.x - R < s.x1 &&
          from.y + R > s.y0 && from.y - R < s.y1) {
        out.x = from.x < (s.x0 + s.x1) / 2 ? s.x0 - R : s.x1 + R;
        out.hitX = true;
      }
      // Then Y, against the corrected X.
      if (out.y + R > s.y0 && out.y - R < s.y1 &&
          out.x + R > s.x0 && out.x - R < s.x1) {
        out.y = from.y < (s.y0 + s.y1) / 2 ? s.y0 - R : s.y1 + R;
        out.hitY = true;
      }
    }
    return out;
  }

  // The height of the floor at a point — the top of any low solid standing
  // there (a stage deck), so steps are climbable rather than walls.
  function floorAt(solids, x, y) {
    let f = 0;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.top > STEP) continue;
      if (x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1) f = Math.max(f, s.top);
    }
    return f;
  }

  // Distance from a point to the nearest solid edge — 0 inside one. This is
  // the number every clearance warning is phrased in.
  function clearanceAt(solids, x, y) {
    let d = Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (s.top <= STEP) continue;                 // steppable, not an obstacle
      const dx = Math.max(s.x0 - x, 0, x - s.x1);
      const dy = Math.max(s.y0 - y, 0, y - s.y1);
      d = Math.min(d, Math.hypot(dx, dy));
      if (d === 0) return 0;
    }
    return d === Infinity ? 99 : d;
  }

  /* ── The walkable grid ────────────────────────────────────────────────
     A cell is walkable when a body of BODY_R centred on it clears every
     solid. Inflating the obstacles by the body radius (rather than testing a
     point) is what makes a path the grid finds a path a person can actually
     take — a point-sized walker happily threads a 5 cm gap between two
     tables that no guest could use.

     The room is padded by one cell so a doorway on the wall line has a cell
     to stand in on both sides. */
  function grid(layout, opts) {
    const o = opts || {};
    const cell = o.cell || CELL;
    const R = o.radius != null ? o.radius : BODY_R;
    const room = (layout && layout.room) || { w: 24, h: 18 };
    const solids = o.solids || solidsOf(layout);

    const cols = Math.max(1, Math.ceil(room.w / cell));
    const rows = Math.max(1, Math.ceil(room.h / cell));
    const walk = new Uint8Array(cols * rows);

    // Mark every cell whose inflated footprint is clear.
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cell;
        const y = (j + 0.5) * cell;
        let ok = x >= R && y >= R && x <= room.w - R && y <= room.h - R;
        if (ok) {
          for (let k = 0; k < solids.length; k++) {
            const s = solids[k];
            if (s.top <= STEP) continue;           // walk over a stage deck
            if (x > s.x0 - R && x < s.x1 + R && y > s.y0 - R && y < s.y1 + R) { ok = false; break; }
          }
        }
        walk[j * cols + i] = ok ? 1 : 0;
      }
    }

    return {
      cell, cols, rows, room, solids, radius: R, walk,
      idx: (i, j) => j * cols + i,
      at: (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : walk[j * cols + i]),
      toCell: (x, y) => ({ i: Math.floor(x / cell), j: Math.floor(y / cell) }),
      toPoint: (i, j) => ({ x: (i + 0.5) * cell, y: (j + 0.5) * cell }),
    };
  }

  // The nearest walkable cell to a point — so a route can still be asked for
  // from a spot that happens to sit under a table.
  function nearestWalkable(g, x, y, maxR) {
    const c = g.toCell(x, y);
    if (g.at(c.i, c.j)) return c;
    const lim = Math.ceil((maxR || 4) / g.cell);
    for (let r = 1; r <= lim; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (g.at(c.i + di, c.j + dj)) return { i: c.i + di, j: c.j + dj };
        }
      }
    }
    return null;
  }

  /* ── A* ───────────────────────────────────────────────────────────────
     Eight-way A* with an octile heuristic — the exact distance metric of
     eight-way movement, so it never overestimates and the route it returns is
     genuinely the shortest. Diagonals are refused when either orthogonal
     neighbour is blocked, which is what stops a path slipping through the
     corner where two tables touch.

     Open set is a binary heap: a 24 × 18 m room at quarter-metre cells is
     ~7000 nodes, and a linear scan for the lowest f would turn a route query
     into something you can feel.  */
  function findPath(g, from, to, opts) {
    if (!g) return null;
    const o = opts || {};
    const a = nearestWalkable(g, from.x, from.y, o.snap);
    const b = nearestWalkable(g, to.x, to.y, o.snap);
    if (!a || !b) return null;

    const n = g.cols * g.rows;
    const gScore = new Float32Array(n).fill(Infinity);
    const fScore = new Float32Array(n).fill(Infinity);
    const cameFrom = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);

    const start = g.idx(a.i, a.j), goal = g.idx(b.i, b.j);
    // Octile distance: the true cost of moving on an 8-connected grid.
    const H = (i, j) => {
      const dx = Math.abs(i - b.i), dy = Math.abs(j - b.j);
      return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
    };

    const heap = [];
    const push = (node, f) => {
      heap.push({ node, f });
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (heap[p].f <= heap[c].f) break;
        const t = heap[p]; heap[p] = heap[c]; heap[c] = t;
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const end = heap.pop();
      if (heap.length) {
        heap[0] = end;
        let p = 0;
        for (;;) {
          const l = p * 2 + 1, r = l + 1;
          let m = p;
          if (l < heap.length && heap[l].f < heap[m].f) m = l;
          if (r < heap.length && heap[r].f < heap[m].f) m = r;
          if (m === p) break;
          const t = heap[m]; heap[m] = heap[p]; heap[p] = t;
          p = m;
        }
      }
      return top;
    };

    gScore[start] = 0;
    fScore[start] = H(a.i, a.j);
    push(start, fScore[start]);

    const NB = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],
                [1,1,SQRT2],[1,-1,SQRT2],[-1,1,SQRT2],[-1,-1,SQRT2]];

    let guard = n * 4;   // a hard ceiling; a bug here must not hang the tab
    while (heap.length && guard-- > 0) {
      const cur = pop().node;
      if (cur === goal) return rebuild(g, cameFrom, goal, o);
      if (closed[cur]) continue;
      closed[cur] = 1;

      const ci = cur % g.cols, cj = (cur - ci) / g.cols;
      for (let k = 0; k < 8; k++) {
        const di = NB[k][0], dj = NB[k][1], cost = NB[k][2];
        const ni = ci + di, nj = cj + dj;
        if (!g.at(ni, nj)) continue;
        // No corner-cutting: a diagonal needs both its orthogonals open.
        if (di && dj && (!g.at(ci + di, cj) || !g.at(ci, cj + dj))) continue;

        const nIdx = g.idx(ni, nj);
        if (closed[nIdx]) continue;
        const tentative = gScore[cur] + cost;
        if (tentative >= gScore[nIdx]) continue;
        cameFrom[nIdx] = cur;
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + H(ni, nj);
        push(nIdx, fScore[nIdx]);
      }
    }
    return null;
  }

  /* Walk the parent chain back, convert to metres, then straighten it.

     Raw A* output zig-zags along the grid; a route drawn like that reads as a
     staircase rather than as the line a person would walk. String-pulling
     drops every waypoint that both its neighbours can see past, which leaves
     the corners that actually matter — the ones bent around a table. */
  function rebuild(g, cameFrom, goal, o) {
    const cells = [];
    for (let cur = goal; cur !== -1; cur = cameFrom[cur]) {
      const i = cur % g.cols;
      cells.push({ i, j: (cur - i) / g.cols });
    }
    cells.reverse();
    let pts = cells.map((c) => g.toPoint(c.i, c.j));
    if (o && o.raw) return pts;

    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!lineClear(g, pts[anchor], pts[i])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    if (pts.length > 1) out.push(pts[pts.length - 1]);
    return out;
  }

  /* Can a body walk straight from a to b? Sampled at half a cell — fine
     enough that it cannot step over a table, cheap enough to run inside the
     string-pulling loop. */
  function lineClear(g, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.ceil(dist / (g.cell * 0.5));
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const c = g.toCell(a.x + dx * t, a.y + dy * t);
      if (!g.at(c.i, c.j)) return false;
    }
    return true;
  }

  /* Flood fill from a point: which cells a guest entering there can actually
     reach. This is what turns "is anything walled off?" into a number — an
     area the fill never touches is an area no guest can get to, however open
     it looks on the sheet. */
  function reachable(g, from) {
    const seed = nearestWalkable(g, from.x, from.y, 6);
    if (!seed) return { count: 0, seen: new Uint8Array(g.cols * g.rows) };
    const seen = new Uint8Array(g.cols * g.rows);
    const stack = [g.idx(seed.i, seed.j)];
    seen[stack[0]] = 1;
    let count = 0;
    while (stack.length) {
      const cur = stack.pop();
      count++;
      const ci = cur % g.cols, cj = (cur - ci) / g.cols;
      for (let k = 0; k < 4; k++) {
        const di = k === 0 ? 1 : k === 1 ? -1 : 0;
        const dj = k === 2 ? 1 : k === 3 ? -1 : 0;
        const ni = ci + di, nj = cj + dj;
        if (!g.at(ni, nj)) continue;
        const nIdx = g.idx(ni, nj);
        if (seen[nIdx]) continue;
        seen[nIdx] = 1;
        stack.push(nIdx);
      }
    }
    return { count, seen };
  }

  // Total walkable cells — the denominator for "what fraction is reachable".
  function walkableCount(g) {
    let n = 0;
    for (let i = 0; i < g.walk.length; i++) n += g.walk[i];
    return n;
  }

  /* ── Corridor width ───────────────────────────────────────────────────
     How wide the walkable floor is at a point — the number a designer would
     get by holding a tape across the aisle.

     This is NOT clearanceAt(). That returns the distance to the nearest
     obstacle, which next to a wall is always small: a 4 m aisle running
     along a wall measures 0.3 m by that reckoning, which is how a clearance
     check ends up crying wolf on every plan with a perimeter route.

     Width is measured by walking out in opposite directions until the floor
     stops being walkable, and taking the narrowest such pair over several
     orientations. A corridor is as wide as its tightest crossing, so the
     minimum over directions is the honest answer — the widest would call a
     doorway a ballroom because you can see a long way through it. */
  const WIDTH_DIRS = [[1, 0], [0, 1], [0.7071, 0.7071], [0.7071, -0.7071]];

  function corridorWidth(g, x, y, cap) {
    const c = g.toCell(x, y);
    if (!g.at(c.i, c.j)) return 0;
    const limit = cap || 6;
    const stepLen = g.cell;
    let narrowest = Infinity;
    for (let d = 0; d < WIDTH_DIRS.length; d++) {
      const nx = WIDTH_DIRS[d][0], ny = WIDTH_DIRS[d][1];
      let total = stepLen;                     // the cell we are standing in
      for (let sign = -1; sign <= 1; sign += 2) {
        let walked = 0;
        while (walked < limit) {
          walked += stepLen;
          const cc = g.toCell(x + nx * sign * walked, y + ny * sign * walked);
          if (!g.at(cc.i, cc.j)) break;
        }
        total += walked - stepLen;
      }
      if (total < narrowest) narrowest = total;
    }
    return narrowest === Infinity ? 0 : narrowest;
  }

  /* A width for every walkable cell — the field the heatmap is drawn from
     and the congestion report reads.

     Sampled on a coarser lattice than the grid itself (`every` cells apart)
     and filled in between, because corridorWidth walks rays and a 24 × 18 m
     room at quarter-metre cells is nearly 7000 of them. The measurement is
     real at every sample; between samples it is the nearest one's, which for
     a quantity that changes over metres is the right trade. */
  function widthField(g, opts) {
    const o = opts || {};
    const every = Math.max(1, Math.round((o.sample || 0.5) / g.cell));
    const cap = o.cap || 6;
    const field = new Float32Array(g.cols * g.rows);
    for (let j = 0; j < g.rows; j += every) {
      for (let i = 0; i < g.cols; i += every) {
        const p = g.toPoint(i, j);
        const w = g.at(i, j) ? corridorWidth(g, p.x, p.y, cap) : 0;
        // Paint the sample across the block it stands for.
        for (let dj = 0; dj < every && j + dj < g.rows; dj++) {
          for (let di = 0; di < every && i + di < g.cols; di++) {
            field[(j + dj) * g.cols + (i + di)] = g.at(i + di, j + dj) ? w : 0;
          }
        }
      }
    }
    return field;
  }

  /* ── Traffic ──────────────────────────────────────────────────────────
     Where the room's routes overlap. Every route handed in is walked cell by
     cell and a counter raised along it; the result is how many of those
     journeys pass through each patch of floor.

     This is what turns "the buffet is popular" into a number: if forty
     guests' routes all thread one 1.1 m gap, that gap is the queue, and it
     is visible here before anybody stands in it on the night. */
  function traffic(g, paths, opts) {
    const o = opts || {};
    const spread = o.spread != null ? o.spread : 0.45;   // body width, metres
    const field = new Float32Array(g.cols * g.rows);
    const r = Math.max(0, Math.round(spread / g.cell));
    (paths || []).forEach((path) => {
      if (!path || path.length < 2) return;
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], b = path[k];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(dist / g.cell));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const c = g.toCell(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
          for (let dj = -r; dj <= r; dj++) {
            for (let di = -r; di <= r; di++) {
              const i = c.i + di, j = c.j + dj;
              if (!g.at(i, j)) continue;
              // Weighted by distance from the centre line, so a route is a
              // band of traffic rather than a one-cell wire.
              const fall = 1 - Math.hypot(di, dj) / (r + 1);
              if (fall > 0) field[j * g.cols + i] += fall;
            }
          }
        }
      }
    });
    return field;
  }

  /* The hot spots in a traffic field: connected runs of floor above a
     threshold, returned with their centre and extent so the report can name
     a place rather than a cell index. */
  function hotspots(g, field, threshold, opts) {
    const o = opts || {};
    const minCells = o.minCells || 6;
    const seen = new Uint8Array(g.cols * g.rows);
    const out = [];
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.cols; i++) {
        const idx = j * g.cols + i;
        if (seen[idx] || field[idx] < threshold || !g.walk[idx]) continue;
        // Flood the connected region above the threshold.
        const stack = [idx];
        seen[idx] = 1;
        let n = 0, sx = 0, sy = 0, peak = 0;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        while (stack.length) {
          const cur = stack.pop();
          const ci = cur % g.cols, cj = (cur - ci) / g.cols;
          const p = g.toPoint(ci, cj);
          n++; sx += p.x; sy += p.y;
          if (field[cur] > peak) peak = field[cur];
          if (p.x < x0) x0 = p.x;
          if (p.y < y0) y0 = p.y;
          if (p.x > x1) x1 = p.x;
          if (p.y > y1) y1 = p.y;
          for (let k = 0; k < 4; k++) {
            const di = k === 0 ? 1 : k === 1 ? -1 : 0;
            const dj = k === 2 ? 1 : k === 3 ? -1 : 0;
            const ni = ci + di, nj = cj + dj;
            if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
            const nIdx = nj * g.cols + ni;
            if (seen[nIdx] || field[nIdx] < threshold || !g.walk[nIdx]) continue;
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
        if (n < minCells) continue;
        out.push({
          x: sx / n, y: sy / n, peak,
          cells: n, area: Math.round(n * g.cell * g.cell * 100) / 100,
          x0, y0, x1, y1,
        });
      }
    }
    return out.sort((a, b) => b.peak - a.peak);
  }

  return {
    BODY_R, CELL, STEP, PASSABLE, HEIGHT,
    solidsOf,
    resolve,
    floorAt,
    clearanceAt,
    grid,
    nearestWalkable,
    findPath,
    lineClear,
    reachable,
    walkableCount,
    corridorWidth,
    widthField,
    traffic,
    hotspots,
  };
})();
