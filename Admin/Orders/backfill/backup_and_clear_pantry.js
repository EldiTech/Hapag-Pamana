"use strict";
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
initializeApp({ credential: cert(require(keyPath)) });
const db = getFirestore();

async function deleteCollection(collectionName) {
  const colRef = db.collection(collectionName);
  const snap = await colRef.get();
  console.log(`Clearing collection "${collectionName}" (${snap.size} documents)...`);

  let batch = db.batch();
  let count = 0;
  let totalDeleted = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count++;
    totalDeleted++;

    if (count >= 400) {
      await batch.commit();
      console.log(` Committed batch of ${count} deletions from ${collectionName}...`);
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
    console.log(` Committed final batch of ${count} deletions from ${collectionName}...`);
  }

  console.log(`✓ Collection "${collectionName}" cleared (${totalDeleted} documents deleted).\n`);
  return totalDeleted;
}

(async () => {
  console.log("====================================================");
  console.log(" 1. BACKING UP PANTRY DATA");
  console.log("====================================================\n");

  const pantrySnap = await db.collection("pantry").get();
  const logSnap = await db.collection("pantryLog").get();

  const backupData = {
    exportedAt: new Date().toISOString(),
    totalPantryItems: pantrySnap.size,
    totalPantryLogs: logSnap.size,
    pantry: pantrySnap.docs.map(d => ({ id: d.id, ...d.data() })),
    pantryLog: logSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  };

  const backupPath = path.join(__dirname, "pantry_backup.json");
  const scratchBackupPath = "C:\\Users\\Admin\\.gemini\antigravity-ide\\brain\\d98c6866-0561-4413-a3bc-057d3e8c22f5\\scratch\\pantry_backup.json";
  
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), "utf8");
  try {
    fs.writeFileSync(scratchBackupPath, JSON.stringify(backupData, null, 2), "utf8");
  } catch (e) {}

  console.log(`✓ Backup saved to ${backupPath} (${pantrySnap.size} items, ${logSnap.size} logs)\n`);

  console.log("====================================================");
  console.log(" 2. PURGING STOCK CLERK PANTRY DATA");
  console.log("====================================================\n");

  const pantryDeleted = await deleteCollection("pantry");
  const logsDeleted = await deleteCollection("pantryLog");

  console.log("====================================================");
  console.log(" DELETION SUMMARY:");
  console.log(` - pantry:     ${pantryDeleted} deleted`);
  console.log(` - pantryLog:  ${logsDeleted} deleted`);
  console.log(" All Stock Clerk pantry items and logs have been cleared!");
  console.log("====================================================");
})().catch(err => {
  console.error("Operation failed:", err);
  process.exit(1);
});
