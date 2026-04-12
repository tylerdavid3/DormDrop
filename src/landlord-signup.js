import { signupLandlord } from './auth.js';
import { auth } from './firebase-config.js';
import { signOut } from 'firebase/auth';

document.getElementById('ll-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const err = document.getElementById('err');
  err.style.display = 'none';
  try {
    await signupLandlord(
      document.getElementById('email').value.trim(),
      document.getElementById('pwd').value,
      document.getElementById('name').value.trim(),
      document.getElementById('company').value.trim(),
      document.getElementById('phone').value.trim(),
      document.getElementById('license').value.trim()
    );
    await signOut(auth);
    alert('Account created. Check your email to verify, then open Landlord dashboard and log in.');
    window.location.href = '/landlord-dashboard.html';
  } catch (ex) {
    err.textContent = ex.message || 'Signup failed.';
    err.style.display = 'block';
  }
});
