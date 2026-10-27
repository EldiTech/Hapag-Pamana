# MASTER PROMPT — Hapag Pamana Event & Announcement System

I want you to implement an **Event & Announcement Management System** for my existing **Hapag Pamana** project.

## PROJECT LOCATIONS

### ADMIN WEBSITE

The Admin/Content Moderator side is located at:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana\Admin\Content Moderator
```

This is the **web-based Admin Content Moderator interface**.

### USER SIDE

The Flutter user application is located at:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana
```

The existing User Home Page is:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana\lib\screens\user\user_home_page.dart
```

---

# MAIN OBJECTIVE

Create a system where a **Content Moderator/Admin can create and publish events or announcements from the Admin Website**, and those published announcements automatically appear on the **User Home Page** in the Flutter application.

The data must be synchronized through the existing Firebase/Firestore setup.

The complete flow should be:

```text
CONTENT MODERATOR WEBSITE
        │
        │ Create / Edit / Publish
        ▼
   FIREBASE FIRESTORE
        │
        │ Published announcement
        ▼
     FLUTTER APP
        │
        ▼
user_home_page.dart
        │
        ▼
Announcements / Events Section
```

---

# STEP 1 — INSPECT THE EXISTING PROJECT FIRST

Before changing anything, inspect both:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana\Admin\Content Moderator
```

and

```text
C:\Users\Moymoy\Downloads\Hapag Pamana
```

Specifically inspect:

### Admin Website

Determine:

* Framework
* Language
* Existing routing
* Existing authentication
* Existing Firebase configuration
* Existing Firestore services
* Existing Content Moderator pages/components
* Existing UI design
* Existing announcement/event functionality, if any

### Flutter User App

Inspect:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana\lib\screens\user\user_home_page.dart
```

Also inspect:

* Firebase initialization
* Firestore services
* Models
* Authentication
* Existing user data structure
* Existing Home Page widgets
* Existing theme/design
* Existing notification/announcement functionality

**Do not immediately start rewriting code.**

First understand how the existing application is structured and reuse the existing architecture.

---

# STEP 2 — ADMIN CONTENT MODERATOR

Implement an **Announcement/Event Management** feature inside:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana\Admin\Content Moderator
```

Do NOT create a completely separate Admin website.

Integrate the feature into the existing Content Moderator interface.

The Content Moderator should be able to:

* Create an announcement
* Create an event
* Add a title
* Add description
* Add event date
* Add event time
* Add location
* Upload an image/banner
* Save as Draft
* Publish
* Edit
* Archive
* Delete when necessary
* View existing announcements
* Search announcements
* Filter announcements by status

---

# STEP 3 — ADMIN UI

Add an appropriate section to the existing Content Moderator dashboard.

Example:

```text
Content Moderator

Dashboard
Users
Content
Announcements
Reports
Settings
```

Create an **Announcements** section.

Example:

```text
Announcements

[ + Create Announcement ]

Search announcements...

--------------------------------------------

Title                    Status       Date

Teachers' Appreciation   Published    Sept 5
School Holiday           Published    Sept 10
System Maintenance       Draft        Sept 15

[Edit] [Archive] [Delete]
```

Follow the existing Admin Website's visual style.

Do NOT introduce an unrelated design.

---

# STEP 4 — CREATE ANNOUNCEMENT FORM

The Content Moderator should have a form similar to:

```text
Create Announcement

Title
[____________________________]

Description
[____________________________]
[____________________________]

Event Date
[____________________________]

Event Time
[____________________________]

Location
[____________________________]

Event Image
[ Upload Image ]

Status
[ Draft ▼ ]

[ Cancel ] [ Save Draft ] [ Publish ]
```

Required fields should be validated.

---

# STEP 5 — FIRESTORE DATABASE

Use the existing Firebase project.

Create/use:

```text
announcements
```

Firestore collection.

Recommended structure:

```text
announcements
 └── announcementId
      ├── title
      ├── description
      ├── imageUrl
      ├── eventDate
      ├── eventTime
      ├── location
      ├── status
      ├── createdAt
      ├── updatedAt
      ├── publishedAt
      └── createdBy
```

