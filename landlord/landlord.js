// ─────────────────────────────────────────────────────────────────────────────
// DormDrop — Landlord Portal Logic
// Field schema matches Cursor's roommates.js Firestore queries:
//   listings: { school: 'bu'|'neu'|'merrimack', active: bool, bedrooms, bathrooms,
//               rent, squareFeet, address, city, neighborhood, photos, furnished, ... }
//   interests: { listingId, listingAddress, landlordId, studentId, studentName,
//                studentEmail, studentSchool, studentYear, message, status, createdAt }
// ─────────────────────────────────────────────────────────────────────────────

/* global firebase, FIREBASE_CONFIG */

firebase.initializeApp(FIREBASE_CONFIG);
var auth = firebase.auth();
var db   = firebase.firestore();

// ── State ─────────────────────────────────────────────────────────────────────
var currentUser     = null;
var landlordProfile = null;
var allListings     = [];
var allInterests    = [];
var editingListingId = null;
var amenities       = [];
var photos          = [];
var listingFilter   = 'all';
var interestFilter  = 'all';

var SCHOOL_LABELS = { bu: 'Boston University', neu: 'Northeastern University', merrimack: 'Merrimack College' };

// ── Auth ──────────────────────────────────────────────────────────────────────
auth.onAuthStateChanged(function(user) {
  if (user) {
    currentUser = user;
    loadLandlordProfile(user.uid);
  } else {
    currentUser = null;
    landlordProfile = null;
    showAuthScreen();
  }
});

function showAuthScreen() {
  document.getElementById('authScreen').style.display = 'flex';
  document.getElementById('appShell').style.display  = 'none';
}
function showAppShell() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appShell').style.display   = 'flex';
}

function loadLandlordProfile(uid) {
  db.collection('landlords').doc(uid).get().then(function(snap) {
    if (snap.exists) {
      landlordProfile = snap.data();
      applyProfileToUI();
      showAppShell();
      initDashboard();
    } else {
      showAppShell();
      document.getElementById('profileSetupModal').classList.add('open');
      if (currentUser.displayName) document.getElementById('pName').value = currentUser.displayName;
      document.getElementById('sidebarName').textContent = currentUser.email;
    }
  }).catch(function(err) {
    console.error('Profile load error:', err);
    showAppShell();
    initDashboard();
  });
}

function applyProfileToUI() {
  if (!landlordProfile) return;
  var name = landlordProfile.name || currentUser.email;
  document.getElementById('sidebarName').textContent   = name;
  document.getElementById('sidebarAvatar').textContent = name.charAt(0).toUpperCase();
}

function saveProfile() {
  var name    = document.getElementById('pName').value.trim();
  var company = document.getElementById('pCompany').value.trim();
  var phone   = document.getElementById('pPhone').value.trim();
  var errEl   = document.getElementById('profileSetupError');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Please enter your full name.'; errEl.style.display = 'block'; return; }

  var data = { name: name, company: company, phone: phone, email: currentUser.email, uid: currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
  db.collection('landlords').doc(currentUser.uid).set(data).then(function() {
    landlordProfile = data;
    applyProfileToUI();
    document.getElementById('profileSetupModal').classList.remove('open');
    initDashboard();
  }).catch(function(err) { errEl.textContent = err.message; errEl.style.display = 'block'; });
}

// ── Login / Signup / Reset ────────────────────────────────────────────────────
function doLogin() {
  var email = document.getElementById('loginEmail').value.trim();
  var pass  = document.getElementById('loginPassword').value;
  var errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  if (!email || !pass) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = 'block'; return; }
  auth.signInWithEmailAndPassword(email, pass).catch(function(err) { errEl.textContent = friendlyAuthError(err.code); errEl.style.display = 'block'; });
}

