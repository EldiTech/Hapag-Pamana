/* ════════════════════════════════════════════════════════════════
   HapagPamana · Content Moderator — CONTENT STORE (shared by every CM page).
   The data half this dashboard adds on top of the shared portal core
   (../../assets/hp-core.js): the Firestore content store with its
   IndexedDB stale-while-revalidate cache, the product taxonomy, the
   allergen taxonomy, schema migrations, JSON export and image
   compression. Everything lands on the same `window.HP` global; this
   file also re-points HP.ready at its data-ready promise, so pages keep
   awaiting HP.ready exactly as before.

   This store is deliberately Content-Moderator-only: the Orders and
   Master Chef dashboards stream their own collections live and never
   touch the multi-megabyte menu content.

   Data lives in Firestore when Firebase is configured (collections:
   categories, products, packages, setups, settings/app); otherwise it
   falls back to localStorage so the dashboard still works as a demo.

   Load order (scripts live in js/, pages in html/):
     firebase-*-compat → ../../firebase-config.js → js/config.js
     → ../../assets/hp-guard.js → hp-core.js → hp-shell.js
     → js/store.js → js/<page>.js
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const HP = window.HP;
  const FB = HP.FB;
  const ONLINE = HP.ONLINE;
  const toast = HP.toast;

  const uid = () => Math.random().toString(36).slice(2, 9);
  // "—" for anything non-numeric, so a missing price never renders "₱NaN".
  function money(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return (DB && DB.settings ? DB.settings.currency : "₱") + v.toLocaleString("en-PH");
  }

  /* ── Product taxonomy ──────────────────────────────────────────────────
     Two product types, each with its OWN set of filter categories. This is
     the single source of truth that seeds the category dropdown in the product
     form and the browse chips on the Products page. Categories stay editable
     (per type) on the Categories page — this only provides the defaults. */
  const TYPES = ["Food Packs", "Catering Food Trays"];
  // Each entry is [categoryName, iconName] — iconName keys into HP.ICONS.
  const TAXONOMY = {
    "Food Packs": [
      ["Salad", "salad"], ["Vegetables", "leaf"], ["Seafood", "shrimp"],
      ["Fish", "fish"], ["Pork", "meat"], ["Chicken", "drumstick"],
      ["Rice", "rice"], ["Noodles", "noodles"], ["Pasta", "pasta"],
      ["Sandwich", "sandwich"], ["Dessert", "cake"],
    ],
    "Catering Food Trays": [
      ["Appetizer", "skewer"], ["Soup", "soup"], ["Salad", "salad"], ["Pasta", "pasta"],
      ["Noodles", "noodles"], ["Sandwich", "sandwich"], ["Vegetables", "leaf"],
      ["Seafood", "shrimp"], ["Beef", "steak"], ["Pork", "meat"],
      ["Chicken", "drumstick"], ["Rice", "rice"], ["Dessert", "cake"], ["Drinks", "cup"],
    ],
  };
  /* ── Add-on pricing ────────────────────────────────────────────────────
     Add-ons are priced BY CATEGORY, per head, exactly as the printed menu
     does it: Appetizer ₱75/pax, Salad ₱80/pax, Beef ₱150/pax… Every dish in
     a category inherits its category's rate, so pricing the menu is a dozen
     numbers rather than one per dish.

     A single dish may override its category — the three items on the ADD-ONS
     card (Squid Ink Pasta, Shrimp Thermidor, Baked Salmon) are ₱150/pax even
     though their categories are cheaper. The override lives on the product as
     `addOnPrice`, deliberately NOT `price`: the v2→v3 migration deletes a
     `price` field from every product (see stripDishExtras), and a field that
     migration reaps is a field that vanishes on the next upgrade.

     These are the DEFAULTS, seeded on first run and used as the fallback for a
     category saved before pricing existed. The live rates are editable per
     category on the Categories page. */
  const DEFAULT_CAT_PRICES = {
    "Food Packs": {
      Salad: 80, Vegetables: 80, Seafood: 150, Fish: 150, Pork: 130,
      Chicken: 120, Rice: 50, Noodles: 120, Pasta: 120, Sandwich: 75, Dessert: 50,
    },
    "Catering Food Trays": {
      Appetizer: 75, Soup: 75, Salad: 80, Pasta: 120, Noodles: 120,
      Sandwich: 75, Vegetables: 80, Seafood: 150, Beef: 150, Pork: 130,
      Chicken: 120, Rice: 50, Dessert: 50, Drinks: 50,
    },
  };
  // The flat-rate items printed on the ADD-ONS card — priced by name, above
  // whatever their category charges. Seeded onto the matching products once
  // (v6 → v7) and editable per product afterwards.
  const DEFAULT_DISH_PRICES = {
    "squid ink pasta": 150,
    "shrimp thermidor": 150,
    "baked salmon": 150,
  };
  // The per-head rate a category charges: the moderator's number when it has
  // one, else the printed default, else null ("not priced yet" — never 0,
  // which would read as free).
  // NB: only a real number counts. Number(null) and Number("") are both 0, so
  // a field stored as null (or an empty string) would otherwise read as a FREE
  // dish rather than an unpriced one.
  const rateOf = (v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  function categoryPrice(cat) {
    if (!cat) return null;
    const own = rateOf(cat.price);
    if (own !== null) return own;
    const fallback = (DEFAULT_CAT_PRICES[cat.type] || {})[cat.name];
    return Number.isFinite(fallback) ? fallback : null;
  }
  // What one head of a dish costs as an add-on: its own override, else its
  // category's rate. Null when neither is priced.
  function dishPrice(dish) {
    if (!dish) return null;
    const own = rateOf(dish.addOnPrice);
    if (own !== null) return own;
    if (!DB) return null;
    const cat = DB.categories.find(
      (c) => !c.deleted && c.type === dish.type && c.name === dish.category);
    return categoryPrice(cat);
  }
  // True when a dish carries its own rate rather than inheriting one.
  const hasPriceOverride = (dish) => !!dish && rateOf(dish.addOnPrice) !== null;

  // Name→default-icon lookup, so a category resolves to a sensible icon from its
  // name (and older categories saved with an emoji still get one).
  const CAT_ICON_BY_NAME = {};
  Object.keys(TAXONOMY).forEach((t) => TAXONOMY[t].forEach(([n, ic]) => { CAT_ICON_BY_NAME[n] = ic; }));
  // Resolve a category's display icon name (taxonomy default → stored → fallback).
  // The name-based entry wins: icons are assigned automatically (there is no
  // manual picker), so a stored value is only ever an older default — preferring
  // the taxonomy lets icon improvements (e.g. Noodles gaining its own icon)
  // reach categories saved before the change. Stored covers custom names.
  function iconForCat(cat) {
    const byName = cat && CAT_ICON_BY_NAME[cat.name];
    const name = byName || (cat && cat.icon);
    return name && HP.ICONS[name] ? name : "dish";
  }
  // Stable ordering index for a category within a type (taxonomy order first,
  // custom categories sorted after).
  const catOrder = (type, name) => {
    const i = (TAXONOMY[type] || []).findIndex(([n]) => n === name);
    return i === -1 ? 99 : i;
  };
  // The live, editable categories belonging to a product type, in taxonomy order.
  function categoriesForType(type) {
    if (!DB) return [];
    const seen = new Set();
    return DB.categories
      .filter((c) => {
        if (c.deleted || c.type !== type || seen.has(c.name)) return false;
        seen.add(c.name);
        return true;
      })
      .sort((a, b) => catOrder(type, a.name) - catOrder(type, b.name) || a.name.localeCompare(b.name));
  }

  /* ── Allergen taxonomy (shared with the app — see lib/data/allergens.dart) ──
     The allergen set products can be tagged with, each with a 0–1
     anaphylaxis-risk weight. Heatmap intensity = prevalence × severity, so a
     rarely-fatal allergen that happens to be everywhere never reads as alarming
     as a high-risk one.
     The live taxonomy is editable on the Settings page and stored in Firestore
     (settings/allergens — public read, so the customer app follows the same
     list). This table is only the default, seeded on first run. */
  const DEFAULT_ALLERGENS = [
    { key: "milk",      label: "Milk",           short: "Milk",      severity: 0.60 },
    { key: "egg",       label: "Egg",            short: "Egg",       severity: 0.65 },
    { key: "fish",      label: "Fish",           short: "Fish",      severity: 0.85 },
    { key: "shellfish", label: "Shellfish",      short: "Shellfish", severity: 0.95 },
    { key: "tree_nuts", label: "Tree nuts",      short: "Nuts",      severity: 1.00 },
    { key: "peanut",    label: "Peanut",         short: "Peanut",    severity: 1.00 },
    { key: "gluten",    label: "Wheat / gluten", short: "Gluten",    severity: 0.60 },
    { key: "soy",       label: "Soy",            short: "Soy",       severity: 0.55 },
    { key: "sesame",    label: "Sesame",         short: "Sesame",    severity: 0.75 },
  ];

  // The taxonomy currently in force — the moderator-edited list once the data
  // store is loaded, the defaults before then.
  function currentAllergens() {
    return DB && Array.isArray(DB.allergens) ? DB.allergens : DEFAULT_ALLERGENS;
  }
  const allergenByKey = (k) => currentAllergens().find((a) => a.key === k) || null;

  // Coerce a stored settings/allergens `list` into well-formed taxonomy rows
  // (drops blank / duplicate keys, clamps severity). Null when not a list at
  // all, so a malformed doc falls back to the defaults but a deliberately
  // emptied taxonomy is honoured.
  function normalizeAllergens(raw) {
    if (!Array.isArray(raw)) return null;
    const out = [], seen = new Set();
    raw.forEach((e) => {
      if (!e || typeof e !== "object") return;
      const key = String(e.key || "").trim();
      const label = String(e.label || "").trim();
      if (!key || !label || seen.has(key)) return;
      seen.add(key);
      const sev = Number(e.severity);
      out.push({
        key,
        label,
        short: String(e.short || "").trim() || label,
        severity: Number.isFinite(sev) ? Math.max(0, Math.min(1, sev)) : 0.6,
      });
    });
    return out;
  }

  // Coerce a stored `allergens` value into known keys (drops unknown / dupes).
  function parseAllergens(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    raw.forEach((e) => {
      const k = String(e == null ? "" : e).trim();
      if (allergenByKey(k) && !out.includes(k)) out.push(k);
    });
    return out;
  }

  // Aggregate the taxonomy across a list of dishes → one row per allergen:
  // { allergen, count, total, frequency, intensity }, in taxonomy order.
  function aggregateAllergens(dishes) {
    const total = dishes.length;
    return currentAllergens().map((a) => {
      const count = dishes.filter((d) => parseAllergens(d.allergens).includes(a.key)).length;
      const frequency = total ? count / total : 0;
      return { allergen: a, count, total, frequency, intensity: frequency * a.severity };
    });
  }
  const hasAnyAllergenData = (stats) => stats.some((s) => s.count > 0);

  // Heat ramp (0–1) → CSS rgb(), matching the app's allergenHeatColor():
  // soft gold → antique gold → brick red.
  function allergenHeat(intensity) {
    const t = Math.max(0, Math.min(1, intensity));
    const lerp = (a, b, u) => Math.round(a + (b - a) * u);
    const mix = (c1, c2, u) => `rgb(${lerp(c1[0], c2[0], u)},${lerp(c1[1], c2[1], u)},${lerp(c1[2], c2[2], u)})`;
    const low = [230, 210, 166], mid = [175, 133, 74], high = [155, 59, 46];
    return t <= 0.5 ? mix(low, mid, t / 0.5) : mix(mid, high, (t - 0.5) / 0.5);
  }

  /* ── Seed data ───────────────────────────────────────────────────────── */
  const DEFAULT_ABOUT = {
    mantra: {
      eyebrow: "SINCE 2016 · THE FILL AT HOME STORY",
      quote: "Be patient — your small business will grow enough to pay your bills.",
      label: "OUR MANTRA FROM DAY ONE",
    },
    story: {
      eyebrow: "WHERE WE BEGAN",
      title: "Our Story",
      body: "We tried to open a small Fill at Home canteen back in 2016. It did not work out — but it was an exciting experience for us. We went back to being a small family of employees, working every day to make ends meet: earning enough to pay the bills, put food on the table and send the kids to school.",
      pullquote: "Little did we know that with a little effort, prayer and grit, this small business would become our lifeline.",
    },
    milestonesEyebrow: "THE FIRST YEAR",
    milestonesTitle: "From Day 1 to Day 365",
    milestones: [
      {
        id: "m1",
        label: "DAY 1",
        title: "Para sa Bayan",
        paragraphs: [
          "It began when one of our siblings still had time to share her #ParaSaBayan posts — we started mainly as a food supplier to frontliners at the start of the pandemic. We just wanted to make sure the frontliners were provided with clean and yummy food, and at the same time it was an opportunity for us to earn extra income — so we went for it.",
          "We were just five siblings, using our normal household stuff as equipment, cooking meals daily for 100 people. This went on for a few days, until we were able to save enough to invest in more equipment for our kitchen.",
        ],
        icon: "volunteer_activism",
        tag: "#ParaSaBayan",
        highlight: false,
      },
      {
        id: "m2",
        label: "JUNE",
        title: "The Kitchen",
        paragraphs: [
          "We started to rent an apartment that we now call “The Kitchen”. This is where our family started to grow, our equipment started to pile up, and more clients came knocking — where we grew as a family and as a small business.",
          "We also started adding to our small family by hiring our first few staff members, Ate Toneth and CJ — and with their help, we were able to add even more people to our family.",
          "June was also our first ever catering event. We still remember the sleepless nights, the excitement, the adrenaline.",
        ],
        icon: "soup_kitchen",
        highlight: false,
      },
      {
        id: "m3",
        label: "AUGUST",
        title: "Meet Filla",
        paragraphs: [
          "Operations started to become faster and we were getting more and more clients, so we decided to buy our first service vehicle — we call him Filla.",
          "You see, we are very sentimental about all the things we buy and invest in, and about the people we hire. This is because we know that with these, big and small, we can become more.",
        ],
        icon: "local_shipping",
        highlight: false,
      },
      {
        id: "m4",
        label: "DECEMBER",
        title: "A Family Wedding",
        paragraphs: [
          "The couple who started Fill at Home tied the knot — and all the Fill at Home family members were present.",
        ],
        icon: "favorite",
        highlight: false,
      },
      {
        id: "m5",
        label: "JANUARY",
        title: "The Second Kitchen",
        paragraphs: [
          "We started renting a Second Kitchen, to accommodate more orders, more equipment and more staff.",
        ],
        icon: "home_work",
        highlight: false,
      },
      {
        id: "m6",
        label: "DAY 365",
        title: "We Are Still Here",
        paragraphs: [
          "It started as seven siblings — and now, with all our staff and the second-generation family members, we are 25 strong.",
          "We are still growing, and with the help of our clients and our members, we will grow more. Soon, we are off to our next milestone — our biggest investment yet: the new home for Fill at Home.",
        ],
        icon: "groups",
        highlight: true,
      },
    ],
    quote: {
      text: "So if you have a dream — no matter how difficult — put your heart into it and slowly ease your way toward your goals. And if you are lucky, you will succeed together with your family.",
      author: "— THE FILL AT HOME FAMILY",
    },
    offeringsEyebrow: "AT YOUR TABLE",
    offeringsTitle: "What We Offer",
    offeringsSubtitle: "A seat at our table for every occasion — from a weekday craving to a once-in-a-lifetime celebration.",
    offers: [
      { id: "o1", title: "Event Coordinator/s", description: "Assigned on the day to ensure smooth operations during the event.", icon: "assignment_ind" },
      { id: "o2", title: "Trained Waiters", description: "Uniformed and trained to assist guests throughout the event.", icon: "emoji_people" },
      { id: "o3", title: "Dressed-Up Tables", description: "Tables styled with toppers based on the client's motif.", icon: "table_restaurant" },
      { id: "o4", title: "Table Numbers", description: "Numbered tables to keep guests organized and seated with ease.", icon: "format_list_numbered" },
      { id: "o5", title: "Basic Centerpiece Design", description: "Simple centerpieces to complete each table's look.", icon: "local_florist" },
      { id: "o6", title: "Chairs with Cover & Accent", description: "Chairs dressed with covers and accents to match the theme.", icon: "event_seat" },
      { id: "o7", title: "Purified Water", description: "Purified drinking water served throughout the event.", icon: "water_drop" },
      { id: "o8", title: "Roll-Up Chafing Dish", description: "Chafing dishes to keep the spread warm and ready.", icon: "local_fire_department" },
      { id: "o9", title: "Sanitized Dinnerware & Glassware", description: "Sanitized dinnerware, glassware and flatware for every guest.", icon: "restaurant" },
    ],
    contact: {
      address: "The Kitchen · Metro Manila, Philippines",
      mapQuery: "Fill at Home Catering, Metro Manila",
      hours: "Monday – Sunday · 8:00 AM – 8:00 PM",
      phone: "0917 123 4567",
      email: "hello@fillathome.ph",
    },
    social: {
      facebook: "https://www.facebook.com/fillathome",
      instagram: "https://www.instagram.com/fillathome",
      tiktok: "https://www.tiktok.com/@fillathome",
    },
    footer: "FILL AT HOME · SINCE 2016",
    termsOfService: {
      lastUpdated: "4 August 2026",
      lede: "The understanding between you and our kitchen when you order through this app.",
      clauses: [
        {
          id: "tos_1",
          heading: "The agreement",
          paragraphs: [
            "These terms are between you and Fill at Home Catering Services, the family kitchen behind Hapag Pamana. By using the app — browsing the menu, making an account or filing an order — you're agreeing to them.",
            "They sit alongside our Privacy Policy, which covers what we keep about you.",
          ],
          bullets: [],
        },
        {
          id: "tos_2",
          heading: "Your account",
          paragraphs: [
            "Please give us details that are actually yours: we call the number on a booking to confirm it, and send quotations to the address you registered. One phone number belongs to one account.",
            "Keep your password to yourself, and tell us straight away if you think someone else has it. What happens on your account is treated as done by you.",
          ],
          bullets: [],
        },
        {
          id: "tos_3",
          heading: "Placing an order",
          paragraphs: [
            "An order you file is a request, not yet a booking. It reaches us as Pending, we go through it, and we call you to confirm the details — the date is only held once we've confirmed it and the downpayment has landed.",
            "Please tell us everything that matters in the notes: the headcount you actually expect, how we get into the venue, and anything about allergies or diets. A surprise on the day costs us both.",
          ],
          bullets: [],
        },
        {
          id: "tos_4",
          heading: "Prices and quotations",
          paragraphs: [
            "Package prices in the app are what we currently charge, and can change while an order is still Pending — an order carries the figures it was filed with, and if anything moves we tell you before you pay.",
            "Some orders are priced by hand, food packs especially. Those file without an online payment and we send you a quotation; that quotation is what governs the order.",
          ],
          bullets: [],
        },
        {
          id: "tos_5",
          heading: "The downpayment",
          paragraphs: [
            "Half the order total is collected up front, and that's what holds your date in the kitchen's calendar. The balance is settled with the team on the day of the event.",
            "The downpayment is taken on Xendit's secure checkout page. If a payment is interrupted you can pick it up again from Order tracking; until it clears, your order is filed but your date isn't held.",
          ],
          bullets: [],
        },
        {
          id: "tos_6",
          heading: "Changes and cancellations",
          paragraphs: [
            "Once an order is filed you can't edit it in the app — that's deliberate, because the kitchen plans and buys against what you sent. Call or message us and we'll change it with you.",
            "If you need to cancel, tell us as early as you can. What happens to a downpayment depends on how near the day we are and what has already been bought and committed for your event, so we work it out with you directly rather than by a flat rule.",
            "Very occasionally we have to decline or step back from an order — a date we simply can't staff, or something beyond us. If that happens after you've paid, you get your downpayment back.",
          ],
          bullets: [],
        },
        {
          id: "tos_7",
          heading: "Food, allergens and special diets",
          paragraphs: [
            "The allergen tags in the app come from our own kitchen and are there to help you choose. They are guidance, not a guarantee: we cook everything in one kitchen on shared equipment, so we cannot promise any dish is free of traces of another.",
            "If an allergy is serious, set it under Settings → Dietary preference, write it in your booking notes, and call us as well. We would much rather talk it through than have you rely on a tag.",
          ],
          bullets: [],
        },
        {
          id: "tos_8",
          heading: "What the app can and can't do",
          paragraphs: [
            "The menu, the packages and the setups are ours to change: a dish comes off when it's out of season, and parts of the app can be closed for a while — the whole app included, when the kitchen needs to pause.",
            "Gabay, the catering companion, is in preview. It doesn't place orders or quote prices, and nothing it eventually suggests is a commitment on our part.",
          ],
          bullets: [],
        },
        {
          id: "tos_9",
          heading: "Using it fairly",
          paragraphs: [
            "Please don't file orders you don't intend to take, use someone else's details, or try to get at parts of the app or other members' information that aren't yours.",
            "We can suspend an account being used that way. A suspended account can still be talked about — get in touch and we'll go through it with you.",
          ],
          bullets: [],
        },
        {
          id: "tos_10",
          heading: "Our words and pictures",
          paragraphs: [
            "The story, the photographs, the menu and the recipes in this app are the family's. Enjoy them, share a link, tell your friends — but please don't reuse them commercially or pass them off as your own.",
          ],
          bullets: [],
        },
        {
          id: "tos_11",
          heading: "What we stand behind",
          paragraphs: [
            "We stand behind our food and our service. If something isn't right on the day, tell us then and there and we will do what we can to put it right.",
            "Beyond that, we're a small kitchen: we can't take on losses beyond the value of the order itself, such as lost earnings or the cost of the rest of an event. Nothing here takes away the rights Philippine consumer law gives you.",
          ],
          bullets: [],
        },
        {
          id: "tos_12",
          heading: "Where this is settled",
          paragraphs: [
            "These terms are governed by the laws of the Republic of the Philippines, and anything we can't settle between us belongs to the courts of Metro Manila. We would always rather settle it over the phone.",
          ],
          bullets: [],
        },
        {
          id: "tos_13",
          heading: "When these change",
          paragraphs: [
            "If we change these terms we'll update this page and the date at the top. An order already confirmed keeps the terms it was made under.",
          ],
          bullets: [],
        },
      ],
    },
    privacyPolicy: {
      lastUpdated: "4 August 2026",
      lede: "What we keep about you, who can see it, and how to have it changed or removed.",
      clauses: [
        {
          id: "pp_1",
          heading: "Who we are",
          paragraphs: [
            "Hapag Pamana is the customer app of Fill at Home Catering Services — the family kitchen whose story you can read under Settings → About. When this policy says \"we\", it means that family and the staff who work with us.",
            "You can reach us any time at hello@fillathome.ph or on 0917 123 4567.",
          ],
          bullets: [],
        },
        {
          id: "pp_2",
          heading: "What we keep",
          paragraphs: [
            "Only what we need to cook for you and keep your account working:",
          ],
          bullets: [
            "Your account — the name, e-mail address and phone number you gave us when you signed up, and the date you joined. Your password is held by Google Firebase Authentication and never reaches us in a form we could read.",
            "Your profile photo, if you set one. It is stored inside your own profile record, and removing it deletes it.",
            "Your orders — the event date, venue, headcount, the dishes you chose, the address we deliver to, the times you gave us and any notes you wrote for the kitchen.",
            "Your payments — how much was paid, when, the method used and the reference Xendit gives us. Card and e-wallet details are entered on Xendit's own checkout page and never pass through this app.",
            "Your settings — the notification switches, your dietary preference and the allergens you asked us to avoid, and your chosen language.",
          ],
        },
        {
          id: "pp_3",
          heading: "Why we keep it",
          paragraphs: [
            "Every item above earns its place:",
          ],
          bullets: [
            "To cook, deliver and set up what you ordered.",
            "To reach you about an order — we call the contact number on a booking to confirm the details, and send quotations to your e-mail address.",
            "To keep one phone number to one account, so two accounts can't end up sharing a contact and crossing their orders.",
            "To remember your preferences, so you don't have to explain how you eat with every booking.",
            "To keep our own business records of what was ordered and paid.",
          ],
        },
        {
          id: "pp_4",
          heading: "Who can see it",
          paragraphs: [
            "Our own team, through the staff dashboards, and only the part each role needs:",
          ],
          bullets: [
            "Order managers see the orders you file, and move them along as we work through them.",
            "The master chef sees confirmed orders, to plan the ingredients for your event.",
            "Content moderators, who look after the menu, can see member profiles.",
          ],
        },
        {
          id: "pp_5",
          heading: "Who we never share it with",
          paragraphs: [
            "We do not sell your information, and we do not hand it to advertisers or data brokers. Nobody outside the team above sees your orders except the services that carry them for us (next clause), and anyone the law obliges us to tell.",
          ],
          bullets: [],
        },
        {
          id: "pp_6",
          heading: "The services that hold it for us",
          paragraphs: [
            "We don't run our own servers. Two companies hold this information on our behalf, under their own security and privacy terms:",
          ],
          bullets: [
            "Google Firebase — your account, your profile, your orders and your settings live in Firebase Authentication and Cloud Firestore.",
            "Xendit — takes your downpayment on its own secure page and tells us only that the payment cleared, for how much, and by what method.",
          ],
        },
        {
          id: "pp_7",
          heading: "How long we keep it",
          paragraphs: [
            "Your account details stay with us for as long as your account is open. Orders and their payment records are kept as business records after the event, the way any caterer keeps its books.",
            "Ask us to close your account and we will remove your profile; where we have to keep an order on record, we keep the order and not you — your name and contact details come off it.",
          ],
          bullets: [],
        },
        {
          id: "pp_8",
          heading: "What you can change yourself",
          paragraphs: [
            "Much of it, right here in the app:",
          ],
          bullets: [
            "Your profile photo — the Account tab; tap your picture.",
            "Your notification, dietary and language settings — this Settings screen, at any time.",
            "Your password — \"Forgot password?\" on the log-in screen sends you a reset link.",
            "Your name, e-mail or phone number, and closing your account — message us and we'll do it for you. Your number is also our one-account safeguard, so it's moved by hand.",
          ],
        },
        {
          id: "pp_9",
          heading: "Children",
          paragraphs: [
            "The app is meant for adults booking food for themselves, their families and their events. If you are under 18, please use it with a parent or guardian.",
          ],
          bullets: [],
        },
        {
          id: "pp_10",
          heading: "When this changes",
          paragraphs: [
            "If we change what we collect or who sees it, we will update this page and the date at the top of it. Nothing changes retroactively — a change here describes what we do from that date on.",
          ],
          bullets: [],
        },
      ],
    },
    faqGroups: [
      {
        id: "fg_1",
        title: "BOOKING & ORDERS",
        items: [
          {
            question: "How do I book catering?",
            answer: "Open the Packages tab, choose the package you like and tap \"Book Us Now\". The wizard walks you through the date, the venue, your headcount and a dish for each course, then files the order. It reaches us as Pending right away, and we call your contact number to go through the details.",
          },
          {
            question: "How do I order food packs or party trays?",
            answer: "Also from the Packages tab — \"Book Us Now\" for food packs. It's a shorter form built around our written quotation: the occasion, when and where it's going, and a menu list with a pax count on every dish.",
          },
          {
            question: "What do the order statuses mean?",
            answer: "Pending — we have your order and are going through it.\nConfirmed — your date is locked in and the kitchen is planning for it.\nCompleted — the event is done, and maraming salamat.\nDeclined — we couldn't take that one on. Message us and we'll see what else we can arrange.",
          },
          {
            question: "Where do I see the orders I've sent?",
            answer: "Settings → Order tracking. Every order you've filed is there, newest first, with the open ones on top. It updates itself as we move an order along, so there's nothing to refresh.",
          },
          {
            question: "Can I change or cancel an order I've already sent?",
            answer: "Not from the app. Once an order is filed, its details are ours to change — that's what stops an event being edited out from under the kitchen halfway through the planning. Call or message us and we'll adjust it with you.",
          },
        ],
      },
      {
        id: "fg_2",
        title: "PAYING",
        items: [
          {
            question: "How much do I pay up front?",
            answer: "Half the order total holds your date. The balance is settled with the team on the day of the event.",
          },
          {
            question: "How can I pay the downpayment?",
            answer: "With GCash, Maya, GrabPay or a Visa / Mastercard, on Xendit's secure checkout page. Your card details never pass through this app — we only ever see that the payment cleared.",
          },
          {
            question: "I closed the payment page before finishing. Is my order lost?",
            answer: "No. Your order is filed before the payment, precisely so an interrupted checkout can't lose the form you filled in. Open Order tracking, tap the order and choose Pay — it hands you back the same checkout page, rather than starting a second one.",
          },
          {
            question: "My order says you'll send a quotation. What does that mean?",
            answer: "Some orders are priced by hand — a small delivery, or a spread that needs costing first. Those file without an online downpayment: we'll send you the quotation, then arrange the downpayment with you directly.",
          },
          {
            question: "When is my booking actually confirmed?",
            answer: "When we've been through the details and the downpayment has landed. The status in Order tracking turns to Confirmed the moment it does — you don't have to chase us for it.",
          },
        ],
      },
      {
        id: "fg_3",
        title: "THE MENU & ALLERGENS",
        items: [
          {
            question: "Where do the allergen tags come from?",
            answer: "Our own kitchen tags every dish. On the Menu, the allergen map shows how those tags run across the dishes you're looking at — warmer means both more common and higher-risk, so a peanut tag reads hotter than a soy one.",
          },
          {
            question: "Can you cook around an allergy?",
            answer: "Set the allergens in Settings → Dietary preference and we'll flag any dish on the Menu that carries one. Please also tell us in your booking notes and give us a call: we cook everything in one kitchen on shared equipment, so we can warn you, but we can't promise a dish is free of traces.",
          },
          {
            question: "A dish I liked has disappeared from the Menu.",
            answer: "The kitchen decides what's on show, so a dish comes off when it's out of season or resting for a while. It stays on your past orders, and you can always ask us about it.",
          },
        ],
      },
      {
        id: "fg_4",
        title: "YOUR ACCOUNT",
        items: [
          {
            question: "How do I change my profile photo?",
            answer: "Open the Account tab and tap your picture. You can choose one from your gallery, or remove the one that's there.",
          },
          {
            question: "I've forgotten my password.",
            answer: "On the log-in screen, tap \"Forgot password?\" and give us your email address — a reset link is on its way within a minute or two. Check your spam folder if it seems slow.",
          },
          {
            question: "Can I change my email address or phone number?",
            answer: "Not in the app yet. Your number is also how we keep two accounts from sharing one contact, so it's moved by hand — message us and we'll take care of it.",
          },
          {
            question: "I can't sign in even though my password is right.",
            answer: "An account can be suspended if something has gone wrong with it. Get in touch and we'll go through it with you.",
          },
          {
            question: "What do you do with my information?",
            answer: "Only what we need to cook for you and keep your account working. Settings → Privacy Policy lists exactly what we hold, who sees it, and how to have it changed or removed.",
          },
        ],
      },
      {
        id: "fg_5",
        title: "GABAY",
        items: [
          {
            question: "What is Gabay?",
            answer: "\"Gabay\" means guide — it's your catering companion, in the middle of the bottom bar. It's still in preview: the plan is meal and package ideas drawn from your past orders, matching a package to your budget and headcount, lighter swaps for a dish, and pointers on your event layout. Your two Settings switches — \"Gabay suggestions\" and \"Healthier suggestions first\" — are what it will follow when it opens up.",
          },
        ],
      },
    ],
  };

  const SEED = {
    categories: TYPES.flatMap((type) =>
      TAXONOMY[type].map(([name, icon]) =>
        ({ id: uid(), name, icon, type, price: (DEFAULT_CAT_PRICES[type] || {})[name] ?? 0 }))),
    dishes: [],
    packages: [],
    setups: [],
    allergens: structuredClone(DEFAULT_ALLERGENS),
    settings: { ordering: true, catering: true, featuredOnHome: true, maintenance: false, currency: "₱", schema: 3 },
    about: structuredClone(DEFAULT_ABOUT),
  };

  /* ── Data store ──────────────────────────────────────────────────────── */
  // Reads/writes the live Firestore database when Firebase is configured;
  // falls back to localStorage so the page still works as a local demo.
  const KEY = "hp_admin_content_v3";
  let DB = null;

  /* Stale-while-revalidate cache. The last-loaded content is kept in
     IndexedDB so navigating between pages paints instantly from the cache
     while fresh data re-fetches in the background. IndexedDB, NOT
     sessionStorage: product/package/setup images are inline data URLs, so the
     serialized DB easily exceeds sessionStorage's ~5MB quota — writes there
     failed silently and every navigation paid a full multi-MB refetch.
     Sensitive auth still runs on every page (hp-guard.js); only the
     non-sensitive menu content is cached. Cleared on logout / bounce
     (clearCache). */
  const IDB_NAME = "hp_admin_cache", IDB_STORE = "kv", CACHE_KEY = "content_v5";
  const META_KEY = "meta_v6";
  const IMG_KEYS = {
    dishes: "img_dishes_v6",
    packages: "img_packages_v6",
    setups: "img_setups_v6",
  };
  const PAGE_FILE = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  const PAGE_IMG_KIND =
    PAGE_FILE === "products.html" ? "dishes" :
    PAGE_FILE === "packages.html" ? "packages" :
    PAGE_FILE === "setups.html"   ? "setups" : null;
  const hydratedImages = { dishes: false, packages: false, setups: false };
  const dirtyImages = new Set();

  /* A fresh-enough cache also skips the background refetch entirely — the
     full dataset measures ~43MB (inline images), so a refetch is never casual.
     Local writes update the cache optimistically, so within one session it is
     authoritative anyway; the TTL only bounds staleness against edits made
     from another device, and it must stay long: at 43MB per refetch, an eager
     TTL would burn the Firestore free tier's monthly egress in a few hundred
     page views. */
  const CACHE_TTL = 30 * 60 * 1000;
  let cacheAt = 0;

  function openIdb() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(IDB_STORE);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("IndexedDB blocked"));
      open.onsuccess = () => resolve(open.result);
    });
  }

  function idbTx(mode, work) {
    return openIdb().then((db) => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, mode);
        const store = tx.objectStore(IDB_STORE);
        const out = work(store, tx);
        tx.oncomplete = () => { db.close(); resolve(out); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error("IndexedDB aborted")); };
      } catch (e) {
        try { db.close(); } catch { /* ignore */ }
        reject(e);
      }
    }));
  }

  function buildMetaDb(src) {
    let previewSetups = 0;
    return {
      ...src,
      dishes: (src.dishes || []).map(({ image, ...rest }) => rest),
      packages: (src.packages || []).map(({ image, ...rest }) => rest),
      setups: (src.setups || []).map((s) => {
        if (!s.deleted && s.image && previewSetups < 4) {
          previewSetups++;
          return s;
        }
        const { image, ...rest } = s;
        return rest;
      }),
    };
  }

  function buildImgMap(rows) {
    const map = {};
    (rows || []).forEach((r) => {
      if (r && r.id && r.image) map[r.id] = r.image;
    });
    return map;
  }

  function applyImgMap(rows, map) {
    if (!Array.isArray(rows) || !map) return;
    rows.forEach((r) => {
      if (r && r.id && map[r.id]) r.image = map[r.id];
    });
  }

  // Split IndexedDB cache: `meta_v6` (~35 KB) holds all metadata without heavy
  // base64 strings so lightweight pages (Overview, Categories, Allergens,
  // Announcements, About, Users, Settings) load in <10ms. Image maps are only
  // read on the page that renders them (Products, Packages, or Setups).
  let cacheTimer = null;
  function writeCache(dirtyKind) {
    if (!DB) return;
    cacheAt = Date.now();
    if (dirtyKind === "all") {
      dirtyImages.add("dishes").add("packages").add("setups");
    } else if (dirtyKind && IMG_KEYS[dirtyKind] && hydratedImages[dirtyKind]) {
      dirtyImages.add(dirtyKind);
    }
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(writeCacheNow, 1200);
  }

  function writeCacheNow() {
    clearTimeout(cacheTimer);
    cacheTimer = null;
    if (!DB) return;
    const toWrite = Array.from(dirtyImages).filter((k) => hydratedImages[k]);
    dirtyImages.clear();
    const metaPayload = { at: cacheAt, db: buildMetaDb(DB) };
    idbTx("readwrite", (s) => {
      s.put(metaPayload, META_KEY);
      toWrite.forEach((k) => s.put(buildImgMap(DB[k]), IMG_KEYS[k]));
    })
      .catch(() => {
        try {
          const plain = JSON.parse(JSON.stringify(metaPayload));
          return idbTx("readwrite", (s) => {
            s.put(plain, META_KEY);
            toWrite.forEach((k) => s.put(buildImgMap(DB[k]), IMG_KEYS[k]));
          });
        } catch (e) { return Promise.reject(e); }
      })
      .catch((e) => console.warn("HapagPamana: cache write failed — navigation stays network-bound.", e));
  }

  window.addEventListener("pagehide", () => { if (cacheTimer) writeCacheNow(); });

  function clearCache() {
    cacheAt = 0;
    clearTimeout(cacheTimer);
    cacheTimer = null;
    dirtyImages.clear();
    idbTx("readwrite", (s) => {
      s.delete(META_KEY);
      s.delete(CACHE_KEY);
      Object.values(IMG_KEYS).forEach((k) => s.delete(k));
    }).catch(() => { /* ignore */ });
  }

  async function hydrateAllImages() {
    if (!DB) return;
    const missing = Object.keys(IMG_KEYS).filter((k) => !hydratedImages[k]);
    if (!missing.length) return;
    try {
      const maps = {};
      await idbTx("readonly", (s) => {
        missing.forEach((k) => {
          const r = s.get(IMG_KEYS[k]);
          r.onsuccess = () => { maps[k] = r.result; };
        });
      });
      missing.forEach((k) => {
        if (maps[k]) {
          applyImgMap(DB[k], maps[k]);
          hydratedImages[k] = true;
        }
      });
    } catch { /* ignore */ }
  }

  // Raw cache read, kicked off immediately so it races page setup. Reads only
  // `meta_v6` (~35 KB) plus the current page's image collection if needed.
  const cacheRead = (async () => {
    try {
      let meta = null, imgMap = null;
      await idbTx("readonly", (s) => {
        const mReq = s.get(META_KEY);
        mReq.onsuccess = () => { meta = mReq.result; };
        if (PAGE_IMG_KIND) {
          const iReq = s.get(IMG_KEYS[PAGE_IMG_KIND]);
          iReq.onsuccess = () => { imgMap = iReq.result; };
        }
      });
      if (meta && meta.db) {
        if (PAGE_IMG_KIND && imgMap) {
          applyImgMap(meta.db[PAGE_IMG_KIND], imgMap);
          hydratedImages[PAGE_IMG_KIND] = true;
        }
        return meta;
      }
      // One-time migration from legacy monolithic `content_v5` blob if present
      let legacy = null;
      await idbTx("readonly", (s) => {
        const lReq = s.get(CACHE_KEY);
        lReq.onsuccess = () => { legacy = lReq.result; };
      });
      if (legacy && legacy.db) {
        hydratedImages.dishes = hydratedImages.packages = hydratedImages.setups = true;
        setTimeout(() => {
          writeCache("all");
          idbTx("readwrite", (s) => s.delete(CACHE_KEY)).catch(() => {});
        }, 300);
        return legacy;
      }
      return null;
    } catch {
      return null;
    }
  })();

  // In-memory key → Firestore collection name. Settings is a single document.
  const COLL = { categories: "categories", dishes: "products", packages: "packages", setups: "setups" };
  const SETTINGS_REF = () => FB.db.collection("settings").doc("app");
  const ALLERGENS_REF = () => FB.db.collection("settings").doc("allergens");
  const ABOUT_REF = () => FB.db.collection("settings").doc("about");
  const PRODUCT_INDEX_REF = () => FB.db.collection("settings").doc("productIndex");

  /* Lightweight product index (settings/productIndex): one tiny doc mapping
     product id → { n: name, c: category, t: type } — NO images. The Master
     Chef's dish picker reads this single doc instead of downloading the
     whole multi-megabyte products collection just for names. Rebuilt from
     the in-memory dishes (debounced) after every product save/delete and
     after each fresh load, so it tracks the menu without extra reads. */
  let productIndexTimer = null;
  function scheduleProductIndex() {
    if (!ONLINE) return;
    clearTimeout(productIndexTimer);
    productIndexTimer = setTimeout(writeProductIndex, 2000);
  }
  function writeProductIndex() {
    productIndexTimer = null;
    const items = {};
    (DB && DB.dishes ? DB.dishes : []).forEach((d) => {
      const name = String(d.name || "").trim();
      if (!name || d.deleted) return; // trashed dishes stay out of the picker
      items[d.id] = { n: name, c: String(d.category || ""), t: String(d.type || ""), a: d.available !== false };
    });
    PRODUCT_INDEX_REF().set({ items, updatedAt: Date.now() })
      .catch((e) => console.warn("HapagPamana: couldn't refresh the product index —", e));
  }
  const stripId = (o) => { const { id, ...rest } = o; return rest; };
  const docToObj = (d) => ({ id: d.id, ...d.data() });

  async function getWithRetry(queryFn, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await queryFn();
      } catch (e) {
        lastErr = e;
        if (e && e.code === "permission-denied") throw e;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  async function loadFromFirestore() {
    // Stage 1: fetch lightweight metadata (~20 KB total) in parallel.
    const [cats, sett, algn, abt] = await Promise.all([
      getWithRetry(() => FB.db.collection(COLL.categories).get()),
      getWithRetry(() => SETTINGS_REF().get()),
      ALLERGENS_REF().get().catch(() => ({ exists: false })),
      ABOUT_REF().get().catch(() => ({ exists: false })),
    ]);

    // Stage 2: fetch media-heavy collections sequentially so 43 MB of inline
    // base64 images never multiplex simultaneously and stall the WebChannel /
    // HTTP long-polling stream. Prioritize the current page's collection first.
    const mediaOrder = ["packages", "setups", "dishes"];
    if (PAGE_IMG_KIND && mediaOrder.includes(PAGE_IMG_KIND)) {
      mediaOrder.splice(mediaOrder.indexOf(PAGE_IMG_KIND), 1);
      mediaOrder.unshift(PAGE_IMG_KIND);
    }
    const snaps = {};
    for (const kind of mediaOrder) {
      snaps[kind] = await getWithRetry(() => FB.db.collection(COLL[kind]).get());
    }

    return {
      categories: cats.docs.map(docToObj),
      dishes: snaps.dishes.docs.map(docToObj),
      packages: snaps.packages.docs.map(docToObj),
      setups: snaps.setups.docs.map(docToObj),
      settings: sett.exists ? { ...structuredClone(SEED.settings), ...sett.data() } : structuredClone(SEED.settings),
      allergens: (algn && algn.exists && normalizeAllergens((algn.data() || {}).list))
        || structuredClone(DEFAULT_ALLERGENS),
      about: (abt && abt.exists && abt.data()) ? { ...structuredClone(DEFAULT_ABOUT), ...abt.data() } : structuredClone(DEFAULT_ABOUT),
      _seeded: sett.exists,
      _allergensSeeded: Boolean(algn && algn.exists),
    };
  }

  async function seedFirestore() {
    const batch = FB.db.batch();
    ["categories", "dishes", "packages"].forEach((k) =>
      SEED[k].forEach((row) => batch.set(FB.db.collection(COLL[k]).doc(row.id), stripId(row))));
    batch.set(SETTINGS_REF(), SEED.settings);
    batch.set(ABOUT_REF(), SEED.about);
    await batch.commit();
  }

  function adoptLoaded(data) {
    if (!DB) { DB = data; return; }
    Object.keys(COLL).forEach((k) => {
      const cur = Array.isArray(DB[k]) ? DB[k] : (DB[k] = []);
      const byId = new Map(cur.map((r) => [r && r.id, r]));
      const next = (data[k] || []).map((f) => {
        const t = byId.get(f.id);
        if (!t) return f;
        // Refresh the surviving row in place so held references stay live.
        Object.keys(t).forEach((key) => { if (key !== "id" && !(key in f)) delete t[key]; });
        return Object.assign(t, f);
      });
      cur.length = 0;
      cur.push(...next);
    });
    DB.settings = Object.assign(DB.settings || {}, data.settings);
    if (Array.isArray(DB.allergens)) DB.allergens.splice(0, DB.allergens.length, ...data.allergens);
    else DB.allergens = data.allergens;
    DB.about = Object.assign(structuredClone(DEFAULT_ABOUT), DB.about || {}, data.about || {});
  }

  async function load() {
    if (!ONLINE) {
      try {
        const raw = localStorage.getItem(KEY);
        DB = raw ? JSON.parse(raw) : structuredClone(SEED);
      } catch { DB = structuredClone(SEED); }
      await ensureSchema();
      hydratedImages.dishes = hydratedImages.packages = hydratedImages.setups = true;
      writeCache("all");
      return DB;
    }
    let data = await loadFromFirestore(); // throws only if READS are denied
    // Seed the sample taxonomy exactly once — on the very first run, before any
    // settings document exists. After that Firestore is the single source of
    // truth: deleting content never makes the samples reappear. A write failure
    // here (read-only access) is non-fatal: we keep the real (empty) data.
    if (!data._seeded) {
      try { await seedFirestore(); data = await loadFromFirestore(); }
      catch (e) { console.warn("HapagPamana: couldn't seed the database (write denied?) —", e); }
    }
    // Same first-run convenience for the allergen taxonomy: write the defaults
    // once so the doc exists for the app to read and the Settings page to edit.
    if (!data._allergensSeeded) {
      try { await ALLERGENS_REF().set({ list: DEFAULT_ALLERGENS }); }
      catch (e) { console.warn("HapagPamana: couldn't seed the allergen taxonomy —", e); }
    }
    delete data._seeded;
    delete data._allergensSeeded;
    adoptLoaded(data);
    hydratedImages.dishes = hydratedImages.packages = hydratedImages.setups = true;
    try { await ensureSchema(); }
    catch (e) { console.warn("HapagPamana: schema check skipped —", e); }
    cacheAt = Date.now();
    dirtyImages.add("dishes").add("packages").add("setups");
    writeCacheNow();
    scheduleProductIndex(); // keep the dish picker's index doc current
    return DB;
  }

  // Persistence. Writes are optimistic: the in-memory DB has already changed
  // and the view re-renders immediately; a failed write surfaces a toast AND
  // rolls the optimistic change back so the UI never keeps showing an edit
  // that isn't actually saved.
  function persistLocal() { localStorage.setItem(KEY, JSON.stringify(DB)); }

  // Audit stamp carried on every write: when, and by which staff uid.
  const stamp = () => ({
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: FB && FB.auth.currentUser ? FB.auth.currentUser.uid : null,
  });

  // A failed write must not leave the in-memory change (and the cache stamped
  // with it) pretending it saved. `revert` re-reads just the affected slice
  // from the server — never the whole multi-MB dataset — and puts memory back
  // in line; if even that read fails (offline) the optimistic copy stays and
  // the next successful load reconciles it. The toast says WHY it failed:
  // permission problems need a rules fix, not a retry.
  function onWriteError(e, what, revert) {
    const denied = e && e.code === "permission-denied";
    Promise.resolve().then(revert)
      .then(() => { writeCache("all"); notifyRefresh(); })
      .catch(() => { /* offline — the next load reconciles */ })
      .then(() => toast(denied
        ? `Couldn't ${what} — your account doesn't have permission.`
        : `Couldn't ${what} — check your connection and try again.`, "danger"));
  }

  function persist(kind, obj) {
    writeCache(kind); // keep the session cache in step with the in-memory change
    if (kind === "dishes") scheduleProductIndex();
    if (!ONLINE) return persistLocal();
    const ref = FB.db.collection(COLL[kind]).doc(obj.id);
    ref.set({ ...stripId(obj), ...stamp() }, { merge: true }).catch((e) =>
      onWriteError(e, "save to the database", async () => {
        const snap = await ref.get();
        const rows = DB[kind] || (DB[kind] = []);
        const i = rows.findIndex((r) => r.id === obj.id);
        if (snap.exists) { if (i >= 0) rows[i] = docToObj(snap); else rows.push(docToObj(snap)); }
        else if (i >= 0) rows.splice(i, 1);
      }));
  }
  function remove(kind, id) {
    writeCache(kind);
    if (kind === "dishes") scheduleProductIndex();
    if (!ONLINE) return persistLocal();
    const ref = FB.db.collection(COLL[kind]).doc(id);
    ref.delete().catch((e) =>
      onWriteError(e, "delete from the database", async () => {
        const snap = await ref.get();
        if (!snap.exists) return; // gone after all — nothing to restore
        const rows = DB[kind] || (DB[kind] = []);
        if (!rows.some((r) => r.id === id)) rows.push(docToObj(snap));
      }));
  }
  // Update only the named fields on many docs at once — chunked batches
  // under Firestore's 500-op cap. Cascades (a category rename touching
  // dozens of dishes) MUST come through here: a per-row persist() would
  // rewrite each full document, base64 image included, burning quota.
  async function updateFields(kind, updates) { // updates: [{ id, fields }]
    writeCache();
    if (kind === "dishes") scheduleProductIndex();
    if (!ONLINE) return persistLocal();
    try {
      for (let i = 0; i < updates.length; i += 400) {
        const batch = FB.db.batch();
        updates.slice(i, i + 400).forEach((u) =>
          batch.update(FB.db.collection(COLL[kind]).doc(u.id), { ...u.fields, ...stamp() }));
        await batch.commit();
      }
    } catch (e) {
      // A batch failed partway — re-sync from the server so memory and cache
      // reflect what actually landed.
      onWriteError(e, "apply the change to every item", () => load());
    }
  }
  function persistSettings() {
    writeCache();
    if (!ONLINE) return persistLocal();
    SETTINGS_REF().set({ ...DB.settings, ...stamp() }, { merge: true }).catch((e) =>
      onWriteError(e, "save settings", async () => {
        const snap = await SETTINGS_REF().get();
        DB.settings = { ...structuredClone(SEED.settings), ...(snap.exists ? snap.data() : {}) };
      }));
  }
  function persistAllergens() {
    writeCache();
    if (!ONLINE) return persistLocal();
    ALLERGENS_REF().set({ list: DB.allergens, ...stamp() }).catch((e) =>
      onWriteError(e, "save the allergens", async () => {
        const snap = await ALLERGENS_REF().get();
        const list = (snap.exists && normalizeAllergens((snap.data() || {}).list))
          || structuredClone(DEFAULT_ALLERGENS);
        if (Array.isArray(DB.allergens)) DB.allergens.splice(0, DB.allergens.length, ...list);
        else DB.allergens = list;
      }));
  }
  function persistAbout(data) {
    if (data) DB.about = data;
    writeCache();
    if (!ONLINE) return persistLocal();
    ABOUT_REF().set({ ...DB.about, ...stamp() }, { merge: true }).catch((e) =>
      onWriteError(e, "save about content", async () => {
        const snap = await ABOUT_REF().get();
        DB.about = snap.exists ? { ...structuredClone(DEFAULT_ABOUT), ...snap.data() } : structuredClone(DEFAULT_ABOUT);
      }));
  }

  /* Soft delete: the row keeps its document, flagged `deleted` (and forced
     invisible in the app via its visibility field), and waits in the
     Settings-page Trash until it is restored or deleted forever. Only staff
     can flip the flag — content writes are moderator-only in the rules. */
  const HIDE_FIELD = { dishes: "available", packages: "active", setups: "visible" };
  function softRemove(kind, id) {
    const row = (DB[kind] || []).find((r) => r.id === id);
    if (row) {
      row.deleted = true;
      row.deletedAt = Date.now(); // display value until the server copy lands
      if (HIDE_FIELD[kind]) row[HIDE_FIELD[kind]] = false;
    }
    const fields = {
      deleted: true,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deletedBy: FB && FB.auth.currentUser ? FB.auth.currentUser.uid : null,
    };
    if (HIDE_FIELD[kind]) fields[HIDE_FIELD[kind]] = false;
    updateFields(kind, [{ id, fields }]);
  }
  /* Remove a field outright, in memory and in the backing store. persist()
     merges, so writing null there would STORE a null rather than delete the
     key — and a null add-on override reads as ₱0 (a free dish) to anything
     that coerces it. Clearing an optional field has to go through here. */
  function clearFields(kind, id, keys) {
    const row = (DB[kind] || []).find((r) => r.id === id);
    if (row) keys.forEach((k) => delete row[k]);
    writeCache();
    if (kind === "dishes") scheduleProductIndex();
    if (!ONLINE) return persistLocal();
    const gone = firebase.firestore.FieldValue.delete();
    const fields = {};
    keys.forEach((k) => { fields[k] = gone; });
    updateFields(kind, [{ id, fields }]);
  }

  // Bring a trashed row back. Its visibility flag stays off — the moderator
  // re-enables deliberately once they've checked the item over.
  function restore(kind, id) {
    const row = (DB[kind] || []).find((r) => r.id === id);
    if (row) { delete row.deleted; delete row.deletedAt; delete row.deletedBy; }
    const gone = firebase.firestore.FieldValue.delete();
    updateFields(kind, [{ id, fields: { deleted: gone, deletedAt: gone, deletedBy: gone } }]);
  }

  /* Import a JSON export (the shape exportData writes): upsert every row by
     id, in batches capped by op count AND bytes — product rows carry inline
     images and a Firestore request tops out around 10 MB. Oversized rows
     (near the 1 MiB document cap) are skipped and reported. Returns
     { written, skipped } for the caller's summary. */
  async function importContent(data) {
    if (!ONLINE) throw new Error("offline");
    const kinds = ["categories", "dishes", "packages", "setups"];
    const ops = [], skipped = [];
    kinds.forEach((k) => (Array.isArray(data[k]) ? data[k] : []).forEach((row) => {
      if (!row || typeof row !== "object") return;
      const id = String(row.id || uid());
      const body = stripId({ ...row, id });
      const bytes = JSON.stringify(body).length;
      if (bytes > 950 * 1024) { skipped.push(`${k}: ${String(row.name || row.title || id)}`); return; }
      ops.push({ kind: k, id, body, bytes });
    }));
    let batch = FB.db.batch(), n = 0, size = 0, written = 0;
    for (const op of ops) {
      if (n >= 300 || size + op.bytes > 8 * 1024 * 1024) {
        await batch.commit();
        batch = FB.db.batch(); n = 0; size = 0;
      }
      batch.set(FB.db.collection(COLL[op.kind]).doc(op.id), { ...op.body, ...stamp() }, { merge: true });
      n++; size += op.bytes; written++;
    }
    if (n) await batch.commit();
    if (data.settings && typeof data.settings === "object") {
      const { schema, ...rest } = data.settings; // never import a schema stamp
      await SETTINGS_REF().set({ ...rest, ...stamp() }, { merge: true });
    }
    const alg = normalizeAllergens(data.allergens);
    if (alg && alg.length) await ALLERGENS_REF().set({ list: alg, ...stamp() });
    await load(); // adopt the imported truth into memory + cache
    notifyRefresh();
    return { written, skipped };
  }

  // Wipe every content collection, then write the seed (the category
  // taxonomy — SEED carries no sample business records) back.
  async function wipeAndSeed() {
    const snaps = await Promise.all(Object.values(COLL).map((c) => FB.db.collection(c).get()));
    const refs = [];
    snaps.forEach((s) => s.docs.forEach((d) => refs.push(d.ref)));
    // Firestore caps a batch at 500 ops; chunk to stay safely under it.
    for (let i = 0; i < refs.length; i += 400) {
      const batch = FB.db.batch();
      refs.slice(i, i + 400).forEach((r) => batch.delete(r));
      await batch.commit();
    }
    await seedFirestore();
  }

  // Erase all content and restore the seed — wipes the content collections,
  // re-seeds the category taxonomy, then reloads.
  async function resetData() {
    if (!ONLINE) { DB = structuredClone(SEED); persistLocal(); writeCache(); return; }
    await wipeAndSeed();
    adoptLoaded(await loadFromFirestore());
    writeCache();
  }

  /* ── Schema migration (v1 → v2: product types + per-type categories) ──────
     v1 had a single, type-less category list (Mains/Noodles/…). v2 splits the
     menu into two product types, each with its own categories. On first load
     after the upgrade we bring older data up to the new shape:
       · pristine v1 sample  → replaced cleanly with the new typed sample;
       · customised v1 data  → migrated in place (non-destructive): every
         category/product gets a `type`, and the full default taxonomy is
         ensured so both types always have their complete filter lists.
     Guarded by settings.schema so it runs exactly once. */
  const V1_SEED_CATS = ["Mains", "Appetizers", "Noodles", "Soups", "Vegetables", "Desserts", "Beverages"];
  const V1_CAT_TYPE = {
    Mains: "Food Packs", Noodles: "Food Packs", Vegetables: "Food Packs", Desserts: "Food Packs",
    Appetizers: "Catering Food Trays", Soups: "Catering Food Trays", Beverages: "Catering Food Trays",
  };

  function backfillTypes() {
    // 1 · every category gets a type (best-effort map, else the first type).
    //     Field-only chunked updates — never a full-doc rewrite.
    const catFixes = [];
    DB.categories.forEach((c) => {
      if (!c.type) { c.type = V1_CAT_TYPE[c.name] || TYPES[0]; catFixes.push({ id: c.id, fields: { type: c.type } }); }
    });
    if (catFixes.length) updateFields("categories", catFixes);
    // 2 · ensure the full default taxonomy exists for both types (creates).
    TYPES.forEach((type) => TAXONOMY[type].forEach(([name, icon]) => {
      if (!DB.categories.some((c) => c.type === type && c.name === name)) {
        const rec = { id: uid(), name, icon, type };
        DB.categories.push(rec); persist("categories", rec);
      }
    }));
    // 3 · every product gets a type, inferred from its category — field-only,
    //     so the dishes' inline images are never re-uploaded.
    const dishFixes = [];
    DB.dishes.forEach((d) => {
      if (!d.type) {
        const cat = DB.categories.find((c) => c.name === d.category);
        d.type = (cat && cat.type) || TYPES[0];
        dishFixes.push({ id: d.id, fields: { type: d.type } });
      }
    });
    if (dishFixes.length) updateFields("dishes", dishFixes);
  }

  // v2 → v3 migration: products dropped their price/description. Remove those
  // fields from every existing product — in memory and in the backing store
  // (Firestore field deletes when online, localStorage otherwise).
  async function stripDishExtras() {
    const stale = DB.dishes.filter((d) => "price" in d || "desc" in d);
    if (!stale.length) return;
    stale.forEach((d) => { delete d.price; delete d.desc; });
    writeCache();
    if (!ONLINE) return persistLocal();
    const del = firebase.firestore.FieldValue.delete();
    // Firestore caps a batch at 500 ops; chunk to stay safely under it.
    for (let i = 0; i < stale.length; i += 400) {
      const batch = FB.db.batch();
      stale.slice(i, i + 400).forEach((d) =>
        batch.update(FB.db.collection(COLL.dishes).doc(d.id), { price: del, desc: del }));
      await batch.commit();
    }
  }

  /* v6 → v7: add-on pricing. Categories gain a per-head `price` and the three
     flat-rate dishes from the ADD-ONS card gain their `addOnPrice` override.
     Only rows that carry no number yet are touched, so a rate already set by
     hand is never overwritten. Field-only chunked updates — the products'
     inline images are not rewritten along for the ride. */
  function seedAddOnPrices() {
    const catFixes = [];
    DB.categories.forEach((c) => {
      if (rateOf(c.price) !== null) return;
      const rate = (DEFAULT_CAT_PRICES[c.type] || {})[c.name];
      if (!Number.isFinite(rate)) return; // custom category — the moderator prices it
      c.price = rate;
      catFixes.push({ id: c.id, fields: { price: rate } });
    });
    if (catFixes.length) updateFields("categories", catFixes);

    const dishFixes = [];
    DB.dishes.forEach((d) => {
      if (rateOf(d.addOnPrice) !== null) return;
      const rate = DEFAULT_DISH_PRICES[String(d.name || "").trim().toLowerCase()];
      if (!Number.isFinite(rate)) return;
      d.addOnPrice = rate;
      dishFixes.push({ id: d.id, fields: { addOnPrice: rate } });
    });
    if (dishFixes.length) updateFields("dishes", dishFixes);

    if (catFixes.length || dishFixes.length) {
      console.info(`HapagPamana: priced ${catFixes.length} categor${catFixes.length === 1 ? "y" : "ies"} `
        + `and ${dishFixes.length} add-on dish${dishFixes.length === 1 ? "" : "es"}.`);
    }
  }

  // Highest schema version this build understands. The steps below bring older
  // data up to it exactly once, gated by settings.schema.
  const SCHEMA = 7;
  async function ensureSchema() {
    if (!DB) return;
    if (!DB.settings) DB.settings = structuredClone(SEED.settings);
    // Older caches / local stores predate the editable taxonomy.
    if (!Array.isArray(DB.allergens)) DB.allergens = structuredClone(DEFAULT_ALLERGENS);
    if (!DB.about) DB.about = structuredClone(DEFAULT_ABOUT);
    const from = DB.settings.schema || 1;
    if (from >= SCHEMA) return;

    // v1 → v2: split the menu into product types with per-type categories.
    if (from < 2) {
      const names = DB.categories.map((c) => c.name).sort();
      const untouchedV1 =
        !DB.categories.some((c) => c.type) &&
        JSON.stringify(names) === JSON.stringify([...V1_SEED_CATS].sort());
      if (untouchedV1) {
        await resetData(); // pristine demo → load the new typed sample cleanly
        return;            // resetData re-seeds from SEED.settings (schema:SCHEMA)
      }
      backfillTypes();
    }

    // v2 → v3: drop the now-unused price/desc fields from products.
    if (from < 3) await stripDishExtras();

    // v3 → v4: deduplicate categories — backfillTypes() could have written
    // duplicate (name+type) docs if Firestore already had those categories.
    if (from < 4) await dedupCategories();

    // v4 → v5: mend the menu taxonomy — restore any deleted default category
    // cards and move misfiled dishes to the category their name describes.
    if (from < 5) recategorizeDishes();

    // v5 → v6: the Food Packs Pasta / Noodles / Sandwich categories existed
    // but sat empty — those dishes were filed only under Catering Food Trays.
    // The business offers the same dishes as food packs, so mirror them in.
    if (from < 6) mirrorFoodPackDishes();

    // v6 → v7: give every default category its printed per-head add-on rate,
    // and the three flat-rate dishes their own.
    if (from < 7) seedAddOnPrices();

    DB.settings.schema = SCHEMA;
    persistSettings();
  }

  // Remove duplicate category documents that share the same name+type, keeping
  // the first occurrence. Deletes the extras from Firestore (or localStorage).
  async function dedupCategories() {
    const seen = new Set();
    const dupes = [];
    DB.categories = DB.categories.filter((c) => {
      const key = `${c.type}||${c.name.toLowerCase()}`;
      if (seen.has(key)) { dupes.push(c.id); return false; }
      seen.add(key);
      return true;
    });
    if (!dupes.length) return;
    console.info(`HapagPamana: removed ${dupes.length} duplicate categor${dupes.length === 1 ? "y" : "ies"}.`);
    if (!ONLINE) return persistLocal();
    // Delete in batches of 400 to stay under Firestore's 500-op batch limit.
    for (let i = 0; i < dupes.length; i += 400) {
      const batch = FB.db.batch();
      dupes.slice(i, i + 400).forEach((id) => batch.delete(FB.db.collection(COLL.categories).doc(id)));
      await batch.commit();
    }
  }

  /* v4 → v5 data mend: an audit of the live menu found dishes filed under the
     wrong category. Keys are lowercased product names per type; a dish is
     moved only when its current category differs, so anything already fixed
     by hand is left untouched. */
  const RECAT = {
    "Food Packs": {
      // Fin fish belong under the Food Packs "Fish" category (it sat empty
      // while these lived under Seafood — which keeps shrimp/squid/calamari).
      "baked salmon": "Fish",
      "fish fillet (aioli or tartar sauce)": "Fish",
      "grilled blue marlin with garlic butter sauce": "Fish",
      "inihaw na tanigue": "Fish",
      "inihaw na tiyan ng tuna": "Fish",
      "pinasingaw na pampano": "Fish",
      "chahan shrimp fried rice": "Rice",
      "paella verde": "Rice",
      "ensaladang gulay na may inasal": "Salad",
    },
    "Catering Food Trays": {
      "pancit canton": "Noodles",
      "scampi pasta": "Pasta",
      "tomato basil penne": "Pasta",
      "chahan shrimp fried rice": "Rice",
      "paella verde": "Rice",
      "ensaladang gulay na may inasal": "Salad",
      "mini sandwich": "Sandwich",
    },
  };

  function recategorizeDishes() {
    // 1 · restore any deleted default category cards — deleting one orphans
    //     its products (Food Packs "Seafood" had gone missing this way).
    TYPES.forEach((type) => TAXONOMY[type].forEach(([name, icon]) => {
      if (!DB.categories.some((c) => c.type === type && c.name === name)) {
        const rec = { id: uid(), name, icon, type };
        DB.categories.push(rec);
        persist("categories", rec);
      }
    }));
    // 2 · Yangchow Fried Rice was seeded (id seed_fp_…) into the wrong type.
    // 3 · move misfiled dishes to the category their name describes.
    //     Field-only chunked updates — the images stay untouched in place.
    const fixes = [];
    DB.dishes.forEach((d) => {
      const name = String(d.name || "").trim().toLowerCase();
      let touched = false;
      if (d.type === "Catering Food Trays" && name === "yangchow fried rice") {
        d.type = "Food Packs"; touched = true;
      }
      const to = (RECAT[d.type] || {})[name];
      if (to && d.category !== to) { d.category = to; touched = true; }
      if (touched) fixes.push({ id: d.id, fields: { category: d.category, type: d.type } });
    });
    if (fixes.length) {
      updateFields("dishes", fixes);
      console.info(`HapagPamana: recategorized ${fixes.length} product${fixes.length === 1 ? "" : "s"}.`);
    }
  }

  /* v5 → v6 data mend: give the Food Packs menu the same dishes the catering
     menu carries in the categories that exist on both sides but were empty on
     the Food Packs side. Each catering dish is copied as a new Food Packs
     product (same name, photo, allergens; never marked featured). Guarded two
     ways so it can never double anything up: a category already holding any
     food-pack dish is skipped entirely, and a dish whose name already exists
     on the Food Packs side is skipped individually. */
  const FP_MIRROR_CATS = ["Pasta", "Noodles", "Sandwich"];
  function mirrorFoodPackDishes() {
    let added = 0;
    FP_MIRROR_CATS.forEach((cat) => {
      const hasAny = DB.dishes.some((d) => d.type === "Food Packs" && d.category === cat);
      if (hasAny) return; // hand-curated already — leave it alone
      DB.dishes
        .filter((d) => d.type === "Catering Food Trays" && d.category === cat)
        .forEach((src) => {
          const name = String(src.name || "").trim();
          const exists = DB.dishes.some((d) =>
            d.type === "Food Packs" &&
            String(d.name || "").trim().toLowerCase() === name.toLowerCase());
          if (!name || exists) return;
          const rec = {
            id: uid(),
            name,
            type: "Food Packs",
            category: cat,
            image: src.image || "",
            available: src.available !== false,
            featured: false,
            allergens: Array.isArray(src.allergens) ? [...src.allergens] : [],
          };
          DB.dishes.push(rec);
          persist("dishes", rec);
          added++;
        });
    });
    if (added) console.info(`HapagPamana: mirrored ${added} catering dish${added === 1 ? "" : "es"} into Food Packs.`);
  }

  // "Export as JSON" — download the current content as a JSON file.
  async function exportData() {
    if (!DB) { toast("The content is still loading — try again in a moment.", "warn"); return; }
    await hydrateAllImages();
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "hapagpamana_content.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Content exported as JSON.");
  }

  /* ── Image compression (shared by Products + Setups + Packages) ──────────
     Downscale + re-encode a picked image to a data URL that comfortably fits a
     Firestore document. Draws once to a capped canvas, then steps the JPEG
     quality down until the encoded string is under the byte budget. */
  function compressImage(file, { maxSize = 1000, quality = 0.85, step = 0.12, budget = 650 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      if (!file.type || !file.type.startsWith("image/")) return reject(new Error("not an image"));
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("read error"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode error"));
        img.onload = () => {
          const encode = (cap) => {
            let { width, height } = img;
            if (Math.max(width, height) > cap) {
              const scale = cap / Math.max(width, height);
              width = Math.round(width * scale); height = Math.round(height * scale);
            }
            const canvas = document.createElement("canvas");
            canvas.width = width; canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            let q = quality, out = canvas.toDataURL("image/jpeg", q);
            while (out.length > budget && q > 0.3) { q -= step; out = canvas.toDataURL("image/jpeg", q); }
            return out;
          };
          // The quality floor alone can leave a dense photo over budget —
          // step the dimensions down before giving up, and never resolve
          // with an oversized payload (it would push the parent document
          // toward Firestore's 1 MiB limit).
          let cap = maxSize, out = encode(cap);
          while (out.length > budget && cap > 300) { cap = Math.round(cap * 0.8); out = encode(cap); }
          if (out.length > budget) return reject(new Error("image too large"));
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── Boot: resolves once there is data to paint and (online) the user is
     known. Every CM page awaits HP.ready before painting data-driven content.
     Stale-while-revalidate: when the IndexedDB cache has a copy, ready
     resolves from it immediately and the Firestore refetch (skipped entirely
     while the cache is fresher than CACHE_TTL) runs in the background,
     repainting subscribed pages via onRefresh when it lands. The shared
     core's ready resolves at sign-in; it becomes the trigger for the
     cache/network race below, and HP.ready is re-pointed at the data-ready
     promise so pages keep their `HP.ready.then(render)` unchanged. */
  const refreshFns = [];
  function onRefresh(fn) { refreshFns.push(fn); }
  function notifyRefresh() {
    refreshFns.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }

  const authReady = HP.ready;
  const ready = new Promise((resolve) => {
    authReady.then((auth) => {
      if (!auth.online) { load().then(() => resolve(auth)); return; }

      /* First data wins. The cache read and the network load race; whichever
         lands first resolves ready (paints the pages), and the loser only
         updates. The network load starts after a short grace period so a
         quick cache hit can skip it entirely (TTL), but a slow cache read —
         the record carries megabytes of inline images — never delays or
         blocks the page: worst case boots exactly like the pre-cache code. */
      const t0 = performance.now();
      const ms = () => Math.round(performance.now() - t0) + "ms";
      let settled = false, loading = false, fresh = false, isUnloading = false;
      window.addEventListener("beforeunload", () => { isUnloading = true; });
      window.addEventListener("pagehide", () => { isUnloading = true; });
      const settle = (extra) => {
        if (settled) return;
        settled = true;
        resolve(Object.assign({}, auth, extra));
      };
      const startLoad = () => {
        if (loading || fresh || isUnloading) return;
        loading = true;
        load()
          .then(() => {
            fresh = true;
            console.info(`HapagPamana: fresh data loaded (${ms()})`);
            if (settled) notifyRefresh(); else settle({});
          })
          .catch((e) => {
            if (isUnloading) return;
            // Log the real cause so it's diagnosable from the console.
            console.warn("HapagPamana: background refresh skipped —", e);
            if (settled) {
              // Page is already rendered from the IndexedDB cache; keep showing
              // the cached copy quietly without interrupting the user.
              return;
            }
            // Honest empty state — never substitute fake sample content.
            DB = { categories: [], dishes: [], packages: [], setups: [], allergens: structuredClone(DEFAULT_ALLERGENS), settings: structuredClone(SEED.settings) };
            const denied = e && (e.code === "permission-denied" || /permission|insufficient/i.test(e.message || ""));
            toast(denied
              ? "Database access denied — check your Firestore security rules."
              : "Couldn't reach the database. Check your connection and reload.", "danger");
            settle({ fallback: true });
          });
      };

      cacheRead.then((hit) => {
        if (!hit || !hit.db) { startLoad(); return; }
        if (fresh) return; // network already won — its copy is newer
        DB = hit.db;
        cacheAt = hit.at || 0;
        console.info(`HapagPamana: painted from cache (${ms()}, age ${Math.round((Date.now() - cacheAt) / 1000)}s)`);
        settle({ cached: true });
        if (PAGE_IMG_KIND && !hydratedImages[PAGE_IMG_KIND]) {
          // Metadata was cached, but this page's image map hasn't been cached yet.
          getWithRetry(() => FB.db.collection(COLL[PAGE_IMG_KIND]).get())
            .then((snap) => {
              const map = {};
              snap.docs.forEach((d) => {
                const data = d.data();
                if (data && data.image) map[d.id] = data.image;
              });
              applyImgMap(DB[PAGE_IMG_KIND], map);
              hydratedImages[PAGE_IMG_KIND] = true;
              writeCache(PAGE_IMG_KIND);
              notifyRefresh();
            })
            .catch((e) => console.warn(`HapagPamana: couldn't hydrate ${PAGE_IMG_KIND} images —`, e));
        }
        if (Date.now() - cacheAt > CACHE_TTL) startLoad();
      });
      // Safety guard if IndexedDB is blocked by another tab's upgrade/transaction;
      // generous enough (2500ms vs old 350ms) so normal disk reads never trigger
      // a redundant 43MB network download.
      setTimeout(() => { if (!settled) startLoad(); }, 2500);
    });
  });

  /* ── Attach the store to the shared HP global ────────────────────────── */
  HP.ready = ready;
  HP.onRefresh = onRefresh;
  HP.uid = uid;
  HP.money = money;
  HP.TYPES = TYPES;
  HP.categoriesForType = categoriesForType;
  HP.iconForCat = iconForCat;
  HP.categoryPrice = categoryPrice;
  HP.dishPrice = dishPrice;
  HP.hasPriceOverride = hasPriceOverride;
  HP.DEFAULT_CAT_PRICES = DEFAULT_CAT_PRICES;
  Object.defineProperty(HP, "ALLERGENS", { get: currentAllergens, configurable: true });
  HP.DEFAULT_ALLERGENS = DEFAULT_ALLERGENS;
  HP.DEFAULT_ABOUT = DEFAULT_ABOUT;
  HP.parseAllergens = parseAllergens;
  HP.aggregateAllergens = aggregateAllergens;
  HP.hasAnyAllergenData = hasAnyAllergenData;
  HP.allergenHeat = allergenHeat;
  HP.compressImage = compressImage;
  HP.exportData = exportData;
  HP.clearCache = clearCache;
  HP.store = {
    get DB() { return DB; },
    load,
    persist,
    remove,          // hard delete — Trash's "delete forever" only
    softRemove,
    restore,
    updateFields,
    clearFields,
    importContent,
    persistSettings,
    persistAllergens,
    persistAbout,
    resetData,
  };
})();