Use Firebase `Timestamp` for date/time fields where appropriate.

`createdBy` should contain the authenticated Content Moderator/Admin UID.

Do not duplicate announcement records for every user.

Announcements are **global content**.

---

# STEP 6 — PUBLISHING LOGIC

When the Content Moderator selects:

```text
Publish
```

the Firestore document should contain:

```text
status = "published"
```

and:

```text
publishedAt = current timestamp
```

When saved as Draft:

```text
status = "draft"
```

When archived:

```text
status = "archived"
```

---

# STEP 7 — USER HOME PAGE

Modify:

```text
C:\Users\Moymoy\Downloads\Hapag Pamana\lib\screens\user\user_home_page.dart
```

Add an **Announcements / Events** section to the existing Home Page.

Do NOT replace the existing Home Page.

Do NOT remove existing features.

Add the announcement section naturally into the current layout.

Example:

```text
Hapag Pamana

Welcome, [User Name]

[ Existing Home Page Content ]


Announcements
────────────────────────

┌─────────────────────────┐
│       EVENT IMAGE        │
├─────────────────────────┤
│ Teachers' Appreciation  │
│ Day                     │
│                         │
│ September 5, 2026       │
│ School Auditorium       │
│                         │
│ View Details →          │
└─────────────────────────┘

[ View All ]
```

Display the latest 3–5 published announcements on the Home Page.

---

# STEP 8 — ONLY SHOW PUBLISHED ANNOUNCEMENTS

The Flutter app must only retrieve announcements where:

```text
status == "published"
```

Draft and archived announcements must NOT appear to normal users.

Order announcements by newest publication date:

```text
publishedAt descending
```

---

# STEP 9 — EVENT DETAILS

When a user taps an announcement card, open a detailed announcement/event page.

Display:

* Image
* Title
* Full description
* Event date
* Event time
* Location
* Published date

Example:

```text
Teachers' Appreciation Day

September 5, 2026
10:00 AM

School Auditorium

Join us as we celebrate and appreciate
our teachers...
```

Reuse the existing navigation structure of the Flutter application.

---

# STEP 10 — REAL-TIME FIRESTORE UPDATE

Use Firestore real-time updates if compatible with the existing architecture.

Expected behavior:

```text
Admin Website
      ↓
Content Moderator publishes
      ↓
Firestore updated
      ↓
Flutter listener receives update
      ↓
User Home Page updates
```

If a user is already on:

```text
user_home_page.dart
```

and the Content Moderator publishes a new announcement, the new announcement should appear without requiring the user to restart the application.

---

# STEP 11 — IMAGE STORAGE

Use the existing Firebase Storage implementation if available.

Do NOT store actual image files directly inside Firestore.

Use:

```text
Firebase Storage
```

and store only the resulting URL:

```text
imageUrl
```

in Firestore.

If the project already has an image-upload service, reuse it.

---

# STEP 12 — SECURITY

Do not rely only on frontend restrictions.

Implement proper Firebase authorization.

### Content Moderator/Admin

Allowed:

```text
Create
Read
Update
Publish
Archive
Delete
```

### Normal User

Allowed:

```text
Read published announcements
```

Normal users must NOT be able to:

```text
Create announcements
Edit announcements
Publish announcements
Archive announcements
Delete announcements
```

Firestore Security Rules must enforce this.

If the project already has an Admin/Content Moderator role system, **reuse it** rather than creating another authentication system.

---

# STEP 13 — USER ACCOUNT ISOLATION

Announcements are global content.

Do NOT store them under individual user accounts.

Correct:

```text
announcements/{announcementId}
```

Avoid:

```text
users/{userId}/announcements/{announcementId}
```

unless the project specifically requires personalized announcements.

This ensures that:

```text
User A
User B
User C
```

all receive the same published announcements.

Do not accidentally associate an announcement with whichever user is currently logged in.

---

# STEP 14 — LOGOUT/LOGIN SAFETY

