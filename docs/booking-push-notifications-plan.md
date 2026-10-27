# Booking Push Notifications — Phase-by-Phase Plan

## Implementation status — 2026-10-26

> Constraint: free tiers only. Firebase stays on Spark; Firebase Cloud
> Functions remain disabled. The trusted sender is a Vercel Function on the
> Hobby plan, and FCM remains the delivery provider.

| Phase | Status | Notes |
|---|---|---|
| 0 — Prerequisites | Partially complete | One Firebase project confirmed. Firebase Spark + Vercel Hobby selected. Web Push VAPID and Vercel secrets require console access. iOS uses credentials already owned; no paid enrollment is introduced. |
| 1 — Contracts | Complete | All pending bookings notify Orders staff. Customer events: confirmed, declined, completed, and payment paid. |
| 2 — Token registration | Implemented locally | Mobile and Orders-browser token registration plus Firestore rules added. External credentials still required. |
| 3 — Trusted sender | Implemented locally | Authenticated, idempotent Vercel Function added at `api/notifications/booking.mjs`. It rereads Firestore, validates ownership/roles, writes history, sends FCM, and cleans stale tokens. |
| 4 — Flutter handling | Implemented locally | Foreground messages, background delivery, terminated/background taps, and booking deep links added. |
| 5 — Admin browser | Implemented locally | Service worker, opt-in control, background notification, logout cleanup, and Orders deep links added. |
| 6 — Testing | In progress | Flutter analysis passes with no issues; all 90 tests pass. Vercel/FCM and device/browser tests require deployment plus credentials. |
| 7 — Rollout | Pending | Staging deployment, security verification, internal pilot, monitoring, and production rollout remain. |

### Implemented collections

- Customer tokens: `customers/{uid}/pushTokens/{tokenId}`
- Admin browser tokens: `adminNotificationTokens/{tokenId}`
- Customer history: `notifications/{uid}/items/{eventId}`
- Delivery audit/idempotency: `notificationDeliveries/{eventId-kind}`

### Required external setup before end-to-end testing

1. Generate a Web Push certificate in Firebase Console.
2. Put its public VAPID key in `Admin/firebase-config.js` as `HP_WEB_PUSH_VAPID_KEY`.
3. Add `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
   `FIREBASE_PRIVATE_KEY` to Vercel environment variables. Never commit the
   service-account JSON.
4. Import this repository into Vercel with the repository root as Root
   Directory. `vercel.json` publishes `Admin/` and the `/api` Function.
5. Deploy the Spark-compatible rules with
   `firebase deploy --only firestore:rules`.
6. Set Flutter `NOTIFICATION_API_URL` to the production Vercel endpoint.
7. Create `.env` from `.env.example` before Flutter builds.
8. For iOS only, upload an APNs key already owned by the project. Skip iOS
   push if that would require buying an Apple Developer membership.

## Objective

Add reliable notifications for both sides of the booking workflow:

1. Customers receive mobile push notifications when their booking status changes.
2. Admin staff receive browser push notifications when a new booking is submitted.
3. Existing in-app notifications, dashboard toasts, and unread badges remain available as history and fallback behavior.

## Current state

- Customer bookings are stored in Firestore under `bookings/{bookingId}`.
- New bookings start with `status: "pending"`.
- The Flutter app has an in-app notification feed under `notifications/{uid}/items`.
- The Vercel sender writes customer notification history after a verified
  booking event.
- The Admin Orders page listens live to `bookings` and shows a toast/tab-title alert for new pending bookings.
- FCM delivery code is implemented but not end-to-end tested against a
  deployed Vercel URL and real device/browser tokens yet.

## Target architecture

```text
Customer Flutter app
    └─ registers FCM token → customers/{uid}/pushTokens/{tokenId}

Admin browser
    └─ registers FCM token → adminNotificationTokens/{token}

Flutter/Admin booking write
    └─ authenticated HTTPS request → Vercel Function
         └─ verifies Firebase ID token, rereads Firestore, validates event
         ├─ customer: booking status changed
         └─ admins: new pending booking created

FCM message
    ├─ foreground handler → app/dashboard toast or local notification
    └─ background handler → system notification → deep link
