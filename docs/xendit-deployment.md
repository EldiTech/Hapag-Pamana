# Xendit Payment Deployment

The Flutter app never receives the Xendit secret key. Xendit checkout runs
through the Vercel functions in `api/payments/`.

## Vercel environment variables

Add these to the Vercel project for Preview and Production:

```text
XENDIT_SECRET_KEY=xnd_...
XENDIT_WEBHOOK_TOKEN=<token from Xendit Dashboard>
FIREBASE_PROJECT_ID=hapagpamana-39687
FIREBASE_CLIENT_EMAIL=<Firebase service-account email>
FIREBASE_PRIVATE_KEY=<Firebase service-account private key>
```

Use an Xendit test key first. Give it the minimum money-in permissions needed
for Payment Sessions. Do not commit these values or put them in `.env`.

## Xendit webhook

Set the Payment Session Completed webhook to:

```text
https://YOUR-PROJECT.vercel.app/api/payments/xendit-webhook
```

The endpoint verifies `x-callback-token`, checks the booking reference, and
records the completed payment in Firestore.

## Flutter environment

After deployment, set this in the ignored root `.env`:

```text
XENDIT_API_URL=https://YOUR-PROJECT.vercel.app/api/payments/xendit
```

Then rebuild the APK. The old PayMongo checkout is not reused.
