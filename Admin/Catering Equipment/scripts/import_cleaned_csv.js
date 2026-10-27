"use strict";

const path = require("path");
const fs = require("fs");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const keyPath = "c:\\Users\\Admin\\Downloads\\Hapag-Pamana-main\\Hapag-Pamana-main\\Admin\\Orders\\backfill\\serviceAccountKey.json";
initializeApp({ credential: cert(require(keyPath)) });
const db = getFirestore();

const USER_UID = "SpUpSeCbFTZUNRJOLMZP0es3vUj1";
const USER_NAME = "Luis David Espino";

const { buildInventory } = require("./test_parse.js");

async function executeImport() {
  console.log("====================================================");
  console.log(" IMPORTING CLEAN CATERING EQUIPMENT INVENTORY");
  console.log("====================================================\n");

  const categories = buildInventory();
  console.log(`Starting import of ${categories.length} categories...`);

  // 1. Create Categories in Firestore and map their IDs
  const catMap = new Map();
  console.log("\n1. Writing Categories to Firestore...");
  for (const c of categories) {
    const catRef = db.collection("equipmentCategories").doc();
    await catRef.set({
      name: c.name,
      createdAt: FieldValue.serverTimestamp()
    });
    catMap.set(c.name.toLowerCase(), { id: catRef.id, name: c.name });
    console.log(`  ✓ Category: "${c.name}" -> ID: ${catRef.id}`);
  }

  // 2. Prepare Items and Logs in batches
  console.log("\n2. Writing Items & Opening Ledger Logs in batches...");

  let currentBatch = db.batch();
  let opCount = 0;
  let batchIndex = 1;
  let totalItemsCreated = 0;
  let totalVariantsCreated = 0;
  let totalLogsCreated = 0;

  async function checkAndCommitBatch() {
    if (opCount >= 400) {
      console.log(`  Committing batch #${batchIndex} (${opCount} operations)...`);
      await currentBatch.commit();
      console.log(`  ✓ Batch #${batchIndex} committed successfully.`);
      currentBatch = db.batch();
      opCount = 0;
      batchIndex++;
    }
  }

  for (const c of categories) {
    const catInfo = catMap.get(c.name.toLowerCase());

    for (const it of c.items) {
      const itemRef = db.collection("equipmentItems").doc();
      totalItemsCreated++;

      // Create clean variants array
      const cleanVariants = it.variants.map(v => ({
        id: v.id,
        label: v.label,
        unit: v.unit || "pcs",
        qty: Math.max(0, Number(v.qty) || 0),
        par: null
      }));

      // Collect item note
      const allRemarks = it.variants
        .filter(v => v.remarks && v.remarks.trim())
        .map(v => `${v.label}: ${v.remarks.trim()}`)
        .join(" | ");

      const itemData = {
        name: it.name,
        categoryId: catInfo.id,
        categoryName: catInfo.name,
        note: it.note ? (allRemarks ? `${it.note} (${allRemarks})` : it.note) : (allRemarks || ""),
        variants: cleanVariants,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtLocal: Date.now(),
        updatedByName: USER_NAME
      };

      currentBatch.set(itemRef, itemData);
      opCount++;
      await checkAndCommitBatch();

      // Write opening balance logs for each variant with stock
      for (const v of it.variants) {
        totalVariantsCreated++;
        if (v.qty > 0) {
          const logRef = db.collection("equipmentLog").doc();
          const logNote = v.remarks
            ? `Opening balance from 2026 inventory. Remarks: ${v.remarks.trim()}`
            : "Opening balance from 2026 inventory";

          currentBatch.set(logRef, {
            itemId: itemRef.id,
            itemName: it.name,
            variantId: v.id,
            variantLabel: v.label,
            unit: v.unit || "pcs",
            delta: v.qty,
            before: 0,
            after: v.qty,
            reason: "opening",
            note: logNote,
            bookingId: null,
            clientName: null,
            byUid: USER_UID,
            byName: USER_NAME,
            at: FieldValue.serverTimestamp(),
            atLocal: Date.now()
          });

          opCount++;
          totalLogsCreated++;
          await checkAndCommitBatch();
        }
      }
    }
  }

  if (opCount > 0) {
    console.log(`  Committing final batch #${batchIndex} (${opCount} operations)...`);
    await currentBatch.commit();
    console.log(`  ✓ Final batch #${batchIndex} committed successfully.`);
  }

  console.log("\n====================================================");
  console.log(" CATERING EQUIPMENT IMPORT COMPLETE!");
  console.log(` • Categories Created: ${catMap.size}`);
  console.log(` • Equipment Items:    ${totalItemsCreated}`);
  console.log(` • Variants Tracked:   ${totalVariantsCreated}`);
  console.log(` • Opening Logs Saved: ${totalLogsCreated}`);
  console.log("====================================================");
}

executeImport().catch((err) => {
  console.error("Import failed with error:", err);
  process.exit(1);
});
