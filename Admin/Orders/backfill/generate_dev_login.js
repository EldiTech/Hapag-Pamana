const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const fs = require("fs");
const path = require("path");

initializeApp({ credential: cert(require(path.resolve("./serviceAccountKey.json"))) });
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
<body style="font-family:sans-serif;padding:30px;background:#f5f0eb;">
  <h2>Authenticating Luis David Espino...</h2>
  <div id="status">Connecting to Firebase...</div>
  <script>
    firebase.auth().signInWithCustomToken("${token}").then((userCred) => {
      document.getElementById("status").textContent = "Signed in! Redirecting to Equipment Inventory...";
      sessionStorage.setItem("hp_ceq_verified", "1");
      setTimeout(() => {
        location.href = "Catering%20Equipment/html/inventory.html";
      }, 500);
    }).catch(err => {
      document.getElementById("status").textContent = "Error: " + err.message;
    });
  </script>
</body>
</html>`;

  fs.writeFileSync("C:/Users/Joshua/Downloads/Hapag Pamana/Admin/dev-login.html", html, "utf8");
  console.log("dev-login.html written successfully.");
})().catch(console.error);
