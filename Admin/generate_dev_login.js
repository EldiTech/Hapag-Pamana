"use strict";
const path = require("path");
const backfill = path.join(__dirname, "Orders", "backfill", "node_modules");
const { initializeApp, cert } = require(path.join(backfill, "firebase-admin", "app"));
const { getAuth } = require(path.join(backfill, "firebase-admin", "auth"));
const fs = require("fs");

const keyPath = path.resolve("./Orders/backfill/serviceAccountKey.json");
initializeApp({ credential: cert(require(keyPath)) });
const auth = getAuth();

(async () => {
  const token = await auth.createCustomToken("SpUpSeCbFTZUNRJOLMZP0es3vUj1");
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Dev Auth Login</title>
  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
  <script src="firebase-config.js"></script>
</head>
<body style="font-family:sans-serif;padding:30px;background:#1b1611;color:#f5f0eb;">
  <h2 style="color:#d4af37;">Authenticating Admin Session...</h2>
  <div id="status" style="margin-bottom:15px;color:#c8b89e;">Connecting to Firebase...</div>
  <div style="display:flex;gap:12px;margin-top:20px;">
    <a href="Stock%20Clerk/html/pantry.html" id="pantryLink" style="color:#d4af37;text-decoration:none;border:1px solid #d4af37;padding:8px 14px;border-radius:4px;">Go to Stock Clerk Pantry</a>
    <a href="Catering%20Equipment/html/inventory.html" id="equipLink" style="color:#d4af37;text-decoration:none;border:1px solid #d4af37;padding:8px 14px;border-radius:4px;">Go to Catering Equipment</a>
  </div>
  <script>
    firebase.auth().signInWithCustomToken("${token}").then((userCred) => {
      document.getElementById("status").textContent = "✓ Signed in as Luis David Espino! Redirecting to Pantry...";
      sessionStorage.setItem("hp_stock_verified", "1");
      sessionStorage.setItem("hp_ceq_verified", "1");
      sessionStorage.setItem("hp_staff_verified", "1");
      
      const target = new URLSearchParams(location.search).get("target") || "Stock%20Clerk/html/pantry.html";
      setTimeout(() => {
        location.href = target;
      }, 400);
    }).catch(err => {
      document.getElementById("status").textContent = "Error: " + err.message;
    });
  </script>
</body>
</html>`;

  const dest = path.join(__dirname, "dev-login.html");
  fs.writeFileSync(dest, html, "utf8");
  console.log("✓ dev-login.html created at:", dest);
})().catch(console.error);
