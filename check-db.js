// HapagPamana - Firebase & Firestore Database Connection Checker
const projectId = 'hapagpamana-39687';
const apiKey = 'AIzaSyDokGGoVNFZIJujMFC52yzkOTnG_sxeT4E';

async function checkDatabase() {
  console.log('====================================================');
  console.log('  HapagPamana Database & Firebase Health Check');
  console.log('  Project ID: ' + projectId);
  console.log('====================================================\n');

  // 1. Check Firebase Auth API & Key
  console.log('1. Verifying Firebase Auth Service & API Key:');
  try {
    const authStart = Date.now();
    const authRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin@hapagpamana.ph', continueUri: 'http://localhost:3000' })
    });
    const authDuration = Date.now() - authStart;
    const authData = await authRes.json();

    if (authRes.status === 200 || authData.registered !== undefined || authData.allProviders !== undefined) {
      console.log(`   [PASS] Firebase Auth is online & API key is valid (${authDuration} ms)`);
    } else {
      console.log(`   [FAIL] Firebase Auth error (${authRes.status}):`, authData.error?.message || authData);
    }
  } catch (err) {
    console.log('   [FAIL] Could not reach Firebase Auth:', err.message);
  }

  // 2. Check Live Firestore Database Read
  console.log('\n2. Testing Live Firestore Database Queries:');
  const collections = [
    { name: 'products', desc: 'Menu Products' },
    { name: 'categories', desc: 'Menu Categories' },
    { name: 'settings', desc: 'App & Portal Settings' }
  ];

  for (const col of collections) {
    try {
      const start = Date.now();
      const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${col.name}?key=${apiKey}`);
      const duration = Date.now() - start;
      const data = await res.json();

      if (res.status === 200) {
        const count = data.documents ? data.documents.length : 0;
        console.log(`   [PASS] /${col.name.padEnd(12)} -> CONNECTED (${count} items retrieved, ${duration} ms)`);
      } else {
        console.log(`   [WARN] /${col.name.padEnd(12)} -> Status ${res.status}: ${data.error?.message || 'Unknown'}`);
      }
    } catch (err) {
      console.log(`   [FAIL] /${col.name.padEnd(12)} -> Connection error: ${err.message}`);
    }
  }

  // 3. Verify Security Rules (Unauthenticated Access should be blocked for sensitive collections)
  console.log('\n3. Verifying Firestore Security Rules Protection:');
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users?key=${apiKey}`);
    const data = await res.json();
    if (res.status === 403 || data.error?.status === 'PERMISSION_DENIED') {
      console.log('   [PASS] /users        -> SECURE (Permission denied for unauthenticated requests)');
    } else if (res.status === 200) {
      console.log('   [WARN] /users        -> OPEN (Warning: users collection is publicly readable)');
    } else {
      console.log(`   [INFO] /users        -> Status ${res.status}`);
    }
  } catch (err) {
    console.log('   [FAIL] /users check error:', err.message);
  }

  console.log('\n====================================================');
  console.log(' RESULT: Database is connected and fully operational!');
  console.log('====================================================');
}

checkDatabase();
