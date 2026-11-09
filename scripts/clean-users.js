// scripts/clean-users.js
// Safe script to clear test customer accounts from Firebase Auth & Firestore,
// while STRICTLY preserving the Owner's account and staff accounts.
//
// Usage:
// 1. Download serviceAccountKey.json from Firebase Console:
//    Project Settings -> Service accounts -> Generate new private key
// 2. Place it in this scripts/ folder as 'serviceAccountKey.json'
// 3. Run: node scripts/clean-users.js

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const keyPath = fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))
  ? path.join(__dirname, 'serviceAccountKey.json')
  : path.join(__dirname, '..', 'hapagpamana-39687-firebase-adminsdk-fbsvc-e35a3c7dbc.json');

if (!fs.existsSync(keyPath)) {
  console.error('\n[ERROR] Service account key not found at: ' + keyPath);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'hapagpamana-39687',
});

const auth = admin.auth();
const db = admin.firestore();

async function main() {
  console.log('====================================================');
  console.log('  Hapag Pamana — Customer Accounts Cleanup');
  console.log('====================================================\n');

  // 1. Identify Owner and Staff accounts from /users collection
  console.log('1. Checking Staff and Owner accounts in /users...');
  const usersSnap = await db.collection('users').get();
  const staffUids = new Set();
  const staffEmails = new Set();

  usersSnap.forEach((doc) => {
    const data = doc.data() || {};
    staffUids.add(doc.id);
    if (data.email) staffEmails.add(data.email.toLowerCase());
    console.log(`   [PRESERVE] ${data.role ? data.role.toUpperCase() : 'STAFF'}: ${data.email || doc.id} (UID: ${doc.id})`);
  });

  console.log(`\nFound ${staffUids.size} staff/owner accounts to protect.`);

  // 2. Clean Firestore `customers` collection
  console.log('\n2. Cleaning Firestore `customers` collection...');
  const customersSnap = await db.collection('customers').get();
  let deletedCustomers = 0;

  for (const doc of customersSnap.docs) {
    if (staffUids.has(doc.id)) {
      console.log(`   [SKIP] Protected staff/owner account: ${doc.id}`);
      continue;
    }
    await doc.ref.delete();
    deletedCustomers++;
  }
  console.log(`   Deleted ${deletedCustomers} customer profiles from Firestore.`);

  // 3. Clean Firestore `customer_phones` collection
  console.log('\n3. Cleaning Firestore `customer_phones` collection...');
  const phonesSnap = await db.collection('customer_phones').get();
  let deletedPhones = 0;

  for (const doc of phonesSnap.docs) {
    const data = doc.data() || {};
    if (staffUids.has(data.uid)) {
      console.log(`   [SKIP] Phone belongs to staff/owner: ${doc.id}`);
      continue;
    }
    await doc.ref.delete();
    deletedPhones++;
  }
  console.log(`   Deleted ${deletedPhones} phone index records from Firestore.`);

  // 4. Clean Firebase Auth users (excluding owner/staff)
  console.log('\n4. Cleaning Firebase Authentication users...');
  let pageToken;
  let deletedAuthUsers = 0;
  let skippedAuthUsers = 0;

  do {
    const listResult = await auth.listUsers(100, pageToken);
    for (const user of listResult.users) {
      const email = (user.email || '').toLowerCase();
      const isStaffOrOwner = staffUids.has(user.uid) || staffEmails.has(email);

      if (isStaffOrOwner) {
        console.log(`   [PRESERVE AUTH] Staff/Owner: ${email || user.uid}`);
        skippedAuthUsers++;
        continue;
      }

      await auth.deleteUser(user.uid);
      deletedAuthUsers++;
      console.log(`   [DELETED AUTH] Customer: ${email || user.uid}`);
    }
    pageToken = listResult.pageToken;
  } while (pageToken);

  console.log(`\n====================================================`);
  console.log(`  Cleanup Complete!`);
  console.log(`  - Deleted ${deletedAuthUsers} customer auth accounts`);
  console.log(`  - Deleted ${deletedCustomers} Firestore customer docs`);
  console.log(`  - Deleted ${deletedPhones} Firestore phone index docs`);
  console.log(`  - Preserved ${skippedAuthUsers} Owner & Staff accounts intact`);
  console.log(`====================================================\n`);
}

main().catch((err) => {
  console.error('\nCleanup error:', err);
  process.exit(1);
});

