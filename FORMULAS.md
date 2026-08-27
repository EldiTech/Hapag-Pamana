# Hapag Pamana — Mathematical Formulas & Code Reference

This document maps all core mathematical algorithms and formulas implemented across the application to their exact source code locations.

---

## 1. Collaborative Filtering — Cosine Similarity

### Mathematical Formula
$$\text{Cosine Similarity}(A, B) = \frac{\sum (A_i \times B_i)}{\sqrt{\sum (A_i)^2} \times \sqrt{\sum (B_i)^2}}$$

- $A, B$: User vectors (or item vectors) representing order frequency counts.
- $A_i, B_i$: Exact frequency count of item $i$ ordered by User $A$ and User $B$.
- **Numerator**: Dot product measuring shared overlapping tastes.
- **Denominator**: Vector norm normalization ensuring scale invariance.

### Code Locations
- **Flutter Client Engine**: [`lib/data/recommendation_engine.dart:L51-L74`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/lib/data/recommendation_engine.dart#L51-L74)
  - Method: `RecommendationEngine.cosineSimilarity(userA, userB)`
  - Method: `RecommendationEngine.computeUserBasedCF(...)`
- **Admin Dashboard**: [`Admin/assets/hp-recommend.js:L225-L277`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/Admin/assets/hp-recommend.js#L225-L277)
  - Method: `HPRec.cosineSimilarity(userA, userB)`
  - Method: `HPRec.userBasedRecommendations(targetUser, historicalUsers, limit)`
- **Unit Tests**: [`test/recommendation_engine_test.dart:L470-L519`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/test/recommendation_engine_test.dart#L470-L519)

---

## 2. Expiry-Aware Recommendation Scoring

### Mathematical Formula
$$S_{final} = w_1(R_{u, d}) + w_2(E_i)$$

Where:
- $S_{final}$: Finalized visibility score for menu item / dish $d$.
- $R_{u, d}$: Baseline predicted preference score of user $u$ for dish $d$ from Collaborative Filtering.
- $E_i$: Expiry Urgency Factor:
  $$E_i = \max\left(0, 1 - \frac{\text{daysToExpiry}_i}{\text{maxThresholdDays}}\right) \quad \text{or} \quad E_i = \frac{1}{\text{daysToExpiry}_i + 1}$$
- $w_1, w_2$: Configurable weighting parameters (default $w_1 = 0.7$, $w_2 = 0.3$).

### Code Locations
- **Flutter Client**: [`lib/data/recommendation_engine.dart`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/lib/data/recommendation_engine.dart)
- **Admin Inventory & Recommendation**: [`Admin/assets/hp-recommend.js`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/Admin/assets/hp-recommend.js)

---

## 3. SARIMA Demand Forecasting

### Mathematical Formula
$$\phi(B) \Phi(B^s) (1 - B)^d (1 - B^s)^D y_t = c + \theta(B) \Theta(B^s) \varepsilon_t$$

### Expanded Difference Equation ($\text{SARIMA}(1,0,1)(1,0,1,s)$)
$$y_t = c + \phi_1 y_{t-1} + \Phi_1 y_{t-s} - (\phi_1 \Phi_1) y_{t-s-1} + \theta_1 \varepsilon_{t-1} + \Theta_1 \varepsilon_{t-s} - (\theta_1 \Theta_1) \varepsilon_{t-s-1} + \varepsilon_t$$

Where:
- $y_{t-1}$: Non-seasonal AR(1) lag ($\phi_1 = 0.35$)
- $y_{t-s}$: Seasonal AR(1) lag ($\Phi_1 = 0.60$, $s=12$ monthly / $s=52$ weekly)
- $y_{t-s-1}$: Seasonal-trend interaction lag ($\phi_1 \Phi_1$)
- $\varepsilon_t = y_t - \hat{y}_t$: Residual error series
- $\theta_1, \Theta_1$: Non-seasonal and seasonal Moving Average MA(1) parameters ($\theta_1 = -0.15, \Theta_1 = -0.10$)
- $c$: Baseline constant

### Code Locations
- **Forecast Model Engine**: [`Admin/Orders/js/forecast-model.js:L30-L105`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/Admin/Orders/js/forecast-model.js#L30-L105)
  - Method: `computeResiduals(history, s, params)`
  - Method: `sarimaPointForecast(history, i, s, params)`
  - Method: `pointForecast(history, i, period)`
- **Forecast Controller**: [`Admin/Orders/js/forecast.js`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/Admin/Orders/js/forecast.js)

---

## 4. A* Pathfinding & Heuristics

### Mathematical Formula
$$f(n) = g(n) + h(n)$$

Where:
- $g(n)$: Exact accumulated movement cost from start node to node $n$ (orthogonal = $1.0$, diagonal = $\sqrt{2}$).
- $h(n)$: Heuristic estimate from node $n$ to goal:
  1. **Manhattan Distance** (4-way grid):
     $$h(n) = |x_1 - x_2| + |y_1 - y_2|$$
  2. **Euclidean Distance** (Straight-line):
     $$h(n) = \sqrt{(x_1 - x_2)^2 + (y_1 - y_2)^2}$$
  3. **Octile / Diagonal Distance** (8-way grid):
     $$h(n) = (\Delta x + \Delta y) + (\sqrt{2} - 2)\min(\Delta x, \Delta y)$$
- $f(n)$: Total estimated path cost (prioritized via binary min-heap).

### Code Locations
- **Layout Viewer (Mobile / Web)**: [`hosting/layout-viewer/js/nav.js:L245-L345`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/hosting/layout-viewer/js/nav.js#L245-L345)
- **Admin Layout Designer**: [`Admin/Layout Designer/js/nav.js:L245-L345`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/Admin/Layout%20Designer/js/nav.js#L245-L345)
  - Object: `HEURISTICS` (`manhattan`, `euclidean`, `octile`)
  - Function: `findPath(g, from, to, opts)`

---

## 5. 2D & 3D Collision Detection

### 2D Collision Detection

1. **Circle vs Circle**:
   $$(x_2 - x_1)^2 + (y_2 - y_1)^2 \le (r_1 + r_2)^2$$
2. **Rectangle vs Rectangle (2D AABB)**:
   $$x_1 < x_2 + w_2 \land x_1 + w_1 > x_2 \land y_1 < y_2 + h_2 \land y_1 + h_1 > y_2$$
3. **Circle vs Rectangle**:
   - Closest Point:
     $$C_x = \max(x, \min(x_c, x + w)), \quad C_y = \max(y, \min(y_c, y + h))$$
   - Collision Condition:
     $$(x_c - C_x)^2 + (y_c - C_y)^2 \le r^2$$

### 3D Collision Detection

1. **Sphere vs Sphere**:
   $$(x_2 - x_1)^2 + (y_2 - y_1)^2 + (z_2 - z_1)^2 \le (r_1 + r_2)^2$$
2. **Box vs Box (3D AABB)**:
   $$x_1 < x_2 + w_2 \land x_1 + w_1 > x_2 \land y_1 < y_2 + h_2 \land y_1 + h_1 > y_2 \land z_1 < z_2 + d_2 \land z_1 + d_1 > z_2$$
3. **Sphere vs Box (3D AABB)**:
   - Closest Point:
     $$C_x = \max(x_{min}, \min(x_s, x_{max})), \quad C_y = \max(y_{min}, \min(y_s, y_{max})), \quad C_z = \max(z_{min}, \min(z_s, z_{max}))$$
   - Collision Condition:
     $$(x_s - C_x)^2 + (y_s - C_y)^2 + (z_s - C_z)^2 \le r^2$$

### Code Locations
- **Layout Viewer (Client)**: [`hosting/layout-viewer/js/nav.js:L105-L185`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/hosting/layout-viewer/js/nav.js#L105-L185)
- **Admin Layout Designer**: [`Admin/Layout Designer/js/nav.js:L105-L185`](file:///c:/Users/Moymoy/Downloads/Hapag%20Pamana/Admin/Layout%20Designer/js/nav.js#L105-L185)
  - Object: `HPNav.Collision` (`circleVsCircle`, `rectVsRect`, `circleVsRect`, `sphereVsSphere`, `boxVsBox`, `sphereVsBox`)
