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

  function pieceOf(kind) {
    const R = RU();
    if (R && typeof R.pieceOf === "function") return R.pieceOf(kind);
    // rules.js absent — draw plain rectangles rather than nothing at all.
    return { shape: "rect" };
  }

  function mount(el) {
    host = el || null;
  }

  /* The room is drawn to whatever scale fits the panel, so a 24 m ballroom
     and a 9 m function room both fill the sheet instead of one overflowing
     it. Same intent as designer.js fitCanvas(), but measured off this page's
     own stage — there is no stat strip or chip row above it here. */
  function fit() {
    if (!host) return;
    const wrap = host.parentElement;
    if (!wrap) return;
    const availW = Math.max(160, wrap.clientWidth - 24);
    const availH = Math.max(160, wrap.clientHeight - 24);
    scale = Math.max(4, Math.min(availW / room.w, availH / room.h));

    host.style.width = room.w * scale + "px";
    host.style.height = room.h * scale + "px";
    host.style.backgroundSize = `${scale}px ${scale}px, ${scale}px ${scale}px`;
    draw();
  }

  function itemEl(it) {
    const def = pieceOf(it.kind);
    const el = document.createElement("div");
    el.className = "ld-item ld-item--" + (def.shape || "rect");
    el.dataset.kind = it.kind;

    el.style.left = it.x * scale + "px";
    el.style.top = it.y * scale + "px";
    el.style.width = it.w * scale + "px";
    el.style.height = it.h * scale + "px";
    if (it.rot) el.style.transform = `rotate(${it.rot}deg)`;
    // Below this size the label is unreadable and just muddies the piece.
    if (Math.min(it.w, it.h) * scale < 54) el.classList.add("is-tiny");

    el.innerHTML = `
      <span class="ld-item-body">
        <span class="ld-item-label">${esc(it.label || "")}</span>
        ${it.seats ? `<span class="ld-item-seats">${esc(it.seats)}</span>` : ""}
      </span>`;
    return el;
  }

  function draw() {
    if (!host) return;
    host.textContent = "";
    const frag = document.createDocumentFragment();
    items.forEach((it) => frag.appendChild(itemEl(it)));
    host.appendChild(frag);
  }

  /* render(layout) — swap in a plan and draw it. Mirrors HPScene.render()'s
     signature so viewer.js can hand both views the same object. */
  function render(layout) {
    const L = layout || {};
    if (L.room && L.room.w && L.room.h) room = { w: +L.room.w, h: +L.room.h };
    items = Array.isArray(L.items) ? L.items : [];
    fit();
  }

  return { mount, render, resize: fit, available: () => true };
})();
