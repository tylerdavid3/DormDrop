import { auth, db, storage } from './firebase-config.js';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { logout as authLogout } from './auth.js';
import { onAuthStateChanged, signInWithEmailAndPassword } from 'firebase/auth';

let landlordData = null;

function showDash(show) {
  var lp = document.getElementById('login-panel');
  var dm = document.getElementById('dash-main');
  if (lp) lp.style.display = show ? 'none' : 'block';
  if (dm) dm.style.display = show ? 'block' : 'none';
}

document.getElementById('ll-login-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  var errEl = document.getElementById('ll-login-err');
  errEl.style.display = 'none';
  try {
    var email = document.getElementById('ll-email').value.trim();
    var pwd = document.getElementById('ll-pwd').value;
    await signInWithEmailAndPassword(auth, email, pwd);
    var u = auth.currentUser;
    if (!u.emailVerified) {
      await authLogout();
      errEl.textContent = 'Please verify your email first.';
      errEl.style.display = 'block';
      return;
    }
    var userDoc = await getDoc(doc(db, 'users', u.uid));
    var data = userDoc.data();
    if (!data || data.accountType !== 'landlord') {
      await authLogout();
      errEl.textContent = 'This account is not a landlord account.';
      errEl.style.display = 'block';
      return;
    }
  } catch (ex) {
    errEl.textContent = ex.message || 'Login failed.';
    errEl.style.display = 'block';
  }
});

onAuthStateChanged(auth, async function (user) {
  if (!user) {
    showDash(false);
    return;
  }
  if (!user.emailVerified) {
    await authLogout();
    showDash(false);
    return;
  }
  const userDoc = await getDoc(doc(db, 'users', user.uid));
  landlordData = userDoc.data();
  if (!landlordData || landlordData.accountType !== 'landlord') {
    await authLogout();
    alert('Landlord accounts only.');
    showDash(false);
    return;
  }
  showDash(true);
  await loadStats();
  await loadListings();
  await loadInquiries();
});

async function loadStats() {
  const listingsQuery = query(collection(db, 'listings'), where('landlordId', '==', auth.currentUser.uid));
  const snapshot = await getDocs(listingsQuery);
  const listings = snapshot.docs.map(function (d) {
    return Object.assign({ id: d.id }, d.data());
  });
  const totalViews = listings.reduce(function (sum, l) {
    return sum + (l.viewCount || 0);
  }, 0);
  const inquiriesQuery = query(collection(db, 'inquiries'), where('landlordId', '==', auth.currentUser.uid));
  const inquiriesSnapshot = await getDocs(inquiriesQuery);
  document.getElementById('total-listings').textContent = listings.filter(function (l) {
    return l.active !== false;
  }).length;
  document.getElementById('total-views').textContent = totalViews;
  document.getElementById('total-inquiries').textContent = inquiriesSnapshot.size;
}

async function loadListings() {
  const q = query(collection(db, 'listings'), where('landlordId', '==', auth.currentUser.uid));
  const snapshot = await getDocs(q);
  const container = document.getElementById('landlord-listings');
  if (snapshot.empty) {
    container.innerHTML = '<p style="color:#6B7280">No listings yet.</p>';
    return;
  }
  container.innerHTML = snapshot.docs
    .map(function (docSnap) {
      const listing = docSnap.data();
      return (
        '<div style="border-bottom:1px solid #E5E0D8;padding:12px 0">' +
        '<strong>' +
        escapeHtml(listing.address) +
        '</strong><br/>' +
        listing.bedrooms +
        ' BR / ' +
        listing.bathrooms +
        ' BA · $' +
        listing.rent +
        '/mo<br/>' +
        '<span style="font-size:13px;color:#6B7280">Views: ' +
        (listing.viewCount || 0) +
        '</span> ' +
        (listing.active === false
          ? '<em>(inactive)</em>'
          : '<button type="button" onclick="deleteListing(\'' +
            docSnap.id +
            '\')" style="margin-left:8px;font-size:12px">Deactivate</button>') +
        '</div>'
      );
    })
    .join('');
}

