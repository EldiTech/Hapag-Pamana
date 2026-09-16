"use strict";

const path = require("path");
const fs = require("fs");
const XLSX = require("C:/Users/Joshua/.gemini/antigravity-ide/brain/26fc2686-0694-4991-b23e-ce5c7b5b5c25/scratch/node_modules/xlsx");
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

/*
  We define clean, beautifully grouped categories and items.
  Every quantity matches the Excel sheets (Sheet '1-7 SEPTEMBER' in equipment.xlsx,
  and Sheet ' July 15-21, 2026' in linen.xlsx).
*/
function buildCleanInventory() {
  const categories = [
    {
      name: "Plates & Dinnerware",
      items: [
        {
          name: "Dinner Plate",
          variants: [
            { label: "White", qty: 177, unit: "pcs" },
            { label: "Old", qty: 413, unit: "pcs" },
            { label: "Gray", qty: 243, unit: "pcs" },
            { label: "Blue", qty: 136, unit: "pcs" },
            { label: "Green", qty: 211, unit: "pcs" }
          ]
        },
        {
          name: "Breakfast Plate",
          variants: [
            { label: "White", qty: 197, unit: "pcs" },
            { label: "Old", qty: 208, unit: "pcs" }
          ]
        },
        {
          name: "Salad Plate",
          variants: [
            { label: "White", qty: 198, unit: "pcs" },
            { label: "Old", qty: 116, unit: "pcs" },
            { label: "Blue", qty: 180, unit: "pcs" },
            { label: "Green", qty: 194, unit: "pcs" }
          ]
        },
        {
          name: "Wooden Salad Bowl",
          variants: [
            { label: "Medium (M)", qty: 4, unit: "pcs" },
            { label: "Big (BIG)", qty: 4, unit: "pcs" }
          ]
        },
        {
          name: "Casserole",
          variants: [
            { label: "Oval", qty: 5, unit: "pcs" },
            { label: "Square", qty: 4, unit: "pcs" },
            { label: "Rectangular (with iron stand)", qty: 9, unit: "pcs" }
          ]
        },
        {
          name: "Fruit & Brownie Plate w/ Stand",
          variants: [
            { label: "Old", qty: 2, unit: "pcs" },
            { label: "Blue", qty: 3, unit: "pcs" }
          ]
        },
        {
          name: "Rice Bowl w/ Lid",
          variants: [{ label: "Standard", qty: 370, unit: "pcs" }]
        },
        {
          name: "Bread and Butter Plate (Bnb)",
          variants: [{ label: "Standard", qty: 305, unit: "pcs" }]
        },
        {
          name: "Saucer (Coffee Underliner)",
          variants: [{ label: "Standard", qty: 592, unit: "pcs" }]
        },
        {
          name: "3D Plate for Kids",
          variants: [{ label: "Standard", qty: 60, unit: "pcs" }]
        },
        {
          name: "Canape Saucer",
          variants: [{ label: "Standard", qty: 50, unit: "pcs" }]
        },
        {
          name: "Rectangular Plate",
          variants: [{ label: "Standard", qty: 13, unit: "pcs" }]
        }
      ]
    },

    {
      name: "Glassware & Drinkware",
      items: [
        {
          name: "Water Goblet",
          variants: [
            { label: "Old", qty: 569, unit: "pcs" },
            { label: "Blue", qty: 180, unit: "pcs" },
            { label: "Green", qty: 135, unit: "pcs" },
            { label: "Gold", qty: 141, unit: "pcs" },
            { label: "Purple", qty: 138, unit: "pcs" }
          ]
        },
        {
          name: "Juice Glass",
          variants: [
            { label: "Old", qty: 649, unit: "pcs" },
            { label: "Blue", qty: 170, unit: "pcs" },
            { label: "Green", qty: 143, unit: "pcs" },
            { label: "Gold", qty: 143, unit: "pcs" },
            { label: "Purple", qty: 141, unit: "pcs" }
          ]
        },
        {
          name: "Wine Glass",
          variants: [
            { label: "Standard / Old", qty: 135, unit: "pcs" },
            { label: "New", qty: 134, unit: "pcs" }
          ]
        },
        {
          name: "Cups & Mugs",
          variants: [
            { label: "Coffee Cup", qty: 550, unit: "pcs" },
            { label: "Soup Cup", qty: 249, unit: "pcs" },
            { label: "Plastic Cup for Kids", qty: 60, unit: "pcs" }
          ]
        },
        {
          name: "Specialty Glassware",
          variants: [
            { label: "Champagne Gold Flute", qty: 98, unit: "pcs" },
            { label: "Shot Glass", qty: 488, unit: "pcs" },
            { label: "Ice Cream Cup", qty: 164, unit: "pcs" },
            { label: "Juice Jug", qty: 2, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Cutleries",
      items: [
        {
          name: "Silver Cutlery",
          variants: [
            { label: "Spoon", qty: 456, unit: "pcs" },
            { label: "Fork", qty: 615, unit: "pcs" },
            { label: "Knife", qty: 774, unit: "pcs" },
            { label: "Teaspoon", qty: 218, unit: "pcs" },
            { label: "Dessert Spoon", qty: 171, unit: "pcs" },
            { label: "Soup Spoon", qty: 187, unit: "pcs" },
            { label: "Salad Fork", qty: 193, unit: "pcs" },
            { label: "Salad Knife", qty: 134, unit: "pcs" },
            { label: "Old Spoon", qty: 229, unit: "pcs" },
            { label: "Old Fork", qty: 226, unit: "pcs" },
            { label: "Old Knife", qty: 233, unit: "pcs" },
            { label: "Older Spoon", qty: 139, unit: "pcs" },
            { label: "Older Fork", qty: 132, unit: "pcs" },
            { label: "Older Knife", qty: 67, unit: "pcs" }
          ]
        },
        {
          name: "Gold Cutlery",
          variants: [
            { label: "Spoon", qty: 342, unit: "pcs" },
            { label: "Fork", qty: 305, unit: "pcs" },
            { label: "Knife", qty: 362, unit: "pcs" },
            { label: "Dessert Spoon", qty: 100, unit: "pcs" },
            { label: "Dessert Fork", qty: 119, unit: "pcs" }
          ]
        },
        {
          name: "Specialty Spoons & Forks",
          variants: [
            { label: "Chinese Spoon", qty: 266, unit: "pcs" },
            { label: "Halo-Halo Long Spoon", qty: 93, unit: "pcs" },
            { label: "Cocktail / Fruit Fork", qty: 89, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Chafing Dishes & Food Warmers",
      items: [
        {
          name: "Chafing Dish (Legacy)",
          note: "Standard chafing dish units",
          variants: [
            { label: "Rectangular", qty: 24, unit: "pcs" },
            { label: "Oval", qty: 8, unit: "pcs" },
            { label: "Round", qty: 7, unit: "pcs" }
          ]
        },
        {
          name: "Soup Warmer",
          variants: [{ label: "Standard", qty: 5, unit: "pcs" }]
        },
        {
          name: "Buffet Food Heating Lamp",
          variants: [
            { label: "New", qty: 6, unit: "pcs" },
            { label: "Old", qty: 5, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Cooking & Electrical Equipment",
      items: [
        {
          name: "Slow Cooker",
          variants: [
            { label: "Big", qty: 4, unit: "pcs" },
            { label: "Small", qty: 3, unit: "pcs" }
          ]
        },
        {
          name: "Extension Cords",
          variants: [
            { label: "Standard", qty: 22, unit: "pcs" },
            { label: "Heavy Duty (Small)", qty: 2, unit: "pcs" },
            { label: "Heavy Duty (Big)", qty: 1, unit: "pcs" },
            { label: "Black", qty: 7, unit: "pcs" }
          ]
        },
        {
          name: "Cooking Appliances",
          variants: [
            { label: "Kettle", qty: 5, unit: "pcs" },
            { label: "Panini Press", qty: 1, unit: "pcs" },
            { label: "Induction Cooker", qty: 2, unit: "pcs" },
            { label: "Percolator", qty: 9, unit: "pcs" },
            { label: "Non-Stick Pan", qty: 1, unit: "pcs" },
            { label: "Food Steamer", qty: 1, unit: "pcs" },
            { label: "Bread Conveyor", qty: 1, unit: "pcs" },
            { label: "Ice Crusher", qty: 1, unit: "pcs" }
          ]
        },
        {
          name: "Event Electrical Gear",
          variants: [
            { label: "Buffet Lights Display", qty: 18, unit: "pcs" },
            { label: "Spot Light", qty: 2, unit: "pcs" },
            { label: "Toyohama Generator", qty: 2, unit: "pcs" },
            { label: "Juice Dispenser Set", qty: 0, unit: "sets" }
          ]
        }
      ]
    },

    {
      name: "Tables & Chairs",
      items: [
        {
          name: "Round Tables",
          variants: [
            { label: "Black", qty: 10, unit: "pcs" },
            { label: "Brown", qty: 15, unit: "pcs" },
            { label: "Lifetime Round", qty: 10, unit: "pcs" },
            { label: "Cocktail Table", qty: 5, unit: "pcs" }
          ]
        },
        {
          name: "Square Tables",
          variants: [
            { label: "Old w/ Stand", qty: 13, unit: "pcs" },
            { label: "Black w/ Rubber", qty: 14, unit: "pcs" },
            { label: "Big", qty: 25, unit: "pcs" }
          ]
        },
        {
          name: "Long & Lifetime Tables",
          variants: [
            { label: "Lifetime (Small)", qty: 6, unit: "pcs" },
            { label: "Lifetime (Big)", qty: 7, unit: "pcs" },
            { label: "Kiddie Lifetime", qty: 15, unit: "pcs" },
            { label: "Kiddie Long Table", qty: 3, unit: "pcs" },
            { label: "Infinity Long Table", qty: 5, unit: "pcs" }
          ]
        },
        {
          name: "Banquet & Dining Chairs",
          variants: [
            { label: "Monoblock Chair", qty: 214, unit: "pcs" },
            { label: "Cross Back Chair w/ Foam", qty: 100, unit: "pcs" },
            { label: "Infinity Chair", qty: 200, unit: "pcs" },
            { label: "Infinity Chair Foam", qty: 196, unit: "pcs" },
            { label: "Tiffany Chair (Gold/Black)", qty: 9, unit: "pcs" },
            { label: "Tiffany Chair (Black/White)", qty: 7, unit: "pcs" },
            { label: "Kiddie Chair", qty: 60, unit: "pcs" },
            { label: "Glass Chair", qty: 2, unit: "pcs" }
          ]
        },
        {
          name: "Lounge Sofas",
          variants: [
            { label: "Couple Seater", qty: 1, unit: "pcs" },
            { label: "Single Seater", qty: 2, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Charger Plates",
      items: [
        {
          name: "Charger Plate",
          note: "Underplates for event table setups",
          variants: [
            { label: "Gold (old)", qty: 108, unit: "pcs" },
            { label: "Gold (new)", qty: 80, unit: "pcs" },
            { label: "Stripe Gold (Old)", qty: 42, unit: "pcs" },
            { label: "Silver", qty: 28, unit: "pcs" },
            { label: "Clear", qty: 139, unit: "pcs" },
            { label: "Black", qty: 38, unit: "pcs" },
            { label: "Black (new)", qty: 75, unit: "pcs" },
            { label: "Rattan (small)", qty: 40, unit: "pcs" },
            { label: "Rattan (big)", qty: 10, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Condiments & Sauce Bowls",
      items: [
        {
          name: "Condiment Jars",
          variants: [
            { label: "Sugar Jar", qty: 10, unit: "pcs" },
            { label: "Milk Jar", qty: 6, unit: "pcs" },
            { label: "Gravy Jar", qty: 7, unit: "pcs" }
          ]
        },
        {
          name: "Ramekins",
          variants: [
            { label: "Standard (White)", qty: 765, unit: "pcs" },
            { label: "Medium (Old)", qty: 24, unit: "pcs" },
            { label: "Colored", qty: 129, unit: "pcs" }
          ]
        },
        {
          name: "Sauce Bowls",
          variants: [
            { label: "White", qty: 79, unit: "pcs" },
            { label: "White (Old)", qty: 1, unit: "pcs" },
            { label: "Big", qty: 4, unit: "pcs" },
            { label: "Oval", qty: 2, unit: "pcs" },
            { label: "Square (Printed)", qty: 3, unit: "pcs" },
            { label: "Red", qty: 1, unit: "pcs" },
            { label: "Black", qty: 1, unit: "pcs" },
            { label: "Teal", qty: 0, unit: "pcs" }
          ]
        },
        {
          name: "Soy Dish",
          variants: [{ label: "Standard", qty: 333, unit: "pcs" }]
        }
      ]
    },

    {
      name: "Serving Gears & Kitchen Tools",
      items: [
        {
          name: "Serving Spoon",
          variants: [
            { label: "Newest", qty: 12, unit: "pcs" },
            { label: "New", qty: 12, unit: "pcs" },
            { label: "Old", qty: 13, unit: "pcs" }
          ]
        },
        {
          name: "Serving Tongs",
          variants: [
            { label: "Big (Old)", qty: 12, unit: "pcs" },
            { label: "Big (New)", qty: 14, unit: "pcs" },
            { label: "Small (Old)", qty: 29, unit: "pcs" },
            { label: "Mid (Old)", qty: 0, unit: "pcs" },
            { label: "Fruit Tong", qty: 4, unit: "pcs" },
            { label: "Pasta Tong", qty: 4, unit: "pcs" },
            { label: "Ice Tong", qty: 6, unit: "pcs" },
            { label: "Tweezer (New)", qty: 5, unit: "pcs" }
          ]
        },
        {
          name: "Serving Ladles",
          variants: [
            { label: "Soup Ladle (Small)", qty: 2, unit: "pcs" },
            { label: "Soup Ladle (Medium)", qty: 3, unit: "pcs" },
            { label: "Soup Ladle (Old Big)", qty: 3, unit: "pcs" },
            { label: "Sauce Ladle", qty: 4, unit: "pcs" },
            { label: "Sauce Ladle (Old)", qty: 4, unit: "pcs" }
          ]
        },
        {
          name: "Kitchen Knives & Slicers",
          variants: [
            { label: "Chef Knife", qty: 5, unit: "pcs" },
            { label: "Cleaver Knife", qty: 5, unit: "pcs" },
            { label: "Santoku Knife", qty: 1, unit: "pcs" },
            { label: "Roastbeef Knife", qty: 1, unit: "pcs" },
            { label: "Roastbeef Fork", qty: 2, unit: "pcs" },
            { label: "Cake Slicer", qty: 6, unit: "pcs" },
            { label: "Pizza Slicer", qty: 0, unit: "pcs" }
          ]
        },
        {
          name: "Kitchen Tools & Scoopers",
          variants: [
            { label: "Food Cover", qty: 95, unit: "pcs" },
            { label: "Ice Scooper", qty: 1, unit: "pcs" },
            { label: "Ice Cream Scooper", qty: 4, unit: "pcs" },
            { label: "Honey Comb Stick", qty: 3, unit: "pcs" },
            { label: "Spatula", qty: 3, unit: "pcs" },
            { label: "Rice Cup", qty: 1, unit: "pcs" },
            { label: "Sushi Boat", qty: 2, unit: "pcs" }
          ]
        },
        {
          name: "Chopping Board (Sangkalan)",
          variants: [
            { label: "Wooden Rectangular (Long)", qty: 10, unit: "pcs" },
            { label: "Wooden Rectangular w/ Handle", qty: 4, unit: "pcs" },
            { label: "Wooden Round w/ Handle", qty: 1, unit: "pcs" },
            { label: "Rectangular w/ FAH Logo", qty: 5, unit: "pcs" },
            { label: "Brown Cooked Meat Board", qty: 2, unit: "pcs" },
            { label: "Flat Wooden Round Sangkalan", qty: 2, unit: "pcs" }
          ]
        },
        {
          name: "Serving Gear Underliners",
          variants: [
            { label: "Tear Drop Underliner", qty: 10, unit: "pcs" },
            { label: "Black Underliner", qty: 7, unit: "pcs" },
            { label: "White Underliner", qty: 9, unit: "pcs" },
            { label: "Grey Underliner", qty: 9, unit: "pcs" },
            { label: "Wooden Underliner", qty: 10, unit: "pcs" },
            { label: "Ceramic Plate (Small)", qty: 9, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Pitchers, Ice Buckets & Trays",
      items: [
        {
          name: "Pitchers",
          variants: [
            { label: "Big", qty: 17, unit: "pcs" },
            { label: "Tall", qty: 8, unit: "pcs" },
            { label: "Small", qty: 3, unit: "pcs" },
            { label: "Glass Pitcher", qty: 2, unit: "pcs" }
          ]
        },
        {
          name: "Ice Buckets",
          variants: [
            { label: "Big w/ Stand", qty: 1, unit: "pcs" },
            { label: "Small", qty: 4, unit: "pcs" }
          ]
        },
        {
          name: "Serving Trays & Stands",
          variants: [
            { label: "Bar Tray", qty: 23, unit: "pcs" },
            { label: "Bar Tray (Stainless)", qty: 2, unit: "pcs" },
            { label: "Oval Tray", qty: 9, unit: "pcs" },
            { label: "JackStand", qty: 11, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Staging & Event Gear",
      items: [
        {
          name: "Crowd Control & Staging",
          variants: [
            { label: "Stanchion", qty: 28, unit: "pcs" },
            { label: "Stage Platform", qty: 1, unit: "pcs" },
            { label: "Partition", qty: 5, unit: "pcs" },
            { label: "Cladding Wall Backdrop Set", qty: 1, unit: "sets" },
            { label: "Wooden Backdrop", qty: 2, unit: "pcs" },
            { label: "FAH Logo", qty: 1, unit: "pcs" }
          ]
        },
        {
          name: "Logistics Gear",
          variants: [
            { label: "Push Cart (500kg)", qty: 2, unit: "pcs" },
            { label: "Push Cart (200kg)", qty: 2, unit: "pcs" },
            { label: "Cooler (Big)", qty: 4, unit: "pcs" },
            { label: "Cooler (Small)", qty: 5, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Food Tasting Gears",
      items: [
        {
          name: "Food Tasting Plates & Drinkware",
          variants: [
            { label: "Dinner Plate", qty: 12, unit: "pcs" },
            { label: "Juice Glass", qty: 111, unit: "pcs" },
            { label: "Pitcher", qty: 2, unit: "pcs" },
            { label: "Rattan Soft", qty: 6, unit: "pcs" },
            { label: "Sauce Bowl Grey", qty: 3, unit: "pcs" },
            { label: "Ceramic Serving Underliner", qty: 14, unit: "pcs" }
          ]
        },
        {
          name: "Food Tasting Cutlery",
          variants: [
            { label: "Spoon", qty: 13, unit: "pcs" },
            { label: "Fork", qty: 16, unit: "pcs" },
            { label: "Knife", qty: 11, unit: "pcs" }
          ]
        },
        {
          name: "VIP Tasting Plates",
          variants: [
            { label: "VIP Salad Plate", qty: 7, unit: "pcs" },
            { label: "VIP Pasta Plate", qty: 17, unit: "pcs" },
            { label: "VIP Canape Plate", qty: 5, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Linens",
      items: [
        {
          name: "Square Tablecloth w/ Pleats",
          note: "Square tablecloth with pleats for catering tables",
          variants: [
            { label: "Black", qty: 13, unit: "pcs" },
            { label: "Baby Pink", qty: 15, unit: "pcs" },
            { label: "Brown", qty: 15, unit: "pcs" },
            { label: "Cream", qty: 14, unit: "pcs" },
            { label: "Cream (for Kiddie Table)", qty: 15, unit: "pcs" },
            { label: "Emerald Green", qty: 7, unit: "pcs" },
            { label: "Gold", qty: 7, unit: "pcs" },
            { label: "Purple", qty: 16, unit: "pcs" },
            { label: "Peach", qty: 13, unit: "pcs" },
            { label: "Royal Blue", qty: 13, unit: "pcs" },
            { label: "Silver", qty: 5, unit: "pcs" },
            { label: "Sage Green", qty: 40, unit: "pcs" },
            { label: "White", qty: 52, unit: "pcs" }
          ]
        },
        {
          name: "Long Tablecloth w/ Pleats",
          variants: [
            { label: "Black", qty: 3, unit: "pcs" },
            { label: "Cream", qty: 4, unit: "pcs" },
            { label: "White", qty: 15, unit: "pcs" }
          ]
        },
        {
          name: "Round Tablecloth",
          variants: [
            { label: "Black", qty: 28, unit: "pcs" },
            { label: "Brown", qty: 12, unit: "pcs" },
            { label: "Cream", qty: 22, unit: "pcs" },
            { label: "Emerald Green", qty: 20, unit: "pcs" },
            { label: "Gold", qty: 21, unit: "pcs" },
            { label: "Mint Green (Embroidered)", qty: 21, unit: "pcs" },
            { label: "Purple", qty: 25, unit: "pcs" },
            { label: "Peach", qty: 12, unit: "pcs" },
            { label: "Royal Blue", qty: 25, unit: "pcs" },
            { label: "Sage Green", qty: 30, unit: "pcs" },
            { label: "Silk Blue", qty: 10, unit: "pcs" },
            { label: "White", qty: 16, unit: "pcs" }
          ]
        },
        {
          name: "Buffet Topper",
          variants: [
            { label: "Apple Green", qty: 12, unit: "pcs" },
            { label: "Baby Pink", qty: 23, unit: "pcs" },
            { label: "Black", qty: 3, unit: "pcs" },
            { label: "Gold", qty: 9, unit: "pcs" },
            { label: "Gold (Embroidered)", qty: 5, unit: "pcs" },
            { label: "Leafy Green", qty: 10, unit: "pcs" },
            { label: "Midnight Blue", qty: 8, unit: "pcs" },
            { label: "Mint Green (Embroidered)", qty: 9, unit: "pcs" },
            { label: "Purple (Embroidered)", qty: 3, unit: "pcs" },
            { label: "Red (Embroidered)", qty: 7, unit: "pcs" },
            { label: "Silk Blue", qty: 10, unit: "pcs" },
            { label: "Silk Pink", qty: 14, unit: "pcs" },
            { label: "Silver", qty: 8, unit: "pcs" }
          ]
        },
        {
          name: "Round Topper",
          variants: [
            { label: "Apple Green", qty: 10, unit: "pcs" },
            { label: "Black", qty: 17, unit: "pcs" },
            { label: "Gold", qty: 18, unit: "pcs" },
            { label: "Gold (Embroidered)", qty: 16, unit: "pcs" },
            { label: "Leafy Green", qty: 10, unit: "pcs" },
            { label: "Midnight Blue", qty: 10, unit: "pcs" },
            { label: "Silk Pink", qty: 10, unit: "pcs" }
          ]
        },
        {
          name: "Table Runner",
          variants: [
            { label: "Apple Green", qty: 27, unit: "pcs" },
            { label: "Orange", qty: 12, unit: "pcs" },
            { label: "Red", qty: 10, unit: "pcs" },
            { label: "Native (Old)", qty: 20, unit: "pcs" },
            { label: "Native (New)", qty: 20, unit: "pcs" }
          ]
        },
        {
          name: "Ribbon",
          variants: [
            { label: "Gold", qty: 215, unit: "pcs" },
            { label: "Midnight Blue", qty: 100, unit: "pcs" },
            { label: "Silk Blue", qty: 100, unit: "pcs" },
            { label: "Silver", qty: 100, unit: "pcs" }
          ]
        },
        {
          name: "Chair Cover",
          variants: [
            { label: "Black", qty: 300, unit: "pcs" },
            { label: "White", qty: 281, unit: "pcs" }
          ]
        },
        {
          name: "Table Napkin",
          note: "Cloth napkins for guest table setups",
          variants: [
            { label: "Black (old)", qty: 128, unit: "pcs" },
            { label: "Black (thick)", qty: 75, unit: "pcs" },
            { label: "Black (new)", qty: 487, unit: "pcs" },
            { label: "Burgundy Red", qty: 196, unit: "pcs" },
            { label: "Brown", qty: 104, unit: "pcs" },
            { label: "Cream (old)", qty: 44, unit: "pcs" },
            { label: "Cream (new)", qty: 183, unit: "pcs" },
            { label: "Dark Sage Green", qty: 128, unit: "pcs" },
            { label: "Light Sage Green", qty: 104, unit: "pcs" },
            { label: "Royal Blue", qty: 157, unit: "pcs" },
            { label: "White (old)", qty: 78, unit: "pcs" },
            { label: "White (new)", qty: 390, unit: "pcs" },
            { label: "Native", qty: 23, unit: "pcs" }
          ]
        },
        {
          name: "Fabrics, Curtains & Soft Tulle",
          variants: [
            { label: "Pillowcase", qty: 35, unit: "pcs" },
            { label: "Soft Tulle (White)", qty: 1, unit: "sets" },
            { label: "Soft Tulle (Pink and Peach)", qty: 1, unit: "sets" },
            { label: "Soft Tulle (Sage Green)", qty: 1, unit: "sets" },
            { label: "Emerald Green Velvet", qty: 2, unit: "pcs" },
            { label: "Gray Curtain", qty: 16, unit: "pcs" },
            { label: "White Curtain / Tulle", qty: 27, unit: "pcs" },
            { label: "Food Cover (Fabric)", qty: 4, unit: "pcs" }
          ]
        }
      ]
    },

    {
      name: "Decors & Centerpieces",
      items: [
        {
          name: "Lamps & Lights",
          variants: [
            { label: "Gold Lamp (set)", qty: 10, unit: "sets" },
            { label: "Cream Lamp", qty: 6, unit: "pcs" },
            { label: "Gray Lamp", qty: 3, unit: "pcs" },
            { label: "Flameless Mood LED Candle", qty: 3, unit: "pcs" },
            { label: "Bamboo Lamp Set", qty: 2, unit: "sets" },
            { label: "Lamp w/ Gold Candle Holder", qty: 7, unit: "pcs" },
            { label: "Lighthouse w/ Candle", qty: 20, unit: "pcs" },
            { label: "White Lamp (New)", qty: 20, unit: "pcs" },
            { label: "Bamboo Lamp", qty: 6, unit: "pcs" },
            { label: "Native Lampshade (Small)", qty: 3, unit: "pcs" },
            { label: "Standing Lamp (Wood)", qty: 2, unit: "pcs" }
          ]
        },
        {
          name: "Jars & Vases",
          variants: [
            { label: "Native Bottles", qty: 14, unit: "pcs" },
            { label: "White Jar", qty: 17, unit: "pcs" },
            { label: "Clear Jar", qty: 11, unit: "pcs" },
            { label: "Cylinder Jar (Old)", qty: 8, unit: "pcs" },
            { label: "Cylinder Jar (New)", qty: 43, unit: "pcs" },
            { label: "Mini Jar", qty: 54, unit: "pcs" },
            { label: "Jar from Ms A", qty: 17, unit: "pcs" },
            { label: "Square Jar", qty: 9, unit: "pcs" },
            { label: "String Jar", qty: 25, unit: "pcs" },
            { label: "Assorted Jar", qty: 12, unit: "pcs" },
            { label: "Tall Jar", qty: 8, unit: "pcs" },
            { label: "Coffee Jar", qty: 8, unit: "pcs" }
          ]
        },
        {
          name: "Decorative Balls",
          variants: [
            { label: "Wire Ball", qty: 17, unit: "pcs" },
            { label: "Capiz Ball", qty: 40, unit: "pcs" },
            { label: "Native Ball", qty: 13, unit: "pcs" }
          ]
        },
        {
          name: "Backdrop & Ambient Lights",
          variants: [
            { label: "Christmas Light", qty: 1, unit: "pcs" },
            { label: "Fiesta Light", qty: 4, unit: "pcs" },
            { label: "Ecuador White Light", qty: 2, unit: "pcs" },
            { label: "Edison Light", qty: 1, unit: "pcs" },
            { label: "Tulip Light", qty: 1, unit: "pcs" },
            { label: "Moonlight", qty: 2, unit: "pcs" },
            { label: "Floral Drop Light", qty: 1, unit: "pcs" },
            { label: "Wired Floral Drop Light", qty: 1, unit: "pcs" },
            { label: "Better Together Neon", qty: 1, unit: "pcs" },
            { label: "18 Neon Light", qty: 1, unit: "pcs" },
            { label: "Birthday Neon Light", qty: 1, unit: "pcs" },
            { label: "Monopod Stand", qty: 2, unit: "pcs" },
            { label: "Metal Decor Stand", qty: 9, unit: "pcs" },
            { label: "Sulo", qty: 5, unit: "pcs" },
            { label: "Abaniko", qty: 17, unit: "pcs" },
            { label: "FAH Logo", qty: 1, unit: "pcs" }
          ]
        },
        {
          name: "Crystal Candle Holder (Chandelier)",
          variants: [
            { label: "Rubick", qty: 82, unit: "pcs" }
          ]
        },
        {
          name: "Geometrical Centerpiece",
          variants: [
            { label: "Classic Gold (3 sizes)", qty: 15, unit: "sets" },
            { label: "Gold Geometrical", qty: 15, unit: "pcs" },
            { label: "Rose Gold Geometrical", qty: 15, unit: "pcs" }
          ]
        },
        {
          name: "Centerpiece Items",
          variants: [
            { label: "Round Glass (Mirror)", qty: 25, unit: "pcs" },
            { label: "Wooden Round for Centerpiece", qty: 15, unit: "pcs" },
            { label: "Native Place Mat", qty: 13, unit: "pcs" },
            { label: "Native Place Mat (Round)", qty: 24, unit: "pcs" },
            { label: "Native Banig", qty: 48, unit: "pcs" },
            { label: "Big Mouth", qty: 8, unit: "pcs" }
          ]
        },
        {
          name: "Buffet Decors",
          variants: [
            { label: "Monster Tree", qty: 1, unit: "pcs" },
            { label: "Buffet Tree (Gold)", qty: 1, unit: "pcs" }
          ]
        },
        {
          name: "Stands & Table Numbers",
          variants: [
            { label: "Table Numbers w/ Wooden Stand (New)", qty: 34, unit: "sets" },
            { label: "Metal Name Stand (8 inch)", qty: 29, unit: "pcs" },
            { label: "Metal Stand (10 inch)", qty: 10, unit: "pcs" },
            { label: "Metal Name Stand (12 inch)", qty: 10, unit: "pcs" },
            { label: "Balloon Stand", qty: 14, unit: "pcs" }
          ]
        },
        {
          name: "Baskets, Boxes & Risers",
          variants: [
            { label: "Wooden Crate Box", qty: 5, unit: "pcs" },
            { label: "Boxes", qty: 33, unit: "pcs" },
            { label: "Dessert Metal Riser", qty: 7, unit: "pcs" },
            { label: "Wire Basket", qty: 8, unit: "pcs" },
            { label: "Native Basket (Small)", qty: 13, unit: "pcs" },
            { label: "Native Basket (Set)", qty: 2, unit: "sets" },
            { label: "Native Basket (Tall)", qty: 1, unit: "pcs" },
            { label: "Cotton", qty: 45, unit: "pcs" },
            { label: "Grass Carpet For Set", qty: 5, unit: "sets" }
          ]
        },
        {
          name: "Table Napkin Accessories",
          variants: [
            { label: "Napkin Rings Capiz", qty: 54, unit: "pcs" },
            { label: "Napkin Gold Ring A", qty: 46, unit: "pcs" },
            { label: "Napkin Gold Ring B", qty: 44, unit: "pcs" }
          ]
        },
        {
          name: "Linen Care & Equipment",
          variants: [
            { label: "Flat Iron", qty: 2, unit: "pcs" },
            { label: "Ironing Board", qty: 1, unit: "pcs" }
          ]
        },
        {
          name: "Event Props & Toys",
          variants: [
            { label: "Pillow", qty: 20, unit: "pcs" },
            { label: "Stuffed Toy (Bear)", qty: 66, unit: "pcs" },
            { label: "Crochet Stuffed Toy", qty: 23, unit: "pcs" },
            { label: "Dinosaur", qty: 3, unit: "pcs" },
            { label: "Egg", qty: 1, unit: "pcs" },
            { label: "Sungka", qty: 1, unit: "pcs" },
            { label: "Radio", qty: 20, unit: "pcs" },
            { label: "Radio Charger", qty: 20, unit: "pcs" }
          ]
        }
      ]
    }
  ];

  return categories;
}

async function cleanAndOrganize() {
  console.log("=== STARTING INVENTORY RE-ORGANIZATION & DEDUPLICATION ===");

  const cleanCategories = buildCleanInventory();
  console.log(`Structured ${cleanCategories.length} categories with total ${cleanCategories.reduce((s, c) => s + c.items.length, 0)} items.`);

  // 1. Delete all existing items in equipmentItems and logs in equipmentLog
  console.log("Purging old/duplicated equipmentItems and equipmentLog...");
  const oldItemsSnap = await db.collection("equipmentItems").get();
  console.log(`Found ${oldItemsSnap.size} old items to clear.`);
  
  let deleteBatch = db.batch();
  let delCount = 0;
  for (const doc of oldItemsSnap.docs) {
    deleteBatch.delete(doc.ref);
    delCount++;
    if (delCount >= 400) {
      await deleteBatch.commit();
      deleteBatch = db.batch();
      delCount = 0;
    }
  }
  if (delCount > 0) await deleteBatch.commit();

  // Also purge equipmentLog
  const oldLogsSnap = await db.collection("equipmentLog").get();
  console.log(`Found ${oldLogsSnap.size} old log entries to clear.`);
  deleteBatch = db.batch();
  delCount = 0;
  for (const doc of oldLogsSnap.docs) {
    deleteBatch.delete(doc.ref);
    delCount++;
    if (delCount >= 400) {
      await deleteBatch.commit();
      deleteBatch = db.batch();
      delCount = 0;
    }
  }
  if (delCount > 0) await deleteBatch.commit();

  // Also purge duplicate categories
  const oldCatsSnap = await db.collection("equipmentCategories").get();
  console.log(`Found ${oldCatsSnap.size} old category entries to reconcile.`);
  deleteBatch = db.batch();
  delCount = 0;
  for (const doc of oldCatsSnap.docs) {
    deleteBatch.delete(doc.ref);
    delCount++;
    if (delCount >= 400) {
      await deleteBatch.commit();
      deleteBatch = db.batch();
      delCount = 0;
    }
  }
  if (delCount > 0) await deleteBatch.commit();

  console.log("Old documents cleared. Now inserting clean, consolidated categories and items...");

  // 2. Insert the 14 clean categories
  const catMap = new Map(); // name -> id
  for (const c of cleanCategories) {
    const ref = await db.collection("equipmentCategories").add({
      name: c.name,
      createdAt: FieldValue.serverTimestamp()
    });
    catMap.set(c.name, ref.id);
    console.log(`Created clean category: "${c.name}" (${ref.id})`);
  }

  // 3. Insert items and create opening balance logs
  let insertBatch = db.batch();
  let insertCount = 0;
  let totalItems = 0;
  let totalVariants = 0;
  let totalLogs = 0;

  for (const c of cleanCategories) {
    const catId = catMap.get(c.name);
    for (const it of c.items) {
      totalItems++;
      const itemRef = db.collection("equipmentItems").doc();
      const cleanVariants = it.variants.map((v) => ({
        id: uid(),
        label: v.label,
        unit: v.unit || "pcs",
        qty: Math.max(0, Number(v.qty) || 0),
        par: null
      }));

      const itemData = {
        name: it.name,
        categoryId: catId,
        categoryName: c.name,
        note: it.note || "",
        variants: cleanVariants,
        updatedAt: FieldValue.serverTimestamp(),
        updatedAtLocal: Date.now(),
        updatedByName: USER_NAME
      };

      insertBatch.set(itemRef, itemData);
      insertCount++;

      cleanVariants.forEach((v) => {
        totalVariants++;
        if (v.qty > 0) {
          const logRef = db.collection("equipmentLog").doc();
          insertBatch.set(logRef, {
            itemId: itemRef.id,
            itemName: it.name,
            variantId: v.id,
            variantLabel: v.label,
            unit: v.unit,
            delta: v.qty,
            before: 0,
            after: v.qty,
            reason: "opening",
            note: "Initial opening balance from inventory records",
            bookingId: null,
            clientName: null,
            byUid: USER_UID,
            byName: USER_NAME,
            at: FieldValue.serverTimestamp(),
            atLocal: Date.now()
          });
          insertCount++;
          totalLogs++;
        }
      });

      if (insertCount >= 400) {
        await insertBatch.commit();
        insertBatch = db.batch();
        insertCount = 0;
      }
    }
  }

  if (insertCount > 0) {
    await insertBatch.commit();
  }

  console.log("====================================================");
  console.log(" RE-ORGANIZATION & DEDUPLICATION COMPLETE!");
  console.log(` Clean Categories: ${cleanCategories.length}`);
  console.log(` Clean Items: ${totalItems}`);
  console.log(` Total Variants: ${totalVariants}`);
  console.log(` Opening Ledger Entries: ${totalLogs}`);
  console.log("====================================================");
}

cleanAndOrganize().catch((err) => {
  console.error("Re-organization failed:", err);
  process.exit(1);
});
