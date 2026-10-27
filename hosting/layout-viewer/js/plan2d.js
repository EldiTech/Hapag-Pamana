/* HapagPamana · Layout Viewer — the 2D floor plan, READ-ONLY.

   Why this file exists at all, when every other module in this folder is a
   verbatim copy of the desk's own:

   The 3D view and the walkthrough are shipped as modules (HPScene, HPSim) and
   so could simply be reused. The 2D plan never was — it lives inside
   Admin/Layout Designer/js/designer.js, woven through the editor it belongs
   to: pointer drags, resize/rotate grips, selection, undo/redo, autosave,
   the piece palette. Copying designer.js to give the customer a floor plan
   would hand them the editing desk as well, which the brief forbids.

   So this is the drawing half alone, and ONLY the drawing half — the same
   `.ld-item` divs, positioned by the same metres-times-scale arithmetic
   (designer.js `place()`), wearing the same classes so the copied layout.css
   styles them identically. There are no grips, no listeners, no writes.

   Business logic is still not duplicated: shape, label and seat counts come
   from HPRules.pieceOf() — the one catalogue both the desk and this page
   read (js/rules.js). The only thing living here is layout arithmetic. */
window.HPPlan2D = (function () {
  "use strict";

  const RU = () => window.HPRules || null;
  const esc = (s) => (window.HP && window.HP.esc)
    ? window.HP.esc(s)
    : String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[c]);

  let host = null;              // the .ld-canvas element we draw into
  let room = { w: 24, h: 18 };
  let items = [];
  let scale = 20;               // pixels per metre, recomputed on every fit
  let zoom = 1;
  let selectedId = null;
  let zoomMounted = false;

  function pieceOf(kind) {
    const R = RU();
    if (R && typeof R.pieceOf === "function") return R.pieceOf(kind);
    return { shape: "rect" };
  }

  function mount(el) {
    host = el || null;
    mountTools();
  }

  function mountTools() {
    if (zoomMounted || !host) return;
    const stage = host.closest(".lv-stage2d");
    if (!stage) return;
    zoomMounted = true;

    // Zoom controls bar
    const bar = document.createElement("div");
    bar.className = "lv-zoom-tools";
    bar.innerHTML = `
      <button class="lv-zoom-btn" id="lvZoomIn" title="Zoom in" type="button" aria-label="Zoom in">+</button>
      <button class="lv-zoom-btn" id="lvZoomOut" title="Zoom out" type="button" aria-label="Zoom out">−</button>
      <button class="lv-zoom-btn" id="lvZoomFit" title="Fit to screen" type="button" aria-label="Fit to screen">⤢</button>`;
    stage.appendChild(bar);

    bar.querySelector("#lvZoomIn").addEventListener("click", (e) => {
      e.stopPropagation();
      zoom = Math.min(2.8, Math.round((zoom + 0.3) * 10) / 10);
      fit();
    });
    bar.querySelector("#lvZoomOut").addEventListener("click", (e) => {
      e.stopPropagation();
      zoom = Math.max(0.7, Math.round((zoom - 0.3) * 10) / 10);
      fit();
    });
    bar.querySelector("#lvZoomFit").addEventListener("click", (e) => {
      e.stopPropagation();
      zoom = 1;
      fit();
    });

    // Tap outside to deselect
    stage.addEventListener("click", (e) => {
      if (e.target.closest(".ld-item") || e.target.closest(".lv-selection-info") || e.target.closest(".lv-zoom-tools")) return;
      selectItem(null);
    });
  }

  function selectItem(it) {
    selectedId = it ? (it.id || it.label) : null;
    if (host) {
      host.querySelectorAll(".ld-item").forEach((el) => {
        el.classList.toggle("selected", it && el.dataset.itemKey === String(it.id || it.label));
      });
    }

    const stage = host ? host.closest(".lv-stage2d") : null;
    if (!stage) return;
    let card = stage.querySelector(".lv-selection-info");
    if (!it) {
      if (card) card.remove();
      return;
    }

    if (!card) {
      card = document.createElement("div");
      card.className = "lv-selection-info";
      stage.appendChild(card);
    }

    const def = pieceOf(it.kind);
    const label = it.label || def.label || it.kind;
    const seatText = it.seats ? ` · <strong>${esc(it.seats)} seats</strong>` : "";
    const dimText = `${Number(it.w).toFixed(1)}m × ${Number(it.h).toFixed(1)}m`;

    card.innerHTML = `
      <div class="lv-sel-body">
        <span class="lv-sel-title">${esc(label)}</span>
        <span class="lv-sel-meta">${dimText}${seatText}</span>
      </div>
      <button class="lv-sel-close" type="button" aria-label="Close">&times;</button>`;

    card.querySelector(".lv-sel-close").addEventListener("click", (e) => {
      e.stopPropagation();
      selectItem(null);
    });
  }

  function fit() {
    if (!host) return;
    const wrap = host.parentElement;
    if (!wrap) return;
    const availW = Math.max(160, wrap.clientWidth - 24);
    const availH = Math.max(160, wrap.clientHeight - 24);
    const baseScale = Math.max(4, Math.min(availW / room.w, availH / room.h));
    scale = baseScale * zoom;

    host.style.width = room.w * scale + "px";
    host.style.height = room.h * scale + "px";
    host.style.backgroundSize = `${scale}px ${scale}px, ${scale}px ${scale}px`;
    draw();
  }

  function itemContent(it, isTiny) {
    const raw = String(it.label || "").trim();
    const kind = it.kind || "";

    // Recognize numbered tables: "Table 1" -> "T1", "Table 12" -> "T12", "Guest 3" -> "T3"
    const m = raw.match(/^(?:Table|T|Guest)\s*(\d+)$/i);
    if (m) {
      const num = m[1];
      if (isTiny) {
        return `<span class="ld-item-body"><span class="ld-item-num">T${num}</span></span>`;
      }
      return `
        <span class="ld-item-body">
          <span class="ld-item-label">${esc(raw)}</span>
          ${it.seats ? `<span class="ld-item-seats">${esc(it.seats)}</span>` : ""}
        </span>`;
    }

    if (kind === "stage") {
      return `<span class="ld-item-body"><span class="ld-item-label ld-label-stage">STAGE</span></span>`;
    }
    if (kind === "buffet") {
      return `<span class="ld-item-body"><span class="ld-item-label ld-label-buffet">BUFFET</span></span>`;
    }
    if (kind === "dance") {
      return `<span class="ld-item-body"><span class="ld-item-label">DANCE FLOOR</span></span>`;
    }
    if (kind === "bar") {
      return `<span class="ld-item-body"><span class="ld-item-label">BAR</span></span>`;
    }
    if (kind === "door") {
      return `<span class="ld-item-body"><span class="ld-item-label">ENTRANCE</span></span>`;
    }

    if (isTiny) {
      if (it.seats && raw.length > 5) {
        return `<span class="ld-item-body"><span class="ld-item-label">${esc(raw.slice(0, 4))}</span></span>`;
      }
      return `<span class="ld-item-body"><span class="ld-item-label">${esc(raw)}</span></span>`;
    }

    return `
      <span class="ld-item-body">
        <span class="ld-item-label">${esc(raw)}</span>
        ${it.seats ? `<span class="ld-item-seats">${esc(it.seats)}</span>` : ""}
      </span>`;
  }

  function itemEl(it) {
    const def = pieceOf(it.kind);
    const el = document.createElement("div");
    el.className = "ld-item ld-item--" + (def.shape || "rect");
    el.dataset.kind = it.kind;
    const itemKey = String(it.id || it.label || "");
    el.dataset.itemKey = itemKey;
    if (selectedId && selectedId === itemKey) el.classList.add("selected");

    const pxW = it.w * scale;
    const pxH = it.h * scale;

    el.style.left = it.x * scale + "px";
    // Avoid clipping piece (like doorway) across canvas bottom border
    const maxTop = Math.max(0, room.h * scale - pxH);
    el.style.top = Math.min(it.y * scale, maxTop) + "px";
    el.style.width = pxW + "px";
    el.style.height = pxH + "px";
    if (it.rot) el.style.transform = `rotate(${it.rot}deg)`;

    // Only mark tiny if BOTH width and height are small, or max dimension is too tight for text
    const isTiny = (pxW < 46 && pxH < 22) || (Math.max(pxW, pxH) < 32);
    if (isTiny) el.classList.add("is-tiny");

    el.innerHTML = itemContent(it, isTiny);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      selectItem(it);
    });

    return el;
  }

  function draw() {
    if (!host) return;
    host.textContent = "";
    const frag = document.createDocumentFragment();
    items.forEach((it) => frag.appendChild(itemEl(it)));
    host.appendChild(frag);
  }

  /* render(layout) — swap in a plan and draw it. */
  function render(layout) {
    const L = layout || {};
    if (L.room && L.room.w && L.room.h) room = { w: +L.room.w, h: +L.room.h };
    items = Array.isArray(L.items) ? L.items : [];
    fit();
  }

  return { mount, render, resize: fit, available: () => true };
})();
