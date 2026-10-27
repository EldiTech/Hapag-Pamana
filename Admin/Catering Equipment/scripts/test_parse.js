"use strict";

const fs = require("fs");
const path = require("path");

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function parseCSVLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCSV(content) {
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  return lines.map(parseCSVLine);
}

// Build the clean inventory from the two files
function buildInventory() {
  const eqLines = parseCSV(fs.readFileSync(path.join(__dirname, "equipment_raw.csv"), "utf8"));
  const lnLines = parseCSV(fs.readFileSync(path.join(__dirname, "linen_raw.csv"), "utf8"));

  const categories = [];

  function getCat(name) {
    let cat = categories.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (!cat) {
      cat = { name, items: [] };
      categories.push(cat);
    }
    return cat;
  }

  function addItem(catName, itemName, variants, note = "") {
    const cat = getCat(catName);
    let item = cat.items.find(it => it.name.toLowerCase() === itemName.toLowerCase());
    if (!item) {
      item = { name: itemName, note, variants: [] };
      cat.items.push(item);
    }
    if (note && !item.note) item.note = note;
    variants.forEach(v => {
      let existing = item.variants.find(x => x.label.toLowerCase() === v.label.toLowerCase());
      if (existing) {
        existing.qty += v.qty;
      } else {
        item.variants.push({
          id: uid(),
          label: v.label,
          unit: v.unit || "pcs",
          qty: Math.max(0, Number(v.qty) || 0),
          par: null,
          remarks: v.remarks || ""
        });
      }
    });
  }

  /* -------------------------------------------------------------
     PARSE EQUIPMENT CSV
     ------------------------------------------------------------- */
  let currentSection = "PLATES";
  let parentItem = null;

  for (let i = 1; i < eqLines.length; i++) {
    const [col0, col1, col2, col3] = eqLines[i];
    if (!col0 && !col2) continue;

    const u0 = col0 ? col0.toUpperCase() : "";
    if (u0 === "PLATES" || u0 === "GLASS" || u0 === "CUTLERIES" || u0 === "LEGACY" ||
        u0.startsWith("ELECTRICAL") || u0.startsWith("TABLES AND CHAIRS") ||
        u0 === "CHARGER PLATES" || u0.startsWith("CONDIMENTS") || u0 === "SERVING GEARS" ||
        u0 === "SANGKALAN" || u0 === "SERVING GEAR UNDERLINERS" ||
        u0.startsWith("PITCHERS") || u0.startsWith("SERVING TRAYS") ||
        u0 === "OTHERS" || u0 === "FOOD TASTING GEARS") {
      currentSection = u0;
      parentItem = null;
      continue;
    }

    if (u0 === "OTHERS:") {
      parentItem = null;
      continue;
    }

    // Check if this row is a parent item header (qty is empty, col1 is empty or header)
    const isHeaderRow = (col2 === "" || col2 === undefined) && (col1 === "" || col1 === undefined || col1.includes("TOTAL"));

    if (isHeaderRow) {
      if (col0) parentItem = col0;
      continue;
    }

    // Parse numeric qty (using 2026 INVENTORY col2, fallback to col1)
    let qty = 0;
    if (col2 !== "" && col2 !== undefined && !isNaN(Number(col2))) {
      qty = Math.max(0, parseInt(col2, 10));
    } else if (col1 !== "" && col1 !== undefined && !isNaN(Number(col1))) {
      qty = Math.max(0, parseInt(col1, 10));
    }

    const remarks = col3 || "";

    // Route by section
    if (currentSection === "PLATES") {
      const cat = "Plates & Dinnerware";
      if (parentItem && ["DINNER PLATE", "BREAKFAST PLATE", "SALAD PLATE"].includes(parentItem.toUpperCase())) {
        const pName = parentItem === "DINNER PLATE" ? "Dinner Plate" :
                      parentItem === "BREAKFAST PLATE" ? "Breakfast Plate" : "Salad Plate";
        addItem(cat, pName, [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("wooden salad bowl")) {
        const lbl = col0.includes("(M)") ? "Medium (M)" : "Big (BIG)";
        addItem(cat, "Wooden Salad Bowl", [{ label: lbl, qty, remarks }]);
      } else if (col0.toLowerCase().startsWith("casserole")) {
        let lbl = "Standard";
        if (col0.includes("Oval")) lbl = "Oval";
        else if (col0.includes("Square")) lbl = "Square";
        else if (col0.includes("Rectangular")) lbl = "Rectangular w/ Iron Stand";
        addItem(cat, "Casserole", [{ label: lbl, qty, remarks }]);
      } else if (col0.toLowerCase().includes("colored plate for fruits")) {
        const lbl = col0.includes("(Old)") ? "Old" : "Blue";
        addItem(cat, "Fruit & Brownie Plate w/ Stand", [{ label: lbl, qty, remarks }]);
      } else {
        addItem(cat, col0, [{ label: "Standard", qty, remarks }]);
      }
    } else if (currentSection === "GLASS") {
      const cat = "Glassware & Drinkware";
      if (parentItem === "WATER GOBLET") {
        addItem(cat, "Water Goblet", [{ label: col0, qty, remarks }]);
      } else if (parentItem === "JUICE GLASS") {
        addItem(cat, "Juice Glass", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("wine")) {
        const lbl = col0.includes("New") ? "New (From Atty Dawn)" : "Standard";
        addItem(cat, "Wine Glass", [{ label: lbl, qty, remarks }]);
      } else {
        addItem(cat, col0, [{ label: "Standard", qty, remarks }]);
      }
    } else if (currentSection === "CUTLERIES") {
      const cat = "Cutleries";
      if (parentItem && parentItem.toLowerCase() === "silver") {
        addItem(cat, "Silver Cutlery", [{ label: col0, qty, remarks }]);
      } else if (parentItem && parentItem.toLowerCase() === "gold") {
        addItem(cat, "Gold Cutlery", [{ label: col0, qty, remarks }]);
      } else {
        addItem(cat, "Specialty Cutlery", [{ label: col0, qty, remarks }]);
      }
    } else if (currentSection === "LEGACY") {
      addItem("Chafing Dishes & Food Warmers", "Chafing Dish (Legacy)", [{ label: col0, qty, remarks }]);
    } else if (currentSection.startsWith("ELECTRICAL")) {
      const cat = "Cooking & Electrical Equipment";
      if (col0.toLowerCase().includes("slow cooker")) {
        const lbl = col0.toLowerCase().includes("small") ? "Small" : (remarks.includes("Old") ? "Big (Old)" : "Big (New)");
        addItem(cat, "Slow Cooker", [{ label: lbl, qty, remarks }]);
      } else if (col0.toLowerCase().includes("buffet food heating lamp")) {
        const lbl = col0.toLowerCase().includes("new") ? "New" : "Old";
        addItem(cat, "Buffet Food Heating Lamp", [{ label: lbl, qty, remarks }]);
      } else if (col0.toLowerCase().includes("extension")) {
        let lbl = "Standard (White)";
        if (col0.toLowerCase().includes("black")) lbl = "Black";
        else if (col0.toLowerCase().includes("small")) lbl = "Heavy Duty (Small)";
        else if (col0.toLowerCase().includes("big")) lbl = "Heavy Duty (Big)";
        addItem(cat, "Extension Cords", [{ label: lbl, qty, remarks }]);
      } else {
        addItem(cat, col0, [{ label: "Standard", qty, remarks }]);
      }
    } else if (currentSection.startsWith("TABLES AND CHAIRS")) {
      const cat = "Tables & Chairs";
      if (col0.toLowerCase().includes("round table")) {
        const lbl = col0.includes("black") ? "Black" : (col0.includes("brown") ? "Brown" : "Life Time");
        addItem(cat, "Round Tables", [{ label: lbl, qty, remarks }]);
      } else if (col0.toLowerCase().includes("square table")) {
        let lbl = "Old w/ Stand";
        if (col0.includes("Rubber")) lbl = "Black w/ Rubber";
        else if (col0.includes("Big")) lbl = "Big (New)";
        addItem(cat, "Square Tables", [{ label: lbl, qty, remarks }]);
      } else if (col0.toLowerCase().includes("lifetime") || col0.toLowerCase().includes("long table")) {
        addItem(cat, "Long & Lifetime Tables", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("sofa")) {
        addItem(cat, "Lounge Sofas", [{ label: col0, qty, remarks }]);
      } else if (col0.includes("(9 Gold/ Black)")) {
        addItem(cat, "Banquet & Dining Chairs", [{ label: "Cocktail / Bar Stools (Gold/Black & Black/White)", qty, remarks }]);
      } else {
        addItem(cat, "Banquet & Dining Chairs", [{ label: col0, qty, remarks }]);
      }
    } else if (currentSection === "CHARGER PLATES") {
      addItem("Charger Plates", "Charger Plate", [{ label: col0, qty, remarks }]);
    } else if (currentSection.startsWith("CONDIMENTS")) {
      const cat = "Condiments & Sauce Bowls";
      if (col0.toLowerCase().includes("jar")) {
        addItem(cat, "Condiment Jars", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("ramekin")) {
        addItem(cat, "Ramekins", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("sauce bowl") || col0.toLowerCase().includes("bowl")) {
        addItem(cat, "Sauce Bowls", [{ label: col0, qty, remarks }]);
      } else {
        addItem(cat, col0, [{ label: "Standard", qty, remarks }]);
      }
    } else if (currentSection === "SERVING GEARS") {
      const cat = "Serving Gears & Kitchen Tools";
      if (col0.toLowerCase().includes("serving spoon")) {
        addItem(cat, "Serving Spoon", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("tong") || col0.toLowerCase().includes("tweezer")) {
        addItem(cat, "Serving Tongs", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("ladle")) {
        addItem(cat, "Serving Ladles", [{ label: col0, qty, remarks }]);
      } else if (col0.toLowerCase().includes("knife") || col0.toLowerCase().includes("slicer")) {
        addItem(cat, "Kitchen Knives & Slicers", [{ label: col0, qty, remarks }]);
      } else {
        addItem(cat, col0, [{ label: "Standard", qty, remarks }]);
      }
    } else if (currentSection === "SANGKALAN") {
      addItem("Chopping Boards (Sangkalan)", "Chopping Board", [{ label: col0, qty, remarks }]);
    } else if (currentSection === "SUSHI BOAT") {
      addItem("Serving Gears & Kitchen Tools", "Sushi Boat", [{ label: "Standard", qty, remarks }]);
    } else if (currentSection === "SERVING GEAR UNDERLINERS") {
      addItem("Serving Gear Underliners", "Serving Gear Underliner", [{ label: col0, qty, remarks }]);
    } else if (currentSection.startsWith("PITCHERS")) {
      const cat = "Pitchers, Ice Buckets & Trays";
      if (col0.toLowerCase().includes("pitcher")) {
        addItem(cat, "Pitchers", [{ label: col0, qty, remarks }]);
      } else {
        addItem(cat, "Ice Buckets", [{ label: col0, qty, remarks }]);
      }
    } else if (currentSection.startsWith("SERVING TRAYS")) {
      addItem("Serving Trays & Stands", "Serving Trays & Stands", [{ label: col0, qty, remarks }]);
    } else if (currentSection === "OTHERS") {
      addItem("Staging & Event Gear", col0, [{ label: "Standard", qty, remarks }]);
    } else if (currentSection === "FOOD TASTING GEARS") {
      addItem("Food Tasting Gears", "Food Tasting Set", [{ label: col0, qty, remarks }]);
    }
  }

  /* -------------------------------------------------------------
     PARSE LINEN & DECOR CSV
     ------------------------------------------------------------- */
  let lnMainCat = "LINEN";
  let lnParent = null;
  let lastLinenColor = "";

  for (let i = 1; i < lnLines.length; i++) {
    const [col0, col1, col2, col3] = lnLines[i];
    const u0 = col0 ? col0.toUpperCase() : "";

    if (u0 === "LINEN") {
      lnMainCat = "Linens";
      lnParent = null;
      continue;
    }
    if (u0 === "DECOR") {
      lnMainCat = "Decors & Centerpieces";
      lnParent = null;
      continue;
    }

    // Skip empty lines with no qty and no name
    if (!col0 && !col2) continue;

    const isHeaderRow = (col2 === "" || col2 === undefined || col2 === null) &&
                        (col1 === "" || col1 === undefined || col1 === null || col1.includes("TOTAL"));

    if (isHeaderRow && col0) {
      lnParent = col0;
      continue;
    }

    let qty = 0;
    let unit = "pcs";
    if (col2 && col2.toLowerCase() === "set") {
      qty = 1;
      unit = "sets";
    } else if (col2 !== "" && col2 !== undefined && !isNaN(Number(col2))) {
      qty = Math.max(0, parseInt(col2, 10));
    } else if (col1 !== "" && col1 !== undefined && !isNaN(Number(col1))) {
      qty = Math.max(0, parseInt(col1, 10));
    }

    const remarks = col3 || "";

    if (lnMainCat === "Linens") {
      const cat = "Linens";
      let itemName = lnParent || "Linens";
      let variantLabel = col0;

      // Handle blank col0 (Additional Fabric)
      if (!variantLabel) {
        variantLabel = lastLinenColor ? `${lastLinenColor} (Additional Fabric)` : "Additional Fabric";
      } else {
        lastLinenColor = variantLabel.split(" -")[0].trim();
      }

      // Normalization of parent names in Linens
      if (itemName === "SQUARE W/PLEATS") itemName = "Square Tablecloth w/ Pleats";
      else if (itemName === "LONG W/PLEATS") itemName = "Long Tablecloth w/ Pleats";
      else if (itemName === "ROUND TABLE CLOTH") itemName = "Round Tablecloth";
      else if (itemName === "BUFFET TOPPER") itemName = "Buffet Topper";
      else if (itemName === "ROUND TOPPER") itemName = "Round Topper";
      else if (itemName === "RUNNER") itemName = "Table Runner";
      else if (itemName === "RIBBON") itemName = "Ribbon";
      else if (itemName === "CHAIR COVER") itemName = "Chair Cover";
      else if (itemName === "TABLE NAPKIN") itemName = "Table Napkin";
      else if (itemName === "Others:") itemName = "Fabrics, Curtains & Soft Tulle";

      addItem(cat, itemName, [{ label: variantLabel, qty, unit, remarks }]);
    } else {
      // Decors & Centerpieces
      const cat = "Decors & Centerpieces";
      let itemName = lnParent || "Decors";
      let variantLabel = col0;

      if (!variantLabel) continue;

      if (itemName === "LAMP/LIGHTS") itemName = "Lamps & Lighting";
      else if (itemName === "JAR") itemName = "Decorative Jars & Vases";
      else if (itemName === "BALL") itemName = "Decorative Balls";
      else if (itemName === "BACKDROP") itemName = "Backdrops & Neon Lights";
      else if (itemName === "For Centerpiece") itemName = "Centerpiece Props";
      else if (itemName === "For Buffet") itemName = "Buffet Decor Trees";
      else if (itemName === "Stand") itemName = "Event Stands & Numbers";
      else if (itemName === "Basket/Boxes/Carpet/etc") itemName = "Baskets, Boxes & Risers";
      else if (itemName === "For Linen") itemName = "Linen Care Equipment";
      else if (itemName === "Table Napkin Accessories") itemName = "Table Napkin Accessories";
      else if (itemName === "Others:") {
        if (col0.toLowerCase().includes("radio")) itemName = "Two-Way Radios";
        else if (["pillow", "stuff toy", "crochet", "dinosaur", "egg", "sungka"].some(x => col0.toLowerCase().includes(x))) {
          itemName = "Event Props & Toys";
        } else {
          itemName = "Candle Holders & Geometricals";
        }
      }

      addItem(cat, itemName, [{ label: variantLabel, qty, unit, remarks }]);
    }
  }

  return categories;
}

const cats = buildInventory();

console.log("=== INVENTORY PARSING SUMMARY ===");
console.log(`Total Categories: ${cats.length}`);
let totalItems = 0;
let totalVariants = 0;
let totalUnits = 0;

cats.forEach((c, idx) => {
  const vCount = c.items.reduce((s, it) => s + it.variants.length, 0);
  const qCount = c.items.reduce((s, it) => s + it.variants.reduce((q, v) => q + v.qty, 0), 0);
  totalItems += c.items.length;
  totalVariants += vCount;
  totalUnits += qCount;
  console.log(`${idx + 1}. [${c.name}]: ${c.items.length} items, ${vCount} variants, ${qCount} total pcs`);
});

console.log("----------------------------------");
console.log(`GRAND TOTAL: ${totalItems} items, ${totalVariants} variants, ${totalUnits} total quantity`);

module.exports = { buildInventory };