Because the application has multiple user accounts, make sure the announcement implementation does not introduce stale state.

Test:

```text
Login User A
↓
View Home Page
↓
Logout
↓
Login User B
↓
View Home Page
```

Expected:

* User B sees the correct published announcements.
* No stale User A-specific data appears.
* Announcement data remains global.
* Existing user-specific data remains correctly isolated.

Do not reuse cached user-specific state for global announcements.

---

# STEP 15 — LOADING / ERROR / EMPTY STATES

Implement proper UI states.

### Loading

Show a progress indicator/skeleton.

### Empty

Show:

```text
No announcements available.
```

### Error

Show a user-friendly error and retry option.

Do not crash the application if Firestore is unavailable.

---

# STEP 16 — PERFORMANCE

Avoid unnecessary Firestore reads.

On the Home Page:

* Fetch only the latest announcements needed.
* Limit the number of results.
* Avoid creating a new Firestore query every widget rebuild.
* Reuse existing services/repositories.
* Use streams only where appropriate.

---

# STEP 17 — DO NOT BREAK EXISTING FUNCTIONALITY

This is an existing project.

Therefore:

**DO NOT:**

* Rewrite the entire Home Page
* Rewrite the entire Admin Website
* Replace Firebase configuration
* Replace authentication
* Create duplicate Firebase initialization
* Create duplicate services unnecessarily
* Remove existing features
* Change unrelated database structures
* Hardcode announcement data
* Hardcode Admin credentials
* Disable existing security rules

Make the smallest clean changes required to implement the feature.

---

# STEP 18 — FILES TO CREATE/MODIFY

Determine the exact files after inspecting the project.

Likely Flutter files may include:

```text
lib/
 ├── screens/
 │    └── user/
 │         ├── user_home_page.dart
 │         └── announcement_details_page.dart
 │
 ├── models/
 │    └── announcement.dart
 │
 ├── services/
 │    └── announcement_service.dart
 │
 └── widgets/
      └── announcement_card.dart
```

For the Admin Website, follow its existing architecture and naming conventions.

Do not assume these exact paths exist.

---

# STEP 19 — TEST THE COMPLETE SYSTEM

Perform these tests after implementation.

### Test A — Create Draft

Content Moderator creates:

```text
Teachers' Appreciation Day
```

and saves as Draft.

Expected:

```text
Admin → Visible
Flutter User → NOT visible
```

### Test B — Publish

Content Moderator publishes it.

Expected:

```text
Firestore → status: published
Flutter → announcement appears
```

### Test C — Real-Time

Keep the Flutter Home Page open.

Publish a new announcement from the Admin Website.

Expected:

```text
Announcement appears without restarting Flutter.
```

### Test D — Edit

Edit the announcement from the Admin Website.

Expected:

```text
Flutter displays the updated information.
```

### Test E — Archive

Archive the announcement.

Expected:

```text
Admin → Can still see archived record
Flutter → No longer visible
```

### Test F — Security

Attempt to modify an announcement as a normal user.

Expected:

```text
Firestore → Permission denied
```

### Test G — Multiple Accounts

```text
User A → Login → Home
User A → Logout
User B → Login → Home
```

Expected:

```text
Correct user-specific information
+
Correct global announcements
```

No cross-account contamination.

---

# FINAL REQUIREMENT

The finished system must work exactly like this:

```text
        CONTENT MODERATOR
        ADMIN WEBSITE
              │
              │
       Create Announcement
              │
              ▼
       Firebase Firestore
              │
              │
          Published
              │
              ▼
       FLUTTER USER APP
              │
              ▼
      user_home_page.dart
              │
              ▼
       ANNOUNCEMENTS
              │
              ▼
       EVENT DETAILS PAGE
```

Before coding, inspect the existing project and provide a concise implementation plan listing the **exact files you will modify/create**.

Then implement the feature completely.

After implementation, verify the Admin Website → Firestore → Flutter User Home Page flow and fix any errors encountered.

Do not stop at creating the UI. The feature must be **fully connected and functional with Firebase**.
