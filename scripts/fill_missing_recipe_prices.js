"use strict";

/*
 * One-time repair for recipe ingredients whose purchase-package price is 0 or
 * missing. Run without --apply first to inspect the planned changes.
 *
 *   node scripts/fill_missing_recipe_prices.js
 *   node scripts/fill_missing_recipe_prices.js --apply
 *
 * The script only changes the four explicitly listed ingredient names and only
 * when their existing packCost is not already a positive number.
 */

const fs = require("fs");
const path = require("path");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const ROOT = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

const PRICE_BY_INGREDIENT = new Map([
  ["Ideal Gourmet Spaghetti Pasta 1Kg", 115.5],
  ["Knorr Pork Broth Base 1.5kg", 814],
  ["Glutinous Rice Flour 500g", 55],
  ["Ideal Gourmet Squid Ink Pasta 500g", 162],
]);

function serviceAccountPath() {
  const configured = process.env.FIREBASE_SERVICE_ACCOUNT;
  const candidates = [
    configured && path.resolve(configured),
    path.join(ROOT, "hapagpamana-39687-firebase-adminsdk-fbsvc-ff6022e503.json"),
    path.join(ROOT, "Admin", "Orders", "backfill", "serviceAccountKey.json"),
  ].filter(Boolean);

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "No Firebase service-account JSON found. Set FIREBASE_SERVICE_ACCOUNT to its path."
    );
  }
  return found;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unitFamily(unit) {
  const normalized = String(unit || "").toLowerCase();
  if (["g", "kg"].includes(normalized)) return "mass";
  if (["ml", "l"].includes(normalized)) return "volume";
  return null;
}

function unitRatio(from, to) {
  const a = String(from || "").toLowerCase();
  const b = String(to || "").toLowerCase();
  if (a === b) return 1;

  const familyA = unitFamily(a);
  const familyB = unitFamily(b);
  if (!familyA || familyA !== familyB) return null;

  const factors = { g: 1, kg: 1000, ml: 1, l: 1000 };
  return factors[a] / factors[b];
}

function lineCost(ingredient) {
  const qty = number(ingredient.qty);
  const packCost = number(ingredient.packCost);
  const packSize = number(ingredient.packSize);
  if (!(qty > 0) || !(packCost > 0) || !(packSize > 0)) return 0;

  const ratio = unitRatio(ingredient.packUnit || ingredient.unit, ingredient.unit);
  if (ratio === null) return 0;

  return Math.ceil(qty * (packCost / (packSize * ratio)));
}

function recipeTotals(recipe, ingredients) {
  const totalCost = ingredients.reduce((sum, ingredient) => {
    return sum + lineCost(ingredient);
  }, 0);
  const portions = Math.round(number(recipe.portions) || 0);

  return {
    totalCost,
    perServing: portions > 0 && totalCost > 0
      ? Math.ceil(totalCost / portions)
      : null,
  };
}

async function main() {
  const keyPath = serviceAccountPath();
  if (!getApps().length) initializeApp({ credential: cert(require(keyPath)) });

  const db = getFirestore();
  const snapshot = await db.collection("recipes").get();
  const changes = [];

  for (const document of snapshot.docs) {
    const recipe = document.data() || {};
    const originalIngredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients
      : [];
    let changed = false;

    const ingredients = originalIngredients.map((ingredient) => {
      const name = String(ingredient.name || "").trim();
      const benchmark = PRICE_BY_INGREDIENT.get(name);
      const currentPackCost = number(ingredient.packCost);

      if (benchmark === undefined || currentPackCost > 0) {
        return { ...ingredient, cost: lineCost(ingredient) };
      }

      changed = true;
      return {
        ...ingredient,
        packCost: benchmark,
        cost: lineCost({ ...ingredient, packCost: benchmark }),
      };
    });

    if (!changed) continue;

    const totals = recipeTotals(recipe, ingredients);
    changes.push({
      id: document.id,
      name: recipe.name || document.id,
      ingredients,
      ...totals,
    });
  }

  console.log(`${APPLY ? "Applying" : "Planned"} ${changes.length} recipe updates.`);
  for (const change of changes) {
    const filled = change.ingredients
      .filter((ingredient) => PRICE_BY_INGREDIENT.has(String(ingredient.name || "").trim()))
      .map((ingredient) => `${ingredient.name} = ₱${ingredient.packCost}`)
      .join("; ");
    console.log(
      `- ${change.name}: ${filled} -> total ₱${change.totalCost}, per serving ₱${change.perServing}`
    );
  }

  if (!APPLY) {
    console.log("Dry run only. Re-run with --apply to write these changes.");
    return;
  }

  for (const change of changes) {
    await db.collection("recipes").doc(change.id).set({
      ingredients: change.ingredients,
      totalCost: change.totalCost,
      perServing: change.perServing,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "recipe-price-backfill",
    }, { merge: true });
  }

  console.log(`Updated ${changes.length} recipes successfully.`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
