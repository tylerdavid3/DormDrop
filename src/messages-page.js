import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  limit,
  addDoc,
  serverTimestamp,
  updateDoc,
  increment,
  where
} from 'firebase/firestore';

let activeMatchId = null;
let activeOtherUid = null;
let unsubMsgs = null;

onAuthStateChanged(auth, function (user) {
  if (!user) {
    window.location.href = '/';
    return;
  }
  loadConversations(user.uid);
});

function loadConversations(uid) {
  const q = query(collection(db, 'matches'), where('users', 'array-contains', uid), limit(40));
  onSnapshot(q, async function (snap) {
    const rows = [];
    for (const d of snap.docs) {
      const data = d.data();
      const other = (data.users || []).find(function (u) {
        return u !== uid;
      });
      if (!other) continue;
      const udoc = await getDoc(doc(db, 'users', other));
      const name = udoc.exists() ? udoc.data().name || 'Student' : 'Student';
      rows.push({ id: d.id, otherUid: other, name: name, last: data.lastMessage });
    }
    rows.sort(function (a, b) {
      const ta = a.last && a.last.timestamp && a.last.timestamp.toMillis ? a.last.timestamp.toMillis() : 0;
      const tb = b.last && b.last.timestamp && b.last.timestamp.toMillis ? b.last.timestamp.toMillis() : 0;
      return tb - ta;
    });
    const el = document.getElementById('conv-list');
    if (rows.length === 0) {
      el.innerHTML = '<p style="color:#6B7280">No conversations yet.</p>';
      return;
    }
    el.innerHTML = rows
      .map(function (r) {
        const preview = r.last && r.last.text ? r.last.text : 'Tap to open';
        return (
          '<div class="conv" data-id="' +
          r.id +
          '" data-other="' +
          r.otherUid +
          '"><strong>' +
          escapeHtml(r.name) +
          '</strong><br/><span style="font-size:12px;color:#6B7280">' +
          escapeHtml(preview) +
          '</span></div>'
        );
      })
      .join('');
    el.querySelectorAll('.conv').forEach(function (node) {
      node.addEventListener('click', function () {
        el.querySelectorAll('.conv').forEach(function (n) {
          n.classList.remove('active');
        });
        node.classList.add('active');
        openThread(node.getAttribute('data-id'), node.getAttribute('data-other'));
      });
    });
  });
}

function openThread(matchId, otherUid) {
  activeMatchId = matchId;
  activeOtherUid = otherUid;
  if (unsubMsgs) unsubMsgs();
  // Mark messages as read for current user
  if (auth.currentUser) {
    const unreadKey = `unreadCount.${auth.currentUser.uid}`;
    updateDoc(doc(db, 'matches', matchId), { [unreadKey]: 0 }).catch(function () {});
  }
  const mq = query(
    collection(db, 'messages', matchId, 'messages'),
    orderBy('timestamp', 'asc'),
    limit(100)
  );
  unsubMsgs = onSnapshot(mq, function (qsnap) {
    const thread = document.getElementById('thread');
    thread.innerHTML = qsnap.docs
      .map(function (d) {
        const m = d.data();
        const me = m.from === auth.currentUser.uid;
        return (
          '<div class="item' +
          (me ? ' me' : '') +
          '">' +
          escapeHtml(m.text || '') +
          '</div>'
        );
      })
      .join('');
    thread.scrollTop = thread.scrollHeight;
  });
}

document.getElementById('sendBtn').addEventListener('click', send);
document.getElementById('msgIn').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') send();
});

async function send() {
  const inp = document.getElementById('msgIn');
  const text = inp.value.trim();
  if (!text || !activeMatchId || !auth.currentUser) return;
  inp.value = '';
  const uid = auth.currentUser.uid;
  await addDoc(collection(db, 'messages', activeMatchId, 'messages'), {
    from: uid,
    to: activeOtherUid,
    text: text,
    timestamp: serverTimestamp(),
    read: false
  });
  const unreadKey = `unreadCount.${activeOtherUid}`;
  await updateDoc(doc(db, 'matches', activeMatchId), {
    lastMessage: { text: text, from: uid, timestamp: serverTimestamp() },
    [unreadKey]: increment(1)
  });
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
