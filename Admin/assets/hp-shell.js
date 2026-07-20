/* ════════════════════════════════════════════════════════════════
   HapagPamana · Staff portal SHELL — ONE copy shared by every dashboard.
   Builds the Heirloom Editorial app frame once per page: the gilt
   book-spine sidebar, the chapter-header topbar, and the modal/toast
   roots. Each page drops its content into a <template id="tpl-view">
   and the shell clones it into the main area.

   Parameterized by `window.HP_DASHBOARD.shell` (js/config.js):
     brandSub          small line under the sidebar brand
     eyebrow           topbar eyebrow ("Content Moderation", …)
     nav               [{ key, href, icon, label, badge? }] — active state
                       follows the current filename; badge:true renders the
                       #navBadge counter (driven via setBadge)
     export            { label | label(), fn? } — sidebar export button;
                       fn wires at init, otherwise pages wire via onExport
     routeTransitions  true to animate between the dashboard's pages

   Public API (window.HP.shell):
     init()                                  build the frame, return #view
     setPage({title, sub, search, action})   configure the topbar
     setSub(text)                            update just the subtitle
     onSearch(fn)                            subscribe to the topbar search
     setBadge(n)                             count badge on the nav (if any)
     onExport(fn)                            wire the sidebar export button
     paint(el, html)                         staggered first paint helper
     view                                    the #view element
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const HP = window.HP;
  const CFG = (window.HP_DASHBOARD && window.HP_DASHBOARD.shell) || {};
  const NAV = CFG.nav || [];
  const EXP = CFG.export || null;

  // Active nav entry follows the open document's filename.
  const FILE = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const CURRENT = (NAV.find((p) => p.href.toLowerCase() === FILE) || NAV[0] || {}).key;

  let viewEl = null;

  // Set a container's HTML, animating its children in (staggered) on the FIRST
  // paint only — so search/filter re-renders, live snapshot repaints and the
  // background cache→fresh refresh never re-animate the list. Re-renders
  // instead get a whisper of a fade so the swap reads as intentional (skipped
  // while typing fast, and under reduced motion). Returns true on the first
  // paint, so pages can gate one-shot effects (count-ups) on it.
  const _painted = new WeakSet();
  const _lastPaint = new WeakMap();
  function paint(container, html) {
    if (!container) return false;
    const first = !_painted.has(container);
    if (first) { _painted.add(container); container.classList.add("stagger"); }
    container.innerHTML = html;
    if (first) { setTimeout(() => container.classList.remove("stagger"), 800); }
    else {
      const recent = performance.now() - (_lastPaint.get(container) || 0) < 250;
      if (!recent && !HP.reduceMotion() && container.animate)
        container.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 170, easing: "ease-out" });
    }
    _lastPaint.set(container, performance.now());
    return first;
  }

  function navMarkup() {
    return NAV.map((p) => {
      const active = p.key === CURRENT ? " active" : "";
      const badge = p.badge ? `<span class="nav-badge" id="navBadge" hidden></span>` : "";
      return `<a href="${p.href}" data-view="${p.key}" class="nav-item${active}"><span class="ic" data-icon="${p.icon}"></span>${p.label}${badge}</a>`;
    }).join("");
  }

  function init() {
    if (viewEl) return viewEl; // build once

    const expLabel = EXP ? (typeof EXP.label === "function" ? EXP.label() : EXP.label) : "";

    const app = document.createElement("div");
    app.className = "app";
    app.id = "app";
    app.innerHTML = `
      <aside class="sidebar" id="sidebar">
        <div class="side-brand">
          <span class="side-logo"><img src="../../assets/HapagPamana.png" alt="" /></span>
          <span class="side-brand-text">
            <strong>HapagPamana</strong>
            <small>${HP.esc(CFG.brandSub || "Staff Portal")}</small>
          </span>
        </div>
        <div class="side-rule" aria-hidden="true"><span></span></div>

        <nav class="side-nav" id="sideNav">${navMarkup()}</nav>

        <div class="side-foot">
          ${EXP ? `<button class="side-export" id="exportBtn"><span class="ic" data-icon="download"></span>${HP.esc(expLabel)}</button>` : ""}
          <div class="side-user">
            <span class="avatar" id="userAvatar">·</span>
            <span class="side-user-text"><strong id="userName">Signed in</strong><small id="userRole">${HP.esc(HP.user.role)}</small></span>
            <a class="side-logout" href="../../index.html" title="Log out"><span class="ic" data-icon="logout"></span></a>
          </div>
        </div>
      </aside>
      <div class="scrim" id="scrim"></div>

      <div class="main">
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle" aria-label="Menu"><span class="ic" data-icon="menu"></span></button>
          <div class="topbar-title">
            <span class="eyebrow">${HP.esc(CFG.eyebrow || "Staff Portal")}</span>
            <h1 id="pageTitle"></h1>
            <p id="pageSub"></p>
          </div>
          <div class="topbar-actions">
            <label class="search" id="searchWrap">
              <span class="ic" data-icon="search"></span>
              <input type="search" id="globalSearch" placeholder="Search…" autocomplete="off" />
            </label>
            <button class="btn btn-primary" id="primaryAction" hidden></button>
          </div>
        </header>

        <main class="view view-enter" id="view" tabindex="-1"></main>
      </div>`;
    document.body.prepend(app);

    // Global overlay roots (modal + toast) live on the body, outside .app.
    const mRoot = document.createElement("div");
    mRoot.className = "modal-root"; mRoot.id = "modalRoot"; mRoot.hidden = true;
    const tWrap = document.createElement("div");
    tWrap.className = "toast-wrap"; tWrap.id = "toastWrap";
    document.body.append(mRoot, tWrap);

    viewEl = app.querySelector("#view");

    // Drop this page's static scaffold (its <template id="tpl-view">) into #view.
    const tpl = document.getElementById("tpl-view");
    if (tpl && "content" in tpl) viewEl.appendChild(tpl.content.cloneNode(true));

    HP.hydrateIcons(app);
    HP.applyUser(); // paint whatever's already known (e.g. local-demo identity)

    // Wiring shared by every page.
    document.getElementById("menuToggle").addEventListener("click", () => app.classList.toggle("nav-open"));
    document.getElementById("scrim").addEventListener("click", () => app.classList.remove("nav-open"));
    if (EXP && EXP.fn) document.getElementById("exportBtn").addEventListener("click", () => EXP.fn());

    // Lift the topbar with a shadow once the page is scrolled.
    const topbar = app.querySelector(".topbar");
    const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 4);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    // Logout: hp-guard.js intercepts the click to sign out first when online;
    // when offline the plain <a href="../../index.html"> navigation is enough.

    if (CFG.routeTransitions) setupRouteTransitions(app);
    return viewEl;
  }

  // Page transitions: clicking an internal link fades the view out behind a slim
  // gilt progress bar, then navigates. The destination paints back in via the
  // body pageFade + .view-enter rise, so pages cross-fade instead of flashing.
  function setupRouteTransitions(app) {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
    // Browsers that support cross-document view transitions (the
    // @view-transition rule in global.css) run the navigation natively: the
    // pages cross-fade, the sidebar/topbar hold still and the gilt indicator
    // glides — so the manual leave choreography below would only fight it.
    const nativeVT = "CSSViewTransitionRule" in window;
    document.addEventListener("click", (e) => {
      // Respect new-tab / modified clicks and anything already handled (logout).
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest("a[href]");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;

      // Logout: online, hp-guard.js intercepts (sign-out + curtain). Offline/
      // demo, the guard isn't active, so show the same curtain here first.
      if (a.closest(".side-logout")) {
        if (HP.ONLINE) return;
        e.preventDefault();
        const rm = reduce && reduce.matches;
        if (!rm && HP.leaveCurtain) HP.leaveCurtain("Signing out…");
        setTimeout(() => { location.href = a.href; }, rm ? 0 : 700);
        return;
      }

      const raw = a.getAttribute("href");
      if (!raw || raw.startsWith("#") || /^(mailto:|tel:|javascript:)/i.test(raw)) return;
      let url; try { url = new URL(a.href, location.href); } catch { return; }
      if (url.origin !== location.origin) return;             // external — let it through
      if (!/\.html?($|[?#])/i.test(url.pathname)) return;     // only our page documents

      // Native view transition: let the browser handle the whole navigation.
      // (Don't pre-flip the active nav item — the old page's snapshot must
      // show the indicator where it was for the glide to read.)
      if (nativeVT && !(reduce && reduce.matches)) return;

      e.preventDefault();
      // Reflect the chosen sidebar item immediately, so the gilt indicator slides
      // before the page swaps.
      if (a.classList.contains("nav-item")) {
        app.querySelectorAll(".nav-item.active").forEach((n) => n.classList.remove("active"));
        a.classList.add("active");
      }
      if (reduce && reduce.matches) { location.href = url.href; return; }
      app.classList.add("is-leaving");
      if (!document.querySelector(".auth-bar")) {
        const bar = document.createElement("div");
        bar.className = "auth-bar";
        document.body.appendChild(bar);
      }
      setTimeout(() => { location.href = url.href; }, 230);
    });
  }

  function setPage(cfg) {
    cfg = cfg || {};
    document.getElementById("pageTitle").textContent = cfg.title || "";
    document.getElementById("pageSub").textContent = cfg.sub || "";
    document.getElementById("searchWrap").style.display = cfg.search ? "" : "none";

    const pa = document.getElementById("primaryAction");
    if (cfg.action) {
      pa.hidden = false;
      pa.innerHTML = `<span class="ic">${HP.icon(cfg.action.icon || "plus")}</span>${cfg.action.label}`;
      pa.onclick = cfg.action.fn;
    } else {
      pa.hidden = true;
      pa.onclick = null;
    }
  }

  function setSub(text) { document.getElementById("pageSub").textContent = text; }

  // Debounced ~150ms so fast typing re-renders (and re-filters hundreds of
  // cards) once per pause, not once per keystroke.
  function onSearch(fn) {
    const input = document.getElementById("globalSearch");
    if (!input) return;
    input.value = "";
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(input.value.trim().toLowerCase()), 150);
    });
  }

  // Count badge on the sidebar nav item (hidden at zero; no-op when the nav
  // model declares no badge).
  function setBadge(n) {
    const b = document.getElementById("navBadge");
    if (!b) return;
    b.hidden = !n;
    b.textContent = n > 99 ? "99+" : String(n || 0);
  }

  function onExport(fn) {
    const btn = document.getElementById("exportBtn");
    if (btn) btn.addEventListener("click", fn);
  }

  HP.shell = {
    init,
    setPage,
    setSub,
    onSearch,
    setBadge,
    onExport,
    paint,
    get view() { return viewEl; },
  };
})();