function doSignup() {
  var name  = document.getElementById('signupName').value.trim();
  var email = document.getElementById('signupEmail').value.trim();
  var pass  = document.getElementById('signupPassword').value;
  var errEl = document.getElementById('signupError');
  errEl.style.display = 'none';
  if (!name || !email || !pass) { errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return; }
  if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = 'block'; return; }
  auth.createUserWithEmailAndPassword(email, pass).then(function(cred) {
    return cred.user.updateProfile({ displayName: name });
  }).catch(function(err) { errEl.textContent = friendlyAuthError(err.code); errEl.style.display = 'block'; });
}

function doReset() {
  var email  = document.getElementById('resetEmail').value.trim();
  var errEl  = document.getElementById('resetError');
  var succEl = document.getElementById('resetSuccess');
  errEl.style.display = succEl.style.display = 'none';
  if (!email) { errEl.textContent = 'Please enter your email address.'; errEl.style.display = 'block'; return; }
  auth.sendPasswordResetEmail(email).then(function() {
    succEl.textContent = 'Reset link sent! Check your inbox.'; succEl.style.display = 'block';
  }).catch(function(err) { errEl.textContent = friendlyAuthError(err.code); errEl.style.display = 'block'; });
}

function doSignOut() { auth.signOut(); }

function switchAuthTab(tab) {
  ['login','signup','reset'].forEach(function(t) {
    document.getElementById('auth' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.auth-tab').forEach(function(btn, i) {
    btn.classList.toggle('active', i === ['login','signup','reset'].indexOf(tab));
  });
}

// ── Navigation ────────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.nav-item').forEach(function(n) { n.classList.remove('active'); });
  document.getElementById('page-' + name).classList.add('active');
  var navBtn = document.getElementById('nav-' + name);
  if (navBtn) navBtn.classList.add('active');
  var titles = { dashboard: 'Dashboard', listings: 'My Listings', interests: 'Student Interest' };
  document.getElementById('topbarTitle').textContent = titles[name] || name;
  if (name === 'listings')  renderListingsTable();
  if (name === 'interests') renderInterestsGrid();
}

// ── Init ──────────────────────────────────────────────────────────────────────
function initDashboard() {
  loadListings();
  loadInterests();
}

function loadListings() {
  if (!currentUser) return;
  db.collection('listings').where('landlordId', '==', currentUser.uid).orderBy('createdAt', 'desc')
    .onSnapshot(function(snap) {
      allListings = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      updateStatCards();
      renderListingsTable();
      renderRecentInterests();
    }, function(err) { console.error('Listings snapshot:', err); });
}

function loadInterests() {
  if (!currentUser) return;
  db.collection('interests').where('landlordId', '==', currentUser.uid).orderBy('createdAt', 'desc')
    .onSnapshot(function(snap) {
      allInterests = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      updateInterestBadge();
      updateStatCards();
      renderInterestsGrid();
      renderRecentInterests();
    }, function(err) { console.error('Interests snapshot:', err); });
}

function updateStatCards() {
  var total   = allListings.length;
  var active  = allListings.filter(function(l) { return l.active === true; }).length;
  var total_i = allInterests.length;
  var now = Date.now(), week = 7*24*60*60*1000;
  var newThisWeek = allInterests.filter(function(i) {
    if (!i.createdAt) return false;
    var ts = i.createdAt.toDate ? i.createdAt.toDate().getTime() : i.createdAt;
    return (now - ts) < week;
  }).length;
  document.getElementById('statTotal').textContent     = total;
  document.getElementById('statActive').textContent    = active;
  document.getElementById('statInterests').textContent = total_i;
  document.getElementById('statNew').textContent       = newThisWeek;
}

function updateInterestBadge() {
  var n = allInterests.filter(function(i) { return i.status === 'new'; }).length;
  var b = document.getElementById('interestBadge');
  b.textContent = n; b.style.display = n > 0 ? 'inline-block' : 'none';
}

// ── Listings Table ────────────────────────────────────────────────────────────
function filterListings(school, el) {
  listingFilter = school;
  document.querySelectorAll('#listingFilters .chip').forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  renderListingsTable();
}

