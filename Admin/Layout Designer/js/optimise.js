/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — LAYOUT OPTIMISATION.

   Turns a finding into a move.

   js/walkability.js says "Table 8 and Table 9 are 0.72 m apart, and a server
   needs 1.2 m". That is true and useless on its own — the designer still has
   to work out which of the two to move and where to. This module answers the
   second half: it searches the floor for a position that fixes the complaint
   without creating a new one, and states it in metres and a compass point.

     "Move Table 8 by 0.75 m east."
     "Rotate Buffet Station 90°."
     "Move Table 12 clear of the emergency exit."

   ── Nothing moves without a press ───────────────────────────────────────
   Every function here is PURE with respect to the caller's layout: the search
   works on a deep copy, and the returned suggestion is a description of a
   change, not the change. `apply()` exists, takes one suggestion, and is the
   only thing in this file that writes — and the UI only calls it from an
   explicit [APPLY]. §17 of the brief is a hard line, and this is where it is
   held.

   ── Why a search and not a formula ──────────────────────────────────────
   "Move it 0.48 m east" is arithmetic; "move it 0.48 m east WITHOUT putting
   it inside the buffet, off the room, or into the fire route" is a
   constraint problem. The search is a bounded ring scan on the sheet's own
   quarter-metre grid: candidate positions in rising order of how far they
   are from where the designer put the piece, scored by whether they fix the
   complaint and what they cost elsewhere. The first candidate that scores
   better than standing still wins, so the recommendation is always the
   SMALLEST move that works — a tool that shunts a plan across the room to
   satisfy an aisle has stopped being a suggestion.

   Public API (window.HPOptimise):
     suggest(layout, opts)   → [{ id, title, detail, item, move, apply… }]
     apply(layout, sugg)     → mutates ONE item, returns an undo record
     undo(layout, record)    → puts it back
   ════════════════════════════════════════════════════════════════ */
