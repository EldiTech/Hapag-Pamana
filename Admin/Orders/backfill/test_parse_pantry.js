"use strict";

const fs = require("fs");
const path = require("path");

// Robust CSV Line Parser that handles quoted cells with commas
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const rows = [];
  for (const line of lines) {
    const row = [];
    let inQuotes = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push(cell.trim());
        cell = "";
      } else {
        cell += c;
      }
    }
    row.push(cell.trim());
    rows.push(row);
  }
  return rows;
}

function parseDate(str) {
  if (!str) return null;
  const clean = str.replace(/["]/g, "").trim();
  if (!clean || clean.toUpperCase() === "NA" || clean.toUpperCase() === "NA." || clean === "-") return null;
  if (clean.includes("1899") || clean.includes("1900")) return null; // Excel zero-date artifacts

  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

function parseNum(val) {
  if (val === undefined || val === null) return null;
  const clean = String(val).replace(/["',]/g, "").trim();
  if (!clean || clean.toUpperCase() === "NA" || clean.toUpperCase() === "NA." || clean === "-" || clean === "---") return null;
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function cleanText(val) {
  if (!val) return "";
  return String(val).replace(/^["']|["']$/g, "").trim();
}

function buildPantryItems() {
  const csvPath = path.join(__dirname, "pantry_cleaned.csv");
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(raw);

  // Headers: CATEGORY,PRODUCT NAME,PRICE,UNIT,EXPIRY DATE,QUANTITY,IN,OUT,RUNNING TOTAL,DAMAGE
  const dataRows = rows.slice(1);
  const items = [];
  const skipped = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    let category = cleanText(r[0]);
    let name = cleanText(r[1]);
    const rawPrice = r[2];
    let unit = cleanText(r[3]);
    const rawExpiry = r[4];
    const rawQty = r[5];
    const rawIn = r[6];
    const rawOut = r[7];
    const rawRunning = r[8];

    // Check for accidental header rows in middle
    if (name.toUpperCase() === "PRODUCT" && unit.toUpperCase() === "UNIT") {
      skipped.push({ row: i + 2, reason: "Embedded header row" });
      continue;
    }

    if (!name || name.toUpperCase() === "NA") {
      skipped.push({ row: i + 2, reason: "Empty product name" });
      continue;
    }

    if (!category || category.toUpperCase() === "NA") {
      category = "Other";
    }

    if (!unit || unit.toUpperCase() === "NA" || unit === "---") {
      unit = "pcs";
    }

    const price = parseNum(rawPrice);
    const expiryDate = parseDate(rawExpiry);

    const runningNum = parseNum(rawRunning);
    const qtyNum = parseNum(rawQty);

    let qty = 0;
    if (runningNum !== null) {
      qty = Math.max(0, runningNum);
    } else if (qtyNum !== null) {
      qty = Math.max(0, qtyNum);
    }

    items.push({
      name,
      category,
      unit,
      price: price !== null && price >= 0 ? price : null,
      expiryDate,
      qty,
      par: null,
      note: "",
    });
  }

  return { items, skipped };
}

if (require.main === module) {
  const { items, skipped } = buildPantryItems();
  console.log(`Parsed ${items.length} items. Skipped ${skipped.length} invalid/header rows.`);
  
  const cats = {};
  items.forEach(it => { cats[it.category] = (cats[it.category] || 0) + 1; });
  console.log("\nCategories breakdown:", cats);

  const units = {};
  items.forEach(it => { units[it.unit] = (units[it.unit] || 0) + 1; });
  console.log("\nUnits breakdown:", units);

  const withPrice = items.filter(it => it.price !== null).length;
  const withExpiry = items.filter(it => it.expiryDate !== null).length;
  const withStock = items.filter(it => it.qty > 0).length;

  console.log(`\nMetrics:`);
  console.log(` - Items with price: ${withPrice}`);
  console.log(` - Items with expiry date: ${withExpiry}`);
  console.log(` - Items with stock > 0: ${withStock}`);

  console.log("\nSample 5 items:");
  items.slice(0, 5).forEach((it, idx) => console.log(`${idx + 1}.`, JSON.stringify(it)));
}

module.exports = { buildPantryItems, parseCSV, parseDate, parseNum };
