'use strict';
/* =============================================================
   DormDrop — Roommate Matching & Real-Time Chat (Firebase)
   =============================================================
   Requires: firebase-config.js loaded before this file
   Firebase SDKs needed: app-compat, auth-compat, firestore-compat
   ============================================================= */

// ── State ──────────────────────────────────────────────────────
var db, auth;
var currentUser  = null;
var myProfile    = null;
var convUnsub    = null;
var msgUnsub     = null;
var activeConvId = null;
var quizAnswers  = {};   // { sleepSchedule, studyHabits, ... }

// ── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  if (typeof FIREBASE_CONFIG === 'undefined' ||
      !FIREBASE_CONFIG.apiKey ||
      FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    console.info('DormDrop: Fill in firebase-config.js to enable roommate features.');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db   = firebase.firestore();
    auth = firebase.auth();
    auth.onAuthStateChanged(onAuthChange);
    // Override demo sendMsg handlers
    window.sendMsgBtn = function () { /* handled by Firebase chat */ };
    window.sendMsg    = function () { /* handled by Firebase chat */ };
    // Show loading state immediately (before auth resolves)
    setRoommateLoading();
  } catch (e) {
    console.error('Firebase init error:', e);
  }
});

function setRoommateLoading() {
  var pg = document.getElementById('pGrid');
  if (pg) pg.innerHTML = '<div class="rm-state-box"><div class="rm-spinner">&#8635;</div><div class="rm-state-txt">Loading matches&hellip;</div></div>';
  var ml = document.getElementById('msgList');
  if (ml) ml.innerHTML = '<p class="conv-empty">Sign in to view messages</p>';
  var ic = document.getElementById('inlineCompose');
  if (ic) ic.style.display = 'none';
}

// ── Auth State ─────────────────────────────────────────────────
function onAuthChange(user) {
  currentUser = user;
  updateNav(user);
  if (!user) {
    myProfile = null;
    if (convUnsub) { convUnsub(); convUnsub = null; }
    if (msgUnsub)  { msgUnsub();  msgUnsub  = null; }
    renderLoggedOutState();
    return;
  }
  db.collection('users').doc(user.uid).get().then(function (snap) {
    if (snap.exists) {
      myProfile = Object.assign({ uid: user.uid }, snap.data());
      loadMatches();
      subscribeConversations();
    } else {
      myProfile = null;
      renderNeedsProfileState();
    }
  }).catch(function (e) {
    console.error('Profile load error:', e);
    renderLoggedOutState();
  });
}

// ── Nav ────────────────────────────────────────────────────────
function updateNav(user) {
  var loginBtn  = document.getElementById('navLoginBtn');
  var signupBtn = document.getElementById('navSignupBtn');
  if (!loginBtn || !signupBtn) return;
  if (user) {
    var name = user.displayName || user.email.split('@')[0];
    loginBtn.textContent = name;
    loginBtn.onclick = function () { if (confirm('Sign out of DormDrop?')) auth.signOut(); };
    signupBtn.textContent = 'Sign Out';
    signupBtn.className = 'btn-ghost';
    signupBtn.onclick = function () { auth.signOut(); };
  } else {
    loginBtn.textContent = 'Log in';
    loginBtn.onclick = function () { openAuthModal('login'); };
    signupBtn.textContent = 'Get Started';
    signupBtn.className = 'btn-solid';
    signupBtn.onclick = function () { openAuthModal('signup'); };
  }
}

// ── Auth Modal ─────────────────────────────────────────────────
function openAuthModal(mode) {
  clearAuthError();
  document.getElementById('signupModal').classList.add('open');
  showAuthView(mode === 'login' ? 'loginFields' : 'signupFields');
}

function showAuthView(viewId) {
  ['signupFields', 'loginFields', 'forgotFields'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? '' : 'none';
  });
  var titles = {
    signupFields: { t: 'Create your account',  s: 'Free for all NEU students. No credit card required.' },
    loginFields:  { t: 'Welcome back',          s: 'Sign in to your DormDrop account.' },
    forgotFields: { t: 'Reset password',        s: 'We\'ll send a reset link to your NEU email.' }
  };
  var info = titles[viewId];
  if (info) {
    var mt = document.getElementById('authModalTitle');
    var ms = document.getElementById('authModalSub');
    if (mt) mt.textContent = info.t;
    if (ms) ms.textContent = info.s;
  }
  clearAuthError();
}

