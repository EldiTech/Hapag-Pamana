/* HapagPamana · Content Moderator — About, Legal & FAQ management.
   Allows editing the hero mantra, story narrative, milestone timeline,
   family sign-off, offerings, contact information, social links,
   Terms of Service clauses, Privacy Policy clauses, and Help & FAQ groups. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "About, Legal & FAQ",
    sub: "Manage the brand story, Terms of Service, Privacy Policy, and Help & FAQ.",
    search: false,
    action: null,
  });

  const aboutSaveBtn = document.getElementById("aboutSave");
  const aboutResetBtn = document.getElementById("aboutReset");
  const milestoneAddBtn = document.getElementById("milestoneAdd");
  const offerAddBtn = document.getElementById("offerAdd");
  const tosClauseAddBtn = document.getElementById("tosClauseAdd");
  const ppClauseAddBtn = document.getElementById("ppClauseAdd");
  const faqGroupAddBtn = document.getElementById("faqGroupAdd");

  const milestoneListEl = document.getElementById("milestoneList");
  const offerListEl = document.getElementById("offerList");
  const tosClauseListEl = document.getElementById("tosClauseList");
  const ppClauseListEl = document.getElementById("ppClauseList");
  const faqGroupListEl = document.getElementById("faqGroupList");

  let localAbout = null;
  let activeSection = "about";

  /* ── Section Tab Switching ───────────────────────────────────────────── */
  const tabBtns = document.querySelectorAll("[data-section-tab]");
  const panes = document.querySelectorAll("[data-section-pane]");

  function switchTab(target) {
    activeSection = target;
    tabBtns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sectionTab === target);
    });
    panes.forEach((pane) => {
      pane.hidden = pane.dataset.sectionPane !== target;
    });
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.sectionTab));
  });

  const initialHash = (location.hash || "").replace(/^#/, "").toLowerCase();
  if (["about", "tos", "privacy", "faq"].includes(initialHash)) {
    switchTab(initialHash);
  }

  HP.ready.then(initAbout);
  HP.onRefresh(initAbout);

  function ensureLegalDefaults(target) {
    const def = HP.DEFAULT_ABOUT;
    if (!target.termsOfService || !Array.isArray(target.termsOfService.clauses) || !target.termsOfService.clauses.length) {
      target.termsOfService = structuredClone(def.termsOfService);
    }
    if (!target.privacyPolicy || !Array.isArray(target.privacyPolicy.clauses) || !target.privacyPolicy.clauses.length) {
      target.privacyPolicy = structuredClone(def.privacyPolicy);
    }
    if (!Array.isArray(target.faqGroups) || !target.faqGroups.length) {
      target.faqGroups = structuredClone(def.faqGroups);
    }
    return target;
  }

  function getStoreAbout() {
    const db = HP.store.DB;
    const base = db && db.about ? structuredClone(db.about) : structuredClone(HP.DEFAULT_ABOUT);
    return ensureLegalDefaults(base);
  }

  function initAbout() {
    localAbout = getStoreAbout();
    populateForm();
  }

  function populateForm() {
    if (!localAbout) return;

    // Mantra
    document.getElementById("mantraEyebrow").value = (localAbout.mantra && localAbout.mantra.eyebrow) || "";
    document.getElementById("mantraQuote").value = (localAbout.mantra && localAbout.mantra.quote) || "";
    document.getElementById("mantraLabel").value = (localAbout.mantra && localAbout.mantra.label) || "";

    // Story
    document.getElementById("storyEyebrow").value = (localAbout.story && localAbout.story.eyebrow) || "";
    document.getElementById("storyTitle").value = (localAbout.story && localAbout.story.title) || "";
    document.getElementById("storyBody").value = (localAbout.story && localAbout.story.body) || "";
    document.getElementById("storyPullquote").value = (localAbout.story && localAbout.story.pullquote) || "";

    // Milestones section titles
    document.getElementById("milestonesEyebrow").value = localAbout.milestonesEyebrow || "";
    document.getElementById("milestonesTitle").value = localAbout.milestonesTitle || "";

    // Quote
    document.getElementById("quoteText").value = (localAbout.quote && localAbout.quote.text) || "";
    document.getElementById("quoteAuthor").value = (localAbout.quote && localAbout.quote.author) || "";

    // Offerings section
    document.getElementById("offeringsEyebrow").value = localAbout.offeringsEyebrow || "";
    document.getElementById("offeringsTitle").value = localAbout.offeringsTitle || "";
    document.getElementById("offeringsSubtitle").value = localAbout.offeringsSubtitle || "";

    // Contact
    document.getElementById("contactAddress").value = (localAbout.contact && localAbout.contact.address) || "";
    document.getElementById("contactMapQuery").value = (localAbout.contact && localAbout.contact.mapQuery) || "";
    document.getElementById("contactHours").value = (localAbout.contact && localAbout.contact.hours) || "";
    document.getElementById("contactPhone").value = (localAbout.contact && localAbout.contact.phone) || "";
    document.getElementById("contactEmail").value = (localAbout.contact && localAbout.contact.email) || "";

    // Social & Footer
    document.getElementById("socialFacebook").value = (localAbout.social && localAbout.social.facebook) || "";
    document.getElementById("socialInstagram").value = (localAbout.social && localAbout.social.instagram) || "";
    document.getElementById("socialTiktok").value = (localAbout.social && localAbout.social.tiktok) || "";
    document.getElementById("footerText").value = localAbout.footer || "";

    // Terms of Service
    document.getElementById("tosLastUpdated").value =
      (localAbout.termsOfService && localAbout.termsOfService.lastUpdated) || "";
    document.getElementById("tosLede").value =
      (localAbout.termsOfService && localAbout.termsOfService.lede) || "";

    // Privacy Policy
    document.getElementById("ppLastUpdated").value =
      (localAbout.privacyPolicy && localAbout.privacyPolicy.lastUpdated) || "";
    document.getElementById("ppLede").value =
      (localAbout.privacyPolicy && localAbout.privacyPolicy.lede) || "";

    renderMilestones();
    renderOffers();
    renderPolicyClauses("termsOfService", tosClauseListEl);
    renderPolicyClauses("privacyPolicy", ppClauseListEl);
    renderFaqGroups();
  }

  function collectFormValues() {
    if (!localAbout) localAbout = getStoreAbout();

    localAbout.mantra = {
      eyebrow: document.getElementById("mantraEyebrow").value.trim(),
      quote: document.getElementById("mantraQuote").value.trim(),
      label: document.getElementById("mantraLabel").value.trim(),
    };

    localAbout.story = {
      eyebrow: document.getElementById("storyEyebrow").value.trim(),
      title: document.getElementById("storyTitle").value.trim(),
      body: document.getElementById("storyBody").value.trim(),
      pullquote: document.getElementById("storyPullquote").value.trim(),
    };

    localAbout.milestonesEyebrow = document.getElementById("milestonesEyebrow").value.trim();
    localAbout.milestonesTitle = document.getElementById("milestonesTitle").value.trim();

    localAbout.quote = {
      text: document.getElementById("quoteText").value.trim(),
      author: document.getElementById("quoteAuthor").value.trim(),
    };

    localAbout.offeringsEyebrow = document.getElementById("offeringsEyebrow").value.trim();
    localAbout.offeringsTitle = document.getElementById("offeringsTitle").value.trim();
    localAbout.offeringsSubtitle = document.getElementById("offeringsSubtitle").value.trim();

    localAbout.contact = {
      address: document.getElementById("contactAddress").value.trim(),
      mapQuery: document.getElementById("contactMapQuery").value.trim(),
      hours: document.getElementById("contactHours").value.trim(),
      phone: document.getElementById("contactPhone").value.trim(),
      email: document.getElementById("contactEmail").value.trim(),
    };

    localAbout.social = {
      facebook: document.getElementById("socialFacebook").value.trim(),
      instagram: document.getElementById("socialInstagram").value.trim(),
      tiktok: document.getElementById("socialTiktok").value.trim(),
    };

    localAbout.footer = document.getElementById("footerText").value.trim();

    if (!localAbout.termsOfService) localAbout.termsOfService = { clauses: [] };
    localAbout.termsOfService.lastUpdated =
      document.getElementById("tosLastUpdated").value.trim() || "4 August 2026";
    localAbout.termsOfService.lede =
      document.getElementById("tosLede").value.trim();

    if (!localAbout.privacyPolicy) localAbout.privacyPolicy = { clauses: [] };
    localAbout.privacyPolicy.lastUpdated =
      document.getElementById("ppLastUpdated").value.trim() || "4 August 2026";
    localAbout.privacyPolicy.lede =
      document.getElementById("ppLede").value.trim();

    return localAbout;
  }

  /* ── Milestones List & Modals ────────────────────────────────────────── */
  function renderMilestones() {
    const list = localAbout.milestones || [];
    if (!list.length) {
      milestoneListEl.innerHTML = `<p class="bento-desc">No milestones configured yet.</p>`;
      return;
    }

    milestoneListEl.innerHTML = list.map((m, idx) => `
      <div class="about-item-card" data-mid="${HP.esc(m.id || String(idx))}">
        <div class="meta">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span class="milestone-badge">${HP.esc(m.label || "MILESTONE")}</span>
            <strong>${HP.esc(m.title || "Untitled")}</strong>
            ${m.highlight ? `<span class="tag-pill" style="background:var(--ink); color:var(--paper); border-color:var(--ink);">Highlight</span>` : ""}
            ${m.tag ? `<span class="tag-pill">${HP.esc(m.tag)}</span>` : ""}
          </div>
          <small>${(m.paragraphs || []).map((p) => HP.esc(p)).join("<br/><br/>")}</small>
        </div>
        <div class="about-item-actions">
          <button class="btn btn-ghost btn-xs" data-edit-milestone="${idx}"><span class="ic">${HP.icon("edit")}</span>Edit</button>
          <button class="btn btn-ghost btn-xs" data-del-milestone="${idx}"><span class="ic">${HP.icon("trash")}</span></button>
        </div>
      </div>
    `).join("");

    milestoneListEl.querySelectorAll("[data-edit-milestone]").forEach((btn) => {
      btn.addEventListener("click", () => openMilestoneModal(Number(btn.dataset.editMilestone)));
    });

    milestoneListEl.querySelectorAll("[data-del-milestone]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.delMilestone);
        localAbout.milestones.splice(idx, 1);
        renderMilestones();
      });
    });
  }

  function openMilestoneModal(editIndex = -1) {
    const isEdit = editIndex >= 0;
    const m = isEdit ? localAbout.milestones[editIndex] : {
      id: HP.uid(),
      label: "MILESTONE",
      title: "",
      paragraphs: [""],
      tag: "",
      highlight: false,
    };

    HP.openModal(
      isEdit ? "Edit Milestone" : "Add Milestone",
      `
        <div class="form-grid-2">
          <div class="field">
            <label>Badge Label (e.g. DAY 1, JUNE, DAY 365)</label>
            <input class="control" id="mLabel" value="${HP.esc(m.label || "")}" required />
          </div>
          <div class="field">
            <label>Milestone Title</label>
            <input class="control" id="mTitle" value="${HP.esc(m.title || "")}" required />
          </div>
        </div>
        <div class="field">
          <label>Story Paragraphs (separate multiple paragraphs with a blank line)</label>
          <textarea class="control" id="mParagraphs" rows="5" required>${HP.esc((m.paragraphs || []).join("\n\n"))}</textarea>
        </div>
        <div class="form-grid-2">
          <div class="field">
            <label>Tag / Hashtag (optional, e.g. #ParaSaBayan)</label>
            <input class="control" id="mTag" value="${HP.esc(m.tag || "")}" />
          </div>
          <div class="field" style="display:flex; align-items:center; gap:8px; margin-top:24px;">
            <label class="switch">
              <input type="checkbox" id="mHighlight" ${m.highlight ? "checked" : ""} />
              <span class="track"></span>
            </label>
            <span>Highlight milestone (celebrated card)</span>
          </div>
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="mSaveBtn">${isEdit ? "Update" : "Add"}</button>
      `
    );

    document.getElementById("mSaveBtn").addEventListener("click", () => {
      const label = document.getElementById("mLabel").value.trim();
      const title = document.getElementById("mTitle").value.trim();
      const rawParas = document.getElementById("mParagraphs").value.trim();
      const tag = document.getElementById("mTag").value.trim();
      const highlight = document.getElementById("mHighlight").checked;

      if (!label || !title || !rawParas) {
        HP.toast("Please fill in the badge label, title, and story.", "warn");
        return;
      }

      const paragraphs = rawParas.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

      const record = {
        id: m.id || HP.uid(),
        label,
        title,
        paragraphs,
        tag: tag || null,
        highlight,
      };

      if (!localAbout.milestones) localAbout.milestones = [];
      if (isEdit) {
        localAbout.milestones[editIndex] = record;
      } else {
        localAbout.milestones.push(record);
      }

      HP.closeModal();
      renderMilestones();
    });
  }

  /* ── Offerings List & Modals ─────────────────────────────────────────── */
  function renderOffers() {
    const list = localAbout.offers || [];
    if (!list.length) {
      offerListEl.innerHTML = `<p class="bento-desc">No offerings added yet.</p>`;
      return;
    }

    offerListEl.innerHTML = list.map((o, idx) => `
      <div class="about-item-card" data-oid="${HP.esc(o.id || String(idx))}">
        <div class="meta">
          <strong>${HP.esc(o.title || "Untitled")}</strong>
          <small>${HP.esc(o.description || "")}</small>
        </div>
        <div class="about-item-actions">
          <button class="btn btn-ghost btn-xs" data-edit-offer="${idx}"><span class="ic">${HP.icon("edit")}</span>Edit</button>
          <button class="btn btn-ghost btn-xs" data-del-offer="${idx}"><span class="ic">${HP.icon("trash")}</span></button>
        </div>
      </div>
    `).join("");

    offerListEl.querySelectorAll("[data-edit-offer]").forEach((btn) => {
      btn.addEventListener("click", () => openOfferModal(Number(btn.dataset.editOffer)));
    });

    offerListEl.querySelectorAll("[data-del-offer]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.delOffer);
        localAbout.offers.splice(idx, 1);
        renderOffers();
      });
    });
  }

  function openOfferModal(editIndex = -1) {
    const isEdit = editIndex >= 0;
    const o = isEdit ? localAbout.offers[editIndex] : {
      id: HP.uid(),
      title: "",
      description: "",
    };

    HP.openModal(
      isEdit ? "Edit Offering" : "Add Offering",
      `
        <div class="field">
          <label>Offering Title</label>
          <input class="control" id="oTitle" value="${HP.esc(o.title || "")}" required placeholder="e.g. Event Coordinator/s" />
        </div>
        <div class="field">
          <label>Description</label>
          <textarea class="control" id="oDesc" rows="3" required placeholder="Assigned on the day to ensure smooth operations...">${HP.esc(o.description || "")}</textarea>
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="oSaveBtn">${isEdit ? "Update" : "Add"}</button>
      `
    );

    document.getElementById("oSaveBtn").addEventListener("click", () => {
      const title = document.getElementById("oTitle").value.trim();
      const description = document.getElementById("oDesc").value.trim();

      if (!title || !description) {
        HP.toast("Please provide both a title and description.", "warn");
        return;
      }

      const record = {
        id: o.id || HP.uid(),
        title,
        description,
      };

      if (!localAbout.offers) localAbout.offers = [];
      if (isEdit) {
        localAbout.offers[editIndex] = record;
      } else {
        localAbout.offers.push(record);
      }

      HP.closeModal();
      renderOffers();
    });
  }

  /* ── Legal Policies (Terms of Service & Privacy Policy) ──────────────── */
  function renderPolicyClauses(policyKey, containerEl) {
    const policy = localAbout[policyKey] || { clauses: [] };
    const clauses = Array.isArray(policy.clauses) ? policy.clauses : [];

    if (!clauses.length) {
      containerEl.innerHTML = `<p class="bento-desc">No clauses configured yet.</p>`;
      return;
    }

    containerEl.innerHTML = clauses.map((c, idx) => {
      const numBadge = String(idx + 1).padStart(2, "0");
      const parasHtml = (c.paragraphs || []).map((p) => `<p style="margin:0 0 6px;">${HP.esc(p)}</p>`).join("");
      const bulletsHtml = Array.isArray(c.bullets) && c.bullets.length
        ? `<ul style="margin:6px 0 0 18px; padding:0; font-size:0.9rem; color:var(--ink-soft);">
             ${c.bullets.map((b) => `<li style="margin-bottom:4px;">${HP.esc(b)}</li>`).join("")}
           </ul>`
        : "";

      return `
        <div class="about-item-card" data-cid="${HP.esc(c.id || String(idx))}">
          <div class="meta" style="flex:1;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
              <span class="milestone-badge" style="background:var(--ink); color:var(--gold-light, #e6d2a6); font-weight:700; padding:3px 9px; border-radius:6px; letter-spacing:0.08em;">${numBadge}</span>
              <strong style="font-size:1rem; letter-spacing:0.04em; text-transform:uppercase;">${HP.esc(c.heading || "Untitled Clause")}</strong>
              <span style="font-size:0.75rem; color:var(--muted); margin-left:auto;">Clause ${idx + 1} of ${clauses.length}</span>
            </div>
            <small style="display:block; line-height:1.55;">${parasHtml}${bulletsHtml}</small>
          </div>
          <div class="about-item-actions" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
            <button class="btn btn-ghost btn-xs" data-move-up="${idx}" ${idx === 0 ? "disabled" : ""} title="Move clause up">↑</button>
            <button class="btn btn-ghost btn-xs" data-move-down="${idx}" ${idx === clauses.length - 1 ? "disabled" : ""} title="Move clause down">↓</button>
            <button class="btn btn-ghost btn-xs" data-edit-clause="${idx}"><span class="ic">${HP.icon("edit")}</span>Edit</button>
            <button class="btn btn-ghost btn-xs" data-del-clause="${idx}" title="Delete clause"><span class="ic">${HP.icon("trash")}</span></button>
          </div>
        </div>
      `;
    }).join("");

    containerEl.querySelectorAll("[data-move-up]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.moveUp);
        if (idx <= 0) return;
        const arr = localAbout[policyKey].clauses;
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
        renderPolicyClauses(policyKey, containerEl);
      });
    });

    containerEl.querySelectorAll("[data-move-down]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.moveDown);
        const arr = localAbout[policyKey].clauses;
        if (idx >= arr.length - 1) return;
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
        renderPolicyClauses(policyKey, containerEl);
      });
    });

    containerEl.querySelectorAll("[data-edit-clause]").forEach((btn) => {
      btn.addEventListener("click", () => openClauseModal(policyKey, containerEl, Number(btn.dataset.editClause)));
    });

    containerEl.querySelectorAll("[data-del-clause]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.delClause);
        localAbout[policyKey].clauses.splice(idx, 1);
        renderPolicyClauses(policyKey, containerEl);
      });
    });
  }

  function openClauseModal(policyKey, containerEl, editIndex = -1) {
    const isEdit = editIndex >= 0;
    const clauses = (localAbout[policyKey] && localAbout[policyKey].clauses) || [];
    const clauseNum = String(isEdit ? editIndex + 1 : clauses.length + 1).padStart(2, "0");
    const c = isEdit ? clauses[editIndex] : {
      id: HP.uid(),
      heading: "",
      paragraphs: [""],
      bullets: [],
    };
    const policyLabel = policyKey === "termsOfService" ? "Terms of Service" : "Privacy Policy";

    HP.openModal(
      `${isEdit ? "Edit" : "Add"} ${policyLabel} · Clause #${clauseNum}`,
      `
        <div class="field">
          <label>Clause #${clauseNum} Title / Heading</label>
          <input class="control" id="cHeading" value="${HP.esc(c.heading || "")}" required placeholder="e.g. The agreement, Your account, Placing an order" />
        </div>
        <div class="field">
          <label>Body Paragraphs (separate multiple paragraphs with a blank line)</label>
          <textarea class="control" id="cParagraphs" rows="5" placeholder="Write the clause explanation in plain, clear words...">${HP.esc((c.paragraphs || []).join("\n\n"))}</textarea>
        </div>
        <div class="field">
          <label>Bullet List Items (optional — one bullet item per line)</label>
          <textarea class="control" id="cBullets" rows="4" placeholder="Optional bullet points displayed beneath the paragraphs...">${HP.esc((c.bullets || []).join("\n"))}</textarea>
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="cSaveBtn">${isEdit ? "Update Clause" : "Add Clause"}</button>
      `
    );

    document.getElementById("cSaveBtn").addEventListener("click", () => {
      const heading = document.getElementById("cHeading").value.trim();
      const rawParas = document.getElementById("cParagraphs").value.trim();
      const rawBullets = document.getElementById("cBullets").value.trim();

      const paragraphs = rawParas ? rawParas.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [];
      const bullets = rawBullets ? rawBullets.split(/\n/).map((b) => b.trim()).filter(Boolean) : [];

      if (!heading || (!paragraphs.length && !bullets.length)) {
        HP.toast("Please provide a clause heading and at least one paragraph or bullet item.", "warn");
        return;
      }

      const record = {
        id: c.id || HP.uid(),
        heading,
        paragraphs,
        bullets,
      };

      if (!localAbout[policyKey]) localAbout[policyKey] = { clauses: [] };
      if (!Array.isArray(localAbout[policyKey].clauses)) localAbout[policyKey].clauses = [];

      if (isEdit) {
        localAbout[policyKey].clauses[editIndex] = record;
      } else {
        localAbout[policyKey].clauses.push(record);
      }

      HP.closeModal();
      renderPolicyClauses(policyKey, containerEl);
    });
  }

  /* ── Help & FAQ Groups & Questions ───────────────────────────────────── */
  function renderFaqGroups() {
    const groups = Array.isArray(localAbout.faqGroups) ? localAbout.faqGroups : [];
    if (!groups.length) {
      faqGroupListEl.innerHTML = `<p class="bento-desc">No FAQ categories configured yet.</p>`;
      return;
    }

    faqGroupListEl.innerHTML = groups.map((g, gIdx) => {
      const items = Array.isArray(g.items) ? g.items : [];
      const itemsHtml = items.length
        ? items.map((item, qIdx) => {
            const numBadge = String(qIdx + 1).padStart(2, "0");
            return `
              <div class="about-item-card" style="margin-top:8px;">
                <div class="meta" style="flex:1;">
                  <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                    <span class="milestone-badge">${numBadge}</span>
                    <strong>${HP.esc(item.question || "Untitled question")}</strong>
                  </div>
                  <small style="white-space:pre-line;">${HP.esc(item.answer || "")}</small>
                </div>
                <div class="about-item-actions">
                  <button class="btn btn-ghost btn-xs" data-edit-faq="${gIdx}:${qIdx}"><span class="ic">${HP.icon("edit")}</span>Edit</button>
                  <button class="btn btn-ghost btn-xs" data-del-faq="${gIdx}:${qIdx}"><span class="ic">${HP.icon("trash")}</span></button>
                </div>
              </div>
            `;
          }).join("")
        : `<p class="bento-desc" style="margin:8px 0 0;">No questions in this category yet.</p>`;

      return `
        <div class="about-item-card" style="flex-direction:column; align-items:stretch; gap:10px; margin-bottom:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="tag-pill" style="font-weight:700; letter-spacing:0.08em;">CATEGORY ${gIdx + 1}</span>
              <strong style="font-size:1rem;">${HP.esc(g.title || "UNTITLED CATEGORY")}</strong>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="btn btn-primary btn-xs" data-add-faq="${gIdx}"><span class="ic">${HP.icon("plus")}</span>Add Question</button>
              <button class="btn btn-ghost btn-xs" data-edit-group="${gIdx}"><span class="ic">${HP.icon("edit")}</span>Rename</button>
              <button class="btn btn-ghost btn-xs" data-del-group="${gIdx}"><span class="ic">${HP.icon("trash")}</span></button>
            </div>
          </div>
          <div>${itemsHtml}</div>
        </div>
      `;
    }).join("");

    faqGroupListEl.querySelectorAll("[data-add-faq]").forEach((btn) => {
      btn.addEventListener("click", () => openFaqQuestionModal(Number(btn.dataset.addFaq), -1));
    });

    faqGroupListEl.querySelectorAll("[data-edit-group]").forEach((btn) => {
      btn.addEventListener("click", () => openFaqGroupModal(Number(btn.dataset.editGroup)));
    });

    faqGroupListEl.querySelectorAll("[data-del-group]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const gIdx = Number(btn.dataset.delGroup);
        localAbout.faqGroups.splice(gIdx, 1);
        renderFaqGroups();
      });
    });

    faqGroupListEl.querySelectorAll("[data-edit-faq]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [gIdx, qIdx] = btn.dataset.editFaq.split(":").map(Number);
        openFaqQuestionModal(gIdx, qIdx);
      });
    });

    faqGroupListEl.querySelectorAll("[data-del-faq]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [gIdx, qIdx] = btn.dataset.delFaq.split(":").map(Number);
        localAbout.faqGroups[gIdx].items.splice(qIdx, 1);
        renderFaqGroups();
      });
    });
  }

  function openFaqGroupModal(editGroupIdx = -1) {
    const isEdit = editGroupIdx >= 0;
    const g = isEdit ? localAbout.faqGroups[editGroupIdx] : { id: HP.uid(), title: "", items: [] };

    HP.openModal(
      isEdit ? "Rename FAQ Category" : "Add FAQ Category",
      `
        <div class="field">
          <label>Category Title (e.g. BOOKING &amp; ORDERS, PAYING)</label>
          <input class="control" id="fgTitle" value="${HP.esc(g.title || "")}" required placeholder="e.g. BOOKING & ORDERS" />
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="fgSaveBtn">${isEdit ? "Update" : "Add"}</button>
      `
    );

    document.getElementById("fgSaveBtn").addEventListener("click", () => {
      const title = document.getElementById("fgTitle").value.trim().toUpperCase();
      if (!title) {
        HP.toast("Please enter a category title.", "warn");
        return;
      }
      if (!Array.isArray(localAbout.faqGroups)) localAbout.faqGroups = [];
      if (isEdit) {
        localAbout.faqGroups[editGroupIdx].title = title;
      } else {
        localAbout.faqGroups.push({ id: HP.uid(), title, items: [] });
      }
      HP.closeModal();
      renderFaqGroups();
    });
  }

  function openFaqQuestionModal(groupIdx, editQuestionIdx = -1) {
    const group = localAbout.faqGroups[groupIdx];
    if (!group) return;
    const isEdit = editQuestionIdx >= 0;
    const item = isEdit ? group.items[editQuestionIdx] : { question: "", answer: "" };

    HP.openModal(
      `${isEdit ? "Edit" : "Add"} Question · ${group.title}`,
      `
        <div class="field">
          <label>Question</label>
          <input class="control" id="fqQuestion" value="${HP.esc(item.question || "")}" required placeholder="e.g. How much do I pay up front?" />
        </div>
        <div class="field">
          <label>Answer</label>
          <textarea class="control" id="fqAnswer" rows="5" required placeholder="Write a clear, helpful answer...">${HP.esc(item.answer || "")}</textarea>
        </div>
      `,
      `
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="fqSaveBtn">${isEdit ? "Update Question" : "Add Question"}</button>
      `
    );

    document.getElementById("fqSaveBtn").addEventListener("click", () => {
      const question = document.getElementById("fqQuestion").value.trim();
      const answer = document.getElementById("fqAnswer").value.trim();
      if (!question || !answer) {
        HP.toast("Please provide both a question and an answer.", "warn");
        return;
      }
      if (!Array.isArray(group.items)) group.items = [];
      if (isEdit) {
        group.items[editQuestionIdx] = { question, answer };
      } else {
        group.items.push({ question, answer });
      }
      HP.closeModal();
      renderFaqGroups();
    });
  }

  /* ── Top-level Actions ────────────────────────────────────────────────── */
  aboutSaveBtn.addEventListener("click", () => {
    const updated = collectFormValues();
    HP.store.persistAbout(updated);
    HP.toast("About, Legal & FAQ content saved and published to the app.");
  });

  aboutResetBtn.addEventListener("click", () => {
    HP.confirmModal(
      "Restore Default Content",
      "Are you sure you want to revert About page narrative, Terms of Service, Privacy Policy, and Help & FAQ back to default values?",
      () => {
        localAbout = structuredClone(HP.DEFAULT_ABOUT);
        populateForm();
        HP.store.persistAbout(localAbout);
        HP.toast("About, Legal & FAQ restored to default content.");
      }
    );
  });

  milestoneAddBtn.addEventListener("click", () => openMilestoneModal(-1));
  offerAddBtn.addEventListener("click", () => openOfferModal(-1));
  tosClauseAddBtn.addEventListener("click", () => openClauseModal("termsOfService", tosClauseListEl, -1));
  ppClauseAddBtn.addEventListener("click", () => openClauseModal("privacyPolicy", ppClauseListEl, -1));
  faqGroupAddBtn.addEventListener("click", () => openFaqGroupModal(-1));
})();
