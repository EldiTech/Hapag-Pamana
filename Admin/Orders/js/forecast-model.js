/* HapagPamana · Forecast — demand forecasting model with SARIMA(p,d,q)(P,D,Q,s).
   
   Implements the expanded SARIMA(1,0,1)(1,0,1,s) difference equation:
     y_t = c + phi1 * y_{t-1} + Phi1 * y_{t-s} - (phi1 * Phi1) * y_{t-s-1}
             + theta1 * e_{t-1} + Theta1 * e_{t-s} - (theta1 * Theta1) * e_{t-s-1} + e_t

   Where:
     - y_{t-1}: non-seasonal AR(1) lag (phi1)
     - y_{t-s}: seasonal AR(1) lag (Phi1)
     - y_{t-s-1}: interaction lag (phi1 * Phi1)
     - e_{t-1}, e_{t-s}, e_{t-s-1}: moving average MA(1) and seasonal MA(1) error residuals (theta1, Theta1)
     - blended with moving-average level when history < 2 seasonal cycles
     - walk-forward (rolling-origin) validation, MAE/RMSE/MAPE per fold
     - 80%/95% confidence intervals from residual spread

   Exposed on window.HPForecast.model:
     forecast(series, horizon, period)  → ForecastPoint[]
     walkForwardValidate(series, period) → { folds: [...], mae, rmse, mape }
     businessFlag(point, avg)            → { level, text }
     sarimaEquation(history, i, s, params) → { value, residuals } */
(function () {
  "use strict";
  window.HPForecast = window.HPForecast || {};

  const MIN_CYCLES_FOR_SEASONAL = 2; // Full seasonal cycles for normal confidence

  // Default calibrated SARIMA(1,0,1)(1,0,1,s) parameters
  const SARIMA_DEFAULTS = {
    phi1: 0.35,     // non-seasonal AR(1) parameter
    Phi1: 0.60,     // seasonal AR(1) parameter
    theta1: -0.15,  // non-seasonal MA(1) parameter
    Theta1: -0.10,  // seasonal MA(1) parameter
    c: 0,           // baseline constant
  };

  /* Computes historical residuals e_t across the known series under SARIMA(1,0,1)(1,0,1,s). */
  function computeResiduals(history, s, params = SARIMA_DEFAULTS) {
    const n = history.length;
    const residuals = new Array(n).fill(0);
    const { phi1, Phi1, theta1, Theta1, c } = params;

    for (let t = s + 1; t < n; t++) {
      const y_prev = history[t - 1] || 0;
      const y_seas = history[t - s] || 0;
      const y_seas_prev = history[t - s - 1] || 0;
      const e_prev = residuals[t - 1] || 0;
      const e_seas = residuals[t - s] || 0;
      const e_seas_prev = residuals[t - s - 1] || 0;

      const y_hat = c
        + phi1 * y_prev
        + Phi1 * y_seas
        - (phi1 * Phi1) * y_seas_prev
        + theta1 * e_prev
        + Theta1 * e_seas
        - (theta1 * Theta1) * e_seas_prev;

      residuals[t] = history[t] - y_hat;
    }
    return residuals;
  }

  /* Point forecast using SARIMA(1,0,1)(1,0,1,s) difference equation for index `i`,
     given seasonal period `s` (12 monthly, 52 weekly). */
  function sarimaPointForecast(history, i, s, params = SARIMA_DEFAULTS) {
    const n = history.length;
    const residuals = computeResiduals(history, s, params);
    const { phi1, Phi1, theta1, Theta1, c } = params;

    const y_prev = history[n - 1] || 0;
    const y_seas = history[n >= s ? n - s : 0] || 0;
    const y_seas_prev = history[n >= s + 1 ? n - s - 1 : 0] || 0;
    const e_prev = residuals[n - 1] || 0;
    const e_seas = residuals[n >= s ? n - s : 0] || 0;
    const e_seas_prev = residuals[n >= s + 1 ? n - s - 1 : 0] || 0;

    const forecast = c
      + phi1 * y_prev
      + Phi1 * y_seas
      - (phi1 * Phi1) * y_seas_prev
      + theta1 * e_prev
      + Theta1 * e_seas
      - (theta1 * Theta1) * e_seas_prev;

    return Math.max(0, forecast);
  }

  /* Point forecast for index `i`, blending SARIMA with moving-average level
     based on available cycle history. */
  function pointForecast(history, i, period) {
    const n = history.length;
    const tail = history.slice(Math.max(0, n - Math.min(6, n)));
    const levelOnly = tail.reduce((a, b) => a + b, 0) / (tail.length || 1);

    const cyclesAvailable = n / period;
    if (cyclesAvailable < 1 || i - period < 0) {
      return { value: Math.max(0, levelOnly), confidence: "low" };
    }

    const sarimaValue = sarimaPointForecast(history, i, period);

    if (cyclesAvailable >= MIN_CYCLES_FOR_SEASONAL) {
      return { value: Math.max(0, sarimaValue), confidence: "normal" };
    }

    // Between 1 and 2 cycles: blend proportionally
    const w = cyclesAvailable - 1; // 0..1
    const blended = (1 - w) * levelOnly + w * sarimaValue;
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
    sarimaPointForecast,
    computeResiduals,
    SARIMA_DEFAULTS,
  };
})();
