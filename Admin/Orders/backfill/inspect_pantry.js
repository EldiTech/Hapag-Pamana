"use strict";
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");

initializeApp({ credential: cert(require(path.join(__dirname, "serviceAccountKey.json"))) });
const db = getFirestore();

(async () => {
  const pantrySnap = await db.collection("pantry").get();
  const logSnap = await db.collection("pantryLog").get();

  console.log(`Pantry items count: ${pantrySnap.size}`);
  console.log(`Pantry log count: ${logSnap.size}`);

  if (pantrySnap.size > 0) {
    console.log("\nSample pantry items (up to 5):");
    pantrySnap.docs.slice(0, 5).forEach(doc => {
      console.log(` - [${doc.id}]:`, JSON.stringify(doc.data()));
    });
  }
})().catch(e => {
  console.error("Error:", e);
  process.exit(1);
});
