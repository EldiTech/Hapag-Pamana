importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDokGGoVNFZIJujMFC52yzkOTnG_sxeT4E",
  authDomain: "hapagpamana-39687.firebaseapp.com",
  projectId: "hapagpamana-39687",
  storageBucket: "hapagpamana-39687.firebasestorage.app",
  messagingSenderId: "369246306524",
  appId: "1:369246306524:web:f3a4b31aa39e8370b97419",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || "New booking received", {
    body: data.body || "A new booking is waiting in the pending queue.",
    icon: "assets/HapagPamana.png",
    badge: "assets/HapagPamana.png",
    tag: data.eventId || `booking-${data.bookingId || "new"}`,
    renotify: true,
    data,
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const bookingId = event.notification.data?.bookingId || "";
  const target = new URL("Orders/html/index.html", self.registration.scope);
  if (bookingId) target.searchParams.set("order", bookingId);

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.navigate(target.href);
      return existing.focus();
    }
    return clients.openWindow(target.href);
  })());
});
