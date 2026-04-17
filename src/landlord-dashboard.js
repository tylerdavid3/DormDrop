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
    container.innerHTML = '<p style="color:#6B7280">No listings yet. Click "+ Add listing" to get started.</p>';
    return;
  }
  container.innerHTML = snapshot.docs
    .map(function (docSnap) {
      const l = docSnap.data();
      const thumb = l.photos && l.photos[0]
        ? `<img src="${escapeHtml(l.photos[0])}" style="width:72px;height:54px;object-fit:cover;border-radius:6px;flex-shrink:0" onerror="this.style.display='none'"/>`
        : `<div style="width:72px;height:54px;background:#E5E0D8;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🏠</div>`;
      const status = l.active === false
        ? '<span style="font-size:11px;color:#9CA3AF;font-weight:600;padding:2px 8px;background:#F3F4F6;border-radius:100px">INACTIVE</span>'
        : '<span style="font-size:11px;color:#059669;font-weight:600;padding:2px 8px;background:#ECFDF5;border-radius:100px">ACTIVE</span>';
      return (
        `<div style="display:flex;gap:14px;align-items:flex-start;border-bottom:1px solid #E5E0D8;padding:14px 0">` +
        thumb +
        `<div style="flex:1;min-width:0">` +
        `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">` +
        `<strong style="font-size:14px">${escapeHtml(l.address || '')}</strong>` +
        status +
        `</div>` +
        `<div style="font-size:13px;color:#6B7280;margin-bottom:6px">${l.bedrooms || '?'} BR / ${l.bathrooms || '?'} BA · $${(l.rent || 0).toLocaleString()}/mo · ${escapeHtml(l.school ? l.school.toUpperCase() : '')}</div>` +
        `<div style="font-size:12px;color:#9CA3AF">Views: ${l.viewCount || 0}</div>` +
        `</div>` +
        `<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">` +
        (l.active !== false
          ? `<button type="button" onclick="deleteListing('${docSnap.id}')" style="font-size:12px;padding:5px 12px;background:#FEF2F2;color:#DC2626;border:1px solid #FCA5A5;border-radius:6px;cursor:pointer">Deactivate</button>`
          : `<button type="button" onclick="reactivateListing('${docSnap.id}')" style="font-size:12px;padding:5px 12px;background:#ECFDF5;color:#059669;border:1px solid #6EE7B7;border-radius:6px;cursor:pointer">Reactivate</button>`) +
        `</div>` +
        `</div>`
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
  // Sort: new first, then by timestamp desc
  const docs = snapshot.docs.slice().sort(function (a, b) {
    const ad = a.data(), bd = b.data();
    if ((ad.status === 'new') !== (bd.status === 'new')) return ad.status === 'new' ? -1 : 1;
    const ta = ad.createdAt && ad.createdAt.toMillis ? ad.createdAt.toMillis() : 0;
    const tb = bd.createdAt && bd.createdAt.toMillis ? bd.createdAt.toMillis() : 0;
    return tb - ta;
  });
  container.innerHTML = docs
    .map(function (docSnap) {
      const inq = docSnap.data();
      const isNew = inq.status === 'new';
      const ts = inq.createdAt && inq.createdAt.toDate ? inq.createdAt.toDate().toLocaleDateString() : '';
      return (
        `<div style="border-bottom:1px solid #E5E0D8;padding:14px 0;${isNew ? 'background:linear-gradient(to right,rgba(14,110,110,.04),transparent);border-left:3px solid #0E6E6E;padding-left:12px;margin-left:-12px' : ''}">` +
        `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap">` +
        `<div>` +
        `<strong style="font-size:14px">${escapeHtml(inq.studentName || 'Unknown')}</strong>` +
        (isNew ? ' <span style="font-size:10px;font-weight:700;color:#0E6E6E;background:#E6F4F4;padding:2px 7px;border-radius:100px;vertical-align:middle">NEW</span>' : '') +
        `<div style="font-size:12px;color:#6B7280;margin-top:2px">${escapeHtml(inq.studentEmail || '')}${inq.studentPhone ? ' · ' + escapeHtml(inq.studentPhone) : ''}</div>` +
        `</div>` +
        `<div style="font-size:11px;color:#9CA3AF;flex-shrink:0">${ts}</div>` +
        `</div>` +
        (inq.listingAddress ? `<div style="font-size:12px;color:#6B7280;margin-top:4px">Re: ${escapeHtml(inq.listingAddress)}</div>` : '') +
        `<div style="font-size:13px;color:#374151;margin-top:8px;background:#F9F7F4;padding:10px 12px;border-radius:8px">${escapeHtml(inq.message || '')}</div>` +
        (isNew
          ? `<button type="button" onclick="markContacted('${docSnap.id}')" style="margin-top:8px;font-size:12px;padding:6px 14px;background:#0E6E6E;color:#fff;border:none;border-radius:6px;cursor:pointer">Mark as Contacted</button>`
          : `<div style="font-size:11px;color:#9CA3AF;margin-top:6px">Contacted</div>`) +
        `</div>`
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

document.getElementById('photos').addEventListener('change', function () {
  const files = Array.from(this.files).slice(0, 5);
  const preview = document.getElementById('photo-previews');
  if (!preview) return;
  preview.innerHTML = files.map(function (f) {
    const url = URL.createObjectURL(f);
    return `<img src="${url}" style="width:72px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #E5E0D8"/>`;
  }).join('');
});

document.getElementById('add-listing-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  const statusEl = document.getElementById('upload-status');
  try {
    const photoFiles = document.getElementById('photos').files;
    const photoURLs = [];
    const total = Math.min(photoFiles.length, 5);
    for (let i = 0; i < total; i++) {
      if (statusEl) statusEl.textContent = `Uploading ${i + 1}/${total}…`;
      submitBtn.textContent = `Uploading ${i + 1}/${total}…`;
      const file = photoFiles[i];
      const storageRef = ref(storage, 'listings/' + auth.currentUser.uid + '/' + Date.now() + '_' + i + '_' + file.name);
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
    alert('Listing published successfully!');
    closeAddListingModal();
    e.target.reset();
    const preview = document.getElementById('photo-previews');
    if (preview) preview.innerHTML = '';
    if (statusEl) statusEl.textContent = '';
    await loadStats();
    await loadListings();
  } catch (error) {
    console.error(error);
    alert('Could not publish listing: ' + (error.message || 'Unknown error'));
  } finally {
    submitBtn.textContent = 'Publish';
    submitBtn.disabled = false;
    if (statusEl) statusEl.textContent = '';
  }
});

window.deleteListing = async function (listingId) {
  if (!confirm('Deactivate this listing? It will be hidden from students but not deleted.')) return;
  try {
    await updateDoc(doc(db, 'listings', listingId), { active: false, updatedAt: serverTimestamp() });
    await loadListings();
    await loadStats();
  } catch (error) {
    alert('Error updating listing.');
  }
};

window.reactivateListing = async function (listingId) {
  try {
    await updateDoc(doc(db, 'listings', listingId), { active: true, updatedAt: serverTimestamp() });
    await loadListings();
    await loadStats();
  } catch (error) {
    alert('Error reactivating listing.');
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
