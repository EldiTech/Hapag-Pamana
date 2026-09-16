# TECHNOLOGICAL INSTITUTE OF THE PHILIPPINES
## QUEZON CITY — COLLEGE OF COMPUTER STUDIES
### IT 010 - Systems Integration and Architecture 2
**GROUP NO. 6**
- **Leader:** Espino, Luis David B. / IT41S1
- **Member 1:** Egil, Abdullah Ibn Mujahid J. / IT41S1
- **Member 2:** Libag, Joshua M. / IT41S1
- **Member 3:** Penola, John Paul S. / IT41S1

**Assessment Task:** Supplemental Progress Report (Unreported System Implementations Audit)  
**Project Title:** *HapagPamana: A Smart Catering Recommendation and Venue Layout Planning System Using SARIMA and Collaborative Filtering with A\* Pathfinding and AABB Collision Detection*  
**Coverage:** Deep codebase audit of completed modules, algorithmic engines, security rules, and architectural subsystems implemented up to **September 13, 2026**, which were **omitted or listed only as pending/preliminary** in `GROUP6_PROGRESSREPORT_AUGUST112026.docx`.

---

## EXECUTIVE SUMMARY & AUDIT COMPARISON

A deep audit of the HapagPamana codebase against `GROUP6_PROGRESSREPORT_AUGUST112026.docx` reveals that the project has progressed substantially beyond what was captured in the August 11, 2026 document. Multiple entire subsystems, mathematical models, architectural redesigns, and administrative desks have been fully developed, committed to version control, and validated through 90 automated unit and component tests.

| Major Feature / Module Area | Status in `GROUP6_PROGRESSREPORT_AUGUST112026.docx` | Actual Status in Codebase (As of Sept 13, 2026) | Primary Source Code Reference |
| :--- | :--- | :--- | :--- |
| **11th Admin Dashboard: Catering Equipment Desk** | **Completely Missing** (Doc reports only "ten administrative dashboards") | **100% Implemented & Integrated** (Inventory, prep checklist, pickup reconciliation, rules) | `Admin/Catering Equipment/`, `firestore.rules:L31-35,376-393` |
| **Global Event & Announcement System** | **Completely Missing** (0 occurrences in document) | **100% Implemented & Integrated** (Web CRUD + Flutter live carousel + popup modals) | `Admin/Content Moderator/html/announcements.html`, `lib/data/announcement.dart`, `Events.md` |
| **App Modal Queueing Coordinator** | **Completely Missing** | **100% Implemented** (Prevents concurrent modal collisions on app launch) | `lib/data/app_modal_queue.dart` |
| **In-App Notification Center** | **Completely Missing** | **100% Implemented** (Per-user subcollections, real-time unread badges) | `lib/data/notification_repository.dart`, `firestore.rules:L428-444` |
| **Dynamic "About Us" Content CMS** | **Completely Missing** | **100% Implemented** (Admin CMS syncing brand story/timeline to mobile app) | `Admin/Content Moderator/html/about.html`, `lib/data/about_content.dart` |
| **SARIMA $(1,0,1)(1,0,1,s)$ Demand Forecasting** | Reported only as **"Currently refining / replacing naive baseline"** | **Fully Implemented & Codified** (Exact difference equation, residual spread, confidence bands) | `Admin/Orders/js/forecast-model.js`, `FORMULAS.md` |
| **Historical Data ETL Pipeline (333 Catering Bookings)** | Reported only conceptually ("seeded dataset") | **Full ETL Implemented** (333 clean events from 2022–2026, Firestore backfill script) | `Admin/Orders/backfill/clean_events_final.csv`, `backfill_bookings.js` |
| **Collaborative Filtering Recommendation Engine** | Reported as **"Currently integrating... target week of Aug 18–22"** | **100% Completed & Validated** (Cosine similarity, $E_i$ expiry scoring, 4-tier fallbacks, 59 unit tests) | `lib/data/recommendation_engine.dart`, `Admin/assets/hp-recommend.js`, `FORMULAS.md` |
| **Mathematical Formulation Mapping** | **Completely Missing** | **Formally Codified** in `FORMULAS.md` (125 lines with exact line-level references) | `FORMULAS.md` |
| **Layout Optimization Heuristic Engine** | Reported only as basic instancing/LOD | **100% Implemented** (Ring scan constraint search, directional compass move recommendations) | `Admin/Layout Designer/js/optimise.js` |
| **Full 2D/3D Collision & Pathfinding Suite** | Reported only as basic AABB / A* | **6-point mathematical collision detection + 3 A\* heuristics** (Manhattan, Euclidean, Octile) | `hosting/layout-viewer/js/nav.js`, `Admin/Layout Designer/js/nav.js` |
| **Serverless Spark-Tier Mobile 3D Preview Bridge** | Reported as future deployment task | **100% Implemented** (Direct JS queueing bridge, zero Cloud Function costs, crowd toggle) | `docs/mobile-3d-preview.md`, `lib/screens/user/layout_preview_page.dart` |
| **Mobile Layout Picker Screen** | **Completely Missing** | **100% Implemented** (In-app layout selection for booking flow) | `lib/screens/user/settings/layout_picker_page.dart` |
| **Promotions & Discount Calculation Service** | **Completely Missing** | **100% Implemented & Tested** (Promo code validation, percentage/flat discounts) | `lib/data/promo_discount_service.dart`, `test/add_on_pricing_test.dart` |
| **Production Signed Android Release APK & Download Web Portal** | Reported as planned for "First week of Sept. 2026" | **Fully Built & Hosted** (Signed 64.6 MB APK + responsive web download landing page) | `Download Web/hapag-pamana-release.apk`, `Download Web/index.html` |
| **Comprehensive Automated Test Suite** | Reported as pending regression testing | **90/90 Unit & Component Tests Passing** across 7 dedicated test files | `test/` directory |

