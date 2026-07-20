/* HapagPamana · Content Moderator — Setups page.
   A photo gallery of event table and venue setups. Each card shows the
   photo full-bleed with the event title and type overlaid. Admins can
   upload, filter, show/hide, and delete setup photos. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Setups",
    sub: "Event table and venue setup gallery.",
    search: true,
    action: { label: "Upload photo", fn: () => setupModal(), icon: "upload" },
  });

  let searchTerm = "";

  // Setup photos allow a larger canvas + higher quality than product tiles.
  const SETUP_IMG = { maxSize: 1200, quality: 0.88, step: 0.1 };

  const toolbarEl = document.getElementById("setupToolbar");
  const gridEl    = document.getElementById("setupGrid");

  HP.shell.onSearch((term) => { searchTerm = term; render(); });

  if (!HP.store.DB) gridEl.innerHTML = HP.skel.cards(6);
  HP.ready.then(render);            // first paint — instant when the cache has a copy
  HP.onRefresh(render);             // repaint when the background refetch lands

  function render() {
    const DB  = HP.store.DB;
    const all = (DB.setups || []).filter((s) => !s.deleted); // trashed live on the Settings Trash

    // ── Filtered list ─────────────────────────────────────────────────
    let list = all.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (searchTerm) list = list.filter((s) => s.title.toLowerCase().includes(searchTerm));

    // ── Gallery cards ─────────────────────────────────────────────────
    HP.shell.paint(gridEl, list.length ? list.map((s) => `
      <div class="setup-card ${!s.visible ? "setup-card--hidden" : ""}">
        ${s.image
          ? `<img src="${HP.esc(s.image)}" alt="${HP.esc(s.title)}" loading="lazy" />`
          : `<div class="setup-placeholder"><span class="ic">${HP.icon("photo")}</span></div>`}
        <div class="setup-foot">
          <div class="setup-title">${HP.esc(s.title)}</div>
        </div>
        <div class="setup-actions">
          <button class="icon-btn" data-view="${s.id}" title="View">
            <span class="ic">${HP.icon("eye")}</span>
          </button>
          <button class="icon-btn setup-vis-btn" data-vis="${s.id}" title="${s.visible ? "Hide" : "Show"}">
            <span class="ic">${HP.icon(s.visible ? "check" : "close")}</span>
          </button>
          <button class="icon-btn" data-edit="${s.id}" title="Edit">
            <span class="ic">${HP.icon("edit")}</span>
          </button>
          <button class="icon-btn danger" data-del="${s.id}" title="Delete">
            <span class="ic">${HP.icon("trash")}</span>
          </button>
        </div>
        ${!s.visible ? `<span class="setup-hidden-badge">Hidden</span>` : ""}
      </div>`).join("") : `
      ${searchTerm
        ? `<div class="empty empty--soft"><span class="ic">${HP.icon("photo")}</span><p>No setups match.</p></div>`
        : `<div class="setup-dropzone" id="setupDropzone">
             <span class="ic setup-dropzone-ic">${HP.icon("upload")}</span>
             <p class="setup-dropzone-title">Drop photos here</p>
             <p class="setup-dropzone-sub">or click to upload</p>
             <button class="btn btn-primary" id="emptyUpload">
               <span class="ic">${HP.icon("upload")}</span>Choose photo
             </button>
           </div>`}`);

    const emptyBtn  = document.getElementById("emptyUpload");
    const dropzone  = document.getElementById("setupDropzone");
    if (emptyBtn) emptyBtn.addEventListener("click", () => setupModal());
    if (dropzone) {
      dropzone.addEventListener("click", (e) => { if (e.target === dropzone) setupModal(); });
      dropzone.addEventListener("dragover",  (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
      dropzone.addEventListener("dragleave", ()  => dropzone.classList.remove("drag-over"));
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault(); dropzone.classList.remove("drag-over");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) setupModal(null, file);
      });
    }

    // Visibility toggle
    gridEl.querySelectorAll("[data-vis]").forEach((b) =>
      b.addEventListener("click", () => {
        const s = (DB.setups || []).find((x) => x.id === b.dataset.vis);
        if (!s) return;
        s.visible = !s.visible;
        HP.store.persist("setups", s);
        HP.toast(s.visible ? "Setup is now visible." : "Setup hidden from app.");
        render();
      }));

    gridEl.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => viewSetup(b.dataset.view)));
    gridEl.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => setupModal(b.dataset.edit)));
    gridEl.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => delSetup(b.dataset.del)));
  }

  // ── Read-only detail view ─────────────────────────────────────────────
  function viewSetup(id) {
    const s = (HP.store.DB.setups || []).find((x) => x.id === id);
    if (!s) return;

    HP.openModal(s.title, `
      <div class="prod-view">
        <div class="prod-view-media">
          ${s.image
            ? `<img class="prod-thumb-bg" src="${HP.esc(s.image)}" alt="" aria-hidden="true">
               <img class="prod-thumb-fg" src="${HP.esc(s.image)}" alt="${HP.esc(s.title)}">`
            : `<span class="ic" style="font-size:3.4rem;color:var(--gold-hair)">${HP.icon("photo")}</span>`}
        </div>
        <div class="prod-view-meta">
          ${s.visible
            ? `<span class="badge badge-ok"><span class="dot"></span>Visible</span>`
            : `<span class="badge badge-muted">Hidden</span>`}
        </div>
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="viewEdit"><span class="ic">${HP.icon("edit")}</span>Edit</button>`);

    document.getElementById("viewEdit").addEventListener("click", () => {
      HP.closeModal();
      setupModal(id);
    });
  }

  // ── Upload / edit modal ───────────────────────────────────────────────
  function setupModal(id, droppedFile) {
    const DB = HP.store.DB;
    const s  = id ? (DB.setups || []).find((x) => x.id === id) : null;
    let image = s ? (s.image || "") : "";

    HP.openModal(id ? "Edit setup" : "Upload setup photo", `
      <form id="setupForm" novalidate>
        <div class="field"><label>Title <span class="req">*</span></label>
          <input class="control" name="title" value="${s ? HP.esc(s.title) : ""}"
            placeholder="e.g. Garden Wedding Reception" required>
          <div class="field-error" data-err="title" hidden></div></div>

        <div class="field"><label>Photo</label>
          <div class="uploader">
            <div class="uploader-preview" id="setupPreview"></div>
            <div class="uploader-side">
              <button type="button" class="btn btn-ghost btn-sm" id="pickSetupImg">
                <span class="ic">${HP.icon("upload")}</span>Upload photo
              </button>
              <button type="button" class="btn btn-danger btn-sm" id="clearSetupImg" hidden>
                <span class="ic">${HP.icon("trash")}</span>Remove
              </button>
              <input type="file" id="setupImgFile" accept="image/*" hidden>
            </div>
          </div>
          <div class="field-hint">JPG or PNG — large images are resized automatically.</div></div>

        <label class="switch">
          <input type="checkbox" name="visible" ${!s || s.visible ? "checked" : ""}>
          <span class="track"></span>
          <span class="switch-label">Visible in app</span>
        </label>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="saveSetup">${id ? "Save changes" : "Upload"}</button>`);

    const preview  = document.getElementById("setupPreview");
    const clearBtn = document.getElementById("clearSetupImg");
    const fileInput = document.getElementById("setupImgFile");

    function renderPreview() {
      if (image) {
        preview.innerHTML = `<img src="${HP.esc(image)}" alt="">`;
        preview.classList.add("has-img");
      } else {
        preview.innerHTML = `<span class="ic">${HP.icon("photo")}</span>`;
        preview.classList.remove("has-img");
      }
      clearBtn.hidden = !image;
    }
    renderPreview();

    const showSize = (dataUrl) => {
      const hint = preview.closest(".field").querySelector(".field-hint");
      if (hint) hint.textContent = `Image ready — ${Math.round(dataUrl.length / 1024)} KB stored inline.`;
    };
    const imgError = (err) => HP.toast(err && err.message === "image too large"
      ? "That photo can't be squeezed under the storage budget — try a smaller or simpler image."
      : "Couldn't read that image.", "danger");

    // If a file was dropped onto the zone, load it immediately.
    if (droppedFile) {
      HP.compressImage(droppedFile, SETUP_IMG).then((dataUrl) => { image = dataUrl; renderPreview(); showSize(dataUrl); })
        .catch(imgError);
    }

    document.getElementById("pickSetupImg").addEventListener("click", () => fileInput.click());
    clearBtn.addEventListener("click", () => { image = ""; fileInput.value = ""; renderPreview(); });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      HP.compressImage(file, SETUP_IMG).then((dataUrl) => {
        image = dataUrl; renderPreview(); showSize(dataUrl);
      }).catch(imgError);
    });

    document.getElementById("saveSetup").addEventListener("click", () => {
      const f     = document.getElementById("setupForm");
      const title = f.title.value.trim();
      if (!HP.setErr(f, "title", title ? "" : "Title is required.")) return;
      const payload = { title, image, visible: f.visible.checked };
      // Save against the LIVE store — a background refetch may have replaced
      // the copy captured when the modal opened, and a write into that orphan
      // would land in Firestore but never on screen (or in the cache).
      const DB = HP.store.DB;
      if (!DB.setups) DB.setups = [];
      let rec;
      if (s) {
        rec = Object.assign(s, payload);
        if (!DB.setups.some((x) => x.id === s.id)) DB.setups.push(rec); // vanished mid-edit — re-attach
      } else {
        rec = { id: HP.uid(), createdAt: Date.now(), ...payload };
        DB.setups.push(rec);
      }
      HP.store.persist("setups", rec);
      HP.closeModal();
      HP.toast(id ? "Setup updated." : `"${title}" uploaded.`);
      render();
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────
  function delSetup(id) {
    const DB = HP.store.DB;
    const s  = (DB.setups || []).find((x) => x.id === id);
    if (!s) return;
    HP.confirmModal("Delete setup",
      `Move "${s.title}" to the Trash? It leaves the gallery right away — restore it any time from Settings.`, () => {
      // Fade the card out first, so the deletion reads as "this one left".
      const btn = gridEl.querySelector(`[data-del="${id}"]`);
      HP.animateOut(btn && btn.closest(".setup-card")).then(() => {
        HP.store.softRemove("setups", id);
        HP.toast("Setup moved to Trash — restore it from Settings.", "warn");
        render();
      });
    });
  }

  // Image compression lives in core.js (HP.compressImage) — shared with Products.
})();
