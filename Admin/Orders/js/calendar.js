/* HapagPamana · Booking Calendar — the Order Manager's second page.
   One month at a time, every pending/confirmed booking marked on its event
   day. We only run 1–3 functions a day, so the real question isn't "how many
   bookings land on the 14th" but "do any two of them actually want the venue
   crew at the same hour" — a day is flagged only when two orders' booked
   spans (ingress → egress, the same window the booking sheet's timeline
   shows) genuinely overlap. A 7am function and a 6pm function on the same
   day never touch, so they never flag.

   Streams the same `bookings` collection Orders does, independently — this
   is a separate page/tab, not a view inside orders.js. Opening a day's list
   links into the Orders page (?order=<id>) rather than duplicating the full
   booking sheet here. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Booking Calendar",
    sub: "Every pending and confirmed function, by day — flagged where two bookings' times overlap.",
    search: false,
    action: null,
  });

  const calHeadEl = document.getElementById("calHead");
  const calDaysEl = document.getElementById("calDays");
  const calFiltersEl = document.getElementById("calFilters");
  const calHintEl = document.getElementById("calHint");
  const calStatsEl = document.getElementById("calStats");
  calHintEl.innerHTML = `<span class="ic">${HP.icon("calendar")}</span>Click a day to see its full list, or an event to open its booking.`;

  // Sizes the week grid to whatever room is actually left in the viewport,
  // so the whole month is visible without scrolling. A vh-based guess (and
  // then an innerHeight-minus-offsets guess) both drifted because neither
  // accounted for every bit of chrome below the grid (.cal-foot's margin,
  // the panel's own padding, .view's bottom padding) — so instead of
  // predicting the gap, this measures it directly: how far the page's real
  // bottom (.cal-foot's own bottom edge) sits past the viewport, and shrinks
  // the grid by exactly that overflow. Two passes because the first shrink
  // changes the layout (foot moves up), so an initial guess can under- or
  // over-correct by a few px; the second pass zeroes that out.
  function sizeGrid() {
    const pass = () => {
      const foot = document.querySelector(".cal-foot");
      if (!foot) return 0;
      const overflow = foot.getBoundingClientRect().bottom - window.innerHeight;
      if (Math.abs(overflow) < 1) return 0;
      const current = calDaysEl.getBoundingClientRect().height;
      calDaysEl.style.setProperty("--cal-rows-h", `${Math.max(current - overflow - 8, 300)}px`);
      return overflow;
    };
    pass();
    requestAnimationFrame(pass);
  }
  window.addEventListener("resize", sizeGrid);

  const db = HP.ONLINE ? firebase.firestore() : null;

  let orders = [];
  let loaded = false;
  let unsub = null;
  let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  // All / Pending / Confirmed / Conflicts — which events a cell shows.
  // "Conflicts" narrows to only the days with a time clash, not just the
  // clashing bookings within an otherwise-normal day.
  let calFilter = "all";

  HP.shell.onExport(exportCSV);
  HP.ready.then(boot);

  // Exports the month currently on screen — the same bookings the grid shows.
  function exportCSV() {
    const byDay = bookingsByDay();
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const list = [...byDay.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .flatMap(([, dayOrders]) => dayOrders);
    if (!list.length) {
      HP.toast("No bookings this month to export.", "warn");
      return;
    }
    const cols = [
      ["Event date", (o) => String(o.functionDate || "")],
      ["Status", (o) => STATUS_META[statusOf(o)].label],
      ["Client", clientName],
      ["Function", summaryOf],
      ["Ingress", (o) => val(o, "ingress")],
      ["Egress", (o) => val(o, "egress")],
    ];
    const cell = HP.csvCell;
    const csv = [cols.map(([h]) => cell(h)).join(",")]
      .concat(list.map((o) => cols.map(([, f]) => cell(f(o))).join(",")))
      .join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `hapagpamana_calendar_${prefix}slice.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast(`Exported ${list.length} booking${list.length === 1 ? "" : "s"} for ${calMonthLabel(calMonth)}.`);
  }

  function boot() {
    if (!HP.ONLINE) {
      calHeadEl.innerHTML = "";
      calDaysEl.innerHTML = `<p class="modal-text">Bookings live in Firestore — connect Firebase to see the calendar.</p>`;
      return;
    }
    unsub = db.collection("bookings")
      .where("status", "in", ["pending", "confirmed"])
      .onSnapshot(
        (snap) => {
          orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => !o.deleted);
          loaded = true;
          renderCalendar();
        },
        (e) => {
          console.error("HapagPamana: couldn't load bookings for the calendar —", e);
          const denied = e && (e.code === "permission-denied" ||
            /permission|insufficient/i.test(e.message || ""));
          calDaysEl.innerHTML = "";
          calHeadEl.innerHTML = "";
          HP.toast(denied
            ? "Access denied — publish the updated Firestore rules, then reload."
            : "Couldn't reach the database. Check your connection and reload.", "danger");
        });
  }
  window.addEventListener("beforeunload", () => { if (unsub) unsub(); });

  /* ── Small helpers (mirror orders.js's own — this page runs standalone) ── */
  const val = (o, k) => String(o[k] || "").trim();
  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";
  const typeOf = (o) => (String(o.bookingType || "").toLowerCase() === "food pack" ? "Food Pack" : "Catering");
  const STATUS_META = {
    pending:   { label: "Pending",   badge: "badge-warn" },
    confirmed: { label: "Confirmed", badge: "badge-ok" },
  };
  const statusOf = (o) => (STATUS_META[o.status] ? o.status : "pending");
  function statusBadge(o) {
    const m = STATUS_META[statusOf(o)];
    return `<span class="badge ${m.badge}"><span class="dot"></span>${m.label}</span>`;
  }
  function summaryOf(o) {
    if (typeOf(o) === "Food Pack") {
      const lines = String(o.menu || "").split("\n").map((s) => s.trim()).filter(Boolean);
      if (!lines.length) return "Food pack quotation";
      return lines[0] + (lines.length > 1 ? ` +${lines.length - 1} more` : "");
    }
    return String(o.kindOfFunction || "").trim() || "Catering booking";
  }
  // The wizard writes functionDate spelled out ("June 12, 2026") — parseable
  // directly. Free-typed dates that don't parse just aren't on the calendar.
  function eventMs(o) {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : 0;
  }

  /* ── Time-clash detection ─────────────────────────────────────────────── */

  // "6:30 AM" -> 390 (minutes since midnight). Unparseable/missing -> null.
  function parseClockMinutes(s) {
    const m = String(s || "").trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (!m) return null;
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + Number(m[2]);
  }

  // A booking's occupied span on its event day, anchored on ingress the same
  // way the booking wizard measures it (egress rolls past midnight if it's
  // earlier on the clock than ingress). Orders with no set-up/pack-out times
  // on file don't get a span — nothing to compare, so they can't clash.
  function bookingSpan(o) {
    const inMin = parseClockMinutes(val(o, "ingress"));
    const outMin = parseClockMinutes(val(o, "egress"));
    if (inMin == null || outMin == null) return null;
    const end = outMin > inMin ? outMin : outMin + 24 * 60;
    return { start: inMin, end };
  }

  function spansOverlap(a, b) { return a.start < b.end && b.start < a.end; }

  // Which orders in a same-day group actually clash on time — pairwise
  // overlap of their ingress→egress spans. Orders with no times on file
  // never clash (nothing to compare), so they're left out of the result.
  function clashingIds(dayOrders) {
    const spans = dayOrders.map((o) => ({ o, span: bookingSpan(o) })).filter((x) => x.span);
    const clashing = new Set();
    for (let i = 0; i < spans.length; i++) {
      for (let j = i + 1; j < spans.length; j++) {
        if (spansOverlap(spans[i].span, spans[j].span)) {
          clashing.add(spans[i].o.id);
          clashing.add(spans[j].o.id);
        }
      }
    }
    return clashing;
  }

  // Local-date key ("2026-08-27") from the wizard's spelled-out functionDate,
  // so entries land on the calendar cell regardless of time-of-day parsing.
  function dateKeyOf(o) {
    const ms = eventMs(o);
    if (!ms) return "";
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function bookingsByDay() {
    const byDay = new Map();
    orders.forEach((o) => {
      const key = dateKeyOf(o);
      if (!key) return;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(o);
    });
    return byDay;
  }

  /* ── Rendering ─────────────────────────────────────────────────────────── */

  function calMonthLabel(d) {
    return d.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  }

  function renderCalHead() {
    calHeadEl.innerHTML = `
      <div class="cal-nav">
        <button class="icon-btn" id="calPrev" aria-label="Previous month"><span class="ic">${HP.icon("chevronLeft")}</span></button>
        <strong id="calTitle">${HP.esc(calMonthLabel(calMonth))}</strong>
        <button class="icon-btn" id="calNext" aria-label="Next month"><span class="ic">${HP.icon("chevronRight")}</span></button>
      </div>
      <button class="btn btn-ghost" id="calToday">Today</button>`;
    document.getElementById("calPrev").addEventListener("click", () => {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
      renderCalendar();
    });
    document.getElementById("calNext").addEventListener("click", () => {
      calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
      renderCalendar();
    });
    document.getElementById("calToday").addEventListener("click", () => {
      const n = new Date();
      calMonth = new Date(n.getFullYear(), n.getMonth(), 1);
      renderCalendar();
    });
  }

  // How many event chips a cell shows before folding the rest into "+N more"
  // (opens the same day popover as clicking the cell itself).
  const MAX_CHIPS_PER_DAY = 2;

  function renderFilters() {
    const alive = orders.filter((o) => !o.deleted);
    const byDay = bookingsByDay();
    const conflictDays = [...byDay.values()].filter((list) => clashingIds(list).size > 0).length;
    const opts = [
      ["all", "All", alive.length],
      ["pending", "Pending", alive.filter((o) => statusOf(o) === "pending").length],
      ["confirmed", "Confirmed", alive.filter((o) => statusOf(o) === "confirmed").length],
      ["conflicts", "Conflicts", conflictDays],
    ];
    calFiltersEl.innerHTML = opts.map(([v, label]) =>
      `<button class="chip-filter${calFilter === v ? " active" : ""}" data-filter="${v}">${label}</button>`).join("");
    calFiltersEl.querySelectorAll("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        calFilter = b.dataset.filter;
        renderFilters();
        renderCalendar();
      }));
  }

  function renderStats() {
    const alive = orders.filter((o) => !o.deleted);
    const byDay = bookingsByDay();
    const confirmed = alive.filter((o) => statusOf(o) === "confirmed").length;
    const pending = alive.filter((o) => statusOf(o) === "pending").length;
    const clashCount = [...byDay.values()].reduce((n, list) => n + (clashingIds(list).size > 0 ? 1 : 0), 0);
    const stat = (ic, num, label, tone) => `
      <div class="cal-stat${tone ? ` cal-stat--${tone}` : ""}">
        <span class="ic">${HP.icon(ic)}</span>
        <strong data-count="${num}">${num}</strong>
        <span>${label}</span>
      </div>`;
    calStatsEl.innerHTML =
      stat("check", confirmed, "Confirmed", "ok") +
      stat("clock", pending, "Pending", "warn") +
      stat("alert", clashCount, "Time Clashes", "clash");
    HP.countUp(calStatsEl);
  }

  // Whether a day's bookings should show at all under the active filter —
  // "conflicts" hides days with no clash entirely, matching the stat above.
  function dayPassesFilter(dayOrders, clashes) {
    if (calFilter === "conflicts") return clashes.size > 0;
    if (calFilter === "all") return dayOrders.length > 0;
    return dayOrders.some((o) => statusOf(o) === calFilter);
  }

  // Which of a day's bookings actually render as chips under the active
  // filter — "conflicts" still shows every booking on a clashing day (so the
  // overlap reads clearly), not just the two that clash.
  function chipOrdersFor(dayOrders) {
    if (calFilter === "all" || calFilter === "conflicts") return dayOrders;
    return dayOrders.filter((o) => statusOf(o) === calFilter);
  }

  function renderCalendar() {
    if (!loaded) return;
    renderCalHead();
    renderFilters();
    renderStats();
    const byDay = bookingsByDay();
    const year = calMonth.getFullYear(), month = calMonth.getMonth();
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push("<span class=\"cal-day cal-day--pad\"></span>");
    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayOrders = byDay.get(key) || [];
      const clashes = clashingIds(dayOrders);
      const hasClash = clashes.size > 0;
      const passes = dayPassesFilter(dayOrders, clashes);
      const shown = passes ? chipOrdersFor(dayOrders)
        .slice()
        .sort((a, b) => (parseClockMinutes(val(a, "ingress")) ?? 0) - (parseClockMinutes(val(b, "ingress")) ?? 0))
        : [];

      const cls = ["cal-day"];
      if (key === todayKey) cls.push("cal-day--today");
      if (passes && dayOrders.length) cls.push("cal-day--booked");
      if (hasClash) cls.push("cal-day--clash");

      const visible = shown.slice(0, MAX_CHIPS_PER_DAY);
      const overflow = shown.length - visible.length;

      const chips = visible.map((o) => {
        const span = bookingSpan(o);
        const clash = clashes.has(o.id);
        const status = statusOf(o);
        return `
          <span class="cal-chip cal-chip--${clash ? "clash" : status}" data-id="${HP.esc(o.id)}"
            title="${HP.esc(`${clientName(o)} · ${summaryOf(o)}${clash ? " · Time clash" : ""}`)}">
            ${span ? `<span class="cal-chip-time">${HP.esc(val(o, "ingress"))}</span>` : ""}
            <span class="cal-chip-txt">${HP.esc(summaryOf(o))}</span>
          </span>`;
      }).join("");

      cells.push(`
        <div class="${cls.join(" ")}" data-key="${key}">
          <div class="cal-day-top">
            <span class="cal-num">${day}</span>
            ${key === todayKey ? `<span class="cal-today-tag">Today</span>` : ""}
            ${hasClash ? `<span class="cal-clash-tag"><span class="ic">${HP.icon("alert")}</span>Clash</span>` : ""}
          </div>
          ${passes && dayOrders.length ? `<span class="cal-count">${dayOrders.length} booking${dayOrders.length === 1 ? "" : "s"}</span>` : ""}
          <div class="cal-chips">
            ${chips}
            ${overflow > 0 ? `<button class="cal-chip cal-chip--more" data-more="${key}">+${overflow} more</button>` : ""}
          </div>
        </div>`);
    }
    calDaysEl.innerHTML = cells.join("");
    calDaysEl.querySelectorAll("[data-key]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-id]")) return; // handled below
        const dayOrders = byDay.get(el.dataset.key) || [];
        if (dayOrders.length) dayPopover(el.dataset.key, dayOrders);
      }));
    calDaysEl.querySelectorAll("[data-id]").forEach((el) =>
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        location.href = `index.html?order=${encodeURIComponent(el.dataset.id)}`;
      }));
    sizeGrid();
  }

  // A same-day booking list. Each row jumps to the full booking sheet on the
  // Orders page (?order=<id>) rather than duplicating that sheet here.
  function dayPopover(key, dayOrders) {
    const clashes = clashingIds(dayOrders);
    const dateLabel = new Date(key + "T00:00:00").toLocaleDateString("en-PH",
      { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const rows = dayOrders
      .slice()
      .sort((a, b) => (parseClockMinutes(val(a, "ingress")) ?? 0) - (parseClockMinutes(val(b, "ingress")) ?? 0))
      .map((o) => {
        const span = bookingSpan(o);
        const clash = clashes.has(o.id);
        return `<a class="cal-pop-row${clash ? " cal-pop-row--clash" : ""}" href="index.html?order=${encodeURIComponent(o.id)}">
          <div class="cal-pop-time">${span ? HP.esc(`${val(o, "ingress")} – ${val(o, "egress")}`) : "No time on file"}</div>
          <div class="cal-pop-txt">
            <strong>${HP.esc(clientName(o))}</strong>
            <small>${HP.esc(summaryOf(o))}${clash ? " · Time clash" : ""}</small>
          </div>
          ${statusBadge(o)}
        </a>`;
      }).join("");
    HP.openModal(dateLabel, `
      ${clashes.size ? `<p class="modal-text"><strong>${clashes.size} booking${clashes.size === 1 ? "" : "s"} overlap on the venue crew's time this day.</strong> Check ingress/egress before confirming another.</p>` : ""}
      <div class="cal-pop-list">${rows}</div>`,
      `<button class="btn btn-ghost" data-close>Close</button>`);
  }
})();