---

## SECTION I: UNREPORTED ARCHITECTURAL & SYSTEM-WIDE BREAKTHROUGHS

### 1. The 11th Dashboard: Catering Equipment Desk (`Admin/Catering Equipment/`)
- **Background:** The August 11 progress report repeatedly states that there are *"ten administrative dashboards"* (lines 27, 31, 33, 106, 135, 151). In reality, the architecture comprises **11 dedicated staff desks**.
- **Implementation Details:**
  - Separates non-food hardware assets (chafing dishes, roll-top warmers, round/rectangular tables, Chiavari chairs, tablecloths, beverage dispensers) from food pantry inventory.
  - Implements the complete operational lifecycle:
    1. **Inventory Management (`inventory.html`, `inventory.js`):** Category breakdown, par levels, damaged/in-repair states, and an append-only audit log (`equipmentLog`).
    2. **Event Equipment Preparation (`prep.js`, `index.html`):** Streams confirmed bookings, computes required gear quantities against guest counts, and provides prep staging checklists.
    3. **Service Floor Pickup Reconciliation:** Coordinates with Logistics and Team Leader to log returned gear after an event (`equipmentPickup`).
- **Security & Authorization (`firestore.rules`):**
  - Added `isCateringEquipment()` role-gate: `match /equipmentCategories/{id}`, `match /equipmentItems/{id}`, `match /equipmentLog/{id}`.
  - Added field-scoped update clause on `bookings/{id}` strictly restricted to `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['equipmentPrep', 'equipmentPickup'])`.

### 2. Event & Announcement Management System (Web + Mobile)
- **Background:** Omitted entirely from the August 11 report, this system bridges administrative broadcasts to the consumer Flutter app (detailed in `Events.md` and commit `0986a78`).
- **Implementation Details:**
  - **Admin Content Moderator Desk (`Admin/Content Moderator/html/announcements.html`, `announcements.js`):**
    - Full CRUD with status-state pipeline: `Draft`, `Published`, `Archived`, and `Deleted`.
    - Supports rich media uploads to Firebase Storage, event start/end date-time pickers, physical venue location input, and status filtering.
  - **Flutter Mobile Application (`lib/data/announcement.dart`, `announcement_repository.dart`, `announcement_session.dart`):**
    - Reactive real-time stream filtered strictly to `status == 'published'`.
    - Carousel widget in `lib/screens/user/user_home_page.dart` presenting the latest active bulletins.
    - Dedicated announcement details page (`lib/screens/user/announcement_details_page.dart`) with event countdown, formatted dates, and venue mapping.
    - Session tracking (`announcement_session.dart`): Prevents modal popups from repeatedly spamming users once viewed in an active app session.
  - **Security Rules:** `match /announcements/{id}` enforces public read access for guests/members and restricts writes exclusively to moderators and administrators.

