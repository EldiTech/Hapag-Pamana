/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — SPATIAL ANALYSIS.

   Reads a floor plan the way a guest walking into the room would, and reports
   what would go wrong. Every finding is measured against the same AABB boxes
   and the same A* grid the walkthrough moves on (js/nav.js) — so a warning
   that says "0.65 m clearance" describes a gap the simulator will genuinely
   refuse to let you through.

   Every threshold comes from js/rules.js (LAYOUT_RULES). Nothing in this file
   decides what "too close" means; it decides what is measurably true and
   compares it to the house's numbers.

   What it checks, and why each one is a real complaint rather than a number:

     · ENTRANCE      a room with no door is a room the crew has to invent an
                     entrance for on the night.
     · EMERGENCY     a fire exit with a table in front of it is the one
                     finding on this list that is not a matter of taste.
     · REACHABILITY  A* flood-fills from the entrance. Floor the fill never
                     touches is floor no guest can reach, however open it
                     looks on the sheet — the commonest way a plan fails.
     · CLEARANCE     the gap between two pieces, measured edge to edge. Below
                     the service minimum a waiter with a tray cannot pass.
     · WALL          a piece hard against a wall traps whoever sits at it.
     · OVERLAP       two pieces occupying the same floor. Always a mistake.
     · PATHWAY       the route from the door to each table. If A* can't find
                     one, that table's guests are climbing over furniture.
     · WALKWAYS      the width of the actual floor, sampled across the room —
                     not the distance to the nearest object (see nav's note).
     · CONGESTION    where the room's own routes overlap. A queue is a place
                     many journeys cross, and that is computable.
     · SERVICE       a buffet nobody can queue at, or a stage with no way up.
     · CAPACITY      seats against the booked headcount, and headcount
                     against the floor area the room actually has.

   Nothing here MOVES anything. It reports, with the clearance it measured and
   the clearance it wanted, and leaves the judgement to the designer — a tool
   that silently shuffles a plan is a tool nobody trusts twice. Moving is
   js/optimise.js's business, and only ever on confirmation.

   Public API (window.HPWalk):
     analyse(layout, opts) → { score, counts, findings, metrics, heat, ... }
     CLEAR                 → the clearance table (from HPRules)
   ════════════════════════════════════════════════════════════════ */
window.HPWalk = (function () {
  "use strict";

  const N = window.HPNav;
  const R = window.HPRules;

  /* The clearances the trade actually works to, in metres. Sourced from
     LAYOUT_RULES; the literals below are the fallback for a page where
     js/rules.js failed to load, so the check still runs rather than
     comparing every measurement against undefined. */
  const CLEAR = (R && R.CLEAR) || {
    service: 1.2, guest: 0.9, main: 1.5, chairPull: 0.75,
    doorSwing: 1.2, emergency: 1.5, wall: 0.6, stageFront: 2.0,
    buffetQueue: 1.4, barQueue: 1.2, danceEdge: 1.0,
  };

  const round2 = (v) => Math.round(v * 100) / 100;
  const kindLabel = (it) => String((it && (it.label || it.kind)) || "Piece");
  const roleOf = (kind) => (R ? R.roleOf(kind) : "fixture");
  const defOf = (kind) => (R ? R.pieceOf(kind) : { label: kind });

  const centreOf = (it) => ({
    x: (Number(it.x) || 0) + (Number(it.w) || 1) / 2,
    y: (Number(it.y) || 0) + (Number(it.h) || 1) / 2,
  });

  /* Are these two boxes segments of one run of furniture?

     A long ceremonial table is laid as three trestles pushed together, and a
     U-shape is a dozen of them; the joints are centimetres apart because they
     are meant to be. Flagging those as "not enough room between pieces" is
     the check misreading one table as many — which, before this, buried the
     real warnings under eight false ones on every U-shape plan.

     The test is deliberately narrow: same kind, butted almost edge to edge,
     and flush on the perpendicular axis — which is what a run looks like and
     what two independent tables that merely ended up close do not. */
  const RUN_KINDS = { rect: 1, buffet: 1, head: 1, dessert: 1, service: 1, square: 1 };
  function isSameRun(A, B, gap) {
    if (A.kind !== B.kind) return false;
    if (!RUN_KINDS[A.kind]) return false;
    if (gap > 0.45) return false;
    const flush = (p, q) => Math.abs(p - q) < 0.12;
    // Butted end to end along X ⇒ their Y edges should line up, and vice versa.
    const sideBySideX = Math.max(A.x0 - B.x1, B.x0 - A.x1) > -0.02;
    return sideBySideX
      ? (flush(A.y0, B.y0) && flush(A.y1, B.y1))
      : (flush(A.x0, B.x0) && flush(A.x1, B.x1));
  }

  /* ── The report ───────────────────────────────────────────────────────
     `opts.pax`   the booked headcount, if the caller knows it
     `opts.event` the event type key, so the check asks for what this kind
                  of function actually needs and stays quiet about the rest
     `opts.heat`  build the width field for the heatmap (costs a pass) */
  function analyse(layout, opts) {
    const o = opts || {};
    const findings = [];
    if (!N || !layout || !layout.room) {
      return {
        score: 0, counts: { high: 0, medium: 0, low: 0 }, findings: [],
        metrics: emptyMetrics(), heat: null,
      };
    }
    const room = layout.room;
    const items = (layout.items || []).slice();
    const solids = N.solidsOf(layout);
    const grid = N.grid(layout, { solids: solids });
    const evt = R ? R.eventOf(o.event) : null;
    const mainClear = (evt && evt.spine) || CLEAR.main;

    const add = (severity, title, detail, need, got, item, extra) =>
      findings.push(Object.assign({
        severity, title, detail, need, got,
        item: item || null,
        at: item ? centreOf(item) : (extra && extra.at) || null,
      }, extra || {}));

    /* ── 1 · Entrances ─────────────────────────────────────────────────── */
    const doors = items.filter((i) => roleOf(i.kind) === "access" && String(i.kind) !== "spawn");
    const guestDoors = doors.filter((d) => String(d.kind) === "door");
    const exits = doors.filter((d) => String(d.kind) === "exit");

    if (!guestDoors.length) {
      add("medium", "No doorway marked",
        "The plan doesn't say where guests come in. The walkthrough will start at the clearest open floor, and the crew will have to decide on the night.",
        null, null, null);
    }
    doors.forEach((d) => {
      const kind = String(d.kind);
      const isExit = kind === "exit";
      const w = Math.max(Number(d.w) || 0, Number(d.h) || 0);
      const minWidth = isExit ? 1.1 : 0.9;
      if (w < minWidth - 0.05) {
        add("high", isExit ? "Emergency exit too narrow" : "Doorway too narrow",
          `${kindLabel(d)} is ${round2(w)} m wide. ${isExit
            ? "A fire exit wants a clear 1.1 m so two people can leave abreast."
            : "A single leaf is 0.9 m and a guest with a plate wants more."}`,
          minWidth, round2(w), d);
      }
      /* Clear floor immediately inside the opening.

         The probe steps STRAIGHT in from whichever wall the door is on —
         never diagonally. A door centred on the back wall is close to that
         wall on one axis and in the middle on the other; offsetting both axes
         walks the probe sideways into the corner, and reports a blocked
         entrance because there is a planter three metres away from it. */
      const need = isExit ? CLEAR.emergency : CLEAR.doorSwing;
      const inward = stepInside(d, room, need);
      /* Measured as a WIDTH, not a radius. clearanceAt returns the distance
         to the nearest edge; comparing that straight against a required floor
         width asks for the full clearance on each side and reports a blocked
         entrance whenever a table sits 2 m away. corridorWidth measures the
         thing the requirement is actually about. */
      const clear = N.corridorWidth(grid, inward.x, inward.y, 6);
      if (clear < need) {
        add(isExit ? "high" : (clear < need * 0.6 ? "high" : "medium"),
          isExit ? "Emergency exit is obstructed" : "Entrance is blocked",
          `Only ${round2(clear)} m of clear floor inside ${kindLabel(d)}. ${isExit
            ? "An exit route has to stay clear for the whole event — this is a fire regulation, not a preference."
            : "Guests arrive in bunches and need room to spread into."}`,
          need, round2(clear), d);
      }
    });

    // A room with no marked fire exit. Advisory: many venues' exits are the
    // same doors the guests come in by, and the plan may simply not say so.
    if (!exits.length && items.length > 6) {
      add("low", "No emergency exit marked",
        "Nothing on the plan is marked as a fire exit. Mark the ones the venue has, so the analysis can keep them clear.",
        null, null, null);
    }

    /* ── 2 · Reachability (A* flood fill) ──────────────────────────────── */
    const entry = entryPoint(layout, solids, room, guestDoors.length ? guestDoors : doors);
    const walkable = N.walkableCount(grid);
    const reach = N.reachable(grid, entry);
    const pct = walkable ? reach.count / walkable : 0;
    if (walkable && pct < 0.98) {
      const lostM2 = round2((walkable - reach.count) * grid.cell * grid.cell);
      add(pct < 0.8 ? "high" : "medium", "Part of the floor is cut off",
        `${Math.round((1 - pct) * 100)}% of the walkable floor (about ${lostM2} m²) can't be reached from the entrance without moving furniture.`,
        null, null, null);
    }

    /* ── 3 · Overlaps ──────────────────────────────────────────────────── */
    for (let a = 0; a < solids.length; a++) {
      for (let b = a + 1; b < solids.length; b++) {
        const A = solids[a], B = solids[b];
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox > 0.02 && oy > 0.02) {
          add("high", "Two pieces overlap",
            `${kindLabel(A.item)} and ${kindLabel(B.item)} are standing in the same place — they overlap by ${round2(Math.min(ox, oy))} m.`,
            0, round2(Math.min(ox, oy)), A.item);
        }
      }
    }

    /* ── 4 · Clearance between neighbours ──────────────────────────────
       Only NEIGHBOURS: every pair in a 40-piece room is 780 comparisons, and
       most of them are two tables at opposite ends with nothing to say to
       each other. Pairs more than 3 m apart are skipped — beyond that the gap
       is a room, not a gap. */
    const tight = [];
    for (let a = 0; a < solids.length; a++) {
      for (let b = a + 1; b < solids.length; b++) {
        const A = solids[a], B = solids[b];
        if (A.top <= N.STEP || B.top <= N.STEP) continue;   // steppable
        const dx = Math.max(A.x0 - B.x1, B.x0 - A.x1, 0);
        const dy = Math.max(A.y0 - B.y1, B.y0 - A.y1, 0);
        if (dx > 3 || dy > 3) continue;
        // Overlapping on one axis means the other axis IS the gap between them.
        const overlapX = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 0;
        const overlapY = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) > 0;
        if (!overlapX && !overlapY) continue;               // diagonal, not facing
        const gap = overlapX ? dy : dx;
        if (gap <= 0.02) continue;                          // handled as overlap
        // Two segments of ONE continuous run — a long head table laid as
        // three trestles, or the arms of a U — are not two crowded pieces
        // with a corridor missing between them.
        if (isSameRun(A, B, gap)) continue;
        if (gap < CLEAR.service) tight.push({ A, B, gap });
      }
    }
    // Report the worst first and cap the list — thirty identical warnings is
    // a wall of text nobody reads, and the first few say the same thing.
    tight.sort((p, q) => p.gap - q.gap).slice(0, 8).forEach((t) => {
      const seated = (t.A.item.seats || 0) + (t.B.item.seats || 0) > 0;
      const need = seated ? CLEAR.service : CLEAR.guest;
      if (t.gap >= need) return;
      add(t.gap < CLEAR.guest ? "high" : "medium", "Not enough room between pieces",
        `${kindLabel(t.A.item)} and ${kindLabel(t.B.item)} are ${round2(t.gap)} m apart.` +
        (seated ? " With chairs pulled out on both sides, nobody gets through." : ""),
        need, round2(t.gap), t.A.item);
    });

    /* ── 5 · Against the wall ──────────────────────────────────────────
       A seated table with its back to a wall is fine; a seated table 0.3 m
       from one has guests climbing over each other to sit down. Measured on
       the axis that is actually tight, and only for pieces people sit at. */
    solids.forEach((s) => {
      if (roleOf(s.kind) !== "seating") return;
      if (!(Number(s.item.seats) > 0)) return;
      const gaps = { west: s.x0, east: room.w - s.x1, north: s.y0, south: room.h - s.y1 };
      const side = Object.keys(gaps).reduce((a, b) => (gaps[a] <= gaps[b] ? a : b));
      const gap = gaps[side];
      if (gap < CLEAR.wall) {
        add(gap < CLEAR.chairPull ? "medium" : "low", "Table is tight to the wall",
          `${kindLabel(s.item)} sits ${round2(gap)} m off the ${side} wall. A chair pulled out needs ${CLEAR.chairPull} m, and a guest has to get past it.`,
          CLEAR.wall, round2(gap), s.item);
      }
    });

    /* ── 6 · Can every table be reached? (A*) ──────────────────────────── */
    let unreachable = 0;
    let firstBad = null;
    const seatedItems = items.filter((it) =>
      roleOf(it.kind) === "seating" && Number(it.seats) > 0);

    /* Reachability is checked against the FLOOD FILL, not with a route per
       table. The fill in §2 already visited every cell a guest entering at
       the door can stand on; a table is reachable exactly when there is a
       reachable cell beside it. That is one pass for the whole room instead
       of one A* search per table — the difference between a check that can
       run on every edit and one that cannot — and it is the same question,
       answered from the same grid.

       "Beside it" is the nearest walkable cell within a table's own reach.
       A table whose surroundings the fill never touched is a table its
       guests would have to climb furniture to sit at, which is the finding. */
    const seen = reach.seen;
    /* Is ANY floor a guest could sit from reachable?

       nearestWalkable finds the closest walkable cell, which for a table
       boxed into a corner is a cell on the far side of whatever is boxing it
       in — reachable, and nothing to do with this table. So the ring around
       the table is tested directly instead: the floor a chair would stand
       on, at the table's own edge plus a chair's depth. A table none of whose
       own surround is reachable is a table its guests cannot get to.

       Sampled on eight compass points, which is enough to find the one open
       side of an otherwise enclosed table and cheap enough to run per table. */
    const RING = [[1, 0], [-1, 0], [0, 1], [0, -1],
                  [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]];
    const surroundReachable = (it) => {
      const c = centreOf(it);
      const reachOut = Math.max(Number(it.w) || 1, Number(it.h) || 1) / 2 + CLEAR.chairPull;
      for (let k = 0; k < RING.length; k++) {
        const x = c.x + RING[k][0] * reachOut;
        const y = c.y + RING[k][1] * reachOut;
        if (x < 0 || y < 0 || x > room.w || y > room.h) continue;
        const cell = grid.toCell(x, y);
        if (!grid.at(cell.i, cell.j)) continue;
        if (seen[grid.idx(cell.i, cell.j)]) return true;
      }
      return false;
    };
    seatedItems.forEach((it) => {
      if (!surroundReachable(it)) {
        unreachable++;
        if (!firstBad) firstBad = it;
      }
    });
    if (unreachable) {
      add("high", "Tables can't be walked to",
        `${unreachable} seated table${unreachable === 1 ? "" : "s"} have no walkable route from the entrance — starting with ${kindLabel(firstBad)}.`,
        null, null, firstBad);
    }

    /* ── 7 · Service positions ─────────────────────────────────────────── */
    items.forEach((it) => {
      const kind = String(it.kind);
      const def = defOf(kind);
      const role = roleOf(kind);
      const c = centreOf(it);

      if (role === "service" && def.servesPerMetre) {
        // A serving line needs standing room on its long side to queue at.
        const long = Math.max(Number(it.w) || 0, Number(it.h) || 0);
        const alongX = (Number(it.w) || 0) >= (Number(it.h) || 0);
        const need = kind === "bar" ? CLEAR.barQueue : CLEAR.buffetQueue;
        const off = (alongX ? (Number(it.h) || 0.8) : (Number(it.w) || 0.8)) / 2 + 0.75;
        const probe = alongX
          ? [{ x: c.x, y: c.y - off }, { x: c.x, y: c.y + off }]
          : [{ x: c.x - off, y: c.y }, { x: c.x + off, y: c.y }];
        const best = Math.max(
          N.corridorWidth(grid, probe[0].x, probe[0].y, 6),
          N.corridorWidth(grid, probe[1].x, probe[1].y, 6));
        if (best < need) {
          add(best < CLEAR.guest ? "high" : "medium", "No queuing room at the service line",
            `${kindLabel(it)} has ${round2(best)} m of floor on its serving side. A line of guests needs about ${need} m.`,
            need, round2(best), it);
        }
        if (kind === "buffet" && long < 2) {
          add("low", "Short buffet line",
            `${kindLabel(it)} is ${round2(long)} m long — roughly ${Math.round(long * def.servesPerMetre)} guests a service. Consider a second station.`,
            null, null, it);
        }
      }

      if (kind === "stage") {
        const front = (Number(it.y) || 0) + (Number(it.h) || 0) + 1.0;
        if (front < room.h) {
          const clear = N.corridorWidth(grid, c.x, front, 6);
          if (clear < CLEAR.stageFront) {
            add(clear < CLEAR.guest ? "high" : "medium", "No approach to the stage",
              `${kindLabel(it)} has ${round2(clear)} m of floor in front of it. The party going up needs about ${CLEAR.stageFront} m.`,
              CLEAR.stageFront, round2(clear), it);
          }
        }
      }

      if (kind === "dance") {
        // A dance floor boxed in on every side is a dance floor nobody uses.
        const probes = [
          { x: c.x, y: (Number(it.y) || 0) - 0.6 },
          { x: c.x, y: (Number(it.y) || 0) + (Number(it.h) || 1) + 0.6 },
          { x: (Number(it.x) || 0) - 0.6, y: c.y },
          { x: (Number(it.x) || 0) + (Number(it.w) || 1) + 0.6, y: c.y },
        ].filter((p) => p.x > 0 && p.y > 0 && p.x < room.w && p.y < room.h);
        const open = probes.filter((p) => N.corridorWidth(grid, p.x, p.y, 4) >= CLEAR.danceEdge);
        if (probes.length && !open.length) {
          add("medium", "Dance floor is boxed in",
            `${kindLabel(it)} has no clear approach on any side. Guests need at least ${CLEAR.danceEdge} m to step on and off.`,
            CLEAR.danceEdge, 0, it);
        }
      }

      if (kind === "screen" || kind === "dj" || kind === "speaker") {
        // A screen facing a wall, or a speaker in a corner, is a fixture
        // nobody planned a sightline for. Cheap check, real complaint.
        const clear = N.corridorWidth(grid, c.x, c.y, 8);
        if (clear > 0 && clear < CLEAR.guest) {
          add("low", "Fixture has no clear space",
            `${kindLabel(it)} stands in ${round2(clear)} m of floor. Nobody can get to it to work it.`,
            CLEAR.guest, round2(clear), it);
        }
      }
    });

    /* ── 8 · Emergency egress ──────────────────────────────────────────
       Every seated table should have a walkable route to a marked exit. This
       is the check that matters most and the one a designer is least likely
       to run by eye. Skipped entirely when no exit is marked — the "no exit
       marked" finding above already says the useful thing. */
    if (exits.length && seatedItems.length) {
      /* Flood-filled from the exits rather than routed table by table, for
         the same reason as §6 above: one pass answers it for the whole room.
         A table is stranded when no exit's fill reaches the floor beside it.

         Filling from the EXITS rather than from each table is what makes one
         pass enough — reachability on this grid is symmetric, so "the exit
         can reach you" and "you can reach the exit" are the same statement. */
      const egress = new Uint8Array(grid.cols * grid.rows);
      exits.forEach((e) => {
        const at = stepInside(e, room, 0.9);
        const fill = N.reachable(grid, at);
        for (let i = 0; i < egress.length; i++) if (fill.seen[i]) egress[i] = 1;
      });
      let stranded = 0, firstStranded = null;
      // Tested on the table's own surround, for the same reason as §6 above:
      // the nearest walkable cell to a boxed-in table is on the wrong side of
      // whatever is boxing it in.
      const canGetOut = (it) => {
        const c = centreOf(it);
        const reachOut = Math.max(Number(it.w) || 1, Number(it.h) || 1) / 2 + CLEAR.chairPull;
        for (let k = 0; k < RING.length; k++) {
          const x = c.x + RING[k][0] * reachOut;
          const y = c.y + RING[k][1] * reachOut;
          if (x < 0 || y < 0 || x > room.w || y > room.h) continue;
          const cell = grid.toCell(x, y);
          if (!grid.at(cell.i, cell.j)) continue;
          if (egress[grid.idx(cell.i, cell.j)]) return true;
        }
        return false;
      };
      seatedItems.forEach((it) => {
        if (!canGetOut(it)) {
          stranded++;
          if (!firstStranded) firstStranded = it;
        }
      });
      if (stranded) {
        add("high", "No route to a fire exit",
          `${stranded} table${stranded === 1 ? "" : "s"} have no walkable route to any marked emergency exit — starting with ${kindLabel(firstStranded)}.`,
          null, null, firstStranded);
      }
    }

    /* ── 9 · Walkways across the room ──────────────────────────────────
       The main route in, and the narrowest point on it. */
    const mid = { x: room.w / 2, y: room.h / 2 };
    const spine = N.findPath(grid, entry, mid, { snap: 4, raw: true });
    let spineWidth = null;
    if (spine && spine.length > 2) {
      let narrowest = Infinity, where = null;
      for (let i = 2; i < spine.length - 2; i += 3) {
        const width = N.corridorWidth(grid, spine[i].x, spine[i].y, 6);
        if (width < narrowest) { narrowest = width; where = spine[i]; }
      }
      if (narrowest < Infinity) {
        spineWidth = round2(narrowest);
        if (narrowest < mainClear) {
          add(narrowest < CLEAR.guest ? "high" : "medium", "Main route is tight",
            `The way in from the entrance narrows to ${round2(narrowest)} m of clear floor. A main circulation route wants about ${mainClear} m.`,
            mainClear, round2(narrowest), null, { at: where });
        }
      }
    }

    /* ── 10 · Congestion ───────────────────────────────────────────────
       Where the room's own journeys overlap.

       Not a guess and not a decoration: a route is planned from the entrance
       to every seated table, and from every table to the nearest service
       piece — the journeys guests actually make. nav counts how many of them
       cross each patch of floor, and the peaks are where the queue forms.
       Because the routes are A* over the real grid, a bottleneck reported
       here is a bottleneck the walkthrough will also walk into. */
    /* The route budget.

       Every route is an A* run over a ~10 000-cell grid, and the honest
       version of this — a path from every table to every service piece —
       is tables × stations, which on a 40-table ballroom with three
       stations is 120 searches and about a third of a second. That is
       fine once and far too slow to re-run on every drag of a table,
       which is exactly when this analysis is wanted.

       So the tables are SAMPLED rather than exhausted: an evenly spaced
       subset, and each one routed to its NEAREST station rather than to
       all of them. Both approximations point the same way as the real
       thing — guests go to the nearest buffet, and a bottleneck that
       twenty tables' routes cross is still crossed by ten of them. The
       traffic threshold below scales with how many routes were actually
       planned, so sampling changes the resolution of the answer and not
       the answer.

       Every route is still a genuine A* path over the real grid: what is
       reduced is how many are drawn, never how honestly each is found. */
    const MAX_ROUTES = 60;
    const servicePieces = items.filter((it) => roleOf(it.kind) === "service" && !defOf(it.kind).staffOnly);
    // Two legs per sampled table (in from the door, out to a station), so
    // the sample size is the budget halved.
    const perTable = servicePieces.length ? 2 : 1;
    const sampleEvery = Math.max(1, Math.ceil((seatedItems.length * perTable) / MAX_ROUTES));
    const sampled = seatedItems.filter((_, i) => i % sampleEvery === 0);

    const routes = [];
    sampled.forEach((it) => {
      const c = centreOf(it);
      const inbound = N.findPath(grid, entry, c, { snap: 3 });
      if (inbound) routes.push(inbound);
      if (!servicePieces.length) return;
      // The station this table's guests would actually walk to.
      let nearest = null, bestD = Infinity;
      servicePieces.forEach((sv) => {
        const sc = centreOf(sv);
        const d = Math.hypot(sc.x - c.x, sc.y - c.y);
        if (d < bestD) { bestD = d; nearest = sc; }
      });
      if (!nearest) return;
      const leg = N.findPath(grid, c, nearest, { snap: 3 });
      if (leg) routes.push(leg);
    });

    let congestion = [];
    if (routes.length) {
      const field = N.traffic(grid, routes, { spread: 0.45 });
      // The threshold scales with how many journeys were planned: "hot" means
      // a good share of the room's traffic passes here, not a fixed count
      // that would flag every plan with more tables.
      const threshold = Math.max(3, routes.length * 0.28);
      congestion = N.hotspots(grid, field, threshold, { minCells: 8 }).slice(0, 5)
        .map((h) => {
          const width = N.corridorWidth(grid, h.x, h.y, 6);
          const near = nearestPiece(items, h.x, h.y);
          return {
            x: h.x, y: h.y, area: h.area, peak: Math.round(h.peak),
            width: round2(width),
            share: Math.round((h.peak / routes.length) * 100),
            label: near ? kindLabel(near) : "Open floor",
            item: near || null,
            level: width < CLEAR.guest ? "critical" : width < CLEAR.service ? "moderate" : "fair",
          };
        });
      congestion.filter((h) => h.level !== "fair").slice(0, 3).forEach((h) => {
        // Queue estimate: guests whose route crosses this spot, at the
        // serving rate of whatever they are queuing for.
        add(h.level === "critical" ? "high" : "medium", "Congestion point",
          `About ${h.share}% of the room's routes pass through ${h.width} m of floor near ${h.label}. ` +
          `At a full house that is where the queue forms.`,
          CLEAR.service, h.width, h.item, { at: { x: h.x, y: h.y }, congestion: h });
      });
    }

    /* ── 11 · Capacity ─────────────────────────────────────────────────
       Two different questions, both worth asking:
         · do the seats on the plan match the headcount booked?
         · does the ROOM have the floor area for that headcount at all? */
    const seats = seatedItems.reduce((n, it) => n + (Number(it.seats) || 0), 0);
    const standing = items.reduce((n, it) => n + (defOf(it.kind).standing || 0), 0);
    const area = room.w * room.h;
    const perGuest = (evt && evt.area) || (R ? R.AREA.seatedRound : 1.5);
    const roomCapacity = Math.floor(area / perGuest);
    const pax = Number(o.pax) || 0;

    if (pax) {
      if (seats + standing < pax) {
        const short = pax - seats - standing;
        add(short > pax * 0.15 ? "high" : "medium", "Not enough covers",
          `The plan seats ${seats}${standing ? ` (plus ${standing} standing)` : ""} against ${pax} booked — ${short} guest${short === 1 ? "" : "s"} with nowhere to sit.`,
          pax, seats + standing, null);
      }
      if (pax > roomCapacity) {
        add("high", "Room is too small for the headcount",
          `${round2(area)} m² at ${perGuest} m² a guest is about ${roomCapacity} people. ${pax} are booked.`,
          roomCapacity, pax, null);
      }
    }

    /* ── 12 · What this event type expects ─────────────────────────────
       Advisory only, and quiet: one finding listing everything missing,
       never one per piece. A designer who deliberately runs a wedding with
       no dance floor should not be nagged five times. */
    if (evt && evt.wants && items.length) {
      const present = Object.create(null);
      items.forEach((it) => { present[String(it.kind)] = 1; });
      const missing = evt.wants.filter((k) => !present[k]);
      if (missing.length) {
        add("low", `Usual for a ${evt.label.toLowerCase()}`,
          `This plan has no ${missing.map((k) => defOf(k).label.toLowerCase()).join(", ")}. Not a fault — just what this kind of function normally wants.`,
          null, null, null);
      }
    }

    /* ── Metrics ───────────────────────────────────────────────────────
       The numbers the status panel shows. All derived, none stored. */
    const walkableM2 = round2(walkable * grid.cell * grid.cell);
    const tables = seatedItems.length;
    const metrics = {
      seats, standing, tables, pax,
      roomArea: round2(area),
      walkableArea: walkableM2,
      roomCapacity,
      reachablePct: Math.round(pct * 100),
      // Walkability: how much of the walkable floor is actually a usable
      // width. A room that is technically walkable through 0.7 m slots is
      // not a walkable room, and this is the number that says so.
      walkabilityPct: walkabilityScore(grid),
      spineWidth,
      congestionAreas: congestion.filter((h) => h.level !== "fair").length,
      utilisation: seats ? Math.round((Math.min(pax || seats, seats) / seats) * 100) : 0,
      exits: exits.length,
      doors: guestDoors.length,
    };

    /* ── Score ─────────────────────────────────────────────────────────
       Not a percentage of anything measurable — a plain weighting so a list
       of eight findings can be sorted into "fix this before Saturday" and
       "worth a look". Stated as such in the UI. */
    const counts = { high: 0, medium: 0, low: 0 };
    findings.forEach((f) => { counts[f.severity]++; });

    /* Diminishing rather than subtractive.

       A flat penalty per finding hits zero at six serious ones, and from
       there a plan with six problems and a plan with twenty both read 0 —
       which is exactly when the designer most needs the number to move.
       Fixing four of twenty findings is real progress and the score has to
       show it, or the optimiser's work is invisible.

       Each finding now costs a SHARE of what remains, so the score falls
       steeply at first and then ever more gently, approaching zero without
       reaching it. Twenty findings still reads as dire; nineteen reads as
       marginally less dire, which is the truth. */
    const decay = (n, k) => Math.pow(1 - k, n);
    const score = Math.round(100
      * decay(counts.high, 0.20)
      * decay(counts.medium, 0.075)
      * decay(counts.low, 0.02));

    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((a, b) => order[a.severity] - order[b.severity]);
    findings.forEach((f, i) => { f.id = "f" + i; });

    return {
      score, counts, findings, metrics, congestion,
      entry, grid, solids,
      walkablePct: metrics.reachablePct,
      // The width field, built only when asked for — the heatmap is the one
      // caller that needs it and it costs a pass over the room.
      heat: o.heat ? { field: N.widthField(grid, { sample: 0.5 }), grid: grid } : null,
    };
  }

  /* How much of the walkable floor is a USABLE width. Sampled coarsely: the
     answer moves over metres, and a finer sample would cost a lot of ray
     walking for the same percentage. */
  function walkabilityScore(grid) {
    const field = N.widthField(grid, { sample: 0.75, cap: 4 });
    let good = 0, total = 0;
    for (let i = 0; i < field.length; i++) {
      if (!grid.walk[i]) continue;
      total++;
      if (field[i] >= CLEAR.service) good++;
      else if (field[i] >= CLEAR.guest) good += 0.5;   // passable, not comfortable
    }
    return total ? Math.round((good / total) * 100) : 0;
  }

  function emptyMetrics() {
    return {
      seats: 0, standing: 0, tables: 0, pax: 0, roomArea: 0, walkableArea: 0,
      roomCapacity: 0, reachablePct: 0, walkabilityPct: 0, spineWidth: null,
      congestionAreas: 0, utilisation: 0, exits: 0, doors: 0,
    };
  }

  /* A pace straight in from a door's OWN wall.

     Never diagonally: a door centred on the back wall is close to that wall
     on one axis and in the middle on the other, and offsetting both axes
     walks the probe sideways into the corner. */
  function stepInside(d, room, dist) {
    const cx = (Number(d.x) || 0) + (Number(d.w) || 0.9) / 2;
    const cy = (Number(d.y) || 0) + (Number(d.h) || 0.25) / 2;
    const gaps = { north: cy, south: room.h - cy, west: cx, east: room.w - cx };
    const side = Object.keys(gaps).reduce((a, b) => (gaps[a] <= gaps[b] ? a : b));
    const step = dist || 0.9;
    if (side === "north") return { x: cx, y: cy + step, side };
    if (side === "south") return { x: cx, y: cy - step, side };
    if (side === "west") return { x: cx + step, y: cy, side };
    return { x: cx - step, y: cy, side };
  }

  // What a point on the floor is nearest to — so a congestion report can say
  // "near the buffet" rather than "at 8.2, 5.6".
  function nearestPiece(items, x, y) {
    let best = null, bestD = 4;
    (items || []).forEach((it) => {
      if (String(it.kind) === "spawn") return;
      const c = centreOf(it);
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) { bestD = d; best = it; }
    });
    return best;
  }

  /* Where a guest comes in: the marked start point, else the first doorway,
     else the clearest floor. The same order the walkthrough spawns by, so the
     report describes the room the simulator actually drops you into. */
  function entryPoint(layout, solids, room, doors) {
    const spawn = (layout.items || []).find((i) => String(i.kind) === "spawn");
    if (spawn) return centreOf(spawn);
    if (doors && doors.length) return stepInside(doors[0], room, 0.9);
    let best = { x: room.w / 2, y: room.h - 1, d: -1 };
    for (let x = 0.6; x < room.w; x += 0.6) {
      for (let y = 0.6; y < room.h; y += 0.6) {
        const d = N.clearanceAt(solids, x, y);
        if (d > best.d) best = { x, y, d };
      }
    }
    return { x: best.x, y: best.y };
  }

  return { analyse, CLEAR, entryPoint, stepInside };
})();