```

## Phase 0 — Confirm prerequisites

### Tasks

- Confirm the Firebase project used by Flutter, Admin, and the Vercel sender is the same project.
- Confirm Android package name and iOS bundle identifier are registered in Firebase.
- Confirm the Admin site is served over HTTPS in production.
- Confirm the Vercel project uses Node.js 22 and the repository root.
- Decide which staff roles receive new-booking alerts. Recommended initial roles: `admin`, `owner`, and `marketing_admin`.
- Decide whether notifications are sent only for new bookings or also for new food-pack quotations.

### Deliverables

- Firebase project and app identifiers recorded in the implementation notes.
- Approved recipient-role list.
- Approved notification event list.

### Exit criteria

- All three clients can be mapped to the same Firebase project.
- Production HTTPS and the Vercel Function are available.

## Phase 1 — Define notification events and data contracts

### Tasks

Define a stable event matrix:

| Event | Recipient | Trigger | Title | Deep link |
|---|---|---|---|---|
| Booking submitted | Admin staff | New `bookings` document with `status == pending` | New booking received | Admin Orders booking sheet |
| Booking confirmed | Customer | Status changes to `confirmed` | Booking confirmed | Customer tracking page |
| Booking declined | Customer | Status changes to `declined` | Booking declined | Customer tracking page |
| Booking completed | Customer | Status changes to `completed` | Booking completed | Customer tracking page |
| Payment received | Customer | Payment status changes to `paid` | Payment received | Customer tracking page |

- Standardize FCM `data` fields: `type`, `bookingId`, `status`, `route`, and optional `eventId`.
- Use the booking ID as the logical idempotency key.
- Keep notification copy in one backend module so mobile, browser, and in-app wording do not drift.
- Define behavior for deleted bookings, drafts, retries, and malformed records.

### Deliverables

- Notification event contract.
- Deep-link route contract.
- Duplicate and retry policy.

### Exit criteria

- Every supported event has one trigger, one recipient, and one destination.

## Phase 2 — Add secure device-token registration

### Flutter customer app

- Add Firebase Messaging initialization after Firebase startup.
- Request notification permission on supported platforms with clear user-facing explanation.
- Retrieve the FCM token and save it under the authenticated customer.
- Refresh the token when Firebase reports a token change.
- Remove or deactivate tokens on sign-out where appropriate.
- Store platform, app version, device label, `lastSeenAt`, and an `active` flag.
- Avoid storing tokens in the booking document.

### Admin browser

- Add Firebase Messaging to the Admin site.
- Register a service worker for background notifications.
- Request permission from an explicit Admin settings/notification control.
- Store the browser token with the authenticated staff UID and role.
- Handle token refresh and permission denial gracefully.

### Security

- Update Firestore rules so users can manage only their own device tokens.
- Prevent clients from writing arbitrary admin-recipient records.
- Prefer a server-maintained admin-token collection or server-side role lookup.
- Never expose server credentials or Admin SDK credentials to Flutter or browser code.

### Exit criteria

- A signed-in customer has an active token record.
- An authorized admin browser has an active token record.
- Token refresh and sign-out behavior are tested.

## Phase 3 — Implement the Vercel notification service

### Tasks

- Add one authenticated endpoint at `/api/notifications/booking`.
- Have Flutter signal `booking_created` after a successful booking write.
- Have Admin signal `status_changed` after a successful status transaction.
- Have Flutter/Admin signal `payment_paid` after a successful payment write.
- Verify the caller's Firebase ID token on every request.
- Reread the booking; never trust client-supplied status, recipient, or copy.
- Require booking ownership for creation and customer payment signals.
- Require an active Orders role for status changes and Admin-recorded payments.
- Load recipient tokens from Firestore.
- Send multicast FCM messages in batches.
- Remove invalid or unregistered tokens after FCM reports them.
- Write an audit record such as `notificationDeliveries/{eventId}` or an equivalent subcollection.
- Make handlers idempotent so retries do not create duplicate notifications.
- Continue writing the customer’s in-app notification record for history.
- Do not trust a client-written “notification sent” flag as proof of delivery.

### Recommended trigger rules

- New booking: notify admins only when the document is newly created and status is `pending`.
- Status update: notify the customer only when the previous status differs from the new status.
- Ignore `draft` documents and deleted records.
- Do not notify on unrelated booking field updates.

### Exit criteria

- Test bookings produce the correct recipient messages.
- Replayed endpoint requests do not produce duplicate notifications.
- Invalid tokens are cleaned up without failing the whole batch.

## Phase 4 — Integrate Flutter push handling and deep links

### Tasks

- Add a top-level background message handler.
- Handle foreground messages with an in-app banner or local notification.
- Handle notification taps when the app is backgrounded or terminated.
- Route `bookingId` to the existing booking tracking page.
- If the user is signed out, retain the pending deep link until authentication completes.
- If the booking no longer belongs to the user, show a safe error and do not expose details.
- Keep the notification bell synchronized with the Firestore notification record.
- Prevent duplicate visible alerts when both FCM and the Firestore stream report the same event.

### Exit criteria

- Push opens the correct booking from foreground, background, and terminated states.
- Android and iOS permission-denied paths do not break booking tracking.
- A customer can still see the event in the in-app notification history.

## Phase 5 — Integrate Admin browser push handling

### Tasks

- Add the FCM service worker to the Admin hosting output.
- Handle background notifications while the Orders page is closed or minimized.
- Open `/Admin/Orders/html/index.html?order={bookingId}` when the notification is clicked.
- Keep the existing live Firestore listener, toast, title flash, and pending badge.
- Deduplicate browser push and live-listener alerts when the page is already visible.
- Add a visible notification-permission status and re-enable instructions.

### Exit criteria

- A new pending booking alerts an authorized admin with the Orders page open.
- A new pending booking alerts an authorized admin with the Orders page closed.
- Clicking the browser notification opens the correct booking.

## Phase 6 — Testing and observability

### Functional tests

- New customer booking sends one admin notification.
- Pending-to-confirmed sends one customer notification.
- Pending-to-declined sends one customer notification.
- Confirmed-to-completed sends one customer notification.
- Payment confirmation sends one notification if enabled.
- Draft creation sends no operational push.
- Unrelated booking edits send no duplicate status notification.
- Multiple customer devices receive the same customer event.
- Multiple authorized admin browsers receive the new-booking event.

### Platform tests

- Android foreground, background, terminated.
- iOS foreground, background, terminated.
- Chrome/Edge desktop browser foreground and closed-tab behavior.
- Permission denied, token refresh, logout, reinstall, and stale-token cleanup.

### Failure tests

- Vercel Function retry.
- FCM partial failure.
- Missing customer UID.
- Deleted booking before notification delivery.
- Admin with no registered browser token.
- Offline customer app.

### Observability

- Log event ID, booking ID, recipient type, token count, success count, and failure count.
- Do not log payment details or unnecessary personal information.
- Add a lightweight admin diagnostics view or secured logs for delivery failures.
- Define alerts for repeated function errors and unusual token-failure rates.

### Exit criteria

- Test matrix passes on supported platforms.
- Notification failures are diagnosable without reading sensitive booking contents.

## Phase 7 — Security review and production rollout

### Tasks

- Review Firestore rules for customer tokens, admin tokens, bookings, and notification records.
- Verify only the backend can send notifications to arbitrary recipients.
- Verify deep links do not bypass booking ownership or admin-role checks.
- Verify notification payloads contain minimal personal data.
- Deploy a Vercel Preview first, then test Production with internal accounts.
- Release to a small internal group before full rollout.
- Monitor Vercel Function logs and free-tier usage.
- Document how to revoke tokens and disable notifications for a user or browser.

### Rollout sequence

1. Deploy token registration without sending push.
2. Verify token records and security rules.
3. Deploy customer status notifications to internal testers.
4. Deploy admin new-booking notifications to internal staff.
5. Enable production recipients gradually.
6. Retain existing in-app and dashboard notifications as fallback.

### Exit criteria

- Production push delivery is stable.
- No unauthorized recipient can read or trigger another user’s notification.
- Rollback instructions are tested.

## Suggested implementation order

1. Phase 0: prerequisites and recipient decisions.
2. Phase 1: event/data contracts.
3. Phase 2: token registration.
4. Phase 3: Vercel Function.
5. Phase 4: Flutter handling.
6. Phase 5: Admin browser handling.
7. Phase 6: testing and observability.
8. Phase 7: security review and rollout.

## Important design decisions

- The backend must be the source of truth for sending notifications; client-side Firestore writes alone cannot guarantee push delivery.
- Firestore notification records remain necessary for notification history and unread state.
- Push payloads should contain identifiers and routing data, not full customer or payment details.
- Notification permission should be requested contextually, not immediately on the first app screen.
- The first implementation should support booking status changes and new pending bookings; reminders and marketing notifications can be added later as separate event types.

## Definition of done

- Customers receive actionable mobile push notifications for approved booking events.
- Admin staff receive browser push notifications for new pending bookings.
- Tapping either notification opens the relevant booking screen.
- Existing in-app notifications and Admin dashboard alerts still work.
- Duplicate events, invalid tokens, permissions, retries, and security rules are covered by tests.
- The system has basic delivery logs and a documented rollback path.