function renderListingsTable() {
  var tbody = document.getElementById('listingsTableBody');
  if (!tbody) return;
  var filtered = listingFilter === 'all' ? allListings : allListings.filter(function(l) { return l.school === listingFilter; });
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🏡</div><h3>No listings yet</h3><p>Click "+ Add Listing" to post your first property.</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(function(l) {
    var schoolLabel = SCHOOL_LABELS[l.school] || l.school || '—';
    var rent = l.rent || l.monthlyRent || 0;
    var beds = l.bedrooms || l.beds || '—';
    var baths = l.bathrooms || l.baths || '—';
    var isActive = l.active === true;
    var interestCount = allInterests.filter(function(i) { return i.listingId === l.id; }).length;
    return '<tr>' +
      '<td><strong>' + esc(l.address || '') + '</strong>' + (l.city ? '<br><span style="font-size:.775rem;color:var(--text-muted)">' + esc(l.city) + '</span>' : '') + '</td>' +
      '<td>' + esc(schoolLabel) + '</td>' +
      '<td>$' + Number(rent).toLocaleString() + '</td>' +
      '<td>' + beds + ' bd / ' + baths + ' ba</td>' +
      '<td>' + esc(l.availableDate || '—') + '</td>' +
      '<td><span class="badge ' + (isActive ? 'badge-active' : 'badge-inactive') + '">' + (isActive ? 'active' : 'inactive') + '</span></td>' +
      '<td>' + interestCount + ' student' + (interestCount !== 1 ? 's' : '') + '</td>' +
      '<td><div class="table-actions">' +
        '<button class="btn-sm btn-edit" onclick="openEditListing(\'' + l.id + '\')">Edit</button>' +
        '<button class="btn-sm ' + (isActive ? 'btn-toggle-inactive' : 'btn-toggle-active') + '" onclick="toggleListingStatus(\'' + l.id + '\',' + isActive + ')">' + (isActive ? 'Deactivate' : 'Activate') + '</button>' +
        '<button class="btn-sm btn-delete" onclick="deleteListing(\'' + l.id + '\')">Delete</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Interests Grid ────────────────────────────────────────────────────────────
function filterInterests(filter, el) {
  interestFilter = filter;
  document.querySelectorAll('#interestFilters .chip').forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  renderInterestsGrid();
}

function renderInterestsGrid() {
  var grid = document.getElementById('interestsGrid');
  if (!grid) return;
  var filtered = interestFilter === 'all' ? allInterests : allInterests.filter(function(i) { return i.status === interestFilter; });
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⭐</div><h3>No ' + (interestFilter === 'all' ? '' : interestFilter + ' ') + 'inquiries</h3><p>Student inquiries about your listings will appear here.</p></div>';
    return;
  }
  grid.innerHTML = filtered.map(interestCardHTML).join('');
  filtered.filter(function(i) { return i.status === 'new'; }).forEach(function(item) {
    db.collection('interests').doc(item.id).update({ status: 'viewed' }).catch(function() {});
  });
}

function interestCardHTML(item) {
  var initials = (item.studentName || item.studentEmail || '?').charAt(0).toUpperCase();
  var timeStr  = formatTime(item.createdAt);
  var badgeCls = item.status === 'new' ? 'badge-new' : 'badge-viewed';
  var msgHtml  = item.message ? '<div class="interest-message">' + esc(item.message) + '</div>' : '';
  var schoolStr = [item.studentSchool, item.studentYear].filter(Boolean).join(' · ');
  return '<div class="interest-card">' +
    '<div class="interest-card-header">' +
      '<div class="interest-student">' +
        '<div class="student-avatar">' + initials + '</div>' +
        '<div><div class="student-name">' + esc(item.studentName || 'Student') + '</div><div class="student-meta">' + esc(schoolStr) + '</div></div>' +
      '</div>' +
      '<span class="badge ' + badgeCls + '">' + (item.status || 'new') + '</span>' +
    '</div>' +
    '<div class="interest-listing">Interested in: <strong>' + esc(item.listingAddress || '—') + '</strong></div>' +
    msgHtml +
    '<div class="interest-footer"><span class="interest-time">' + timeStr + '</span>' +
      '<a class="btn-contact" href="mailto:' + esc(item.studentEmail || '') + '">Email Student</a>' +
    '</div>' +
  '</div>';
}

function renderRecentInterests() {
  var wrap = document.getElementById('recentInterestWrap');
  if (!wrap) return;
  var recent = allInterests.slice(0, 3);
  if (!recent.length) { wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><h3>No interest yet</h3><p>Student inquiries will appear here.</p></div>'; return; }
  var g = document.createElement('div'); g.className = 'interests-grid';
  g.innerHTML = recent.map(interestCardHTML).join('');
  wrap.innerHTML = ''; wrap.appendChild(g);
}

// ── Add/Edit Listing Modal ────────────────────────────────────────────────────
function openAddListing() {
  editingListingId = null; amenities = []; photos = [];
  document.getElementById('listingModalTitle').textContent  = 'Add New Listing';
  document.getElementById('listingFormError').style.display = 'none';
  clearListingForm();
  document.getElementById('listingModal').classList.add('open');
  showPage('listings');
}

function openEditListing(id) {
  var l = allListings.find(function(x) { return x.id === id; });
  if (!l) return;
  editingListingId = id;
  amenities = l.amenities ? l.amenities.slice() : [];
  photos    = l.photos    ? l.photos.slice()    : [];
  document.getElementById('listingModalTitle').textContent  = 'Edit Listing';
  document.getElementById('listingFormError').style.display = 'none';
  document.getElementById('fAddress').value     = l.address       || '';
  document.getElementById('fCity').value        = l.city          || '';
  document.getElementById('fRent').value        = l.rent || l.monthlyRent || '';
  document.getElementById('fSchool').value      = l.school        || '';
  document.getElementById('fBeds').value        = l.bedrooms || l.beds || '';
  document.getElementById('fBaths').value       = l.bathrooms || l.baths || '';
  document.getElementById('fSqft').value        = l.squareFeet || l.sqft || '';
  document.getElementById('fAvailable').value   = l.availableDate || '';
  document.getElementById('fNeighborhood').value= l.neighborhood  || '';
  document.getElementById('fDescription').value = l.description   || '';
  document.getElementById('fFurnished').value   = l.furnished ? 'true' : 'false';
  document.getElementById('fStatus').value      = l.active !== false ? 'true' : 'false';
  renderAmenityTags(); renderPhotoTags();
  document.getElementById('listingModal').classList.add('open');
}

function closeListingModal() { document.getElementById('listingModal').classList.remove('open'); editingListingId = null; }

function clearListingForm() {
  ['fAddress','fCity','fRent','fBeds','fBaths','fSqft','fNeighborhood','fDescription','amenityInput','photoInput'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('fSchool').value    = '';
  document.getElementById('fFurnished').value = 'false';
  document.getElementById('fStatus').value    = 'true';
  document.getElementById('fAvailable').value = '';
  renderAmenityTags(); renderPhotoTags();
}

function addAmenity() { var v = document.getElementById('amenityInput').value.trim(); if (!v) return; if (!amenities.includes(v)) amenities.push(v); document.getElementById('amenityInput').value = ''; renderAmenityTags(); }
function removeAmenity(i) { amenities.splice(i, 1); renderAmenityTags(); }
function renderAmenityTags() { document.getElementById('amenityTags').innerHTML = amenities.map(function(a, i) { return '<span class="tag">' + esc(a) + ' <span class="tag-remove" onclick="removeAmenity(' + i + ')">×</span></span>'; }).join(''); }

function addPhoto() { var v = document.getElementById('photoInput').value.trim(); if (!v) return; if (!photos.includes(v)) photos.push(v); document.getElementById('photoInput').value = ''; renderPhotoTags(); }
function removePhoto(i) { photos.splice(i, 1); renderPhotoTags(); }
function renderPhotoTags() { document.getElementById('photoTags').innerHTML = photos.map(function(p, i) { var s = p.length > 40 ? '…' + p.slice(-30) : p; return '<span class="tag photo-tag">' + esc(s) + ' <span class="tag-remove" onclick="removePhoto(' + i + ')">×</span></span>'; }).join(''); }

function saveListing() {
  var errEl = document.getElementById('listingFormError');
  errEl.style.display = 'none';
  var address   = document.getElementById('fAddress').value.trim();
  var city      = document.getElementById('fCity').value.trim();
  var rent      = document.getElementById('fRent').value.trim();
  var school    = document.getElementById('fSchool').value;
  var beds      = document.getElementById('fBeds').value.trim();
  var baths     = document.getElementById('fBaths').value.trim();
  var sqft      = document.getElementById('fSqft').value.trim();
  var available = document.getElementById('fAvailable').value;
  var nbhood    = document.getElementById('fNeighborhood').value.trim();
  var desc      = document.getElementById('fDescription').value.trim();
  var furnished = document.getElementById('fFurnished').value === 'true';
  var active    = document.getElementById('fStatus').value === 'true';

  if (!address || !rent || !school || !beds || !baths || !available) {
    errEl.textContent = 'Please fill in all required fields (marked with *).'; errEl.style.display = 'block'; return;
  }

  var saveBtn = document.getElementById('saveListingBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

  // Use field names matching Cursor's roommates.js schema
  var data = {
    address:       address,
    city:          city,
    rent:          Number(rent),
    rentPerPerson: beds > 1 ? Math.round(Number(rent) / Number(beds)) : Number(rent),
    school:        school,         // 'bu' | 'neu' | 'merrimack'
    bedrooms:      Number(beds),
    bathrooms:     Number(baths),
    squareFeet:    sqft ? Number(sqft) : null,
    availableDate: available,
    neighborhood:  nbhood,
    description:   desc,
    furnished:     furnished,
    active:        active,         // boolean, matching Cursor query: .where('active', '==', true)
    amenities:     amenities,
    photos:        photos,
    landlordId:    currentUser.uid,
    landlordName:  landlordProfile ? (landlordProfile.name || '') : (currentUser.displayName || ''),
    landlordEmail: currentUser.email,
    landlordPhone: landlordProfile ? (landlordProfile.phone || '') : '',
    updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
  };

  var promise = editingListingId
    ? db.collection('listings').doc(editingListingId).update(data)
    : (function() { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); data.views = 0; data.interestCount = 0; return db.collection('listings').add(data); })();

  promise.then(function() {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Listing'; closeListingModal();
  }).catch(function(err) {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Listing'; errEl.textContent = err.message; errEl.style.display = 'block';
  });
}

function toggleListingStatus(id, currentActive) {
  db.collection('listings').doc(id).update({ active: !currentActive, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(function(err) { alert('Error: ' + err.message); });
}

function deleteListing(id) {
  var l = allListings.find(function(x) { return x.id === id; });
  if (!confirm('Delete "' + (l ? l.address : 'this listing') + '"? This cannot be undone.')) return;
  db.collection('listings').doc(id).delete().catch(function(err) { alert('Error: ' + err.message); });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function esc(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function formatTime(ts) {
  if (!ts) return '';
  var d = ts.toDate ? ts.toDate() : new Date(ts);
  var diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function friendlyAuthError(code) {
  var m = { 'auth/user-not-found': 'No account found with that email.', 'auth/wrong-password': 'Incorrect password.', 'auth/email-already-in-use': 'An account with this email already exists.', 'auth/weak-password': 'Password must be at least 6 characters.', 'auth/invalid-email': 'Please enter a valid email address.', 'auth/too-many-requests': 'Too many attempts. Please try again later.' };
  return m[code] || 'An error occurred. Please try again.';
}

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var a = document.querySelector('.auth-view.active');
  if (!a) return;
  if (a.id === 'authLogin') doLogin();
  if (a.id === 'authSignup') doSignup();
  if (a.id === 'authReset') doReset();
});

document.querySelectorAll('.modal-backdrop').forEach(function(bd) {
  bd.addEventListener('click', function(e) {
    if (e.target === bd && bd.id !== 'profileSetupModal') bd.classList.remove('open');
  });
});
