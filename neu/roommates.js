'use strict';
/* =============================================================
   DormDrop — Auth, Listings, Roommate Matching & Chat (Firebase)
   Schema: users (profile nested), listings, matches, messages subcollection
   ============================================================= */

var db, auth;
var currentUser = null;
var myUserDoc = null;
var myProfile = null;
var convUnsub = null;
var msgUnsub = null;
var activeMatchId = null;
var activeOtherUid = null;
var quizAnswers = {};
var listingsUnsub = null;

var DEMO_LISTINGS = [];
var firestoreListings = [];

var SCHOOL_KEY = 'bu';
var SCHOOL_NAME = 'Boston University';
var EMAIL_SUFFIX = '@bu.edu';

(function initSchoolContext() {
  var p = window.location.pathname || '';
  if (p.indexOf('/neu') !== -1) {
    SCHOOL_KEY = 'neu';
    SCHOOL_NAME = 'Northeastern University';
    EMAIL_SUFFIX = '@northeastern.edu';
  } else if (p.indexOf('/merrimack') !== -1) {
    SCHOOL_KEY = 'merrimack';
    SCHOOL_NAME = 'Merrimack College';
    EMAIL_SUFFIX = '@merrimack.edu';
  } else {
    SCHOOL_KEY = 'bu';
    SCHOOL_NAME = 'Boston University';
    EMAIL_SUFFIX = '@bu.edu';
  }
})();

document.addEventListener('DOMContentLoaded', function () {
  if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey) {
    console.info('DormDrop: Firebase config missing.');
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
    auth = firebase.auth();
    auth.onAuthStateChanged(onAuthChange);
    window.sendMsgBtn = function () {};
    window.sendMsg = function () {};
    if (typeof listings !== 'undefined' && Array.isArray(listings)) {
      DEMO_LISTINGS = listings.slice();
    }
    subscribeSchoolListings();
    setRoommateLoading();
  } catch (e) {
    console.error('Firebase init error:', e);
  }
});

function subscribeSchoolListings() {
  if (listingsUnsub) listingsUnsub();
  firestoreListings = [];
  listingsUnsub = db
    .collection('listings')
    .where('school', '==', SCHOOL_KEY)
    .where('active', '==', true)
    .limit(30)
    .onSnapshot(
      function (snap) {
        firestoreListings = snap.docs
          .map(function (d) {
            return Object.assign({ id: d.id, _fs: true }, d.data());
          })
          .sort(function (a, b) {
            var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
            var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
            return tb - ta;
          });
        updateListingCountStat(firestoreListings.length);
        var activeBtn = document.querySelector('.filter-btn.active');
        var f = activeBtn ? activeBtn.getAttribute('data-filter') || 'all' : 'all';
        if (!activeBtn) f = 'all';
        renderListings(f);
      },
      function (e) {
        console.error('Listings listener:', e);
        var activeBtn = document.querySelector('.filter-btn.active');
        var f = activeBtn ? activeBtn.getAttribute('data-filter') || 'all' : 'all';
        renderListings(f);
      }
    );
}

function mergedListings() {
  var out = firestoreListings.map(fsToCard);
  var ids = {};
  out.forEach(function (x) {
    ids[String(x.id)] = true;
  });
  DEMO_LISTINGS.forEach(function (d) {
    if (!ids[String(d.id)]) out.push(d);
  });
  return out;
}

function fsToCard(l) {
  var beds = l.bedrooms || 2;
  var per =
    beds > 1
      ? '/mo per person'
      : '/mo';
  var rent = l.rent || 0;
  var rpp = l.rentPerPerson || Math.round(rent / Math.max(1, beds));
  var priceStr = '$' + rpp.toLocaleString();
  var addr = l.address + (l.city ? ', ' + l.city : '');
  var tags = [];
  if (beds) tags.push(beds + ' Bed');
  if (l.bathrooms) tags.push(l.bathrooms + ' Bath');
  if (l.neighborhood) tags.push(l.neighborhood);
  if (l.furnished) tags.push('Furnished');
  if (l.source === 'zillow-scraped') tags.push('Zillow');
  var img = l.photos && l.photos[0] ? l.photos[0] : null;
  return {
    id: 'fs_' + l.id,
    _listingId: l.id,
    bg: 'li-' + ((beds % 6) + 1),
    em: '🏠',
    badge: l.source === 'zillow-scraped' ? 'New' : 'Listed',
    bc: 'b-new',
    price: priceStr,
    per: per,
    addr: addr,
    beds: beds,
    baths: l.bathrooms || 1,
    sqft: l.squareFeet || 0,
    avail: l.availableDate || '—',
    tags: tags,
    saving: 'Listed on DormDrop',
    savN: 0,
    desc: l.description || '',
    type: beds === 1 ? '1br' : beds === 2 ? '2br' : '3br',
    furnished: !!l.furnished,
    img: img,
    _fsListing: l
  };
}

function setRoommateLoading() {
  var pg = document.getElementById('pGrid');
  if (pg)
    pg.innerHTML =
      '<div class="rm-state-box"><div class="rm-spinner">&#8635;</div><div class="rm-state-txt">Loading matches&hellip;</div></div>';
  var ml = document.getElementById('msgList');
  if (ml) ml.innerHTML = '<p class="conv-empty">Sign in to view messages</p>';
  var ic = document.getElementById('inlineCompose');
  if (ic) ic.style.display = 'none';
}

function onAuthChange(user) {
  currentUser = user;
  updateNav(user);
  if (!user) {
    myUserDoc = null;
    myProfile = null;
    if (convUnsub) {
      convUnsub();
      convUnsub = null;
    }
    if (msgUnsub) {
      msgUnsub();
      msgUnsub = null;
    }
    renderLoggedOutState();
    return;
  }
  user.reload().then(function () {
    return db
      .collection('users')
      .doc(user.uid)
      .get();
  }).then(function (snap) {
    if (snap.exists) {
      myUserDoc = snap.data();
      myProfile = myUserDoc.profile || {};
      if (user.emailVerified !== myUserDoc.emailVerified) {
        db.collection('users').doc(user.uid).update({ emailVerified: !!user.emailVerified });
      }
      loadMatches();
      subscribeMatches();
    } else {
      myUserDoc = null;
      myProfile = null;
      renderNeedsProfileState();
    }
  }).catch(function (e) {
    console.error('Profile load error:', e);
    renderLoggedOutState();
  });
}

