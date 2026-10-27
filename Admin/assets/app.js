// HapagPamana · Admin portal — Firebase Auth + Firestore role gate.
// On sign-in we authenticate, then read users/{uid}.role and hand off to that
// role's dashboard (window.ROLE_HOMES): content moderators to the Content
// Moderator, order managers to Orders, master chefs to the kitchen, finance
// officers to the costing board. Unknown/inactive roles are bounced.
(function () {
  "use strict";

  const form = document.getElementById("loginForm");
  const idInput = document.getElementById("identifier");
  const pwInput = document.getElementById("password");
  const reveal = document.getElementById("reveal");
  const errorEl = document.getElementById("formError");
  const submitBtn = document.getElementById("submitBtn");
  const forgot = document.getElementById("forgot");
  const capsHint = document.getElementById("capsHint");
  const remember = document.getElementById("remember");
  const themeToggle = document.getElementById("themeToggle");
  const label = submitBtn.querySelector(".label");
  const originalLabel = label.textContent;

  // ── Theme toggle ────────────────────────────────────────────────────────
  const THEME_KEY = "hp_admin_theme";
  function getActiveTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (document.body) document.body.setAttribute("data-theme", theme);
    if (themeToggle) {
      const isDark = theme === "dark";
      themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
      themeToggle.setAttribute("title", isDark ? "Switch to light mode" : "Switch to dark mode");
    }
  }
  if (themeToggle) {
    applyTheme(getActiveTheme());
    themeToggle.addEventListener("click", () => {
      const next = getActiveTheme() === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      applyTheme(next);
    });
  }

  // Fallback when ROLE_HOMES is missing (older firebase-config.js).
  const MOD_PAGE = "Content%20Moderator/html/index.html";

  // Per-role welcome curtain greeting (falls back to a generic one).
  const ROLE_GREETINGS = {
    owner: "Welcome, Owner",
    admin: "Welcome, Admin",
    master_chef: "Welcome, Master Chef",
    content_moderator: "Welcome, Moderator",
    marketing_admin: "Welcome, Marketing Admin",
    order_manager: "Welcome, Order Manager",
    production_manager: "Welcome, Production Manager",
    finance: "Welcome, Finance",
    purchasing_staff: "Welcome, Purchasing Staff",
    stock_clerk: "Welcome, Stock Clerk",
    team_leader: "Welcome, Team Leader",
    logistics: "Welcome, Logistics",
    catering_equipment: "Welcome, Catering Equipment",
    layout_designer: "Welcome, Layout Designer",
  };

  // ── Firebase init ─────────────────────────────────────────────────────────
  let auth = null, db = null;
  function firebaseReady() {
    return (
      typeof firebase !== "undefined" &&
      window.firebaseConfig &&
      !String(window.firebaseConfig.apiKey || "").startsWith("PASTE")
    );
  }
  if (firebaseReady()) {
    if (!firebase.apps.length) firebase.initializeApp(window.firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
  }

  // ── Password show / hide ────────────────────────────────────────────────
  reveal.addEventListener("click", () => {
    const show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    reveal.setAttribute("aria-pressed", String(show));
    reveal.setAttribute("aria-label", show ? "Hide password" : "Show password");
    pwInput.focus({ preventScroll: true });
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    // Rise the error line in and shake the card; restart both on a repeat
    // failure (the reflow read re-arms the animation).
    [errorEl, document.querySelector(".form-card")].forEach((el) => {
      if (!el) return;
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
    });
  }
  function clearError() {
    if (!errorEl.hidden) { errorEl.hidden = true; errorEl.textContent = ""; }
  }
  [idInput, pwInput].forEach((el) => el.addEventListener("input", clearError));

  function setLoading(on) {
    submitBtn.disabled = on;
    submitBtn.classList.toggle("loading", on);
    label.textContent = on ? "SIGNING IN…" : originalLabel;
  }

  function authErrorMessage(err) {
    switch (err && err.code) {
      case "auth/invalid-email": return "That email address looks invalid.";
      case "auth/user-disabled": return "This account has been disabled.";
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential": return "Incorrect email or password.";
      case "auth/too-many-requests": return "Too many attempts — please try again later.";
      case "auth/network-request-failed": return "Network error. Check your connection.";
      default: return (err && err.message) || "Sign-in failed. Please try again.";
    }
  }

  // ── Forgot password → send reset email ──────────────────────────────────────
  forgot.addEventListener("click", async (e) => {
    e.preventDefault();
    clearError();
    if (!auth) return showError("Sign-in isn’t configured yet.");
    const email = idInput.value.trim();
    if (!email) { showError("Enter your email above, then tap “Forgot password?”."); idInput.focus(); return; }
    try {
      await auth.sendPasswordResetEmail(email);
      showError(`Password reset link sent to ${email}.`);
    } catch (err) { showError(authErrorMessage(err)); }
  });

  // ── Caps Lock warning while editing the password ─────────────────────────
  function capsCheck(e) {
    if (typeof e.getModifierState !== "function") return;
    capsHint.hidden = !e.getModifierState("CapsLock");
  }
  pwInput.addEventListener("keydown", capsCheck);
  pwInput.addEventListener("keyup", capsCheck);
  pwInput.addEventListener("blur", () => { capsHint.hidden = true; });

  // ── Submit → authenticate, then verify role in Firestore ─────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    const email = idInput.value.trim();
    const pw = pwInput.value;
    if (!email) { showError("Enter your admin ID or email."); idInput.focus(); return; }
    if (!pw) { showError("Enter your password."); pwInput.focus(); return; }

    if (!auth || !db) {
      showError("Sign-in isn’t configured yet. Add your config to firebase-config.js.");
      return;
    }

    setLoading(true);
    try {
      // "Remember device" controls how long the session survives.
      await auth.setPersistence(
        remember && remember.checked
          ? firebase.auth.Auth.Persistence.LOCAL
          : firebase.auth.Auth.Persistence.SESSION
      );

      const cred = await auth.signInWithEmailAndPassword(email, pw);
      const snap = await db.collection(window.USERS_COLLECTION).doc(cred.user.uid).get();

      const data = snap.exists ? snap.data() : null;
      // Role-based access: the role record decides which dashboard opens.
      const homes = window.ROLE_HOMES || { content_moderator: MOD_PAGE, admin: MOD_PAGE };
      const dest = data && data.active !== false ? homes[data.role] : null;

      if (dest) {
        // Play the welcome curtain, then hand off to the dashboard. The veil
        // masks the page load; reduced-motion users skip straight through.
        label.textContent = "WELCOME…";
        const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const veil = document.getElementById("welcomeVeil");
        const welcomeText = document.getElementById("welcomeText");
        if (welcomeText) welcomeText.textContent = ROLE_GREETINGS[data.role] || "Welcome back";
        if (veil) veil.setAttribute("aria-hidden", "false");
        document.body.classList.add("is-success");
        // Pre-mark the session as verified so guard.js on the dashboard uses
        // only the slim progress bar instead of a full-screen gate — the
        // welcome veil already confirmed access, no second curtain needed.
        try { sessionStorage.setItem("hp_admin_verified", "1"); } catch (_) {}
        setTimeout(() => { location.href = dest; }, reduce ? 0 : 1500);
      } else {
        // Authenticated, but no staff role — drop the session and explain.
        await auth.signOut();
        setLoading(false);
        showError("This account doesn’t have staff access to any dashboard.");
      }
    } catch (err) {
      setLoading(false);
      showError(authErrorMessage(err));
    }
  });
})();
