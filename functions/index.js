/*
 * DISABLED FOR THE SPARK-ONLY DEPLOYMENT.
 *
 * Firebase Cloud Functions requires Blaze. firebase.json deliberately does
 * not declare this directory. Keep this prototype undeployed unless the
 * project policy changes.
 */
const { setGlobalOptions } = require("firebase-functions/v2");
const {
  onDocumentCreated,
  onDocumentUpdated,
} = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
setGlobalOptions({ region: "asia-southeast1", maxInstances: 10 });

const db = getFirestore();
const messaging = getMessaging();

const ADMIN_ROLES = new Set([
  "marketing_admin",
  "order_manager",
  "admin",
  "owner",
]);

const STATUS_COPY = {
  confirmed: {
    title: "Booking Confirmed",
    body: "Great news - your booking is confirmed. Tap to view its progress.",
  },
  declined: {
    title: "Booking Declined",
    body: "Your booking could not be accommodated. Tap to review the details.",
  },
  completed: {
    title: "Booking Completed",
    body: "Your event is complete. Salamat for choosing Hapag Pamana!",
  },
};

const PAYMENT_COPY = {
  title: "Payment Received",
  body: "Your booking payment has been recorded. Tap to view the booking.",
};

exports.onBookingCreated = onDocumentCreated(
  { document: "bookings/{bookingId}", retry: true },
  async (event) => {
    const booking = event.data && event.data.data();
    if (!booking || booking.deleted === true || booking.status !== "pending") return;
    if (typeof booking.uid !== "string" || !booking.uid) return;

    const bookingId = event.params.bookingId;
    const eventId = event.id;
    const tasks = [
      runOnce(eventId, "booking-received-history", () =>
        writeCustomerNotification({
          uid: booking.uid,
          bookingId,
          eventId,
          status: "pending",
          title: "Booking Received",
          body: "Your catering inquiry was received. We will confirm it shortly.",
        }),
      ),
      runOnce(eventId, "admin-new-booking-push", () =>
        sendAdminPush({ bookingId, eventId }),
      ),
    ];
    await settleAll(tasks);
  },
);

exports.onBookingUpdated = onDocumentUpdated(
  { document: "bookings/{bookingId}", retry: true },
  async (event) => {
    if (!event.data) return;
    const before = event.data.before.data();
    const after = event.data.after.data();
    if (!after || after.deleted === true) return;
    if (typeof after.uid !== "string" || !after.uid) return;

    const bookingId = event.params.bookingId;
    const eventId = event.id;
    const tasks = [];

    if (before.status !== after.status && STATUS_COPY[after.status]) {
      const copy = STATUS_COPY[after.status];
      tasks.push(
        runOnce(eventId, `customer-status-${after.status}`, () =>
          notifyCustomer({
            uid: after.uid,
            bookingId,
            eventId,
            status: after.status,
            type: "booking_status",
            title: copy.title,
            body: copy.body,
          }),
        ),
      );
    }

    if (before.paymentStatus !== "paid" && after.paymentStatus === "paid") {
      tasks.push(
        runOnce(eventId, "customer-payment-paid", () =>
          notifyCustomer({
            uid: after.uid,
            bookingId,
            eventId,
            status: "paid",
            type: "payment_received",
            title: PAYMENT_COPY.title,
            body: PAYMENT_COPY.body,
          }),
        ),
      );
    }

    await settleAll(tasks);
  },
);

async function notifyCustomer(payload) {
  if (!(await customerWantsOrderUpdates(payload.uid))) {
    return { skipped: "preference-disabled" };
  }

  await writeCustomerNotification(payload);
  const tokenSnap = await db
    .collection("customers")
    .doc(payload.uid)
    .collection("pushTokens")
    .where("active", "==", true)
    .get();

  return sendToTokenDocs(tokenSnap.docs, {
    notification: { title: payload.title, body: payload.body },
    data: notificationData(payload),
    android: {
      priority: "high",
      notification: { clickAction: "FLUTTER_NOTIFICATION_CLICK" },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default" } },
    },
  });
}

async function writeCustomerNotification(payload) {
  if (!(await customerWantsOrderUpdates(payload.uid))) {
    return { skipped: "preference-disabled" };
  }
  const id = safeId(`${payload.eventId}-${payload.type || "order_update"}`);
  await db
    .collection("notifications")
    .doc(payload.uid)
    .collection("items")
    .doc(id)
    .set({
      title: payload.title,
      body: payload.body,
      type: "order_update",
      isRead: false,
      bookingId: payload.bookingId,
      status: payload.status,
      eventId: payload.eventId,
      createdAt: FieldValue.serverTimestamp(),
    });
  return { history: 1 };
}

