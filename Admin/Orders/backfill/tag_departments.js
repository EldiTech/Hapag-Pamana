"use strict";

const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const path = require("path");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
initializeApp({ credential: cert(require(keyPath)) });
const db = getFirestore();

const DEPT_MAP = {
  // 1. Frozen & Meats
  "Frozen Pork": "Frozen & Meats",
  "Frozen Beef": "Frozen & Meats",
  "Frozen Chicken": "Frozen & Meats",
  "Frozen Fish": "Frozen & Meats",
  "Frozen Seafoods": "Frozen & Meats",
  "Frozen Delights": "Frozen & Meats",
  "Bacons": "Frozen & Meats",
  "Cooked Dishes": "Frozen & Meats",
  "Dry Fish": "Frozen & Meats",
  "Meat & poultry": "Frozen & Meats",

  // 2. Fresh Produce
  "Vegetables": "Fresh Produce",
  "Fruits": "Fresh Produce",

  // 3. Dry Goods & Staples
  "Rice & Egg": "Dry Goods & Staples",
  "Pasta": "Dry Goods & Staples",
  "Flour": "Dry Goods & Staples",
  "Bread": "Dry Goods & Staples",
  "Canned Goods": "Dry Goods & Staples",
  "Rice & grains": "Dry Goods & Staples",
  "Dry goods": "Dry Goods & Staples",

  // 4. Condiments, Seasonings & Dairy
  "Condiments": "Condiments, Seasonings & Dairy",
  "Dressings": "Condiments, Seasonings & Dairy",
  "Powders": "Condiments, Seasonings & Dairy",
  "Dairy & eggs": "Condiments, Seasonings & Dairy",
  "Spices": "Condiments, Seasonings & Dairy",
  "Condiments & sauces": "Condiments, Seasonings & Dairy",

  // 5. Beverages
  "Softdrinks": "Beverages",
  "Flavored Juices": "Beverages",
  "Beverages": "Beverages",

  // 6. Packaging & Disposables
  "Packaging": "Packaging & Disposables",
  "Plastics": "Packaging & Disposables",
  "Spoon and Fork": "Packaging & Disposables",
  "Tissues": "Packaging & Disposables",

  // 7. Cleaning & Supplies
  "Kalinisan": "Cleaning & Supplies",
  "Others": "Cleaning & Supplies",
  "Other": "Cleaning & Supplies"
};

async function tagDepartments() {
  console.log("Updating items with Master Departments...");
  const snap = await db.collection("pantry").get();
  console.log(`Found ${snap.size} documents in pantry.`);

  let batch = db.batch();
  let count = 0;
  let updated = 0;

  const deptCounts = {};

  for (const doc of snap.docs) {
    const data = doc.data();
    const cat = data.category || "Other";
    const dept = DEPT_MAP[cat] || "Cleaning & Supplies";

    deptCounts[dept] = (deptCounts[dept] || 0) + 1;

    batch.update(doc.ref, { department: dept });
    count++;
    updated++;

    if (count >= 400) {
      await batch.commit();
      console.log(` Committed batch of ${count} updates...`);
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) {
    await batch.commit();
    console.log(` Committed final batch of ${count} updates...`);
  }

  console.log("\nDepartment counts:");
  console.log(JSON.stringify(deptCounts, null, 2));
  console.log(`\nSuccessfully updated ${updated} pantry items with departments!`);
}

tagDepartments().catch(e => {
  console.error("Tagging failed:", e);
  process.exit(1);
});