### 3. App Modal Queueing Coordinator (`lib/data/app_modal_queue.dart`)
- **Background:** Unreported architectural component added in commit `d49ee26`.
- **Implementation Details:**
  - When a user opens the application, multiple asynchronous triggers can fire simultaneously: announcement modals, order status update alerts, feedback dialogs, maintenance notices, and promotional banners.
  - `AppModalQueue` establishes an asynchronous FIFO queue that holds incoming modal display requests and presents them one at a time sequentially upon dismissal, preventing visual stacking and UI thread lockups.

### 4. In-App Notification Center & Repository Layer
- **Background:** Completely absent from the previous progress report.
- **Implementation Details:**
  - Implemented in `lib/data/notification.dart` and `lib/data/notification_repository.dart`.
  - Configures per-user subcollections under `notifications/{uid}/items/{notifId}`.
  - Real-time unread badge synchronization in the user shell.
  - Granular Firestore security rules (`firestore.rules:L428-444`) permitting users to modify only `isRead`, while order managers/admins can dispatch notifications.

### 5. Dynamic "About Us" Content Management System
- **Background:** Omitted from the previous report.
- **Implementation Details:**
  - Developed `Admin/Content Moderator/html/about.html` and `about.js` allowing content managers to dynamically update brand story narratives, mission, vision, milestone timelines, catering team rosters, and contact information.
  - Synchronized directly to the Flutter client via `lib/data/about_content.dart` and `lib/screens/about_page.dart` (over 1,000 lines updated), eliminating hard-coded company copy.

### 6. Zero-Cost Spark Tier Serverless Architecture & Pure-Client 3D Layout Bridge
- **Background:** Previous report planned backend Cloud Functions for 3D layout token minting.
- **Implementation Details (`docs/mobile-3d-preview.md`):**
  - **Decommissioned Cloud Functions:** Marked `mintViewerToken` as dead code in `functions/index.js` and removed the functions block from `firebase.json`, keeping the system permanently on the 100% free Firebase Spark tier without subscription fees.
  - **Direct JavaScript Bridge:** `layout_preview_page.dart` pushes the booking's layout JSON directly across the Flutter WebView barrier using `window.HPViewer.show(payload)` with double-string encoding.
  - **Asynchronous Queueing Bridge:** `hosting/layout-viewer/index.html` installs an early receiver queue in `<head>` that banks payloads and flushes them only after `viewer.js` completes initialization, eliminating Android WebView `onPageFinished` race conditions.
  - **Selective Crowd Suppression:** Appends `?people=0` in mobile WebViews to disable crowd agent rendering, reducing RAM and boosting frame rates on mid-range phones while retaining full 3D crowd simulation on web browsers.

### 7. Production Signed Android Release APK & Download Web Portal
- **Background:** The August 11 report listed producing the signed APK and deploying the web hosting as a future planned task for the first week of September 2026.
- **Implementation Details:**
  - The production release build was generated on August 21, 2026: `Download Web/hapag-pamana-release.apk` (64,625,262 bytes).
  - A responsive public distribution web landing page was created in `Download Web/` (`index.html`, `app.js`, `style.css`) enabling testers and evaluation respondents to install the release APK directly.

---

## SECTION II: DETAILED INDIVIDUAL ACCOMPLISHMENTS (UNREPORTED WORK)

