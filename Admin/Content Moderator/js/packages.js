/* HapagPamana · Content Moderator — Packages page.
   Every service package offered, in two families (catering packages and food
   pack packages — the app's Packages screen shows one shelf per family).
   Stats strip, family + status filter chips, a card grid, and
   create/edit/delete in a modal. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "Packages",
    sub: "All service packages offered by HapagPamana.",
    search: true,
    action: { label: "New package", fn: () => packageModal() },
  });

  /* The two package families — mirrors the app's Packages screen, which shows
     a "Catering Packages" shelf and a "Food Pack Packages" shelf. Stored
     verbatim in each package's `type`; legacy packages without one count as
     catering. */
  const PKG_TYPES = ["Catering Package", "Food Pack Package"];
  const pkgType = (p) => (PKG_TYPES.includes(p.type) ? p.type : PKG_TYPES[0]);

  /* "Hapag Serbisyo" is offered strictly for church, government and school
     functions. The package schema has no eligibility field, so — exactly like
     the mobile app (CateringPackage.isInstitutional) — the restriction keys
     off the name containing "serbisyo". Renaming the package away from that
     word turns the restriction off in both places. */
  const isInstitutional = (name) => (name || "").toLowerCase().includes("serbisyo");
  const INSTITUTIONAL_NOTE = "For church, government & school functions only";
  const typeShort = (t) => t.replace(" Package", "");
  const isCatering = (t) => t === PKG_TYPES[0];
  // Default minimum pax pre-filled per family when a package is created —
  // editable per package from there (catering events scale up from 50
  // guests per the printed rate card, food packs from 20).
  const CATERING_MIN_PAX = 50;
  const FOOD_PACK_MIN_PAX = 20;

  /* Package family → the product type whose categories feed the inclusion
     picker. Catering packages draw from the Catering Food Trays categories,
     food packs from the Food Packs categories (both live on the Categories
     page and in the `categories` collection). */
  const CAT_TYPE_FOR_PKG = {
    "Catering Package": "Catering Food Trays",
    "Food Pack Package": "Food Packs",
  };
  const inclChoices = (t) =>
    HP.categoriesForType(CAT_TYPE_FOR_PKG[t] || CAT_TYPE_FOR_PKG[PKG_TYPES[0]])
      .map((c) => c.name);

  let searchTerm = "";
  let statusFilter = "all"; // "all" | "active" | "inactive"
  let typeFilter = "all"; // "all" | PKG_TYPES[i]

  const statsEl   = document.getElementById("pkgStats");
  const toolbarEl = document.getElementById("pkgToolbar");
  const gridEl    = document.getElementById("pkgGrid");

  HP.shell.onSearch((term) => { searchTerm = term; render(); });

  if (!HP.store.DB) {
    statsEl.innerHTML  = HP.skel.stats(3);
    gridEl.innerHTML   = HP.skel.cards(4);
  }
  HP.ready.then(render);            // first paint — instant when the cache has a copy
  HP.onRefresh(render);             // repaint when the background refetch lands

  function render() {
    const DB  = HP.store.DB;
    const all = DB.packages.filter((p) => !p.deleted); // trashed live on the Settings Trash

    const activeCount   = all.filter((p) => p.active).length;
    const inactiveCount = all.length - activeCount;
    const cateringCount = all.filter((p) => pkgType(p) === PKG_TYPES[0]).length;
    const foodPackCount = all.length - cateringCount;
    const prices        = all.map((p) => p.price).filter((v) => v > 0);
    const loPrice       = prices.length ? Math.min(...prices) : null;
    const hiPrice       = prices.length ? Math.max(...prices) : null;

    // ── Stats strip (counts tally up on first paint; the price is money-
    // formatted, so it carries no data-count and just appears) ────────
    if (HP.shell.paint(statsEl, `
      <div class="stat">
        <div class="stat-top"><div class="stat-ic"><span class="ic">${HP.icon("box")}</span></div></div>
        <div class="stat-num" data-count="${all.length}">${all.length}</div>
        <div class="stat-label">${cateringCount} catering · ${foodPackCount} food pack</div>
      </div>
      <div class="stat">
        <div class="stat-top"><div class="stat-ic"><span class="ic">${HP.icon("check")}</span></div></div>
        <div class="stat-num" data-count="${activeCount}">${activeCount}</div>
        <div class="stat-label">Active in App</div>
      </div>
      <div class="stat">
        <div class="stat-top"><div class="stat-ic"><span class="ic">${HP.icon("peso")}</span></div></div>
        <div class="stat-num">${loPrice !== null ? HP.money(loPrice) : "—"}</div>
        <div class="stat-label">${loPrice !== null && loPrice !== hiPrice ? `Up to ${HP.money(hiPrice)} / head` : "Per head"}</div>
      </div>`)) HP.countUp(statsEl);

    // ── Filter chips — family first, then status ─────────────────────
    const TYPE_FILTERS = [
      { key: "all", label: "All types", count: all.length },
      ...PKG_TYPES.map((t) => ({
        key: t,
        label: typeShort(t),
        count: all.filter((p) => pkgType(p) === t).length,
      })),
    ];
    const FILTERS = [
      { key: "all",      label: "All",      count: all.length },
      { key: "active",   label: "Active",   count: activeCount },
      { key: "inactive", label: "Inactive", count: inactiveCount },
    ];
    toolbarEl.innerHTML =
      TYPE_FILTERS.map((f) =>
        `<button class="chip-filter ${typeFilter === f.key ? "active" : ""}" data-pkg-type="${HP.esc(f.key)}">
           ${HP.esc(f.label)}<span class="seg-count">${f.count}</span>
         </button>`).join("") +
      `<span class="chip-sep" aria-hidden="true"></span>` +
      FILTERS.map((f) =>
        `<button class="chip-filter ${statusFilter === f.key ? "active" : ""}" data-pkg-filter="${HP.esc(f.key)}">
           ${f.label}<span class="seg-count">${f.count}</span>
         </button>`).join("");
    toolbarEl.querySelectorAll("[data-pkg-type]").forEach((b) =>
      b.addEventListener("click", () => { typeFilter = b.dataset.pkgType; render(); }));
    toolbarEl.querySelectorAll("[data-pkg-filter]").forEach((b) =>
      b.addEventListener("click", () => { statusFilter = b.dataset.pkgFilter; render(); }));

    // ── Filtered list ─────────────────────────────────────────────────
    let list = all.slice();
    if (typeFilter !== "all")        list = list.filter((p) => pkgType(p) === typeFilter);
    if (statusFilter === "active")   list = list.filter((p) =>  p.active);
    if (statusFilter === "inactive") list = list.filter((p) => !p.active);
    if (searchTerm) list = list.filter((p) =>
      (p.name + " " + (p.desc || "") + " " + pkgType(p)).toLowerCase().includes(searchTerm));

    // ── Cards ─────────────────────────────────────────────────────────
    HP.shell.paint(gridEl, list.length ? list.map((p) => `
      <div class="pkg-card">
        ${p.image
          ? `<img class="pkg-photo" src="${HP.esc(p.image)}" alt="${HP.esc(p.name)}" loading="lazy">`
          : `<div class="pkg-photo pkg-photo--empty"><span class="ic">${HP.icon("photo")}</span></div>`}
        <div class="pkg-head">
          <div>
            <h3>${HP.esc(p.name)}</h3>
            <div class="pkg-meta">${HP.esc(typeShort(pkgType(p)))} · Min. ${HP.esc(p.minPax)} pax</div>
            ${isInstitutional(p.name)
              ? `<span class="badge badge-gold" style="margin-top:7px">Church · Gov't · School only</span>`
              : ""}
          </div>
          ${p.active
            ? `<span class="badge badge-ok"><span class="dot"></span>Active</span>`
            : `<span class="badge badge-muted">Inactive</span>`}
        </div>
        <div class="pkg-price">${HP.money(p.price)}<small> / head</small></div>
        <div class="pkg-incl-summary">
          <span class="ic">${HP.icon("box")}</span>
          <span>${p.inclusions.length
            ? `<strong>${p.inclusions.length}</strong> ${p.inclusions.length === 1 ? "inclusion" : "inclusions"}`
            : isCatering(pkgType(p)) ? "Standard services only" : "No inclusions yet"}</span>
        </div>
        <div class="card-foot">
          <button class="btn btn-ghost btn-sm" data-view="${p.id}">
            <span class="ic">${HP.icon("eye")}</span>View
          </button>
          <button class="btn btn-ghost btn-sm" data-edit="${p.id}">
            <span class="ic">${HP.icon("edit")}</span>Edit
          </button>
          <button class="icon-btn danger pkg-del" data-del="${p.id}" title="Delete package" aria-label="Delete package">
            <span class="ic">${HP.icon("trash")}</span>
          </button>
        </div>
      </div>`).join("") : `
      <div class="empty empty--soft">
        <span class="ic">${HP.icon("box")}</span>
        <p>${searchTerm || statusFilter !== "all" ? "No packages match." : "No packages yet."}</p>
      </div>`);

    gridEl.querySelectorAll("[data-view]").forEach((b) =>
      b.addEventListener("click", () => viewPackage(b.dataset.view)));
    gridEl.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => packageModal(b.dataset.edit)));
    gridEl.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", () => delPackage(b.dataset.del)));
  }

  // ── Read-only detail view ─────────────────────────────────────────────
  // The card is a compact preview (name · pax · price · inclusions); the full
  // breakdown — including the standard services every catering package
  // carries — lives here so the grid stays scannable. Food packs are a
  // different service model, so no standard-services section for them.
  function viewPackage(id) {
    const p = HP.store.DB.packages.find((x) => x.id === id);
    if (!p) return;

    const catering = isCatering(pkgType(p));
    const stdItems = catering && p.desc
      ? p.desc.split("\n").map((line) =>
          `<li><span class="ic">${HP.icon("check")}</span>${HP.esc(line)}</li>`).join("")
      : "";
    const inclItems = p.inclusions.length
      ? p.inclusions.map((i) =>
          `<li><span class="ic">${HP.icon("check")}</span>${renderInclText(i)}</li>`).join("")
      : `<li class="pkg-view-none">${catering
          ? "None — this package uses the standard services only."
          : "None yet."}</li>`;

    HP.openModal(p.name, `
      <div class="pkg-view">
        ${p.image ? `<img class="pkg-photo" src="${HP.esc(p.image)}" alt="${HP.esc(p.name)}">` : ""}
        <div class="pkg-view-top">
          <div class="pkg-price">${HP.money(p.price)}<small> / head</small></div>
          <div class="pkg-meta">${HP.esc(pkgType(p))} · Min. ${HP.esc(p.minPax)} pax · ${p.active ? "Active in app" : "Hidden from app"}</div>
          ${isInstitutional(p.name)
            ? `<div class="pkg-meta" style="margin-top:6px;color:var(--gold-deep)">${INSTITUTIONAL_NOTE}</div>`
            : ""}
        </div>
        <div class="pkg-view-sec">
          <h4>Inclusions</h4>
          <ul class="pkg-incl">${inclItems}</ul>
        </div>
        ${stdItems ? `<div class="pkg-view-sec">
          <h4>Standard services</h4>
          <ul class="pkg-incl pkg-std">${stdItems}</ul>
        </div>` : ""}
      </div>`,
      `<button class="btn btn-ghost" data-close>Close</button>
       <button class="btn btn-primary" id="viewEdit"><span class="ic">${HP.icon("edit")}</span>Edit</button>`);

    document.getElementById("viewEdit").addEventListener("click", () => {
      HP.closeModal();
      packageModal(id);
    });
  }

  // Split an inclusion string on " or " and wrap each alternative so the
  // "or" keyword can be styled distinctly in the card.
  function renderInclText(raw) {
    const parts = raw.split(/ or /i);
    if (parts.length < 2) return HP.esc(raw);
    return parts.map(HP.esc).join('<span class="pkg-or">or</span>');
  }

  // Standard services carried by every catering package (stored in `desc`).
  // Food packs are pickup/delivery style, so they don't get these.
  const DEFAULT_DESC = [
    "Professional uniformed service staff assigned to attend to guests throughout the event.",
    "Elegantly dressed tables adorned with toppers aligned to the client's chosen motif.",
    "Personalized table number placements.",
    "Complimentary centerpiece arrangement for each table.",
    "Chairs provided with coordinated covers and accent details.",
    "Complimentary purified drinking water served to all guests.",
    "Roll-up chafing dishes for buffet food service.",
    "Fully sanitized and polished dinnerware, glassware, and flatware.",
  ].join("\n");

  // ── Create / edit ────────────────────────────────────────────────────
  function packageModal(id) {
    const DB = HP.store.DB;
    const p = id ? DB.packages.find((x) => x.id === id) : null;
    let image = p ? (p.image || "") : "";
    HP.openModal(id ? "Edit package" : "New package", `
      <form id="pkgForm" novalidate>
        <div class="field"><label>Name <span class="req">*</span></label>
          <input class="control" name="name" value="${p ? HP.esc(p.name) : ""}" placeholder="e.g. Salu-Salo Package" required>
          <div class="field-hint" id="instHint" hidden>This is the <strong>Hapag Serbisyo</strong> institutional package — the app marks it "${INSTITUTIONAL_NOTE.toLowerCase()}" and restricts its bookings to those three function kinds.</div>
          <div class="field-error" data-err="name" hidden></div></div>
        <div class="field"><label>Type</label>
          <select class="control" name="type">
            ${PKG_TYPES.map((t) =>
              `<option value="${HP.esc(t)}" ${p && pkgType(p) === t ? "selected" : ""}>${HP.esc(t)}</option>`).join("")}
          </select>
          <div class="field-hint">Which shelf of the app's Packages screen this appears on.</div></div>
        <div class="field"><label>Photo</label>
          <div class="uploader">
            <div class="uploader-preview" id="pkgPreview"></div>
            <div class="uploader-side">
              <button type="button" class="btn btn-ghost btn-sm" id="pickPkgImg">
                <span class="ic">${HP.icon("upload")}</span>Upload photo
              </button>
              <button type="button" class="btn btn-danger btn-sm" id="clearPkgImg" hidden>
                <span class="ic">${HP.icon("trash")}</span>Remove
              </button>
              <input type="file" id="pkgImgFile" accept="image/*" hidden>
            </div>
          </div>
          <div class="field-hint">Shown on the package card in the app. JPG or PNG — large images are resized automatically.</div></div>
        <div class="field-row">
          <div class="field"><label>Price / head (${HP.esc(DB.settings.currency)}) <span class="req">*</span></label>
            <input class="control" name="price" type="number" min="0" value="${p ? p.price : ""}" placeholder="0" required>
            <div class="field-error" data-err="price" hidden></div></div>
          <div class="field"><label>Minimum pax</label>
            <input class="control" name="minPax" type="number" min="1" value="${p ? p.minPax : CATERING_MIN_PAX}">
            <div class="field-hint">Starting minimum guest count for this package — raise it if it needs to scale higher.</div>
            <div class="field-error" data-err="minPax" hidden></div></div>
        </div>
        <div class="field" id="stdField">
          <label>Standard Services</label>
          <div class="std-services">
            ${DEFAULT_DESC.split("\n").map((line) =>
              `<div class="std-service-item"><span class="ic">${HP.icon("check")}</span>${HP.esc(line)}</div>`
            ).join("")}
          </div>
          <div class="field-hint">Always included in every catering package automatically — food packs use a different service model, so this section disappears for them.</div>
        </div>
        <div class="field">
          <label>Inclusions</label>
          <div class="field-hint" style="margin-top:0;margin-bottom:10px">Pick from the menu categories of this package's type — manage the choices on the <strong>Categories</strong> page.</div>
          <div class="incl-list" id="inclList"></div>
          <button type="button" class="btn btn-ghost btn-sm incl-add-row" id="addInclRow">
            <span class="ic">${HP.icon("plus")}</span>Add item
          </button>
          <div class="field-hint">Hit <strong>+ or</strong> on any item to offer a guest choice — e.g. Grilled <em>or</em> Seafood.</div>
        </div>
        <label class="switch">
          <input type="checkbox" name="active" ${!p || p.active ? "checked" : ""}>
          <span class="track"></span>
          <span class="switch-label">Visible in app</span>
        </label>
      </form>`,
      `<button class="btn btn-ghost" data-close>Cancel</button>
       <button class="btn btn-primary" id="savePkg">${id ? "Save changes" : "Add package"}</button>`);

    const inclList = document.getElementById("inclList");

    // ── Photo uploader (mirrors the Setups / Products uploader) ──────────
    const pkgPreview   = document.getElementById("pkgPreview");
    const clearPkgBtn  = document.getElementById("clearPkgImg");
    const pkgFileInput = document.getElementById("pkgImgFile");

    function renderPkgPreview() {
      if (image) {
        pkgPreview.innerHTML = `<img src="${HP.esc(image)}" alt="">`;
        pkgPreview.classList.add("has-img");
      } else {
        pkgPreview.innerHTML = `<span class="ic">${HP.icon("photo")}</span>`;
        pkgPreview.classList.remove("has-img");
      }
      clearPkgBtn.hidden = !image;
    }
    renderPkgPreview();

    document.getElementById("pickPkgImg").addEventListener("click", () => pkgFileInput.click());
    clearPkgBtn.addEventListener("click", () => { image = ""; pkgFileInput.value = ""; renderPkgPreview(); });
    pkgFileInput.addEventListener("change", () => {
      const file = pkgFileInput.files && pkgFileInput.files[0];
      if (!file) return;
      HP.compressImage(file).then((dataUrl) => {
        image = dataUrl; renderPkgPreview();
        const hint = pkgPreview.closest(".field").querySelector(".field-hint");
        if (hint) hint.textContent = `Image ready — ${Math.round(dataUrl.length / 1024)} KB stored inline.`;
      }).catch((err) => HP.toast(err && err.message === "image too large"
        ? "That photo can't be squeezed under the storage budget — try a smaller or simpler image."
        : "Couldn't read that image.", "danger"));
    });

    // ── Inclusion picker — options come from the Categories page ────────
    const form = document.getElementById("pkgForm");
    const stdField = document.getElementById("stdField");
    const choicesNow = () => inclChoices(form.type.value);

    // <option> list for one select. A legacy value not among the current
    // categories is kept as its own entry so editing old packages (or
    // switching type back and forth) never silently drops data.
    function optionsHtml(selected) {
      const opts = choicesNow();
      return `<option value="">Choose a category…</option>` +
        (selected && !opts.includes(selected)
          ? `<option value="${HP.esc(selected)}" selected>${HP.esc(selected)}</option>` : "") +
        opts.map((n) =>
          `<option value="${HP.esc(n)}" ${n === selected ? "selected" : ""}>${HP.esc(n)}</option>`).join("");
    }

    // Build one inclusion row. `text` is the stored string e.g. "Beef or Seafood".
    function addRow(text) {
      const parts = text ? text.split(/ or /i).map((s) => s.trim()) : [""];
      const row = document.createElement("div");
      row.className = "incl-row";
      row.innerHTML = `
        <div class="incl-opts">
          ${parts.map((v, i) => `
            ${i > 0 ? `<span class="incl-or-badge">OR</span>` : ""}
            <select class="control incl-opt">${optionsHtml(v)}</select>
          `).join("")}
          <button type="button" class="btn btn-ghost btn-sm incl-add-or">+ or</button>
        </div>
        <button type="button" class="icon-btn danger incl-del-row" title="Remove">
          <span class="ic">${HP.icon("trash")}</span>
        </button>`;
      row.querySelector(".incl-add-or").addEventListener("click", () => {
        const optsEl   = row.querySelector(".incl-opts");
        const addOrBtn = optsEl.querySelector(".incl-add-or");
        const badge = document.createElement("span");
        badge.className = "incl-or-badge";
        badge.textContent = "OR";
        const sel = document.createElement("select");
        sel.className = "control incl-opt";
        sel.innerHTML = optionsHtml("");
        optsEl.insertBefore(badge, addOrBtn);
        optsEl.insertBefore(sel, addOrBtn);
        sel.focus();
      });
      row.querySelector(".incl-del-row").addEventListener("click", () => row.remove());
      inclList.appendChild(row);
    }

    // Seed rows from existing inclusions when editing, or one blank row when creating.
    (p && p.inclusions.length ? p.inclusions : [""]).forEach(addRow);

    // Type drives the standard-services block (catering only), the minimum
    // pax default (50 for catering, 20 for food packs — both editable), and
    // the category choices offered in every inclusion select. The default
    // only overwrites the field until the admin types a value of their own,
    // so switching type back and forth never clobbers a deliberate entry.
    const minPaxInput = form.minPax;
    let minPaxTouched = !!p;
    minPaxInput.addEventListener("input", () => { minPaxTouched = true; });
    function syncType() {
      const catering = isCatering(form.type.value);
      stdField.hidden = !catering;
      if (!minPaxTouched) minPaxInput.value = catering ? CATERING_MIN_PAX : FOOD_PACK_MIN_PAX;
      inclList.querySelectorAll(".incl-opt").forEach((sel) => {
        sel.innerHTML = optionsHtml(sel.value);
      });
    }
    form.type.addEventListener("change", syncType);
    syncType();

    // Surface the institutional restriction as soon as the name says
    // "serbisyo", so a rename in either direction shows its consequence.
    const instHint = document.getElementById("instHint");
    const syncInstHint = () => { instHint.hidden = !isInstitutional(form.name.value); };
    form.name.addEventListener("input", syncInstHint);
    syncInstHint();

    document.getElementById("addInclRow").addEventListener("click", () => {
      addRow("");
      inclList.lastElementChild.querySelector(".incl-opt").focus();
    });

    document.getElementById("savePkg").addEventListener("click", () => {
      const f = document.getElementById("pkgForm");
      const name = f.name.value.trim(), price = f.price.value.trim();
      const catering = isCatering(f.type.value);
      const minPaxFloor = catering ? CATERING_MIN_PAX : FOOD_PACK_MIN_PAX;
      let ok = true;
      ok = HP.setErr(f, "name", name ? "" : "Name is required.") && ok;
      ok = HP.setErr(f, "price", price === "" || Number(price) < 0 ? "Enter a valid price." : "") && ok;
      ok = HP.setErr(f, "minPax", Number(f.minPax.value) < minPaxFloor
        ? `${catering ? "Catering" : "Food pack"} packages need at least ${minPaxFloor} pax.` : "") && ok;
      if (!ok) return;
      const inclusions = [...inclList.querySelectorAll(".incl-row")].map((row) =>
        [...row.querySelectorAll(".incl-opt")]
          .map((i) => i.value.trim()).filter(Boolean).join(" or ")
      ).filter(Boolean);
      const payload = {
        name, type: f.type.value, image,
        price: Number(price),
        minPax: Number(f.minPax.value) || 1,
        // Standard services (`desc`) apply to catering only — food packs are
        // a different service model, so the app hides that section for them.
        desc: catering ? DEFAULT_DESC : "",
        inclusions,
        active: f.active.checked,
      };
      // Save against the LIVE store — a background refetch may have replaced
      // the copy captured when the modal opened, and a write into that orphan
      // would land in Firestore but never on screen (or in the cache).
      const DB = HP.store.DB;
      let rec;
      if (p) {
        rec = Object.assign(p, payload);
        if (!DB.packages.some((x) => x.id === p.id)) DB.packages.push(rec); // vanished mid-edit — re-attach
      } else { rec = { id: HP.uid(), ...payload }; DB.packages.push(rec); }
      HP.store.persist("packages", rec);
      HP.closeModal();
      HP.toast(id ? "Package updated." : `"${name}" added.`);
      render();
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────
  function delPackage(id) {
    const DB = HP.store.DB;
    const p = DB.packages.find((x) => x.id === id);
    if (!p) return;
    HP.confirmModal("Delete package",
      `Move the "${p.name}" package to the Trash? It leaves the app right away — restore it any time from Settings.`, () => {
      // Fade the card out first, so the deletion reads as "this one left".
      const btn = gridEl.querySelector(`[data-del="${id}"]`);
      HP.animateOut(btn && btn.closest(".pkg-card")).then(() => {
        HP.store.softRemove("packages", id);
        HP.toast("Package moved to Trash — restore it from Settings.", "warn");
        render();
      });
    });
  }
})();
