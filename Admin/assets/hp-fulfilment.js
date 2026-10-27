/* HapagPamana · fulfilment — the food's journey from the kitchen to the event.

   Where procurement ends (ingredients on the shelf), this begins: a CONFIRMED
   order is cooked, packed, released and delivered. Two desks share it —

     Team Leader   drives Preparing → Ready, then REQUESTS release
     Logistics     approves the request (Released) and confirms Delivered

   Both look at the same rail, the same order, the same history. The stage is
   stored on the booking itself:

     bookings/{id}.fulfilment = {
       stage, note,
       requestedAt, requestedByName, requestNote,       // TL asks
       rejectedAt, rejectedByName, rejectReason,        // Logistics declines
       history: [{ stage, at, byName, note }],
       updatedAt, updatedByName,
     }

   THE REQUEST IS THE POINT. "Ready" is the team leader's word that the food
   is finished; "Released" is logistics' word that it has left. Between them
   sits an explicit ask, so nobody has to phone anyone and the record shows
   who asked, when, and what logistics said back. A rejection carries a reason
   and returns the order to the kitchen's side rather than silently stalling.

   Loads after hp-core.js. Exposed on window.HPFul. Roles gate the buttons —
   see firestore.rules for the writes themselves. */
window.HPFul = (function () {
  "use strict";
  const HP = window.HP;

  /* ── The rail ────────────────────────────────────────────────────────────
     Four stages, in order. `owner` is the desk whose turn it is; `next` is
     what pressing that desk's primary button does. */
  const STAGES = {
    preparing: {
      label: "Preparing",
      hint: "The kitchen is cooking this order.",
      owner: "team_leader",
      icon: "dish",
      next: "ready",
    },
    ready: {
      label: "Ready",
      hint: "Cooked and packed — waiting on logistics to release it.",
      owner: "team_leader",
      icon: "check",
      next: "released",
    },
    released: {
      label: "Released",
      hint: "Logistics has released the food; it is on its way.",
      owner: "logistics",
      icon: "truck",
      next: "delivered",
    },
    delivered: {
      label: "Delivered",
      hint: "Handed over at the venue.",
      owner: "logistics",
      icon: "pin",
      next: null,
    },
  };
  const FLOW = ["preparing", "ready", "released", "delivered"];

  const stage = (k) => STAGES[k] || STAGES.preparing;
  const labelOf = (k) => stage(k).label;
  const indexOf = (k) => Math.max(0, FLOW.indexOf(k));
  const nextOf = (k) => stage(k).next;
  const isAfter = (a, b) => indexOf(a) > indexOf(b);

  /* Which stages a role may move an order THROUGH. Deliberately disjoint:
     the team leader cannot release their own food, and logistics cannot
     declare it cooked. That split is the whole reason the request exists. */
  const DRIVES = {
    team_leader: ["preparing", "ready"],
    logistics: ["released", "delivered"],
  };
  function canDrive(role, stageKey) {
    if (role === "admin") return true;
    return (DRIVES[role] || []).indexOf(stageKey) !== -1;
  }

  /* ── The request ─────────────────────────────────────────────────────────
     An order is "awaiting release" when the TL has asked and logistics has
     neither released nor rejected since. A rejection clears the request, so
     the ball is visibly back with the kitchen. */
  const ful = (o) => (o && o.fulfilment) || {};
  const stageOf = (o) => ful(o).stage || "preparing";
  function isRequested(o) {
    const f = ful(o);
    if (!f.requestedAt) return false;
    if (indexOf(f.stage || "preparing") >= indexOf("released")) return false;
    return !(f.rejectedAt && ts(f.rejectedAt) > ts(f.requestedAt));
  }
  const isRejected = (o) => {
    const f = ful(o);
    return !!(f.rejectedAt && (!f.requestedAt || ts(f.rejectedAt) >= ts(f.requestedAt)))
      && indexOf(f.stage || "preparing") < indexOf("released");
  };

  const ts = (v) => {
    if (v && typeof v.toMillis === "function") return v.toMillis();
    return Number(v) || 0;
  };
  function fmtWhen(v) {
    const ms = ts(v);
    if (!ms) return "—";
    return new Date(ms).toLocaleString("en-PH", {
      year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  }

  /* One history entry, stamped the same way by both desks. */
  function entry(stageKey, note) {
    return {
      stage: stageKey,
      at: Date.now(),                       // client clock: history is an array,
      byName: (HP.user && HP.user.name) || "—",   // so serverTimestamp is not allowed
      byUid: (HP.FB && HP.FB.auth.currentUser) ? HP.FB.auth.currentUser.uid : null,
      note: String(note || "").trim(),
    };
  }

  /* Every movement on an order, oldest first — the one list both the rail and
     the cards below it are built from. The rail needs the COUNT so it knows
     how many of its circles have a note to point at; the cards need the rows
     themselves. Derived in one place so the two can never disagree about how
     many movements there are. */
  function movements(o) {
    const f = ful(o);
    const rows = Array.isArray(f.history) ? f.history.slice() : [];
    if (f.requestedAt) {
      rows.push({ stage: "ready", at: ts(f.requestedAt), byName: f.requestedByName,
        note: f.requestNote, kind: "request" });
    }
    if (f.rejectedAt) {
      rows.push({ stage: "ready", at: ts(f.rejectedAt), byName: f.rejectedByName,
        note: f.rejectReason, kind: "reject" });
    }
    rows.sort((a, b) => ts(a.at) - ts(b.at));
    return rows;
  }

  /* ── The rail, rendered ──────────────────────────────────────────────────
     The horizontal step diagram both dashboards show: every stage left to
     right, the reached ones lit, the current one ringed, the rest greyed.
     `state` per node is what the CSS colours on.

     Each circle also drops a short stem toward the card beneath it (see
     hp-workflow.css). Only circles that actually have a card get one, so the
     rail never points at empty space — hence `has-notes` and `is-unnoted`. */
  function railHTML(o) {
    const cur = stageOf(o);
    const at = indexOf(cur);
    const rejected = isRejected(o);
    const noteCount = movements(o).length;
    const railClass = noteCount ? "wf-rail has-notes" : "wf-rail";
    return `<ol class="${railClass}" style="--wf-steps:${FLOW.length}">${FLOW.map((k, i) => {
      const s = STAGES[k];
      // A rejected order shows its current node as refused rather than done,
      // so the rail itself carries the bad news.
      const state = rejected && i === at ? "bad"
        : i < at ? "done"
        : i === at ? "now"
        : "todo";
      // Cards are laid out one per column in order, so column i has a card
      // only while i is inside the movement count.
      const unnoted = i >= noteCount ? " is-unnoted" : "";
      return `<li class="wf-node is-${state}${unnoted}">
        <span class="wf-dot"><span class="ic">${HP.icon(s.icon)}</span></span>
        <span class="wf-label">${HP.esc(s.label)}</span>
      </li>`;
    }).join("")}</ol>`;
  }

  /* The cards under the rail — one per movement, oldest first, laid out on the
     rail's own columns: the first movement under the first circle, the second
     under the second, and so on. One card per column, never stacked, all the
     same height, so the row reads as an even ladder beneath the rail.

     The cards are a CHRONOLOGY, not a per-stage grouping. A run records about
     one movement per stage but not exactly one — a release can be requested,
     refused and requested again — so pinning each card to its own stage left
     some columns empty and stacked others, and the row stopped reading evenly.
     Sequential placement keeps the pitch regular; each card still names the
     stage it belongs to in its own title, which is where that detail lives. */
  function historyHTML(o) {
    const rows = movements(o);
    if (!rows.length) return `<p class="wf-empty">Nothing recorded yet.</p>`;

    const card = (r) => {
      const kind = r.kind === "reject" ? "bad" : r.kind === "request" ? "ask" : "ok";
      const title = r.kind === "reject" ? "Release refused"
        : r.kind === "request" ? "Release requested"
        : labelOf(r.stage);
      return `<article class="wf-card is-${kind}">
        <h5>${HP.esc(title)}</h5>
        ${r.note ? `<p>${HP.esc(r.note)}</p>` : ""}
        <footer>${HP.esc(r.byName || "—")} · ${HP.esc(fmtWhen(r.at))}</footer>
      </article>`;
    };

    /* One card per column, in order, on the rail's own tracks: the first
       movement under the first circle, the second under the second. More
       movements than stages (a refused release adds one) wrap onto a second
       row of the same columns, so the ladder never breaks its pitch. */
    return `<div class="wf-cards" style="--wf-steps:${FLOW.length}">${
      rows.map(card).join("")}</div>`;
  }

  return {
    STAGES, FLOW, DRIVES,
    stage, labelOf, indexOf, nextOf, isAfter, canDrive,
    ful, stageOf, isRequested, isRejected,
    ts, fmtWhen, entry,
    railHTML, historyHTML,
  };
})();