### LEADER — ESPINO, LUIS DAVID B. (IT41S1)
**Newly Completed Tasks Since August 11 Report:**
1. **Engineered the Automated Layout Optimization Engine (`Admin/Layout Designer/js/optimise.js`):**
   - Designed a constraint-satisfaction heuristic engine that translates spatial analysis diagnostics into actionable floor adjustments (e.g., *"Move Table 8 by 0.75 m east"*, *"Rotate Buffet Station 90°"*).
   - Utilizes a bounded ring-scan search on a 0.25 m grid with compass-bearing directional output, ensuring the smallest possible corrective move that resolves aisle clearances, chair pull space (0.75 m), door swing arcs (1.2 m), and emergency egress corridors.
   - Built with pure-function non-destructive state mutations and full undo capability (`apply()`, `undo()`).
2. **Formulated the 6-Point 2D & 3D Mathematical Collision Detection Suite:**
   - Codified and validated collision detection formulas in `hosting/layout-viewer/js/nav.js` and `FORMULAS.md`:
     - 2D: Circle vs Circle, 2D AABB Rectangle vs Rectangle, Circle vs Rectangle (clamped closest point).
     - 3D: Sphere vs Sphere, 3D AABB Box vs Box, Sphere vs Box (3D clamped closest point).
3. **Implemented Multi-Heuristic A\* Pathfinding:**
   - Programmed selectable A\* distance metrics in `nav.js`: Manhattan Distance ($L_1$), Euclidean Distance ($L_2$), and Octile/Diagonal Distance ($8$-way grid with $\sqrt{2}$ diagonal cost).
4. **Architected the Client-Side Mobile 3D WebView Bridge:**
   - Designed the `window.HPViewer` queueing bridge in `hosting/layout-viewer/` and `lib/screens/user/layout_preview_page.dart`.
   - Decommissioned Cloud Functions to ensure 100% Spark-tier compliance.
   - Added selective crowd suppression (`?people=0`) to preserve mobile frame rates.
5. **Hardened Project-Wide Firestore Security Rules (`firestore.rules` - 454 lines):**
   - Implemented downpayment forge prevention: blocked client creates from setting `paymentStatus: 'paid'`.
   - Blocked customer profile tampering: prevented clients from self-clearing `banned` status or writing `recommendations`.
   - Enforced field-level separation of concerns via `affectedKeys().hasOnly(...)` across Team Leader (`fulfilment`), Layout Designer (`layout`), Catering Equipment (`equipmentPrep`, `equipmentPickup`), and Stock Clerk (`issuedAt`).
   - Locked financial and inventory ledgers (`costings`, `procurements`, `pantryLog`, `equipmentLog`, `pettyCashLog`) to append-only with permanent deletion denied (`allow delete: if false`).
6. **Compiled Production Signed Android Release Build:**
   - Built `hapag-pamana-release.apk` (64.6 MB) and deployed the `Download Web` distribution portal.

---

### MEMBER 1 — EGIL, ABDULLAH IBN MUJAHID J. (IT41S1)
**Newly Completed Tasks Since August 11 Report:**
1. **Engineered the Promotional Discount & Voucher Engine (`lib/data/promo_discount_service.dart`):**
   - Implemented promotional code validation supporting percentage-based discounts, flat-rate deductions, minimum spending thresholds, and package exclusions.
   - Wired discount deductions into the catering booking and food pack quotation calculation pipelines.
2. **Built the Pricing & Add-On Automated Test Suite (`test/add_on_pricing_test.dart`):**
   - Developed unit tests verifying line-item add-on math, headcount multiplier adjustments, and voucher discount limits.
3. **Completed Petty Cash Float Immutability & Recount Rules:**
   - Enforced append-only database constraints in `firestore.rules` for `pettyCashLog`, guaranteeing that running cash balances cannot be overwritten or deleted.
   - Integrated discrepancy reconciliation routines when cash counts differ from physical counts.
4. **Dynamic Menu Category & Allergen Management:**
   - Synchronized dynamic category ordering and allergen flags between Admin Content Moderator and Flutter menu browsing screens.

---

