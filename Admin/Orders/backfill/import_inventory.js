"use strict";

const path = require("path");
const fs = require("fs");
let XLSX;
try {
  XLSX = require("xlsx");
} catch (e) {
  try {
    XLSX = require("C:/Users/Joshua/.gemini/antigravity-ide/brain/26fc2686-0694-4991-b23e-ce5c7b5b5c25/scratch/node_modules/xlsx");
  } catch (e2) {
    XLSX = null;
  }
}
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");
initializeApp({ credential: cert(require(serviceAccountPath)) });
const db = getFirestore();

const EQUIP_PATH = "C:\\Users\\Joshua\\Downloads\\equipment.xlsx";
const LINEN_PATH = "C:\\Users\\Joshua\\Downloads\\linen.xlsx";

const USER_UID = "SpUpSeCbFTZUNRJOLMZP0es3vUj1";
const USER_NAME = "Luis David Espino";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function clean(str) {
  if (str === null || str === undefined) return "";
  return String(str).trim();
}

function parseEquipmentFile() {
  const wb = XLSX.readFile(EQUIP_PATH);
  const sheetName = "1-7 SEPTEMBER";
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const categories = [];
  let currentCat = null;
  let currentItem = null;

  function ensureCat(name) {
    let cat = categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { name, items: [] };
      categories.push(cat);
    }
    currentCat = cat;
    return cat;
  }

  // Major section headers
  const SECTION_MAP = {
    "PLATES": "Plates & Dinnerware",
    "GLASS": "Glassware & Drinkware",
    "CUTLERIES": "Cutleries",
    "LEGACY": "Chafing Dishes & Food Warmers",
    "ELECTRICAL AND COOKING WARE EQUIPMENT": "Cooking & Electrical Equipment",
    "TABLES AND CHAIRS": "Tables & Chairs",
    "CHARGER PLATES": "Charger Plates",
    "CONDIMENTS AND SAUCE BOWL": "Condiments & Sauce Bowls",
    "SERVING GEARS": "Serving Gears & Kitchen Tools",
    "PITCHERS AND ICE BUCKETS": "Pitchers, Ice Buckets & Trays",
    "SERVING TRAYS AND STANDS": "Pitchers, Ice Buckets & Trays",
    "OTHERS": "Staging & Event Gear",
    "FOOD TASTING GEARS": "Food Tasting Gears"
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const col0 = clean(r[0]);
    if (!col0) continue;
    if (col0.startsWith("TOTAL LOST") || col0.startsWith("TOTAL INVENTORY")) continue;

    // Quantity determination: col 12 is ending inventory, fallback to col 2 then col 1
    const val12 = r[12];
    const val2 = r[2];
    const val1 = r[1];
    const cand = (val12 !== null && val12 !== undefined) ? val12 : ((val2 !== null && val2 !== undefined) ? val2 : val1);
    const hasQty = (typeof cand === "number") || (typeof cand === "string" && /^\d+$/.test(cand.trim()));
    const qty = hasQty ? Math.max(0, parseInt(cand, 10)) : 0;

    const upperCol0 = col0.toUpperCase();

    // Check if this row matches a major section
    if (SECTION_MAP[upperCol0] && !hasQty) {
      ensureCat(SECTION_MAP[upperCol0]);
      currentItem = null;
      continue;
    }

    if (!currentCat) {
      ensureCat("Plates & Dinnerware");
    }

    // Check for parent items that group variants
    const isHeaderOnly = !hasQty && (r[1] === null || r[1] === undefined || String(r[1]).includes("TOTAL")) && (r[2] === null || r[2] === undefined || r[2] === "");
    
    if (isHeaderOnly) {
      if (col0.toLowerCase() === "others:") {
        currentItem = null;
        continue;
      }

      let itemName = col0;
      if (itemName === "SILVER") itemName = "Silver Cutlery";
      else if (itemName === "GOLD") itemName = "Gold Cutlery";
      else if (itemName === "LEGACY") {
        ensureCat("Chafing Dishes & Food Warmers");
        itemName = "Chafing Dish (Legacy)";
      } else if (itemName === "SANGKALAN") itemName = "Chopping Board (Sangkalan)";
      else if (itemName === "SERVING GEAR UNDERLINERS") itemName = "Serving Gear Underliners";

      currentItem = {
        name: itemName,
        note: "",
        variants: []
      };
      currentCat.items.push(currentItem);
      continue;
    }

    // If we have an active parent item with variants
    if (currentItem && currentItem.variants) {
      if (hasQty) {
        currentItem.variants.push({
          label: col0,
          qty: qty,
          unit: "pcs",
          par: null
        });
        continue;
      }
    }

    // Standalone item
    if (hasQty) {
      // Clean up item name
      let itemName = col0;
      currentCat.items.push({
        name: itemName,
        note: "",
        variants: [
          {
            label: "Standard",
            qty: qty,
            unit: "pcs",
            par: null
          }
        ]
      });
    }
  }

  return categories;
}

