/* HapagPamana · Forecast — data loading & cleaning.
   Pulls every booking once (not the live-streamed window orders.js uses —
   forecasting wants the FULL history, not the newest 200), validates the
   fields the analysis/model modules need, and exposes a clean array plus a
   monthly/weekly aggregator. No Firestore writes happen here.

   Exposed on window.HPForecast.data:
     loadBookings()              → Promise<CleanBooking[]>, fetched once and cached
     aggregate(rows, granularity) → { keys, series, byType: { Catering, "Food Pack" } }
     PH_SEASONS, seasonOf(date)  → Philippine demand-season lookup (Task A.3)

   A CleanBooking is the raw Firestore doc plus:
     eventMs     parsed functionDate in ms, or 0 if unparseable
     orderMs     createdAt in ms, or 0 if missing
     type        "Catering" | "Food Pack"
     value       paymentTotal (falls back to packageTotal+addOnsTotal), or 0
     leadDays    (eventMs - orderMs) in days, or null if either is missing
     cancelled   true for status "declined" (the cancellation-equivalent —
                 see Master promp.md §2: there is no "cancelled" status) */
(function () {
  "use strict";
  const HP = window.HP;
  window.HPForecast = window.HPForecast || {};

  /* "June 12, 2026" parses fine via Date.parse; a handful of legacy rows may
     have free-typed something Date.parse can't read, in which case eventMs
     stays 0 and the row is excluded from any date-indexed series (still
     counted in totals that don't need a date). */
  function parseEventMs(functionDate) {
    const t = Date.parse(String(functionDate || ""));
    return Number.isFinite(t) ? t : 0;
  }

  function tsMs(v) {
    return v && typeof v.toMillis === "function" ? v.toMillis() : 0;
  }

  function orderValue(o) {
    const total = Number(o.paymentTotal);
    if (Number.isFinite(total) && total > 0) return total;
    const pkg = Number(o.packageTotal) || 0;
    const addons = Number(o.addOnsTotal) || 0;
    return pkg + addons > 0 ? pkg + addons : 0;
  }

  function clean(doc) {
    const eventMs = parseEventMs(doc.functionDate);
    const orderMs = tsMs(doc.createdAt);
    return {
      ...doc,
      eventMs,
      orderMs,
      type: String(doc.bookingType || "").toLowerCase() === "food pack" ? "Food Pack" : "Catering",
      value: orderValue(doc),
      leadDays: (eventMs && orderMs) ? Math.round((eventMs - orderMs) / 864e5) : null,
      cancelled: doc.status === "declined",
    };
  }

  let cache = null;

  /* Fetches the WHOLE bookings collection once. Firestore's Spark quota is
     the reason orders.js bounds its live stream to 200 docs — a forecast
     needs full history, but only needs it once per page load (no live
     stream, no re-render on every write), so a single one-shot get() here
     doesn't carry the same cost orders.js was written to avoid. */
  async function loadBookings() {
    if (cache) return cache;
    if (!HP.ONLINE) { cache = []; return cache; }
    const db = firebase.firestore();
    const snap = await db.collection("bookings").get();
    const rows = [];
    snap.forEach((d) => {
      const data = d.data();
      // Excluded entirely, per Master promp.md §2 — a soft-deleted doc is not
      // demand, regardless of what status it was left in.
      if (data.deleted) return;
      rows.push(clean({ id: d.id, ...data }));
    });
    cache = rows;
    return cache;
  }

  /* ── Time-bucket keys ─────────────────────────────────────────────────
     "monthly" keys are "YYYY-MM"; "weekly" keys are "YYYY-Www" (ISO week).
     Both sort correctly as plain strings. */
  function monthKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function isoWeekKey(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    // ISO week: Thursday of this week decides the week-numbering year.
    const day = (d.getDay() + 6) % 7; // Mon=0..Sun=6
    d.setDate(d.getDate() - day + 3);
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    const fdDay = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - fdDay + 3);
    const week = 1 + Math.round((d - firstThursday) / (7 * 864e5));
    return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }
  const keyOf = (ms, granularity) => (granularity === "weekly" ? isoWeekKey(ms) : monthKey(ms));

  // Every key between the first and last dated row, so a month/week with zero
  // bookings still appears as 0 rather than a gap the chart would skip over.
  function fillKeyRange(sortedKeys, granularity) {
    if (!sortedKeys.length) return [];
    if (granularity === "weekly") {
      // Walking week-by-week in calendar time (not key math) keeps ISO
      // year-boundary weeks correct.
      const out = [];
      const [y0, w0] = sortedKeys[0].split("-W").map(Number);
      const [y1, w1] = sortedKeys[sortedKeys.length - 1].split("-W").map(Number);
      let cur = new Date(y0, 0, 1 + (w0 - 1) * 7);
      const end = new Date(y1, 0, 1 + (w1 - 1) * 7);
      let guard = 0;
      while (cur <= end && guard++ < 2000) {
        out.push(isoWeekKey(cur.getTime()));
        cur = new Date(cur.getTime() + 7 * 864e5);
      }
      return [...new Set(out)];
    }
    const out = [];
    const [y0, m0] = sortedKeys[0].split("-").map(Number);
    const [y1, m1] = sortedKeys[sortedKeys.length - 1].split("-").map(Number);
    let y = y0, m = m0;
    let guard = 0;
    while ((y < y1 || (y === y1 && m <= m1)) && guard++ < 2000) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }

  /* Aggregates cleaned bookings into a demand time series. Only rows with a
     parseable eventMs and a non-cancelled status count as demand — a
     declined order was never actually served, so it isn't a "period had N
     orders" fact (Master promp.md §2: declined = cancellation-equivalent,
     excluded from demand counts). Cancelled rows are still returned
     separately for the cancellation-rate metric in forecast-analysis.js. */
  function aggregate(rows, granularity = "monthly") {
    const dated = rows.filter((o) => o.eventMs);
    const demand = dated.filter((o) => !o.cancelled);

    const byKey = new Map();     // key -> { count, value, byType }
    const cancelledByKey = new Map();

    demand.forEach((o) => {
      const k = keyOf(o.eventMs, granularity);
      if (!byKey.has(k)) byKey.set(k, { count: 0, value: 0, byType: { Catering: 0, "Food Pack": 0 } });
      const bucket = byKey.get(k);
      bucket.count++;
      bucket.value += o.value;
      bucket.byType[o.type]++;
    });
    dated.filter((o) => o.cancelled).forEach((o) => {
      const k = keyOf(o.eventMs, granularity);
      cancelledByKey.set(k, (cancelledByKey.get(k) || 0) + 1);
    });

    const keys = fillKeyRange([...byKey.keys()].sort(), granularity);
    const series = keys.map((k) => ({
      key: k,
      count: byKey.get(k)?.count || 0,
      value: byKey.get(k)?.value || 0,
      cancelled: cancelledByKey.get(k) || 0,
      byType: byKey.get(k)?.byType || { Catering: 0, "Food Pack": 0 },
    }));

    return { keys, series, granularity };
  }

  /* ── Philippine-context seasonality (Master promp.md §3.3) ────────────
     Static calendar reasoning — no `region` field exists on bookings, so
     this is date-only. Holy Week is movable; computed via the Anonymous
     Gregorian / Meeus algorithm for Easter Sunday, then walked back to
     Palm Sunday through Easter Sunday. */
  function easterSundayUTC(year) {
    const a = year % 19, b = Math.floor(year / 100), c = year % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(year, month - 1, day);
  }

  function seasonOf(ms) {
    const d = new Date(ms);
    const month = d.getMonth() + 1; // 1-12
    const tags = [];
    if (month >= 9 && month <= 12) tags.push("ber_months");
    if (month === 12 || month === 1) tags.push("christmas_new_year");
    if (month >= 2 && month <= 5) tags.push("wedding_season");
    const easter = easterSundayUTC(d.getFullYear());
    const holyWeekStart = easter - 6 * 864e5; // Palm Sunday
    if (ms >= holyWeekStart && ms <= easter) tags.push("holy_week");
    return tags;
  }

  window.HPForecast.data = {
    loadBookings,
    aggregate,
    monthKey,
    isoWeekKey,
    seasonOf,
    easterSundayUTC,
  };
})();