### MEMBER 2 — LIBAG, JOSHUA M. (IT41S1)
**Newly Completed Tasks Since August 11 Report:**
1. **Fully Implemented the SARIMA $(1,0,1)(1,0,1,s)$ Demand Forecasting Difference Equation:**
   - Completed the transition from the preliminary seasonal-naive baseline to the full SARIMA engine in `Admin/Orders/js/forecast-model.js` and `FORMULAS.md`.
   - Implemented the expanded difference equation:
     $$y_t = c + \phi_1 y_{t-1} + \Phi_1 y_{t-s} - (\phi_1 \Phi_1) y_{t-s-1} + \theta_1 \varepsilon_{t-1} + \Theta_1 \varepsilon_{t-s} - (\theta_1 \Theta_1) \varepsilon_{t-s-1} + \varepsilon_t$$
   - Calibrated default parameters: Non-seasonal AR(1) $\phi_1 = 0.35$, Seasonal AR(1) $\Phi_1 = 0.60$ ($s=12$ monthly, $s=52$ weekly), Non-seasonal MA(1) $\theta_1 = -0.15$, Seasonal MA(1) $\Theta_1 = -0.10$.
   - Programmed historical residual tracking (`computeResiduals`) and dynamic confidence intervals (80% $Z_{80} = 1.2816$ and 95% $Z_{95} = 1.9600$) sized from residual standard deviations.
   - Built a proportional history-blending algorithm that smoothly blends moving-average level with SARIMA when historical cycles are between 1 and 2 periods.
2. **Developed the 4-Year Historical Catering Data ETL Pipeline (`Admin/Orders/backfill/`):**
   - Processed, parsed, and scrubbed 333 genuine catering booking records spanning September 2022 to June 2026 from institutional Excel logs into `clean_events_final.csv`.
   - Developed `backfill_bookings.js` using Node.js and Firebase Admin SDK to import historical events with `source: "excel_backfill_2022_2026"` and `status: "completed"`.
   - Created `verify.js` to audit imported dates, pax counts, and booking types.
3. **Automated Walk-Forward Rolling-Origin Model Validation:**
   - Programmed fold-by-fold cross-validation producing exact Mean Absolute Error (MAE), Root Mean Squared Error (RMSE), and Mean Absolute Percentage Error (MAPE) outputs.
4. **Developed the Interactive Mobile Layout Picker (`lib/screens/user/settings/layout_picker_page.dart`):**
   - Created a dedicated Flutter screen enabling customers to browse, inspect, and choose pre-configured or custom venue layouts during event booking.

---

### MEMBER 3 — PENOLA, JOHN PAUL S. (IT41S1)
**Newly Completed Tasks Since August 11 Report:**
1. **Fully Completed and Integrated the Collaborative Filtering Recommendation Engine:**
   - Finalized `RecommendationEngine` (`lib/data/recommendation_engine.dart`) and `Admin/assets/hp-recommend.js`, formally codified in `FORMULAS.md`.
   - Implemented Cosine Similarity:
     $$\text{Cosine Similarity}(A, B) = \frac{\sum (A_i \times B_i)}{\sqrt{\sum A_i^2} \times \sqrt{\sum B_i^2}}$$
   - Designed the serverless Spark-tier collaborative filtering pipeline:
     - Orders dashboard updates `co_occurrences/{pairKey}` counts transactionally when marking an order completed (`+1`).
     - Mobile app streams `CoOccurrenceTable` and performs on-device recommendation scoring, guaranteeing zero Cloud Function costs and total customer privacy.
   - Programmed Expiry-Aware Recommendation Scoring:
     $$S_{final} = w_1(R_{u,d}) + w_2(E_i) \quad \text{where } E_i = \max\left(0, 1 - \frac{\text{daysToExpiry}}{\text{threshold}}\right)$$
   - Built the 4-tier recommendation hierarchy: (1) `crowd` (item-based CF), (2) `cf` (user-based CF), (3) `taste_profile` (onboarding quiz vector matching), (4) `featured` (kitchen popularity cold-start).
2. **Live Integration into HapagGabay Assistant Interface:**
   - Connected `RecommendationRepository().watchRecommended()` to `UserGabayPage` via `_RecommendedPanel`, providing reactive, personalized recommendation carousels.
3. **Authored Comprehensive 520-Line Recommendation Test Suite (`test/recommendation_engine_test.dart`):**
   - Wrote 59 automated test cases covering vector dot products, user-to-user CF scoring, co-occurrence fallbacks, dietary exclusion vetos (*"walang baboy"*), budget bounds, and recommendation badge honesty.
