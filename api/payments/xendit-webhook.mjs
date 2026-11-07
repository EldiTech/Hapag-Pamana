import {
  firebaseServices,
  markPaid,
  readJson,
  safeBookingId,
  sessionJson,
} from "./xendit.mjs";

export default {
  async fetch(request) {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (request.headers.get("x-callback-token") !== String(process.env.XENDIT_WEBHOOK_TOKEN || "")) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const body = await readJson(request);
      if (body.event !== "payment_session.completed") return new Response("ok", { status: 200 });
      const data = body.data || {};
      const bookingId = safeBookingId(data.reference_id);
      const { db } = firebaseServices();
      const bookingRef = db.collection("bookings").doc(bookingId);
      const snap = await bookingRef.get();
      // Xendit's dashboard test event uses a sample reference, not a real
      // booking. Acknowledge it after token validation so Test & Save passes.
      if (!snap.exists) return new Response("ok", { status: 200 });
      const payment = sessionJson(data);
      if (payment.paid) await markPaid(bookingRef, payment);
      return new Response("ok", { status: 200 });
    } catch (error) {
      console.error("xendit webhook failed", error);
      return new Response("Webhook failed", { status: 500 });
    }
  },
};