// ── Sign Up ────────────────────────────────────────────────────
function doSignup() {
  var name  = val('authName');
  var email = val('authEmail');
  var pwd   = val('authPwd');
  if (!name || !email || !pwd) { showAuthError('Please fill in all fields.'); return; }
  if (!email.toLowerCase().endsWith('@northeastern.edu')) { showAuthError('Please use your @northeastern.edu email address.'); return; }
  if (pwd.length < 6) { showAuthError('Password must be at least 6 characters.'); return; }
  setAuthBtnLoading(true, 'signupBtn', 'Creating account\u2026');
  auth.createUserWithEmailAndPassword(email, pwd)
    .then(function (cred) {
      return cred.user.updateProfile({ displayName: name });
    })
    .then(function () {
      closeModal('signupModal');
      // auth state change will trigger renderNeedsProfileState
    })
    .catch(function (e) { showAuthError(friendlyAuthError(e.code)); })
    .finally(function () { setAuthBtnLoading(false, 'signupBtn', 'Create Account'); });
}

// ── Log In ─────────────────────────────────────────────────────
function doLogin() {
  var email = val('loginEmail');
  var pwd   = val('loginPwd');
  if (!email || !pwd) { showAuthError('Please enter your email and password.'); return; }
  setAuthBtnLoading(true, 'loginBtn', 'Signing in\u2026');
  auth.signInWithEmailAndPassword(email, pwd)
    .then(function () { closeModal('signupModal'); })
    .catch(function (e) { showAuthError(friendlyAuthError(e.code)); })
    .finally(function () { setAuthBtnLoading(false, 'loginBtn', 'Log In'); });
}

// ── Forgot Password ────────────────────────────────────────────
function doResetPassword() {
  var email = val('forgotEmail');
  if (!email) { showAuthError('Please enter your email address.'); return; }
  auth.sendPasswordResetEmail(email)
    .then(function () { showAuthError('Reset link sent — check your inbox!', true); })
    .catch(function (e) { showAuthError(friendlyAuthError(e.code)); });
}

function friendlyAuthError(code) {
  var map = {
    'auth/email-already-in-use':   'An account with this email already exists.',
    'auth/invalid-email':          'Invalid email address.',
    'auth/weak-password':          'Password must be at least 6 characters.',
    'auth/user-not-found':         'No account found with this email.',
    'auth/wrong-password':         'Incorrect password.',
    'auth/invalid-credential':     'Incorrect email or password.',
    'auth/too-many-requests':      'Too many attempts. Try again later.',
    'auth/network-request-failed': 'Network error. Check your connection.'
  };
  return map[code] || 'Something went wrong. Please try again.';
}

function showAuthError(msg, success) {
  var el = document.getElementById('authError');
  if (!el) return;
  el.textContent = msg;
  el.style.color   = success ? 'var(--teal)' : '#DC2626';
  el.style.display = 'block';
}
function clearAuthError() {
  var el = document.getElementById('authError');
  if (el) el.style.display = 'none';
}
function setAuthBtnLoading(on, btnId, label) {
  var btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled    = on;
  btn.textContent = on ? label : btn.dataset.label || label;
}

// ── Roommate Section States ────────────────────────────────────
function renderLoggedOutState() {
  var pg = document.getElementById('pGrid');
  if (pg) pg.innerHTML =
    '<div class="rm-state-box">' +
      '<div style="font-size:36px;margin-bottom:12px">&#128075;</div>' +
      '<div class="rm-state-title">Find your perfect roommate</div>' +
      '<p class="rm-state-desc">Create a free account to see NEU students who match your lifestyle.</p>' +
      '<button class="btn-primary rm-state-btn" onclick="openAuthModal(\'signup\')">Sign Up &mdash; It\'s Free</button>' +
    '</div>';
  var ml = document.getElementById('msgList');
  if (ml) ml.innerHTML = '<p class="conv-empty">Sign in to view messages</p>';
  var ic = document.getElementById('inlineCompose');
  if (ic) ic.style.display = 'none';
}