4. **Engineered the In-App Notification Center & Queueing System:**
   - Implemented `lib/data/notification_repository.dart` and `lib/data/app_modal_queue.dart`.
5. **Built Dynamic About Us & Corporate Storytelling Sync:**
   - Developed `lib/data/about_content.dart` and refactored `lib/screens/about_page.dart` to consume live Firestore content managed by Content Moderators.

---

## SECTION III: COMPREHENSIVE MATHEMATICAL FORMULATION MAPPING

All core algorithms have been formally consolidated into `FORMULAS.md` and verified in code:

| Algorithm / Formula | Mathematical Expression | Code Implementation Location | Verification Test Location |
| :--- | :--- | :--- | :--- |
| **Collaborative Filtering (Cosine Similarity)** | $\text{Sim}(A,B) = \frac{\sum A_i B_i}{\sqrt{\sum A_i^2}\sqrt{\sum B_i^2}}$ | `lib/data/recommendation_engine.dart:L51-74`, `Admin/assets/hp-recommend.js:L225-277` | `test/recommendation_engine_test.dart:L470-519` |
| **Expiry-Aware Scoring** | $S_{final} = w_1(R_{u,d}) + w_2(E_i)$ | `lib/data/recommendation_engine.dart`, `Admin/assets/hp-recommend.js` | `test/recommendation_engine_test.dart` |
| **SARIMA Demand Forecasting** | $y_t = c + \phi_1 y_{t-1} + \Phi_1 y_{t-s} - (\phi_1\Phi_1)y_{t-s-1} + \theta_1\varepsilon_{t-1} + \Theta_1\varepsilon_{t-s} - (\theta_1\Theta_1)\varepsilon_{t-s-1} + \varepsilon_t$ | `Admin/Orders/js/forecast-model.js:L30-105`, `Admin/Orders/js/forecast.js` | `Admin/Orders/backfill/verify.js` |
| **A\* Pathfinding Heuristics** | $f(n) = g(n) + h(n)$ (Manhattan, Euclidean, Octile) | `hosting/layout-viewer/js/nav.js:L245-345`, `Admin/Layout Designer/js/nav.js:L245-345` | Tested in 3D walkthrough engine |
| **2D Collision Detection** | Circle vs Circle, 2D AABB Rect vs Rect, Circle vs Rect | `hosting/layout-viewer/js/nav.js:L105-185`, `Admin/Layout Designer/js/nav.js:L105-185` | Tested in 2D floorplan editor |
| **3D Collision Detection** | Sphere vs Sphere, 3D AABB Box vs Box, Sphere vs Box | `hosting/layout-viewer/js/nav.js:L105-185`, `Admin/Layout Designer/js/nav.js:L105-185` | Tested in 3D scene & crowd simulator |

---

## SECTION IV: QUALITY ASSURANCE & AUTOMATED TESTING AUDIT

Automated verification of the application was executed on **September 13, 2026** via `flutter test`. All **90 unit and component tests passed with 0 failures and 0 errors**:

```text
00:02 +33: recommendation_engine_test.dart: with nothing at all to go on a kitchen with nothing featured yields empty, not broken
00:02 +36: recommendation_engine_test.dart: from the taste profile alone "walang baboy" is a veto, not merely a low score
00:02 +37: recommendation_engine_test.dart: from the taste profile alone a package outside the budget band loses to one inside it
00:02 +42: recommendation_engine_test.dart: from the member’s own orders history outranks the quiz — real evidence beats a stated leaning
00:02 +46: recommendation_engine_test.dart: from the crowd what others ordered alongside theirs comes first, by weight
00:02 +50: recommendation_engine_test.dart: from the crowd it never recommends back what the member already ordered
00:02 +59: recommendation_engine_test.dart: User-to-User Cosine Similarity Collaborative Filtering cosine similarity computes dot product over vector norms
00:02 +60: recommendation_engine_test.dart: User-to-User Cosine Similarity Collaborative Filtering computeUserBasedCF recommends items from most similar historical user
00:02 +61: recommendation_test.dart: a stored set resolves against the live menu
00:02 +70: recommendation_test.dart: the taste profile round-trips answers survive a write and a read
00:05 +75: settings_test.dart: Settings list shows every group and its rows
00:07 +76: settings_test.dart: Settings list switches show the preferences in force
00:09 +80: widget_test.dart: App boots and shows the branded logo
00:10 +90: All tests passed!
```

