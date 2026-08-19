/* HapagPamana · Forecast — demand forecasting model (Master promp.md §4).

   SARIMA itself needs a Python runtime this stack doesn't have (§0: no
   Node/Python service exists, and none is being stood up for this build —
   see the fallback path §4.1 explicitly allows for). What's implemented
   here IS that documented fallback, done properly rather than as a stopgap:

     - naive seasonal forecast: next year's period = same period last year,
       drifted by the recent trend
     - blended with a moving-average level for periods with < 2 seasonal
       cycles of history
     - walk-forward (rolling-origin) validation, MAE/RMSE/MAPE per fold
     - 80%/95% confidence intervals from the walk-forward residual spread
     - every forecast point is labelled low-confidence when history is short
       or the segment is thin — never a silent point estimate

   Exposed on window.HPForecast.model:
     forecast(series, horizon, period)  → ForecastPoint[]
     walkForwardValidate(series, period) → { folds: [...], mae, rmse, mape }
     businessFlag(point, avg)            → { level, text } */
(function () {
  "use strict";
  window.HPForecast = window.HPForecast || {};

  const MIN_CYCLES_FOR_SEASONAL = 2; // Master promp.md §4.1

  /* Point forecast for index `i` (one step past the end of `history`, or any
     future index during validation), given `period` (12 monthly, 52 weekly).
     Two components, blended by how much seasonal history actually exists:

       seasonal:  history[i - period] + linear drift estimated from the last
                  min(period, n) periods' trend (captures "this Dec vs last
                  Dec, adjusted for the trend since")
       levelOnly: moving average of the trailing min(6, n) periods — used
                  outright when there isn't a full prior cycle to reference,
                  and blended in as history approaches 2 cycles so the
                  forecast doesn't jump discontinuously the day it crosses
                  the threshold. */
  function pointForecast(history, i, period) {
    const n = history.length;
    const tail = history.slice(Math.max(0, n - Math.min(6, n)));
    const levelOnly = tail.reduce((a, b) => a + b, 0) / (tail.length || 1);

    const cyclesAvailable = n / period;
    if (cyclesAvailable < 1 || i - period < 0) {
      return { value: Math.max(0, levelOnly), confidence: "low" };
    }

    const same = history[i - period];
    // Trend: average change per period over the last full cycle available,
    // capped at ±25% of the level so one wild month can't blow up the drift.
    const span = Math.min(period, n - period);
    let drift = 0;
    if (span >= 2) {
      const first = history[n - span];
      const last = history[n - 1];
      drift = (last - first) / (span - 1);
      const cap = 0.25 * Math.max(1, levelOnly);
      drift = Math.max(-cap, Math.min(cap, drift));
    }
    const stepsAhead = i - (n - 1);
    const seasonalValue = same + drift * stepsAhead;

    if (cyclesAvailable >= MIN_CYCLES_FOR_SEASONAL) {
      return { value: Math.max(0, seasonalValue), confidence: "normal" };
    }
    // Between 1 and 2 cycles: blend seasonal in proportionally rather than
    // switching over abruptly at the threshold.
    const w = cyclesAvailable - 1; // 0..1
    const blended = (1 - w) * levelOnly + w * seasonalValue;
    return { value: Math.max(0, blended), confidence: "low" };
  }

  /* Rolling-origin cross-validation (§4.4): repeatedly forecast one step past
     a growing training window and score against the actual. Starts once at
     least one full period of history is available so the first fold isn't
     meaningless; each fold's error feeds both the reported metrics and the
     residual spread the confidence intervals are built from. */
  function walkForwardValidate(series, period) {
    const counts = series.map((s) => s.count);
    const minTrain = Math.max(period, 3);
    const folds = [];
    for (let cut = minTrain; cut < counts.length; cut++) {
      const history = counts.slice(0, cut);
      const actual = counts[cut];
      const { value: predicted } = pointForecast(history, cut, period);
      const error = actual - predicted;
      folds.push({
        key: series[cut].key, actual, predicted,
        error, absError: Math.abs(error),
        pctError: actual ? Math.abs(error) / actual : null,
      });
    }
    if (!folds.length) return { folds: [], mae: null, rmse: null, mape: null };

    const mae = folds.reduce((s, f) => s + f.absError, 0) / folds.length;
    const rmse = Math.sqrt(folds.reduce((s, f) => s + f.error * f.error, 0) / folds.length);
    const withPct = folds.filter((f) => f.pctError != null);
    const mape = withPct.length
      ? withPct.reduce((s, f) => s + f.pctError, 0) / withPct.length
      : null;

    return { folds, mae, rmse, mape };
  }

  // 80%/95% z-scores for a normal approximation of the forecast error.
  const Z80 = 1.2816, Z95 = 1.9600;

  /* Forecasts `horizon` periods past the end of `series`. The residual
     standard deviation from walk-forward validation sizes the confidence
     interval — a model that's been visibly unreliable in backtesting says so
     with wide bands, rather than a fixed +/-X% that doesn't reflect fit. */
  function forecast(series, horizon, period) {
    const counts = series.map((s) => s.count);
    const { folds } = walkForwardValidate(series, period);
    const residualSd = folds.length >= 2
      ? Math.sqrt(folds.reduce((s, f) => s + f.error * f.error, 0) / folds.length)
      : Math.max(1, (counts.reduce((a, b) => a + b, 0) / (counts.length || 1)) * 0.35); // no folds yet: assume +/-35% of the mean

    const extended = counts.slice();
    const out = [];
    for (let step = 1; step <= horizon; step++) {
      const i = extended.length;
      const { value, confidence } = pointForecast(extended, i, period);
      const rounded = Math.round(value);
      // Error compounds the further out the horizon reaches.
      const sd = residualSd * Math.sqrt(step);
      out.push({
        stepsAhead: step,
        predicted: rounded,
        lower80: Math.max(0, Math.round(value - Z80 * sd)),
        upper80: Math.round(value + Z80 * sd),
        lower95: Math.max(0, Math.round(value - Z95 * sd)),
        upper95: Math.round(value + Z95 * sd),
        confidence: series.length < period * MIN_CYCLES_FOR_SEASONAL ? "low" : confidence,
      });
      extended.push(value); // each step forecasts off the growing series, including its own prior forecasts
    }
    return out;
  }

  /* Business translation layer (§4.7): a plain-language flag per forecast
     point, relative to the trailing average of the input series. */
  function businessFlag(point, seriesAvg, periodLabel) {
    if (!seriesAvg) {
      return { level: "info", text: `${periodLabel}: forecast ${point.predicted} orders.` };
    }
    const pctVsAvg = (point.predicted - seriesAvg) / seriesAvg;
    const pct = Math.round(pctVsAvg * 100);
    const sign = pct >= 0 ? "+" : "";
    const low = point.confidence === "low" ? " — low-confidence, limited history." : "";

    if (pctVsAvg >= 0.25) {
      return {
        level: "high",
        text: `${periodLabel}: forecast ${point.predicted} orders (${sign}${pct}% vs. average) — recommend increasing staffing/inventory.${low}`,
      };
    }
    if (pctVsAvg <= -0.20) {
      return {
        level: "low",
        text: `${periodLabel}: forecast ${point.predicted} orders (${sign}${pct}%) — consider a promo campaign.${low}`,
      };
    }
    return {
      level: "normal",
      text: `${periodLabel}: forecast ${point.predicted} orders (${sign}${pct}% vs. average).${low}`,
    };
  }

  window.HPForecast.model = {
    forecast,
    walkForwardValidate,
    businessFlag,
    MIN_CYCLES_FOR_SEASONAL,
  };
})();
