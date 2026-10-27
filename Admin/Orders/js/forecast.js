/* HapagPamana · Forecast — the Demand Forecasting page controller.
   Loads the full booking history once (forecast-data.js), runs the
   historical analysis (forecast-analysis.js) and the forecast model
   (forecast-model.js), and paints the results. No live Firestore stream —
   forecasting off a snapshot that's a few minutes stale is fine, and a
   one-shot load keeps this page from re-running the model on every write
   the way orders.js re-renders its table. */
(function () {
  "use strict";
  const HP = window.HP;
  const D = window.HPForecast.data;
  const A = window.HPForecast.analysis;
  const M = window.HPForecast.model;

  HP.shell.init();
  HP.shell.setPage({
    title: "Demand Forecast",
    sub: "Historical patterns and a seasonal forecast, built from every booking on file.",
    search: false,
    action: null,
  });

  const statsEl = document.getElementById("fcStats");
  const controlsEl = document.getElementById("fcControls");
  const chartEl = document.getElementById("fcChart");
  const legendEl = document.getElementById("fcLegend");
  const tableEl = document.getElementById("fcTableRows");
  const tablePagerEl = document.getElementById("fcTablePager");
  const heatmapEl = document.getElementById("fcHeatmap");
  const heatPagerEl = document.getElementById("fcHeatPager");
  const seasonalityEl = document.getElementById("fcSeasonality");
  const segmentsEl = document.getElementById("fcSegments");
  const leadTimeEl = document.getElementById("fcLeadTime");
  const validationEl = document.getElementById("fcValidation");

  statsEl.innerHTML = HP.skel.stats(4);
  tableEl.innerHTML = HP.skel.rows(4, 5);

  let horizon = 6;         // 3 | 6 | 12 months
  let typeFilter = "all";  // all | Catering | Food Pack
  let allRows = [];

  const TABLE_PAGE_SIZE = 6;
  let tablePage = 1;
  let heatYear = null; // null until first renderHeatmap() picks the latest year

  HP.ready.then(boot);

  async function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      controlsEl.innerHTML = "";
      chartEl.innerHTML = "";
      tableEl.innerHTML = emptyRow("Bookings live in Firestore — connect Firebase to forecast demand.");
      tablePagerEl.innerHTML = "";
      return;
    }
    try {
      allRows = await D.loadBookings();
      renderControls();
      renderAll();
    } catch (e) {
      console.error("HapagPamana: couldn't load bookings for forecasting —", e);
      statsEl.innerHTML = "";
      tablePagerEl.innerHTML = "";
      tableEl.innerHTML = emptyRow("Couldn't reach the database. Check your connection and reload.");
    }
  }

  function filteredRows() {
    return typeFilter === "all" ? allRows : allRows.filter((o) => o.type === typeFilter);
  }

  function renderControls() {
    const horizons = [[3, "3 months"], [6, "6 months"], [12, "12 months"]];
    const types = [["all", "All types"], ["Catering", "Catering"], ["Food Pack", "Food Packs"]];
    controlsEl.innerHTML =
      horizons.map(([v, label]) =>
        `<button class="chip-filter${horizon === v ? " active" : ""}" data-horizon="${v}">${label}</button>`).join("")
      + types.map(([v, label]) =>
        `<button class="chip-filter${typeFilter === v ? " active" : ""}" data-type="${v}">${label}</button>`).join("");
    controlsEl.querySelectorAll("[data-horizon]").forEach((b) =>
      b.addEventListener("click", () => { horizon = Number(b.dataset.horizon); tablePage = 1; renderControls(); renderAll(); }));
    controlsEl.querySelectorAll("[data-type]").forEach((b) =>
      b.addEventListener("click", () => { typeFilter = b.dataset.type; tablePage = 1; renderControls(); renderAll(); }));
  }

  /* ── Orchestration ────────────────────────────────────────────────────── */
  function renderAll() {
    const rows = filteredRows();
    const agg = D.aggregate(rows, "monthly");
    const series = agg.series;

    if (series.length < 2) {
      renderEmpty();
      return;
    }

    const decomposition = A.decompose(series, 12);
    const rolling3 = A.rollingAverage(series, 3);
    const fc = M.forecast(series, horizon, 12);
    const validation = M.walkForwardValidate(series, 12);
    const seasonality = A.phSeasonality(rows);
    const segCounts = A.segmentBreakdown(series);
    const leadCancel = A.leadTimeAndCancellation(rows);

    const avgCount = series.reduce((s, b) => s + b.count, 0) / series.length;

    renderStats(series, fc, leadCancel);
    renderChart(series, rolling3, fc);
    renderTable(series, fc, avgCount, rows);
    renderHeatmap(series);
    renderSeasonality(seasonality);
    renderSegments(segCounts);
    renderLeadTime(leadCancel);
    renderValidation(validation, decomposition);
  }

  function renderEmpty() {
    statsEl.innerHTML = "";
    chartEl.innerHTML = "";
    tableEl.innerHTML = emptyRow("Not enough dated bookings yet to build a forecast — this fills in as event dates come in.");
    tablePagerEl.innerHTML = "";
    heatPagerEl.innerHTML = "";
    [heatmapEl, seasonalityEl, segmentsEl, leadTimeEl, validationEl].forEach((el) => { el.innerHTML = ""; });
  }

  function emptyRow(msg) {
    return `<tr><td colspan="5" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  /* ── Stat ledger ──────────────────────────────────────────────────────── */
  function renderStats(series, fc, leadCancel) {
    const totalDemand = series.reduce((s, b) => s + b.count, 0);
    const nextPoint = fc[0];
    const historyMonths = series.length;
    const cancelPct = Math.round((leadCancel.cancellationRate || 0) * 100);

    const stat = (ic, num, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    HP.shell.paint(statsEl,
      stat("ledger", totalDemand, "Bookings analyzed") +
      stat("calendar", historyMonths, "Months of history") +
      stat("trend", nextPoint ? nextPoint.predicted : "—", "Next month forecast") +
      stat("ban", cancelPct + "%", "Cancellation rate"));
    HP.hydrateIcons(statsEl);
  }

  /* ── SVG trend + forecast chart ──────────────────────────────────────────
     Hand-rolled inline SVG (no charting library in this stack) — a line for
     history, a dashed line + shaded band for the forecast, per §6. Viewbox
     is a fixed 960x320 and scales via CSS, matching the icon SVGs' pattern
     elsewhere in this codebase (hp-core.js's inline `<svg>` icons). */
  function renderChart(series, rolling3, fc) {
    const histCount = series.map((s) => s.count);
    const fcVals = fc.map((p) => p.predicted);

    /* Scale off history + the forecast LINE, not the CI band. An upper95 that
       blows out (thin history early in the horizon) would otherwise crush every
       actual month into the bottom of the plot — the band is allowed to clip.
       Capped at 1.6x the in-scale max so a wide band still hints at its size. */
    const Y_TICKS = 4;
    const coreMax = Math.max(...histCount, ...fcVals, 1);
    const bandMax = Math.max(coreMax, ...fc.map((p) => p.upper95));
    const maxY = niceCeil(Math.min(bandMax, coreMax * 1.25), Y_TICKS);

    const W = 960, H = 320, padL = 52, padR = 14, padT = 16, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const totalPoints = series.length + fc.length;
    const xStep = totalPoints > 1 ? plotW / (totalPoints - 1) : 0;
    const xAt = (i) => padL + i * xStep;
    // Clamped: a CI upper bound above the axis top is drawn flush to the top
    // edge rather than escaping the plot box.
    const yAt = (v) => padT + plotH - (Math.min(Math.max(v, 0), maxY) / maxY) * plotH;

    const histPath = histCount.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
    const rollingPath = rolling3.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");

    const fcStartIdx = series.length - 1; // forecast line continues from the last actual point
    const fcXs = [fcStartIdx, ...fc.map((_, i) => fcStartIdx + 1 + i)];
    const fcLineVals = [histCount[histCount.length - 1], ...fcVals];
    const fcPath = fcLineVals.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(fcXs[i]).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");

    // 95% CI band as a closed polygon: upper edge left-to-right, lower edge back.
    const bandUpper = [histCount[histCount.length - 1], ...fc.map((p) => p.upper95)];
    const bandLower = [histCount[histCount.length - 1], ...fc.map((p) => p.lower95)];
    const bandPath =
      bandUpper.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(fcXs[i]).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ") +
      " " +
      bandLower.map((v, i) => `L${xAt(fcXs[bandLower.length - 1 - i]).toFixed(1)},${yAt(bandLower[bandLower.length - 1 - i]).toFixed(1)}`).join(" ") +
      " Z";

    // Gridlines + month labels, thinned so labels never overlap on 24+ points.
    const labelEvery = Math.ceil(totalPoints / 12);
    const monthLabel = (key) => {
      const [y, m] = key.split("-");
      return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-PH", { month: "short", year: "2-digit" });
    };
    const allKeys = [...series.map((s) => s.key), ...fc.map((_, i) => "+" + (i + 1))];
    const xLabels = allKeys.map((k, i) => (i % labelEvery === 0 ? { x: xAt(i), text: i < series.length ? monthLabel(k) : "+" + (i - series.length + 1) } : null)).filter(Boolean);

    // Y ticks on round numbers, so the gridlines are actually readable values.
    const ticks = yTicks(maxY, Y_TICKS);
    const nowX = xAt(fcStartIdx);

    // Soft fill under the history line — gives the flat months visible ground
    // instead of reading as a broken axis.
    const areaPath =
      histPath + ` L${xAt(histCount.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}` +
      ` L${padL.toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

    // One marker per actual month, plus per forecast step.
    const dots = histCount.map((v, i) =>
      `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="2.6" class="fc-dot fc-dot--actual" />`).join("")
      + fcVals.map((v, i) =>
        `<circle cx="${xAt(fcStartIdx + 1 + i).toFixed(1)}" cy="${yAt(v).toFixed(1)}" r="3" class="fc-dot fc-dot--fc" />`).join("");

    // Invisible full-height hit columns drive the hover readout.
    const hit = allKeys.map((k, i) => {
      const isFc = i >= series.length;
      const p = isFc ? fc[i - series.length] : null;
      return `<rect class="fc-hit" x="${(xAt(i) - xStep / 2).toFixed(1)}" y="${padT}" `
        + `width="${Math.max(xStep, 6).toFixed(1)}" height="${plotH.toFixed(1)}" `
        + `data-x="${xAt(i).toFixed(1)}" data-y="${yAt(isFc ? p.predicted : histCount[i]).toFixed(1)}" `
        + `data-label="${HP.esc(isFc ? "+" + (i - series.length + 1) + " mo" : monthLabel(k))}" `
        + `data-value="${isFc ? p.predicted : histCount[i]}" `
        + `data-kind="${isFc ? "forecast" : "actual"}" `
        + `data-range="${isFc ? Math.round(p.lower95) + "–" + Math.round(p.upper95) : ""}" />`;
    }).join("");

    chartEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    chartEl.innerHTML = `
      <defs>
        <linearGradient id="fcAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
          <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${ticks.map((t) => {
        const y = yAt(t);
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="fc-grid-line${t === 0 ? " fc-grid-line--base" : ""}" />`
          + `<text x="${padL - 10}" y="${(y + 3.5).toFixed(1)}" class="fc-axis-label fc-axis-label--y">${t}</text>`;
      }).join("")}
      <path d="${areaPath}" class="fc-area" />
      <path d="${bandPath}" class="fc-ci-band" />
      <path d="${histPath}" class="fc-line-actual" />
      <path d="${rollingPath}" class="fc-line-rolling" />
      <path d="${fcPath}" class="fc-line-forecast" />
      <line x1="${nowX.toFixed(1)}" y1="${padT}" x2="${nowX.toFixed(1)}" y2="${padT + plotH}" class="fc-now-line" />
      <text x="${(nowX + 6).toFixed(1)}" y="${(padT + 10).toFixed(1)}" class="fc-axis-label fc-now-label">FORECAST</text>
      ${dots}
      ${xLabels.map((l) => `<text x="${l.x.toFixed(1)}" y="${H - 9}" class="fc-axis-label">${HP.esc(l.text)}</text>`).join("")}
      <line class="fc-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" opacity="0" />
      <circle class="fc-focus-dot" r="4.5" opacity="0" />
      ${hit}
    `;

    bindChartHover();

    legendEl.innerHTML = `
      <span class="fc-legend-item"><span class="fc-swatch fc-swatch--actual"></span>Actual demand</span>
      <span class="fc-legend-item"><span class="fc-swatch fc-swatch--rolling"></span>3-month rolling average</span>
      <span class="fc-legend-item"><span class="fc-swatch fc-swatch--forecast"></span>Forecast</span>
      <span class="fc-legend-item"><span class="fc-swatch fc-swatch--band"></span>95% confidence interval</span>
      <span class="fc-legend-hint">Hover for monthly figures</span>`;
  }

  /* Pick an axis top that divides into `count` whole-number steps — bookings
     are counts, so a gridline at 12.5 is meaningless. Choosing a nice STEP
     (1/2/5 × 10ⁿ) and multiplying up beats rounding the top and dividing,
     which lands on fractions for any count that isn't a factor of the top. */
  function niceCeil(v, count) {
    if (!(v > 0)) return count;
    const raw = v / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    // Floor of 1: bookings are whole, and a sub-1 step repeats tick labels
    // once they're rounded (0,1,1,2,2 on a max of 2).
    const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
    return Math.max(step * count, step * Math.ceil(v / step));
  }

  function yTicks(maxY, count) {
    const out = [];
    for (let i = 0; i <= count; i++) out.push(Math.round((maxY / count) * i));
    return out;
  }

  /* Hover readout. One delegated listener on the SVG; the invisible .fc-hit
     columns carry the values so there's no per-point closure to leak. */
  function bindChartHover() {
    const tip = document.getElementById("fcTip");
    const cross = chartEl.querySelector(".fc-crosshair");
    const focus = chartEl.querySelector(".fc-focus-dot");
    if (!tip || !cross || !focus) return;

    const hide = () => {
      tip.hidden = true;
      cross.setAttribute("opacity", "0");
      focus.setAttribute("opacity", "0");
    };

    chartEl.addEventListener("mouseleave", hide);
    chartEl.querySelectorAll(".fc-hit").forEach((r) => {
      r.addEventListener("mouseenter", () => {
        const d = r.dataset;
        cross.setAttribute("x1", d.x); cross.setAttribute("x2", d.x);
        cross.setAttribute("opacity", "1");
        focus.setAttribute("cx", d.x); focus.setAttribute("cy", d.y);
        focus.setAttribute("opacity", "1");
        focus.classList.toggle("is-forecast", d.kind === "forecast");

        tip.innerHTML =
          `<strong>${HP.esc(d.label)}</strong>`
          + `<span class="fc-tip-val">${d.value} <em>bookings</em></span>`
          + (d.range ? `<span class="fc-tip-sub">95% CI · ${HP.esc(d.range)}</span>` : "");
        tip.hidden = false;

        // Position against the wrapper, flipping before the tip runs off the right edge.
        const wrap = chartEl.parentElement.getBoundingClientRect();
        const box = chartEl.getBoundingClientRect();
        const px = (Number(d.x) / 960) * box.width + (box.left - wrap.left);
        const py = (Number(d.y) / 320) * box.height + (box.top - wrap.top);
        const flip = px > wrap.width - 150;
        tip.style.left = (flip ? px - 14 : px + 14) + "px";
        tip.style.top = Math.max(4, py - 18) + "px";
        tip.classList.toggle("fc-tip--flip", flip);
      });
    });
  }

  /* ── Forecast table (by type, with business-flag actions) ──────────────── */
  let lastSeries, lastFc, lastAvgCount;
  function renderTable(series, fc, avgCount, rows) {
    lastSeries = series; lastFc = fc; lastAvgCount = avgCount;
    const lastKey = series[series.length - 1].key;
    const [ly, lm] = lastKey.split("-").map(Number);

    const types = typeFilter === "all" ? ["Catering", "Food Pack"] : [typeFilter];
    // Per-type share of overall demand, to split the total forecast proportionally
    // — §4.3 fits per package_type "if each has enough volume/history".
    const typeShare = {};
    types.forEach((t) => {
      const count = allRows.filter((o) => o.eventMs && !o.cancelled && o.type === t).length;
      const total = allRows.filter((o) => o.eventMs && !o.cancelled).length;
      typeShare[t] = total ? count / total : 1 / types.length;
    });

    const rowsHTML = [];
    fc.forEach((point, i) => {
      const d = new Date(ly, lm - 1 + point.stepsAhead, 1);
      const periodLabel = d.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
      types.forEach((t) => {
        const share = typeFilter === "all" ? typeShare[t] : 1;
        const predicted = Math.round(point.predicted * share);
        const lower = Math.round(point.lower80 * share);
        const upper = Math.round(point.upper80 * share);
        const flag = M.businessFlag({ ...point, predicted }, avgCount * share, periodLabel);
        rowsHTML.push(`
          <tr>
            <td>${HP.esc(periodLabel)}</td>
            <td>${HP.esc(t)}</td>
            <td><strong>${predicted}</strong>${point.confidence === "low" ? ' <span class="badge badge-warn fc-low-badge">Low confidence</span>' : ""}</td>
            <td>${lower}&ndash;${upper}</td>
            <td class="fc-flag fc-flag--${flag.level}">${HP.esc(flag.text)}</td>
          </tr>`);
      });
    });

    const pageCount = Math.max(1, Math.ceil(rowsHTML.length / TABLE_PAGE_SIZE));
    tablePage = Math.min(Math.max(tablePage, 1), pageCount);
    const start = (tablePage - 1) * TABLE_PAGE_SIZE;
    HP.shell.paint(tableEl, rowsHTML.slice(start, start + TABLE_PAGE_SIZE).join(""));
    renderTablePager(pageCount);
  }

  function renderTablePager(pageCount) {
    if (pageCount <= 1) { tablePagerEl.innerHTML = ""; return; }
    const numbers = Array.from({ length: pageCount }, (_, i) => i + 1)
      .map((n) => `<button class="page-btn${n === tablePage ? " active" : ""}" data-page="${n}" ${n === tablePage ? 'aria-current="page"' : ""}>${n}</button>`)
      .join("");
    tablePagerEl.innerHTML = `
      <button class="icon-btn" id="fcPagePrev" ${tablePage === 1 ? "disabled" : ""} aria-label="Previous page">${HP.icon("chevronLeft")}</button>
      <div class="page-nums">${numbers}</div>
      <button class="icon-btn" id="fcPageNext" ${tablePage === pageCount ? "disabled" : ""} aria-label="Next page">${HP.icon("chevronRight")}</button>`;
    document.getElementById("fcPagePrev").addEventListener("click", () => { tablePage--; renderTable(lastSeries, lastFc, lastAvgCount, allRows); });
    document.getElementById("fcPageNext").addEventListener("click", () => { tablePage++; renderTable(lastSeries, lastFc, lastAvgCount, allRows); });
    tablePagerEl.querySelectorAll("[data-page]").forEach((b) =>
      b.addEventListener("click", () => { tablePage = Number(b.dataset.page); renderTable(lastSeries, lastFc, lastAvgCount, allRows); }));
    HP.hydrateIcons(tablePagerEl);
  }

  /* ── Calendar heatmap (month intensity, current + prior year) ───────────── */
  function renderHeatmap(series) {
    const byKey = new Map(series.map((s) => [s.key, s.count]));
    const max = Math.max(1, ...series.map((s) => s.count));
    const allYears = series.map((s) => Number(s.key.split("-")[0]));
    const minYear = Math.min(...allYears);
    const maxYear = Math.max(...allYears);

    if (heatYear === null) heatYear = maxYear;
    heatYear = Math.min(Math.max(heatYear, minYear), maxYear);
    const y = heatYear;

    heatmapEl.innerHTML = `
      <div class="fc-heat-year">
        <strong>${y}</strong>
        <div class="fc-heat-row">
          ${Array.from({ length: 12 }, (_, m) => {
            const key = `${y}-${String(m + 1).padStart(2, "0")}`;
            const count = byKey.get(key);
            const has = byKey.has(key);
            const intensity = has ? Math.max(0.12, count / max) : 0;
            const label = new Date(y, m, 1).toLocaleDateString("en-PH", { month: "short" });
            return `<div class="fc-heat-cell${has ? "" : " fc-heat-cell--empty"}" style="--fc-heat:${intensity}" title="${label} ${y}: ${has ? count : "no data"}">
              <span>${label}</span>${has ? `<small>${count}</small>` : ""}
            </div>`;
          }).join("")}
        </div>
      </div>`;
    renderHeatPager(minYear, maxYear);
  }

  function renderHeatPager(minYear, maxYear) {
    if (minYear === maxYear) { heatPagerEl.innerHTML = ""; return; }
    heatPagerEl.innerHTML = `
      <button class="icon-btn" id="fcHeatPrev" ${heatYear === minYear ? "disabled" : ""} aria-label="Previous year">${HP.icon("chevronLeft")}</button>
      <div class="page-nums"><button class="page-btn active" aria-current="page">${heatYear}</button></div>
      <button class="icon-btn" id="fcHeatNext" ${heatYear === maxYear ? "disabled" : ""} aria-label="Next year">${HP.icon("chevronRight")}</button>`;
    document.getElementById("fcHeatPrev").addEventListener("click", () => { heatYear--; renderHeatmap(lastSeries); });
    document.getElementById("fcHeatNext").addEventListener("click", () => { heatYear++; renderHeatmap(lastSeries); });
    HP.hydrateIcons(heatPagerEl);
  }

  /* ── PH seasonality report ───────────────────────────────────────────── */
  function renderSeasonality(seasonality) {
    if (!seasonality.total) {
      seasonalityEl.innerHTML = `<p class="modal-text">No dated bookings yet.</p>`;
      return;
    }
    seasonalityEl.innerHTML = `
      <ul class="fc-season-list">
        ${seasonality.seasons.map((s) => `
          <li class="fc-season-row">
            <span class="fc-season-label">${HP.esc(s.label)}</span>
            <span class="fc-season-bar-track"><span class="fc-season-bar" style="width:${Math.round(s.share * 100)}%"></span></span>
            <span class="fc-season-pct">${Math.round(s.share * 100)}%</span>
          </li>`).join("")}
      </ul>
      <p class="modal-text fc-note">Local fiesta calendars aren't available yet — <code>bookings</code> has no region/city field (see Master promp.md §3.3). Region-based seasonality needs that field added first.</p>`;
  }

  /* ── Segment mix (volume share by bookingType, donut + list) ───────────── */
  const SEGMENT_COLOR = { Catering: "var(--gold-deep)", "Food Pack": "var(--ok)" };
  function renderSegments(counts) {
    const types = ["Catering", "Food Pack"];
    const totalCount = types.reduce((s, t) => s + counts[t].count, 0) || 1;
    const shares = types.map((t) => ({ t, count: counts[t].count, pct: counts[t].count / totalCount }));

    // Ring built from stacked stroke-dasharray arcs, one per segment, in the
    // same hand-rolled-SVG convention as the trend chart's <path> elements.
    const R = 40, C = 2 * Math.PI * R;
    let offset = 0;
    const arcs = shares.map(({ t, pct }) => {
      const len = pct * C;
      const arc = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${SEGMENT_COLOR[t]}" stroke-width="16"
        stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 60 60)" />`;
      offset += len;
      return arc;
    }).join("");
    const leadPct = Math.round(shares[0].pct * 100);

    segmentsEl.innerHTML = `
      <div class="fc-segment-wrap">
        <div class="fc-segment-donut">
          <svg viewBox="0 0 120 120" width="120" height="120">
            <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--paper-2)" stroke-width="16" />
            ${arcs}
          </svg>
          <span class="fc-segment-donut-label">${totalCount > 0 ? leadPct + "%" : "—"}</span>
        </div>
        <ul class="fc-segment-list">
          ${shares.map(({ t, count, pct }) => `
            <li class="fc-segment-row">
              <span class="fc-segment-dot" style="background:${SEGMENT_COLOR[t]}"></span>
              <span class="fc-segment-name">${HP.esc(t)}</span>
              <span class="fc-segment-count">${count} booking${count === 1 ? "" : "s"} (${Math.round(pct * 100)}%)</span>
            </li>`).join("")}
        </ul>
      </div>`;
  }

  /* ── Lead time & cancellation ─────────────────────────────────────────── */
  const SEASON_LABEL = {
    ber_months: "“Ber” months", christmas_new_year: "Christmas / New Year",
    wedding_season: "Wedding season", holy_week: "Holy Week / Lent", off_season: "Other months",
  };
  function renderLeadTime(lc) {
    const avg = lc.avgLeadDays == null ? "—" : Math.round(lc.avgLeadDays) + " days";
    leadTimeEl.innerHTML = `
      <div class="fc-lead-stats">
        <div><strong>${avg}</strong><small>Average lead time (order → event)</small></div>
        <div><strong>${Math.round((lc.cancellationRate || 0) * 100)}%</strong><small>Overall cancellation rate (${lc.cancelledCount}/${lc.totalDatedCount})</small></div>
      </div>
      <ul class="fc-season-list">
        ${lc.bySeason.sort((a, b) => b.total - a.total).map((s) => `
          <li class="fc-season-row">
            <span class="fc-season-label">${HP.esc(SEASON_LABEL[s.tag] || s.tag)}</span>
            <span class="fc-season-bar-track"><span class="fc-season-bar fc-season-bar--danger" style="width:${Math.round(s.rate * 100)}%"></span></span>
            <span class="fc-season-pct">${Math.round(s.rate * 100)}% (${s.cancelled}/${s.total})</span>
          </li>`).join("")}
      </ul>`;
  }

  /* ── Model validation ─────────────────────────────────────────────────── */
  function renderValidation(validation, decomposition) {
    if (!validation.folds.length) {
      validationEl.innerHTML = `<p class="modal-text">Not enough history yet to backtest the model — needs at least one full seasonal cycle beyond the training window.</p>`;
      return;
    }
    const seasonalNote = decomposition.sufficient
      ? `Seasonal period detected: every ${decomposition.period} months (standard annual cycle for monthly data).`
      : `Fewer than 2 full years of history — seasonal decomposition is trend-only until more data comes in.`;
    validationEl.innerHTML = `
      <div class="fc-validation-stats">
        <div><strong>${validation.mae.toFixed(1)}</strong><small>MAE (orders)</small></div>
        <div><strong>${validation.rmse.toFixed(1)}</strong><small>RMSE (orders)</small></div>
        <div><strong>${validation.mape == null ? "—" : Math.round(validation.mape * 100) + "%"}</strong><small>MAPE</small></div>
        <div><strong>${validation.folds.length}</strong><small>Walk-forward folds</small></div>
      </div>
      <p class="modal-text fc-note">${HP.esc(seasonalNote)} Validated by rolling-origin backtesting (Master promp.md §4.4): each fold forecasts one month past a growing training window and scores against what actually happened.</p>`;
  }
})();