function renderNeedsProfileState() {
  var pg = document.getElementById('pGrid');
  if (pg) pg.innerHTML =
    '<div class="rm-state-box">' +
      '<div style="font-size:36px;margin-bottom:12px">&#128203;</div>' +
      '<div class="rm-state-title">Complete your profile</div>' +
      '<p class="rm-state-desc">Tell us about your lifestyle so we can find your best matches.</p>' +
      '<button class="btn-primary rm-state-btn" onclick="openProfileModal()">Set Up My Profile</button>' +
    '</div>';
}

// ── Matching Algorithm ─────────────────────────────────────────
function calcScore(a, b) {
  var score = 0;
  if (a.sleepSchedule     === b.sleepSchedule)     score += 25;
  if (a.studyHabits       === b.studyHabits)       score += 20;
  if (a.socialPreferences === b.socialPreferences) score += 20;
  if (a.cleanliness       === b.cleanliness)       score += 20;
  if (a.pets              === b.pets)              score += 10;
  if (a.guestsParties     === b.guestsParties)     score +=  5;
  return score;
}

function loadMatches() {
  if (!myProfile) return;
  var pg = document.getElementById('pGrid');
  if (pg) pg.innerHTML = '<div class="rm-state-box"><div class="rm-spinner">&#8635;</div><div class="rm-state-txt">Finding your matches&hellip;</div></div>';

  db.collection('users')
    .where('school', '==', 'Northeastern University')
    .limit(200)
    .get()
    .then(function (snap) {
      var matches = [];
      snap.forEach(function (doc) {
        if (doc.id === currentUser.uid) return;
        var p = Object.assign({ uid: doc.id }, doc.data());
        var score = calcScore(myProfile, p);
        if (score >= 70) matches.push(Object.assign({ score: score }, p));
      });
      matches.sort(function (a, b) { return b.score - a.score; });
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
        '<p class="rm-state-desc">Be among the first! As more NEU students join, your matches will appear here.</p>' +
      '</div>';
    return;
  }
  pg.innerHTML = matches.map(function (p, i) {
    var initials = p.name ? p.name.split(' ').map(function (n) { return n[0]; }).join('').slice(0, 2).toUpperCase() : '?';
    var grad     = GRADIENTS[i % GRADIENTS.length];
    var cls      = p.score >= 85 ? 'mp-hi' : 'mp-md';
    var traits   = topTraits(p, 3);
    return '<div class="p-card" onclick="openMatchDetail(\'' + p.uid + '\')">' +
      '<div class="p-av" style="background:' + grad + '">' + initials + '</div>' +
      '<div class="p-name">' + esc(p.name) + '</div>' +
      '<div class="p-info">' + esc(p.year || '') + (p.budget ? ' &middot; $' + esc(p.budget) + '/mo' : '') + '</div>' +
      '<span class="mp ' + cls + '">' + p.score + '% Match</span>' +
      '<div class="p-traits">' + traits.map(function (t) { return '<span class="p-trait">' + t + '</span>'; }).join('') + '</div>' +
    '</div>';
  }).join('');
}

var TRAIT_MAP = {
  sleepSchedule:     { 'night-owl': '&#127769; Night Owl',       'early-riser': '&#9728;&#65039; Early Riser' },
  studyHabits:       { 'at-home':   '&#128218; Studies at Home', 'on-campus':   '&#127979; On Campus' },
  socialPreferences: { 'outgoing':  '&#127881; Social',          'quiet':       '&#129310; Introverted' },
  cleanliness:       { 'tidy':      '&#129529; Very Tidy',       'organized-chaos': '&#128199; Casual' },
  pets:              { 'pet-friendly': '&#128062; Pet-Friendly', 'no-pets':     '&#128683; No Pets' },
  guestsParties:     { 'fine-with-guests': '&#127968; Guests OK','prefer-quiet': '&#128263; Prefers Quiet' }
};

function topTraits(p, n) {
  var traits = [];
  Object.keys(TRAIT_MAP).forEach(function (key) {
    if (p[key] && TRAIT_MAP[key][p[key]]) traits.push(TRAIT_MAP[key][p[key]]);
  });
  return traits.slice(0, n);
}

// ── Match Detail Modal ─────────────────────────────────────────
function openMatchDetail(uid) {
  if (!myProfile) { openAuthModal('login'); return; }
  db.collection('users').doc(uid).get().then(function (snap) {
    if (!snap.exists) return;
    var p     = Object.assign({ uid: uid }, snap.data());
    var score = calcScore(myProfile, p);
    var initials = p.name ? p.name.split(' ').map(function (n) { return n[0]; }).join('').slice(0, 2).toUpperCase() : '?';
    var grad  = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
    var cls   = score >= 85 ? 'mp-hi' : 'mp-md';
    var traits = topTraits(p, 6);

    var stats = [
      { label: 'Sleep',  val: p.sleepSchedule     === 'night-owl'       ? 'Night Owl'   : 'Early Riser' },
      { label: 'Study',  val: p.studyHabits        === 'at-home'         ? 'At Home'     : 'On Campus' },
      { label: 'Social', val: p.socialPreferences  === 'outgoing'        ? 'Outgoing'    : 'Quiet' },
      { label: 'Clean',  val: p.cleanliness        === 'tidy'            ? 'Very Tidy'   : 'Casual' }
    ];

    document.getElementById('matchDetailContent').innerHTML =
      '<button class="modal-x" onclick="closeModal(\'matchDetailModal\')">&#10005;</button>' +
      '<div class="d-img" style="background:' + grad + ';font-family:\'Playfair Display\',serif;font-size:56px;font-weight:700;color:rgba(255,255,255,.9)">' + initials + '</div>' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">' +
        '<div class="d-price" style="font-size:28px">' + esc(p.name) + '</div>' +
        '<span class="mp ' + cls + '" style="font-size:14px;padding:5px 12px">' + score + '% Match</span>' +
      '</div>' +
      '<div class="d-addr">' + esc(p.year || 'NEU Student') + ' &middot; Northeastern University' +
        (p.budget ? ' &middot; $' + esc(p.budget) + '/mo' : '') +
        (p.moveIn ? ' &middot; Move-in: ' + esc(p.moveIn) : '') + '</div>' +
      '<div class="d-stats">' +
        stats.map(function (s) {
          return '<div class="d-stat"><div class="d-val" style="font-size:13px;font-weight:600">' + s.val + '</div><div class="d-lbl">' + s.label + '</div></div>';
        }).join('') +
      '</div>' +
      (p.bio ? '<p class="d-desc">&ldquo;' + esc(p.bio) + '&rdquo;</p>' : '') +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px">' +
        traits.map(function (t) { return '<span class="ltag">' + t + '</span>'; }).join('') +
      '</div>' +
      '<button class="btn-primary" style="width:100%;text-align:center;display:block;padding:16px;border:none;cursor:pointer;font-size:15px;border-radius:10px"' +
        ' onclick="startChat(\'' + uid + '\',\'' + esc(p.name) + '\');closeModal(\'matchDetailModal\')">' +
        '&#128172; Send Message' +
      '</button>';

    document.getElementById('matchDetailModal').classList.add('open');
  });
}

// ── Chat: Open / Start ─────────────────────────────────────────
function startChat(otherUid, otherName) {
  if (!currentUser) { openAuthModal('login'); return; }
  if (!myProfile)   { openProfileModal(); return; }

  var convId = [currentUser.uid, otherUid].sort().join('_');
  activeConvId = convId;

  var convRef = db.collection('conversations').doc(convId);
  convRef.get().then(function (snap) {
    if (!snap.exists) {
      var names = {};
      names[currentUser.uid] = myProfile.name || currentUser.displayName || 'You';
      names[otherUid]        = otherName;
      var unread = {};
      unread[currentUser.uid] = 0;
      unread[otherUid]        = 0;
      return convRef.set({
        participants:     [currentUser.uid, otherUid],
        participantNames: names,
        lastMessage:      '',
        lastMessageTime:  firebase.firestore.FieldValue.serverTimestamp(),
        unreadCount:      unread,
        createdAt:        firebase.firestore.FieldValue.serverTimestamp()
      });
    }
  }).then(function () {
    // Open modal
    var title = document.getElementById('chatModalTitle');
    if (title) title.textContent = otherName;
    var msgs = document.getElementById('chatMessages');
    if (msgs) msgs.innerHTML = '<p class="conv-empty">Loading&hellip;</p>';
    document.getElementById('chatModal').classList.add('open');
    var inp = document.getElementById('chatInput');
    if (inp) { inp.value = ''; inp.focus(); }

    // Subscribe to messages
    if (msgUnsub) msgUnsub();
    msgUnsub = db.collection('conversations').doc(convId)
      .collection('messages')
      .orderBy('timestamp', 'asc')
      .limit(100)
      .onSnapshot(function (snap) {
        renderMessages(snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }));
        markRead(convId);
      }, function (e) { console.error('Messages error:', e); });
  }).catch(function (e) { console.error('Chat open error:', e); });
}