function updateNav(user) {
  var loginBtn = document.getElementById('navLoginBtn');
  var signupBtn = document.getElementById('navSignupBtn');
  if (!loginBtn || !signupBtn) return;
  if (user) {
    var name = user.displayName || (user.email ? user.email.split('@')[0] : 'Account');
    loginBtn.textContent = name;
    loginBtn.onclick = function () {
      if (confirm('Sign out of DormDrop?')) auth.signOut();
    };
    signupBtn.textContent = 'Sign Out';
    signupBtn.className = 'btn-ghost';
    signupBtn.onclick = function () {
      auth.signOut();
    };
  } else {
    loginBtn.textContent = 'Log in';
    loginBtn.onclick = function () {
      openAuthModal('login');
    };
    signupBtn.textContent = 'Get Started';
    signupBtn.className = 'btn-solid';
    signupBtn.onclick = function () {
      openAuthModal('signup');
    };
  }
}

function openAuthModal(mode) {
  clearAuthError();
  document.getElementById('signupModal').classList.add('open');
  showAuthView(mode === 'login' ? 'loginFields' : 'signupFields');
}

function showAuthView(viewId) {
  ['signupFields', 'loginFields', 'forgotFields', 'verifyFields'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? '' : 'none';
  });
  var sub = '';
  if (viewId === 'signupFields') sub = 'Free for all ' + SCHOOL_NAME + ' students. No credit card required.';
  if (viewId === 'loginFields') sub = 'Sign in to your DormDrop account.';
  if (viewId === 'forgotFields') sub = 'We\'ll send a reset link to your school email.';
  if (viewId === 'verifyFields') sub = 'One last step — check your inbox.';
  var ms = document.getElementById('authModalSub');
  if (ms && sub) ms.textContent = sub;
  clearAuthError();
}

