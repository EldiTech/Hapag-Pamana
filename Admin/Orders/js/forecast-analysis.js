/* HapagPamana · Forecast — historical analysis (Master promp.md §3, Task A).
   Pure functions over the cleaned/aggregated series from forecast-data.js —
   no DOM, no Firestore. forecast.js calls these and hands the results to
   the chart renderers.

   Exposed on window.HPForecast.analysis:
     rollingAverage(series, window)
     decompose(series)            → { trend, seasonal, residual, period }
     phSeasonality(rows)          → per-season order counts + share of total
     segmentBreakdown(series)     → volume by bookingType
     leadTimeAndCancellation(rows) → average lead time + cancellation rate */
(function () {
  "use strict";
  window.HPForecast = window.HPForecast || {};

  /* Centered rolling mean over `series[i].count`; the first/last (window-1)/2
     points fall back to the widest centered window that fits, so the overlay
     still reaches the chart's edges instead of stopping short. */
  function rollingAverage(series, windowSize = 3) {
    const half = Math.floor(windowSize / 2);
    return series.map((_, i) => {
      const lo = Math.max(0, i - half), hi = Math.min(series.length - 1, i + half);
      let sum = 0;
      for (let j = lo; j <= hi; j++) sum += series[j].count;
      return sum / (hi - lo + 1);
    });
  }

  /* Classical additive decomposition (trend + seasonal + residual), the
     textbook algorithm behind statsmodels' seasonal_decompose — same method,
     ported to plain JS since there is no Python runtime in this stack
     (Master promp.md §0). `period` is 12 for monthly data, 52 for weekly.

     Needs at least 2 full periods to say anything about seasonality; below
     that, only a rolling-average trend is returned and `seasonal`/`residual`
     come back empty so the caller can flag the analysis as thin. */
  function decompose(series, period) {
    const n = series.length;
    if (n < period * 2) {
      return { trend: rollingAverage(series, Math.min(3, n)), seasonal: [], residual: [], period, sufficient: false };
    }
    const counts = series.map((s) => s.count);

    // Centered moving average of length `period` (the trend estimate).
    const trend = new Array(n).fill(null);
    const half = period / 2;
    for (let i = 0; i < n; i++) {
      const lo = i - half, hi = i + half;
      if (lo < 0 || hi >= n) continue;
      let sum = 0;
      if (Number.isInteger(half)) {
        for (let j = lo; j <= hi; j++) sum += counts[j];
        trend[i] = sum / period;
      } else {
        // Even period: a 2xM average straddling the half-integer boundary.
        for (let j = Math.ceil(lo); j <= Math.floor(hi); j++) sum += counts[j];
        trend[i] = (sum + 0.5 * counts[Math.floor(lo)] + 0.5 * counts[Math.ceil(hi)]) / period;
      }
    }

    // Detrended = count - trend, averaged by position-in-period → one
    // seasonal figure per phase, then centered so it sums to ~0 (additive).
    const byPhase = Array.from({ length: period }, () => []);
    for (let i = 0; i < n; i++) {
      if (trend[i] == null) continue;
      byPhase[i % period].push(counts[i] - trend[i]);
    }
    const phaseAvg = byPhase.map((vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0));
    const phaseMean = phaseAvg.reduce((a, b) => a + b, 0) / period;
    const seasonalByPhase = phaseAvg.map((v) => v - phaseMean);
    const seasonal = series.map((_, i) => seasonalByPhase[i % period]);

    const residual = series.map((_, i) => (trend[i] == null ? null : counts[i] - trend[i] - seasonal[i]));

    return { trend, seasonal, residual, period, sufficient: true };
  }

  /* Philippine-context seasonality (§3.3): counts + share of demand falling
     in each named season, using HPForecast.data.seasonOf on every dated,
     non-cancelled row. A booking can belong to more than one tag (e.g.
     December is both "ber_months" and "christmas_new_year"), so shares are
     computed against total demand, not against each other. */
  function phSeasonality(rows) {
    const D = window.HPForecast.data;
    const demand = rows.filter((o) => o.eventMs && !o.cancelled);
    const total = demand.length;
    const TAGS = [
      ["ber_months", "“Ber” months (Sep–Dec)"],
      ["christmas_new_year", "Christmas / New Year peak"],
      ["wedding_season", "Wedding season (Feb–May)"],
      ["holy_week", "Holy Week / Lent"],
    ];
    const out = TAGS.map(([key, label]) => {
      const count = demand.filter((o) => D.seasonOf(o.eventMs).includes(key)).length;
      return { key, label, count, share: total ? count / total : 0 };
    });
    return { total, seasons: out, regionAvailable: false };
  }

  /* Volume + revenue split by bookingType — the only clean 2-way segment
     today (Master promp.md §2: kindOfFunction/package are free text and
     need normalization before they're a usable segment). */
  function segmentBreakdown(series) {
    const totals = { Catering: { count: 0, value: 0 }, "Food Pack": { count: 0, value: 0 } };
    series.forEach((bucket) => {
      totals.Catering.count += bucket.byType.Catering || 0;
      totals["Food Pack"].count += bucket.byType["Food Pack"] || 0;
    });
    return totals;
  }

  /* Average lead time (order_date → event_date) and the cancellation rate,
     both overall and split by the PH season the event fell in — so "do
     December bookings get cancelled more than average?" has an answer. */
  function leadTimeAndCancellation(rows) {
    const D = window.HPForecast.data;
    const withLead = rows.filter((o) => o.leadDays != null && o.leadDays >= 0);
    const avgLeadDays = withLead.length
      ? withLead.reduce((s, o) => s + o.leadDays, 0) / withLead.length
      : null;

    const dated = rows.filter((o) => o.eventMs);
    const cancelled = dated.filter((o) => o.cancelled).length;
    const cancellationRate = dated.length ? cancelled / dated.length : 0;

    const bySeasonMap = new Map();
    dated.forEach((o) => {
      const tags = D.seasonOf(o.eventMs);
      (tags.length ? tags : ["off_season"]).forEach((tag) => {
        if (!bySeasonMap.has(tag)) bySeasonMap.set(tag, { total: 0, cancelled: 0 });
        const b = bySeasonMap.get(tag);
        b.total++;
        if (o.cancelled) b.cancelled++;
      });
    });
    const bySeason = [...bySeasonMap.entries()].map(([tag, b]) => ({
      tag, total: b.total, cancelled: b.cancelled, rate: b.total ? b.cancelled / b.total : 0,
    }));

    return {
      avgLeadDays,
      sampleSize: withLead.length,
      cancellationRate,
      cancelledCount: cancelled,
      totalDatedCount: dated.length,
      bySeason,
    };
  }

  window.HPForecast.analysis = {
    rollingAverage,
    decompose,
    phSeasonality,
    segmentBreakdown,
    leadTimeAndCancellation,
  };
})();
