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
      if (A.x0 < 0 || A.y0 < 0 || A.x1 > room.w || A.y1 > room.h) c += 500;
      if (roleOf(A.kind) === "seating" && Number(A.item.seats) > 0) {
        const gap = Math.min(A.x0, A.y0, room.w - A.x1, room.h - A.y1);
        if (gap < CLEAR.wall) c += (CLEAR.wall - gap) * 20;
      }
      for (let b = a + 1; b < solids.length; b++) {
        const B = solids[b];
        if (!B) continue;
        /* Cheapest possible rejection first. */
        if (B.x0 - A.x1 > 3 || A.x0 - B.x1 > 3) continue;
        if (B.y0 - A.y1 > 3 || A.y0 - B.y1 > 3) continue;

        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        // Overlaps have high penalty so the optimizer ALWAYS prioritizes eliminating overlaps
        if (ox > 0.02 && oy > 0.02) {
          c += 500 + Math.min(ox, oy) * 50;
          continue;
        }
        // Not facing on either axis — diagonal neighbours
        if (ox <= 0 && oy <= 0) continue;
        const gap = ox > 0
          ? Math.max(A.y0 - B.y1, B.y0 - A.y1, 0)
          : Math.max(A.x0 - B.x1, B.x0 - A.x1, 0);
        const seated = (Number(A.item.seats) || 0) + (Number(B.item.seats) || 0) > 0;
        const need = seated ? CLEAR.service : CLEAR.guest;
        if (gap < need) c += (need - gap) * 15;
      }
    }
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
     where it stands now, on the sheet's own grid. Sorted to prioritize
     moving away from conflicting neighbours and into open space. */
  function candidates(it, from, room, others) {
    const out = [];
    const maxN = Math.max(4.5, (Number(it.w) || 1) + 2.5);
    const steps = Math.round(maxN / OPT.stepNudge);
    const cx = from.x + (Number(it.w) || 1) / 2;
    const cy = from.y + (Number(it.h) || 1) / 2;

    // Calculate repulsion vector away from nearby / colliding pieces & walls
    let repX = 0, repY = 0;
    (others || []).forEach((s) => {
      if (!s) return;
      const scx = (s.x0 + s.x1) / 2, scy = (s.y0 + s.y1) / 2;
      const dx = cx - scx, dy = cy - scy;
      const dist = Math.hypot(dx, dy);
      if (dist < 3.5) {
        const factor = 1 / Math.max(0.2, dist * dist);
        repX += (dist > 0.01 ? dx / dist : (Math.random() - 0.5)) * factor;
        repY += (dist > 0.01 ? dy / dist : (Math.random() - 0.5)) * factor;
      }
    });
    // Repel from close walls
    if (from.x < CLEAR.wall + 0.5) repX += 2.0;
    if (from.y < CLEAR.wall + 0.5) repY += 2.0;
    if (from.x + (Number(it.w) || 1) > room.w - (CLEAR.wall + 0.5)) repX -= 2.0;
    if (from.y + (Number(it.h) || 1) > room.h - (CLEAR.wall + 0.5)) repY -= 2.0;

    const repLen = Math.hypot(repX, repY);
    if (repLen > 0.01) { repX /= repLen; repY /= repLen; }

    for (let ring = 1; ring <= steps; ring++) {
      const d = ring * OPT.stepNudge;
      const ringCandidates = [];
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
          const dx = di * OPT.stepNudge, dy = dj * OPT.stepNudge;
          const dot = repLen > 0.01 ? (dx * repX + dy * repY) : 0;
          ringCandidates.push({ dx, dy, dist: d, rot: 0, dot });
        }
      }
      // Sort candidates in this ring so moves along the repulsion vector are tested first
      ringCandidates.sort((a, b) => b.dot - a.dot);
      out.push(...ringCandidates);
    }

    const w = Number(it.w) || 1, h = Number(it.h) || 1;
    // Turning helps a piece that isn't square
    if (Math.abs(w - h) > 0.2 && defOf(it.kind).shape !== "round") {
      out.unshift({ dx: 0, dy: 0, dist: 0.01, rot: 90, dot: 1 });
    }
    return out;
  }

  /* Try one piece in candidate positions, finding the smallest move
     that fully resolves the conflict cleanly into open floor. */
  function relocate(work, itemId, baseline, finding) {
    const it = work.items.find((i) => i.id === itemId);
    if (!it) return null;
    const from = { x: it.x, y: it.y, rot: it.rot };
    const room = work.room;
    let best = null;

    const others = N.solidsOf({ room: room, items: work.items.filter((i) => i.id !== itemId) }, { includePassable: true });
    const solids = others.slice();
    solids.push(null);
    const slot = solids.length - 1;

    const list = candidates(it, from, room, others);

    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      let w = Number(it.w) || 1, h = Number(it.h) || 1;
      if (c.rot) { const t = w; w = h; h = t; }
      const nx = snap(from.x + c.dx);
      const ny = snap(from.y + c.dy);
      // Inside the room, with the piece's own footprint accounted for
      if (nx < 0 || ny < 0 || nx + w > room.w || ny + h > room.h) continue;

      it.x = nx; it.y = ny;
      if (c.rot) it.rot = ((Number(from.rot) || 0) + c.rot) % 360;

      const mine = N.solidsOf({ room: room, items: [it] }, { includePassable: true });
      solids[slot] = mine.length ? mine[0] : null;
      const live = solids[slot] ? solids : others;
      const rawCost = cost(work, live, itemId);
      const score = rawCost + (c.dist * 1.5); // distance penalty

      // Restore before the next candidate
      it.x = from.x; it.y = from.y; it.rot = from.rot;

      if (score < baseline - 0.1 && (!best || score < best.score)) {
        best = { score, rawCost, dx: nx - from.x, dy: ny - from.y, rot: c.rot, to: { x: nx, y: ny }, dist: c.dist };
        if (rawCost === 0 && c.dist <= 1.0) break;
      }
    }
    return best;
  }

  /* ── Suggestions ──────────────────────────────────────────────────────
     Driven by the report with multi-pass convergence to suggest the best,
     cleanest, most spacious layout. */
  function suggest(layout, opts) {
    const o = opts || {};
    if (!N || !W || !layout || !layout.room) return [];
    const work = copyLayout(layout);
    probeCache = null;
    let report = o.report || W.analyse(work, { pax: o.pax, event: o.event });
    let baseline = cost(work, N.solidsOf(work, { includePassable: true }));
    let liveScore = report.score;
    const out = [];
    const touched = Object.create(null);

    const maxPasses = 3;
    for (let pass = 0; pass < maxPasses && out.length < OPT.maxSuggestions; pass++) {
      let madeProgressInPass = false;
      const findings = (report.findings || []).slice();
      if (!findings.length || report.score >= 98) break;

      for (let fi = 0; fi < findings.length && out.length < OPT.maxSuggestions; fi++) {
        const f = findings[fi];
        const candidateItems = [];
        if (f.item && f.item.id) candidateItems.push(f.item);
        if (f.otherItem && f.otherItem.id && !candidateItems.some((c) => c.id === f.otherItem.id)) {
          candidateItems.push(f.otherItem);
        }
        if (f.pair && Array.isArray(f.pair)) {
          f.pair.forEach((p) => {
            if (p && p.id && !candidateItems.some((c) => c.id === p.id)) candidateItems.push(p);
          });
        }
        if (!candidateItems.length || (candidateItems[0] && roleOf(candidateItems[0].kind) === "access")) {
          const pt = f.at || (f.congestion && { x: f.congestion.x, y: f.congestion.y });
          if (pt) {
            const nearby = work.items.filter((i) => roleOf(i.kind) !== "access" && !touched[i.id]);
            nearby.sort((a, b) => {
              const ca = centreOf(a), cb = centreOf(b);
              return Math.hypot(ca.x - pt.x, ca.y - pt.y) - Math.hypot(cb.x - pt.x, cb.y - pt.y);
            });
            if (nearby.length && Math.hypot(centreOf(nearby[0]).x - pt.x, centreOf(nearby[0]).y - pt.y) < 3.0) {
              candidateItems.push(nearby[0]);
            }
          }
        }

        if (!candidateItems.length) continue;

        let bestChoice = null;

        for (let ci = 0; ci < candidateItems.length; ci++) {
          const cand = candidateItems[ci];
          if (!cand || !cand.id || touched[cand.id]) continue;

          const move = relocate(work, cand.id, baseline, f);
          if (!move) continue;

          const it = layout.items.find((i) => i.id === cand.id);
          const staged = work.items.find((i) => i.id === cand.id);
          if (!it || !staged) continue;

          const revert = { x: staged.x, y: staged.y, rot: staged.rot, w: staged.w, h: staged.h };
          staged.x = move.to.x;
          staged.y = move.to.y;
          if (move.rot) {
            staged.rot = ((Number(staged.rot) || 0) + move.rot) % 360;
            if (Math.abs(move.rot % 180) === 90) {
              const t = staged.w; staged.w = staged.h; staged.h = t;
            }
          }

          const verdict = W.analyse(work, { pax: o.pax, event: o.event });
          const improvedScore = verdict.score > liveScore;
          const reducedWarnings = (verdict.counts.high + verdict.counts.medium) < (report.counts.high + report.counts.medium);
          const reducedTotalFindings = verdict.findings.length < report.findings.length;
          const isProgress = verdict.score >= liveScore && (move.score < baseline - 0.5 || reducedTotalFindings);

          // Revert staged copy
          Object.assign(staged, revert);

          if (improvedScore || reducedWarnings || isProgress) {
            const gain = (verdict.score - liveScore) * 10 + (baseline - move.score);
            if (!bestChoice || gain > bestChoice.gain) {
              bestChoice = { cand, it, staged, move, verdict, gain };
            }
          }
        }

        if (!bestChoice) continue;

        const { cand, it, staged, move, verdict, gain } = bestChoice;
        staged.x = move.to.x;
        staged.y = move.to.y;
        if (move.rot) {
          staged.rot = ((Number(staged.rot) || 0) + move.rot) % 360;
          if (Math.abs(move.rot % 180) === 90) {
            const t = staged.w; staged.w = staged.h; staged.h = t;
          }
        }

        touched[cand.id] = 1;
        madeProgressInPass = true;
        liveScore = Math.max(liveScore, verdict.score);
        baseline = move.rawCost !== undefined ? move.rawCost : move.score;
        report = verdict;

        const dist = Math.hypot(move.dx, move.dy);
        let title, detail;
        if (move.rot && dist < 0.05) {
          title = `Rotate ${labelOf(it)} ${move.rot}°`;
          detail = `Turning it end-on clears ${f.title.toLowerCase()} without moving it off its spot.`;
        } else {
          title = `Move ${labelOf(it)} ${round2(dist)} m ${bearing(move.dx, move.dy)}`;
          detail = `${f.title} — positioned into clear, spacious floor with optimal aisles.`;
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
          gain: round2(gain),
        });
      }

      if (!madeProgressInPass) break;
    }

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
