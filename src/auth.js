import { auth, db, SCHOOLS, getCurrentSchool } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

export function validateSchoolEmail(email, school) {
  const schoolConfig = SCHOOLS[school];
  return email.toLowerCase().endsWith(schoolConfig.emailDomain);
}

function yearToSlug(year) {
  const y = String(year || '').toLowerCase();
  if (y.includes('graduate')) return 'graduate';
  if (y.includes('freshman')) return 'freshman';
  if (y.includes('sophomore')) return 'sophomore';
  if (y.includes('junior')) return 'junior';
  if (y.includes('senior')) return 'senior';
  return 'freshman';
}

export async function signupStudent(email, password, name, year, school) {
  if (!validateSchoolEmail(email, school)) {
    throw new Error(`Please use your ${SCHOOLS[school].name} email (${SCHOOLS[school].emailDomain})`);
  }

  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  await sendEmailVerification(user);

  await setDoc(doc(db, 'users', user.uid), {
    email,
    name,
    school,
    accountType: 'student',
    emailVerified: false,
    createdAt: serverTimestamp(),
    profile: {
      year: yearToSlug(year),
      major: '',
      bio: '',
      profilePhoto: '',
      phone: '',
      budget: 1000,
      moveInDate: '',
      preferredNeighborhoods: [],
      sleepSchedule: '',
      studyHabits: '',
      socialStyle: '',
      cleanliness: '',
      pets: '',
      guests: '',
      smoking: '',
      drinking: ''
    },
    viewedProfiles: [],
    likedProfiles: [],
    passedProfiles: [],
    matches: [],
    savedListings: []
  });

  return {
    success: true,
    message: 'Account created! Please check your email to verify your account.',
    user
  };
}

export async function signupLandlord(email, password, name, companyName, phone, licenseNumber) {
  const userCredential = await createUserWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  await sendEmailVerification(user);

  await setDoc(doc(db, 'users', user.uid), {
    email,
    name,
    school: null,
    accountType: 'landlord',
    emailVerified: false,
    createdAt: serverTimestamp(),
    landlordProfile: {
      companyName,
      phone,
      licenseNumber: licenseNumber || '',
      verified: false,
      listingsCount: 0
    }
  });

  return {
    success: true,
    message: 'Landlord account created! Please verify your email.',
    user
  };
}

export async function login(email, password) {
  const userCredential = await signInWithEmailAndPassword(auth, email, password);
  const user = userCredential.user;

  if (!user.emailVerified) {
    await firebaseSignOut(auth);
    throw new Error('Please verify your email before logging in. Check your inbox.');
  }

  const userDoc = await getDoc(doc(db, 'users', user.uid));
  const userData = userDoc.data();

  return {
    success: true,
    user,
    userData
  };
}

export async function logout() {
  await firebaseSignOut(auth);
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export function initAuthListener(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      callback({ user, userData: userDoc.data() });
    } else {
      callback(null);
    }
  });
}

export async function hasCompletedProfile(userId) {
  const userDoc = await getDoc(doc(db, 'users', userId));
  const data = userDoc.data();
  if (!data || data.accountType !== 'student') return true;
  const p = data.profile || {};
  return !!(p.year && p.major && p.sleepSchedule);
}

export { getCurrentSchool, SCHOOLS };
