/* HapagPamana · Content Moderator — Announcements & Events.
   Full CRUD for announcements, promotions, discount notices, and events stored in Firestore.
   Synchronizes live with Firestore and updates Flutter user home page in real time. */
(function () {
  "use strict";
  const HP = window.HP;
  const FB = HP.FB;
  const ONLINE = HP.ONLINE;
  const toast = HP.toast;

  HP.shell.init();
  HP.shell.setPage({
    title: "Announcements & Events",
    sub: "Manage notices, promos & discounts, upcoming celebrations, and event bulletins shown in the app.",
    search: true,
    action: { label: "New announcement", fn: () => announcementModal() },
  });

  const STATUSES = [
    { key: "all", label: "All" },
    { key: "published", label: "Published" },
    { key: "draft", label: "Drafts" },
    { key: "archived", label: "Archived" },
  ];

  let statusFilter = "all";
  let searchTerm = "";
  let announcements = [];
  let unsubscribe = null;

  const tabsEl = document.getElementById("statusTabs");
  const toolbarEl = document.getElementById("annToolbar");
  const gridEl = document.getElementById("annRows");

  HP.shell.onSearch((term) => {
    searchTerm = (term || "").toLowerCase().trim();
    render();
  });

  function startListener() {
    if (!ONLINE || !FB || !FB.db) {
      try {
        const raw = localStorage.getItem("hp_demo_announcements");
        announcements = raw ? JSON.parse(raw) : [];
      } catch {
        announcements = [];
      }
      render();
      return;
    }

    gridEl.innerHTML = HP.skel.cards(6);
    const col = FB.db.collection("announcements");
    unsubscribe = col.onSnapshot(
      (snap) => {
        announcements = snap.docs.map((doc) => {
          const data = doc.data() || {};
          return {
            id: doc.id,
            ...data,
          };
        });
        // Sort newest first
        announcements.sort((a, b) => {
          const tA = (a.createdAt && a.createdAt.toMillis) ? a.createdAt.toMillis() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const tB = (b.createdAt && b.createdAt.toMillis) ? b.createdAt.toMillis() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return tB - tA;
        });
        render();
      },
      (err) => {
        console.warn("HapagPamana: Firestore live listener warning:", err);
        col.get().then((snap) => {
          announcements = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
          render();
        }).catch((e) => {
          console.error("HapagPamana: Firestore get failed:", e);
          try {
            const raw = localStorage.getItem("hp_demo_announcements");
            announcements = raw ? JSON.parse(raw) : [];
          } catch {
            announcements = [];
          }
          render();
          const denied = err && err.code === "permission-denied";
          toast(denied
            ? "Database access denied — check your Firestore security rules."
            : "Couldn't reach Firestore announcements. Running in local mode.", "warn");
        });
      }
    );
  }

  HP.ready.then(() => {
    startListener();
  });

  function renderTabs() {
    tabsEl.innerHTML = STATUSES.map((s) => {
      let count = announcements.length;
      if (s.key !== "all") {
        count = announcements.filter((a) => (a.status || "draft") === s.key).length;
      }
      return `<button class="seg-btn ${s.key === statusFilter ? "active" : ""}" role="tab"
                aria-selected="${s.key === statusFilter}" data-status="${s.key}">
                ${s.label}<span class="seg-count">${count}</span></button>`;
    }).join("");

    tabsEl.querySelectorAll("[data-status]").forEach((b) => {
      b.addEventListener("click", () => {
        statusFilter = b.dataset.status;
        render();
      });
    });
  }

  function formatDisplayDate(item) {
    const start = (item.eventDate || "").trim();
    const end = (item.endDate || "").trim();
    if (start && end && start !== end) return `${start} – ${end}`;
    if (start) return start;
    if (end) return `Until ${end}`;
    return "";
  }

  function render() {
    renderTabs();

    let list = [...announcements];
    if (statusFilter !== "all") {
      list = list.filter((a) => (a.status || "draft") === statusFilter);
    }
    if (searchTerm) {
      list = list.filter((a) => {
        const title = (a.title || "").toLowerCase();
        const desc = (a.description || "").toLowerCase();
        const loc = (a.location || "").toLowerCase();
        const cat = (a.category || "").toLowerCase();
        return title.includes(searchTerm) || desc.includes(searchTerm) || loc.includes(searchTerm) || cat.includes(searchTerm);
      });
    }

    if (toolbarEl) {
      toolbarEl.innerHTML = `<span style="font-size:13px; color:var(--ink-soft);">Showing <strong>${list.length}</strong> item${list.length === 1 ? "" : "s"}</span>`;
    }

    if (!list.length) {
      gridEl.innerHTML = `
        <div class="empty empty--soft" style="grid-column: 1 / -1; text-align:center; padding: 48px 20px;">
          <p style="margin:0 0 12px 0; font-size:16px; color:var(--ink-soft);">No announcements found.</p>
          <button class="btn btn-primary btn-sm" id="btnEmptyCreate">Create Announcement</button>
        </div>`;
      const btn = document.getElementById("btnEmptyCreate");
      if (btn) btn.addEventListener("click", () => announcementModal());
      return;
    }

    HP.shell.paint(
      gridEl,
      list.map((item) => {
        const status = item.status || "draft";
        const badgeClass = status === "published" ? "published" : status === "archived" ? "archived" : "draft";
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
        const image = item.imageUrl || item.image || "";
        const dateStr = formatDisplayDate(item);
        const category = (item.category || "announcement").toLowerCase();
        const categoryLabel = category === "promo" ? "PROMO" : category === "event" ? "EVENT" : "NOTICE";

        const hasDisc = Boolean(item.hasDiscount || item.discountPercent || item.discountAmount);
        const discLabel = item.discountPercent ? `${item.discountPercent}% OFF` : item.discountAmount ? `${HP.money(item.discountAmount)} OFF` : "";
        const targetPkgs = Array.isArray(item.targetPackages) ? item.targetPackages.filter(Boolean) : [];
        const targetCats = Array.isArray(item.targetCategories) ? item.targetCategories.filter(Boolean) : [];

        return `
          <div class="ann-card" data-id="${item.id}">
            <div class="ann-thumb-wrap">
              ${
                image
                  ? `<img class="ann-thumb-img" src="${HP.esc(image)}" alt="${HP.esc(item.title)}" loading="lazy">`
                  : `<div class="ann-thumb-fallback"><span class="ic">${HP.icon(category === "promo" ? "tag" : "calendar")}</span></div>`
              }
            </div>
            <div class="ann-card-head">
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">
                  <span class="status-badge ${badgeClass}">${statusLabel}</span>
                  <span class="status-badge" style="background:var(--vellum); color:var(--gold-deep);">${categoryLabel}</span>
                  ${hasDisc && discLabel ? `<span class="status-badge promo-badge"><span class="ic">${HP.icon("tag")}</span>${discLabel}</span>` : ""}
                </div>
                <h3 class="ann-title">${HP.esc(item.title || "Untitled Announcement")}</h3>
                <div class="ann-meta-pills">
                  ${dateStr ? `<span class="ann-meta-pill"><span class="ic">${HP.icon("calendar")}</span>${HP.esc(dateStr)}</span>` : ""}
                  ${item.eventTime ? `<span class="ann-meta-pill"><span class="ic">${HP.icon("clock")}</span>${HP.esc(item.eventTime)}</span>` : ""}
                  ${item.location ? `<span class="ann-meta-pill"><span class="ic">${HP.icon("pin")}</span>${HP.esc(item.location)}</span>` : ""}
                  ${targetPkgs.length ? `<span class="ann-meta-pill" title="Applies to packages"><span class="ic">${HP.icon("box")}</span>${HP.esc(targetPkgs.join(", "))}</span>` : ""}
                  ${targetCats.length ? `<span class="ann-meta-pill" title="Applies to food categories"><span class="ic">${HP.icon("basket")}</span>${HP.esc(targetCats.join(", "))}</span>` : ""}
                </div>
              </div>
            </div>
            <p class="ann-desc">${HP.esc(item.description || "No description provided.")}</p>
            <div class="ann-foot">
              <div style="display:flex; gap:6px;">
                <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${item.id}"><span class="ic">${HP.icon("edit")}</span>Edit</button>
                ${
                  status !== "published"
                    ? `<button class="btn btn-ghost btn-sm" data-action="publish" data-id="${item.id}"><span class="ic">${HP.icon("check")}</span>Publish</button>`
                    : `<button class="btn btn-ghost btn-sm" data-action="archive" data-id="${item.id}"><span class="ic">${HP.icon("ban")}</span>Archive</button>`
                }
              </div>
              <button class="icon-btn danger" data-action="delete" data-id="${item.id}" title="Delete announcement" aria-label="Delete announcement">
                <span class="ic">${HP.icon("trash")}</span>
              </button>
            </div>
          </div>`;
      }).join("")
    );

    // Event listeners
    gridEl.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.dataset.action;
        const id = btn.dataset.id;
        const item = announcements.find((a) => a.id === id);
        if (!item) return;

        if (act === "edit") announcementModal(item);
        else if (act === "publish") setStatus(item, "published");
        else if (act === "archive") setStatus(item, "archived");
        else if (act === "delete") confirmDelete(item);
      });
    });
  }

  async function setStatus(item, newStatus) {
    const patch = {
      status: newStatus,
      active: newStatus === "published",
      updatedAt: (ONLINE && firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString(),
    };
    if (newStatus === "published" && !item.publishedAt) {
      patch.publishedAt = (ONLINE && firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString();
    }

    if (ONLINE && FB && FB.db) {
      try {
        await FB.db.collection("announcements").doc(item.id).update(patch);
        toast(`Announcement ${newStatus === "published" ? "published" : "archived"}.`, "ok");
      } catch (err) {
        console.error("Status update error:", err);
        toast("Failed to update announcement status.", "danger");
      }
    } else {
      Object.assign(item, patch);
      localStorage.setItem("hp_demo_announcements", JSON.stringify(announcements));
      toast(`Announcement ${newStatus} (demo mode).`, "ok");
      render();
    }
  }

  function confirmDelete(item) {
    HP.confirmModal(
      "Delete Announcement",
      `Are you sure you want to permanently delete "${item.title || "this announcement"}"?`,
      async () => {
        if (ONLINE && FB && FB.db) {
          try {
            await FB.db.collection("announcements").doc(item.id).delete();
            toast("Announcement deleted.", "ok");
          } catch (err) {
            console.error("Delete error:", err);
            toast("Failed to delete announcement.", "danger");
          }
        } else {
          announcements = announcements.filter((a) => a.id !== item.id);
          localStorage.setItem("hp_demo_announcements", JSON.stringify(announcements));
          toast("Announcement deleted (demo mode).", "ok");
          render();
        }
      },
      true
    );
  }

  function announcementModal(existing = null) {
    const isEdit = Boolean(existing);
    let imageValue = (existing && (existing.imageUrl || existing.image)) || "";
    const category = (existing && (existing.category || existing.type)) || "promo";

    const hasDiscount = existing
      ? Boolean(existing.hasDiscount || existing.discountPercent || existing.discountAmount)
      : (category === "promo");
    const discountType = (existing && existing.discountType) || "percent";
    const discountVal = (existing && (existing.discountPercent || existing.discountAmount)) || (category === "promo" && !existing ? 20 : "");
    const discountScope = (existing && existing.discountScope) || "all";
    const targetPackages = (existing && Array.isArray(existing.targetPackages) ? existing.targetPackages : []);
    const targetCategories = (existing && Array.isArray(existing.targetCategories) ? existing.targetCategories : []);
    const promoCode = (existing && existing.promoCode) || "";

    // Available packages and categories from store or fallback
    const allPackages = (HP.store && HP.store.DB && HP.store.DB.packages && HP.store.DB.packages.length)
      ? HP.store.DB.packages.filter(p => !p.deleted).map(p => p.name)
      : ["Hapag Kabataan", "Hapag Pamilya", "Hapag Handaan", "Hapag Serbisyo", "Food Pack A", "Food Pack B", "Food Pack C"];

    const allCategories = (HP.store && HP.store.DB && HP.store.DB.categories && HP.store.DB.categories.length)
      ? Array.from(new Set(HP.store.DB.categories.filter(c => !c.deleted).map(c => c.name)))
      : ["Seafood", "Beef", "Pork", "Chicken", "Fish", "Appetizer", "Soup", "Salad", "Pasta", "Noodles", "Sandwich", "Vegetables", "Rice", "Dessert", "Drinks"];

    const bodyHTML = `
      <form id="annForm" style="display:flex; flex-direction:column; gap:16px;">
        <div class="field">
          <label>Title <span style="color:var(--danger)">*</span></label>
          <input class="control" id="annTitle" required placeholder="e.g. Ber Months Discount or Teachers' Day" value="${HP.esc((existing && existing.title) || "")}">
        </div>

        <div class="field">
          <label>Description <span style="color:var(--danger)">*</span></label>
          <textarea class="control" id="annDesc" rows="4" required placeholder="e.g. 50% Discount to all desserts until Sept 15!">${HP.esc((existing && existing.description) || "")}</textarea>
        </div>

        <div class="form-grid-2">
          <div class="field">
            <label>Type / Category</label>
            <select class="control" id="annCategory">
              <option value="promo" ${category === "promo" ? "selected" : ""}>Special Promo / Discount</option>
              <option value="event" ${category === "event" ? "selected" : ""}>Event / Celebration</option>
              <option value="announcement" ${category === "announcement" ? "selected" : ""}>General Announcement / Notice</option>
            </select>
          </div>
          <div class="field">
            <label>Status</label>
            <select class="control" id="annStatus">
              <option value="draft" ${(existing && existing.status === "draft") || !existing ? "selected" : ""}>Draft (Admin Only)</option>
              <option value="published" ${existing && existing.status === "published" ? "selected" : ""}>Published (Live in App)</option>
              <option value="archived" ${existing && existing.status === "archived" ? "selected" : ""}>Archived</option>
            </select>
          </div>
        </div>

        <!-- Promo Discount Configuration Box -->
        <div class="discount-config-box" id="discountConfigBox" style="${category === "promo" || hasDiscount ? "" : "display:none;"}">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <label style="display:flex; align-items:center; gap:8px; font-weight:700; font-family:var(--display); color:var(--ink); cursor:pointer; margin:0;">
              <input type="checkbox" id="annEnableDiscount" ${hasDiscount ? "checked" : ""}>
              <span>Enable Promo Discount for Packages & Categories</span>
            </label>
            <span class="status-badge promo-badge">DISCOUNT RULES</span>
          </div>

          <div id="discountFieldsWrap" style="${hasDiscount ? "" : "display:none;"} display:flex; flex-direction:column; gap:12px; margin-top:4px;">
            <div class="form-grid-2">
              <div class="field">
                <label>Discount Value & Type</label>
                <div style="display:flex; gap:8px;">
                  <input class="control" id="annDiscountVal" type="number" min="1" step="any" style="flex:1;" placeholder="e.g. 20" value="${HP.esc(String(discountVal || ""))}">
                  <select class="control" id="annDiscountType" style="width:110px;">
                    <option value="percent" ${discountType === "percent" ? "selected" : ""}>% Off</option>
                    <option value="fixed" ${discountType === "fixed" ? "selected" : ""}>₱ Off / pax</option>
                  </select>
                </div>
                <small style="color:var(--ink-faint); font-size:11px;">e.g. 20 for 20% discount on selected items</small>
              </div>

              <div class="field">
                <label>Target Application Scope</label>
                <select class="control" id="annDiscountScope">
                  <option value="all" ${discountScope === "all" ? "selected" : ""}>All Packages & Food Categories</option>
                  <option value="specific" ${discountScope === "specific" ? "selected" : ""}>Selected Packages & Food Categories</option>
                  <option value="packages" ${discountScope === "packages" ? "selected" : ""}>Specific Packages Only</option>
                  <option value="categories" ${discountScope === "categories" ? "selected" : ""}>Specific Food Categories Only</option>
                </select>
                <small style="color:var(--ink-faint); font-size:11px;">Choose what receives this discount</small>
              </div>
            </div>

            <!-- Package Selection Chips -->
            <div class="field" id="packageChipsSection" style="${discountScope === "all" ? "display:none;" : ""}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; margin:0;">Eligible Packages (e.g. Hapag Kabataan)</label>
                <div style="display:flex; gap:8px; font-size:11px;">
                  <a href="javascript:void(0)" id="btnSelectAllPkgs" style="color:var(--gold-deep); text-decoration:none;">Select All</a>
                  <a href="javascript:void(0)" id="btnClearAllPkgs" style="color:var(--ink-faint); text-decoration:none;">Clear</a>
                </div>
              </div>
              <div class="discount-chip-grid" id="pkgChipGrid">
                ${allPackages.map(pkgName => {
                  const isChecked = targetPackages.includes(pkgName);
                  return `
                    <label class="discount-chip ${isChecked ? "active" : ""}">
                      <input type="checkbox" name="targetPkg" value="${HP.esc(pkgName)}" ${isChecked ? "checked" : ""}>
                      <span class="ic">${HP.icon("box")}</span>
                      <span>${HP.esc(pkgName)}</span>
                    </label>
                  `;
                }).join("")}
              </div>
            </div>

            <!-- Category Selection Chips -->
            <div class="field" id="categoryChipsSection" style="${discountScope === "all" ? "display:none;" : ""}">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label style="font-size:12px; margin:0;">Eligible Food Categories (e.g. Seafood, Beef)</label>
                <div style="display:flex; gap:8px; font-size:11px;">
                  <a href="javascript:void(0)" id="btnSelectAllCats" style="color:var(--gold-deep); text-decoration:none;">Select All</a>
                  <a href="javascript:void(0)" id="btnClearAllCats" style="color:var(--ink-faint); text-decoration:none;">Clear</a>
                </div>
              </div>
              <div class="discount-chip-grid" id="catChipGrid">
                ${allCategories.map(catName => {
                  const isChecked = targetCategories.includes(catName);
                  return `
                    <label class="discount-chip ${isChecked ? "active" : ""}">
                      <input type="checkbox" name="targetCat" value="${HP.esc(catName)}" ${isChecked ? "checked" : ""}>
                      <span class="ic">${HP.icon("basket")}</span>
                      <span>${HP.esc(catName)}</span>
                    </label>
                  `;
                }).join("")}
              </div>
            </div>
          </div>
        </div>

        <div class="form-grid-2">
          <div class="field">
            <label>Start Date / Event Date</label>
            <input class="control" id="annEventDate" type="date" value="${HP.esc((existing && (existing.eventDate || existing.startDate)) || "")}">
            <small style="color:var(--ink-faint); font-size:11px;">When the promo or event begins</small>
          </div>
          <div class="field">
            <label>End Date / Valid Until <span style="color:var(--ink-faint); font-weight:normal;">(optional)</span></label>
            <input class="control" id="annEndDate" type="date" value="${HP.esc((existing && (existing.endDate || existing.validUntil)) || "")}">
            <small style="color:var(--ink-faint); font-size:11px;">e.g. Sept 15 (leave empty for ongoing promo)</small>
          </div>
        </div>

        <div class="form-grid-2">
          <div class="field">
            <label>Event Time <span style="color:var(--ink-faint); font-weight:normal;">(optional)</span></label>
            <input class="control" id="annEventTime" placeholder="e.g. 10:00 AM – 8:00 PM" value="${HP.esc((existing && existing.eventTime) || "")}">
          </div>
          <div class="field">
            <label>Location / Venue <span style="color:var(--ink-faint); font-weight:normal;">(optional)</span></label>
            <input class="control" id="annLocation" placeholder="e.g. All Branches, Dining Hall, or Online" value="${HP.esc((existing && existing.location) || "")}">
          </div>
        </div>

        <div class="field">
          <label>Banner Image / Poster <span style="color:var(--ink-faint); font-weight:normal;">(optional)</span></label>
          <div class="image-dropzone" id="annDropzone">
            <input type="file" id="annFileInput" accept="image/*" style="display:none;">
            <p style="margin:0; font-size:14px; color:var(--ink-soft);">
              Drag and drop a promo banner, or <strong>browse files</strong>
            </p>
            <small style="color:var(--ink-faint);">Automatically optimized for instant mobile display</small>
          </div>
          <div class="image-preview-box" id="annPreviewBox" ${imageValue ? "" : 'style="display:none;"'}>
            <img id="annPreviewImg" src="${HP.esc(imageValue)}" alt="Preview">
            <button type="button" class="btn-remove" id="annRemoveImg">Remove Image</button>
          </div>
        </div>
      </form>
    `;

    const footHTML = `
      <button class="btn btn-ghost" data-close type="button">Cancel</button>
      <button class="btn btn-ghost" id="annSaveDraft" type="button">${isEdit ? "Save Changes" : "Save as Draft"}</button>
      <button class="btn btn-primary" id="annPublishNow" type="button">${isEdit && existing && existing.status === "published" ? "Update & Publish" : "Publish Now"}</button>
    `;

    HP.openModal(isEdit ? "Edit Announcement" : "Create Announcement", bodyHTML, footHTML);

    const dropzone = document.getElementById("annDropzone");
    const fileInput = document.getElementById("annFileInput");
    const previewBox = document.getElementById("annPreviewBox");
    const previewImg = document.getElementById("annPreviewImg");
    const removeBtn = document.getElementById("annRemoveImg");
    const btnDraft = document.getElementById("annSaveDraft");
    const btnPublish = document.getElementById("annPublishNow");

    const catSelect = document.getElementById("annCategory");
    const discBox = document.getElementById("discountConfigBox");
    const enableDiscCheck = document.getElementById("annEnableDiscount");
    const discFieldsWrap = document.getElementById("discountFieldsWrap");
    const discScopeSelect = document.getElementById("annDiscountScope");
    const pkgSec = document.getElementById("packageChipsSection");
    const catSec = document.getElementById("categoryChipsSection");

    // Dynamic visibility for promo discount
    if (catSelect && discBox) {
      catSelect.addEventListener("change", () => {
        if (catSelect.value === "promo") {
          discBox.style.display = "";
          enableDiscCheck.checked = true;
          discFieldsWrap.style.display = "flex";
        } else if (!enableDiscCheck.checked) {
          discBox.style.display = "none";
        }
      });
    }

    if (enableDiscCheck && discFieldsWrap) {
      enableDiscCheck.addEventListener("change", () => {
        discFieldsWrap.style.display = enableDiscCheck.checked ? "flex" : "none";
      });
    }

    function updateScopeSections() {
      const sc = discScopeSelect ? discScopeSelect.value : "all";
      if (pkgSec) pkgSec.style.display = (sc === "all" || sc === "categories") ? "none" : "";
      if (catSec) catSec.style.display = (sc === "all" || sc === "packages") ? "none" : "";
    }
    if (discScopeSelect) {
      discScopeSelect.addEventListener("change", updateScopeSections);
    }

    // Chip interactive click listeners
    function wireChips(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;
      container.querySelectorAll(".discount-chip").forEach(label => {
        const inp = label.querySelector("input");
        label.addEventListener("click", () => {
          setTimeout(() => {
            if (inp && inp.checked) label.classList.add("active");
            else label.classList.remove("active");
          }, 0);
        });
      });
    }
    wireChips("pkgChipGrid");
    wireChips("catChipGrid");

    const btnAllPkgs = document.getElementById("btnSelectAllPkgs");
    const btnClrPkgs = document.getElementById("btnClearAllPkgs");
    if (btnAllPkgs) {
      btnAllPkgs.addEventListener("click", () => {
        document.querySelectorAll('#pkgChipGrid input[name="targetPkg"]').forEach(i => {
          i.checked = true;
          i.closest(".discount-chip").classList.add("active");
        });
      });
    }
    if (btnClrPkgs) {
      btnClrPkgs.addEventListener("click", () => {
        document.querySelectorAll('#pkgChipGrid input[name="targetPkg"]').forEach(i => {
          i.checked = false;
          i.closest(".discount-chip").classList.remove("active");
        });
      });
    }

    const btnAllCats = document.getElementById("btnSelectAllCats");
    const btnClrCats = document.getElementById("btnClearAllCats");
    if (btnAllCats) {
      btnAllCats.addEventListener("click", () => {
        document.querySelectorAll('#catChipGrid input[name="targetCat"]').forEach(i => {
          i.checked = true;
          i.closest(".discount-chip").classList.add("active");
        });
      });
    }
    if (btnClrCats) {
      btnClrCats.addEventListener("click", () => {
        document.querySelectorAll('#catChipGrid input[name="targetCat"]').forEach(i => {
          i.checked = false;
          i.closest(".discount-chip").classList.remove("active");
        });
      });
    }

    if (dropzone && fileInput) {
      dropzone.addEventListener("click", () => fileInput.click());
      dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
      dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
      dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          processFile(e.dataTransfer.files[0]);
        }
      });
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files[0]) {
          processFile(fileInput.files[0]);
        }
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        imageValue = "";
        previewBox.style.display = "none";
        previewImg.src = "";
      });
    }

    if (btnDraft) {
      btnDraft.addEventListener("click", async () => {
        const ok = await handleSave(false);
        if (ok) HP.closeModal();
      });
    }

    if (btnPublish) {
      btnPublish.addEventListener("click", async () => {
        const ok = await handleSave(true);
        if (ok) HP.closeModal();
      });
    }

    function processFile(file) {
      HP.compressImage(file, { maxSize: 1200, quality: 0.85, budget: 600 * 1024 })
        .then((dataUrl) => {
          imageValue = dataUrl;
          previewImg.src = dataUrl;
          previewBox.style.display = "block";
        })
        .catch((err) => {
          console.error("Image compression error:", err);
          toast("Could not process image.", "danger");
        });
    }

    async function handleSave(forcePublish) {
      const titleInput = document.getElementById("annTitle");
      const descInput = document.getElementById("annDesc");
      const catInput = document.getElementById("annCategory");
      const dateInput = document.getElementById("annEventDate");
      const endDateInput = document.getElementById("annEndDate");
      const timeInput = document.getElementById("annEventTime");
      const locInput = document.getElementById("annLocation");
      const statusInput = document.getElementById("annStatus");

      const title = (titleInput.value || "").trim();
      const description = (descInput.value || "").trim();
      const category = catInput.value || "promo";
      const eventDate = (dateInput.value || "").trim();
      const endDate = (endDateInput.value || "").trim();
      const eventTime = (timeInput.value || "").trim();
      const location = (locInput.value || "").trim();
      let status = statusInput.value || "draft";

      if (forcePublish) status = "published";

      if (!title) {
        toast("Please provide an announcement title.", "warn");
        titleInput.focus();
        return false;
      }
      if (!description) {
        toast("Please provide a description.", "warn");
        descInput.focus();
        return false;
      }

      // Gather discount fields
      const isDiscEnabled = enableDiscCheck && enableDiscCheck.checked;
      const valInput = document.getElementById("annDiscountVal");
      const typeSelect = document.getElementById("annDiscountType");
      const scopeSelect = document.getElementById("annDiscountScope");

      const discVal = valInput ? parseFloat(valInput.value) : 0;
      const dType = typeSelect ? typeSelect.value : "percent";
      const dScope = scopeSelect ? scopeSelect.value : "all";

      const selPkgs = [];
      document.querySelectorAll('#pkgChipGrid input[name="targetPkg"]:checked').forEach(i => {
        selPkgs.push(i.value);
      });
      const selCats = [];
      document.querySelectorAll('#catChipGrid input[name="targetCat"]:checked').forEach(i => {
        selCats.push(i.value);
      });

      const uid = FB && FB.auth && FB.auth.currentUser ? FB.auth.currentUser.uid : null;
      const now = new Date();

      const docData = {
        title,
        description,
        category,
        imageUrl: imageValue,
        eventDate,
        endDate,
        eventTime,
        location,
        status,
        active: status === "published",
        updatedAt: (ONLINE && firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : now.toISOString(),
        updatedBy: uid,
      };

      if (isDiscEnabled && discVal > 0) {
        docData.hasDiscount = true;
        docData.discountType = dType;
        docData.discountScope = dScope;
        if (dType === "percent") {
          docData.discountPercent = discVal;
          docData.discountAmount = null;
        } else {
          docData.discountAmount = discVal;
          docData.discountPercent = null;
        }
        docData.targetPackages = dScope === "all" || dScope === "categories" ? [] : selPkgs;
        docData.targetCategories = dScope === "all" || dScope === "packages" ? [] : selCats;
      } else {
        docData.hasDiscount = false;
        docData.discountType = null;
        docData.discountPercent = null;
        docData.discountAmount = null;
        docData.discountScope = null;
        docData.targetPackages = [];
        docData.targetCategories = [];
      }

      if (status === "published") {
        if (!existing || !existing.publishedAt) {
          docData.publishedAt = (ONLINE && firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : now.toISOString();
        }
      }

      if (!isEdit) {
        docData.createdAt = (ONLINE && firebase && firebase.firestore) ? firebase.firestore.FieldValue.serverTimestamp() : now.toISOString();
        docData.createdBy = uid;
      }

      if (ONLINE && FB && FB.db) {
        try {
          if (isEdit) {
            await FB.db.collection("announcements").doc(existing.id).set(docData, { merge: true });
            toast("Announcement updated successfully.", "ok");
          } else {
            await FB.db.collection("announcements").add(docData);
            toast("Announcement created successfully.", "ok");
          }
        } catch (err) {
          console.error("Save announcement error:", err);
          toast("Failed to save announcement. Check permissions.", "danger");
          return false;
        }
      } else {
        if (isEdit) {
          Object.assign(existing, docData);
        } else {
          announcements.unshift({ id: "ann_" + Math.random().toString(36).slice(2, 9), ...docData });
        }
        localStorage.setItem("hp_demo_announcements", JSON.stringify(announcements));
        toast(`Announcement saved (demo mode).`, "ok");
        render();
      }

      return true;
    }
  }
})();
