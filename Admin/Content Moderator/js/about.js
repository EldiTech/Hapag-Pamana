/* HapagPamana · Content Moderator — About Page management.
   Allows editing the hero mantra, story narrative, milestone timeline,
   family sign-off, offerings, contact information, and social links. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({
    title: "About Page",
    sub: "Manage the brand story, timeline, offerings, and contact details.",
    search: false,
    action: null,
  });

  const aboutSaveBtn = document.getElementById("aboutSave");
  const aboutResetBtn = document.getElementById("aboutReset");
  const milestoneAddBtn = document.getElementById("milestoneAdd");
  const offerAddBtn = document.getElementById("offerAdd");

  const milestoneListEl = document.getElementById("milestoneList");
  const offerListEl = document.getElementById("offerList");

  let localAbout = null;

  HP.ready.then(initAbout);
  HP.onRefresh(initAbout);

  function getStoreAbout() {
    const db = HP.store.DB;
    if (db && db.about) return structuredClone(db.about);
    return structuredClone(HP.DEFAULT_ABOUT);
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

    renderMilestones();
    renderOffers();
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
            ${m.highlight ? `<span class="tag-pill" style="background:var(--gold); color:white;">Highlight</span>` : ""}
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

  /* ── Top-level Actions ────────────────────────────────────────────────── */
  aboutSaveBtn.addEventListener("click", () => {
    const updated = collectFormValues();
    HP.store.persistAbout(updated);
    HP.toast("About page content saved and published to the app.");
  });

  aboutResetBtn.addEventListener("click", () => {
    HP.confirmModal(
      "Restore Default About Content",
      "Are you sure you want to revert all About page text, milestones, offerings, and contact details to default values?",
      () => {
        localAbout = structuredClone(HP.DEFAULT_ABOUT);
        populateForm();
        HP.store.persistAbout(localAbout);
        HP.toast("About page restored to default content.");
      }
    );
  });

  milestoneAddBtn.addEventListener("click", () => openMilestoneModal(-1));
  offerAddBtn.addEventListener("click", () => openOfferModal(-1));
})();