function doSignup() {
  var name = val('authName');
  var email = val('authEmail');
  var pwd = val('authPwd');
  var yearSel = document.getElementById('authYear');
  var year = yearSel ? yearSel.value : 'Freshman';
  if (!name || !email || !pwd) {
    showAuthError('Please fill in all fields.');
    return;
  }
  if (!email.toLowerCase().endsWith(EMAIL_SUFFIX)) {
    showAuthError('Please use your ' + EMAIL_SUFFIX + ' email address.');
    return;
  }
  if (pwd.length < 6) {
    showAuthError('Password must be at least 6 characters.');
    return;
  }
  setAuthBtnLoading(true, 'signupBtn', 'Creating account\u2026');
  auth
    .createUserWithEmailAndPassword(email, pwd)
    .then(function (cred) {
      return cred.user.updateProfile({ displayName: name }).then(function () {
        return cred.user.sendEmailVerification();
      }).then(function () {
        var y = yearToSlug(year);
        return db.collection('users').doc(cred.user.uid).set({
          email: email,
          name: name,
          school: SCHOOL_KEY,
          accountType: 'student',
          emailVerified: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          profile: {
            year: y,
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
      });
    })
    .then(function () {
      showAuthView('verifyFields');
    })
    .catch(function (e) {
      showAuthError(friendlyAuthError(e.code));
    })
    .finally(function () {
      setAuthBtnLoading(false, 'signupBtn', 'Create Account');
    });
}

function yearToSlug(year) {
  var y = String(year || '').toLowerCase();
  if (y.indexOf('graduate') !== -1) return 'graduate';
  if (y.indexOf('freshman') !== -1) return 'freshman';
  if (y.indexOf('sophomore') !== -1) return 'sophomore';
  if (y.indexOf('junior') !== -1) return 'junior';
  if (y.indexOf('senior') !== -1) return 'senior';
  return 'freshman';
}

function doLogin() {
  var email = val('loginEmail');
  var pwd = val('loginPwd');
  if (!email || !pwd) {
    showAuthError('Please enter your email and password.');
    return;
  }
  setAuthBtnLoading(true, 'loginBtn', 'Signing in\u2026');
  auth
    .signInWithEmailAndPassword(email, pwd)
    .then(function (cred) {
      return db.collection('users').doc(cred.user.uid).get();
    })
    .then(function (snap) {
      if (!snap || !snap.exists) {
        closeModal('signupModal');
        return;
      }
      var data = snap.data();
      if (data.accountType === 'landlord') {
        window.location.href = '/landlord-dashboard.html';
        return;
      }
      var p = data.profile || {};
      var complete = p.major && p.sleepSchedule && p.studyHabits;
      if (!complete) {
        window.location.href = '/profile-setup.html';
      } else {
        window.location.href = '/dashboard.html';
      }
    })
    .catch(function (e) {
      showAuthError(friendlyAuthError(e.code));
    })
    .finally(function () {
      setAuthBtnLoading(false, 'loginBtn', 'Log In');
    });
}

function doResetPassword() {
  var email = val('forgotEmail');
  if (!email) {
    showAuthError('Please enter your email address.');
    return;
  }
  auth
    .sendPasswordResetEmail(email)
    .then(function () {
      showAuthError('Reset link sent — check your inbox!', true);
    })
    .catch(function (e) {
      showAuthError(friendlyAuthError(e.code));
    });
}

function friendlyAuthError(code) {
  var map = {
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/invalid-email': 'Invalid email address.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}

function showAuthError(msg, success) {
  var el = document.getElementById('authError');
  if (!el) return;
  el.textContent = msg;
  el.style.color = success ? 'var(--teal)' : '#DC2626';
  el.style.display = 'block';
}
function clearAuthError() {
  var el = document.getElementById('authError');
  if (el) el.style.display = 'none';
}
function setAuthBtnLoading(on, btnId, label) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = on;
  btn.textContent = on ? label : btn.dataset.label || label;
}

function renderLoggedOutState() {
  var pg = document.getElementById('pGrid');
  if (pg)
    pg.innerHTML =
      '<div class="rm-state-box">' +
      '<div style="font-size:36px;margin-bottom:12px">&#128075;</div>' +
      '<div class="rm-state-title">Find your perfect roommate</div>' +
      '<p class="rm-state-desc">Create a free account to see students who match your lifestyle.</p>' +
      '<button class="btn-primary rm-state-btn" onclick="openAuthModal(\'signup\')">Sign Up &mdash; It\'s Free</button>' +
      '</div>';
  var ml = document.getElementById('msgList');
  if (ml) ml.innerHTML = '<p class="conv-empty">Sign in to view messages</p>';
  var ic = document.getElementById('inlineCompose');
  if (ic) ic.style.display = 'none';
}

function renderNeedsProfileState() {
  var pg = document.getElementById('pGrid');
  if (pg)
    pg.innerHTML =
      '<div class="rm-state-box">' +
      '<div style="font-size:36px;margin-bottom:12px">&#128203;</div>' +
      '<div class="rm-state-title">Complete your profile</div>' +
      '<p class="rm-state-desc">Tell us about your lifestyle so we can find your best matches.</p>' +
      '<button class="btn-primary rm-state-btn" onclick="window.location.href=\'/profile-setup.html\'">Set Up My Profile</button>' +
      '</div>';
}

function mapSocialToProfile(v) {
  if (v === 'outgoing') return 'very-social';
  if (v === 'quiet') return 'introverted';
  return v;
}
function mapCleanToProfile(v) {
  if (v === 'tidy') return 'very-clean';
  if (v === 'organized-chaos') return 'relaxed';
  return v;
}
function mapPetsToProfile(v) {
  if (v === 'pet-friendly') return 'ok-with-pets';
  if (v === 'no-pets') return 'no-pets';
  return v;
}
function mapGuestsToProfile(v) {
  if (v === 'fine-with-guests') return 'often';
  if (v === 'prefer-quiet') return 'prefer-quiet';
  return v;
}

function calcScoreFromProfiles(a, b) {
  var p1 = a.profile || a;
  var p2 = b.profile || b;
  return calcScoreCompat(p1, p2);
}

function calcScoreCompat(p1, p2) {
  var score = 0;
  if (p1.sleepSchedule === p2.sleepSchedule) score += 20;
  else if (p1.sleepSchedule === 'flexible' || p2.sleepSchedule === 'flexible') score += 10;
  if (p1.studyHabits === p2.studyHabits) score += 15;
  else if (p1.studyHabits === 'flexible' || p2.studyHabits === 'flexible') score += 8;
  if (p1.socialStyle === p2.socialStyle) score += 15;
  else if (p1.socialStyle === 'flexible' || p2.socialStyle === 'flexible') score += 8;
  if (p1.cleanliness === p2.cleanliness) score += 20;
  else if (p1.cleanliness === 'flexible' || p2.cleanliness === 'flexible') score += 10;
  if (p1.pets === p2.pets) score += 10;
  if (p1.guests === p2.guests) score += 10;
  var b1 = parseInt(p1.budget, 10) || 0;
  var b2 = parseInt(p2.budget, 10) || 0;
  var bd = Math.abs(b1 - b2);
  if (bd < 100) score += 10;
  else if (bd < 300) score += 5;
  return Math.min(100, score);
}

function legacyCalcScore(a, b) {
  var score = 0;
  if (a.sleepSchedule === b.sleepSchedule) score += 25;
  if (a.studyHabits === b.studyHabits) score += 20;
  if (a.socialPreferences === b.socialPreferences) score += 20;
  if (a.cleanliness === b.cleanliness) score += 20;
  if (a.pets === b.pets) score += 10;
  if (a.guestsParties === b.guestsParties) score += 5;
  return score;
}

function loadMatches() {
  if (!myUserDoc || myUserDoc.accountType !== 'student') return;
  var pg = document.getElementById('pGrid');
  if (pg)
    pg.innerHTML =
      '<div class="rm-state-box"><div class="rm-spinner">&#8635;</div><div class="rm-state-txt">Finding your matches&hellip;</div></div>';

  db.collection('users')
    .where('school', '==', SCHOOL_KEY)
    .where('accountType', '==', 'student')
    .limit(200)
    .get()
    .then(function (snap) {
      var matches = [];
      var me = { profile: myProfile, uid: currentUser.uid };
      snap.forEach(function (doc) {
        if (doc.id === currentUser.uid) return;
        var data = doc.data();
        if (data.emailVerified !== true) return;
        var p = Object.assign({ uid: doc.id }, data);
        var score = calcScoreFromProfiles(me, p);
        if (score >= 70) matches.push(Object.assign({ score: score }, p));
      });
      matches.sort(function (a, b) {
        return b.score - a.score;
      });
      renderMatchCards(matches);
    })
    .catch(function (e) {
      console.error('Match load error:', e);
      if (pg) pg.innerHTML = '<div class="rm-state-box"><p class="rm-state-desc">Could not load matches. Please refresh.</p></div>';
    });
}

var GRADIENTS = [
  'linear-gradient(135deg,#0E6E6E,#14A3A3)',
  'linear-gradient(135deg,#B45309,#D97706)',
  'linear-gradient(135deg,#374151,#6B7280)',
  'linear-gradient(135deg,#065F46,#059669)',
  'linear-gradient(135deg,#4F46E5,#7C3AED)',
  'linear-gradient(135deg,#BE185D,#EC4899)'
];

function renderMatchCards(matches) {
  var pg = document.getElementById('pGrid');
  if (!pg) return;
  if (matches.length === 0) {
    pg.innerHTML =
      '<div class="rm-state-box">' +
      '<div style="font-size:36px;margin-bottom:12px">&#128269;</div>' +
      '<div class="rm-state-title">No matches yet</div>' +
      '<p class="rm-state-desc">Be among the first! As more students join, your matches will appear here.</p>' +
      '</div>';
    return;
  }
  pg.innerHTML = matches.map(function (p, i) {
    var prof = p.profile || {};
    var initials = p.name
      ? p.name
          .split(' ')
          .map(function (n) {
            return n[0];
          })
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : '?';
    var grad = GRADIENTS[i % GRADIENTS.length];
    var cls = p.score >= 85 ? 'mp-hi' : 'mp-md';
    var traits = topTraitsFromProfile(prof, 3);
    var yearLabel = prof.year ? capitalize(prof.year) : '';
    var info = yearLabel + (prof.major ? ' · ' + prof.major : '');
    return (
      '<div class="p-card" onclick="openMatchDetail(\'' +
      p.uid +
      '\')">' +
      '<div class="p-av" style="background:' +
      grad +
      '">' +
      initials +
      '</div>' +
      '<div class="p-name">' +
      esc(p.name) +
      '</div>' +
      '<div class="p-info">' +
      esc(info) +
      '</div>' +
      '<span class="mp ' +
      cls +
      '">' +
      p.score +
      '% Match</span>' +
      '<div class="p-traits">' +
      traits
        .map(function (t) {
          return '<span class="p-trait">' + t + '</span>';
        })
        .join('') +
      '</div>' +
      '</div>'
    );
  }).join('');
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

var TRAIT_MAP = {
  sleepSchedule: {
    'night-owl': '&#127769; Night Owl',
    'early-riser': '&#9728;&#65039; Early Riser',
    flexible: '&#128260; Flexible'
  },
  studyHabits: {
    'at-home': '&#128218; Studies at Home',
    'on-campus': '&#127979; On Campus',
    flexible: '&#128260; Flexible'
  },
  socialStyle: {
    'very-social': '&#127881; Very Social',
    'somewhat-social': '&#128522; Social',
    introverted: '&#128218; Introverted',
    flexible: '&#128260; Flexible'
  },
  cleanliness: {
    'very-clean': '&#10024; Very Clean',
    organized: '&#128203; Organized',
    relaxed: '&#128524; Relaxed',
    flexible: '&#128260; Flexible'
  },
  pets: {
    'love-pets': '&#128062; Loves Pets',
    'ok-with-pets': '&#128062; OK with Pets',
    'no-pets': '&#128683; No Pets'
  },
  guests: {
    often: '&#127881; Guests Often',
    sometimes: '&#128101; Sometimes',
    'prefer-quiet': '&#128263; Prefers Quiet'
  }
};

function topTraitsFromProfile(prof, n) {
  var traits = [];
  Object.keys(TRAIT_MAP).forEach(function (key) {
    if (prof[key] && TRAIT_MAP[key][prof[key]]) traits.push(TRAIT_MAP[key][prof[key]]);
  });
  return traits.slice(0, n);
}

function openMatchDetail(uid) {
  if (!myUserDoc) {
    openAuthModal('login');
    return;
  }
  db.collection('users')
    .doc(uid)
    .get()
    .then(function (snap) {
      if (!snap.exists) return;
      var p = Object.assign({ uid: uid }, snap.data());
      var prof = p.profile || {};
      var me = { profile: myProfile };
      var score = calcScoreFromProfiles(me, p);
      var initials = p.name
        ? p.name
            .split(' ')
            .map(function (n) {
              return n[0];
            })
            .join('')
            .slice(0, 2)
            .toUpperCase()
        : '?';
      var grad = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
      var cls = score >= 85 ? 'mp-hi' : 'mp-md';
      var traits = topTraitsFromProfile(prof, 6);
      var stats = [
        { label: 'Sleep', val: prof.sleepSchedule || '—' },
        { label: 'Study', val: prof.studyHabits || '—' },
        { label: 'Social', val: prof.socialStyle || '—' },
        { label: 'Clean', val: prof.cleanliness || '—' }
      ];
      document.getElementById('matchDetailContent').innerHTML =
        '<button class="modal-x" onclick="closeModal(\'matchDetailModal\')">&#10005;</button>' +
        '<div class="d-img" style="background:' +
        grad +
        ';font-family:\'Playfair Display\',serif;font-size:56px;font-weight:700;color:rgba(255,255,255,.9)">' +
        initials +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
        '<div class="d-price" style="font-size:28px">' +
        esc(p.name) +
        '</div>' +
        '<span class="mp ' +
        cls +
        '" style="font-size:14px;padding:5px 12px">' +
        score +
        '% Match</span>' +
        '</div>' +
        '<div class="d-addr">' +
        esc(capitalize(prof.year || '') || 'Student') +
        ' &middot; ' +
        esc(SCHOOL_NAME) +
        (prof.budget ? ' &middot; $' + esc(String(prof.budget)) + '/mo' : '') +
        (prof.moveInDate ? ' &middot; Move-in: ' + esc(prof.moveInDate) : '') +
        '</div>' +
        '<div class="d-stats">' +
        stats
          .map(function (s) {
            return (
              '<div class="d-stat"><div class="d-val" style="font-size:13px;font-weight:600">' +
              esc(s.val) +
              '</div><div class="d-lbl">' +
              esc(s.label) +
              '</div></div>'
            );
          })
          .join('') +
        '</div>' +
        (prof.bio ? '<p class="d-desc">&ldquo;' + esc(prof.bio) + '&rdquo;</p>' : '') +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px">' +
        traits
          .map(function (t) {
            return '<span class="ltag">' + t + '</span>';
          })
          .join('') +
        '</div>' +
        '<button class="btn-primary" style="width:100%;text-align:center;display:block;padding:16px;border:none;cursor:pointer;font-size:15px;border-radius:10px"' +
        ' onclick="startChat(\'' +
        uid +
        '\',\'' +
        esc(p.name) +
        '\');closeModal(\'matchDetailModal\')">' +
        '&#128172; Send Message' +
        '</button>';
      document.getElementById('matchDetailModal').classList.add('open');
    });
}

function ensureMatchDoc(otherUid, otherName) {
  var convId = [currentUser.uid, otherUid].sort().join('_');
  return db
    .collection('matches')
    .doc(convId)
    .get()
    .then(function (snap) {
      if (snap.exists) return convId;
      var me = { profile: myProfile };
      return db
        .collection('users')
        .doc(otherUid)
        .get()
        .then(function (os) {
          var oth = os.exists ? os.data() : {};
          var compat = calcScoreFromProfiles(me, oth);
          return db.collection('matches').doc(convId).set({
            users: [currentUser.uid, otherUid].sort(),
            school: SCHOOL_KEY,
            compatibility: compat,
            status: 'active',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            lastMessage: null,
            unreadCount: (function () {
              var u = {};
              u[currentUser.uid] = 0;
              u[otherUid] = 0;
              return u;
            })()
          });
        })
        .then(function () {
          return convId;
        });
    });
}

function startChat(otherUid, otherName) {
  if (!currentUser) {
    openAuthModal('login');
    return;
  }
  if (!myUserDoc || myUserDoc.accountType !== 'student') return;
  if (!myProfile || !myProfile.sleepSchedule) {
    window.location.href = '/profile-setup.html';
    return;
  }
  activeOtherUid = otherUid;
  ensureMatchDoc(otherUid, otherName)
    .then(function (matchId) {
      activeMatchId = matchId;
      var title = document.getElementById('chatModalTitle');
      if (title) title.textContent = otherName;
      var msgs = document.getElementById('chatMessages');
      if (msgs) msgs.innerHTML = '<p class="conv-empty">Loading&hellip;</p>';
      document.getElementById('chatModal').classList.add('open');
      var inp = document.getElementById('chatInput');
      if (inp) {
        inp.value = '';
        inp.focus();
      }
      if (msgUnsub) msgUnsub();
      msgUnsub = db
        .collection('messages')
        .doc(matchId)
        .collection('messages')
        .orderBy('timestamp', 'asc')
        .limit(100)
        .onSnapshot(
          function (snap) {
            renderMessages(
              snap.docs.map(function (d) {
                return Object.assign({ id: d.id }, d.data());
              })
            );
            markMatchRead(matchId);
          },
          function (e) {
            console.error('Messages error:', e);
          }
        );
    })
    .catch(function (e) {
      console.error('Chat open error:', e);
    });
}

function sendChatMessage() {
  if (!activeMatchId || !currentUser || !myUserDoc) return;
  var inp = document.getElementById('chatInput');
  var text = inp ? inp.value.trim() : '';
  if (!text) return;
  inp.value = '';
  inp.disabled = true;
  var msgRef = db.collection('messages').doc(activeMatchId).collection('messages').doc();
  msgRef
    .set({
      from: currentUser.uid,
      to: activeOtherUid,
      text: text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      read: false
    })
    .then(function () {
      return db
        .collection('matches')
        .doc(activeMatchId)
        .set(
          {
            lastMessage: {
              text: text,
              from: currentUser.uid,
              timestamp: firebase.firestore.FieldValue.serverTimestamp()
            }
          },
          { merge: true }
        );
    })
    .catch(function (e) {
      console.error('Send error:', e);
    })
    .finally(function () {
      inp.disabled = false;
      inp.focus();
    });
}

function renderMessages(msgs) {
  var c = document.getElementById('chatMessages');
  if (!c) return;
  if (msgs.length === 0) {
    c.innerHTML = '<p class="conv-empty">No messages yet. Say hello! &#128075;</p>';
    return;
  }
  c.innerHTML = msgs
    .map(function (m) {
      var isMe = m.from === currentUser.uid;
      var time = m.timestamp && m.timestamp.toDate ? timeAgo(m.timestamp.toDate()) : 'Just now';
      var body = m.text || m.message || '';
      return (
        '<div class="msg-item' +
        (isMe ? ' msg-mine' : '') +
        '">' +
        '<div class="m-av ' +
        (isMe ? 'me' : 'j') +
        '">' +
        (isMe ? 'Me' : '?') +
        '</div>' +
        '<div>' +
        '<div class="m-bubble">' +
        esc(body) +
        '</div>' +
        '<div class="m-meta">' +
        time +
        '</div>' +
        '</div>' +
        '</div>'
      );
    })
    .join('');
  c.scrollTop = c.scrollHeight;
}

function markMatchRead(matchId) {
  if (!currentUser) return;
  db.collection('messages')
    .doc(matchId)
    .collection('messages')
    .where('to', '==', currentUser.uid)
    .where('read', '==', false)
    .limit(20)
    .get()
    .then(function (snap) {
      var batch = db.batch();
      snap.forEach(function (d) {
        batch.update(d.ref, { read: true });
      });
      return batch.commit();
    })
    .catch(function () {});
}

function subscribeMatches() {
  if (!currentUser) return;
  if (convUnsub) convUnsub();
  convUnsub = db
    .collection('matches')
    .where('users', 'array-contains', currentUser.uid)
    .limit(30)
    .onSnapshot(
      function (snap) {
        var rows = snap.docs.map(function (d) {
          return Object.assign({ id: d.id }, d.data());
        });
        rows.sort(function (a, b) {
          var ta = a.lastMessage && a.lastMessage.timestamp && a.lastMessage.timestamp.toMillis
            ? a.lastMessage.timestamp.toMillis()
            : 0;
          var tb = b.lastMessage && b.lastMessage.timestamp && b.lastMessage.timestamp.toMillis
            ? b.lastMessage.timestamp.toMillis()
            : 0;
          return tb - ta;
        });
        renderConvList(rows);
      },
      function (e) {
        console.error('Matches inbox error:', e);
      }
    );
}

function renderConvList(rows) {
  var ml = document.getElementById('msgList');
  var ic = document.getElementById('inlineCompose');
  if (!ml) return;
  if (ic) ic.style.display = 'none';
  if (rows.length === 0) {
    ml.innerHTML = '<p class="conv-empty">No messages yet &mdash; find a match and say hi!</p>';
    return;
  }
  Promise.all(
    rows.map(function (c) {
      var otherUid = (c.users || []).find(function (u) {
        return u !== currentUser.uid;
      });
      return db
        .collection('users')
        .doc(otherUid)
        .get()
        .then(function (os) {
          var otherName = os.exists ? os.data().name || 'Student' : 'Student';
          var initials = otherName
            .split(' ')
            .map(function (n) {
              return n[0];
            })
            .join('')
            .slice(0, 2)
            .toUpperCase();
          var last = c.lastMessage && c.lastMessage.text ? c.lastMessage.text : '';
          var unread = (c.unreadCount && c.unreadCount[currentUser.uid]) || 0;
          var time =
            c.lastMessage && c.lastMessage.timestamp && c.lastMessage.timestamp.toDate
              ? timeAgo(c.lastMessage.timestamp.toDate())
              : '';
          return {
            otherUid: otherUid,
            otherName: otherName,
            initials: initials,
            last: last,
            unread: unread,
            time: time
          };
        });
    })
  ).then(function (items) {
    ml.innerHTML = items
      .map(function (x) {
        return (
          '<div class="msg-item conv-row" onclick="startChat(\'' +
          esc(x.otherUid) +
          '\',\'' +
          esc(x.otherName) +
          '\')">' +
          '<div class="m-av j">' +
          x.initials +
          '</div>' +
          '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div class="m-sender">' +
          esc(x.otherName) +
          '</div>' +
          (x.unread > 0 ? '<span class="unread-badge">' + x.unread + '</span>' : '') +
          '</div>' +
          '<div class="conv-preview">' +
          esc(x.last || 'Start a conversation') +
          '</div>' +
          (x.time ? '<div class="m-meta">' + x.time + '</div>' : '') +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  });
}

function openProfileModal() {
  quizAnswers = {};
  showProfileStep(1);
  document.getElementById('profError').style.display = 'none';
  if (currentUser) {
    var nameEl = document.getElementById('profName');
    if (nameEl && currentUser.displayName) nameEl.value = currentUser.displayName;
  }
  if (myUserDoc) {
    var prof = myProfile || {};
    var map = {
      profName: myUserDoc.name,
      profYear: prof.year,
      profGender: '',
      profBudget: prof.budget,
      profMoveIn: prof.moveInDate,
      profBio: prof.bio
    };
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el && map[id]) el.value = map[id];
    });
    if (prof.sleepSchedule) {
      quizAnswers.sleepSchedule = prof.sleepSchedule;
      highlightQuiz('sleepSchedule', prof.sleepSchedule);
    }
    if (prof.studyHabits) {
      quizAnswers.studyHabits = prof.studyHabits;
      highlightQuiz('studyHabits', prof.studyHabits);
    }
    var socialMap = { 'very-social': 'outgoing', 'somewhat-social': 'outgoing', introverted: 'quiet', flexible: 'outgoing' };
    if (prof.socialStyle) {
      quizAnswers.socialPreferences = socialMap[prof.socialStyle] || 'outgoing';
      highlightQuiz('socialPreferences', quizAnswers.socialPreferences);
    }
    var cleanMap = { 'very-clean': 'tidy', organized: 'tidy', relaxed: 'organized-chaos', flexible: 'tidy' };
    if (prof.cleanliness) {
      quizAnswers.cleanliness = cleanMap[prof.cleanliness] || 'tidy';
      highlightQuiz('cleanliness', quizAnswers.cleanliness);
    }
    var petsMap = { 'love-pets': 'pet-friendly', 'ok-with-pets': 'pet-friendly', 'no-pets': 'no-pets' };
    if (prof.pets) {
      quizAnswers.pets = petsMap[prof.pets] || 'pet-friendly';
      highlightQuiz('pets', quizAnswers.pets);
    }
    var gMap = { often: 'fine-with-guests', sometimes: 'fine-with-guests', 'prefer-quiet': 'prefer-quiet' };
    if (prof.guests) {
      quizAnswers.guestsParties = gMap[prof.guests] || 'fine-with-guests';
      highlightQuiz('guestsParties', quizAnswers.guestsParties);
    }
  }
  document.getElementById('profileModal').classList.add('open');
}

function highlightQuiz(key, val) {
  var el = document.querySelector('[onclick*="selectQuiz(\'' + key + '\'"]');
  if (!el) return;
  var parent = el.closest ? el.closest('.quiz-group') : null;
  if (!parent) return;
  parent.querySelectorAll('.pref-item').forEach(function (el) {
    el.classList.remove('active');
  });
  var target = parent.querySelector('[onclick*="' + val + '"]');
  if (target) target.classList.add('active');
}

function showProfileStep(step) {
  document.getElementById('profStep1').style.display = step === 1 ? '' : 'none';
  document.getElementById('profStep2').style.display = step === 2 ? '' : 'none';
  document.getElementById('profProg1').style.background = step >= 1 ? 'var(--teal)' : 'var(--rule)';
  document.getElementById('profProg2').style.background = step >= 2 ? 'var(--teal)' : 'var(--rule)';
  document.getElementById('profNextBtn').style.display = step === 1 ? '' : 'none';
  document.getElementById('profBackBtn').style.display = step === 2 ? '' : 'none';
  document.getElementById('profSaveBtn').style.display = step === 2 ? '' : 'none';
}

function profileNext() {
  if (!val('profName')) {
    showProfError('Please enter your name.');
    return;
  }
  showProfError('');
  showProfileStep(2);
}
function profileBack() {
  showProfileStep(1);
}

function selectQuiz(question, answer, el) {
  el.closest('.quiz-group').querySelectorAll('.pref-item').forEach(function (e) {
    e.classList.remove('active');
  });
  el.classList.add('active');
  quizAnswers[question] = answer;
}

function budgetFromSelect(val) {
  var map = {
    'under-700': 650,
    '700-900': 800,
    '900-1100': 1000,
    '1100-1400': 1250,
    '1400-2000': 1700,
    '2000-3000': 2500,
    '3000-4500': 3750,
    'over-4500': 5000
  };
  return map[val] || 1000;
}

function saveProfile() {
  var required = ['sleepSchedule', 'studyHabits', 'socialPreferences', 'cleanliness', 'pets', 'guestsParties'];
  for (var i = 0; i < required.length; i++) {
    if (!quizAnswers[required[i]]) {
      showProfError('Please answer all 6 lifestyle questions.');
      return;
    }
  }
  var btn = document.getElementById('profSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  showProfError('');

  var data = {
    name: val('profName'),
    year: val('profYear'),
    gender: val('profGender'),
    budget: budgetFromSelect(val('profBudget')),
    moveInDate: val('profMoveIn'),
    bio: val('profBio').slice(0, 500),
    major: 'Undeclared',
    sleepSchedule: quizAnswers.sleepSchedule,
    studyHabits: quizAnswers.studyHabits,
    socialStyle: mapSocialToProfile(quizAnswers.socialPreferences),
    cleanliness: mapCleanToProfile(quizAnswers.cleanliness),
    pets: mapPetsToProfile(quizAnswers.pets),
    guests: mapGuestsToProfile(quizAnswers.guestsParties),
    smoking: 'no-preference',
    drinking: 'no-preference',
    profilePhoto: '',
    phone: '',
    preferredNeighborhoods: []
  };

  db.collection('users')
    .doc(currentUser.uid)
    .set(
      {
        name: data.name,
        school: SCHOOL_KEY,
        accountType: 'student',
        email: currentUser.email,
        emailVerified: !!currentUser.emailVerified,
        profile: data,
        lastActive: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    )
    .then(function () {
      myUserDoc = Object.assign({}, myUserDoc, { profile: data });
      myProfile = data;
      closeModal('profileModal');
      loadMatches();
      subscribeMatches();
      setTimeout(function () {
        var el = document.getElementById('roommates');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    })
    .catch(function (e) {
      console.error('Save profile error:', e);
      showProfError('Failed to save profile. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Find My Matches \u2192';
    });
}

function showProfError(msg) {
  var el = document.getElementById('profError');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function onFindMatches() {
  if (!currentUser) {
    openAuthModal('signup');
    return;
  }
  if (!myUserDoc || !myProfile || !myProfile.sleepSchedule) {
    window.location.href = '/profile-setup.html';
    return;
  }
  var el = document.getElementById('roommates');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function timeAgo(date) {
  var diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  if (diff < 172800) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function val(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function checkEmailVerified() {
  if (!auth.currentUser) return;
  auth.currentUser.reload().then(function () {
    if (auth.currentUser.emailVerified) {
      db.collection('users').doc(auth.currentUser.uid).update({ emailVerified: true });
      closeModal('signupModal');
    } else {
      showAuthError('Email not yet verified. Please click the link in your inbox.');
    }
  });
}
function resendVerification() {
  if (!auth.currentUser) return;
  auth.currentUser
    .sendEmailVerification()
    .then(function () {
      showAuthError('Verification email resent — check your inbox!', true);
    })
    .catch(function () {
      showAuthError('Could not resend. Try again in a moment.');
    });
}

function updateListingCountStat(count) {
  var stat = document.getElementById('listingCountStat');
  var fig = document.getElementById('listingCountFig');
  if (!stat) return;
  if (count >= 5) {
    if (fig) fig.textContent = count;
    stat.style.display = '';
  } else {
    stat.style.display = 'none';
  }
}

function saveWaitlistEmail() {
  var email = (document.getElementById('waitlistEmail') || {}).value || '';
  if (!email || !email.includes('@')) { alert('Please enter a valid email address.'); return; }
  var succ = document.getElementById('waitlistSuccess');
  var wrap = document.getElementById('waitlistFormWrap');
  db.collection('waitlist_emails').add({
    email: email,
    school: SCHOOL_KEY,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function () {
    if (wrap) wrap.style.display = 'none';
    if (succ) succ.style.display = 'block';
  }).catch(function (e) {
    console.error(e);
    alert('Could not save your email. Please try again.');
  });
}

function renderListings(f) {
  var waitlistEl = document.getElementById('waitlistSection');
  var gridEl = document.getElementById('listGrid');
  if (firestoreListings.length < 3) {
    if (gridEl) gridEl.style.display = 'none';
    if (waitlistEl) waitlistEl.style.display = 'block';
    return;
  }
  if (gridEl) gridEl.style.display = '';
  if (waitlistEl) waitlistEl.style.display = 'none';
  var all = mergedListings();
  var s =
    f === 'all'
      ? all
      : all.filter(function (l) {
          return f === '1br'
            ? l.beds === 1
            : f === '2br'
              ? l.beds === 2
              : f === '3br'
                ? l.beds >= 3
                : f === 'furnished'
                  ? l.furnished
                  : true;
        });
  document.getElementById('listGrid').innerHTML = s
    .map(function (l) {
      return (
        '<div class="list-card" onclick="openDetail(\'' +
        String(l.id).replace(/'/g, "\\'") +
        '\')">' +
        '<div class="li-img ' +
        (l.img ? '' : l.bg) +
        '">' +
        (l.img
          ? '<img src="' +
            esc(l.img) +
            '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'' +
            l.bg +
            '\');this.remove()">'
          : '<div style="font-size:52px;opacity:.45">' +
            l.em +
            '</div>') +
        '<div class="li-badge ' +
        l.bc +
        '">' +
        l.badge +
        '</div></div>' +
        '<div class="li-body">' +
        '<div class="li-price">' +
        l.price +
        '<span> ' +
        l.per +
        '</span></div>' +
        '<div class="li-addr">&#128205; ' +
        l.addr +
        '</div>' +
        '<div class="li-tags">' +
        l.tags.map(function (t) {
          return '<span class="ltag">' + t + '</span>';
        }).join('') +
        '</div>' +
        '<div class="li-footer"><div class="li-saving">' +
        l.saving +
        '</div><button class="btn-sm">View</button></div>' +
        '</div>'
      );
    })
    .join('');
}

function filterL(btn, f) {
  document.querySelectorAll('.filter-btn').forEach(function (b) {
    b.classList.remove('active');
  });
  btn.classList.add('active');
  btn.setAttribute('data-filter', f);
  renderListings(f);
}

function openDetail(id) {
  var all = mergedListings();
  var l = all.find(function (x) {
    return String(x.id) === String(id);
  });
  if (!l) return;
  var fs = l._fsListing;
  document.getElementById('detailContent').innerHTML =
    '<button class="modal-x" onclick="closeModal(\'detailModal\')">\u2715</button>' +
    (l.img
      ? '<img src="' +
        l.img +
        '" alt="" style="width:100%;height:220px;object-fit:cover;border-radius:12px;margin-bottom:28px" onerror="this.insertAdjacentHTML(\'afterend\',\'<div class=\\\'d-img ' +
        l.bg +
        '\\\'>' +
        l.em +
        '</div>\');this.remove()">'
      : '<div class="d-img ' +
        l.bg +
        '">' +
        l.em +
        '</div>') +
    '<div class="d-price">' +
    l.price +
    ' <span style="font-family:\'Outfit\',sans-serif;font-size:16px;font-weight:400;color:var(--ink-4)">' +
    l.per +
    '</span></div>' +
    '<div class="d-addr">&#128205; ' +
    l.addr +
    '</div>' +
    '<div class="d-stats">' +
    '<div class="d-stat"><div class="d-val">' +
    l.beds +
    '</div><div class="d-lbl">Beds</div></div>' +
    '<div class="d-stat"><div class="d-val">' +
    l.baths +
    '</div><div class="d-lbl">Baths</div></div>' +
    '<div class="d-stat"><div class="d-val">' +
    l.sqft +
    '</div><div class="d-lbl">Sq Ft</div></div>' +
    '<div class="d-stat"><div class="d-val">' +
    l.avail +
    '</div><div class="d-lbl">Available</div></div>' +
    '</div>' +
    (l.savN
      ? '<div class="sav-chip"><div class="sc-lbl">Estimated Annual Savings vs. on-campus</div><div class="sc-val">$' +
        l.savN.toLocaleString() +
        '</div></div>'
      : '') +
    '<p class="d-desc">' +
    (l.desc || (fs && fs.description) || '') +
    '</p>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:28px">' +
    l.tags
      .map(function (t) {
        return '<span class="ltag">' + t + '</span>';
      })
      .join('') +
    '</div>' +
    '<button class="btn-primary" style="width:100%;text-align:center;display:block;padding:16px" onclick="openInterestModal(\'' +
    String(l._listingId || id).replace(/'/g, "\\'") + "','" +
    String(l.addr || l.address || '').replace(/'/g, '') + "','" +
    String((l._fsListing && l._fsListing.landlordId) || '').replace(/'/g, '') +
    '\')">I\'m Interested</button>';
  document.getElementById('detailModal').classList.add('open');
}

function contactListing(listingId) {
  if (!currentUser) {
    openAuthModal('signup');
    return;
  }
  var msg = prompt('Message to the landlord (include your phone if you want a call back):');
  if (!msg) return;
  db.collection('listings')
    .doc(listingId)
    .get()
    .then(function (snap) {
      var landlordId = snap.exists ? snap.data().landlordId : null;
      if (!landlordId) {
        alert('This listing cannot be contacted yet.');
        return;
      }
      return db.collection('inquiries').add({
        listingId: listingId,
        studentId: currentUser.uid,
        studentName: myUserDoc && myUserDoc.name ? myUserDoc.name : currentUser.displayName || 'Student',
        studentEmail: currentUser.email,
        studentPhone: (myProfile && myProfile.phone) || '',
        message: msg,
        landlordId: landlordId,
        status: 'new',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function (ref) {
      if (!ref) return;
      alert('Your message was sent. The landlord will be notified.');
      closeModal('detailModal');
    })
    .catch(function (e) {
      console.error(e);
      alert('Could not send inquiry. Please try again.');
    });
}

window.openDetail = openDetail;
window.filterL = filterL;
window.contactListing = contactListing;
window.openInterestModal = openInterestModal;
window.submitInterest = submitInterest;

var _pendingInterest = null;

function openInterestModal(listingId, address, landlordId) {
  if (!currentUser) { openAuthModal('signup'); return; }
  _pendingInterest = { listingId: listingId, address: address, landlordId: landlordId };
  var lbl = document.getElementById('interestListingLabel');
  if (lbl) lbl.textContent = address ? 'Send a message about: ' + address : 'Send a message to the landlord about this property.';
  var msgEl = document.getElementById('interestMsg');
  if (msgEl) msgEl.value = '';
  var form = document.getElementById('interestFormWrap');
  var succ = document.getElementById('interestSuccessMsg');
  if (form) form.style.display = 'block';
  if (succ) succ.style.display = 'none';
  var modal = document.getElementById('interestModal');
  if (modal) modal.classList.add('open');
}

function submitInterest() {
  if (!currentUser || !_pendingInterest) return;
  var msgEl = document.getElementById('interestMsg');
  var message = msgEl ? msgEl.value.trim() : '';
  var btn = document.getElementById('submitInterestBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending\u2026'; }

  db.collection('interests')
    .where('listingId', '==', _pendingInterest.listingId)
    .where('studentId', '==', currentUser.uid)
    .get()
    .then(function(snap) {
      if (!snap.empty) {
        if (btn) { btn.disabled = false; btn.textContent = 'Send Interest'; }
        alert('You\u2019ve already expressed interest in this listing!');
        return;
      }
      var profile = myUserDoc || myProfile || {};
      var data = {
        listingId:      _pendingInterest.listingId,
        listingAddress: _pendingInterest.address || '',
        landlordId:     _pendingInterest.landlordId || '',
        studentId:      currentUser.uid,
        studentName:    profile.name || currentUser.displayName || '',
        studentEmail:   currentUser.email,
        studentSchool:  SCHOOL_NAME || 'Northeastern University',
        studentYear:    profile.year || '',
        message:        message,
        status:         'new',
        createdAt:      firebase.firestore.FieldValue.serverTimestamp()
      };
      return db.collection('interests').add(data).then(function() {
        if (_pendingInterest.listingId) {
          db.collection('listings').doc(_pendingInterest.listingId).update({
            interestCount: firebase.firestore.FieldValue.increment(1)
          }).catch(function() {});
        }
        var form = document.getElementById('interestFormWrap');
        var succ = document.getElementById('interestSuccessMsg');
        if (form) form.style.display = 'none';
        if (succ) succ.style.display = 'block';
        if (btn) { btn.disabled = false; btn.textContent = 'Send Interest'; }
      });
    })
    .catch(function(err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Interest'; }
      alert('Error: ' + err.message);
    });
}
