// ─────────────────────────────────────────────────────────────────────────────
// DormDrop — Landlord Portal Logic
// ─────────────────────────────────────────────────────────────────────────────

/* global firebase, FIREBASE_CONFIG */

// ── Firebase Init ─────────────────────────────────────────────────────────────
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

// ── Auth Listener ─────────────────────────────────────────────────────────────
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

// ── Load Landlord Profile ─────────────────────────────────────────────────────
function loadLandlordProfile(uid) {
  db.collection('landlords').doc(uid).get().then(function(snap) {
    if (snap.exists) {
      landlordProfile = snap.data();
      applyProfileToUI();
      showAppShell();
      initDashboard();
    } else {
      // First login — show profile setup
      showAppShell();
      document.getElementById('profileSetupModal').classList.add('open');
      if (currentUser.displayName) {
        document.getElementById('pName').value = currentUser.displayName;
      }
      document.getElementById('sidebarName').textContent = currentUser.email;
      document.getElementById('sidebarAvatar').textContent = '?';
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
  document.getElementById('sidebarName').textContent    = name;
  document.getElementById('sidebarAvatar').textContent  = name.charAt(0).toUpperCase();
}

// ── Save Profile ──────────────────────────────────────────────────────────────
function saveProfile() {
  var name    = document.getElementById('pName').value.trim();
  var company = document.getElementById('pCompany').value.trim();
  var phone   = document.getElementById('pPhone').value.trim();
  var errEl   = document.getElementById('profileSetupError');
  errEl.style.display = 'none';

  if (!name) {
    errEl.textContent = 'Please enter your full name.';
    errEl.style.display = 'block';
    return;
  }

  var data = {
    name:      name,
    company:   company,
    phone:     phone,
    email:     currentUser.email,
    uid:       currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  db.collection('landlords').doc(currentUser.uid).set(data).then(function() {
    landlordProfile = data;
    applyProfileToUI();
    document.getElementById('profileSetupModal').classList.remove('open');
    initDashboard();
  }).catch(function(err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  });
}

// ── Auth: Login ───────────────────────────────────────────────────────────────
function doLogin() {
  var email    = document.getElementById('loginEmail').value.trim();
  var password = document.getElementById('loginPassword').value;
  var errEl    = document.getElementById('loginError');
  errEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password.';
    errEl.style.display = 'block';
    return;
  }

  auth.signInWithEmailAndPassword(email, password).catch(function(err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.style.display = 'block';
  });
}

// ── Auth: Signup ──────────────────────────────────────────────────────────────
function doSignup() {
  var name     = document.getElementById('signupName').value.trim();
  var email    = document.getElementById('signupEmail').value.trim();
  var password = document.getElementById('signupPassword').value;
  var errEl    = document.getElementById('signupError');
  errEl.style.display = 'none';

  if (!name || !email || !password) {
    errEl.textContent = 'All fields are required.';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    errEl.style.display = 'block';
    return;
  }

  auth.createUserWithEmailAndPassword(email, password).then(function(cred) {
    return cred.user.updateProfile({ displayName: name });
  }).catch(function(err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.style.display = 'block';
  });
}

// ── Auth: Reset Password ──────────────────────────────────────────────────────
function doReset() {
  var email   = document.getElementById('resetEmail').value.trim();
  var errEl   = document.getElementById('resetError');
  var succEl  = document.getElementById('resetSuccess');
  errEl.style.display  = 'none';
  succEl.style.display = 'none';

  if (!email) {
    errEl.textContent = 'Please enter your email address.';
    errEl.style.display = 'block';
    return;
  }

  auth.sendPasswordResetEmail(email).then(function() {
    succEl.textContent = 'Reset link sent! Check your inbox.';
    succEl.style.display = 'block';
  }).catch(function(err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.style.display = 'block';
  });
}

// ── Auth: Sign Out ────────────────────────────────────────────────────────────
function doSignOut() {
  auth.signOut();
}

// ── Auth Tab Switcher ─────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  ['login','signup','reset'].forEach(function(t) {
    document.getElementById('auth' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  document.querySelectorAll('.auth-tab').forEach(function(btn, i) {
    btn.classList.toggle('active', i === (['login','signup','reset'].indexOf(tab)));
  });
}

// ── Page Navigation ───────────────────────────────────────────────────────────
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

// ── Init Dashboard ────────────────────────────────────────────────────────────
function initDashboard() {
  loadListings();
  loadInterests();
}

// ── Load Listings from Firestore ──────────────────────────────────────────────
function loadListings() {
  if (!currentUser) return;
  db.collection('listings')
    .where('landlordUid', '==', currentUser.uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot(function(snap) {
      allListings = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      updateStatCards();
      renderListingsTable();
      renderRecentInterests();
    }, function(err) {
      console.error('Listings snapshot error:', err);
    });
}

// ── Load Interests from Firestore ─────────────────────────────────────────────
function loadInterests() {
  if (!currentUser) return;
  db.collection('interests')
    .where('landlordUid', '==', currentUser.uid)
    .orderBy('createdAt', 'desc')
    .onSnapshot(function(snap) {
      allInterests = snap.docs.map(function(d) { return Object.assign({ id: d.id }, d.data()); });
      updateInterestBadge();
      updateStatCards();
      renderInterestsGrid();
      renderRecentInterests();
    }, function(err) {
      console.error('Interests snapshot error:', err);
    });
}

// ── Stat Cards ────────────────────────────────────────────────────────────────
function updateStatCards() {
  var total    = allListings.length;
  var active   = allListings.filter(function(l) { return l.status === 'active'; }).length;
  var total_i  = allInterests.length;
  var now      = Date.now();
  var week     = 7 * 24 * 60 * 60 * 1000;
  var newThisWeek = allInterests.filter(function(i) {
    if (!i.createdAt) return false;
    var ts = i.createdAt.toDate ? i.createdAt.toDate().getTime() : i.createdAt;
    return (now - ts) < week;
  }).length;

  document.getElementById('statTotal').textContent    = total;
  document.getElementById('statActive').textContent   = active;
  document.getElementById('statInterests').textContent = total_i;
  document.getElementById('statNew').textContent      = newThisWeek;
}

function updateInterestBadge() {
  var newCount = allInterests.filter(function(i) { return i.status === 'new'; }).length;
  var badge = document.getElementById('interestBadge');
  if (newCount > 0) {
    badge.textContent   = newCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ── Render Listings Table ─────────────────────────────────────────────────────
function filterListings(school, el) {
  listingFilter = school;
  document.querySelectorAll('#listingFilters .chip').forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  renderListingsTable();
}

function renderListingsTable() {
  var tbody = document.getElementById('listingsTableBody');
  if (!tbody) return;

  var filtered = listingFilter === 'all'
    ? allListings
    : allListings.filter(function(l) { return l.school === listingFilter; });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🏡</div><h3>No listings yet</h3><p>Click "+ Add Listing" to post your first property.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(l) {
    var availStr = l.availableDate || '—';
    var interestCount = allInterests.filter(function(i) { return i.listingId === l.id; }).length;
    return '<tr>' +
      '<td><strong>' + esc(l.address) + '</strong></td>' +
      '<td>' + esc(l.school || '—') + '</td>' +
      '<td>$' + Number(l.monthlyRent || 0).toLocaleString() + '</td>' +
      '<td>' + (l.beds || '—') + ' bd / ' + (l.baths || '—') + ' ba</td>' +
      '<td>' + esc(availStr) + '</td>' +
      '<td><span class="badge ' + (l.status === 'active' ? 'badge-active' : 'badge-inactive') + '">' + (l.status || 'inactive') + '</span></td>' +
      '<td>' + interestCount + ' student' + (interestCount !== 1 ? 's' : '') + '</td>' +
      '<td><div class="table-actions">' +
        '<button class="btn-sm btn-edit" onclick="openEditListing(\'' + l.id + '\')">Edit</button>' +
        '<button class="btn-sm ' + (l.status === 'active' ? 'btn-toggle-inactive' : 'btn-toggle-active') + '" onclick="toggleListingStatus(\'' + l.id + '\',\'' + l.status + '\')">' + (l.status === 'active' ? 'Deactivate' : 'Activate') + '</button>' +
        '<button class="btn-sm btn-delete" onclick="deleteListing(\'' + l.id + '\')">Delete</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

// ── Render Interests ──────────────────────────────────────────────────────────
function filterInterests(filter, el) {
  interestFilter = filter;
  document.querySelectorAll('#interestFilters .chip').forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  renderInterestsGrid();
}

function renderInterestsGrid() {
  var grid = document.getElementById('interestsGrid');
  if (!grid) return;

  var filtered = interestFilter === 'all'
    ? allInterests
    : allInterests.filter(function(i) { return i.status === interestFilter; });

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⭐</div><h3>No ' + (interestFilter === 'all' ? '' : interestFilter + ' ') + 'inquiries</h3><p>Student inquiries about your listings will appear here.</p></div>';
    return;
  }

  grid.innerHTML = filtered.map(function(item) {
    var initials = (item.studentName || item.studentEmail || '?').charAt(0).toUpperCase();
    var timeStr  = formatTime(item.createdAt);
    var badgeCls = item.status === 'new' ? 'badge-new' : 'badge-viewed';
    var msgHtml  = item.message ? '<div class="interest-message">' + esc(item.message) + '</div>' : '';
    var schoolStr = [item.studentSchool, item.studentYear].filter(Boolean).join(' · ');

    return '<div class="interest-card">' +
      '<div class="interest-card-header">' +
        '<div class="interest-student">' +
          '<div class="student-avatar">' + initials + '</div>' +
          '<div>' +
            '<div class="student-name">' + esc(item.studentName || 'Student') + '</div>' +
            '<div class="student-meta">' + esc(schoolStr) + '</div>' +
          '</div>' +
        '</div>' +
        '<span class="badge ' + badgeCls + '">' + (item.status || 'new') + '</span>' +
      '</div>' +
      '<div class="interest-listing">Interested in: <strong>' + esc(item.listingAddress || 'Unknown listing') + '</strong></div>' +
      msgHtml +
      '<div class="interest-footer">' +
        '<span class="interest-time">' + timeStr + '</span>' +
        '<a class="btn-contact" href="mailto:' + esc(item.studentEmail || '') + '">Email Student</a>' +
      '</div>' +
    '</div>';
  }).join('');

  // Mark new items as viewed
  filtered.filter(function(i) { return i.status === 'new'; }).forEach(function(item) {
    db.collection('interests').doc(item.id).update({ status: 'viewed' }).catch(function() {});
  });
}

function renderRecentInterests() {
  var wrap = document.getElementById('recentInterestWrap');
  if (!wrap) return;
  var recent = allInterests.slice(0, 3);
  if (recent.length === 0) {
    wrap.innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><h3>No interest yet</h3><p>Student inquiries will appear here.</p></div>';
    return;
  }
  var tempGrid = document.createElement('div');
  tempGrid.className = 'interests-grid';
  tempGrid.innerHTML = recent.map(function(item) {
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
      '<div class="interest-listing">Interested in: <strong>' + esc(item.listingAddress || 'Unknown listing') + '</strong></div>' +
      msgHtml +
      '<div class="interest-footer"><span class="interest-time">' + timeStr + '</span>' +
        '<a class="btn-contact" href="mailto:' + esc(item.studentEmail || '') + '">Email</a>' +
      '</div>' +
    '</div>';
  }).join('');
  wrap.innerHTML = '';
  wrap.appendChild(tempGrid);
}

// ── Add / Edit Listing Modal ──────────────────────────────────────────────────
function openAddListing() {
  editingListingId = null;
  amenities = [];
  photos    = [];
  document.getElementById('listingModalTitle').textContent = 'Add New Listing';
  document.getElementById('listingFormError').style.display = 'none';
  clearListingForm();
  document.getElementById('listingModal').classList.add('open');
  showPage('listings');
}

function openEditListing(id) {
  var listing = allListings.find(function(l) { return l.id === id; });
  if (!listing) return;

  editingListingId = id;
  amenities = listing.amenities ? listing.amenities.slice() : [];
  photos    = listing.photos    ? listing.photos.slice()    : [];

  document.getElementById('listingModalTitle').textContent  = 'Edit Listing';
  document.getElementById('listingFormError').style.display = 'none';
  document.getElementById('fAddress').value     = listing.address      || '';
  document.getElementById('fRent').value        = listing.monthlyRent  || '';
  document.getElementById('fSchool').value      = listing.school       || '';
  document.getElementById('fBeds').value        = listing.beds         || '';
  document.getElementById('fBaths').value       = listing.baths        || '';
  document.getElementById('fSqft').value        = listing.sqft         || '';
  document.getElementById('fAvailable').value   = listing.availableDate|| '';
  document.getElementById('fDescription').value = listing.description  || '';
  document.getElementById('fFurnished').value   = listing.furnished    || 'no';
  document.getElementById('fStatus').value      = listing.status       || 'active';

  renderAmenityTags();
  renderPhotoTags();
  document.getElementById('listingModal').classList.add('open');
}

function closeListingModal() {
  document.getElementById('listingModal').classList.remove('open');
  editingListingId = null;
}

function clearListingForm() {
  ['fAddress','fRent','fBeds','fBaths','fSqft','fDescription','amenityInput','photoInput'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('fSchool').value    = '';
  document.getElementById('fFurnished').value = 'no';
  document.getElementById('fStatus').value    = 'active';
  document.getElementById('fAvailable').value = '';
  renderAmenityTags();
  renderPhotoTags();
}

// ── Amenity Tags ──────────────────────────────────────────────────────────────
function addAmenity() {
  var val = document.getElementById('amenityInput').value.trim();
  if (!val) return;
  if (!amenities.includes(val)) amenities.push(val);
  document.getElementById('amenityInput').value = '';
  renderAmenityTags();
}

function removeAmenity(idx) {
  amenities.splice(idx, 1);
  renderAmenityTags();
}

function renderAmenityTags() {
  document.getElementById('amenityTags').innerHTML = amenities.map(function(a, i) {
    return '<span class="tag">' + esc(a) + ' <span class="tag-remove" onclick="removeAmenity(' + i + ')">×</span></span>';
  }).join('');
}

// ── Photo Tags ────────────────────────────────────────────────────────────────
function addPhoto() {
  var val = document.getElementById('photoInput').value.trim();
  if (!val) return;
  if (!photos.includes(val)) photos.push(val);
  document.getElementById('photoInput').value = '';
  renderPhotoTags();
}

function removePhoto(idx) {
  photos.splice(idx, 1);
  renderPhotoTags();
}

function renderPhotoTags() {
  document.getElementById('photoTags').innerHTML = photos.map(function(p, i) {
    var short = p.length > 40 ? '…' + p.slice(-30) : p;
    return '<span class="tag photo-tag">' + esc(short) + ' <span class="tag-remove" onclick="removePhoto(' + i + ')">×</span></span>';
  }).join('');
}

// ── Save Listing to Firestore ─────────────────────────────────────────────────
function saveListing() {
  var errEl = document.getElementById('listingFormError');
  errEl.style.display = 'none';

  var address   = document.getElementById('fAddress').value.trim();
  var rent      = document.getElementById('fRent').value.trim();
  var school    = document.getElementById('fSchool').value;
  var beds      = document.getElementById('fBeds').value.trim();
  var baths     = document.getElementById('fBaths').value.trim();
  var sqft      = document.getElementById('fSqft').value.trim();
  var available = document.getElementById('fAvailable').value;
  var desc      = document.getElementById('fDescription').value.trim();
  var furnished = document.getElementById('fFurnished').value;
  var status    = document.getElementById('fStatus').value;

  if (!address || !rent || !school || !beds || !baths || !available) {
    errEl.textContent = 'Please fill in all required fields (marked with *).';
    errEl.style.display = 'block';
    return;
  }

  var saveBtn = document.getElementById('saveListingBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  var data = {
    address:       address,
    monthlyRent:   Number(rent),
    school:        school,
    beds:          Number(beds),
    baths:         Number(baths),
    sqft:          sqft ? Number(sqft) : null,
    availableDate: available,
    description:   desc,
    furnished:     furnished,
    status:        status,
    amenities:     amenities,
    photos:        photos,
    landlordUid:   currentUser.uid,
    landlordName:  (landlordProfile && landlordProfile.name)    ? landlordProfile.name    : (currentUser.displayName || ''),
    landlordEmail: currentUser.email,
    landlordPhone: (landlordProfile && landlordProfile.phone)   ? landlordProfile.phone   : '',
    updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
  };

  var promise;
  if (editingListingId) {
    promise = db.collection('listings').doc(editingListingId).update(data);
  } else {
    data.createdAt     = firebase.firestore.FieldValue.serverTimestamp();
    data.views         = 0;
    data.interestCount = 0;
    promise = db.collection('listings').add(data);
  }

  promise.then(function() {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Listing';
    closeListingModal();
  }).catch(function(err) {
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save Listing';
    errEl.textContent   = err.message;
    errEl.style.display = 'block';
  });
}

// ── Toggle Listing Status ─────────────────────────────────────────────────────
function toggleListingStatus(id, currentStatus) {
  var newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  db.collection('listings').doc(id).update({
    status:    newStatus,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function(err) { alert('Error: ' + err.message); });
}

// ── Delete Listing ────────────────────────────────────────────────────────────
function deleteListing(id) {
  var listing = allListings.find(function(l) { return l.id === id; });
  var addr    = listing ? listing.address : 'this listing';
  if (!confirm('Delete "' + addr + '"? This cannot be undone.')) return;

  db.collection('listings').doc(id).delete()
    .catch(function(err) { alert('Error deleting listing: ' + err.message); });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(ts) {
  if (!ts) return '';
  var d = ts.toDate ? ts.toDate() : new Date(ts);
  var now = new Date();
  var diff = Math.floor((now - d) / 1000);
  if (diff < 60)   return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function friendlyAuthError(code) {
  var msgs = {
    'auth/user-not-found':      'No account found with that email address.',
    'auth/wrong-password':      'Incorrect password. Please try again.',
    'auth/email-already-in-use':'An account with this email already exists.',
    'auth/weak-password':       'Password should be at least 6 characters.',
    'auth/invalid-email':       'Please enter a valid email address.',
    'auth/too-many-requests':   'Too many failed attempts. Please try again later.',
    'auth/network-request-failed': 'Network error. Check your connection and try again.'
  };
  return msgs[code] || 'An error occurred. Please try again.';
}

// Keyboard support for auth inputs
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var active = document.querySelector('.auth-view.active');
  if (!active) return;
  if (active.id === 'authLogin')  doLogin();
  if (active.id === 'authSignup') doSignup();
  if (active.id === 'authReset')  doReset();
});

// Close modal on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(function(bd) {
  bd.addEventListener('click', function(e) {
    if (e.target === bd && bd.id !== 'profileSetupModal') {
      bd.classList.remove('open');
    }
  });
});