// ── Chat: Send ─────────────────────────────────────────────────
function sendChatMessage() {
  if (!activeConvId || !currentUser || !myProfile) return;
  var inp  = document.getElementById('chatInput');
  var text = inp ? inp.value.trim() : '';
  if (!text) return;
  inp.value    = '';
  inp.disabled = true;

  var msgRef = db.collection('conversations').doc(activeConvId).collection('messages').doc();
  msgRef.set({
    senderId:   currentUser.uid,
    senderName: myProfile.name || currentUser.displayName || 'You',
    message:    text,
    timestamp:  firebase.firestore.FieldValue.serverTimestamp(),
    read:       false
  }).then(function () {
    return db.collection('conversations').doc(activeConvId).update({
      lastMessage:     text,
      lastMessageTime: firebase.firestore.FieldValue.serverTimestamp()
    });
  }).catch(function (e) {
    console.error('Send error:', e);
  }).finally(function () {
    inp.disabled = false;
    inp.focus();
  });
}

// ── Chat: Render Messages ──────────────────────────────────────
function renderMessages(msgs) {
  var c = document.getElementById('chatMessages');
  if (!c) return;
  if (msgs.length === 0) {
    c.innerHTML = '<p class="conv-empty">No messages yet. Say hello! &#128075;</p>';
    return;
  }
  c.innerHTML = msgs.map(function (m) {
    var isMe = m.senderId === currentUser.uid;
    var time = m.timestamp ? timeAgo(m.timestamp.toDate()) : 'Just now';
    return '<div class="msg-item' + (isMe ? ' msg-mine' : '') + '">' +
      '<div class="m-av ' + (isMe ? 'me' : 'j') + '">' + (isMe ? 'Me' : (m.senderName ? m.senderName[0].toUpperCase() : '?')) + '</div>' +
      '<div>' +
        (!isMe ? '<div class="m-sender">' + esc(m.senderName || '') + '</div>' : '') +
        '<div class="m-bubble">' + esc(m.message) + '</div>' +
        '<div class="m-meta">' + time + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  c.scrollTop = c.scrollHeight;
}

function markRead(convId) {
  if (!currentUser) return;
  var upd = {};
  upd['unreadCount.' + currentUser.uid] = 0;
  db.collection('conversations').doc(convId).update(upd).catch(function () {});
}

// ── Conversations List ─────────────────────────────────────────
function subscribeConversations() {
  if (!currentUser) return;
  if (convUnsub) convUnsub();
  convUnsub = db.collection('conversations')
    .where('participants', 'array-contains', currentUser.uid)
    .orderBy('lastMessageTime', 'desc')
    .limit(20)
    .onSnapshot(function (snap) {
      renderConvList(snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }));
    }, function (e) {
      console.error('Conversations error:', e);
    });
}

