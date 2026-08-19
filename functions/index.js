/* ⚠️ DEAD CODE — NOT DEPLOYED. Kept only for reference; delete when you are
   sure you don't want it back.

   `firebase.json` no longer declares a "functions" source, so nothing here
   ships and the project does NOT need the Blaze plan.

   Why it went: this existed solely because a WebView cannot inherit the app's
   native Firebase Auth session, so the viewer page had to mint one to read
   `bookings/{id}` for itself. The app had already read that document — it is
   what decides whether the layout button appears at all — so the page is now
   handed the plan directly (lib/screens/user/layout_preview_page.dart →
   window.HPViewer.show). No fetch in the page, no session to mint, and no ID
   token travelling through a URL. Opened in a browser instead, the page uses
   the visitor's own persisted Firebase session. Firestore rules unchanged.

   ─────────────────────────────────────────────────────────────────────────
   HapagPamana · Cloud Functions
   One endpoint today: minting the Firebase Auth session the hosted 3D Layout
   Viewer signs into.

   Why a mint step exists at all — the viewer runs in a Flutter WebView as its
   own page, with its own Firebase JS SDK instance. It cannot reuse the app's
   native Firebase Auth session directly, and an ID token can't be handed to
   signInWith*() as-is (that call wants a CREDENTIAL, not a bearer token). The
   ID token has to be verified server-side and exchanged for a custom token,
   which is what this function does — nothing else. */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

/* mintViewerToken({ idToken, bookingId })
   Verifies the caller really is who they say they are (the ID token their
   own app session issued), confirms they own the booking they're asking to
   preview, and returns a short-lived custom token scoped to that same uid.
   The viewer page signs in with it and then reads Firestore under the
   existing `bookings` rule — no new read path, no widened rule. */
exports.mintViewerToken = onCall(async (request) => {
  const { idToken, bookingId } = request.data || {};
  if (typeof idToken !== "string" || !idToken) {
    throw new HttpsError("invalid-argument", "idToken is required.");
  }
  if (typeof bookingId !== "string" || !bookingId) {
    throw new HttpsError("invalid-argument", "bookingId is required.");
  }

  let uid;
  try {
    ({ uid } = await admin.auth().verifyIdToken(idToken));
  } catch {
    throw new HttpsError("unauthenticated", "Sign-in has expired.");
  }

  const snap = await admin.firestore().collection("bookings").doc(bookingId).get();
  if (!snap.exists || snap.data().uid !== uid) {
    // Same response whether the booking is missing or someone else's — a
    // caller has no business learning which.
    throw new HttpsError("permission-denied", "Not your booking.");
  }

  const customToken = await admin.auth().createCustomToken(uid);
  return { customToken };
});
