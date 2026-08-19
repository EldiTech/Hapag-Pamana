/* HapagPamana · Backfill historical events (Excel catering log) into the
   live Firestore `bookings` collection, so forecast.html's existing
   naive-seasonal model (forecast-model.js) picks them up automatically
   through its normal loadBookings()/aggregate() pipeline — no forecast
   code changes needed, just more real history in the same collection.

   Source: clean_events_final.csv (333 events, Sep 2022 - Jun 2026),
   extracted and cleaned from "Copy of Copy of INTERNAL AND EXTERNAL
   ORDERS AND CATERING.xlsx" — see conversation history for the cleaning
   steps (typo'd/abbreviated dates parsed, "N pax"-style text summed to
   numeric Pax, exact duplicate rows across sheets removed, rich-text
   XML leak bug fixed).

   Every written doc gets:
     source: "excel_backfill_2022_2026"   — identifies these vs. real
                                             wizard-submitted bookings
     status: "completed"                  — these already happened;
                                             "declined"/pending make no
                                             sense for historical rows
     bookingType: "Catering"              — the Excel log is entirely
                                             catering/event bookings, no
                                             Food Pack orders in it
     paymentTotal: 0, paymentStatus: "none" — no real payment data exists
                                             for these; forecast-analysis's
                                             revenue metrics will read 0
                                             for backfilled rows rather
                                             than a fabricated amount
     createdAt: same as functionDate      — no real order-lead-time data
                                             exists; leadDays becomes 0
                                             for these rows rather than
                                             null (forecast-analysis.js
                                             should exclude source=
                                             excel_backfill_2022_2026 rows
                                             from any lead-time metric)

   Usage:
     npm install firebase-admin
     node backfill_bookings.js              # dry run — prints what would
                                             # be written, writes nothing
     node backfill_bookings.js --commit     # actually writes to Firestore

   Requires a service account key. Firebase Console → Project Settings →
   Service Accounts → Generate new private key → save as
   serviceAccountKey.json in this same folder (already gitignored below;
   NEVER commit this file — it's full admin access to the database). */
"use strict";

const fs = require("fs");
const path = require("path");

const CSV_PATH = path.join(__dirname, "clean_events_final.csv");
const KEY_PATH = path.join(__dirname, "serviceAccountKey.json");
const SOURCE_TAG = "excel_backfill_2022_2026";
const COMMIT = process.argv.includes("--commit");

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}

// Minimal CSV splitter for this file's shape (quoted fields, no embedded
// newlines inside a field — PowerShell's Export-Csv output).
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Matches the wizard's format so functionDate parses the same way
// forecast-data.js already parses every other row: Date.parse("June 12, 2026").
function toWizardDateString(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const months = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function isJunkName(name) {
  const t = (name || "").trim();
  if (!t) return true;
  if (/^-+$/.test(t)) return true; // "-----" placeholder rows
  if (/^(t|hcdrd)$/i.test(t)) return true; // known garbage entries found during cleaning
  return false;
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Missing ${CSV_PATH} — copy clean_events_final.csv here first.`);
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(CSV_PATH, "utf8"));

  const docs = [];
  const skipped = [];
  for (const row of rows) {
    const name = row.Name || "";
    if (isJunkName(name)) { skipped.push({ row, reason: "junk name" }); continue; }
    const wizardDate = toWizardDateString(row.Date);
    if (!wizardDate) { skipped.push({ row, reason: "unparseable date" }); continue; }

    const paxNum = Number(row.Pax);
    const pax = Number.isFinite(paxNum) && paxNum > 0 ? String(paxNum) : "";

    docs.push({
      functionDate: wizardDate,
      createdAt: new Date(wizardDate + " 00:00:00"), // same calendar day as functionDate, local time — see header note on leadDays
      bookingType: "Catering",
      kindOfFunction: name.trim(),
      package: "",
      pax,
      venue: "",
      status: "completed",
      paymentStatus: "none",
      paymentTotal: 0,
      packageTotal: 0,
      addOnsTotal: 0,
      deleted: false,
      source: SOURCE_TAG,
      sourceRow: { sheet: row.Source, originalName: name },
    });
  }

  console.log(`Parsed ${rows.length} CSV rows -> ${docs.length} docs to write, ${skipped.length} skipped.`);
  if (skipped.length) {
    console.log("\nSkipped rows:");
    skipped.forEach((s) => console.log(`  [${s.reason}]`, JSON.stringify(s.row)));
  }
  console.log("\nFirst 5 docs that would be written:");
  docs.slice(0, 5).forEach((d) => console.log(JSON.stringify(d, null, 2)));

  if (!COMMIT) {
    console.log(`\nDry run only — no writes made. Re-run with --commit to write ${docs.length} docs to Firestore 'bookings'.`);
    return;
  }

  if (!fs.existsSync(KEY_PATH)) {
    console.error(`\n--commit requires ${KEY_PATH} (Firebase service account key). See header comment for how to get one.`);
    process.exit(1);
  }

  const { initializeApp, cert } = require("firebase-admin/app");
  const { getFirestore, Timestamp } = require("firebase-admin/firestore");
  initializeApp({ credential: cert(require(KEY_PATH)) });
  const db = getFirestore();

  (async () => {
    const batchSize = 400; // Firestore batch limit is 500
    let written = 0;
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + batchSize);
      chunk.forEach((d) => {
        const ref = db.collection("bookings").doc();
        batch.set(ref, {
          ...d,
          createdAt: Timestamp.fromDate(d.createdAt),
        });
      });
      await batch.commit();
      written += chunk.length;
      console.log(`Committed ${written}/${docs.length}`);
    }
    console.log(`Done. Wrote ${written} docs tagged source="${SOURCE_TAG}".`);
  })().catch((err) => {
    console.error("Write failed:", err);
    process.exit(1);
  });
}

main();
