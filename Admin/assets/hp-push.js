/* Browser push registration for the Orders desk. */
(function () {
  "use strict";

  const HP = window.HP;
  const VAPID_KEY = String(window.HP_WEB_PUSH_VAPID_KEY || "").trim();
  let messaging = null;
  let tokenRef = null;
  let button = null;

  HP.ready.then(init);

  async function init() {
    HP.shell.init();
    button = document.createElement("button");
    button.className = "theme-toggle push-toggle";
    button.id = "pushToggle";
    button.type = "button";
    button.setAttribute("aria-label", "Enable booking notifications");
    button.innerHTML = `<span class="ic">${HP.icon("mail")}</span>`;
    document.getElementById("themeToggle")?.before(button);

    if (!supported()) return setState("unsupported", "Push unavailable in this browser");
    if (!VAPID_KEY) return setState("setup", "Add the Web Push VAPID key in firebase-config.js");
    button.addEventListener("click", enable);

    if (Notification.permission === "granted") {
      await registerToken();
    } else if (Notification.permission === "denied") {
      setState("denied", "Notifications blocked in browser settings");
    } else {
      setState("off", "Enable new-booking notifications");
    }
  }

  function supported() {
    return window.isSecureContext && "Notification" in window &&
      "serviceWorker" in navigator && firebase.messaging;
  }

  async function enable() {
    if (Notification.permission === "denied") {
      HP.toast("Notifications are blocked. Allow them in this site's browser settings.", "warn");
      return;
    }
    button.disabled = true;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied", "Notifications not allowed");
        return;
      }
      await registerToken();
      HP.toast("Browser booking notifications enabled.", "ok");
    } catch (error) {
      console.warn("HapagPamana: push registration failed -", error);
      setState("error", "Couldn't enable notifications");
      HP.toast("Couldn't enable browser notifications.", "danger");
    } finally {
      button.disabled = false;
    }
  }

  async function registerToken() {
    await HP.userReady;
    const authUser = HP.FB.auth.currentUser;
    if (!authUser) return;

    const workerUrl = new URL("../../firebase-messaging-sw.js", location.href);
    const registration = await navigator.serviceWorker.register(workerUrl, {
      scope: new URL("./", workerUrl).pathname,
    });
    messaging = firebase.messaging();
    const token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error("FCM returned no browser token");

    const id = `${authUser.uid}_${await tokenId(token)}`;
    tokenRef = HP.FB.db.collection("adminNotificationTokens").doc(id);
    const existing = await tokenRef.get();
    const write = {
      uid: authUser.uid,
      token,
      role: HP.user.roleKey,
      platform: "web",
      active: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (existing.exists) {
      await tokenRef.update({
        active: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      await tokenRef.set({
        ...write,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }

    messaging.onMessage((payload) => {
      // The live bookings listener owns visible-page alerts. This handler
      // exists to consume foreground FCM without showing a duplicate toast.
      console.debug("HapagPamana: foreground push", payload.data?.eventId || "");
    });
    setState("on", "New-booking notifications enabled");
  }

  async function deactivate() {
    if (!tokenRef) return;
    try {
      await tokenRef.update({
        active: false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.warn("HapagPamana: couldn't deactivate push token -", error);
    }
  }

  async function tokenId(token) {
    const bytes = new TextEncoder().encode(token);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function setState(state, title) {
    if (!button) return;
    button.dataset.state = state;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.disabled = state === "unsupported" || state === "setup";
  }

  window.HPAdminPush = { deactivate };
})();
