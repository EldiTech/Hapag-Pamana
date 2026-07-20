/* HapagPamana · Master Chef — the kitchen's prep board.
   The moment the order manager CONFIRMS an order, it appears here: the page
   streams `bookings` filtered to status == "confirmed" (onSnapshot), so the
   hand-off from the Orders dashboard is live — no refresh, no copying.

   The master chef's job on this page: open each confirmed order and plan
   the AMOUNT OF INGREDIENTS the kitchen must prepare. THE FLOW mirrors the
   kitchen's costing spreadsheet: the Recipe Book (recipes.js) holds each
   dish's ingredients for a base number of portions, and the planner
   rescales those amounts to the order's headcount — order pax for catering
   dishes, the "(N pax)" figure for food-pack menu lines — carrying the
   recipe's costing along (cost = ceil(qty × packCost ÷ packSize)). Dishes
   without a recipe fall back to hand-typed rows.

   Each plan is saved to `prepPlans/{bookingId}` as line items per dish:
     { bookingId, status: "draft"|"ready", items: [{dish, ingredient, qty,
       unit, unitCost, cost}], totalCost, clientName, functionDate, pax,
       updatedAt, updatedBy }.
   The sidebar's export builds one aggregated shopping list (CSV) across
   every planned order, summing quantities and costs per ingredient + unit.

   When the order manager marks an order completed (or declines it), it
   leaves the confirmed query — and this board — automatically.

   Reading bookings / writing prepPlans requires the master_chef (or admin)
   role — see firestore.rules. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Prep Board",
    sub: "Every confirmed order, waiting on its ingredient plan.",
    search: true,
    action: null,
  });

  const statsEl = document.getElementById("chefStats");
  const segEl = document.getElementById("planSeg");
  const chipsEl = document.getElementById("typeChips");
  const rowsEl = document.getElementById("orderRows");

  const db = HP.ONLINE ? firebase.firestore() : null;

  let orders = [];          // confirmed bookings [{ id, ...booking }]
  let plans = new Map();    // bookingId → prep plan doc
  let recipes = new Map();  // dish name (lowercased) → recipe doc
  let query = "";
  let planFilter = "all";   // all | unplanned | draft | ready
  let typeFilter = "all";
  let loadedOrders = false;
  let loadedPlans = false;
  let unsubOrders = null;
  let planUnsubs = [];     // one listener per 10-id chunk of confirmed orders
  let planIdsSig = null;   // signature of the id set the listeners cover
  let unsubRecipes = null;

  // Skeletons while auth + the first snapshots run.
  statsEl.innerHTML = HP.skel.stats(4);
  rowsEl.innerHTML = HP.skel.rows(6, 7);

  HP.shell.onSearch((q) => { query = q; renderRows(); });
  HP.shell.onExport(exportShoppingList);
  HP.ready.then(boot);

  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      segEl.innerHTML = ""; chipsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(
        "Confirmed orders live in Firestore — connect Firebase to plan them.");
      return;
    }
    const denied = (e) => e && (e.code === "permission-denied" ||
      /permission|insufficient/i.test(e.message || ""));
    const fail = (e, what) => {
      console.error(`HapagPamana: couldn't load ${what} —`, e);
      statsEl.innerHTML = "";
      rowsEl.innerHTML = emptyRow(denied(e)
        ? "Access denied — publish the updated Firestore rules (master-chef access to bookings and prepPlans), then reload."
        : "Couldn't reach the database. Check your connection and reload.");
      if (denied(e)) HP.toast("Database access denied — update your Firestore rules.", "danger");
    };

    // Live stream #1 — the confirmed orders, straight from the Orders
    // dashboard's accept button.
    unsubOrders = db.collection("bookings").where("status", "==", "confirmed")
      .onSnapshot((snap) => {
        orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .filter((o) => !o.deleted); // trashed bookings never reach the board
        // Soonest event first; undated requests sink to the bottom. The
        // sentinel is MAX_SAFE_INTEGER, not Infinity — two undated orders
        // would compare as Infinity - Infinity = NaN and corrupt the sort.
        const FAR = Number.MAX_SAFE_INTEGER;
        orders.sort((a, b) => (eventMs(a) || FAR) - (eventMs(b) || FAR));
        loadedOrders = true;
        renderAll();
        // Live stream #2 follows: plans are watched ONLY for the bookings on
        // the board, so the listeners are rebuilt when the id set changes.
        const sig = orders.map((o) => o.id).sort().join("|");
        if (sig !== planIdsSig) { planIdsSig = sig; subscribePlans(); }
      }, (e) => fail(e, "the confirmed orders"));

    /* Live stream #2 — the kitchen's ingredient plans, scoped to the
       currently confirmed booking ids (Orders deletes a plan when its
       booking completes or is declined, so nothing else should exist —
       but scoping also keeps any stragglers from being re-read forever).
       Firestore `in` takes at most 10 values, so the ids are chunked into
       one listener each; the board paints once every chunk has answered. */
    function subscribePlans() {
      planUnsubs.forEach((u) => u());
      planUnsubs = [];
      const ids = orders.map((o) => o.id);
      if (!ids.length) {
        plans = new Map();
        loadedPlans = true;
        renderAll();
        return;
      }
      const chunks = [];
      for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
      const byChunk = new Map(); // chunk index → [id, plan] pairs
      planUnsubs = chunks.map((chunk, ci) =>
        db.collection("prepPlans")
          .where(firebase.firestore.FieldPath.documentId(), "in", chunk)
          .onSnapshot((snap) => {
            byChunk.set(ci, snap.docs.map((d) => [d.id, d.data()]));
            if (byChunk.size < chunks.length) return; // first paint waits for all
            const merged = new Map();
            byChunk.forEach((rows) => rows.forEach(([k, v]) => merged.set(k, v)));
            plans = merged;
            loadedPlans = true;
            renderAll();
          }, (e) => fail(e, "the ingredient plans")));
    }

    // Live stream #3 — the Recipe Book, so plans open pre-scaled. A hiccup
    // here never blocks the board: the planner just falls back to
    // hand-typed amounts.
    unsubRecipes = db.collection("recipes")
      .onSnapshot((snap) => {
        recipes = new Map();
        snap.docs.forEach((d) => {
          const r = { id: d.id, ...d.data() };
          const k = dishKey(r.name);
          if (k) recipes.set(k, r);
        });
      }, (e) => console.warn("HapagPamana: couldn't load the recipes —", e));
  }
  window.addEventListener("beforeunload", () => {
    if (unsubOrders) unsubOrders();
    planUnsubs.forEach((u) => u());
    if (unsubRecipes) unsubRecipes();
  });

  /* ── Kitchen vocabulary ───────────────────────────────────────────────── */
  const val = (o, k) => String(o[k] || "").trim();
  const typeOf = (o) => (String(o.bookingType || "").toLowerCase() === "food pack" ? "Food Pack" : "Catering");
  const clientName = (o) => val(o, "clientName") || "Unnamed client";

  // Same course keys the booking wizard writes (one dish per course).
  const COURSES = [
    ["appetizer", "Appetizer"],
    ["soup", "Soup"],
    ["salad", "Salad"],
    ["rice", "Rice"],
    ["pastaNoodles", "Pasta / Noodles"],
    ["beef", "Beef"],
    ["pork", "Pork"],
    ["chicken", "Chicken"],
    ["seafood", "Seafood"],
    ["vegetables", "Vegetables"],
    ["desserts", "Desserts"],
    ["drinks", "Drinks"],
  ];

  const PLAN_STATES = ["unplanned", "draft", "ready"];
  const PLAN_META = {
    unplanned: { label: "No plan yet", badge: "badge-warn" },
    draft:     { label: "Draft",       badge: "badge-cat" },
    ready:     { label: "Ready",       badge: "badge-ok" },
  };
  function planStateOf(o) {
    const p = plans.get(o.id);
    if (!p) return "unplanned";
    return p.status === "ready" ? "ready" : "draft";
  }

  // The dishes on an order: catering fills one dish per course; food packs
  // write `menu` lines shaped "Dish name (N pax)" (or free text).
  function dishesOf(o) {
    if (typeOf(o) === "Food Pack") {
      return String(o.menu || "").split("\n").map((s) => s.trim()).filter(Boolean)
        .map((line) => {
          const m = line.match(/^(.*?)\s*\((\d+)\s*pax\)$/i);
          return { name: (m ? m[1] : line).trim(), course: "Menu", pax: m ? `${m[2]} pax` : "" };
        });
    }
    return COURSES
      .map(([k, label]) => ({ name: val(o, k), course: label, pax: "" }))
      .filter((d) => d.name);
  }

  /* ── Small helpers ────────────────────────────────────────────────────── */
  const ts = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);

  // The wizard writes functionDate spelled out ("June 12, 2026") — parseable
  // directly. Free-typed dates that don't parse just aren't schedulable.
  function eventMs(o) {
    const t = Date.parse(String(o.functionDate || ""));
    return Number.isFinite(t) ? t : 0;
  }
  function daysUntil(o) {
    const ms = eventMs(o);
    if (!ms) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((ms - today.getTime()) / 86400000);
  }
  function dueLabel(o) {
    const d = daysUntil(o);
    if (d === null) return "";
    if (d < 0) return d === -1 ? "yesterday" : `${-d} days ago`;
    if (d === 0) return "today";
    if (d === 1) return "tomorrow";
    return `in ${d} days`;
  }

  function emptyRow(msg) {
    return `<tr><td colspan="7" class="table-empty">${HP.esc(msg)}</td></tr>`;
  }

  function typeBadge(o) {
    const t = typeOf(o);
    return `<span class="badge badge-cat order-type order-type--${t === "Food Pack" ? "pack" : "catering"}">
      <span class="ic">${HP.icon(t === "Food Pack" ? "box" : "party")}</span>${t}</span>`;
  }
  function planBadge(o) {
    const m = PLAN_META[planStateOf(o)];
    return `<span class="badge ${m.badge}"><span class="dot"></span>${m.label}</span>`;
  }

  function menuSummary(o) {
    const dishes = dishesOf(o);
    if (!dishes.length) return "No dishes listed";
    return dishes[0].name + (dishes.length > 1 ? ` +${dishes.length - 1} more` : "");
  }

  /* ── Dish photos (same lazy lookup as the Orders sheet) ──────────────────
     The wizards store exact product names, so each dish is looked up in
     `products` (public read) — fetched per planner, never the whole menu,
     and remembered for the session ("" = looked up, no photo). */
  const dishCache = new Map();
  const { dishKey, safeImage, peso } = window.HPChef; // shared kitchen helpers

  async function hydrateDishPhotos() {
    if (!db) return;
    const root = document.querySelector(".plan-sheet");
    if (!root) return;
    const names = [...new Set(
      [...root.querySelectorAll(".plan-sec[data-dish]")]
        .filter((sec) => sec.querySelector(".dish-thumb:not(.dish-thumb--gen)"))
        .map((sec) => sec.dataset.dish),
    )].filter((n) => n && !dishCache.has(dishKey(n)));
    if (!names.length) { paintDishPhotos(); return; }

    // Firestore `in` takes at most 10 values per query — chunk the lookups.
    const chunks = [];
    for (let i = 0; i < names.length; i += 10) chunks.push(names.slice(i, i + 10));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const snap = await db.collection("products").where("name", "in", chunk).get();
        snap.forEach((doc) => {
          const d = doc.data() || {};
          dishCache.set(dishKey(d.name), safeImage(d.image));
        });
      } catch (e) {
        console.warn("HapagPamana: couldn't fetch the dish photos —", e);
      }
      chunk.forEach((n) => { if (!dishCache.has(dishKey(n))) dishCache.set(dishKey(n), ""); });
    }));
    paintDishPhotos();
  }

  function paintDishPhotos() {
    document.querySelectorAll(".plan-sheet .plan-sec[data-dish]").forEach((sec) => {
      const img = dishCache.get(dishKey(sec.dataset.dish));
      const thumb = sec.querySelector(".dish-thumb:not(.dish-thumb--gen)");
      if (!img || !thumb || thumb.classList.contains("has-img")) return;
      thumb.textContent = "";
      const tag = document.createElement("img");
      tag.src = img;
      tag.alt = "";
      tag.loading = "lazy";
      thumb.appendChild(tag);
      thumb.classList.add("has-img");
    });
  }

  /* ── Rendering ────────────────────────────────────────────────────────── */
  function renderAll() {
    if (!loadedOrders || !loadedPlans) return;
    renderStats(); renderSeg(); renderChips(); renderRows();
  }

  function renderStats() {
    const byState = (s) => orders.filter((o) => planStateOf(o) === s).length;
    const week = orders.filter((o) => {
      const d = daysUntil(o);
      return d !== null && d >= 0 && d <= 7;
    }).length;
    const guests = orders.reduce((sum, o) => {
      const n = parseInt(val(o, "pax"), 10);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    // The nav badge nags until every confirmed order's plan is ready.
    HP.shell.setBadge(byState("unplanned") + byState("draft"));

    const stat = (ic, num, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num" data-count="${num}">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    if (HP.shell.paint(statsEl,
      stat("basket", byState("unplanned"), "To plan") +
      stat("check", byState("ready"), "Plans ready") +
      stat("calendar", week, "Events this week") +
      stat("users", guests, "Guests to feed"))) HP.countUp(statsEl);
  }

  function renderSeg() {
    const count = (s) => (s === "all" ? orders.length : orders.filter((o) => planStateOf(o) === s).length);
    const label = { all: "All", unplanned: "To plan", draft: "Drafts", ready: "Ready" };
    segEl.innerHTML = ["all", ...PLAN_STATES].map((s) => `
      <button class="seg-btn${planFilter === s ? " active" : ""}" data-plan="${s}">
        ${label[s]}
        <span class="seg-count">${count(s)}</span>
      </button>`).join("");
    segEl.querySelectorAll("[data-plan]").forEach((b) =>
      b.addEventListener("click", () => {
        planFilter = b.dataset.plan;
        segEl.classList.add("anim");
        renderSeg(); renderRows();
      }));
  }

  function renderChips() {
    const types = [["all", "All types"], ["Catering", "Catering"], ["Food Pack", "Food Packs"]];
    chipsEl.innerHTML = types.map(([v, label]) =>
      `<button class="chip-filter${typeFilter === v ? " active" : ""}" data-type="${v}">${label}</button>`).join("");
    chipsEl.querySelectorAll("[data-type]").forEach((b) =>
      b.addEventListener("click", () => {
        typeFilter = b.dataset.type;
        renderChips(); renderRows();
      }));
  }

  function matches(o) {
    if (planFilter !== "all" && planStateOf(o) !== planFilter) return false;
    if (typeFilter !== "all" && typeOf(o) !== typeFilter) return false;
    if (!query) return true;
    const dishNames = dishesOf(o).map((d) => d.name).join(" ");
    return [o.clientName, o.kindOfFunction, o.venue, o.package, o.menu, dishNames]
      .some((v) => String(v || "").toLowerCase().includes(query));
  }

  // Event-day progress under the plan badge ("2/5 prepped").
  function doneNote(o) {
    const plan = plans.get(o.id);
    const done = plan && Array.isArray(plan.doneDishes) ? plan.doneDishes.length : 0;
    if (!done) return "";
    const total = Math.max(done, dishesOf(o).length);
    return `<small class="plan-done-note">${done}/${total} prepped</small>`;
  }

  function renderRows() {
    if (!loadedOrders || !loadedPlans) return;
    const list = orders.filter(matches);
    if (!list.length) {
      rowsEl.innerHTML = emptyRow(orders.length
        ? "No orders match your filters."
        : "No confirmed orders yet — the moment the order manager accepts one, it lands here for ingredient planning.");
      return;
    }
    HP.shell.paint(rowsEl, list.map((o) => {
      const d = daysUntil(o);
      const overdue = d !== null && d < 0;
      return `
      <tr data-id="${HP.esc(o.id)}" class="chef-row">
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(val(o, "functionDate") || "—")}</strong>
            <small${overdue ? ` class="due-past"` : ""}>${HP.esc(dueLabel(o) || "no date parsed")}</small>
          </div></div>
        </td>
        <td>
          <div class="cell-name"><div>
            <strong>${HP.esc(clientName(o))}</strong>
            <small>${HP.esc(val(o, "kindOfFunction") || val(o, "venue") || "—")}</small>
          </div></div>
        </td>
        <td>${typeBadge(o)}</td>
        <td>
          <div class="cell-name"><div>
            <strong class="chef-menu">${HP.esc(menuSummary(o))}</strong>
          </div></div>
        </td>
        <td>${HP.esc(val(o, "pax") || "—")}</td>
        <td>${planBadge(o)}${doneNote(o)}</td>
        <td>
          <div class="row-actions">
            <button class="icon-btn" data-act="plan" title="Plan the ingredients" aria-label="Plan ingredients for ${HP.esc(clientName(o))}'s order"><span class="ic">${HP.icon("pencil")}</span></button>
          </div>
        </td>
      </tr>`;
    }).join(""));

    rowsEl.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const o = orders.find((x) => x.id === e.currentTarget.closest("tr").dataset.id);
      if (o) openPlanner(o);
    }));
    // The whole row opens the planner (buttons handle their own clicks).
    rowsEl.querySelectorAll("tr[data-id]").forEach((tr) =>
      tr.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        const o = orders.find((x) => x.id === tr.dataset.id);
        if (o) openPlanner(o);
      }));
  }

  /* ── The ingredient planner (detail modal) ────────────────────────────── */
  const GENERAL = "Whole event";
  // Blank planner rows default to kg — bulk market amounts.
  const unitOptions = (selected) => window.HPChef.unitOptions(selected, "kg");

  /* Recipe scaling — the costing sheet's flow. A recipe holds the amounts
     for its base `portions`; the planner rescales them to this order's
     servings and carries the per-unit price along so costs stay live while
     the chef fine-tunes quantities. */
  const recipeFor = (dish) => recipes.get(dishKey(dish)) || null;

  function servingsFor(o, dishPax) {
    const m = String(dishPax || "").match(/\d+/); // food packs: "(60 pax)"
    if (m) return parseInt(m[0], 10);
    const n = parseInt(val(o, "pax"), 10);        // catering: the order's pax
    return Number.isFinite(n) ? n : null;
  }
  // Round to 3 significant digits (whole numbers from 100 up) — a tiny
  // scaled amount (5 g of spice ÷ a large batch) must survive the rounding,
  // not vanish to zero.
  function scaleQty(q, k) {
    const v = (Number(q) || 0) * k;
    if (!(v > 0)) return null;
    return v >= 100 ? Math.round(v) : Number(v.toPrecision(3));
  }
  const unitCostOf = (i) => {
    const pc = Number(i.packCost), ps = Number(i.packSize);
    return pc > 0 && ps > 0 ? pc / ps : null;
  };

  function scaledItems(recipe, servings) {
    const base = Number(recipe.portions) || 0;
    const k = servings && base > 0 ? servings / base : 1;
    return (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
      .filter((i) => String(i.name || "").trim())
      .map((i) => {
        const qty = scaleQty(i.qty, k);
        const uc = unitCostOf(i);
        return {
          ingredient: i.name, qty, unit: i.unit || "g", unitCost: uc,
          cost: uc && qty ? Math.ceil(qty * uc) : null,
        };
      });
  }

  function rowHTML(it) {
    it = it || {};
    const qty = (it.qty === 0 || it.qty) ? String(it.qty) : "";
    // The per-unit price rides on the row so edits re-cost instantly. It
    // comes from the saved line or the recipe's packCost/packSize — never
    // back-derived from a stored cost (ceil-rounded costs derive a wrong
    // unit price that then re-costs every edit wrongly).
    let uc = Number(it.unitCost);
    if (!(uc > 0)) uc = unitCostOf(it);
    const cost = Number(it.cost) > 0 ? Number(it.cost)
      : (uc > 0 && Number(qty) > 0 ? Math.ceil(Number(qty) * uc) : null);
    return window.HPChef.ingRow(`class="ing-row ing-row--costed" data-unitcost="${uc > 0 ? uc : ""}"`, `
      <input class="control ing-name" placeholder="Ingredient — e.g. pork belly" value="${HP.esc(it.ingredient || "")}" />
      <input class="control ing-qty" type="number" min="0" step="any" placeholder="Qty" value="${HP.esc(qty)}" />
      <select class="control ing-unit" aria-label="Unit">${unitOptions(it.unit)}</select>
      <span class="ing-cost" title="Estimated cost">${HP.esc(peso(cost))}</span>`);
  }

  function sectionHTML(dish, course, pax, items, opts) {
    opts = opts || {};
    const thumb = opts.general
      ? `<span class="dish-thumb dish-thumb--gen"><span class="ic">${HP.icon("basket")}</span></span>`
      : `<span class="dish-thumb">${HP.esc((dish.charAt(0) || "·").toUpperCase())}</span>`;
    const rows = (items && items.length ? items.map(rowHTML) : [rowHTML()]).join("");
    return `<section class="plan-sec" data-dish="${HP.esc(dish)}">
      <div class="plan-sec-head">
        ${thumb}
        <div class="plan-sec-txt"><small>${HP.esc(course)}</small><strong>${HP.esc(dish)}</strong></div>
        ${pax ? `<span class="dish-pax">${HP.esc(pax)}</span>` : ""}
        ${opts.canReload ? `<button type="button" class="btn btn-ghost add-ing plan-reload" data-reload title="Replace these rows with the recipe, rescaled to this order"><span class="ic">${HP.icon("undo")}</span>Rescale</button>` : ""}
        ${opts.checkoff ? `
        <label class="switch plan-done" title="Event day: mark this dish prepped">
          <input type="checkbox" class="dish-done" data-dish="${HP.esc(dish)}" ${opts.done ? "checked" : ""}>
          <span class="track"></span><span class="switch-label">Prepped</span>
        </label>` : ""}
      </div>
      ${opts.note ? `<p class="plan-recipe-note${opts.noteWarn ? " plan-recipe-note--none" : ""}">${opts.note}</p>` : ""}
      <div class="ing-rows">${rows}</div>
      <button type="button" class="btn btn-ghost add-ing" data-add><span class="ic">${HP.icon("plus")}</span>Add ingredient</button>
    </section>`;
  }

  function plannerFoot(state) {
    const print = `<button class="btn btn-ghost" id="plPrint" title="Print this plan sheet"><span class="ic">${HP.icon("printer")}</span>Print</button>`;
    if (state === "ready") return `${print}
      <button class="btn btn-ghost" id="plDraft"><span class="ic">${HP.icon("undo")}</span>Back to draft</button>
      <button class="btn btn-primary" id="plReady"><span class="ic">${HP.icon("check")}</span>Save changes</button>`;
    return `${print}
      <button class="btn btn-ghost" id="plDraft"><span class="ic">${HP.icon("pencil")}</span>Save as draft</button>
      <button class="btn btn-primary" id="plReady"><span class="ic">${HP.icon("check")}</span>Save &amp; mark ready</button>`;
  }

  function openPlanner(o) {
    const plan = plans.get(o.id) || null;
    const state = planStateOf(o);
    const dishes = dishesOf(o);
    // Event-day check-off state: which dishes are already prepped.
    const doneSet = new Set(plan && Array.isArray(plan.doneDishes) ? plan.doneDishes : []);

    // Existing line items grouped per dish; items whose dish no longer sits
    // on the order (the menu changed) keep their own section — never lost.
    const byDish = new Map();
    (plan && Array.isArray(plan.items) ? plan.items : []).forEach((it) => {
      const d = String(it.dish || GENERAL);
      if (!byDish.has(d)) byDish.set(d, []);
      byDish.get(d).push(it);
    });
    const known = new Set([GENERAL, ...dishes.map((d) => d.name)]);
    const orphans = [...byDish.keys()].filter((d) => !known.has(d));

    // A dish with a recipe opens pre-scaled to this order's servings; a
    // saved plan keeps its saved amounts (“Rescale” re-applies the recipe).
    const dishSection = (d) => {
      const recipe = recipeFor(d.name);
      const saved = byDish.get(d.name) || [];
      const servings = servingsFor(o, d.pax);
      if (!recipe) {
        return sectionHTML(d.name, d.course, d.pax, saved, {
          note: HP.esc("No recipe in the book for this dish yet — amounts here are by hand. Write the recipe and this fills itself."),
          noteWarn: true,
          checkoff: true, done: doneSet.has(d.name),
        });
      }
      const base = Number(recipe.portions) || 0;
      const k = servings && base > 0 ? Math.round((servings / base) * 100) / 100 : 1;
      const items = saved.length ? saved : scaledItems(recipe, servings);
      return sectionHTML(d.name, d.course, d.pax, items, {
        canReload: true,
        note: HP.esc(saved.length
          ? `Saved amounts — “Rescale” re-applies the recipe ×${k} (${base} portions → ${servings || "?"} pax).`
          : `Recipe ×${k} — ${base} portions rescaled to ${servings || "?"} pax.`),
        checkoff: true, done: doneSet.has(d.name),
      });
    };

    const ctx = (ic, txt) => (txt ? `<span class="plan-fact"><span class="ic">${HP.icon(ic)}</span>${HP.esc(txt)}</span>` : "");
    const due = dueLabel(o);
    const m = PLAN_META[state];
    HP.openModal(`Ingredient plan — ${clientName(o)}`, `
      <div class="plan-sheet">
        <div class="plan-sheet-head">
          ${typeBadge(o)}
          <span class="badge ${m.badge}"><span class="dot"></span>${m.label}</span>
          <div class="plan-facts">
            ${ctx("calendar", val(o, "functionDate") + (due ? ` (${due})` : ""))}
            ${ctx("users", val(o, "pax") && `${val(o, "pax")} pax`)}
            ${ctx("party", val(o, "kindOfFunction"))}
            ${ctx("dish", val(o, "package"))}
          </div>
        </div>
        <p class="plan-hint">Amounts come from the Recipe Book, rescaled to this order —
          fine-tune them per dish, and add anything shared under “${GENERAL}”.</p>
        ${dishes.map(dishSection).join("")}
        ${orphans.map((d) => sectionHTML(d, "From an earlier menu", "", byDish.get(d), { checkoff: true, done: doneSet.has(d) })).join("")}
        ${sectionHTML(GENERAL, "Pantry, extras & everything shared", "", byDish.get(GENERAL) || [], { general: true })}
        <div class="plan-total">Estimated ingredient cost <strong id="planTotal">—</strong></div>
      </div>`,
      plannerFoot(state));

    // Fill in the dish photos as the product lookups land.
    hydrateDishPhotos();

    const sheet = document.querySelector(".plan-sheet");

    // Live costing: each row's ₱ cell follows its qty × per-unit price.
    const updateRowCost = (row) => {
      const uc = parseFloat(row.dataset.unitcost);
      const q = parseFloat(row.querySelector(".ing-qty").value);
      row.querySelector(".ing-cost").textContent =
        peso(uc > 0 && q > 0 ? Math.ceil(q * uc) : null);
    };
    const updateTotal = () => {
      let t = 0;
      sheet.querySelectorAll(".ing-row").forEach((row) => {
        const uc = parseFloat(row.dataset.unitcost);
        const q = parseFloat(row.querySelector(".ing-qty").value);
        if (uc > 0 && q > 0) t += Math.ceil(q * uc);
      });
      document.getElementById("planTotal").textContent = t ? peso(t) : "—";
    };
    updateTotal();

    sheet.addEventListener("input", (e) => {
      if (!e.target.classList.contains("ing-qty")) return;
      updateRowCost(e.target.closest(".ing-row"));
      updateTotal();
    });

    // Row add/remove + recipe rescale, delegated on the sheet (fresh per
    // open — no stacking).
    sheet.addEventListener("click", (e) => {
      const add = e.target.closest("[data-add]");
      if (add) {
        const rows = add.closest(".plan-sec").querySelector(".ing-rows");
        rows.insertAdjacentHTML("beforeend", rowHTML());
        rows.lastElementChild.querySelector(".ing-name").focus();
        return;
      }
      const rel = e.target.closest("[data-reload]");
      if (rel) {
        const sec = rel.closest(".plan-sec");
        const recipe = recipeFor(sec.dataset.dish);
        if (recipe) {
          const d = dishes.find((x) => x.name === sec.dataset.dish);
          sec.querySelector(".ing-rows").innerHTML =
            scaledItems(recipe, servingsFor(o, d ? d.pax : "")).map(rowHTML).join("");
          updateTotal();
        }
        return;
      }
      const del = e.target.closest(".ing-del");
      if (del) { del.closest(".ing-row").remove(); updateTotal(); }
    });

    const wire = (id, fn) => {
      const b = document.getElementById(id);
      if (b) b.addEventListener("click", fn);
    };
    // Conflict context for this open of the sheet: the plan's updatedAt as
    // painted, plus a force flag set once the chef has been warned that
    // another session saved meanwhile.
    const saveCtx = { openedAt: ts(plan && plan.updatedAt), force: false };
    wire("plDraft", () => savePlan(o, "draft", saveCtx));
    wire("plReady", () => savePlan(o, "ready", saveCtx));
    wire("plPrint", HP.printModal);

    // Event-day check-off — each flip saves immediately, without waiting on
    // a full plan save.
    sheet.addEventListener("change", (e) => {
      const box = e.target.closest(".dish-done");
      if (!box) return;
      setDishDone(o, box.dataset.dish, box.checked, saveCtx, box);
    });
  }

  /* Persist one dish's prepped state onto the plan doc. Re-reads the fresh
     updatedAt into the open sheet's conflict context so the chef's own
     check-offs never trip the overwrite warning. */
  async function setDishDone(o, dish, done, ctx, box) {
    const ref = db.collection("prepPlans").doc(o.id);
    try {
      await ref.set({
        bookingId: o.id,
        doneDishes: done
          ? firebase.firestore.FieldValue.arrayUnion(dish)
          : firebase.firestore.FieldValue.arrayRemove(dish),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: HP.FB && HP.FB.auth.currentUser ? HP.FB.auth.currentUser.uid : null,
      }, { merge: true });
      if (ctx) {
        const now = await ref.get();
        ctx.openedAt = ts(now.exists ? now.data().updatedAt : null);
      }
    } catch (e) {
      console.error(e);
      if (box) box.checked = !done; // the flip didn't save — put it back
      HP.toast("Couldn't save the check-off — check the Firestore rules.", "danger");
    }
  }

  function collectItems() {
    const items = [];
    document.querySelectorAll(".plan-sheet .plan-sec").forEach((sec) => {
      const dish = sec.dataset.dish;
      sec.querySelectorAll(".ing-row").forEach((r) => {
        const name = r.querySelector(".ing-name").value.trim();
        if (!name) return; // blank rows are just unused paper
        const raw = parseFloat(r.querySelector(".ing-qty").value);
        // Negative amounts can't be shopped for — clamp to zero.
        const q = Number.isFinite(raw) ? Math.max(0, raw) : null;
        const uc = parseFloat(r.dataset.unitcost);
        items.push({
          dish,
          ingredient: name,
          qty: q,
          unit: r.querySelector(".ing-unit").value,
          unitCost: uc > 0 ? uc : null,
          cost: uc > 0 && q > 0 ? Math.ceil(q * uc) : null,
        });
      });
    });
    return items;
  }

  // A visible warning inside the open plan sheet — the next save overwrites.
  function warnPlanConflict() {
    const sheet = document.querySelector(".plan-sheet");
    if (sheet && !document.getElementById("planConflict")) {
      sheet.insertAdjacentHTML("beforeend",
        `<p class="plan-recipe-note plan-recipe-note--none" id="planConflict">Someone else saved this plan while you had it open — saving again overwrites their version.</p>`);
    }
    const note = document.getElementById("planConflict");
    if (note) note.scrollIntoView({ block: "nearest" });
    HP.toast("This plan changed in another session — save again to overwrite.", "warn");
  }

  let planSaving = false;
  async function savePlan(o, status, ctx) {
    if (planSaving) return; // double-click — the first save is still in flight
    planSaving = true;
    const btns = ["plDraft", "plReady"].map((id) => document.getElementById(id)).filter(Boolean);
    btns.forEach((b) => { b.disabled = true; });
    const items = collectItems();
    try {
      const ref = db.collection("prepPlans").doc(o.id);
      // Another chef may have saved this plan while the sheet was open —
      // warn once instead of silently clobbering their work.
      if (ctx && !ctx.force) {
        const now = await ref.get();
        const stamp = ts(now.exists ? now.data().updatedAt : null);
        if (stamp > ctx.openedAt) { ctx.force = true; warnPlanConflict(); return; }
      }
      if (!items.length) {
        // An empty plan isn't a plan — clear the record entirely.
        await ref.delete();
        HP.toast(`${clientName(o)}'s plan was cleared — back to “no plan yet”.`, "warn");
      } else {
        const totalCost = items.reduce((s, i) => s + (i.cost || 0), 0);
        await ref.set({
          bookingId: o.id,
          status,
          items,
          // Carried from the sheet's switches — a full-doc set() would
          // otherwise wipe the event-day check-offs.
          doneDishes: [...document.querySelectorAll(".plan-sheet .dish-done:checked")].map((b) => b.dataset.dish),
          totalCost: totalCost || null,
          // Denormalised so the shopping list reads without a second lookup.
          clientName: clientName(o),
          functionDate: val(o, "functionDate"),
          pax: val(o, "pax"),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: (HP.FB && HP.FB.auth.currentUser) ? HP.FB.auth.currentUser.uid : null,
        });
        HP.toast(status === "ready"
          ? `${clientName(o)}'s ingredient plan is marked ready.`
          : `${clientName(o)}'s ingredient plan is saved as a draft.`);
      }
      HP.closeModal();
    } catch (e) {
      console.error(e);
      HP.toast("Couldn't save the plan — check the Firestore rules.", "danger");
    } finally {
      planSaving = false;
      btns.forEach((b) => { b.disabled = false; });
    }
  }

  /* ── Shopping list (CSV export) ───────────────────────────────────────────
     One aggregated market list across the planned, still-confirmed orders in
     the chosen window: quantities summed per ingredient + unit, with the
     events each line serves and how many recipe packs cover the total. */

  // Canonical units for aggregation: grams roll up to kg and mL to L, so
  // "2 kg" on one plan and "500 g" on another merge into one 2.5 kg line.
  function normalizeQty(qty, unit) {
    const u = String(unit || "").trim();
    const l = u.toLowerCase();
    if (l === "g")  return { qty: qty / 1000, unit: "kg" };
    if (l === "ml") return { qty: qty / 1000, unit: "L" };
    if (l === "kg") return { qty, unit: "kg" };
    if (l === "l")  return { qty, unit: "L" };
    return { qty, unit: u };
  }

  // The pack size behind a plan line, normalized to the same canonical unit:
  // the recipe for its dish carries packSize per ingredient.
  function packSizeFor(it) {
    const recipe = recipeFor(it.dish);
    if (!recipe || !Array.isArray(recipe.ingredients)) return null;
    const ing = recipe.ingredients.find((i) =>
      dishKey(i.name) === dishKey(it.ingredient));
    if (!ing || !(Number(ing.packSize) > 0)) return null;
    const norm = normalizeQty(Number(ing.packSize), ing.unit);
    const itNorm = normalizeQty(0, it.unit);
    return norm.unit === itNorm.unit ? norm.qty : null; // incompatible units — no pack math
  }

  // The sidebar button opens a small scope sheet first: which events the
  // market run covers, and whether drafts count.
  function exportShoppingList() {
    HP.openModal("Shopping list", `
      <form id="shopForm" novalidate>
        <div class="field"><label>Events within</label>
          <select class="control" name="range">
            <option value="7" selected>Next 7 days</option>
            <option value="14">Next 14 days</option>
            <option value="30">Next 30 days</option>
            <option value="all">All confirmed orders</option>
          </select>
          <div class="field-hint">Undated orders are always included — there's no telling they're out of range.</div></div>
        <label class="switch">
          <input type="checkbox" name="readyOnly">
          <span class="track"></span>
          <span class="switch-label">Ready plans only (leave drafts out)</span>
        </label>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-ghost" id="shopPrint"><span class="ic">${HP.icon("printer")}</span>Print view</button>
       <button class="btn btn-primary" id="shopGo"><span class="ic">${HP.icon("download")}</span>Export CSV</button>`);
    const f = document.getElementById("shopForm");
    document.getElementById("shopGo").addEventListener("click", () => {
      const ok = buildShoppingList(f.range.value, f.readyOnly.checked);
      if (ok) HP.closeModal();
    });
    document.getElementById("shopPrint").addEventListener("click", () => {
      showShoppingPrint(f.range.value, f.readyOnly.checked); // replaces this modal
    });
  }

  // The aggregation both outputs share. Null (with a toast) when the chosen
  // scope holds nothing.
  function collectShopping(range, readyOnly) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = range === "all" ? null : today.getTime() + Number(range) * 864e5;
    const inScope = (o) => {
      const t = eventMs(o);
      if (!t) return true;               // undated — always included
      if (range === "all") return true;
      return t >= today.getTime() && t < end;
    };

    const agg = new Map(); // "ingredient|unit" → { ingredient, unit, qty, hasQty, cost, packSize, events }
    orders.filter(inScope).forEach((o) => {
      const plan = plans.get(o.id);
      if (!plan || !Array.isArray(plan.items)) return;
      if (readyOnly && plan.status !== "ready") return;
      plan.items.forEach((it) => {
        const name = String(it.ingredient || "").trim();
        if (!name) return;
        const rawQ = Number(it.qty);
        const norm = normalizeQty(Number.isFinite(rawQ) ? rawQ : 0, it.unit);
        const key = `${name.toLowerCase()}|${norm.unit.toLowerCase()}`;
        const cur = agg.get(key) ||
          { ingredient: name, unit: norm.unit, qty: 0, hasQty: false, cost: 0, packSize: null, events: new Set() };
        if (Number.isFinite(rawQ)) { cur.qty += norm.qty; cur.hasQty = true; }
        cur.cost += Number(it.cost) || 0;
        if (!(cur.packSize > 0)) cur.packSize = packSizeFor(it);
        cur.events.add(`${clientName(o)} — ${val(o, "functionDate") || "undated"}`);
        agg.set(key, cur);
      });
    });
    if (!agg.size) {
      HP.toast("No ingredient plans in that scope — widen the range or include drafts.", "warn");
      return null;
    }
    return [...agg.values()].sort((a, b) => a.ingredient.localeCompare(b.ingredient));
  }

  const round2 = (n) => Math.round(n * 100) / 100;

  function buildShoppingList(range, readyOnly) {
    const rows = collectShopping(range, readyOnly);
    if (!rows) return false;
    const cell = HP.csvCell; // formula-safe, quote-doubled (hp-core.js)
    const csv = [["Ingredient", "Quantity", "Unit", "Buy (packs)", "Est. cost (PHP)", "For events"].map(cell).join(",")]
      .concat(rows.map((r) => [
        r.ingredient,
        r.hasQty ? round2(r.qty) : "",
        r.unit,
        r.hasQty && r.packSize > 0 ? Math.ceil(r.qty / r.packSize) : "",
        r.cost || "",
        [...r.events].join("; "),
      ].map(cell).join(",")))
      .join("\r\n");
    // BOM so Excel opens the UTF-8 file with ₱ and accents intact.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_shopping_list.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    HP.toast("Shopping list exported as CSV.");
    return true;
  }

  // On-screen (and printable) version of the same list.
  function showShoppingPrint(range, readyOnly) {
    const rows = collectShopping(range, readyOnly);
    if (!rows) return false;
    const scopeLabel = (range === "all" ? "All confirmed orders" : `Next ${range} days`)
      + (readyOnly ? " · ready plans only" : "");
    const today = new Date().toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
    HP.openModal("Shopping list", `
      <div class="shop-print">
        <p class="plan-hint">${HP.esc(scopeLabel)} — drawn up ${HP.esc(today)}.</p>
        <table class="shop-table">
          <thead><tr><th>Ingredient</th><th>Qty</th><th>Unit</th><th>Packs</th><th>Est. ₱</th><th>For events</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td>${HP.esc(r.ingredient)}</td>
            <td>${r.hasQty ? round2(r.qty) : ""}</td>
            <td>${HP.esc(r.unit)}</td>
            <td>${r.hasQty && r.packSize > 0 ? Math.ceil(r.qty / r.packSize) : ""}</td>
            <td>${r.cost || ""}</td>
            <td>${HP.esc([...r.events].join("; "))}</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="shopPrintGo"><span class="ic">${HP.icon("printer")}</span>Print</button>`);
    document.getElementById("shopPrintGo").addEventListener("click", HP.printModal);
    return true;
  }
})();
