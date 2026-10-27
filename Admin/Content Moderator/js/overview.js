/* HapagPamana · Content Moderator — Overview page.
   A read-only "bento board": one tile per section of the app (products,
   packages, categories, setups, featured dishes, app configuration) plus a
   banner that sums up the kitchen at a glance. Static scaffold lives in
   index.html (#bento); this script paints the whole board — instantly from the
   session cache when available, then again with fresh data. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({ title: "Overview", sub: "Welcome back.", search: false, action: null });

  const bentoEl = document.getElementById("bento");
  let animated = false;

  const pct = (n, max) => (max > 0 ? Math.round((n / max) * 100) : 0);
  const plural = (n, w) => `${w}${n === 1 ? "" : "s"}`;

  if (HP.store.DB) render(); else renderSkeleton();
  HP.ready.then(render);            // first paint — instant when the cache has a copy
  HP.onRefresh(render);             // repaint when the background refetch lands

  function renderSkeleton() {
    const tile = (cls) => `<div class="bento-tile ${cls}">
        <div class="bento-head"><div class="skeleton sk-ic"></div></div>
        <div class="skeleton sk-num"></div>
        <div class="skeleton sk-line"></div>
        <div class="skeleton sk-line short"></div>
      </div>`;
    bentoEl.innerHTML =
      `<div class="bento-tile bento-banner b-12">
         <div class="banner-lead"><div class="skeleton sk-line short"></div><div class="skeleton sk-line"></div></div>
       </div>` +
      tile("b-6") + tile("b-3") + tile("b-3") +
      tile("b-4") + tile("b-4") + tile("b-4");
  }

  function render() {
    const DB = HP.store.DB;
    // Trashed items (soft-deleted) don't count toward the ledger.
    const d = DB.dishes.filter((x) => !x.deleted);
    const p = DB.packages.filter((x) => !x.deleted);
    const c = DB.categories.filter((x) => !x.deleted);
    const s = (DB.setups || []).filter((x) => !x.deleted);
    const st = DB.settings || {};

    // Personalize the subtitle now that we know who signed in.
    if (HP.user.greet) HP.shell.setSub(`Welcome back, ${HP.user.greet}.`);

    // ── Derived figures ──────────────────────────────────────────────
    const available = d.filter((x) => x.available).length;
    const hidden = d.length - available;
    const featured = d.filter((x) => x.featured);

    const activePkg = p.filter((x) => x.active).length;
    const prices = p.map((x) => x.price).filter((v) => v > 0);
    const loPrice = prices.length ? Math.min(...prices) : null;
    const hiPrice = prices.length ? Math.max(...prices) : null;

    const setupsVisible = s.filter((x) => x.visible).length;
    const setupsHidden = s.length - setupsVisible;

    const byType = HP.TYPES.map((t) => ({ name: t, count: d.filter((x) => x.type === t).length }));
    const maxType = Math.max(1, ...byType.map((t) => t.count));
    const catByType = HP.TYPES.map((t) => ({ name: t, count: c.filter((x) => x.type === t).length }));

    // ── Banner: newspaper-masthead fact columns, no italic ─────────────
    const facts = [
      { num: d.length,       lbl: "Products" },
      { num: available,      lbl: "Visible" },
      { num: hidden,         lbl: "Hidden" },
      { num: activePkg + " of " + p.length, lbl: "Packages active", raw: true },
      loPrice !== null
        ? { num: HP.money(loPrice), lbl: "Starting / head", raw: true }
        : null,
      { num: setupsVisible,  lbl: plural(setupsVisible, "Setup") + " published" },
      { num: c.length,       lbl: "Categories" },
    ].filter(Boolean);

    const factCols = facts.map((f, i) => `
      ${i > 0 ? `<div class="bf-div"></div>` : ""}
      <div class="bf-col">
        <div class="bf-num${f.raw ? " bf-raw" : ""}"${!f.raw ? ` data-count="${f.num}"` : ""}>${f.num}</div>
        <div class="bf-lbl">${f.lbl}</div>
      </div>`).join("");

    const banner = `
      <section class="bento-tile bento-banner b-12">
        <div class="banner-masthead">
          <div class="banner-head-row">
            <span class="eyebrow">Today in the kitchen</span>
            ${st.maintenance ? `<span class="badge badge-warn"><span class="dot"></span>Maintenance mode</span>` : ""}
          </div>
          <div class="banner-rule"><span></span><span class="banner-rule-gem"></span><span></span></div>
          <div class="banner-facts">${factCols}</div>
        </div>
        <div class="banner-actions">
          <a class="btn btn-primary btn-sm" href="products.html"><span class="ic">${HP.icon("plus")}</span>Add product</a>
          <button class="btn btn-ghost btn-sm" id="ovExport"><span class="ic">${HP.icon("download")}</span>Export as JSON</button>
        </div>
      </section>`;

    // ── Products (wide tile) — total + per-type breakdown bars ────────
    const bars = byType.map((t) => `
      <div class="bk-row">
        <span class="bk-name">${HP.esc(t.name)}</span>
        <span class="bk-val">${t.count}</span>
        <div class="bk-bar"><span data-w="${pct(t.count, maxType)}"></span></div>
      </div>`).join("");
    const productsTile = `
      <section class="bento-tile b-6">
        ${head("dish", "Products", d.length)}
        <div class="bk-rows">${bars}</div>
        <div class="bento-meta">
          <span class="badge badge-ok"><span class="dot"></span>${available} visible</span>
          <span class="badge badge-muted">${hidden} hidden</span>
          <span class="badge badge-gold"><span class="ic">${HP.icon("star")}</span>${featured.length} featured</span>
        </div>
        ${link("products.html", "Manage products")}
      </section>`;

    // ── Packages ──────────────────────────────────────────────────────
    const range = loPrice === null ? "No pricing set"
      : loPrice === hiPrice ? `${HP.money(loPrice)} / head`
      : `${HP.money(loPrice)} – ${HP.money(hiPrice)} / head`;
    const packagesTile = `
      <section class="bento-tile b-3">
        ${head("box", "Packages", p.length)}
        <ul class="bento-list">
          <li><span>${activePkg} of ${p.length} active</span></li>
          <li><span class="ic">${HP.icon("peso")}</span><strong>${range}</strong></li>
        </ul>
        ${link("packages.html", "Manage packages")}
      </section>`;

    // ── Categories ────────────────────────────────────────────────────
    const categoriesTile = `
      <section class="bento-tile b-3">
        ${head("tag", "Categories", c.length)}
        <ul class="bento-list">
          ${catByType.map((t) => `<li><span>${HP.esc(t.name)}</span><strong>${t.count}</strong></li>`).join("")}
        </ul>
        ${link("categories.html", "Manage categories")}
      </section>`;

    // ── Setups ────────────────────────────────────────────────────────
    const thumbs = s.filter((x) => x.image).slice(0, 4);
    const more = s.length - thumbs.length;
    const strip = s.length === 0
      ? empty("photo", "No setup photos yet")
      : `<div class="bento-thumbs">
           ${thumbs.map((x) => `<span class="bt"><img src="${HP.esc(x.image)}" alt=""></span>`).join("")}
           ${more > 0 ? `<span class="bt bt-more">+${more}</span>` : ""}
         </div>`;
    const setupsTile = `
      <section class="bento-tile b-4">
        ${head("photo", "Setups", s.length)}
        <div class="bento-meta">
          <span class="badge badge-ok"><span class="dot"></span>${setupsVisible} visible</span>
          ${setupsHidden ? `<span class="badge badge-muted">${setupsHidden} hidden</span>` : ""}
        </div>
        ${strip}
        ${link("setups.html", "Manage gallery")}
      </section>`;

    // ── Featured on Home ──────────────────────────────────────────────
    const chips = featured.length
      ? `<div class="feat-chips">
           ${featured.slice(0, 8).map((x) => `<span class="badge badge-gold">${HP.esc(x.name)}</span>`).join("")}
           ${featured.length > 8 ? `<span class="badge badge-muted">+${featured.length - 8}</span>` : ""}
         </div>`
      : empty("star", "Nothing featured on Home yet");
    const featuredTile = `
      <section class="bento-tile b-4">
        ${head("star", "Featured on Home", featured.length)}
        ${chips}
        ${link("products.html", "Choose featured")}
      </section>`;

    // ── App configuration (settings mirror) ───────────────────────────
    const onoff = (v) => v
      ? `<span class="badge badge-ok"><span class="dot"></span>On</span>`
      : `<span class="badge badge-muted">Off</span>`;
    const cfgRows = [
      ["Online ordering", onoff(st.ordering)],
      ["Catering requests", onoff(st.catering)],
      ["Featured on Home", onoff(st.featuredOnHome)],
      ["Maintenance mode", st.maintenance ? `<span class="badge badge-warn">On</span>` : `<span class="badge badge-muted">Off</span>`],
      ["Currency", `<span class="cfg-val">${HP.esc(st.currency || "₱")}</span>`],
    ];
    const configTile = `
      <section class="bento-tile b-4">
        ${head("gear", "App configuration")}
        <ul class="cfg-list">
          ${cfgRows.map(([k, v]) => `<li><span class="cfg-k">${k}</span>${v}</li>`).join("")}
        </ul>
        ${link("settings.html", "Open settings")}
      </section>`;

    HP.shell.paint(bentoEl,
      banner + productsTile + packagesTile + categoriesTile + setupsTile + featuredTile + configTile);

    document.getElementById("ovExport").addEventListener("click", HP.exportData);
    if (!animated) { animated = true; animate(); }
  }

  // Tile header: medallion + small-caps label, with an optional big figure on
  // the right (count-up animated on first paint).
  function head(ic, label, figure) {
    return `<div class="bento-head">
        <div class="label-grp">
          <span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span>
          <span class="bento-label">${label}</span>
        </div>
        ${figure != null ? `<div class="bento-figure" data-count="${figure}">${figure}</div>` : ""}
      </div>`;
  }
  function link(href, text) { return `<a class="bento-link" href="${href}">${text}</a>`; }
  function empty(ic, text) {
    return `<div class="bento-empty"><span class="ic">${HP.icon(ic)}</span><p>${text}</p></div>`;
  }

  // First-paint motion: count each figure 0 → value (HP.countUp), then grow
  // the breakdown bars. Reduced-motion users get the final state immediately
  // (countUp checks in JS; the bar transition is disabled globally, so setting
  // the width just snaps).
  function animate() {
    HP.countUp(bentoEl); // every [data-count]: tile figures AND the banner's fact numerals
    requestAnimationFrame(() =>
      bentoEl.querySelectorAll(".bk-bar > span").forEach((el) => { el.style.width = el.dataset.w + "%"; }));
  }
})();
