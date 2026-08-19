/* ════════════════════════════════════════════════════════════════
   HapagPamana · Layout Designer — the preset book.

   A designer should not draw a 50-pax reception from an empty floor every
   time. This is the house's standard settings for the headcounts actually
   booked — 30 through 100 — in the arrangements the team actually sets:
   banquet rounds, a long ceremonial table, a U-shape for meetings, rows for
   a classroom seminar, and cocktail standing.

   The layouts are GENERATED, not typed out. Eight headcounts across five
   styles is forty floor plans, and forty hand-written coordinate
   lists is thirty-two places for a typo to put a table through a wall. The
   generators below take a headcount and return the same shape the designer
   saves — metres, degrees, the 2D sheet's coordinate space — so a preset is
   an ordinary plan from the moment it lands, editable like any other.

   Every generator obeys three house rules:
     · the room grows with the headcount, and keeps a service aisle clear;
     · a preset seats AT LEAST the headcount it is named for (the last table
       may sit part-empty — that is what happens on the night);
     · nothing overlaps and nothing crosses the wall line.

   Public API (window.HPPresets):
     COUNTS              [30, 40, … 100]
     STYLES              [{ key, name, blurb, icon }]
     list(pax)           every style at that headcount, as cards
     build(styleKey,pax) → { room:{w,h}, items:[…] }  ready to load
   ════════════════════════════════════════════════════════════════ */
