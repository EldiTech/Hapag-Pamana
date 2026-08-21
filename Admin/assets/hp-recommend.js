/* HapagPamana · recommendations — the crowd signal behind Gabay's picks.

   THE PROBLEM THIS SOLVES. The app recommends food to members. Doing that well
   means knowing what tends to be ordered together across the whole customer
   base — "people who booked the lechon also booked the pancit". But a customer
   may only read their OWN bookings (see firestore.rules on `bookings`), so the
   app can never work that out for itself. Only a desk that can read every order
   can, and this dashboard is one.

   So the Orders dashboard keeps the tally. When an order manager marks an order
   COMPLETED, this module reads the dishes and package on it and records two
   things:

     co_occurrences/{pairKey}      how often each PAIR of items has been
                                   ordered together   → personalised picks
     products/{id}.orderCount      how often each item has been ordered at all
     packages/{id}.orderCount      → "most loved" popularity

   The staff browser is, in effect, the backend. That is a real trade: the tally
   only advances when someone completes an order through this dashboard, so it
   is eventually-consistent on human behaviour rather than on a database
   trigger. A Cloud Function would be strictly better and needs a billing plan
   this project isn't on. What is NOT traded away is safety — no customer can
   write either collection (see firestore.rules), so the signal can't be gamed
   by the people it's shown to.

   WHY THE TALLY CARRIES NO CUSTOMER DATA. A co-occurrence document holds two
   item ids and a number. It never records who ordered them. That is what lets
   the app read the table without any customer learning anything about another.

   COMPLETION IS THE ONLY EVENT COUNTED. A pending order is a request nobody has
   accepted; a confirmed one may still be declined. Counting either would let an
   order that never happened shape what every member sees.

   Loads after hp-core.js. Exposed on window.HPRec. Best-effort throughout: a
   failed tally write must never block or undo the status change that triggered
   it — the order being completed is the fact that matters, the statistic is a
   convenience. */
