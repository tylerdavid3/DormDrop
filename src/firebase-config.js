import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyB8XICHo3JH_4rPB6AKMoenc6GcQUTEbyc',
  authDomain: 'dormdrop-98dd3.firebaseapp.com',
  projectId: 'dormdrop-98dd3',
  storageBucket: 'dormdrop-98dd3.firebasestorage.app',
  messagingSenderId: '446119671926',
  appId: '1:446119671926:web:4927b8a290f1730f598757',
  measurementId: 'G-4GR6WHK1VG'
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export const SCHOOLS = {
  bu: {
    name: 'Boston University',
    emailDomain: '@bu.edu',
    shortName: 'BU',
    location: { lat: 42.3505, lng: -71.1054 },
    neighborhoods: ['Allston', 'Fenway', 'Brighton', 'Back Bay', 'Brookline']
  },
  neu: {
    name: 'Northeastern University',
    emailDomain: '@northeastern.edu',
    shortName: 'NEU',
    location: { lat: 42.3398, lng: -71.0892 },
    neighborhoods: ['Mission Hill', 'Roxbury', 'Fenway', 'Jamaica Plain', 'Back Bay']
  },
  merrimack: {
    name: 'Merrimack College',
    emailDomain: '@merrimack.edu',
    shortName: 'Merrimack',
    location: { lat: 42.8334, lng: -71.0495 },
    neighborhoods: ['North Andover', 'Andover', 'Methuen', 'Lawrence']
  }
};

export function getCurrentSchool() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  if (path.includes('/bu')) return 'bu';
  if (path.includes('/neu')) return 'neu';
  if (path.includes('/merrimack')) return 'merrimack';
  return 'bu';
}