async function loadInquiries() {
  const q = query(collection(db, 'inquiries'), where('landlordId', '==', auth.currentUser.uid));
  const snapshot = await getDocs(q);
  const container = document.getElementById('inquiries-list');
  if (snapshot.empty) {
    container.innerHTML = '<p style="color:#6B7280">No inquiries yet.</p>';
    return;
  }
  container.innerHTML = snapshot.docs
    .map(function (docSnap) {
      const inquiry = docSnap.data();
      return (
        '<div style="border-bottom:1px solid #E5E0D8;padding:12px 0">' +
        '<strong>' +
        escapeHtml(inquiry.studentName) +
        '</strong> — ' +
        escapeHtml(inquiry.status || '') +
        '<br/>Email: ' +
        escapeHtml(inquiry.studentEmail) +
        '<br/>Message: ' +
        escapeHtml(inquiry.message || '') +
        (inquiry.status === 'new'
          ? '<br/><button type="button" onclick="markContacted(\'' +
            docSnap.id +
            '\')" style="margin-top:8px">Mark contacted</button>'
          : '') +
        '</div>'
      );
    })
    .join('');
}

window.showAddListingForm = function () {
  document.getElementById('add-listing-modal').style.display = 'flex';
};

window.closeAddListingModal = function () {
  document.getElementById('add-listing-modal').style.display = 'none';
};

document.getElementById('add-listing-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.textContent = 'Uploading...';
  submitBtn.disabled = true;
  try {
    const photoFiles = document.getElementById('photos').files;
    const photoURLs = [];
    for (let i = 0; i < Math.min(photoFiles.length, 5); i++) {
      const file = photoFiles[i];
      const storageRef = ref(storage, 'listings/' + auth.currentUser.uid + '/' + Date.now() + '_' + i);
      await uploadBytes(storageRef, file);
      photoURLs.push(await getDownloadURL(storageRef));
    }
    submitBtn.textContent = 'Publishing...';
    const rent = parseInt(document.getElementById('rent').value, 10);
    const bedrooms = parseInt(document.getElementById('bedrooms').value, 10);
    const listingData = {
      address: document.getElementById('address').value,
      city: document.getElementById('city').value,
      state: 'MA',
      zipCode: '',
      neighborhood: '',
      school: document.getElementById('listing-school').value,
      rent: rent,
      rentPerPerson: Math.round(rent / Math.max(1, bedrooms)),
      securityDeposit: 0,
      brokerFee: 0,
      bedrooms: bedrooms,
      bathrooms: parseFloat(document.getElementById('bathrooms').value),
      squareFeet: 0,
      furnished: false,
      availableDate: document.getElementById('available-date').value,
      leaseLength: 12,
      description: document.getElementById('description').value,
      photos: photoURLs,
      virtualTour: '',
      amenities: {
        heatIncluded: document.getElementById('heat-included').checked,
        hotWaterIncluded: document.getElementById('hot-water-included').checked,
        laundryInUnit: document.getElementById('laundry-in-unit').checked,
        laundryInBuilding: false,
        parking: document.getElementById('parking').checked,
        dishwasher: false,
        ac: false,
        petsAllowed: document.getElementById('pets-allowed').checked
      },
      landlordId: auth.currentUser.uid,
      landlordName: landlordData.name,
      landlordEmail: landlordData.email,
      landlordPhone: document.getElementById('landlord-phone').value,
      source: 'landlord',
      verified: true,
      active: true,
      viewCount: 0,
      savedCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      coordinates: { lat: 0, lng: 0 },
      distanceToSchool: 0
    };
    await addDoc(collection(db, 'listings'), listingData);
    alert('Listing published.');
    closeAddListingModal();
    e.target.reset();
    await loadStats();
    await loadListings();
  } catch (error) {
    console.error(error);
    alert('Could not publish listing.');
  } finally {
    submitBtn.textContent = 'Publish';
    submitBtn.disabled = false;
  }
});

window.deleteListing = async function (listingId) {
  if (!confirm('Deactivate this listing?')) return;
  try {
    await updateDoc(doc(db, 'listings', listingId), { active: false });
    await loadListings();
    await loadStats();
  } catch (error) {
    alert('Error updating listing.');
  }
};

window.markContacted = async function (inquiryId) {
  try {
    await updateDoc(doc(db, 'inquiries', inquiryId), { status: 'contacted' });
    await loadInquiries();
  } catch (error) {
    alert('Error updating inquiry.');
  }
};

window.logout = async function () {
  await authLogout();
  window.location.href = '/';
};

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