function parseLinenFile() {
  const wb = XLSX.readFile(LINEN_PATH);
  const sheetName = " July 15-21, 2026";
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

  const categories = [
    { name: "Linens", items: [] },
    { name: "Decors & Centerpieces", items: [] }
  ];

  let currentCat = categories[0];
  let currentItem = null;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const rawName = clean(r[0]);
    if (!rawName) continue;
    if (rawName.startsWith("TOTAL LOST") || rawName.startsWith("TOTAL INVENTORY")) continue;

    if (rawName.toUpperCase() === "LINEN") {
      currentCat = categories[0];
      currentItem = null;
      continue;
    }
    if (rawName.toUpperCase() === "DECOR") {
      currentCat = categories[1];
      currentItem = null;
      continue;
    }

    const val10 = r[10];
    const val2 = r[2];
    const val1 = r[1];
    const cand = (val10 !== null && val10 !== undefined) ? val10 : ((val2 !== null && val2 !== undefined) ? val2 : val1);

    let qty = 0;
    let unit = "pcs";
    let hasQty = false;

    if (typeof cand === "number") {
      qty = cand;
      hasQty = true;
    } else if (typeof cand === "string") {
      if (/^\d+$/.test(cand.trim())) {
        qty = parseInt(cand.trim(), 10);
        hasQty = true;
      } else if (cand.trim().toLowerCase() === "set") {
        qty = 1;
        unit = "sets";
        hasQty = true;
      }
    }

    const isHeaderOnly = !hasQty && (r[1] === null || r[1] === undefined || r[1] === "") && (r[2] === null || r[2] === undefined || r[2] === "");

    if (isHeaderOnly) {
      let itemName = rawName;
      if (rawName.toLowerCase() === "others:" || rawName.toLowerCase() === "others") {
        itemName = currentCat.name === "Linens" ? "Other Linens & Fabric" : "Other Decors & Props";
      } else if (itemName === "SQUARE W/PLEATS") itemName = "Square Tablecloth w/ Pleats";
      else if (itemName === "LONG W/PLEATS") itemName = "Long Tablecloth w/ Pleats";
      else if (itemName === "ROUND TABLE CLOTH") itemName = "Round Tablecloth";
      else if (itemName === "BUFFET TOPPER") itemName = "Buffet Topper";
      else if (itemName === "ROUND TOPPER") itemName = "Round Topper";
      else if (itemName === "RUNNER") itemName = "Table Runner";
      else if (itemName === "RIBBON") itemName = "Ribbon";
      else if (itemName === "CHAIR COVER") itemName = "Chair Cover";
      else if (itemName === "TABLE NAPKIN") itemName = "Table Napkin";
      else if (itemName === "LAMP/LIGHTS") itemName = "Lamps & Lights";
      else if (itemName === "JAR") itemName = "Jars & Vases";
      else if (itemName === "BALL") itemName = "Decorative Balls";
      else if (itemName === "BACKDROP") itemName = "Backdrop & Ambient Lights";
      else if (itemName === "Crystal Candle Holder (Chandelier)") itemName = "Crystal Candle Holder (Chandelier)";
      else if (itemName === "Geometrical") itemName = "Geometrical Centerpiece";
      else if (itemName === "For Centerpiece") itemName = "Centerpiece Items";
      else if (itemName === "For Buffet") itemName = "Buffet Decors";
      else if (itemName === "Stand") itemName = "Stands & Table Numbers";
      else if (itemName === "Basket/Boxes/Carpet/etc") itemName = "Baskets, Boxes & Risers";
      else if (itemName === "For Linen") itemName = "Linen Care & Equipment";
      else if (itemName === "Table Napkin Accessories") itemName = "Table Napkin Accessories";

      // Check if item already exists in this category
      let existingItem = currentCat.items.find((it) => it.name === itemName);
      if (!existingItem) {
        existingItem = { name: itemName, note: "", variants: [] };
        currentCat.items.push(existingItem);
      }
      currentItem = existingItem;
      continue;
    }

    let varLabel = rawName.replace(/\s*-[A-Z0-9]+\s*$/i, "").trim();
    if (!varLabel && r[1]) varLabel = "Variant " + ((currentItem ? currentItem.variants.length : 0) + 1);

    if (currentItem && currentItem.variants) {
      // Avoid duplicate variant labels within the same item
      let finalLabel = varLabel;
      let counter = 2;
      while (currentItem.variants.some((v) => v.label.toLowerCase() === finalLabel.toLowerCase())) {
        finalLabel = `${varLabel} (${counter++})`;
      }
      currentItem.variants.push({
        label: finalLabel,
        qty: Math.max(0, qty),
        unit: unit,
        par: null
      });
    } else {
      currentCat.items.push({
        name: varLabel,
        note: "",
        variants: [
          {
            label: "Standard",
            qty: Math.max(0, qty),
            unit: unit,
            par: null
          }
        ]
      });
    }
  }

  return categories;
}

