/* HapagPamana · Owner — Overview.
   The owner oversees every desk, so this page is a hub: one card per staff
   dashboard, linking straight into it. Each dashboard's own guard re-checks
   `owner` against its roles list on arrival (owner is included everywhere,
   see firebase-config.js) — same cross-dashboard reach `admin` already has,
   just landing here first instead of on the Content Moderator. */
(function () {
  "use strict";
  const HP = window.HP;

  HP.shell.init();
  HP.shell.setPage({ title: "Overview", sub: "Every desk, in one place.", search: false, action: null });

  const statsEl = document.getElementById("ownerStats");
  const chartEl = document.getElementById("ownerSalesChart");
  const statusEl = document.getElementById("ownerStatusList");
  const recentEl = document.getElementById("ownerRecent");

  const db = HP.ONLINE ? firebase.firestore() : null;
  let bookings = [];
  let lowStockCount = 0;

  HP.ready.then(render);
  HP.ready.then(boot);

  function render() {
    if (HP.user.greet) HP.shell.setSub(`Welcome back, ${HP.user.greet}. Every desk, in one place.`);
  }

  /* ── Live dashboard: today's sales, order counts, a 7-day sales trend,
     status breakdown, and the newest few orders. Reads the same `bookings`
     and `pantry` collections the Orders and Stock Clerk desks own — the
     owner just gets a rollup, no writes happen from here. */
  function boot() {
    if (!HP.ONLINE) {
      statsEl.innerHTML = "";
      chartEl.innerHTML = "";
      statusEl.innerHTML = "";
      recentEl.innerHTML = `<p class="modal-text">Connect Firebase to see live figures here.</p>`;
      return;
    }
    db.collection("bookings").orderBy("createdAt", "desc").limit(200)
      .onSnapshot((snap) => {
        bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderDashboard();
      }, (e) => dashError("bookings", e));
    db.collection("pantry").onSnapshot((snap) => {
      lowStockCount = snap.docs.filter((d) => {
        const it = d.data() || {};
        const par = Number(it.par);
        const qty = Number(it.qty);
        return Number.isFinite(par) && par > 0 && Number.isFinite(qty) && qty <= par;
      }).length;
      renderDashboard();
    }, (e) => dashError("pantry", e));
  }

  // Surfaced on-screen (not just the console) — a silent blank panel looks
  // like a layout bug when it's actually a denied read, and the fix
  // (publish Firestore rules) is only discoverable if the message says so.
  function dashError(what, e) {
    console.error(`HapagPamana: couldn't load ${what} for the overview —`, e);
    const denied = e && (e.code === "permission-denied" ||
      /permission|insufficient/i.test(e.message || ""));
    const msg = denied
      ? "Access denied — publish the updated Firestore rules, then reload."
      : "Couldn't reach the database. Check your connection and reload.";
    statsEl.innerHTML = "";
    chartEl.innerHTML = `<p class="modal-text">${HP.esc(msg)}</p>`;
    statusEl.innerHTML = "";
    recentEl.innerHTML = "";
  }

  const alive = () => bookings.filter((o) => !o.deleted);
  const statusOf = (o) => (["pending", "confirmed", "completed", "declined"].includes(o.status) ? o.status : "pending");
  const ts = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : 0);
  const clientName = (o) => String(o.clientName || "").trim() || "Unnamed client";
  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return "₱0";
    return "₱" + Math.round(n).toLocaleString("en-PH");
  };
  // What an order settled for, if it has: the recorded downpayment/total.
  const orderValue = (o) => Number(o.paymentPaid) || Number(o.paymentTotal) || 0;

  function renderDashboard() {
    const rows = alive();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const todaySales = rows
      .filter((o) => ts(o.createdAt) >= todayMs)
      .reduce((sum, o) => sum + orderValue(o), 0);
    const pending = rows.filter((o) => statusOf(o) === "pending").length;
    const confirmed = rows.filter((o) => statusOf(o) === "confirmed").length;
    const completed = rows.filter((o) => statusOf(o) === "completed").length;
    const declined = rows.filter((o) => statusOf(o) === "declined").length;

    renderStats(todaySales, rows.length, pending, lowStockCount);
    renderChart(rows);
    renderStatus({ completed, confirmed, pending, declined });
    renderRecent(rows);
  }

  function renderStats(todaySales, orderCount, pending, lowStock) {
    const stat = (ic, num, label) => `
      <div class="stat">
        <div class="stat-top"><span class="stat-ic"><span class="ic">${HP.icon(ic)}</span></span></div>
        <div class="stat-num">${num}</div>
        <div class="stat-label">${label}</div>
      </div>`;
    statsEl.innerHTML =
      stat("peso", money(todaySales), "Today's sales") +
      stat("ledger", orderCount, "Orders") +
      stat("clock", pending, "Pending") +
      stat("box", lowStock, "Low stock items");
    HP.hydrateIcons(statsEl);
  }

  // Bars for the last 7 days, ordered oldest to newest, sized against the
  // busiest day in the window so the tallest bar always fills the row.
  function renderChart(rows) {
    const days = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) days.push(today.getTime() - i * 864e5);

    const totals = days.map((d) =>
      rows.filter((o) => { const t = ts(o.createdAt); return t >= d && t < d + 864e5; }).length);
    const max = Math.max(1, ...totals);

    chartEl.innerHTML = days.map((d, i) => {
      const pct = Math.round((totals[i] / max) * 100);
      const label = new Date(d).toLocaleDateString("en-PH", { weekday: "short" });
      return `<div class="sales-bar-col">
        <div class="sales-bar-track"><div class="sales-bar" style="height:${Math.max(pct, totals[i] ? 6 : 2)}%"></div></div>
        <span class="sales-bar-val">${totals[i]}</span>
        <span class="sales-bar-label">${label}</span>
      </div>`;
    }).join("");
  }

  function renderStatus(counts) {
    const items = [
      ["completed", "Completed", "badge-gold"],
      ["confirmed", "Confirmed", "badge-ok"],
      ["pending", "Pending", "badge-warn"],
      ["declined", "Declined", "badge-danger"],
    ];
    statusEl.innerHTML = items.map(([k, label, badge]) => `
      <div class="status-row">
        <span class="badge ${badge}"><span class="dot"></span>${label}</span>
        <strong>${counts[k]}</strong>
      </div>`).join("");
  }

  function renderRecent(rows) {
    const list = rows.slice(0, 5);
    if (!list.length) {
      recentEl.innerHTML = `<p class="modal-text">No orders yet.</p>`;
      return;
    }
    const STATUS_BADGE = {
      pending: "badge-warn", confirmed: "badge-ok", completed: "badge-gold", declined: "badge-danger",
    };
    const STATUS_LABEL = {
      pending: "Pending", confirmed: "Confirmed", completed: "Completed", declined: "Declined",
    };
    recentEl.innerHTML = list.map((o) => {
      const s = statusOf(o);
      const when = ts(o.createdAt)
        ? new Date(ts(o.createdAt)).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
        : "—";
      return `<div class="owner-recent-row">
        <div class="owner-recent-main">
          <strong>${HP.esc(clientName(o))}</strong>
          <small>${HP.esc(String(o.kindOfFunction || "").trim() || "Booking")}</small>
        </div>
        <span class="owner-recent-amt">${orderValue(o) ? money(orderValue(o)) : "—"}</span>
        <span class="badge ${STATUS_BADGE[s]}"><span class="dot"></span>${STATUS_LABEL[s]}</span>
        <span class="owner-recent-time">${when}</span>
      </div>`;
    }).join("");
    HP.hydrateIcons(recentEl);
  }
})();
