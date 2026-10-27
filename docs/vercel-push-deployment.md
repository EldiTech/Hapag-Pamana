# Vercel Push Deployment

This deployment keeps Firebase on Spark. The Admin portal is static content;
only `/api/notifications/booking` runs as a Vercel Node.js Function.

## 1. Firebase setup

1. Firebase Console → Project settings → Cloud Messaging → Web Push
   certificates → generate a key pair.
2. Copy the public key into `Admin/firebase-config.js` as
   `HP_WEB_PUSH_VAPID_KEY`. This key is safe in browser code.
3. Create a dedicated service account for the Vercel sender. It needs
   Firestore read/write access and Firebase Cloud Messaging send access.
4. Download its JSON once. Do not copy it into this repository.
5. Deploy `firestore.rules` using the Firebase CLI from a machine where the
   CLI is installed.

## 2. Vercel project

1. Import the Git repository in Vercel.
2. Leave Root Directory at the repository root.
3. Framework Preset: Other. `vercel.json` already sets this and publishes
   `Admin/` as the static output.
4. Use Node.js 22. `package.json` already pins it.
5. Add these environment variables for Production and Preview:

   - `FIREBASE_PROJECT_ID=hapagpamana-39687`
   - `FIREBASE_CLIENT_EMAIL=<service-account client_email>`
   - `FIREBASE_PRIVATE_KEY=<service-account private_key>`
   - `ALLOWED_ORIGINS=` only when another website must call the Function

6. Deploy. Opening the Vercel domain should show the Admin login. A GET to
   `/api/notifications/booking` should return HTTP 405, proving the Function
   route exists without sending anything.

## 3. Flutter build

Set the production endpoint in `.env`:

```dotenv
NOTIFICATION_API_URL=https://YOUR-PROJECT.vercel.app/api/notifications/booking
```

It can also be supplied during CI:

```text
--dart-define=NOTIFICATION_API_URL=https://YOUR-PROJECT.vercel.app/api/notifications/booking
```

Then build and install the mobile app normally. Never put Firebase service
account values in `.env`; that file is bundled into the app.

## 4. Free-tier boundaries

- Firebase Cloud Messaging has no per-message charge.
- Firebase stays on Spark because this design does not deploy Firebase Cloud
  Functions.
- Vercel Hobby and Firebase Spark quotas still apply. If a quota is exhausted,
  delivery pauses/fails instead of this design intentionally enabling billing.
- Android and browser push need no paid platform account. Enable iOS push only
  if the project already has the necessary Apple signing/APNs access.

## 5. End-to-end test

1. Sign in to Orders on Chrome/Edge and press the push control.
2. Confirm an active document appears in `adminNotificationTokens`.
3. Sign in to the mobile app and allow order-update notifications.
4. Confirm an active token appears under `customers/{uid}/pushTokens`.
5. Submit a booking: the Admin browser should receive one push.
6. Confirm/decline the booking: the customer should receive one push and one
   in-app history item.
7. Record a payment: the customer should receive one payment notification.
8. Repeat the same endpoint request: `notificationDeliveries` should prevent a
   second delivery.

## Rollback

Remove `NOTIFICATION_API_URL` from the Flutter build and set
`HP_NOTIFICATION_API_URL` to an empty string in `Admin/firebase-config.js`.
Booking and payment writes continue; only push delivery stops. Token records
can remain for a later redeploy.
