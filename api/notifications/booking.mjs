import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

const ORDER_ROLES = new Set(["marketing_admin", "order_manager", "admin", "owner"]);
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
  pending: {
    title: "Booking Pending",
    body: "Your booking is back in the pending queue. Tap to view its progress.",
  },
};

let services;

function firebaseServices() {
  if (services) return services;
  const projectId = requiredEnv("FIREBASE_PROJECT_ID");
  const clientEmail = requiredEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const app = getApps()[0] || initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
  services = {
    auth: getAuth(app),
    db: getFirestore(app),
    messaging: getMessaging(app),
  };
  return services;
}

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`);
  return value;
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: cors.allowed ? 204 : 403, headers: cors.headers });
    }
    if (!cors.allowed) return json({ error: "Origin not allowed" }, 403, cors.headers);
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors.headers);

    try {
      const token = bearerToken(request.headers.get("authorization"));
      const { auth, db } = firebaseServices();
      const decoded = await auth.verifyIdToken(token);
      const body = await readJson(request);
      const action = String(body.action || "");
      const bookingId = String(body.bookingId || "");
      if (!new Set(["booking_created", "status_changed", "payment_paid"]).has(action)) {
        return json({ error: "Invalid action" }, 400, cors.headers);
      }
      if (!bookingId || bookingId.length > 256 || bookingId.includes("/")) {
        return json({ error: "Invalid bookingId" }, 400, cors.headers);
      }

      const bookingSnap = await db.collection("bookings").doc(bookingId).get();
      if (!bookingSnap.exists || bookingSnap.data().deleted === true) {
        return json({ error: "Booking not found" }, 404, cors.headers);
      }
      const booking = bookingSnap.data();
      const isOwner = booking.uid === decoded.uid;
      const isOrderManager = await hasOrderRole(db, decoded.uid);
      let results;

      if (action === "booking_created") {
        if (!isOwner) return json({ error: "Forbidden" }, 403, cors.headers);
        if (booking.status !== "pending") return json({ error: "Booking is not pending" }, 409, cors.headers);
        const eventId = eventKey(action, bookingId, booking.createdAt, "pending");
        results = await Promise.all([
          runOnce(db, `${eventId}-customer-history`, () => writeCustomerNotification(db, {
            uid: booking.uid,
            bookingId,
            eventId,
            status: "pending",
            type: "booking_received",
            title: "Booking Received",
            body: "Your catering inquiry was received. We will confirm it shortly.",
          }, false)),
          runOnce(db, `${eventId}-admin-push`, () => sendAdminPush(db, bookingId, eventId)),
        ]);
      } else if (action === "status_changed") {
        if (!isOrderManager) return json({ error: "Forbidden" }, 403, cors.headers);
        const copy = STATUS_COPY[booking.status];
        if (!copy) return json({ error: "Unsupported booking status" }, 409, cors.headers);
        const eventId = eventKey(action, bookingId, booking.statusUpdatedAt, booking.status);
        results = [await runOnce(db, `${eventId}-customer-push`, () => notifyCustomer(db, {
          uid: booking.uid,
          bookingId,
          eventId,
          status: booking.status,
          type: "booking_status",
          ...copy,
        }))];
      } else {
        if (!isOwner && !isOrderManager) return json({ error: "Forbidden" }, 403, cors.headers);
        if (booking.paymentStatus !== "paid") return json({ error: "Payment is not paid" }, 409, cors.headers);
        const eventId = eventKey(action, bookingId, booking.paidAt, "paid");
        results = [await runOnce(db, `${eventId}-customer-push`, () => notifyCustomer(db, {
          uid: booking.uid,
          bookingId,
          eventId,
          status: "paid",
          type: "payment_received",
          title: "Payment Received",
          body: "Your booking payment has been recorded. Tap to view the booking.",
        }))];
      }

      return json({ ok: true, results }, 200, cors.headers);
    } catch (error) {
      const authError = error && String(error.code || "").startsWith("auth/");
      const clientError = error && error.clientStatus;
      console.error("booking notification failed", error);
      return json(
        { error: authError ? "Invalid authentication" : (clientError ? error.message : "Notification delivery failed") },
        authError ? 401 : (clientError || 500),
        cors.headers,
      );
    }
  },
};

function corsHeaders(request) {
  const origin = request.headers.get("origin");
  const sameOrigin = origin && origin === new URL(request.url).origin;
  const extras = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = !origin || sameOrigin || extras.includes(origin);
  const headers = {
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-allow-methods": "POST, OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    vary: "Origin",
  };
  if (allowed && origin) headers["access-control-allow-origin"] = origin;
  return { allowed, headers };
}

function bearerToken(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || ""));
  if (!match) {
    const error = new Error("Authentication required");
    error.clientStatus = 401;
    throw error;
  }
  return match[1];
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > 4096) {
    const error = new Error("Request body too large");
    error.clientStatus = 413;
    throw error;
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    const error = new Error("Invalid JSON");
    error.clientStatus = 400;
    throw error;
  }
}

async function hasOrderRole(db, uid) {
  const snap = await db.collection("users").doc(uid).get();
  const user = snap.data() || {};
  return snap.exists && user.active !== false && ORDER_ROLES.has(user.role);
}

function eventKey(action, bookingId, timestamp, state) {
  if (!timestamp || typeof timestamp.toMillis !== "function") {
    const error = new Error("Booking timestamp is not ready; retry the request");
    error.clientStatus = 409;
    throw error;
  }
  return safeId(`${action}-${bookingId}-${state}-${timestamp.toMillis()}`);
}

async function notifyCustomer(db, payload) {
  const wantsUpdates = await customerWantsOrderUpdates(db, payload.uid);
  if (!wantsUpdates) return { skipped: "preference-disabled" };
  await writeCustomerNotification(db, payload, true);
  const tokenSnap = await db.collection("customers").doc(payload.uid)
    .collection("pushTokens").where("active", "==", true).get();
  return sendToTokenDocs(tokenSnap.docs, {
    notification: { title: payload.title, body: payload.body },
    data: notificationData(payload),
    android: { priority: "high", notification: { clickAction: "FLUTTER_NOTIFICATION_CLICK" } },
    apns: { headers: { "apns-priority": "10" }, payload: { aps: { sound: "default" } } },
  });
}

async function writeCustomerNotification(db, payload, preferenceChecked) {
  if (!preferenceChecked && !(await customerWantsOrderUpdates(db, payload.uid))) {
    return { skipped: "preference-disabled" };
  }
  await db.collection("notifications").doc(payload.uid).collection("items")
    .doc(safeId(`${payload.eventId}-${payload.type}`)).set({
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

async function customerWantsOrderUpdates(db, uid) {
  const snap = await db.collection("customers").doc(uid).get();
  if (!snap.exists) return false;
  return (snap.data().preferences || {}).orderUpdates !== false;
}

async function sendAdminPush(db, bookingId, eventId) {
  const tokenSnap = await db.collection("adminNotificationTokens").where("active", "==", true).get();
  if (tokenSnap.empty) return { tokens: 0, success: 0, failure: 0 };
  const userIds = [...new Set(tokenSnap.docs.map((doc) => doc.data().uid).filter(Boolean))];
  const userSnaps = userIds.length
    ? await db.getAll(...userIds.map((uid) => db.collection("users").doc(uid)))
    : [];
  const allowed = new Set(userSnaps.filter((snap) => {
    const user = snap.data() || {};
    return snap.exists && user.active !== false && ORDER_ROLES.has(user.role);
  }).map((snap) => snap.id));
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
  const { db, messaging } = firebaseServices();
  const byToken = new Map();
  for (const doc of docs) {
    const token = doc.data().token;
    if (typeof token === "string" && token) byToken.set(token, doc);
  }
  const uniqueDocs = [...byToken.values()];
  if (!uniqueDocs.length) return { tokens: 0, success: 0, failure: 0 };

  let success = 0;
  let failure = 0;
  const staleRefs = [];
  for (let offset = 0; offset < uniqueDocs.length; offset += 500) {
    const chunk = uniqueDocs.slice(offset, offset + 500);
    const response = await messaging.sendEachForMulticast({
      ...message,
      tokens: chunk.map((doc) => doc.data().token),
    });
    success += response.successCount;
    failure += response.failureCount;
    response.responses.forEach((item, index) => {
      if (!item.success && isInvalidTokenError(item.error)) staleRefs.push(chunk[index].ref);
    });
  }
  if (staleRefs.length) {
    const batch = db.batch();
    staleRefs.forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
  return { tokens: uniqueDocs.length, success, failure, stale: staleRefs.length };
}

function isInvalidTokenError(error) {
  return error && [
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ].includes(error.code);
}

async function runOnce(db, id, task) {
  const ref = db.collection("notificationDeliveries").doc(safeId(id));
  const now = Timestamp.now();
  const acquired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().status === "delivered") return false;
    if (snap.exists && snap.data().status === "processing") {
      const updatedAt = snap.data().updatedAt;
      if (updatedAt && now.toMillis() - updatedAt.toMillis() < 120000) return false;
    }
    tx.set(ref, {
      status: "processing",
      attempts: FieldValue.increment(1),
      updatedAt: now,
      createdAt: snap.exists && snap.data().createdAt ? snap.data().createdAt : now,
    }, { merge: true });
    return true;
  });
  if (!acquired) return { duplicate: true };

  try {
    const result = await task();
    await ref.update({
      status: "delivered",
      result: result || {},
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    });
    return result || {};
  } catch (error) {
    await ref.set({
      status: "failed",
      error: String(error && error.message ? error.message : error).slice(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    throw error;
  }
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 1400);
}

function json(value, status, headers) {
  return new Response(JSON.stringify(value), { status, headers });
}
