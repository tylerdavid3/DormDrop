/**
 * DormDrop — Create Landlord Account
 *
 * Creates tyler@dormdrop.com with emailVerified: true in Firebase Auth + Firestore.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   GOOGLE_APPLICATION_CREDENTIALS=../service-account.json node create-landlord.js
 */
'use strict';

const admin = require('firebase-admin');

const LANDLORD_EMAIL    = 'tyler@dormdrop.com';
const LANDLORD_PASSWORD = 'DormDrop2026!';
const LANDLORD_NAME     = 'Tyler David';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('ERROR: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON path.');
  process.exit(1);
}

let FIREBASE_PROJECT;
try {
  const fs = require('fs');
  FIREBASE_PROJECT = JSON.parse(fs.readFileSync(credPath, 'utf8')).project_id;
} catch (e) {
  console.error('ERROR: Could not read service account file:', e.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: FIREBASE_PROJECT,
});

const db   = admin.firestore();
const auth = admin.auth();

async function main() {
  console.log(`\nCreating landlord account for: ${LANDLORD_EMAIL}`);
  console.log(`Firebase project: ${FIREBASE_PROJECT}\n`);

  // 1. Create or update Firebase Auth user
  let uid;
  try {
    const existing = await auth.getUserByEmail(LANDLORD_EMAIL);
    uid = existing.uid;
    console.log(`User already exists (uid: ${uid}) — updating...`);
    await auth.updateUser(uid, {
      password: LANDLORD_PASSWORD,
      emailVerified: true,
      displayName: LANDLORD_NAME,
    });
    console.log('✓ Firebase Auth user updated (emailVerified: true)');
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    const newUser = await auth.createUser({
      email: LANDLORD_EMAIL,
      password: LANDLORD_PASSWORD,
      displayName: LANDLORD_NAME,
      emailVerified: true,
    });
    uid = newUser.uid;
    console.log(`✓ Firebase Auth user created (uid: ${uid}, emailVerified: true)`);
  }

  // 2. Write Firestore user document
  await db.collection('users').doc(uid).set({
    email: LANDLORD_EMAIL,
    name: LANDLORD_NAME,
    accountType: 'landlord',
    emailVerified: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    landlordProfile: {
      companyName: 'DormDrop Admin',
      phone: '',
      verified: true,
      listingsCount: 0,
    },
  }, { merge: true });

  console.log('✓ Firestore users document written');
  console.log('\n========================================');
  console.log('Landlord account ready:');
  console.log(`  Email:    ${LANDLORD_EMAIL}`);
  console.log(`  Password: ${LANDLORD_PASSWORD}`);
  console.log(`  UID:      ${uid}`);
  console.log('  Login at: https://mydormdrop.com/landlord-dashboard.html');
  console.log('========================================\n');
  process.exit(0);
}

main().catch(function (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
});