async function customerWantsOrderUpdates(uid) {
  const snap = await db.collection("customers").doc(uid).get();
  if (!snap.exists) return false;
  const preferences = snap.data().preferences || {};
  return preferences.orderUpdates !== false;
}

async function sendAdminPush({ bookingId, eventId }) {
  const tokenSnap = await db
    .collection("adminNotificationTokens")
    .where("active", "==", true)
    .get();
  if (tokenSnap.empty) return { tokens: 0, success: 0, failure: 0 };

  const userIds = [...new Set(tokenSnap.docs.map((doc) => doc.data().uid).filter(Boolean))];
  const userRefs = userIds.map((uid) => db.collection("users").doc(uid));
  const userSnaps = userRefs.length ? await db.getAll(...userRefs) : [];
  const allowed = new Set(
    userSnaps
      .filter((snap) => {
        const user = snap.data() || {};
        return snap.exists && user.active !== false && ADMIN_ROLES.has(user.role);
      })
      .map((snap) => snap.id),
  );
  const docs = tokenSnap.docs.filter((doc) => allowed.has(doc.data().uid));

  return sendToTokenDocs(docs, {
    data: notificationData({
      type: "new_booking",
      bookingId,
      status: "pending",
      eventId,
      title: "New booking received",
      body: "A new booking is waiting in the pending queue.",
    }),
    webpush: { headers: { Urgency: "high", TTL: "86400" } },
  });
}

function notificationData(payload) {
  return {
    type: String(payload.type || "order_update"),
    bookingId: String(payload.bookingId),
    status: String(payload.status || ""),
    route: "booking_tracking",
    eventId: String(payload.eventId),
    title: String(payload.title || "Booking update"),
    body: String(payload.body || "Your booking has been updated."),
  };
}

async function sendToTokenDocs(docs, message) {
  const byToken = new Map();
  docs.forEach((doc) => {
    const token = doc.data().token;
    if (typeof token === "string" && token.length > 0) byToken.set(token, doc);
  });
  const validDocs = [...byToken.values()];
  if (!validDocs.length) return { tokens: 0, success: 0, failure: 0 };

  let success = 0;
  let failure = 0;
  const staleRefs = [];

  for (let offset = 0; offset < validDocs.length; offset += 500) {
    const chunk = validDocs.slice(offset, offset + 500);
    const response = await messaging.sendEachForMulticast({
      ...message,
      tokens: chunk.map((doc) => doc.data().token),
    });
    success += response.successCount;
    failure += response.failureCount;
    response.responses.forEach((item, index) => {
      if (!item.success && isInvalidTokenError(item.error)) {
        staleRefs.push(chunk[index].ref);
      }
    });
  }

  if (staleRefs.length) {
    const batch = db.batch();
    staleRefs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return { tokens: validDocs.length, success, failure, stale: staleRefs.length };
}

function isInvalidTokenError(error) {
  return error && [
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ].includes(error.code);
}

async function runOnce(eventId, kind, task) {
  const ref = db.collection("notificationDeliveries").doc(safeId(`${eventId}-${kind}`));
  const now = Timestamp.now();

  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().status === "delivered") return false;
    if (snap.exists && snap.data().status === "processing") {
      const updatedAt = snap.data().updatedAt;
      const recent = updatedAt && now.toMillis() - updatedAt.toMillis() < 120000;
      if (recent) throw new Error("Notification delivery already processing");
    }
    tx.set(ref, {
      eventId,
      kind,
      status: "processing",
      attempts: FieldValue.increment(1),
      updatedAt: now,
      createdAt: snap.exists && snap.data().createdAt ? snap.data().createdAt : now,
    }, { merge: true });
    return true;
  });

  if (!acquired) return;
  try {
    const result = await task();
    await ref.update({
      status: "delivered",
      result: result || {},
      updatedAt: FieldValue.serverTimestamp(),
      deliveredAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    });
  } catch (error) {
    await ref.set({
      status: "failed",
      error: String(error && error.message ? error.message : error).slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

async function settleAll(tasks) {
  if (!tasks.length) return;
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 1400);
}