window.HPOptimise = (function () {
  "use strict";

  const N = window.HPNav;
  const R = window.HPRules;
  const W = window.HPWalk;

  const OPT = (R && R.OPTIMISE) || {
    maxNudge: 1.5, stepNudge: 0.25, maxRotate: 90, maxSuggestions: 12, minGain: 0.1,
  };
  const CLEAR = (R && R.CLEAR) || {
    service: 1.2, guest: 0.9, main: 1.5, chairPull: 0.75,
    doorSwing: 1.2, emergency: 1.5, wall: 0.6, stageFront: 2.0,
    buffetQueue: 1.4, barQueue: 1.2, danceEdge: 1.0,
  };

  const round2 = (v) => Math.round(v * 100) / 100;
  const labelOf = (it) => String((it && (it.label || it.kind)) || "Piece");
  const roleOf = (k) => (R ? R.roleOf(k) : "fixture");
  const defOf = (k) => (R ? R.pieceOf(k) : {});
  const centreOf = (it) => ({
    x: (Number(it.x) || 0) + (Number(it.w) || 1) / 2,
    y: (Number(it.y) || 0) + (Number(it.h) || 1) / 2,
  });

  /* The compass, as a designer says it. The plan's +y runs DOWN the sheet,
     which is south — stating a move as "0.8 m east" rather than "+0.8 x" is
     the difference between an instruction the floor crew can follow and a
     coordinate they have to translate. */
  function bearing(dx, dy) {
    const parts = [];
    if (Math.abs(dy) >= 0.05) parts.push(dy < 0 ? "north" : "south");
    if (Math.abs(dx) >= 0.05) parts.push(dx < 0 ? "west" : "east");
    return parts.join("-") || "in place";
  }

  const snap = (v) => Math.round(v / OPT.stepNudge) * OPT.stepNudge;

  /* A working copy. The search moves pieces around dozens of times per
     suggestion, and it must never be the designer's array it is moving. */
  function copyLayout(layout) {
    return {
      room: { w: Number(layout.room.w) || 24, h: Number(layout.room.h) || 18 },
      items: (layout.items || []).map((i) => Object.assign({}, i)),
    };
  }

  /* ── The cost of a plan ───────────────────────────────────────────────
     One number for "how much is wrong here", so two candidate positions can
     be compared. Deliberately CHEAP: it is evaluated once per candidate
     position and a full walkability pass would make the search take seconds.

     It counts the things a move can actually break — overlaps, clearances,
     room bounds, blocked exits — and ignores the things a move cannot
     (headcount, event-type expectations). That is not a shortcut: a
     suggestion is judged on what it changes. */
  function cost(work, solids, focusId) {
    let c = 0;
    const room = work.room;
    for (let a = 0; a < solids.length; a++) {
      const A = solids[a];
      // The moving piece's slot is empty when the piece is a passable one
      // (see relocate) — skipped rather than special-cased at every read.
      if (!A) continue;
      // Out of the room, or hard against a wall.
      if (A.x0 < 0 || A.y0 < 0 || A.x1 > room.w || A.y1 > room.h) c += 100;
      if (roleOf(A.kind) === "seating" && Number(A.item.seats) > 0) {
        const gap = Math.min(A.x0, A.y0, room.w - A.x1, room.h - A.y1);
        if (gap < CLEAR.wall) c += (CLEAR.wall - gap) * 4;
      }
      for (let b = a + 1; b < solids.length; b++) {
        const B = solids[b];
        if (!B) continue;
        /* Cheapest possible rejection first.

           This loop is every pair of pieces in the room, evaluated once per
           candidate position, and on a forty-table ballroom the overwhelming
           majority of those pairs are two tables at opposite ends with
           nothing to say to each other. Two separating-axis tests reject them
           in four comparisons, before any of the arithmetic below. Same
           result — a pair more than 3 m apart on BOTH axes was already being
           skipped — reached for a fraction of the work. */
        if (B.x0 - A.x1 > 3 || A.x0 - B.x1 > 3) continue;
        if (B.y0 - A.y1 > 3 || A.y0 - B.y1 > 3) continue;

        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox > 0 && oy > 0) { c += 60 + Math.min(ox, oy) * 20; continue; }
        // Not facing on either axis — diagonal neighbours, with a gap that is
        // a corner rather than an aisle.
        if (ox <= 0 && oy <= 0) continue;
        const gap = ox > 0
          ? Math.max(A.y0 - B.y1, B.y0 - A.y1, 0)
          : Math.max(A.x0 - B.x1, B.x0 - A.x1, 0);
        const seated = (Number(A.item.seats) || 0) + (Number(B.item.seats) || 0) > 0;
        const need = seated ? CLEAR.service : CLEAR.guest;
        if (gap < need) c += (need - gap) * 10;
      }
    }
    /* Access kept clear: an exit or a doorway with something in front of it
       costs far more than a tight aisle, because it is the one thing on this
       list that is not a matter of comfort.

       The probe points are derived from the doors, which do not move during a
       search — so they are computed once per plan and cached, rather than
       re-derived for every candidate position of every piece. */
    const probes = accessProbes(work, room);
    for (let i = 0; i < probes.length; i++) {
      const p = probes[i];
      const d = N.clearanceAt(solids, p.x, p.y) * 2;
      if (d < p.need) c += (p.need - d) * p.weight;
    }
    return c;
  }

  /* Where the floor must stay clear, and how badly. Cached against the item
     array the probes were derived from: `suggest` works on one copy for the
     whole run, so the cache is hit for every candidate after the first. */
  let probeCache = null;
  function accessProbes(work, room) {
    if (probeCache && probeCache.items === work.items) return probeCache.list;
    const list = [];
    (work.items || []).forEach((it) => {
      if (roleOf(it.kind) !== "access" || String(it.kind) === "spawn") return;
      const emergency = !!defOf(it.kind).emergency;
      const need = emergency ? CLEAR.emergency : CLEAR.doorSwing;
      const at = W && W.stepInside ? W.stepInside(it, room, need) : null;
      if (!at) return;
      list.push({ x: at.x, y: at.y, need: need, weight: emergency ? 40 : 12 });
    });
    probeCache = { items: work.items, list: list };
    return list;
  }

  /* ── The search ───────────────────────────────────────────────────────
     Candidate positions for one piece, in rings of rising distance from
     where it stands now, on the sheet's own grid. The first ring is the
     step size; the last is maxNudge. Within a ring the order is arbitrary,
     which is fine — every position in a ring is the same distance away, so
     any of them is equally "the smallest move".

     Rotation is offered separately and only for pieces where turning is a
     real answer (a long serving line across a route, a rectangular table in
     a narrow bay). Rotating a round table achieves nothing and is not
     offered. */
  function candidates(it) {
    const out = [];
    const steps = Math.round(OPT.maxNudge / OPT.stepNudge);
    for (let ring = 1; ring <= steps; ring++) {
      const d = ring * OPT.stepNudge;
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          out.push({ dx: di * OPT.stepNudge, dy: dj * OPT.stepNudge, dist: d, rot: 0 });
        }
      }
    }
    const w = Number(it.w) || 1, h = Number(it.h) || 1;
    // Turning only helps a piece that isn't square.
    if (Math.abs(w - h) > 0.2 && defOf(it.kind).shape !== "round") {
      out.unshift({ dx: 0, dy: 0, dist: 0.01, rot: 90 });
    }
    return out;
  }

  /* Try one piece in every candidate position, keep the first that improves
     the plan by more than the noise floor. Returns null when standing still
     is already the best available — which is the honest answer for a piece
     that is tight because the ROOM is tight, and is why this module does not
     always have something to say. */
  function relocate(work, itemId, baseline) {
    const it = work.items.find((i) => i.id === itemId);
    if (!it) return null;
    const from = { x: it.x, y: it.y, rot: it.rot };
    const room = work.room;
    let best = null;

    /* Only ONE piece moves during this search, so only one box changes.

       Rebuilding every solid in the room for each of a hundred candidate
       positions is the same forty-nine boxes recomputed a hundred times to
       observe one of them move — which on a full ballroom was most of the
       second the optimiser took. The static boxes are built once here; the
       moving one is spliced in at its candidate position. Same model, same
       answer, one box of work per candidate instead of the whole room's. */
    const others = N.solidsOf({ room: room, items: work.items.filter((i) => i.id !== itemId) });
    const solids = others.slice();
    solids.push(null);                    // the slot the moving piece occupies
    const slot = solids.length - 1;

    const list = candidates(it);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      let w = Number(it.w) || 1, h = Number(it.h) || 1;
      if (c.rot) { const t = w; w = h; h = t; }
      const nx = snap(from.x + c.dx);
      const ny = snap(from.y + c.dy);
      // Inside the room, with the piece's own footprint accounted for.
      if (nx < 0 || ny < 0 || nx + w > room.w || ny + h > room.h) continue;

      it.x = nx; it.y = ny;
      if (c.rot) it.rot = ((Number(from.rot) || 0) + c.rot) % 360;

      // The moved piece's box, built by the SAME function the rest came from
      // so a rotated footprint is inflated identically.
      const mine = N.solidsOf({ room: room, items: [it] });
      // A passable piece (a doorway being nudged clear) yields no box; the
      // slot is simply left empty rather than the array being resized.
      solids[slot] = mine.length ? mine[0] : null;
      const live = solids[slot] ? solids : others;
      const score = cost(work, live, itemId);

      // Restore before the next candidate, always — the copy is reused.
      it.x = from.x; it.y = from.y; it.rot = from.rot;

      if (score < baseline - 0.5 && (!best || score < best.score)) {
        best = { score, dx: nx - from.x, dy: ny - from.y, rot: c.rot, to: { x: nx, y: ny }, dist: c.dist };
        // A ring-ordered search: once something in this ring works, nothing
        // further out can be a smaller move, so stop at the end of the ring.
        if (c.dist > 0.01) break;
      }
    }
    return best;
  }

  /* ── Suggestions ──────────────────────────────────────────────────────
     Driven by the report, not by sweeping the room: every suggestion answers
     a finding a designer has already been shown, which is what keeps the
     list short and every entry explicable. */
  function suggest(layout, opts) {
    const o = opts || {};
    if (!N || !W || !layout || !layout.room) return [];
    const report = o.report || W.analyse(layout, { pax: o.pax, event: o.event });
    const work = copyLayout(layout);
    // A fresh copy means fresh probes. Dropped explicitly rather than relying
    // on the identity check alone, so a run can never read a cache belonging
    // to a plan that has since been edited.
    probeCache = null;
    let baseline = cost(work, N.solidsOf(work));
    // The report's own score as the staged plan currently stands. Each
    // accepted suggestion must not lower it — see the verification below.
    let liveScore = report.score;
    const out = [];
    const touched = Object.create(null);   // one suggestion per piece

    /* Suggestions COMPOUND: each is searched against the plan with every
       previous suggestion already applied to the working copy.

       Scoring each move against the untouched original instead looks
       reasonable and is wrong — two tables in the same crowded corner are
       then both told to move into the one gap between them, each move
       correct on its own and the pair of them worse than doing nothing. The
       designer, who is offered [APPLY ALL], would have taken both.

       So the working copy carries the accepted moves forward and the
       baseline moves with it. The cost is that a suggestion depends on the
       ones above it in the list — which is exactly the dependency that
       actually exists, and the list is presented in that order. */
    report.findings.forEach((f) => {
      if (out.length >= OPT.maxSuggestions) return;
      if (!f.item || !f.item.id) return;
      if (touched[f.item.id]) return;

      const move = relocate(work, f.item.id, baseline);
      if (!move) return;
      touched[f.item.id] = 1;

      const it = layout.items.find((i) => i.id === f.item.id);
      if (!it) return;

      /* Stage it on the working copy, so the next search sees the room as it
         would be if this one were accepted. `work` is this module's own deep
         copy — the caller's layout is never touched, which is what keeps
         suggest() pure (asserted in the tests). */
      const staged = work.items.find((i) => i.id === f.item.id);
      const revert = staged
        ? { x: staged.x, y: staged.y, rot: staged.rot, w: staged.w, h: staged.h }
        : null;
      if (staged) {
        staged.x = move.to.x;
        staged.y = move.to.y;
        if (move.rot) {
          staged.rot = ((Number(staged.rot) || 0) + move.rot) % 360;
          if (Math.abs(move.rot % 180) === 90) {
            const t = staged.w; staged.w = staged.h; staged.h = t;
          }
        }
      }

      /* Verify against the REAL analysis before offering it.

         cost() is a fast proxy — a weighted sum of overlaps and clearances —
         and the search needs it to be, since it is evaluated a hundred times
         per piece. But the number the designer is shown, and judges the
         result by, is the report's score, and the two do not measure quite
         the same thing: widening a 0.7 m gap to 1.1 m improves the cost and
         still leaves the finding standing, while nudging a table clear of one
         neighbour can bring it inside another check's threshold.

         So the proxy proposes and the real analysis disposes. A suggestion
         that does not actually improve the report is dropped and its piece
         put back — which is why this module sometimes has nothing to say
         about a finding, and why "Apply all" cannot leave a plan worse than
         it found it. */
      const verdict = W.analyse(work, { pax: o.pax, event: o.event });
      if (verdict.score < liveScore) {
        if (staged && revert) Object.assign(staged, revert);
        delete touched[f.item.id];
        return;
      }
      liveScore = verdict.score;
      baseline = move.score;

      const dist = Math.hypot(move.dx, move.dy);
      let title, detail;
      if (move.rot && dist < 0.05) {
        title = `Rotate ${labelOf(it)} ${move.rot}°`;
        detail = `Turning it end-on clears ${f.title.toLowerCase()} without moving it off its spot.`;
      } else {
        title = `Move ${labelOf(it)} ${round2(dist)} m ${bearing(move.dx, move.dy)}`;
        detail = `${f.title} — this is the smallest move that clears it.`;
      }

      out.push({
        id: "o" + out.length,
        title, detail,
        finding: f.title,
        severity: f.severity,
        item: it,
        itemId: it.id,
        from: { x: round2(it.x), y: round2(it.y), rot: Math.round(Number(it.rot) || 0) },
        to: {
          x: round2(move.to.x), y: round2(move.to.y),
          rot: move.rot ? ((Number(it.rot) || 0) + move.rot) % 360 : Math.round(Number(it.rot) || 0),
        },
        move: { dx: round2(move.dx), dy: round2(move.dy), rot: move.rot || 0, metres: round2(dist) },
        gain: round2(baseline - move.score),
      });
    });

    return out;
  }

  /* ── Applying ─────────────────────────────────────────────────────────
     The ONLY writing function here, and it writes exactly one item. Returns
     an undo record so the desk can offer to put it back — a suggestion the
     designer accepted and then thought better of should cost one press,
     not a reload. */
  function apply(layout, sugg) {
    if (!layout || !sugg) return null;
    const it = (layout.items || []).find((i) => i.id === sugg.itemId);
    if (!it) return null;
    const record = {
      itemId: it.id,
      before: { x: it.x, y: it.y, rot: it.rot, w: it.w, h: it.h },
    };
    it.x = sugg.to.x;
    it.y = sugg.to.y;
    if (sugg.move.rot) {
      it.rot = sugg.to.rot;
      // A 90° turn on a rectangle swaps the footprint the plan draws, so the
      // piece's own w/h follow it — otherwise the 2D sheet and the collision
      // model would disagree about which way it is lying.
      if (Math.abs(sugg.move.rot % 180) === 90) {
        const t = it.w; it.w = it.h; it.h = t;
      }
    }
    return record;
  }

  function undo(layout, record) {
    if (!layout || !record) return false;
    const it = (layout.items || []).find((i) => i.id === record.itemId);
    if (!it) return false;
    Object.assign(it, record.before);
    return true;
  }

  /* A dry run: what the report would say if every suggestion in the list
     were accepted. Shown beside the current numbers so [APPLY ALL] is a
     decision with a stated outcome rather than a leap. */
  function preview(layout, suggestions, opts) {
    const o = opts || {};
    const work = copyLayout(layout);
    (suggestions || []).forEach((s) => apply(work, s));
    return W.analyse(work, { pax: o.pax, event: o.event });
  }

  return { suggest, apply, undo, preview, cost, bearing };
})();