window.HPRec = (function () {
  "use strict";

  /* Booking fields that are never a dish name. The catering wizard writes one
     field per package course under the moderator's own inclusion key (an open
     set — see PackageCourse.key in lib/data/catering.dart), so the sweep below
     has to offer every remaining string to the menu index and let it fail.
     Excluding too much only costs a missed pair; excluding too little would
     file a client's address or occasion as though it were food. */
  const NON_MENU_FIELDS = new Set([
    "uid", "status", "bookingType", "createdAt", "statusUpdatedAt", "updatedAt",
    "updatedBy", "updatedByName", "deleted", "deletedAt", "deletedBy",
    "history", "fulfilment", "layout", "name", "email", "phone",
    "contactNumber", "address", "venue", "venueAddress", "kindOfFunction",
    "functionDate", "functionTime", "pax", "guests", "notes", "message",
    "remarks", "specialRequests", "draftStep", "draftPackageId", "packageId",
    "packageName", "package", "paymentStatus", "paymentRef", "paymentMethod",
    "checkoutUrl", "checkoutSessionId", "paymentSource", "paymentTakenBy",
    "paymentTakenByName",
    // The chosen table/venue set-up — a photo's title from the Setups gallery,
    // never food. Left in, a look sharing a name with a dish would file that
    // dish as ordered by every client who picked the look.
    "setupStyle",
  ]);

  /* Strips a booking line to the bare item name, so it can be matched against
     the menu. The wizards append quantities and headcounts to what the client
     chose ("Lechon Belly × 2", "Fish Fillet (5 pax)") — those aren't part of a
     dish's identity.

       "Lechon Belly × 2"     → "lechon belly"
       "Fish Fillet (5 pax)"  → "fish fillet"  */
  function normaliseName(raw) {
    return String(raw || "")
      .replace(/\s*[×x]\s*\d+\s*$/i, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /* A name → id lookup over one collection.

     Bookings record what the client CHOSE, by name, never by id — the wizards
     write the moderator's own words so the Orders board, the kitchen and the
     member all read the same line. The tally needs ids, so the names have to be
     resolved back. A name two items share resolves to NEITHER: guessing between
     them would file evidence against the wrong dish, and a wrong count is worse
     than a missing one. */
  function buildIndex(docs) {
    const byName = new Map();
    docs.forEach((doc) => {
      const key = normaliseName((doc.data() || {}).name);
      if (!key) return;
      byName.set(key, byName.has(key) ? null : doc.id);
    });
    return {
      resolve(name) {
        const hit = byName.get(normaliseName(name));
        return hit === undefined ? null : hit;
      },
    };
  }

  /* Loads both menu indexes. One read of each collection per completion —
     small, and only on a click a human made. */
  async function loadIndexes(db) {
    const [products, packages] = await Promise.all([
      db.collection("products").get(),
      db.collection("packages").get(),
    ]);
    return {
      products: buildIndex(products.docs),
      packages: buildIndex(packages.docs),
      productIds: new Set(products.docs.map((d) => d.id)),
      packageIds: new Set(packages.docs.map((d) => d.id)),
    };
  }

  /* The item ids one completed order is evidence for — its "basket".

     Draws from every place a booking names food: the food-pack wizard's `menu`
     lines, the catering wizard's `menuAddOns`, the per-course fields it writes
     under the package's inclusion keys, and the package the order was booked
     against. Anything that doesn't resolve to a live menu item is dropped — a
     dish the moderator has deleted can't be recommended, so counting it would
     only dilute the pairs that can. */
  function basketFor(booking, idx) {
    const ids = new Set();
    const addDish = (line) => {
      const id = idx.products.resolve(line);
      if (id) ids.add(id);
    };

    ["menu", "menuAddOns"].forEach((key) => {
      const raw = booking[key];
      if (typeof raw !== "string") return;
      raw.split("\n").forEach(addDish);
    });

    Object.keys(booking).forEach((key) => {
      if (NON_MENU_FIELDS.has(key)) return;
      const value = booking[key];
      if (typeof value === "string" && value.trim()) addDish(value);
    });

    const directId = booking.packageId || booking.draftPackageId;
    if (directId && idx.packageIds.has(directId)) ids.add(directId);
    const byName = idx.packages.resolve(booking.packageName || booking.package);
    if (byName) ids.add(byName);

    return Array.from(ids);
  }

  /* The key for the unordered pair {a, b} — sorted, so (x,y) and (y,x) are one
     document and the tally can never split itself across two. Item ids are
     Firestore document ids, which contain no "/", so the join needs no
     escaping. */
  function pairKey(a, b) {
    return [a, b].sort().join("__");
  }

  /* Every unordered pair in the basket, each once. */
  function pairsIn(items) {
    const unique = Array.from(new Set(items)).sort();
    const out = [];
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) out.push([unique[i], unique[j]]);
    }
    return out;
  }

  /* Records one completed order against both tallies.

     `increment` rather than read-modify-write throughout: two managers
     completing orders at the same instant must both land, and a count is a
     tally, not a value anyone owns. Batched in chunks because a large order's
     basket produces O(n²) pairs and a Firestore batch holds 500 writes.

     Returns a small summary for the caller to log; never throws. */
  async function recordCompletion(db, booking) {
    try {
      const idx = await loadIndexes(db);
      const basket = basketFor(booking, idx);
      if (!basket.length) return { items: 0, pairs: 0 };

      const inc = (n) => firebase.firestore.FieldValue.increment(n);
      const stamp = firebase.firestore.FieldValue.serverTimestamp();

      /* Popularity first — one write per item, and useful on its own even if
         the pair batch below fails half way. */
      const popularity = db.batch();
      basket.forEach((id) => {
        const ref = idx.productIds.has(id)
          ? db.collection("products").doc(id)
          : db.collection("packages").doc(id);
        popularity.set(ref, { orderCount: inc(1), orderCountAt: stamp }, { merge: true });
      });
      await popularity.commit();

      /* Then the pairs. */
      const pairs = pairsIn(basket);
      for (let i = 0; i < pairs.length; i += 400) {
        const batch = db.batch();
        pairs.slice(i, i + 400).forEach(([a, b]) => {
          batch.set(
            db.collection("co_occurrences").doc(pairKey(a, b)),
            { count: inc(1), items: [a, b].sort(), updatedAt: stamp },
            { merge: true }
          );
        });
        await batch.commit();
      }
      return { items: basket.length, pairs: pairs.length };
    } catch (e) {
      /* Deliberately swallowed. The order IS completed — that write already
         succeeded in its own transaction — and a broken statistic must not be
         reported to the manager as a failed status change. Logged so it's
         diagnosable. */
      console.warn("HapagPamana: couldn't record recommendation signal —", e);
      return null;
    }
  }

  return {
    recordCompletion,
    // Exposed for eyeballing in the console; the resolution rules are the part
    // most likely to need checking against a real booking.
    _internals: { normaliseName, basketFor, pairsIn, pairKey, loadIndexes },
  };
})();
