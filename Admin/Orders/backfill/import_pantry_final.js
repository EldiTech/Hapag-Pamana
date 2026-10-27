"use strict";

const path = require("path");
const fs = require("fs");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
initializeApp({ credential: cert(require(keyPath)) });
const db = getFirestore();

const USER_UID = "SpUpSeCbFTZUNRJOLMZP0es3vUj1";
const USER_NAME = "Luis David Espino";

const { buildPantryItems } = require("./test_parse_pantry.js");

function normalizeUnit(u) {
  if (!u) return "pcs";
  const s = u.trim();
  const lower = s.toLowerCase();

  if (/^(pcs|pieces|pcs\.|pcs\b|pieces\b)/i.test(s)) return "pcs";
  if (/^(kilo|kilogram|kg|kls|kg\b|kls\b)/i.test(s)) return "kg";
  if (/^(packs|pack|pak|pck)/i.test(s)) return "packs";
  if (/^(boxes|box|ibox)/i.test(s)) return "boxes";
  if (/^(bottles|bottle|bottled|batle)/i.test(s)) return "bottles";
  if (/^(cans|can|canned|tin cans)/i.test(s)) return "cans";
  if (/^(gallons|gallon)/i.test(s)) return "gallons";
  if (/^(loafs|loaf)/i.test(s)) return "loaf";
  if (/^(sachet)/i.test(s)) return "sachet";
  if (/^(bars|bar)/i.test(s)) return "bars";
  if (/^(rolls|roll)/i.test(s)) return "rolls";
  if (/^(bundles|bundle)/i.test(s)) return "bundles";
  if (/^(tetra pack|tetra pakc)/i.test(s)) return "tetra pack";
  if (/^(sacks|sack)/i.test(s)) return "sacks";
  if (/^(trays|try)/i.test(s)) return "trays";
  if (/^(tali|tie)/i.test(s)) return "tali";
  if (/^(jars|jar)/i.test(s)) return "jars";
  if (lower.includes("paper bag")) return "pcs";

  return s;
}

async function runImport() {
  console.log("====================================================");
  console.log(" IMPORTING STOCK CLERK PANTRY DATA TO FIRESTORE");
  console.log("====================================================\n");

  const { items, skipped } = buildPantryItems();
  console.log(`Parsed ${items.length} items from CSV (skipped ${skipped.length} rows).`);

  // Disambiguate or merge duplicates
  const itemMap = new Map();
  for (const it of items) {
    it.unit = normalizeUnit(it.unit);
    const key = `${it.name.trim().toLowerCase()}|${it.unit.toLowerCase()}`;
    
    if (itemMap.has(key)) {
      const existing = itemMap.get(key);
      if (existing.name.toLowerCase() === it.name.toLowerCase() && existing.category === it.category) {
        // Same category & name (e.g. Mama Sita Oyster Sauce) -> merge quantities & preserve price/expiry
        existing.qty = Math.round((existing.qty + it.qty) * 1000) / 1000;
        if (!existing.price && it.price) existing.price = it.price;
        if (!existing.expiryDate && it.expiryDate) existing.expiryDate = it.expiryDate;
        console.log(` Merged duplicate item: "${it.name}" (${it.unit}) -> total qty: ${existing.qty}`);
      } else {
        // Different categories (e.g. Cooked Dishes vs Frozen) -> disambiguate name with category suffix
        it.name = `${it.name} (${it.category})`;
        const newKey = `${it.name.trim().toLowerCase()}|${it.unit.toLowerCase()}`;
        itemMap.set(newKey, it);
        console.log(` Disambiguated item name: "${it.name}"`);
      }
    } else {
      itemMap.set(key, it);
    }
  }

  const finalItems = Array.from(itemMap.values());
  console.log(`\nFinal unique items to import: ${finalItems.length}\n`);

  let batch = db.batch();
  let opCount = 0;
  let batchNum = 1;
  let totalImported = 0;
  let totalLogsCreated = 0;

  for (const item of finalItems) {
    const ref = db.collection("pantry").doc();
    const itemData = {
      name: item.name,
      category: item.category,
      unit: item.unit,
      price: item.price,
      expiryDate: item.expiryDate,
      qty: item.qty,
      par: null,
      note: item.note || "",
      updatedAt: FieldValue.serverTimestamp(),
      updatedAtLocal: Date.now(),
      updatedByName: USER_NAME,
    };

    batch.set(ref, itemData);
    opCount++;
    totalImported++;

    if (item.qty > 0) {
      const logRef = db.collection("pantryLog").doc();
      batch.set(logRef, {
        itemId: ref.id,
        itemName: item.name,
        unit: item.unit,
        delta: item.qty,
        before: 0,
        after: item.qty,
        reason: "opening",
        note: "Initial stock from CSV import",
        bookingId: null,
        clientName: null,
        byUid: USER_UID,
        byName: USER_NAME,
        at: FieldValue.serverTimestamp(),
        atLocal: Date.now(),
      });
      opCount++;
      totalLogsCreated++;
    }

    if (opCount >= 400) {
      await batch.commit();
      console.log(`✓ Committed batch #${batchNum} (${opCount} operations)...`);
      batch = db.batch();
      opCount = 0;
      batchNum++;
    }
  }

  if (opCount > 0) {
    await batch.commit();
    console.log(`✓ Committed final batch #${batchNum} (${opCount} operations)...`);
  }

  console.log("\n====================================================");
  console.log(" IMPORT COMPLETE");
  console.log(` - Items inserted into 'pantry':    ${totalImported}`);
  console.log(` - Opening logs in 'pantryLog':     ${totalLogsCreated}`);
  console.log("====================================================");
}

runImport().catch(e => {
  console.error("Import failed:", e);
  process.exit(1);
});
