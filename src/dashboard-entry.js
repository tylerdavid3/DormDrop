import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';

onAuthStateChanged(auth, function (u) {
  if (!u) window.location.href = '/';
});
