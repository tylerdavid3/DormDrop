// ─────────────────────────────────────────────────────────────────────────────
// DormDrop — Firebase Configuration
// ─────────────────────────────────────────────────────────────────────────────
// HOW TO SET THIS UP:
//   1. Go to console.firebase.google.com → create (or open) your project
//   2. Project Settings → General → "Your apps" → Web app → SDK setup
//   3. Copy the firebaseConfig values into the object below
//   4. Enable: Authentication > Email/Password sign-in
//   5. Enable: Firestore Database (start in production mode)
//   6. Paste the Firestore security rules from the bottom of this file
// ─────────────────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED FIRESTORE SECURITY RULES
// Paste these into: Firebase Console → Firestore → Rules
// ─────────────────────────────────────────────────────────────────────────────
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Any signed-in BU student can read profiles; only owner can write
    match /users/{userId} {
      allow read:  if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }

    // Conversation participants can read/write
    match /conversations/{convId} {
      allow read, write: if request.auth != null
        && request.auth.uid in resource.data.participants;
      allow create: if request.auth != null
        && request.auth.uid in request.resource.data.participants;

      // Messages subcollection — participants only
      match /messages/{msgId} {
        allow read:   if request.auth != null
          && request.auth.uid in get(/databases/$(database)/documents/conversations/$(convId)).data.participants;
        allow create: if request.auth != null
          && request.resource.data.senderId == request.auth.uid;
      }
    }
  }
}
*/

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED FIRESTORE INDEXES
// Firebase will prompt you to create these automatically when they're needed.
// Alternatively create them manually:
//   Collection: conversations
//   Fields:     participants (Array) ASC  +  lastMessageTime (DESC)
// ─────────────────────────────────────────────────────────────────────────────