function renderConvList(convs) {
  var ml = document.getElementById('msgList');
  var ic = document.getElementById('inlineCompose');
  if (!ml) return;
  if (ic) ic.style.display = 'none';   // full chat modal handles compose

  if (convs.length === 0) {
    ml.innerHTML = '<p class="conv-empty">No messages yet &mdash; find a match and say hi!</p>';
    return;
  }
  ml.innerHTML = convs.map(function (c) {
    var otherUid  = c.participants.find(function (u) { return u !== currentUser.uid; });
    var otherName = (c.participantNames && c.participantNames[otherUid]) || 'Unknown';
    var unread    = (c.unreadCount && c.unreadCount[currentUser.uid]) || 0;
    var initials  = otherName.split(' ').map(function (n) { return n[0]; }).join('').slice(0, 2).toUpperCase();
    var time      = (c.lastMessageTime && c.lastMessageTime.toDate) ? timeAgo(c.lastMessageTime.toDate()) : '';
    return '<div class="msg-item conv-row" onclick="startChat(\'' + esc(otherUid) + '\',\'' + esc(otherName) + '\')">' +
      '<div class="m-av j">' + initials + '</div>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<div class="m-sender">' + esc(otherName) + '</div>' +
          (unread > 0 ? '<span class="unread-badge">' + unread + '</span>' : '') +
        '</div>' +
        '<div class="conv-preview">' + esc(c.lastMessage || 'Start a conversation') + '</div>' +
        (time ? '<div class="m-meta">' + time + '</div>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Profile Setup Modal ────────────────────────────────────────
function openProfileModal() {
  quizAnswers = {};
  showProfileStep(1);
  document.getElementById('profError').style.display = 'none';
  if (currentUser) {
    var nameEl = document.getElementById('profName');
    if (nameEl && currentUser.displayName) nameEl.value = currentUser.displayName;
  }
  document.getElementById('profileModal').classList.add('open');
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
  if (!val('profName')) { showProfError('Please enter your name.'); return; }
  showProfError('');
  showProfileStep(2);
}
function profileBack() { showProfileStep(1); }

function selectQuiz(question, answer, el) {
  el.closest('.quiz-group').querySelectorAll('.pref-item').forEach(function (e) { e.classList.remove('active'); });
  el.classList.add('active');
  quizAnswers[question] = answer;
}

function saveProfile() {
  var required = ['sleepSchedule','studyHabits','socialPreferences','cleanliness','pets','guestsParties'];
  for (var i = 0; i < required.length; i++) {
    if (!quizAnswers[required[i]]) { showProfError('Please answer all 6 lifestyle questions.'); return; }
  }
  var btn = document.getElementById('profSaveBtn');
  btn.disabled    = true;
  btn.textContent = 'Saving\u2026';
  showProfError('');

  var data = {
    name:   val('profName'),
    year:   val('profYear'),
    gender: val('profGender'),
    budget: val('profBudget'),
    moveIn: val('profMoveIn'),
    bio:    val('profBio').slice(0, 500),
    school: 'Northeastern University',
    email:  currentUser.email,
    createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
    lastActive:  firebase.firestore.FieldValue.serverTimestamp(),
    sleepSchedule:     quizAnswers.sleepSchedule,
    studyHabits:       quizAnswers.studyHabits,
    socialPreferences: quizAnswers.socialPreferences,
    cleanliness:       quizAnswers.cleanliness,
    pets:              quizAnswers.pets,
    guestsParties:     quizAnswers.guestsParties
  };

  db.collection('users').doc(currentUser.uid).set(data)
    .then(function () {
      myProfile = Object.assign({ uid: currentUser.uid }, data);
      closeModal('profileModal');
      loadMatches();
      subscribeConversations();
      setTimeout(function () {
        var el = document.getElementById('roommates');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    })
    .catch(function (e) {
      console.error('Save profile error:', e);
      showProfError('Failed to save profile. Please try again.');
      btn.disabled    = false;
      btn.textContent = 'Find My Matches \u2192';
    });
}

function showProfError(msg) {
  var el = document.getElementById('profError');
  if (!el) return;
  el.textContent   = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ── "Find My Matches" button ───────────────────────────────────
function onFindMatches() {
  if (!currentUser) { openAuthModal('signup'); return; }
  if (!myProfile)   { openProfileModal(); return; }
  var el = document.getElementById('roommates');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ── Utilities ──────────────────────────────────────────────────
function timeAgo(date) {
  var diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff / 60) + ' min ago';
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
