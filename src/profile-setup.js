import { auth, db, storage, SCHOOLS, getCurrentSchool } from './firebase-config.js';
import { doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

let currentStep = 1;
let profileData = {};
let currentUserData = null;

const school = getCurrentSchool();

async function init() {
  await new Promise(function (resolve) {
    const u = auth.currentUser;
    if (u) return resolve();
    const unsub = auth.onAuthStateChanged(function (user) {
      unsub();
      resolve();
    });
  });
  if (!auth.currentUser) {
    window.location.href = '/';
    return;
  }
  const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
  currentUserData = userDoc.data();
  if (!currentUserData || currentUserData.accountType !== 'student') {
    window.location.href = '/';
    return;
  }
  initNeighborhoods();
  updateProgress();
}

function initNeighborhoods() {
  const sch = currentUserData.school || school;
  const neighborhoods = SCHOOLS[sch].neighborhoods;
  const container = document.getElementById('neighborhoods-checkboxes');
  if (!container) return;
  container.innerHTML = neighborhoods
    .map(function (n) {
      return (
        '<label class="nb-item" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer">' +
        '<input type="checkbox" name="neighborhood" value="' +
        n.replace(/"/g, '&quot;') +
        '"/> ' +
        n +
        '</label>'
      );
    })
    .join('');
}

document.getElementById('basic-info-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  profileData.major = document.getElementById('major').value;
  profileData.bio = document.getElementById('bio').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Uploading photo...';
  submitBtn.disabled = true;
  try {
    const photoFile = document.getElementById('profile-photo').files[0];
    if (photoFile) {
      const storageRef = ref(storage, 'profile-photos/' + auth.currentUser.uid);
      await uploadBytes(storageRef, photoFile);
      profileData.profilePhoto = await getDownloadURL(storageRef);
    }
    nextStep();
  } catch (err) {
    alert('Error uploading photo. Please try again.');
    console.error(err);
  } finally {
    submitBtn.textContent = 'Next →';
    submitBtn.disabled = false;
  }
});

document.getElementById('housing-prefs-form').addEventListener('submit', function (e) {
  e.preventDefault();
  profileData.budget = parseInt(document.getElementById('budget').value, 10);
  profileData.moveInDate = document.getElementById('move-in-date').value;
  profileData.preferredNeighborhoods = Array.from(document.querySelectorAll('input[name="neighborhood"]:checked')).map(
    function (cb) {
      return cb.value;
    }
  );
  nextStep();
});

document.getElementById('lifestyle-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  profileData.sleepSchedule = document.getElementById('sleep-schedule').value;
  profileData.studyHabits = document.getElementById('study-habits').value;
  profileData.socialStyle = document.getElementById('social-style').value;
  profileData.cleanliness = document.getElementById('cleanliness').value;
  profileData.pets = document.getElementById('pets').value;
  profileData.guests = document.getElementById('guests').value;
  profileData.smoking = document.getElementById('smoking').value;
  profileData.drinking = document.getElementById('drinking').value;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Saving profile...';
  submitBtn.disabled = true;
  await saveProfile();
});

async function saveProfile() {
  try {
    const userRef = doc(db, 'users', auth.currentUser.uid);
    const userDoc = await getDoc(userRef);
    const currentProfile = userDoc.data().profile || {};
    await updateDoc(userRef, {
      profile: Object.assign({}, currentProfile, profileData),
      lastActive: serverTimestamp()
    });
    window.location.href = '/discover.html';
  } catch (error) {
    console.error('Error saving profile:', error);
    alert('Error saving profile. Please try again.');
  }
}

function nextStep() {
  document.getElementById('step-' + currentStep).style.display = 'none';
  currentStep++;
  document.getElementById('step-' + currentStep).style.display = 'block';
  updateProgress();
}

window.prevStep = function () {
  document.getElementById('step-' + currentStep).style.display = 'none';
  currentStep--;
  document.getElementById('step-' + currentStep).style.display = 'block';
  updateProgress();
};

function updateProgress() {
  var progress = (currentStep / 3) * 100;
  document.getElementById('progress').style.width = progress + '%';
}

document.getElementById('budget').addEventListener('input', function (e) {
  document.getElementById('budget-amount').textContent = e.target.value;
});

init();
