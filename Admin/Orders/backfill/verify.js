"use strict";
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");

initializeApp({ credential: cert(require(path.join(__dirname, "serviceAccountKey.json"))) });
const db = getFirestore();

(async () => {
  const snap = await db.collection("bookings").where("source", "==", "excel_backfill_2022_2026").get();
  console.log(`Docs with source=excel_backfill_2022_2026: ${snap.size}`);
  const total = await db.collection("bookings").count().get();
  console.log(`Total docs in bookings: ${total.data().count}`);
})().catch((e) => { console.error(e); process.exit(1); });