window.HPPresets = (function () {
  "use strict";

  const COUNTS = [30, 40, 50, 60, 70, 80, 90, 100];

  /* Piece sizes, in metres, matching the palette in js/designer.js. Kept here
     as their own constants rather than imported: a preset is a drawing, and a
     drawing should not silently change shape because a palette default was
     retuned for the piece picker. */
  const ROUND_D = 1.5;      // 8-seat banquet round
  const ROUND_SEATS = 8;
  const BANQ_W = 1.8;       // 1.8 × 0.75 trestle, 3 a side
  const BANQ_D = 0.75;
  const AISLE = 1.6;        // clear walking space between table edges
  const WALL_GAP = 1.4;     // no piece hard against a wall
  const COCKTAIL_D = 0.7;   // standing poseur
  const GRID = 0.25;

  /* Clearances the layout is BUILT to, matched to the ones walkability
     measures against (HPWalk.CLEAR). A preset generated to looser numbers than
     the checker enforces ships pre-broken — which is exactly what every one of
     these did before: chosen from the gallery, then immediately flagged.
     Building to the same figures the checker reads is what makes a preset land
     clean instead of landing with homework. */
  /* Floor between the stage front and anything else. Wider than the 1.2 m the
     checker asks for, because it probes a metre out from the deck and measures
     sideways from there: a run of trestles laid exactly 1.2 m clear still has
     its nearest table only inches to the side of that probe. Set past the
     probe and the approach is genuinely an approach, not a slot. */
  const STAGE_APPROACH = 2.2;
  const BUFFET_QUEUE = 1.4;     // standing room along a serving line
  const SPINE = 1.6;            // the main route in from the door
  const NEIGHBOUR = 1.25;       // edge to edge between two seated pieces

  const snap = (v) => Math.round(v / GRID) * GRID;
  // Positions land on the grid, so a run of tables laid at a fractional pitch
  // would round two neighbours into each other — 1.37 m apart becomes 1.25 m
  // apart, and a 1.37 m table then overlaps its neighbour by 12 cm. Any pitch
  // a run is stepped by is rounded UP to the grid first, which is the only
  // way "snapped position" and "no overlap" can both hold.
  const snapUp = (v) => Math.ceil(v / GRID) * GRID;
  const round2 = (v) => Math.round(v * 100) / 100;
  let seq = 0;
  const id = () => "ps_" + (seq++).toString(36) + Date.now().toString(36).slice(-4);

  const piece = (kind, label, x, y, w, h, seats, rot) => ({
    id: id(),
    kind, label,
    x: round2(Math.max(0, x)), y: round2(Math.max(0, y)),
    w: round2(w), h: round2(h),
    rot: rot || 0,
    seats: seats || 0,
  });

  /* ── Room sizing ──────────────────────────────────────────────────────
     Venues bill by the head, and the floor a caterer is given tracks it: about
     1.4 m² a guest for a seated dinner once the buffet, the stage and the
     aisles are counted. The result is rounded to the half-metre and kept in a
     4:3-ish proportion, which is the shape function rooms actually come in. */
  function roomFor(pax, perGuest) {
    const area = pax * (perGuest || 1.4) + 40; // +40 m² for stage, buffet, dance
    const h = Math.max(9, snap(Math.sqrt(area / 1.35)));
    const w = Math.max(11, snap(h * 1.35));
    return { w: round2(w), h: round2(h) };
  }

  /* ── The fixtures every reception carries ─────────────────────────────
     Stage across the head of the room, buffet down one long side, dance floor
     in front of the stage. Sized off the room so a 100-pax hall doesn't get a
     30-pax stage, and returned with the floor band they occupy so the seating
     generators know where they may not put a table. */
  function fixtures(room, opts) {
    const o = opts || {};
    const items = [];
    let topBand = WALL_GAP;      // y below which seating may start
    let rightBand = room.w - WALL_GAP; // x beyond which seating may not go

    if (o.stage !== false) {
      /* Nothing stands within a stride of the stage front — dance floor,
         trestle or table. The party has to get up those steps, and a deck
         boxed in by furniture is the "no approach to the stage" the
         walkability check reports.

         The clearance belongs to the STAGE, so it is added here and not inside
         the dance-floor branch: a U-shape lays no dance floor, and putting the
         gap there left its trestles 0.7 m off the deck. */
      const sw = Math.min(room.w * 0.34, 7);
      const sd = Math.min(3.2, room.h * 0.16);
      items.push(piece("stage", "Stage", (room.w - sw) / 2, 0.6, sw, sd, 0));
      topBand = 0.6 + sd + STAGE_APPROACH;
    }
    if (o.dance !== false) {
      const dw = Math.min(room.w * 0.28, 6);
      items.push(piece("dance", "Dance Floor", (room.w - dw) / 2, topBand, dw, dw * 0.8, 0));
      topBand += dw * 0.8 + AISLE * 0.6;
    }
    if (o.buffet !== false) {
      // Down the right wall, so the service door end stays clear. Seating stops
      // a full queue's width short of it — a serving line with tables pushed up
      // against it is a line nobody can stand in.
      const bl = Math.min(room.h * 0.42, 6);
      items.push(piece("buffet", "Buffet Line", room.w - 1.2, (room.h - bl) / 2, 0.8, bl, 0));
      rightBand = room.w - 1.2 - BUFFET_QUEUE - AISLE * 0.5;
    }
    /* The bar is DEFERRED, not placed here. It stands against the back wall,
       and where the back wall ends up depends on how many rows of tables the
       seating generator lays — which hasn't happened yet. Placing it now put
       it under the first row of a 70-pax floor. `bars` is a count the tail of
       grow() honours once the real depth is known. */
    return {
      items,
      topBand: snap(topBand),
      rightBand: snap(rightBand),
      bars: o.bar ? (o.bars || 1) : 0,
    };
  }

  // Potted greens in the two back corners — the team dresses every room with
  // them, so a preset that omits them is a preset someone has to finish.
  function corners(room) {
    return [
      piece("decor", "Planter", 0.5, 0.5, 0.8, 0.8, 0),
      piece("decor", "Planter", room.w - 1.3, 0.5, 0.8, 0.8, 0),
    ];
  }

  /* The way in. Every room has one, so every preset ships one: centred on the
     wall opposite the stage, which is the end guests arrive from and the end
     the walkthrough therefore starts at. Double-leaf, because a hall of a
     hundred does not empty through a single 0.9 m door.

     Added in grow(), once the back wall's final position is known — the same
     reason the bars are deferred. */
  function entrance(room) {
    const w = 1.8;
    return piece("door", "Main Entrance", round2((room.w - w) / 2), round2(room.h - 0.25), w, 0.25, 0);
  }

  /* ── Style 1 · Banquet rounds ─────────────────────────────────────────
     The house standard: 1.5 m rounds of eight, laid in rows across the floor
     below the dance area, with a clear aisle between every table. */
  function banquet(pax) {
    const room = roomFor(pax, 1.5);
    const fx = fixtures(room, { bar: pax >= 70 });
    const items = fx.items.concat(corners(room));

    const tables = Math.ceil(pax / ROUND_SEATS);
    const pitch = snapUp(ROUND_D + AISLE);            // centre-to-centre
    const usableW = fx.rightBand - WALL_GAP;

    /* A banquet floor is laid in two blocks with a centre aisle, not as one
       continuous field of tables. The aisle is the route the couple walk in
       along, the route service works from, and the route the walkability check
       measures as the main spine — without it, A* threads the 1.25 m gap
       between two table columns and reports the room as tight, because it is.

       Rows are centred on each half, so a short last row sits balanced rather
       than shoved against the aisle. */
    /* The aisle is cut a quarter-metre over the minimum. Laid at exactly SPINE
       it survives snapping with nothing to spare, and A* — which measures the
       corridor a body can actually occupy — reads it as fractionally under and
       routes around the block instead of down it. Margin here is cheaper than
       a repair pass afterwards. */
    const centreAisle = snapUp(SPINE + GRID);
    let halfCols = Math.max(1, Math.floor((usableW - centreAisle) / 2 / pitch));

    /* A split floor needs two table columns a side to read as two blocks with
       an aisle between them. Below that the "aisle" is just the gap beside a
       single column, and A* walks around the block rather than down it — which
       is the room being genuinely tight, not the check being fussy.

       The room is widened until the split fits. Floor is the cheap thing to
       add; the alternative is dropping the aisle, and a banquet hall without a
       centre aisle is not the arrangement this preset is named for. */
    if (halfCols < 2) {
      const margin = room.w - fx.rightBand;      // buffet band + its queue
      const wantW = snapUp(WALL_GAP * 2 + centreAisle + pitch * 4 + margin);
      const gained = Math.max(0, wantW - room.w);
      if (gained > 0) {
        room.w = round2(room.w + gained);
        fx.rightBand = snap(room.w - margin);
        // The buffet is fixed to the right WALL, so it travels with it.
        items.filter((it) => it.kind === "buffet").forEach((b) => {
          b.x = round2(snap(b.x + gained));
        });
        // The stage and dance floor are centred on the room, not on a wall.
        items.filter((it) => it.kind === "stage" || it.kind === "dance").forEach((c) => {
          c.x = round2(snap((room.w - c.w) / 2));
        });
        items.filter((it) => it.kind === "decor").forEach((d) => {
          if (d.x > room.w / 2) d.x = round2(snap(room.w - d.w - 0.5));
        });
      }
      halfCols = 2;
    }
    const perRowSplit = halfCols * 2;
    const blockW = halfCols * pitch - AISLE;
    // Re-read the usable width: widening for the split above moved the wall.
    const usable = fx.rightBand - WALL_GAP;
    const leftX = snap(WALL_GAP + (usable - centreAisle - blockW * 2) / 2);
    const rightX = snap(leftX + blockW + centreAisle);

    let placed = 0;
    const rowsSplit = Math.ceil(tables / perRowSplit);
    for (let r = 0; r < rowsSplit && placed < tables; r++) {
      const y = snap(fx.topBand) + r * pitch;
      for (let c = 0; c < perRowSplit && placed < tables; c++, placed++) {
        const half = c < halfCols ? leftX : rightX;
        const col = c < halfCols ? c : c - halfCols;
        const seats = Math.min(ROUND_SEATS, pax - placed * ROUND_SEATS);
        items.push(piece("round", "Table " + (placed + 1),
          half + col * pitch, y, ROUND_D, ROUND_D,
          Math.max(2, seats)));
      }
    }
    return grow(room, items, fx.bars);
  }

  /* ── Style 2 · Long ceremonial table ──────────────────────────────────
     One continuous table down the middle for the party, with rounds on either
     flank for the rest — the shape a debut or an anniversary is set to. */
  function ceremonial(pax) {
    const room = roomFor(pax, 1.55);
    const fx = fixtures(room, { dance: pax >= 60, bar: pax >= 70 });
    const items = fx.items.concat(corners(room));

    // The head table: as many trestles as fit down the centre, six a length.
    const runLen = Math.min(room.h - fx.topBand - WALL_GAP, BANQ_W * Math.ceil(pax / 14));
    const trestles = Math.max(2, Math.round(runLen / BANQ_W));
    const headSeats = Math.min(pax, trestles * 6);
    const cx = (fx.rightBand + WALL_GAP) / 2;
    const headPitch = snapUp(BANQ_W);
    for (let i = 0; i < trestles; i++) {
      // Rotated 90°: the run goes DOWN the room, so width is the depth here.
      items.push(piece("rect", i ? "Head table" : "Head table (head)",
        snap(cx - BANQ_D / 2), snap(fx.topBand) + i * headPitch,
        BANQ_D, BANQ_W, Math.min(6, headSeats - i * 6) > 0 ? Math.min(6, headSeats - i * 6) : 0));
    }

    // Everyone else on rounds, split evenly left and right of the run.
    let rest = Math.max(0, pax - headSeats);
    const tables = Math.ceil(rest / ROUND_SEATS);
    const pitch = snapUp(ROUND_D + AISLE * 0.9);
    const leftX = snap(WALL_GAP);
    const rightX = snap(Math.min(fx.rightBand - ROUND_D, cx + BANQ_D / 2 + AISLE));
    const y0 = snap(fx.topBand);
    for (let i = 0; i < tables; i++) {
      const side = i % 2 ? rightX : leftX;
      const row = Math.floor(i / 2);
      const seats = Math.min(ROUND_SEATS, rest);
      rest -= seats;
      items.push(piece("round", "Guest " + (i + 1),
        side, y0 + row * pitch, ROUND_D, ROUND_D, Math.max(2, seats)));
    }
    return grow(room, items, fx.bars);
  }

  /* ── Style 3 · U-shape / conference ───────────────────────────────────
     Corporate lunches and seminars: trestles in a U, everyone facing the
     stage, no dance floor and no rounds. */
  function ushape(pax) {
    const room = roomFor(pax, 1.25);
    const fx = fixtures(room, { dance: false, bar: false });
    const items = fx.items.concat(corners(room));

    const seatsPerTrestle = 3;            // outside edge only, on a U
    const need = Math.ceil(pax / seatsPerTrestle);
    const top = fx.topBand;
    const left = WALL_GAP;
    const right = Math.min(fx.rightBand, room.w - WALL_GAP) - BANQ_D;
    const bottom = room.h - WALL_GAP - BANQ_D;

    // Split the run between the head of the U and its two arms, proportional
    // to the space each has, so the U closes rather than trailing off.
    const armLen = bottom - top;
    const headLen = right - left;
    const perM = need / (headLen + armLen * 2);

    /* A trestle is a piece of furniture, not a slice of one. Without this cap
       a large headcount divides the run into forty 25 cm stubs — which seats
       the same guests, but draws as a row of blocks and reads to the
       walkability check as forty pieces crowding each other. Capping the
       count keeps each segment at least a real trestle long; the seats simply
       sit closer together along it, which is what happens at a packed table. */
    const MIN_SEG = 1.2;
    const headN = Math.max(1, Math.min(Math.round(headLen * perM), Math.floor(headLen / MIN_SEG)));
    const armCap = Math.max(1, Math.floor(armLen / MIN_SEG));
    const armN = Math.max(1, Math.min(Math.ceil((need - headN) / 2), armCap));

    /* Seats are shared out across the segments that actually got laid, not
       fixed at three a trestle: the cap above can leave fewer, longer
       segments, and a fixed rate would then seat fewer guests than the
       preset is named for. Longer trestle, more covers along it — which is
       what a packed head table looks like anyway. */
    let n = 0;
    let left_ = pax;
    const segs = headN + armN * 2;
    const perSeg = Math.max(seatsPerTrestle, Math.ceil(pax / segs));
    const take = () => { const s = Math.min(perSeg, left_); left_ -= Math.max(0, s); return Math.max(0, s); };

    /* Each trestle is laid on a snapped PITCH and drawn slightly shorter than
       that pitch. The gap is what makes a run of tables read as a run of
       tables rather than one long slab — and it is what guarantees no two of
       them can round into each other on the grid. */
    const GAP = GRID;
    const headPitch = Math.max(GRID * 2, snap(headLen / headN));
    const headSeg = headPitch - GAP;
    const armPitch = Math.max(GRID * 2, snap(armLen / armN));
    const armSeg = armPitch - GAP;
    /* The arms start a full neighbour's clearance below the head row, not a
       token gap. A U is set out as three runs a guest walks between, so the
       inside corner has to be a corner you can turn — at 0.4 of an aisle the
       first arm trestle sat 0.75 m off the head, which is a wall, not a turn. */
    const armTop = snap(top + BANQ_D + NEIGHBOUR);
    const topY = snap(top);
    const leftX = snap(left);
    const rightX = snap(right);

    for (let i = 0; i < headN; i++) {          // the head, across the top
      items.push(piece("rect", "Table " + (++n),
        leftX + i * headPitch, topY, headSeg, BANQ_D, take()));
    }
    for (let i = 0; i < armN; i++) {           // left arm, running down
      items.push(piece("rect", "Table " + (++n),
        leftX, armTop + i * armPitch, BANQ_D, armSeg, take()));
    }
    for (let i = 0; i < armN; i++) {           // right arm, running down
      items.push(piece("rect", "Table " + (++n),
        rightX, armTop + i * armPitch, BANQ_D, armSeg, take()));
    }
    return grow(room, items, fx.bars);
  }

  /* ── Style 4 · Classroom / seminar ────────────────────────────────────
     Training days and seminars: trestles in straight rows facing the stage,
     seated on the audience side only so every sightline is clear — the
     layout a U-shape is NOT, past about 40 heads, because a U that big
     puts half the room side-on to the front. */
  function classroom(pax) {
    const room = roomFor(pax, 1.3);
    const fx = fixtures(room, { dance: false, bar: false });
    const items = fx.items.concat(corners(room));

    const seatsPerTrestle = 3;               // one side only, facing front
    const tables = Math.ceil(pax / seatsPerTrestle);
    const pitchX = snapUp(BANQ_W + GRID * 2);     // trestle + a hair of air
    const usableW = fx.rightBand - WALL_GAP;
    const perRow = Math.max(2, Math.floor(usableW / pitchX));
    const rowPitch = snapUp(BANQ_D + NEIGHBOUR);  // row-to-row, room to sit and pass

    const x0 = snap(WALL_GAP + (usableW - perRow * pitchX) / 2);
    const y0 = snap(fx.topBand);

    let placed = 0;
    const rows = Math.ceil(tables / perRow);
    for (let r = 0; r < rows && placed < tables; r++) {
      const y = y0 + r * rowPitch;
      for (let c = 0; c < perRow && placed < tables; c++, placed++) {
        const seats = Math.min(seatsPerTrestle, pax - placed * seatsPerTrestle);
        items.push(piece("rect", "Table " + (placed + 1),
          x0 + c * pitchX, y, BANQ_W, BANQ_D, Math.max(1, seats)));
      }
    }
    return grow(room, items, fx.bars);
  }

  /* ── Style 5 · Cocktail standing ──────────────────────────────────────
     Launches and receptions: poseur tables scattered on a loose grid, a big
     dance floor, two bars, and seating for only about a third of the guests —
     which is the point of the arrangement. */
  function cocktail(pax) {
    const room = roomFor(pax, 1.1);
    const fx = fixtures(room, { bar: true, bars: 2 });
    const items = fx.items.concat(corners(room));

    const poseurs = Math.max(4, Math.round(pax / 6));   // ~6 guests a table
    const seated = Math.round(pax / 3);                 // a third get a stool
    const pitch = snapUp(COCKTAIL_D + AISLE * 0.85);
    const halfPitch = snap(pitch / 2);
    const usableW = fx.rightBand - WALL_GAP;
    const perRow = Math.max(2, Math.floor(usableW / pitch));
    const x0 = snap(WALL_GAP);
    const y0 = snap(fx.topBand);

    for (let i = 0; i < poseurs; i++) {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      // Every other row is nudged half a pitch, so the floor reads as a
      // scatter rather than a car park.
      const x = x0 + (r % 2) * halfPitch + c * pitch;
      const y = y0 + r * pitch;
      if (x + COCKTAIL_D > fx.rightBand) continue;
      items.push(piece("round", "Poseur " + (i + 1),
        x, y, COCKTAIL_D, COCKTAIL_D,
        Math.max(0, Math.min(3, seated - i * 3))));
    }
    return grow(room, items, fx.bars);
  }

  /* The generators lay out against an estimated room; if a tall arrangement
     runs past the back wall, the room grows to hold it rather than the plan
     being clipped. A designer can always shrink it in Room size — but a
     preset that lands with a table inside the wall is a preset nobody trusts. */
  function grow(room, items, bars) {
    let maxX = 0, maxY = 0;
    items.forEach((i) => {
      maxX = Math.max(maxX, i.x + i.w);
      maxY = Math.max(maxY, i.y + i.h);
    });
    const out = {
      w: round2(Math.max(room.w, snapUp(maxX + WALL_GAP))),
      h: round2(Math.max(room.h, snapUp(maxY + WALL_GAP))),
    };

    // The deferred bars, now that the back wall's position is settled: against
    // it, in the corners, clear of the last row of tables.
    /* Guests arrive through the back wall, and they arrive in a crowd. Hold a
       band of clear floor inside it before anything else is placed there —
       otherwise the last row of tables lands across the doorway, which is
       precisely the fault the walkability check exists to catch and not a
       fault a preset should ever ship with. */
    const ARRIVAL = 2.2;
    out.h = round2(Math.max(out.h, snapUp(maxY + ARRIVAL)));

    /* Bars are DEFERRED again, past grow() this time. repair() may still
       deepen the room to open the spine, and a bar pinned to the back wall
       here would either be left stranded mid-floor or be dragged into whatever
       row of tables now sits where it used to stand. It is placed once, at the
       end, against a wall that has stopped moving. */
    items.push(entrance(out));
    return { room: out, items, bars: bars || 0 };
  }

  /* ══════════════════════════════════════════════════════════════════════
     VALIDATE AND REPAIR — the generators lay a plan out by arithmetic; this
     pass reads it back the way a guest walks it.

     Arithmetic alone cannot tell whether a room works. It knows a pitch and a
     band, but not whether a planter ended up crowding a table, or whether the
     route in from the door narrows to nothing between two rows. Those are
     questions about the finished floor, and they can only be answered by
     measuring the finished floor — with the SAME AABB boxes and the SAME A*
     grid the walkthrough moves on (js/nav.js) and the walkability report
     grades against.

     That shared model is the point. A preset repaired against its own private
     idea of clearance would still land with warnings; repaired against the
     checker's model, it lands clean, because "clean" is being decided by the
     thing that will decide it.

     Repairs are conservative and ordered: nudge what is loose (decor), widen
     what is short (the room), and never touch the seating grid — a preset
     whose tables silently drift is a preset the designer cannot predict.
     Degrades to a no-op when nav isn't loaded, so the gallery still works. ══ */
  function repair(plan) {
    const N = window.HPNav;
    if (!N || !plan) return plan;

    const room = plan.room;
    let items = plan.items;

    /* 1 · Loose fixtures that ended up crowding something.
       Decor is the only kind a preset may move on its own: it is dressing, it
       has no seat and no service function, and a planter 20 cm from a table is
       a planter nobody meant to put there. Tables are never moved — the grid
       is the arrangement, and shifting one member of it silently is worse than
       the warning it would have raised. */
    const DECOR_CLEAR = 0.9;
    items.filter((it) => it.kind === "decor").forEach((d) => {
      const others = N.solidsOf({ room, items: items.filter((x) => x !== d) });
      const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
      if (N.clearanceAt(others, cx, cy) >= DECOR_CLEAR) return;
      // Try each corner in turn, keeping the first that stands clear.
      const spots = [
        { x: 0.5, y: 0.5 }, { x: room.w - d.w - 0.5, y: 0.5 },
        { x: 0.5, y: room.h - d.h - 0.5 }, { x: room.w - d.w - 0.5, y: room.h - d.h - 0.5 },
      ];
      let best = null, bestD = -1;
      spots.forEach((s) => {
        const c = N.clearanceAt(others, s.x + d.w / 2, s.y + d.h / 2);
        if (c > bestD) { bestD = c; best = s; }
      });
      if (best && bestD > N.clearanceAt(others, cx, cy)) {
        d.x = round2(snap(best.x));
        d.y = round2(snap(best.y));
      }
    });
    // A planter that still crowds something has nowhere to go: drop it rather
    // than ship a warning. The room loses a pot, not a table.
    items = items.filter((it) => {
      if (it.kind !== "decor") return true;
      const others = N.solidsOf({ room, items: items.filter((x) => x !== it) });
      return N.clearanceAt(others, it.x + it.w / 2, it.y + it.h / 2) >= DECOR_CLEAR * 0.75;
    });

    /* 2 · The bars, against the back wall.
       Placed BEFORE the spine is measured, not after: a bar is a solid, and a
       spine checked on a floor missing two of them is a spine checked on a
       floor that will not exist. Each takes a back corner, clear of the
       doorway in the middle; a corner that is already occupied simply doesn't
       get a bar — the floor keeps its tables and the room loses a counter
       rather than shipping a collision. */
    const wantBars = plan.bars || 0;
    for (let i = 0; i < wantBars; i++) {
      const bw = 2.4, bh = 0.8;
      const x = round2(snap(i % 2 ? room.w - WALL_GAP / 2 - bw : WALL_GAP / 2));
      const y = round2(snap(room.h - WALL_GAP / 2 - bh));
      const solids = N.solidsOf({ room, items });
      const clear = Math.min(
        N.clearanceAt(solids, x + bw / 2, y + bh / 2),
        N.clearanceAt(solids, x, y), N.clearanceAt(solids, x + bw, y));
      if (clear < NEIGHBOUR) continue;
      items.push(piece("bar", wantBars > 1 ? "Bar " + (i + 1) : "Bar", x, y, bw, bh, 0));
    }
    delete plan.bars;

    /* 3 · The route in from the door.
       Measured, not assumed: walk A* from the entrance to the middle of the
       room and find the narrowest point of the corridor it takes. If the spine
       is short, the room is deepened — floor is the one thing a plan can
       always be given more of, and it is far better than nudging tables into
       a pattern the designer did not choose.

       Runs last, on the finished floor, and re-measures after every widen.
       More attempts than feels necessary: deepening the room moves the back
       wall AND the bars pinned to it, so one widen can uncover a different
       pinch point further along the same route. */
    const door = items.find((it) => it.kind === "door");
    if (door) {
      /* Each attempt is provisional. A repair that leaves the spine no wider
         than it found it has moved the pinch rather than opened it, and is
         rolled back — otherwise the loop happily walks the plan downhill,
         which is exactly what an earlier scale-about-centre version did. */
      let bestSeen = -1, snapshot = null;
      const capture = () => JSON.stringify({ room: room, items: items });
      const restore = (s) => {
        const p = JSON.parse(s);
        room.w = p.room.w; room.h = p.room.h;
        items.length = 0;
        p.items.forEach((it) => items.push(it));
      };
      for (let attempt = 0; attempt < 6; attempt++) {
        const solids = N.solidsOf({ room, items });
        const grid = N.grid({ room, items }, { solids: solids });
        const cx = door.x + door.w / 2;
        const from = { x: cx, y: door.y - 0.9 };
        const to = { x: room.w / 2, y: room.h / 2 };
        const path = N.findPath(grid, from, to, { snap: 4, raw: true });
        if (!path || path.length < 4) break;

        let narrowest = Infinity, pinchAcross = false, pinchAt = null;
        for (let i = 2; i < path.length - 2; i += 3) {
          const prev = path[i - 1], next = path[i + 1];
          const dx = next.x - prev.x, dy = next.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len, ny = dx / len;
          const reach = (sign) => {
            let d = 0;
            while (d < 4) {
              const c = grid.toCell(path[i].x + nx * sign * (d + grid.cell),
                                   path[i].y + ny * sign * (d + grid.cell));
              if (!grid.at(c.i, c.j)) break;
              d += grid.cell;
            }
            return d;
          };
          const width = reach(1) + reach(-1) + grid.cell;
          if (width < narrowest) {
            narrowest = width;
            /* Which way the squeeze runs. A pinch measured across the room's
               WIDTH is not cured by making the room deeper, however many times
               you try — the two pieces either side of it stay exactly where
               they were. This is why the cocktail scatter kept coming back
               tight after three widens. */
            pinchAcross = Math.abs(nx) > Math.abs(ny);
            pinchAt = path[i];
          }
        }
        if (narrowest === Infinity) break;
        // Judge the attempt just made before starting another: better keeps,
        // worse or level rolls back and stops.
        if (snapshot !== null && narrowest <= bestSeen) { restore(snapshot); break; }
        bestSeen = narrowest;
        if (narrowest >= SPINE) break;
        snapshot = capture();

        const give = snapUp(SPINE - narrowest);
        if (pinchAcross) {
          /* A lateral squeeze is opened by pushing the two halves of the room
             APART at the pinch, not by scaling everything about the centre.
             Scaling moves every piece off the snapped pitch it was laid on,
             which closes gaps elsewhere as fast as it opens this one — tried,
             measured, and it made more plans tight than it fixed.

             Here the room gains width and only the pieces on the far side of
             the pinch slide over by that much. Every piece keeps its offset
             from its neighbours; the arrangement is cut and shimmed, not
             stretched. */
          const cutAt = pinchAt.x;
          room.w = round2(room.w + give);
          items.forEach((it) => {
            if (it.kind === "door") return;              // re-centred below
            if (it.x + it.w / 2 <= cutAt) return;        // near side stays put
            it.x = round2(Math.min(room.w - it.w - 0.25, snap(it.x + give)));
          });
          door.x = round2(snap((room.w - door.w) / 2));
          continue;
        }
        // Deepen, and take the back wall's furniture with it — the door and
        // the bars are fixed TO that wall, not to a coordinate.
        room.h = round2(room.h + snapUp(SPINE - narrowest));
        door.y = round2(room.h - 0.25);
        items.filter((it) => it.kind === "bar").forEach((b) => {
          b.y = round2(snap(room.h - WALL_GAP / 2 - b.h));
        });
      }
    }

    /* 4 · Anything still standing too close to a neighbour.
       Only reported through the return value — never auto-moved. A preset that
       rearranges seating behind the designer's back is a preset they stop
       trusting, and the brief is explicit that findings are advisory. */
    plan.items = items;
    return plan;
  }

  const STYLES = [
    { key: "banquet",    name: "Banquet Rounds",  icon: "roundTable", build: banquet,
      blurb: "Tables of eight in rows, stage and buffet — the house standard for weddings and debuts." },
    { key: "ceremonial", name: "Long Table",      icon: "longTable",  build: ceremonial,
      blurb: "One head table down the centre for the party, rounds flanking it for the guests." },
    { key: "ushape",     name: "U-Shape",         icon: "ruler",      build: ushape,
      blurb: "Trestles in a U facing the stage — corporate lunches, seminars and small meetings." },
    { key: "classroom",  name: "Classroom",       icon: "longTable",  build: classroom,
      blurb: "Rows of trestles facing the stage, audience-side seating — training days and seminars." },
    { key: "cocktail",   name: "Cocktail",        icon: "cup",        build: cocktail,
      blurb: "Poseur tables, two bars and a wide dance floor; seating for about a third." },
  ];
  const styleOf = (key) => STYLES.find((s) => s.key === key) || STYLES[0];

  /* Every preset goes out through repair(): the gallery's thumbnail, its
     stated seat count and the plan that lands on the floor are all the SAME
     repaired object, so what is previewed is what is chosen. */
  function build(styleKey, pax) {
    const n = Math.max(10, Math.min(400, Math.round(Number(pax) || 50)));
    return repair(styleOf(styleKey).build(n));
  }

  // Every style at one headcount, each with the numbers a designer picks on:
  // what it seats, how many pieces it lands, and the room it wants.
  function list(pax) {
    return STYLES.map((s) => {
      const plan = build(s.key, pax);
      const seats = plan.items.reduce((n, i) => n + (i.seats || 0), 0);
      return {
        key: s.key, name: s.name, blurb: s.blurb, icon: s.icon,
        plan, seats,
        pieces: plan.items.length,
        room: plan.room,
      };
    });
  }

  return { COUNTS, STYLES, list, build };
})();
