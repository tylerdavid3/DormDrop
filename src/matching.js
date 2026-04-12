import { db } from './firebase-config.js';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  arrayUnion,
  setDoc,
  getDoc,
  serverTimestamp
} from 'firebase/firestore';

export async function calculateCompatibility(currentUser, otherUser) {
  const p1 = currentUser.profile || currentUser;
  const p2 = otherUser.profile || otherUser;

  let score = 0;

  if (p1.sleepSchedule === p2.sleepSchedule) score += 20;
  else if (p1.sleepSchedule === 'flexible' || p2.sleepSchedule === 'flexible') score += 10;

  if (p1.studyHabits === p2.studyHabits) score += 15;
  else if (p1.studyHabits === 'flexible' || p2.studyHabits === 'flexible') score += 8;

  if (p1.socialStyle === p2.socialStyle) score += 15;
  else if (p1.socialStyle === 'flexible' || p2.socialStyle === 'flexible') score += 8;

  if (p1.cleanliness === p2.cleanliness) score += 20;
  else if (p1.cleanliness === 'flexible' || p2.cleanliness === 'flexible') score += 10;

  if (p1.pets === p2.pets) score += 10;
  else if (
    (p1.pets === 'ok-with-pets' && p2.pets === 'love-pets') ||
    (p1.pets === 'love-pets' && p2.pets === 'ok-with-pets')
  )
    score += 5;

  if (p1.guests === p2.guests) score += 10;

  const b1 = typeof p1.budget === 'number' ? p1.budget : parseInt(String(p1.budget), 10) || 0;
  const b2 = typeof p2.budget === 'number' ? p2.budget : parseInt(String(p2.budget), 10) || 0;
  const budgetDiff = Math.abs(b1 - b2);
  if (budgetDiff < 100) score += 10;
  else if (budgetDiff < 300) score += 5;

  return Math.min(100, score);
}

export async function getPotentialMatches(currentUserId) {
  const currentUserDoc = await getDoc(doc(db, 'users', currentUserId));
  const currentUser = currentUserDoc.data();
  if (!currentUser) return [];

  const school = currentUser.school;

  const q = query(
    collection(db, 'users'),
    where('school', '==', school),
    where('accountType', '==', 'student'),
    where('emailVerified', '==', true)
  );

  const snapshot = await getDocs(q);
  const matches = [];

  for (const docSnap of snapshot.docs) {
    if (docSnap.id === currentUserId) continue;
    if (currentUser.viewedProfiles?.includes(docSnap.id)) continue;

    const otherUser = docSnap.data();
    if (!otherUser.profile?.sleepSchedule) continue;

    const compatibility = await calculateCompatibility(currentUser, otherUser);
    if (compatibility >= 70) {
      matches.push({
        userId: docSnap.id,
        ...otherUser,
        compatibility
      });
    }
  }

  return matches.sort((a, b) => b.compatibility - a.compatibility);
}

export async function likeProfile(currentUserId, likedUserId) {
  await updateDoc(doc(db, 'users', currentUserId), {
    likedProfiles: arrayUnion(likedUserId),
    viewedProfiles: arrayUnion(likedUserId)
  });

  const likedUserDoc = await getDoc(doc(db, 'users', likedUserId));
  const likedUser = likedUserDoc.data();

  if (likedUser.likedProfiles?.includes(currentUserId)) {
    await createMatch(currentUserId, likedUserId);
    return { isMatch: true };
  }

  return { isMatch: false };
}

export async function passProfile(currentUserId, passedUserId) {
  await updateDoc(doc(db, 'users', currentUserId), {
    passedProfiles: arrayUnion(passedUserId),
    viewedProfiles: arrayUnion(passedUserId)
  });
}

async function createMatch(userId1, userId2) {
  const matchId = [userId1, userId2].sort().join('_');

  const user1Doc = await getDoc(doc(db, 'users', userId1));
  const user2Doc = await getDoc(doc(db, 'users', userId2));

  const compatibility = await calculateCompatibility(user1Doc.data(), user2Doc.data());

  await setDoc(doc(db, 'matches', matchId), {
    users: [userId1, userId2],
    school: user1Doc.data().school,
    compatibility,
    status: 'active',
    createdAt: serverTimestamp(),
    lastMessage: null,
    unreadCount: {
      [userId1]: 0,
      [userId2]: 0
    }
  });

  await updateDoc(doc(db, 'users', userId1), {
    matches: arrayUnion(userId2)
  });

  await updateDoc(doc(db, 'users', userId2), {
    matches: arrayUnion(userId1)
  });
}