async function runImport() {
  console.log("Starting Catering Equipment & Linen inventory import...");

  const equipCats = parseEquipmentFile();
  const linenCats = parseLinenFile();

  // Combine categories
  const allCategories = [];
  function mergeCategories(list) {
    list.forEach((c) => {
      let target = allCategories.find((ac) => ac.name.toLowerCase() === c.name.toLowerCase());
      if (!target) {
        target = { name: c.name, items: [] };
        allCategories.push(target);
      }
      c.items.forEach((item) => {
        if (item.variants && item.variants.length > 0) {
          target.items.push(item);
        }
      });
    });
  }
  mergeCategories(equipCats);
  mergeCategories(linenCats);

  console.log(`Prepared ${allCategories.length} categories for import:`);
  allCategories.forEach((c) => console.log(` - ${c.name} (${c.items.length} items)`));

  // Fetch existing Firestore categories and items
  const existingCatsSnap = await db.collection("equipmentCategories").get();
  const catMap = new Map(); // name.toLowerCase() -> { id, name }
  existingCatsSnap.forEach((d) => {
    catMap.set(d.data().name.toLowerCase(), { id: d.id, name: d.data().name });
  });

  const existingItemsSnap = await db.collection("equipmentItems").get();
  const itemMap = new Map(); // name.toLowerCase() -> { id, data }
  existingItemsSnap.forEach((d) => {
    itemMap.set(d.data().name.toLowerCase(), { id: d.id, data: d.data() });
  });

  // Ensure all categories exist
  for (const c of allCategories) {
    const key = c.name.toLowerCase();
    if (!catMap.has(key)) {
      const docRef = await db.collection("equipmentCategories").add({
        name: c.name,
        createdAt: FieldValue.serverTimestamp()
      });
      catMap.set(key, { id: docRef.id, name: c.name });
      console.log(`Created category: ${c.name} (${docRef.id})`);
    }
  }

  // Prepare batches of writes
  const operations = []; // array of async functions returning batch commits
  let currentBatch = db.batch();
  let opCount = 0;

  function addBatchOp(fn) {
    fn(currentBatch);
    opCount++;
    if (opCount >= 400) {
      const b = currentBatch;
      operations.push(() => b.commit());
      currentBatch = db.batch();
      opCount = 0;
    }
  }

  let totalItemsAdded = 0;
  let totalVariantsAdded = 0;
  let totalLogsAdded = 0;

  for (const c of allCategories) {
    const catInfo = catMap.get(c.name.toLowerCase());
    for (const item of c.items) {
      const itemKey = item.name.toLowerCase();
      let itemDocRef;
      let isNew = true;

      const cleanVariants = item.variants.map((v) => ({
        id: uid(),
        label: v.label,
        unit: v.unit || "pcs",
        qty: Number(v.qty) || 0,
        par: v.par !== null && v.par !== undefined ? Number(v.par) : null
      }));

      if (itemMap.has(itemKey)) {
        // Update existing item
        const existing = itemMap.get(itemKey);
        itemDocRef = db.collection("equipmentItems").doc(existing.id);
        isNew = false;

        const mergedVariants = [...(existing.data.variants || [])];
        cleanVariants.forEach((v) => {
          const matchIdx = mergedVariants.findIndex((mv) => mv.label.toLowerCase() === v.label.toLowerCase());
          if (matchIdx >= 0) {
            mergedVariants[matchIdx].qty = v.qty;
          } else {
            mergedVariants.push(v);
          }
        });

        addBatchOp((b) => {
          b.update(itemDocRef, {
            variants: mergedVariants,
            updatedAt: FieldValue.serverTimestamp(),
            updatedAtLocal: Date.now(),
            updatedByName: USER_NAME
          });
        });
      } else {
        // Create new item
        itemDocRef = db.collection("equipmentItems").doc();
        const itemData = {
          name: item.name,
          categoryId: catInfo.id,
          categoryName: catInfo.name,
          note: item.note || "",
          variants: cleanVariants,
          updatedAt: FieldValue.serverTimestamp(),
          updatedAtLocal: Date.now(),
          updatedByName: USER_NAME
        };

        addBatchOp((b) => {
          b.set(itemDocRef, itemData);
        });
        totalItemsAdded++;
      }

      // Add opening balance logs for variants with qty > 0
      cleanVariants.forEach((v) => {
        totalVariantsAdded++;
        if (v.qty > 0) {
          const logRef = db.collection("equipmentLog").doc();
          addBatchOp((b) => {
            b.set(logRef, {
              itemId: itemDocRef.id,
              itemName: item.name,
              variantId: v.id,
              variantLabel: v.label,
              unit: v.unit,
              delta: v.qty,
              before: 0,
              after: v.qty,
              reason: "opening",
              note: "Opening balance from excel inventory import",
              bookingId: null,
              clientName: null,
              byUid: USER_UID,
              byName: USER_NAME,
              at: FieldValue.serverTimestamp(),
              atLocal: Date.now()
            });
          });
          totalLogsAdded++;
        }
      });
    }
  }

  if (opCount > 0) {
    const b = currentBatch;
    operations.push(() => b.commit());
  }

  console.log(`Executing ${operations.length} batches containing ${opCount + (operations.length - 1) * 400} total Firestore writes...`);
  for (let i = 0; i < operations.length; i++) {
    await operations[i]();
    console.log(` Batch ${i + 1}/${operations.length} committed.`);
  }

  console.log("====================================================");
  console.log(" IMPORT COMPLETED SUCCESSFULLY!");
  console.log(` Items created: ${totalItemsAdded}`);
  console.log(` Variants tracked: ${totalVariantsAdded}`);
  console.log(` Opening ledger entries logged: ${totalLogsAdded}`);
  console.log("====================================================");
}

runImport().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
