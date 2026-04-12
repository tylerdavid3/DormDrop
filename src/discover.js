import { auth } from './firebase-config.js';
import { getPotentialMatches, likeProfile, passProfile } from './matching.js';

let matches = [];
let currentIndex = 0;

async function loadMatches() {
  await new Promise(function (resolve) {
    if (auth.currentUser) return resolve();
    const unsub = auth.onAuthStateChanged(function (u) {
      unsub();
      resolve();
    });
  });
  if (!auth.currentUser) {
    window.location.href = '/';
    return;
  }
  matches = await getPotentialMatches(auth.currentUser.uid);
  displayCurrentCard();
}

function displayCurrentCard() {
  var stack = document.getElementById('card-stack');
  var none = document.getElementById('no-more-matches');
  if (!stack) return;
  if (currentIndex >= matches.length) {
    stack.style.display = 'none';
    if (none) none.style.display = 'block';
    return;
  }
  if (none) none.style.display = 'none';
  stack.style.display = 'block';
  var match = matches[currentIndex];
  var prof = match.profile || {};
  var photo =
    prof.profilePhoto ||
    '<div style="width:100%;height:220px;background:linear-gradient(135deg,#0E6E6E,#14A3A3);display:flex;align-items:center;justify-content:center;font-size:48px;color:#fff">' +
    (match.name ? match.name[0] : '?') +
    '</div>';
  var cardHTML =
    '<div class="disc-card">' +
    (prof.profilePhoto
      ? '<img src="' +
        prof.profilePhoto +
        '" alt="" style="width:100%;height:220px;object-fit:cover;border-radius:12px;margin-bottom:16px"/>'
      : photo) +
    '<h2 style="font-family:Playfair Display,serif;font-size:22px;margin-bottom:8px">' +
    escapeHtml(match.name) +
    ', ' +
    capitalize(prof.year || '') +
    '</h2>' +
    '<p style="color:#6B7280;font-size:14px;margin-bottom:8px">' +
    escapeHtml(prof.major || '') +
    '</p>' +
    '<p style="font-size:14px;line-height:1.5;margin-bottom:12px">' +
    escapeHtml(prof.bio || '') +
    '</p>' +
    '<p style="font-weight:600;color:#0E6E6E">' +
    (match.compatibility || 0) +
    '% match</p>' +
    '<div style="margin-top:16px;font-size:20px">' +
    getLifestyleIcon('sleep', prof.sleepSchedule) +
    ' ' +
    getLifestyleIcon('study', prof.studyHabits) +
    ' ' +
    getLifestyleIcon('social', prof.socialStyle) +
    ' ' +
    getLifestyleIcon('clean', prof.cleanliness) +
    '</div>' +
    '</div>';
  stack.innerHTML = cardHTML;
}

function getLifestyleIcon(type, value) {
  var icons = {
    sleep: { 'night-owl': '🌙', 'early-riser': '☀️', flexible: '🔄' },
    study: { 'at-home': '🏠', 'on-campus': '🎓', flexible: '🔄' },
    social: {
      'very-social': '🎉',
      'somewhat-social': '😊',
      introverted: '📚',
      flexible: '🔄'
    },
    clean: { 'very-clean': '✨', organized: '📋', relaxed: '😌', flexible: '🔄' }
  };
  return icons[type] && icons[type][value] ? icons[type][value] : '';
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(s) {
  if (!s) return '';
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

window.passCurrentCard = async function () {
  if (currentIndex >= matches.length) return;
  var match = matches[currentIndex];
  await passProfile(auth.currentUser.uid, match.userId);
  currentIndex++;
  displayCurrentCard();
};

window.likeCurrentCard = async function () {
  if (currentIndex >= matches.length) return;
  var match = matches[currentIndex];
  var result = await likeProfile(auth.currentUser.uid, match.userId);
  if (result.isMatch) {
    var el = document.getElementById('match-name');
    if (el) el.textContent = match.name;
    var modal = document.getElementById('match-modal');
    if (modal) modal.style.display = 'flex';
  }
  currentIndex++;
  displayCurrentCard();
};

window.keepSwiping = function () {
  var modal = document.getElementById('match-modal');
  if (modal) modal.style.display = 'none';
};

window.openChat = function () {
  window.location.href = '/messages.html';
};

loadMatches();
