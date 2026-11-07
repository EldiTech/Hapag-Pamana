import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

let services;

export default {
  async fetch(request) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, cors);

    try {
      const token = bearerToken(request.headers.get("authorization"));
      const { auth, db } = firebaseServices();
      const caller = await auth.verifyIdToken(token);
      const body = await readJson(request);
      const action = String(body.action || "");
      const bookingId = safeBookingId(body.bookingId);
      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await bookingRef.get();
      if (!bookingSnap.exists) return json({ error: "Booking not found" }, 404, cors);
      const booking = bookingSnap.data() || {};
      if (booking.uid !== caller.uid) return json({ error: "Forbidden" }, 403, cors);
      if (booking.paymentStatus === "paid") {
        return json({ error: "This booking is already paid" }, 409, cors);
      }

      if (action === "create") {
        const amount = money(booking.paymentDue);
        if (amount <= 0) return json({ error: "Booking has no payable amount" }, 409, cors);

        const existingId = String(booking.checkoutSessionId || "");
        const existingUrl = String(booking.checkoutUrl || "");
        if (existingId.startsWith("ps-") && existingUrl.includes("xendit")) {
          const current = await xenditRequest(`/sessions/${encodeURIComponent(existingId)}`);
          if (current.status === "ACTIVE" && current.payment_link_url) {
            return json(sessionJson(current), 200, cors);
          }
        }

        const description = cleanText(body.description, `Downpayment for ${bookingId}`);
        const lineItemName = cleanText(body.lineItemName, "Hapag Pamana downpayment");
        const customer = customerJson(body, caller.uid, bookingId);
        const session = await xenditRequest("/sessions", "POST", {
          reference_id: bookingId,
          session_type: "PAY",
          mode: "PAYMENT_LINK",
          amount,
          currency: "PHP",
          country: "PH",
          locale: "en",
          customer,
          description,
          items: [{
            reference_id: bookingId,
            name: lineItemName,
            description,
            type: "DIGITAL_SERVICE",
            category: "CATERING",
            net_unit_amount: amount,
            quantity: 1,
            currency: "PHP",
            metadata: { booking_id: bookingId },
          }],
          success_return_url: "https://hapagpamana-39687.web.app/payment/success",
          cancel_return_url: "https://hapagpamana-39687.web.app/payment/cancelled",
        });
        const result = sessionJson(session);
        if (!result.id || !result.checkoutUrl) {
          return json({ error: "Xendit returned no checkout link" }, 502, cors);
        }
        await bookingRef.update({
          checkoutSessionId: result.id,
          checkoutUrl: result.checkoutUrl,
        });
        return json(result, 200, cors);
      }

      if (action === "status") {
        const sessionId = String(body.sessionId || "");
        if (!/^ps-[A-Za-z0-9_-]+$/.test(sessionId)) {
          return json({ error: "Invalid Xendit session" }, 400, cors);
        }
        const session = await xenditRequest(`/sessions/${encodeURIComponent(sessionId)}`);
        if (session.reference_id !== bookingId) return json({ error: "Session mismatch" }, 403, cors);
        const result = sessionJson(session);
        if (result.paid) await markPaid(bookingRef, result);
        return json(result, 200, cors);
      }
      return json({ error: "Invalid action" }, 400, cors);
    } catch (error) {
      console.error("xendit payment failed", error);
      const status = Number(error?.clientStatus || 500);
      return json({ error: status < 500 ? error.message : "Payment service unavailable" }, status, cors);
    }
  },
};

export function firebaseServices() {
  if (services) return services;
  const app = getApps()[0] || initializeApp({
    credential: cert({
      projectId: requiredEnv("FIREBASE_PROJECT_ID"),
      clientEmail: requiredEnv("FIREBASE_CLIENT_EMAIL"),
      privateKey: requiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }),
  });
  services = { auth: getAuth(app), db: getFirestore(app) };
  return services;
}

export async function markPaid(bookingRef, payment) {
  const update = {
    paymentStatus: "paid",
    paymentPaid: payment.amount,
    paidAt: FieldValue.serverTimestamp(),
    ...(payment.paymentId ? { paymentRef: payment.paymentId } : {}),
    ...(payment.method ? { paymentMethod: payment.method } : {}),
  };
  await bookingRef.update(update);
}

export async function xenditRequest(path, method = "GET", payload) {
  const secret = requiredEnv("XENDIT_SECRET_KEY");
  const response = await fetch(`https://api.xendit.co${path}`, {
    method,
    headers: {
      authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
      accept: "application/json",
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.message || body?.error_code || "Xendit rejected the request");
    error.clientStatus = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw error;
  }
  return body;
}

export function sessionJson(session) {
  const status = String(session.status || "").toUpperCase();
  return {
    id: String(session.payment_session_id || ""),
    checkoutUrl: String(session.payment_link_url || ""),
    status,
    paid: status === "COMPLETED",
    amount: money(session.amount),
    paymentId: session.payment_id || null,
    method: session.payment_method || null,
  };
}

export function customerJson(body, uid, bookingId) {
  const name = cleanText(body.name, "Hapag Pamana customer");
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    // Xendit requires customer.reference_id to be unique. The Firebase UID is
    // stable across bookings, so pair it with this booking's ID instead.
    reference_id: `${uid}${bookingId}`.replace(/[^A-Za-z0-9]/g, ""),
    type: "INDIVIDUAL",
    ...(body.email ? { email: cleanText(body.email, "") } : {}),
    ...(body.phone ? { mobile_number: cleanText(body.phone, "") } : {}),
    individual_detail: {
      given_names: parts[0] || "Hapag",
      ...(parts.length > 1 ? { surname: parts.slice(1).join(" ") } : {}),
    },
  };
}

export function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

export function cleanText(value, fallback) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 255) : fallback;
}

export function safeBookingId(value) {
  const id = String(value || "");
  if (!id || id.length > 256 || id.includes("/")) {
    const error = new Error("Invalid bookingId");
    error.clientStatus = 400;
    throw error;
  }
  return id;
}

export function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`Missing Vercel environment variable: ${name}`);
  return value;
}

export function bearerToken(value) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || ""));
  if (!match) {
    const error = new Error("Authentication required");
    error.clientStatus = 401;
    throw error;
  }
  return match[1];
}

export async function readJson(request) {
  const text = await request.text();
  if (text.length > 8192) {
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

export function corsHeaders(request) {
  const origin = request.headers.get("origin");
  const extras = String(process.env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  const allowed = !origin || origin === new URL(request.url).origin || extras.includes(origin);
  return {
    "access-control-allow-headers": "Authorization, Content-Type",
    "access-control-allow-methods": "POST, OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...(allowed && origin ? { "access-control-allow-origin": origin } : {}),
  };
}

export function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
