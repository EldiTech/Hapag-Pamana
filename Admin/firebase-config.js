/* HapagPamana · Firebase Web config (shared by the login + Content Moderator).
   Values from Firebase console → Project settings → Your apps → Web. */
window.firebaseConfig = {
  apiKey: "AIzaSyDokGGoVNFZIJujMFC52yzkOTnG_sxeT4E",
  authDomain: "hapagpamana-39687.firebaseapp.com",
  projectId: "hapagpamana-39687",
  storageBucket: "hapagpamana-39687.firebasestorage.app",
  messagingSenderId: "369246306524",
  appId: "1:369246306524:web:f3a4b31aa39e8370b97419",
  measurementId: "G-S4PRHFNPWH",
};

/* Firestore collection holding role records, keyed by the user's auth UID:
   users/{uid} = { email, role, name, active }                              */
window.USERS_COLLECTION = "users";

/* Role-based access — three staff roles, each with its own dashboard:
     content_moderator → Content Moderator (menu content, users, settings)
     order_manager     → Orders (every booking filed from the app)
     master_chef       → Master Chef (ingredient plans for confirmed orders)
   `admin` may enter all of them; the login lands them on the Content
   Moderator. */
window.MODERATOR_ROLES = ["content_moderator", "admin"];
window.ORDER_MANAGER_ROLES = ["order_manager", "admin"];
window.MASTER_CHEF_ROLES = ["master_chef", "admin"];

/* Where the login sends each role after sign-in (relative to Admin/). */
window.ROLE_HOMES = {
  content_moderator: "Content%20Moderator/html/index.html",
  order_manager: "Orders/html/index.html",
  master_chef: "Master%20Chef/html/index.html",
  admin: "Content%20Moderator/html/index.html",
};
