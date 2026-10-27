"use strict";
const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

const keyPath = path.join(__dirname, "serviceAccountKey.json");
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
  <script>
    firebase.auth().signInWithCustomToken("${token}").then(() => {
      document.getElementById("status").textContent = "✓ Signed in! Redirecting to Pantry...";
      sessionStorage.setItem("hp_stock_verified", "1");
      sessionStorage.setItem("hp_ceq_verified", "1");
      sessionStorage.setItem("hp_staff_verified", "1");
      setTimeout(() => {
        location.href = "Stock%20Clerk/html/pantry.html";
      }, 350);
    }).catch(err => {
      document.getElementById("status").textContent = "Error: " + err.message;
    });
  </script>
</body>
</html>`;

  const dest = path.join(__dirname, "..", "..", "dev-login.html");
  fs.writeFileSync(dest, html, "utf8");
  console.log("✓ dev-login.html created at:", dest);
})().catch(console.error);