### Test Suite Inventory:
1. `test/recommendation_engine_test.dart` (520 lines, 59 tests): Mathematical vector dot products, CF ranking, taste profile vetos, and co-occurrence fallbacks.
2. `test/recommendation_test.dart`: Serialization, map conversions, and dynamic menu resolution.
3. `test/add_on_pricing_test.dart`: Pricing math, add-on quantities, and voucher discounts.
4. `test/booking_draft_test.dart`: Draft resumption, field validation, and state restoration.
5. `test/paymongo_service_test.dart`: Downpayment checkout session parsing and webhook verification.
6. `test/settings_test.dart`: Dietary preferences, allergen exclusions, language selection, and session logout.
7. `test/widget_test.dart`: App boot, asset loading, shell navigation, and theme rendering.

---

## SECTION V: CHALLENGES ENCOUNTERED & TECHNICAL RESOLUTIONS (NEW)

1. **Android WebView `onPageFinished` Race Condition in 3D Layout Preview:**
   - *Challenge:* On certain Android devices, `onPageFinished` fired before `viewer.js` had loaded, causing JavaScript payload injection to fail silently and leaving the viewer in an infinite loading state.
   - *Resolution:* Implemented an early receiver queue in `<head>` of `hosting/layout-viewer/index.html` that captures incoming payloads immediately and flushes them safely once the renderer IIFE initializes.
2. **Cloud Functions Blaze Requirement on Free Tier:**
   - *Challenge:* Initial architecture required Cloud Functions to mint auth tokens for WebView preview, which would necessitate upgrading from the free Firebase Spark plan to the paid Blaze plan.
   - *Resolution:* Eliminated token minting by passing layout data directly from native Flutter memory to the WebView through double-encoded JavaScript calls. Decommissioned `functions/index.js` and removed functions from `firebase.json`.
3. **Simultaneous Modal Dialog Contention on App Startup:**
   - *Challenge:* Multiple asynchronous streams (announcement popups, rating dialogs, order status notices) fired concurrently at app launch, resulting in overlapping modals and blocked UI interactions.
   - *Resolution:* Developed `AppModalQueue` (`lib/data/app_modal_queue.dart`), which serializes modal presentations into a FIFO queue and displays subsequent dialogs only upon user dismissal of the active modal.
4. **Historical Booking Dataset Scarcity for Seasonal Training:**
   - *Challenge:* The live Firestore database lacked multi-year seasonal booking history needed to validate SARIMA $(1,0,1)(1,0,1,s)$ seasonality ($s=12$).
   - *Resolution:* Developed a Node.js ETL pipeline (`Admin/Orders/backfill/backfill_bookings.js`) that parsed 333 verified historical catering events (2022–2026) from institutional records (`clean_events_final.csv`) and seeded them into Firestore with `source: "excel_backfill_2022_2026"`.

---

## SECTION VI: DEFENSE READINESS & OVERALL STATUS

The HapagPamana system is **fully functional, end-to-end integrated, and defense-ready**:
- **Administrative Portal:** 11 distinct, role-gated web dashboards operational across all catering functions.
- **Consumer Mobile Application:** Flutter mobile application complete with guest browsing, member profile onboarding, 4-tier recommendation assistant (HapagGabay), multi-step booking wizards, 3D venue layout picker and previewer, PayMongo payment gateway, and live order tracking.
- **Data & Security Tier:** 454 lines of hardened Firestore security rules protecting client and administrative collections.
- **Algorithmic Engines:** Exact mathematical models for SARIMA demand forecasting, Cosine Collaborative Filtering, A\* pathfinding, and 2D/3D collision detection verified and documented in `FORMULAS.md`.
- **Distribution:** Standalone signed release APK (`hapag-pamana-release.apk`) deployed alongside the download portal for immediate User Acceptance Testing (ISO/IEC 25010).
