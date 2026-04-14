import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile, GoogleAuthProvider, signInWithPopup,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, getDoc, getDocs,
  deleteDoc, onSnapshot, query, where, orderBy, updateDoc, serverTimestamp,
  initializeFirestore, persistentLocalCache
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── GESCHÜTZTE ADMINS ───────────────────────────────
const PROTECTED_ADMINS = [
  'claus.unterberg@thomaeum.de',
  'claus.unterberg67@gmail.com'
];
let currentAdminEmail = '';

// ── GAST-KONTO ────────────────────────────────────────
const GUEST_EMAIL = 'gast@kanban-demo.de';
const GUEST_PW    = 'DemoGast2025!';

// ── FIREBASE CONFIG ──────────────────────────────────
// HIER DEINE EIGENEN FIREBASE-DATEN EINTRAGEN:
const firebaseConfig = {
  apiKey: "AIzaSyCZoyNvf7oigNpTT1YVeaAQjg9wXl3H__U",
  authDomain: "kanban-app-1d5ff.firebaseapp.com",
  projectId: "kanban-app-1d5ff",
  storageBucket: "kanban-app-1d5ff.firebasestorage.app",
  messagingSenderId: "587541755753",
  appId: "1:587541755753:web:fc61e536ebd9e869e52ff8"
};


const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = 'de';
  
// --- MODERNER OFFLINE-MODUS ---
const db = initializeFirestore(app, {
  localCache: persistentLocalCache()
});
// ------------------------------

  

// ── STATE ────────────────────────────────────────────
let currentUser  = null;
let currentBoard = null;
let boards       = [];
let columns      = [];
let cards        = {};
let unsubBoards  = null;
let unsubCols    = null;
let unsubCards   = {};
let dragCard     = null;
let dragFromCol  = null;

// ── HELPERS ──────────────────────────────────────────
window.showToast = function(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = (type==='success' ? '✓' : '✗') + ' ' + msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
}

function hideError(id) {
  document.getElementById(id).classList.remove('show');
}

window.closeModal = (id) => {
  document.getElementById(id).style.display = 'none';
};

// ── BOARD WIZARD ─────────────────────────────────────
let wizardMemberCount = 1;

window.showNewBoardModal = () => {
  document.getElementById('new-board-name').value = '';
  wizardMemberCount = 1;
  wizardNext(1);
  document.getElementById('modal-new-board').style.display = 'flex';
  setTimeout(() => document.getElementById('new-board-name').focus(), 100);
};

window.wizardNext = (step) => {
  // Validierung
  if (step === 2) {
    const name = document.getElementById('new-board-name').value.trim();
    if (!name) { document.getElementById('new-board-name').focus(); return; }
  }

  // Schritte ein-/ausblenden
  [1,2,3].forEach(s => {
    document.getElementById('wizard-step-'+s).style.display = s===step ? 'block' : 'none';
    const ws = document.getElementById('ws-'+s);
    ws.className = 'wizard-step' + (s < step ? ' done' : s === step ? ' active' : '');
  });

  const labels = ['Board benennen', 'Teamgröße wählen', 'Nicknames eingeben'];
  document.getElementById('wizard-label').textContent = labels[step-1];

  if (step === 2) renderMemberCountGrid();
  if (step === 3) renderNicknameInputs();
};

function renderMemberCountGrid() {
  const grid = document.getElementById('member-count-grid');
  grid.innerHTML = Array.from({length:10}, (_,i) => i+1).map(n => `
    <button class="member-count-btn ${n===wizardMemberCount?'selected':''}"
      onclick="selectMemberCount(${n})">${n}</button>
  `).join('');
}

window.selectMemberCount = (n) => {
  wizardMemberCount = n;
  renderMemberCountGrid();
};

function renderNicknameInputs() {
  const container = document.getElementById('nickname-inputs');
  const wip = Math.max(2, Math.ceil(wizardMemberCount * 1.5));
  container.innerHTML = `
    <div style="background:rgba(77,127,255,0.1); border:1px solid rgba(77,127,255,0.2); border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:12px; color:var(--text-muted);">
      💡 WIP-Limit wird automatisch auf <strong style="color:var(--accent);">${wip}</strong> gesetzt (${wizardMemberCount} × 1,5)
    </div>
  ` + Array.from({length:wizardMemberCount}, (_,i) => `
    <div class="nickname-input-row">
      <div class="nickname-avatar" id="nick-avatar-${i}">?</div>
      <input type="text" class="settings-input" id="nickname-${i}"
        placeholder="Person ${i+1}"
        oninput="updateNickAvatar(${i})"
        style="flex:1;"/>
    </div>
  `).join('');
}

window.updateNickAvatar = (i) => {
  const val = document.getElementById('nickname-'+i).value.trim();
  document.getElementById('nick-avatar-'+i).textContent = val ? val.slice(0,2).toUpperCase() : '?';
};

// Enter-Taste in Modals
document.getElementById('new-board-name').addEventListener('keydown', e => { if(e.key==='Enter') wizardNext(2); });
document.getElementById('new-column-name').addEventListener('keydown', e => { if(e.key==='Enter') createColumn(); });
document.getElementById('login-password').addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
document.getElementById('register-password').addEventListener('keydown', e => { if(e.key==='Enter') doRegister(); });

// ── AUTH ─────────────────────────────────────────────
window.showLogin = () => {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'none';
};

window.showResetForm = () => {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('reset-form').style.display = 'block';
  document.getElementById('reset-error').classList.remove('show');
  document.getElementById('reset-success').classList.remove('show');
  // E-Mail aus Login-Feld übernehmen falls vorhanden
  const loginEmail = document.getElementById('login-email').value;
  if (loginEmail) document.getElementById('reset-email').value = loginEmail;
};

window.doPasswordReset = async () => {
  const email = document.getElementById('reset-email').value.trim();
  const errorEl = document.getElementById('reset-error');
  const successEl = document.getElementById('reset-success');
  errorEl.classList.remove('show');
  successEl.classList.remove('show');

  if (!email) {
    showError('reset-error', 'Bitte gib deine E-Mail-Adresse ein.');
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    successEl.textContent = 'Eine E-Mail zum Zurücksetzen wurde an ' + email + ' gesendet.';
    successEl.classList.add('show');
  } catch(e) {
    const msgs = {
      'auth/user-not-found': 'Kein Konto mit dieser E-Mail-Adresse gefunden.',
      'auth/invalid-email': 'Ungültige E-Mail-Adresse.',
      'auth/too-many-requests': 'Zu viele Versuche. Bitte warte einen Moment.',
    };
    showError('reset-error', msgs[e.code] || 'Fehler: ' + e.message);
  }
};



window.showRegister = () => {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
};

window.doGoogleLogin = async () => {
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showToast('Fehler beim Google-Login', 'error');
    }
  }
};

window.doLogin = async () => {
  hideError('login-error');
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { showError('login-error', 'Bitte alle Felder ausfüllen.'); return; }
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch(e) {
    const msgs = {
      'auth/invalid-credential': 'E-Mail oder Passwort falsch.',
      'auth/user-not-found':     'Kein Konto mit dieser E-Mail gefunden.',
      'auth/wrong-password':     'Passwort falsch.',
      'auth/too-many-requests':  'Zu viele Versuche. Bitte kurz warten.',
    };
    showError('login-error', msgs[e.code] || 'Fehler beim Einloggen.');
  }
};

window.doRegister = async () => {
  hideError('register-error');
  const name     = document.getElementById('register-name').value.trim();
  const email    = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  if (!name || !email || !password) { showError('register-error', 'Bitte alle Felder ausfüllen.'); return; }
  if (password.length < 6) { showError('register-error', 'Passwort muss mindestens 6 Zeichen haben.'); return; }
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
  } catch(e) {
    const msgs = {
      'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert.',
      'auth/invalid-email':        'Ungültige E-Mail-Adresse.',
      'auth/weak-password':        'Passwort zu schwach.',
    };
    showError('register-error', msgs[e.code] || 'Fehler bei der Registrierung.');
  }
};

window.doLogout = async () => {
  if (unsubBoards) unsubBoards();
  if (unsubCols)   unsubCols();
  Object.values(unsubCards).forEach(u => u && u());
  currentBoard = null; boards = []; columns = []; cards = {}; unsubCards = {};
  await signOut(auth);
};

// ── AUTH STATE ───────────────────────────────────────
onAuthStateChanged(auth, user => {
  document.getElementById('loading-screen').style.display = 'none';
  if (user) {
    currentUser = user;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('visible');
    const displayName = user.displayName || user.email || 'Gast';
    const initials = displayName.slice(0,2).toUpperCase();
    document.getElementById('user-avatar').textContent = initials;
    document.getElementById('user-name-display').textContent = displayName;

    loadSavedBg();
    loadSavedOverlay();
    loadSavedTheme();
    loadImageCount();
    loadAgingUnit();
    
    // Admin-Button: nur für Admins sichtbar + isAdminMode setzen
    const adminBtn = document.getElementById('sidebar-admin-btn');
    const isGuestUser = (user.email === GUEST_EMAIL);
    if (adminBtn) {
      if (isGuestUser) {
        adminBtn.style.display = 'none';
        isAdminMode = false;
      } else {
        // Wir versuchen, die Admin-Daten zu laden
        getDoc(doc(db, 'app_config', 'admin')).then(snap => {
          const adminEmails = snap.data()?.adminEmails || [];
          const isAdmin = PROTECTED_ADMINS.includes(user.email) || adminEmails.includes(user.email);
          adminBtn.style.display = isAdmin ? '' : 'none';
          isAdminMode = isAdmin;
        }).catch(error => {
          // Firebase blockiert den Zugriff (weil der Nutzer kein Admin in den Regeln ist) -> Knopf verstecken!
          adminBtn.style.display = 'none';
          isAdminMode = false;
        });
      }
    }
    
    // Gast-Badge in User-Pill
    const nameEl = document.getElementById('user-name-display');
    if (nameEl && isGuestUser) nameEl.textContent = 'Gast (Demo)';

    loadBoards();
  } else {
    currentUser = null;
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').classList.remove('visible');
  }
});

// ── BOARDS ───────────────────────────────────────────
function loadBoards() {
  if (unsubBoards) unsubBoards();
  const q = query(
    collection(db, 'boards'),
    where('uid', '==', currentUser.uid),
    orderBy('createdAt', 'asc')
  );
  unsubBoards = onSnapshot(q, snap => {
    boards = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBoardsList();
    if (currentBoard && !boards.find(b => b.id === currentBoard.id)) {
      currentBoard = null;
      showEmptyState();
    }
    // Automatisch erstes Board auswählen wenn keins aktiv ist
    if (!currentBoard && boards.length > 0) {
      selectBoard(boards[0].id);
    }
  });
}

function renderBoardsList() {
  const list = document.getElementById('boards-list');
  list.innerHTML = boards.map(b => `
    <div class="board-item ${currentBoard?.id===b.id?'active':''}" onclick="selectBoard('${b.id}')">
      <div class="board-item-left">
        <div class="board-dot"></div>
        <span class="board-name">${escHtml(b.name)}</span>
      </div>
      <button class="board-delete-btn" onclick="event.stopPropagation(); duplicateBoard('${b.id}')" title="Board duplizieren" style="margin-right:2px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </button>
      <button class="board-delete-btn" onclick="event.stopPropagation(); deleteBoard('${b.id}')" title="Board löschen">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  `).join('');
}

window.createBoard = async () => {
  const name = document.getElementById('new-board-name').value.trim();
  if (!name) return;

  // Nicknames sammeln
  const members = [];
  for (let i = 0; i < wizardMemberCount; i++) {
    const nick = document.getElementById('nickname-'+i)?.value.trim() || `Person ${i+1}`;
    members.push(nick);
  }

  // WIP-Limit berechnen
  const wipLimit = Math.max(2, Math.ceil(wizardMemberCount * 1.5));

  closeModal('modal-new-board');

  const ref = await addDoc(collection(db, 'boards'), {
    name,
    uid: currentUser.uid,
    ownerName: currentUser.displayName || currentUser.email || '',
    members,
    wipLimit,
    createdAt: serverTimestamp()
  });

  // Standardspalten anlegen
  const defaults = [
    { name:'— Offen',         color:'#5c6ef8', order:0, wipLimit: 0      },
    { name:'— In Bearbeitung', color:'#f59e0b', order:1, wipLimit: wipLimit},
    { name:'— Fertig',         color:'#10b981', order:2, wipLimit: 0      },
  ];
  for (const col of defaults) {
    await addDoc(collection(db, 'boards', ref.id, 'columns'), {
      ...col, createdAt: serverTimestamp()
    });
  }
  selectBoard(ref.id);
  showToast(`Board erstellt! WIP-Limit: ${wipLimit}`);
};

window.duplicateBoard = async (boardId) => {
  const src = boards.find(b => b.id === boardId);
  if (!src) return;
  showToast('Board wird dupliziert…');

  // Neues Board anlegen
  const newBoardRef = await addDoc(collection(db, 'boards'), {
    name:      src.name + ' – Kopie',
    uid:       currentUser.uid,
    ownerName: currentUser.displayName || currentUser.email || '',
    members:   src.members  || [],
    wipLimit:  src.wipLimit || 3,
    agingDays: src.agingDays || 5,
    createdAt: serverTimestamp()
  });

  // Spalten kopieren
  const colSnap = await getDocs(
    query(collection(db, 'boards', boardId, 'columns'), orderBy('order', 'asc'))
  );
  for (const colDoc of colSnap.docs) {
    const colData = colDoc.data();
    const newColRef = await addDoc(
      collection(db, 'boards', newBoardRef.id, 'columns'),
      { name: colData.name, color: colData.color, order: colData.order,
        wipLimit: colData.wipLimit || 0, createdAt: serverTimestamp() }
    );

    // Karten in dieser Spalte kopieren
    const cardSnap = await getDocs(
      query(collection(db, 'boards', boardId, 'columns', colDoc.id, 'cards'),
      orderBy('order'))
    );
    for (const cardDoc of cardSnap.docs) {
      const c = cardDoc.data();
      await addDoc(
        collection(db, 'boards', newBoardRef.id, 'columns', newColRef.id, 'cards'),
        {
          text:       c.text       || '',
          priority:   c.priority   || '',
          assignee:   c.assignee   || '',
          due:        c.due        || '',
          order:      c.order      ?? 0,
          startedAt:  c.startedAt  || '',
          finishedAt: c.finishedAt || '',
          createdAt:  serverTimestamp()
        }
      );
    }
  }

  showToast('✅ Board dupliziert: ' + src.name + ' – Kopie');
  selectBoard(newBoardRef.id);
};

window.deleteBoard = async (boardId) => {
  if (!await currentUserIsAdmin()) {
    showToast('⛔ Nur Admins können Boards löschen.', 'error');
    return;
  }
  if (!confirm('Board wirklich löschen? Alle Karten gehen verloren.')) return;
  await deleteDoc(doc(db, 'boards', boardId));
  if (currentBoard?.id === boardId) { currentBoard = null; showEmptyState(); }
  showToast('Board gelöscht');
};

window.selectBoard = (boardId) => {
  currentBoard = boards.find(b => b.id === boardId) || null;
  if (!currentBoard) return;
  renderBoardsList();
  loadColumns();
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('board-content').style.display = 'block';
  document.getElementById('board-title-display').textContent = currentBoard.name;
};

function showEmptyState() {
  document.getElementById('empty-state').style.display = 'flex';
  document.getElementById('board-content').style.display = 'none';
}

// ── COLUMNS ──────────────────────────────────────────
function loadColumns() {
  if (unsubCols) unsubCols();
  Object.values(unsubCards).forEach(u => u && u());
  unsubCards = {};

  const q = query(
    collection(db, 'boards', currentBoard.id, 'columns'),
    orderBy('order', 'asc')
  );
  unsubCols = onSnapshot(q, snap => {
    columns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderColumns();
    columns.forEach(col => loadCards(col.id));
  });
}

function isFinishedColumn(col) {
  const name = (col.name||'').toLowerCase();
  return name.includes('fertig') || name.includes('done') || name.includes('erledigt') || name.includes('abgeschlossen');
}

function getWipStatus(col) {
  const limit = col.wipLimit || 0;
  const count = (cards[col.id]||[]).length;
  if (!limit || isFinishedColumn(col)) return { cls:'wip-ok', badge:'', colCls:'' };
  if (count >= limit)   return { cls:'wip-exceed', badge:`${count}/${limit}`, colCls:'wip-exceeded' };
  if (count >= limit-1) return { cls:'wip-warn',   badge:`${count}/${limit}`, colCls:'wip-warning'  };
  return { cls:'wip-ok', badge:`${count}/${limit}`, colCls:'' };
}

function reloadIcons() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderColumns() {
  const container = document.getElementById('columns-container');
  setTimeout(reloadIcons, 50);
  container.innerHTML = columns.map(col => {
    const wip = getWipStatus(col);
    const wipLabel = (!isFinishedColumn(col) && col.wipLimit)
      ? `<span class="wip-badge ${wip.cls}">${wip.badge}</span>` : '';
    const wipBtn = ''; // WIP-Limit wird beim Board-Erstellen automatisch gesetzt
    return `
    <div class="column ${wip.colCls}" id="col-${col.id}">
      <div class="column-header">
        <div class="column-title-row">
          <div class="column-dot" style="background:${col.color||'var(--accent)'}"></div>
          <span class="column-title">${escHtml(col.name)}</span>
          <span class="column-count" id="count-${col.id}">0</span>
          ${wipLabel}
        </div>
        <div class="column-actions">
          ${wipBtn}
          <button class="col-btn" onclick="deleteColumn('${col.id}')" title="Spalte löschen">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      </div>
      <div class="cards-list" id="cards-${col.id}"
        ondragover="onDragOver(event,'${col.id}')"
        ondragleave="onDragLeave(event,'${col.id}')"
        ondrop="onDrop(event,'${col.id}')">
      </div>
      <button class="btn-show-add" onclick="showAddCard('${col.id}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M5 12h14"/><path d="M12 5v14"/></svg> Karte hinzufügen
      </button>
      <div class="add-card-form" id="add-form-${col.id}" style="display:none;">
        <textarea class="add-card-textarea" id="card-text-${col.id}" placeholder="Aufgabe beschreiben…" rows="3"></textarea>
        <div class="add-card-controls">
          <select class="priority-select" id="card-prio-${col.id}">
            <option value="">Priorität</option>
            <option value="hoch">🔴 Hoch</option>
            <option value="mittel">🟡 Mittel</option>
            <option value="niedrig">🟢 Niedrig</option>
          </select>
          <button class="btn-add-card" onclick="addCard('${col.id}')">Hinzufügen</button>
          <button class="btn-cancel-card" onclick="hideAddCard('${col.id}')">Abbrechen</button>
        </div>
      </div>
    </div>
  `; }).join('') + `
    <button class="add-column-btn" onclick="showAddColumnModal()">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      <span>Spalte hinzufügen</span>
    </button>
  `;
}

window.showAddColumnModal = () => {
  document.getElementById('new-column-name').value = '';
  document.getElementById('modal-new-column').style.display = 'flex';
  setTimeout(() => document.getElementById('new-column-name').focus(), 100);
};

window.createColumn = async () => {
  const name = document.getElementById('new-column-name').value.trim();
  if (!name) return;
  closeModal('modal-new-column');
  const colors = ['#5c6ef8','#f59e0b','#10b981','#ec4899','#06b6d4','#8b5cf6'];
  const color  = colors[columns.length % colors.length];
  await addDoc(collection(db, 'boards', currentBoard.id, 'columns'), {
    name, color, order: columns.length, createdAt: serverTimestamp()
  });
  showToast('Spalte hinzugefügt!');
};

window.deleteColumn = async (colId) => {
  if (!await currentUserIsAdmin()) {
    showToast('⛔ Nur Admins können Spalten löschen.', 'error');
    return;
  }
  if (!confirm('Spalte und alle Karten darin löschen?')) return;
  const cardSnap = await getDocs(collection(db, 'boards', currentBoard.id, 'columns', colId, 'cards'));
  for (const c of cardSnap.docs) await deleteDoc(c.ref);
  await deleteDoc(doc(db, 'boards', currentBoard.id, 'columns', colId));
  showToast('Spalte gelöscht');
};

// ── CARDS ────────────────────────────────────────────
function loadCards(colId) {
  if (unsubCards[colId]) unsubCards[colId]();
  const q = query(
    collection(db, 'boards', currentBoard.id, 'columns', colId, 'cards'),
    orderBy('order', 'asc')
  );
  unsubCards[colId] = onSnapshot(q, snap => {
    cards[colId] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCards(colId);
  });
}

function isAgingCard(card, colId) {
  const col = columns.find(c => c.id === colId);
  if (!col) return false;
  const colName = (col.name||'').toLowerCase();
  const isInProgress = colName.includes('bearbeitung') || colName.includes('progress') || colName.includes('doing');
  if (!isInProgress) return false;
  if (!card.startedAt) return false;
  const limit = currentBoard?.agingDays || 5;
  const diff  = (new Date() - new Date(card.startedAt)) / 86400000;
  return diff >= limit;
}

function getAgingDays(card) {
  if (!card.startedAt) return 0;
  const val = Math.floor((new Date() - new Date(card.startedAt)) / 86400000);
  return `${val} ${val === 1 ? 'Tag' : 'Tagen'}`;
}

function getDueClass(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due);
  const diff = Math.ceil((d - today) / 86400000);
  if (diff < 0)  return 'due-overdue';
  if (diff <= 2) return 'due-soon';
  return 'due-ok';
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

function renderCards(colId) {
  const list = document.getElementById('cards-' + colId);
  if (!list) return;
  const colCards = cards[colId] || [];
  const count = document.getElementById('count-' + colId);
  if (count) count.textContent = colCards.length;

  // WIP-Status aktualisieren
  const col = columns.find(c => c.id === colId);
  if (col) {
    const colEl = document.getElementById('col-' + colId);
    if (colEl) {
      colEl.classList.remove('wip-warning','wip-exceeded');
      const wip = getWipStatus({...col, id: colId});
      if (wip.colCls) colEl.classList.add(wip.colCls);
      // WIP-Badge aktualisieren
      const badge = colEl.querySelector('.wip-badge');
      if (badge) badge.textContent = wip.badge;
    }
  }

  setTimeout(reloadIcons, 50);
  list.innerHTML = colCards.map(card => {
    const dueClass = getDueClass(card.due);
    const dueLabel = card.due ? `<span class="card-due ${dueClass}">📅 ${formatDate(card.due)}</span>` : '';
    const myCard   = card.assignee && currentUser &&
                       (card.assignee === currentUser.email || card.assignee === currentUser.displayName);
    const aging    = isAgingCard(card, colId);
    const agingDays = getAgingDays(card);
    const agingHtml = aging
      ? '<div class="aging-badge"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg> Seit ' + agingDays + ' in Bearbeitung</div>'
      : '';
    const assigneeHtml = card.assignee
      ? `<div class="card-assignee">
             <div class="assignee-avatar">${card.assignee.slice(0,2).toUpperCase()}</div>
             <span>${escHtml(card.assignee)}</span>
           </div>` : '';
    const tsHtml = (card.startedAt || card.finishedAt)
      ? `<div class="card-timestamps">
             ${card.startedAt ? `<span class="ts-item">▶ ${formatDate(card.startedAt)}</span>` : ''}
             ${card.finishedAt ? `<span class="ts-item">✓ ${formatDate(card.finishedAt)}</span>` : ''}
           </div>` : '';
    const agingClass = aging ? 'aging-warn' : '';
    return `
    <div class="card ${myCard?'my-card':''} ${agingClass}" id="card-${card.id}"
      draggable="true"
      ondragstart="onDragStart(event,'${card.id}','${colId}')"
      ondragend="onDragEnd(event)"
      ondblclick="openEditCard('${card.id}','${colId}')">
      <div class="card-text">${linkify(escHtml(card.text))}</div>
      ${assigneeHtml}
      ${agingHtml}
      ${tsHtml}
      <div class="card-footer">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${card.priority ? `<span class="card-priority priority-${card.priority}">${card.priority.toUpperCase()}</span>` : ''}
          ${dueLabel}
        </div>
        <div class="card-actions">
          <button class="card-btn" onclick="openEditCard('${card.id}','${colId}')" title="Bearbeiten">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="card-btn delete" onclick="deleteCard('${card.id}','${colId}')" title="Löschen">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

window.showAddCard = (colId) => {
  document.getElementById('add-form-' + colId).style.display = 'block';
  document.getElementById('card-text-' + colId).focus();
};

window.hideAddCard = (colId) => {
  document.getElementById('add-form-' + colId).style.display = 'none';
  document.getElementById('card-text-' + colId).value = '';
};

window.addCard = async (colId) => {
  const text  = document.getElementById('card-text-' + colId).value.trim();
  const prio  = document.getElementById('card-prio-' + colId).value;
  if (!text) return;
  const colCards = cards[colId] || [];
  await addDoc(collection(db, 'boards', currentBoard.id, 'columns', colId, 'cards'), {
    text, priority: prio, order: colCards.length, createdAt: serverTimestamp()
  });
  hideAddCard(colId);
  showToast('Karte hinzugefügt!');
};

window.deleteCard = async (cardId, colId) => {
  const card = (cards[colId]||[]).find(c => c.id === cardId);
  const isOwn = !card?.assignee ||
                card.assignee === currentUser?.displayName ||
                card.assignee === currentUser?.email;
  if (!isOwn && !isAdminMode) {
    showToast('⛔ Du kannst nur eigene Karten löschen.', 'error');
    return;
  }
  
  if (!confirm('Möchtest du diese Aufgabe wirklich löschen?')) {
    return;
  }

  await deleteDoc(doc(db, 'boards', currentBoard.id, 'columns', colId, 'cards', cardId));
  showToast('Karte gelöscht');
};

window.openEditCard = (cardId, colId) => {
  const card = (cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  document.getElementById('edit-card-id').value       = cardId;
  document.getElementById('edit-card-col').value      = colId;
  document.getElementById('edit-card-text').value     = card.text;
  document.getElementById('edit-card-priority').value = card.priority || '';
  document.getElementById('edit-card-due').value      = card.due || '';

  // Dropdown mit Board-Mitgliedern füllen
  const sel = document.getElementById('edit-card-assignee');
  const members = currentBoard?.members || [];
  sel.innerHTML = '<option value="">– Niemand –</option>' +
    members.map(m => `<option value="${escHtml(m)}" ${card.assignee===m?'selected':''}>${escHtml(m)}</option>`).join('');
  if (!members.length) {
    sel.innerHTML = '<option value="">Keine Mitglieder definiert</option>';
  }

  document.getElementById('modal-edit-card').style.display = 'flex';
};

window.saveEditCard = async () => {
  const cardId   = document.getElementById('edit-card-id').value;
  const colId    = document.getElementById('edit-card-col').value;
  const text     = document.getElementById('edit-card-text').value.trim();
  const prio     = document.getElementById('edit-card-priority').value;
  const due      = document.getElementById('edit-card-due').value;
  const assignee = document.getElementById('edit-card-assignee').value.trim();
  if (!text) return;
  await updateDoc(doc(db, 'boards', currentBoard.id, 'columns', colId, 'cards', cardId), {
    text, priority: prio, due: due || '', assignee: assignee || ''
  });
  closeModal('modal-edit-card');
  showToast('Karte gespeichert!');
};

// ── WIP LIMIT ────────────────────────────────────────
window.openWipModal = (colId) => {
  const col = columns.find(c => c.id === colId);
  if (!col) return;
  document.getElementById('wip-col-id').value    = colId;
  document.getElementById('wip-limit-input').value = col.wipLimit || 0;
  document.getElementById('modal-wip').style.display = 'flex';
  setTimeout(() => document.getElementById('wip-limit-input').focus(), 100);
};

window.saveWipLimit = async () => {
  const colId = document.getElementById('wip-col-id').value;
  const limit = parseInt(document.getElementById('wip-limit-input').value) || 0;
  await updateDoc(doc(db, 'boards', currentBoard.id, 'columns', colId), { wipLimit: limit });
  closeModal('modal-wip');
  showToast(limit ? `WIP-Limit auf ${limit} gesetzt` : 'WIP-Limit entfernt');
};

document.getElementById('wip-limit-input').addEventListener('keydown', e => { if(e.key==='Enter') saveWipLimit(); });

// ── DRAG & DROP ──────────────────────────────────────
window.onDragStart = (e, cardId, colId) => {
  dragCard    = cardId;
  dragFromCol = colId;
  setTimeout(() => document.getElementById('card-'+cardId)?.classList.add('dragging'), 0);
};

window.onDragEnd = (e) => {
  document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging'));
};

window.onDragOver = (e, colId) => {
  e.preventDefault();
  document.getElementById('cards-'+colId)?.classList.add('drag-over');
};

window.onDragLeave = (e, colId) => {
  document.getElementById('cards-'+colId)?.classList.remove('drag-over');
};

window.onDrop = async (e, toColId) => {
  e.preventDefault();
  document.getElementById('cards-'+toColId)?.classList.remove('drag-over');
  if (!dragCard || toColId === dragFromCol) return;

  const fromColId = dragFromCol;
  const cardId    = dragCard;
  dragCard = null; dragFromCol = null;

  // WIP-Limit prüfen
  const toCol   = columns.find(c => c.id === toColId);
  const toCount = (cards[toColId]||[]).length;
  if (toCol?.wipLimit && !isFinishedColumn(toCol) && toCount >= toCol.wipLimit) {
    showToast(`⚠️ WIP-Limit (${toCol.wipLimit}) erreicht! Karte kann nicht verschoben werden.`, 'error');
    return;
  }

  // Daten aus Quelle holen
  const srcCard = (cards[fromColId]||[]).find(c => c.id === cardId);
  if (!srcCard) return;

  // Zeitstempel bestimmen
  const now = new Date().toISOString().split('T')[0];
  const toColObj   = columns.find(c => c.id === toColId);
  const fromColObj = columns.find(c => c.id === fromColId);
  const isNowFinished = isFinishedColumn(toColObj||{});
  const wasInProgress = !isFinishedColumn(fromColObj||{}) && fromColId !== (columns[0]?.id);

  const startedAt  = srcCard.startedAt || (!isFinishedColumn(fromColObj||{}) ? now : '');
  const finishedAt = isNowFinished ? now : '';

  // Zur Zielspalte hinzufügen
  const toCards = cards[toColId] || [];
  await addDoc(collection(db, 'boards', currentBoard.id, 'columns', toColId, 'cards'), {
    text:       srcCard.text,
    priority:   srcCard.priority  || '',
    due:        srcCard.due       || '',
    assignee:   srcCard.assignee  || '',
    startedAt:  startedAt,
    finishedAt: finishedAt,
    order:      toCards.length,
    createdAt:  serverTimestamp()
  });

  // Aus Quellspalte löschen
  await deleteDoc(doc(db, 'boards', currentBoard.id, 'columns', fromColId, 'cards', cardId));
  showToast(isNowFinished ? '✅ Erledigt!' : '↔ Karte verschoben');
};

// Lucide Icons rendern
if (typeof lucide !== 'undefined') lucide.createIcons();

// ── HINTERGRUND ──────────────────────────────────────
const BG_KEY     = 'kanban_bg';
const OVERLAY_KEY = 'kanban_overlay';
const THEME_KEY  = 'kanban_theme';

window.setTheme = async (theme) => {
  applyTheme(theme);
  localStorage.setItem(THEME_KEY + '_' + currentUser?.uid, theme);
  if (currentUser) {
    try {
      await setDoc(doc(db, 'user_settings', currentUser.uid), { theme }, { merge: true });
    } catch(e) { /* silent */ }
  }
  renderSettingsPanel();
};

function applyTheme(theme) {
  if (theme === 'light') {
    document.body.classList.add('theme-light');
  } else {
    document.body.classList.remove('theme-light');
  }
}

async function loadSavedTheme() {
  try {
    const snap = await getDoc(doc(db, 'user_settings', currentUser.uid));
    if (snap.exists() && snap.data().theme) {
      const theme = snap.data().theme;
      localStorage.setItem(THEME_KEY + '_' + currentUser.uid, theme);
      applyTheme(theme);
      return;
    }
  } catch(e) { /* silent */ }
  const saved = localStorage.getItem(THEME_KEY + '_' + currentUser?.uid) || 'dark';
  applyTheme(saved);
}

window.setOverlay = async (value) => {
  const opacity = (value / 100).toFixed(2);
  document.documentElement.style.setProperty('--panel-opacity', opacity);
  localStorage.setItem(OVERLAY_KEY + '_' + currentUser?.uid, value);
  const slider = document.getElementById('overlay-slider');
  if (slider) slider.value = value;
  // Auch in Firebase speichern
  if (currentUser) {
    try {
      await setDoc(doc(db, 'user_settings', currentUser.uid), {
        overlayOpacity: value
      }, { merge: true });
    } catch(e) { /* silent */ }
  }
};

async function loadSavedOverlay() {
  // Zuerst Firebase versuchen
  try {
    const snap = await getDoc(doc(db, 'user_settings', currentUser.uid));
    if (snap.exists() && snap.data().overlayOpacity !== undefined) {
      const val = snap.data().overlayOpacity;
      localStorage.setItem(OVERLAY_KEY + '_' + currentUser.uid, val);
      setOverlay(val);
      return;
    }
  } catch(e) { /* silent */ }
  // Fallback: localStorage
  const saved = localStorage.getItem(OVERLAY_KEY + '_' + currentUser?.uid) || '72';
  setOverlay(saved);
}

// Vordefinierte Hintergründe
const BG_PRESETS = [
  { label: 'Standard',  value: '',         style: 'linear-gradient(135deg,#0a0e1a,#1a2a6c)' },
  { label: 'Ozean',     value: '__ocean',   style: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
  { label: 'Aurora',    value: '__aurora',  style: 'linear-gradient(135deg,#0d0d2b,#1a4a3a,#0d1b4a)' },
  { label: 'Dämmerung', value: '__dusk',    style: 'linear-gradient(135deg,#1a0533,#2d1b69,#11998e)' },
  { label: 'Mitternacht',value:'__midnight',style: 'linear-gradient(135deg,#0a0a0a,#1a1a2e,#16213e)' },
  { label: 'Saphir',    value: '__sapphire',style: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
];

const BG_GRADIENTS = {
  '__ocean':    'linear-gradient(135deg,#0f2027,#203a43,#2c5364)',
  '__aurora':   'linear-gradient(135deg,#0d0d2b,#1a4a3a,#0d1b4a)',
  '__dusk':     'linear-gradient(135deg,#1a0533,#2d1b69,#11998e)',
  '__midnight': 'linear-gradient(135deg,#0a0a0a,#1a1a2e,#16213e)',
  '__sapphire': 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',
};

function applyBg(value) {
  const layer = document.getElementById('bg-layer');
  if (!value) {
    layer.style.backgroundImage = 'none';
  } else if (value.startsWith('__')) {
    layer.style.backgroundImage = BG_GRADIENTS[value] || 'none';
  } else {
    layer.style.backgroundImage = `url('images/${value}')`;
  }
  // Aktiven Preset markieren
  document.querySelectorAll('.bg-preset').forEach(el => {
    el.classList.toggle('active', el.dataset.bg === value);
  });
}

window.setBg = async (value) => {
  applyBg(value);
  localStorage.setItem(BG_KEY + '_' + currentUser?.uid, value);
  // Auch in Firebase speichern
  if (currentUser) {
    try {
      await setDoc(doc(db, 'user_settings', currentUser.uid), {
        bg: value,
        overlayOpacity: localStorage.getItem('kanban_overlay_' + currentUser.uid) || '72'
      }, { merge: true });
    } catch(e) { /* silent */ }
  }
};



async function loadSavedBg() {
  // Zuerst Firebase versuchen
  try {
    const snap = await getDoc(doc(db, 'user_settings', currentUser.uid));
    if (snap.exists() && snap.data().bg !== undefined) {
      const bg = snap.data().bg;
      localStorage.setItem(BG_KEY + '_' + currentUser.uid, bg);
      applyBg(bg);
      return;
    }
  } catch(e) { /* silent */ }
  // Fallback: localStorage
  const saved = localStorage.getItem(BG_KEY + '_' + currentUser?.uid) || '';
  applyBg(saved);
}

window.toggleSettingsPanel = () => {
  const panel = document.getElementById('settings-panel');
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) renderSettingsPanel();
};

function renderSettingsPanel() {
  const presetsEl = document.getElementById('bg-presets');
  const currentBg = localStorage.getItem(BG_KEY + '_' + currentUser?.uid) || '';
  // Slider-Wert setzen
  const savedOverlay = localStorage.getItem(OVERLAY_KEY + '_' + currentUser?.uid) || '72';
  const slider = document.getElementById('overlay-slider');
  if (slider) slider.value = savedOverlay;

  // AI Key setzen

  // Theme Buttons setzen
  const currentTheme = localStorage.getItem(THEME_KEY + '_' + currentUser?.uid) || 'dark';
  const btnDark = document.getElementById('btn-theme-dark');
  const btnLight = document.getElementById('btn-theme-light');
  if (btnDark && btnLight) {
    btnDark.className = currentTheme === 'dark' ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
    btnLight.className = currentTheme === 'light' ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  }

  presetsEl.innerHTML = BG_PRESETS.map(p => `
    <div class="bg-preset ${currentBg===p.value?'active':''}"
         data-bg="${p.value}"
         style="background: ${p.style};"
         onclick="setBg('${p.value}')">
      <span>${p.label}</span>
    </div>
  `).join('');
  renderCustomImages();
}

function renderCustomImages() {
  const count     = getImageCount();
  const currentBg = localStorage.getItem(BG_KEY + '_' + currentUser?.uid) || '';
  const label     = document.getElementById('img-thumbnails-label');
  if (label) label.textContent = `Hintergrundbilder (H1–H${count})`;
  const el = document.getElementById('custom-images-list');
  if (!el) return;
  el.innerHTML = Array.from({length: count}, (_, i) => i + 1).map(i => `
    <div class="bg-preset ${currentBg===`H${i}.png`?'active':''}"
         data-bg="H${i}.png"
         style="background-image:url('images/H${i}.png'); background-size:cover; background-position:center;"
         onclick="setBg('H${i}.png')">
      <span>H${i}</span>
    </div>
  `).join('');
}



// ── ADMIN ────────────────────────────────────────────
let isAdminMode = false;
const ADMIN_DOC = 'app_config/admin';

async function currentUserIsAdmin() {
  if (isAdminMode) return true;
  const email = auth.currentUser?.email || '';
  if (PROTECTED_ADMINS.includes(email)) return true;
  try {
    const snap = await getDoc(doc(db, 'app_config', 'admin'));
    const adminEmails = snap.data()?.adminEmails || [];
    return adminEmails.includes(email);
  } catch(e) { return false; }
}

window.openAdminArea = async () => {
  // 1. Prüfen, ob überhaupt jemand angemeldet ist
  if (!currentUser) {
    showToast('Bitte melde dich zuerst an.', 'error');
    return;
  }

  const userEmail = currentUser.email || '';

  // 2. Admin-Daten aus der Datenbank abrufen
  const snap = await getDoc(doc(db, 'app_config', 'admin'));
  const data = snap.exists() ? snap.data() : {};
  const adminEmails = data.adminEmails || [];

  // 3. Berechtigung prüfen (Deine Master-Mails + Liste aus DB)
  const isMaster = (userEmail === 'claus.unterberg@thomaeum.de' || userEmail === 'claus.unterberg67@gmail.com');
  const isListedAdmin = adminEmails.map(e => e.toLowerCase()).includes(userEmail.toLowerCase());

  if (!isMaster && !isListedAdmin) {
    // Die Warnung für Unbefugte
    console.warn(`Sicherheitswarnung: Unbefugter Admin-Zugriffsversuch von ${userEmail}`);
    showToast('⛔ Zugriff verweigert: Du hast keine Administrator-Rechte.', 'error');
    return;
  }

  // 4. Falls alles okay ist: Direkt ins Panel (kein Passwort mehr nötig!)
  isAdminMode = true;
  openAdminPanel();
};

// Einfaches Hash (für clientseitige Prüfung – kein Ersatz für serverseitige Auth)
async function hashPassword(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

window.doAdminSetup = async () => {
  const pw1 = document.getElementById('admin-setup-pw1').value;
  const pw2 = document.getElementById('admin-setup-pw2').value;
  const err = document.getElementById('admin-setup-error');
  if (pw1.length < 6) { err.textContent='Mindestens 6 Zeichen.'; err.classList.add('show'); return; }
  if (pw1 !== pw2)  { err.textContent='Passwörter stimmen nicht überein.'; err.classList.add('show'); return; }
  const hash = await hashPassword(pw1);
  // Aktuelle E-Mail automatisch als erste Admin-E-Mail eintragen
  const adminEmails = currentUser?.email ? [currentUser.email] : [];
  await setDoc(doc(db, 'app_config', 'admin'), { passwordHash: hash, adminEmails });
  closeModal('modal-admin-setup');
  showToast('Admin eingerichtet! Deine E-Mail ist als Admin hinterlegt.');
  // Direkt einloggen
  isAdminMode = true;
  openAdminPanel();
};



document.getElementById('admin-password-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') doAdminLogin();
});

window.changeAdminPassword = async () => {
  const pw1 = document.getElementById('admin-change-pw1').value;
  const pw2 = document.getElementById('admin-change-pw2').value;
  const err = document.getElementById('admin-change-error');
  if (pw1.length < 6) { err.textContent='Mindestens 6 Zeichen.'; err.classList.add('show'); return; }
  if (pw1 !== pw2)  { err.textContent='Passwörter stimmen nicht überein.'; err.classList.add('show'); return; }
  const hash = await hashPassword(pw1);
  await setDoc(doc(db, 'app_config', 'admin'), { passwordHash: hash });
  err.classList.remove('show');
  document.getElementById('admin-change-pw1').value = '';
  document.getElementById('admin-change-pw2').value = '';
  showToast('Passwort geändert!');
};

async function openAdminPanel() {
  document.getElementById('admin-panel').style.display = 'block';
  showAdminTab('grades');
  // Nutzer-Listen werden beim Tab-Wechsel geladen
}

// Beim Laden der Boards ownerName aktualisieren falls fehlt
async function ensureOwnerName(boardId) {
  const snap = await getDoc(doc(db, 'boards', boardId));
  if (snap.exists() && !snap.data().ownerName && currentUser) {
    await updateDoc(doc(db, 'boards', boardId), {
      ownerName: currentUser.displayName || currentUser.email || ''
    });
  }
}

async function loadAdminEmails() {
  const snap = await getDoc(doc(db, 'app_config', 'admin'));
  const emails = snap.data()?.adminEmails || [];
  const list = document.getElementById('admin-emails-list');
  if (!emails.length) {
    list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Keine Admin-E-Mails hinterlegt.</div>';
    return;
  }
  list.innerHTML = emails.map((email, i) => `
    <div style="display:flex; align-items:center; justify-content:space-between;
      padding:8px 12px; background:rgba(10,20,60,0.4);
      border:1px solid var(--border); border-radius:8px; margin-bottom:6px; font-size:13px;">
      <span>📧 ${escHtml(email)}</span>
      ${email.toLowerCase() === currentUser?.email?.toLowerCase()
        ? '<span style="font-size:11px;color:var(--text-muted);">(du)</span>'
        : `<button class="btn-delete-admin" onclick="removeAdminEmail('${escHtml(email)}')">✕</button>`
      }
    </div>
  `).join('');
}

window.addAdminEmail = async () => {
  const email = document.getElementById('admin-new-email').value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showToast('Ungültige E-Mail', 'error'); return; }
  const snap   = await getDoc(doc(db, 'app_config', 'admin'));
  const emails = snap.data()?.adminEmails || [];
  if (emails.map(e=>e.toLowerCase()).includes(email)) { showToast('Bereits vorhanden', 'error'); return; }
  emails.push(email);
  await updateDoc(doc(db, 'app_config', 'admin'), { adminEmails: emails });
  document.getElementById('admin-new-email').value = '';
  showToast('Admin-E-Mail hinzugefügt!');
  loadAdminEmails();
};

// ── BILDANZAHL ───────────────────────────────────────
const IMG_COUNT_KEY = 'kanban_img_count';

async function loadImageCountTab() {
  const snap  = await getDoc(doc(db, 'app_config', 'admin'));
  const count = snap.data()?.imageCount || 20;
  document.getElementById('admin-img-count').value = count;
  updateImgPreview(count);
}

window.saveImageCount = async () => {
  const count = parseInt(document.getElementById('admin-img-count').value) || 20;
  if (count < 1 || count > 200) { showToast('Bitte eine Zahl zwischen 1 und 200', 'error'); return; }
  await updateDoc(doc(db, 'app_config', 'admin'), { imageCount: count });
  // Lokal speichern damit alle Nutzer es sofort sehen
  localStorage.setItem(IMG_COUNT_KEY, count);
  updateImgPreview(count);
  showToast(`Bildanzahl auf ${count} gesetzt!`);
  // Settings-Panel Thumbnails neu laden falls offen
  renderSettingsPanel();
};

function updateImgPreview(count) {
  const el = document.getElementById('admin-img-preview');
  if (el) el.textContent = `→ Es werden ${count} Thumbnails angezeigt: H1.png bis H${count}.png`;
}

async function loadImageCount() {
  // Beim App-Start aktuelle Bildanzahl aus Firebase laden
  try {
    const snap  = await getDoc(doc(db, 'app_config', 'admin'));
    const count = snap.data()?.imageCount || 20;
    localStorage.setItem(IMG_COUNT_KEY, count);
  } catch(e) { /* silent */ }
}

function getImageCount() {
  return parseInt(localStorage.getItem(IMG_COUNT_KEY) || '20');
}

// ── NUTZERVERWALTUNG ─────────────────────────────────
window.loadAdminUsers = async () => {
  const list = document.getElementById('admin-users-list');
  list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade Nutzer…</div>';

  // Alle Boards laden und nach uid gruppieren
  const boardsSnap = await getDocs(collection(db, 'boards'));
  const userMap    = {}; // uid → { boards: [], email: '', name: '' }

  boardsSnap.docs.forEach(d => {
    const uid  = d.data().uid || 'unbekannt';
    const name = d.data().ownerName || '';
    if (!userMap[uid]) userMap[uid] = { uid, name, boards: [] };
    userMap[uid].boards.push({ id: d.id, name: d.data().name, members: d.data().members || [] });
  });

  // Firebase Auth Nutzer können wir nicht direkt auflisten (nur über Admin SDK)
  // Daher: Nutzer aus Boards rekonstruieren + aktuellen Nutzer ergänzen
  if (!userMap[currentUser.uid]) {
    userMap[currentUser.uid] = { uid: currentUser.uid, name: currentUser.displayName || currentUser.email, boards: [] };
  }

  const cfgSnap2 = await getDoc(doc(db, 'app_config', 'admin'));
  const adminEmailsList = cfgSnap2.data()?.adminEmails || [];
  const users = Object.values(userMap);
  if (!users.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Noch keine Nutzer mit Boards.</div>';
    return;
  }

  list.innerHTML = users.map(u => `
    <div class="user-row" id="user-row-${u.uid}">
      <div class="user-row-header" onclick="toggleUserBoards('${u.uid}')">
        <div class="assignee-avatar">${(u.name||u.uid).slice(0,2).toUpperCase()}</div>
        <div style="flex:1;">
          <div style="font-weight:600; font-size:13px;">${escHtml(u.name || '–')}</div>
          <div style="font-size:11px; color:var(--text-muted);">
            ${u.boards.length} Board${u.boards.length!==1?'s':''} · ID: ${u.uid.slice(0,10)}…
          </div>
        </div>
        <span style="font-size:11px; color:var(--text-muted);" id="user-chevron-${u.uid}">▶</span>
        ${u.uid !== currentUser.uid ? `
          <button class="btn-delete-admin" style="margin-left:8px;"
            onclick="event.stopPropagation(); adminDeleteUser('${u.uid}', '${escHtml(u.name||u.uid)}')">
            🗑 Löschen
          </button>` : '<span style="font-size:11px;color:var(--text-muted);margin-left:8px;">(du)</span>'
        }
      </div>
      <div class="user-row-boards" id="user-boards-${u.uid}">
        ${u.boards.length === 0
          ? '<div style="font-size:12px;color:var(--text-muted);">Keine Boards.</div>'
          : u.boards.map(b => `
            <div class="user-board-item">
              <div>
                <div style="font-weight:600;">🗂️ ${escHtml(b.name)}</div>
                <div style="color:var(--text-muted); margin-top:2px;">
                  👥 ${b.members.length ? escHtml(b.members.join(', ')) : 'Keine Mitglieder'}
                </div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="btn-sm btn-sm-ghost" style="font-size:11px;"
                  onclick="adminViewBoard('${b.id}')">👁 Ansehen</button>
                <button class="btn-delete-admin"
                  onclick="adminDeleteBoard('${b.id}', '${escHtml(b.name)}')">🗑</button>
              </div>
            </div>`).join('')
        }
      </div>
    </div>
  `).join('');
};

window.toggleUserBoards = (uid) => {
  const el      = document.getElementById('user-boards-' + uid);
  const chevron = document.getElementById('user-chevron-' + uid);
  const isOpen  = el.classList.toggle('open');
  chevron.textContent = isOpen ? '▼' : '▶';
};

window.adminViewBoard = (boardId) => {
  const board = { id: boardId, ...(boards.find(b=>b.id===boardId)||{}) };
  // Board direkt laden auch wenn es einem anderen Nutzer gehört
  closeAdminPanel();
  // Temporär als aktuelles Board setzen
  getDoc(doc(db, 'boards', boardId)).then(snap => {
    if (!snap.exists()) { showToast('Board nicht gefunden', 'error'); return; }
    currentBoard = { id: boardId, ...snap.data() };
    renderBoardsList();
    loadColumns();
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('board-content').style.display = 'block';
    document.getElementById('board-title-display').textContent = currentBoard.name + ' 👁 (Admin-Ansicht)';
    showToast('Board wird angezeigt (Admin-Ansicht)');
  });
};

window.adminDeleteUser = async (uid, userName) => {
  if (!confirm(`Nutzer „${userName}" und ALLE seine Boards löschen?

Diese Aktion kann nicht rückgängig gemacht werden!`)) return;

  // Alle Boards dieses Nutzers löschen
  const boardsSnap = await getDocs(query(collection(db, 'boards'), where('uid','==',uid)));
  for (const boardDoc of boardsSnap.docs) {
    const colSnap = await getDocs(collection(db, 'boards', boardDoc.id, 'columns'));
    for (const colDoc of colSnap.docs) {
      const cardSnap = await getDocs(collection(db, 'boards', boardDoc.id, 'columns', colDoc.id, 'cards'));
      for (const cardDoc of cardSnap.docs) await deleteDoc(cardDoc.ref);
      await deleteDoc(colDoc.ref);
    }
    const gradeSnap = await getDocs(collection(db, 'boards', boardDoc.id, 'grades'));
    for (const g of gradeSnap.docs) await deleteDoc(g.ref);
    await deleteDoc(boardDoc.ref);
  }

  showToast(`Nutzer ${userName} und alle Boards gelöscht`);
  loadAdminUsers();
  loadAdminBoardsList();
  loadAdminBoardSelect();
};

// ── AGING VERWALTUNG ─────────────────────────────────
async function loadAgingTab() {
  const list = document.getElementById('admin-aging-list');
  list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade Boards…</div>';

  const snap = await getDocs(collection(db, 'boards'));
  if (snap.empty) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Keine Boards vorhanden.</div>';
    return;
  }
  const unitLabel = 'Tage bis Warnung';
  list.innerHTML = snap.docs.map(d => {
    const aging = d.data().agingDays || 5;
    return `
    <div class="admin-board-row" style="flex-direction:column; align-items:stretch; gap:8px;">
      <div style="font-weight:600; font-size:13px;">🗂️ ${escHtml(d.data().name)}</div>
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="number" id="aging-${d.id}" value="${aging}" min="1" max="999"
          style="width:70px; background:var(--surface2); border:1px solid var(--border);
          border-radius:6px; padding:5px 8px; color:var(--text); font-family:inherit; font-size:13px;"/>
        <span style="font-size:12px; color:var(--text-muted);">${unitLabel}</span>
        <button class="btn-sm btn-sm-primary" style="font-size:12px; padding:5px 12px;"
          onclick="saveAgingLimit('${d.id}')">Speichern</button>
      </div>
    </div>`;
  }).join('');
}



window.saveAgingLimit = async (boardId) => {
  const val = parseInt(document.getElementById('aging-' + boardId)?.value) || 5;
  await updateDoc(doc(db, 'boards', boardId), { agingDays: val });
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

function loadAgingUnit() {
  localStorage.setItem('kanban_aging_unit', 'days');
}

window.removeAdminEmail = async (email) => {
  if (!confirm(`${email} aus Admin-Liste entfernen?`)) return;
  const snap   = await getDoc(doc(db, 'app_config', 'admin'));
  const emails = (snap.data()?.adminEmails || []).filter(e => e.toLowerCase() !== email.toLowerCase());
  await updateDoc(doc(db, 'app_config', 'admin'), { adminEmails: emails });
  showToast('E-Mail entfernt');
  loadAdminEmails();
};

window.closeAdminPanel = () => {
  document.getElementById('admin-panel').style.display = 'none';
  isAdminMode = false;
};

window.showAdminTab = (tab) => {
  ['users','emails','images','grades','deadline','aging','pw'].forEach(t => {
    document.getElementById('admin-tab-'+t).style.display = t===tab ? 'block' : 'none';
    document.getElementById('admin-tab-'+t+'-btn').className =
      t===tab ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  });
  if (tab === 'emails')  loadAdminEmails();
  if (tab === 'users')   loadAdminUsers();
  if (tab === 'images')  loadImageCountTab();
  if (tab === 'grades')  showAdminGradesUsers();
  if (tab === 'boards')  showAdminBoardsUsers();
  if (tab === 'deadline') loadDeadlineTab();
  if (tab === 'aging')   showAdminAgingUsers();
};

// ── ADMIN NUTZER-LISTE ──────────────────────────────
async function loadAdminUserList(targetListId, onClickFn) {
  const el = document.getElementById(targetListId);
  if (!el) return;
  el.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade…</div>';
  const snap = await getDocs(collection(db, 'boards'));
  const userMap = {};
  snap.docs.forEach(d => {
    const uid  = d.data().uid || 'unbekannt';
    const name = d.data().ownerName || uid.slice(0,10)+'…';
    if (!userMap[uid]) userMap[uid] = { uid, name, count: 0 };
    userMap[uid].count++;
  });
  const cfgSnap2 = await getDoc(doc(db, 'app_config', 'admin'));
  const adminEmailsList = cfgSnap2.data()?.adminEmails || [];
  const users = Object.values(userMap);
  if (!users.length) {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Noch keine Nutzer.</div>';
    return;
  }
  el.innerHTML = users.map(u => `
    <button class="admin-user-btn" onclick="${onClickFn}('${u.uid}','${escHtml(u.name)}')">
      <div class="assignee-avatar">${u.name.slice(0,2).toUpperCase()}</div>
      <div style="flex:1;">
        <div style="font-weight:600;">${escHtml(u.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">${u.count} Board${u.count!==1?'s':''}</div>
      </div>
      <span style="color:var(--text-muted);font-size:16px;">›</span>
    </button>
  `).join('');
}

// ── NOTEN: Nutzer → Boards ───────────────────────────
window.showAdminGradesUsers = () => {
  document.getElementById('admin-grades-users').style.display = 'block';
  document.getElementById('admin-grades-boards').style.display = 'none';
  loadAdminUserList('admin-grades-users', 'selectGradesUser');
};

window.selectGradesUser = async (uid, name) => {
  document.getElementById('admin-grades-users').style.display = 'none';
  document.getElementById('admin-grades-boards').style.display = 'block';
  // Boards dieses Nutzers laden
  const snap = await getDocs(query(collection(db, 'boards'), where('uid','==',uid)));
  const sel  = document.getElementById('admin-board-select');
  sel.innerHTML = '<option value="">– Board wählen –</option>' +
    snap.docs.map(d => `<option value="${d.id}">${escHtml(d.data().name)}</option>`).join('');
  document.getElementById('admin-grades-list').innerHTML = '';
};

// ── AGING: Nutzer → Boards ───────────────────────────
window.showAdminAgingUsers = () => {
  document.getElementById('admin-aging-users').style.display = 'block';
  document.getElementById('admin-aging-detail').style.display = 'none';
  loadAdminUserList('admin-aging-users', 'selectAgingUser');
};

window.selectAgingUser = async (uid, name) => {
  document.getElementById('admin-aging-users').style.display = 'none';
  document.getElementById('admin-aging-detail').style.display = 'block';
  agendaSelectedBoardId = '';
  const snap = await getDocs(query(collection(db, 'boards'), where('uid','==',uid)));
  const list = document.getElementById('admin-aging-list');
  if (snap.empty) { list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Keine Boards.</div>'; return; }
  list.innerHTML = snap.docs.map(d => {
    const aging = d.data().agingDays || 5;
    return `
    <div class="admin-board-row" style="flex-direction:column;align-items:stretch;gap:8px;">
      <div style="font-weight:600;font-size:13px;">🗂️ ${escHtml(d.data().name)}</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <input type="number" id="aging-${d.id}" value="${aging}" min="1" max="999"
          style="width:70px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:5px 8px;color:var(--text);font-family:inherit;font-size:13px;"/>
        <span style="font-size:12px;color:var(--text-muted);">Tage bis Warnung</span>
        <button class="btn-sm btn-sm-primary" style="font-size:12px;padding:5px 12px;"
          onclick="saveAgingLimit('${d.id}')">Speichern</button>
      </div>
    </div>`;
  }).join('');
};

async function loadAdminBoardSelect() {
  // Alle Boards laden (alle Nutzer)
  const snap = await getDocs(collection(db, 'boards'));
  const sel  = document.getElementById('admin-board-select');
  sel.innerHTML = '<option value="">– Board wählen –</option>' +
    snap.docs.map(d => `<option value="${d.id}">${escHtml(d.data().name)} (${escHtml(d.data().uid?.slice(0,8)+'…')})</option>`).join('');
}

async function loadAdminBoardsList() {
  const snap = await getDocs(collection(db, 'boards'));
  const list = document.getElementById('admin-boards-list');
  if (snap.empty) { list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Keine Boards vorhanden.</div>'; return; }
  list.innerHTML = snap.docs.map(d => `
    <div class="admin-board-row">
      <div>
        <div style="font-weight:600;">${escHtml(d.data().name)}</div>
        <div style="font-size:11px;color:var(--text-muted);">Nutzer: ${escHtml(d.data().uid?.slice(0,12)+'…')}</div>
      </div>
      <button class="btn-delete-admin" onclick="adminDeleteBoard('${d.id}', '${escHtml(d.data().name)}')">🗑 Löschen</button>
    </div>
  `).join('');
}

window.adminDeleteBoard = async (boardId, boardName) => {
  if (!confirm(`Board „${boardName}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
  // Alle Spalten und Karten löschen
  const colSnap = await getDocs(collection(db, 'boards', boardId, 'columns'));
  for (const colDoc of colSnap.docs) {
    const cardSnap = await getDocs(collection(db, 'boards', boardId, 'columns', colDoc.id, 'cards'));
    for (const cardDoc of cardSnap.docs) await deleteDoc(cardDoc.ref);
    await deleteDoc(colDoc.ref);
  }
  // Noten löschen
  const gradeSnap = await getDocs(collection(db, 'boards', boardId, 'grades'));
  for (const g of gradeSnap.docs) await deleteDoc(g.ref);
  await deleteDoc(doc(db, 'boards', boardId));
  showToast('Board gelöscht');
  await loadAdminBoardsList();
  await loadAdminBoardSelect();
  if (currentBoard?.id === boardId) { currentBoard = null; showEmptyState(); }
};

window.loadAdminGrades = async () => {
  const boardId = document.getElementById('admin-board-select').value;
  const list    = document.getElementById('admin-grades-list');
  if (!boardId) { list.innerHTML = ''; return; }

  const boardSnap = await getDoc(doc(db, 'boards', boardId));
  const members   = boardSnap.data()?.members || [];

  if (!members.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Dieses Board hat keine Mitglieder definiert.</div>';
    return;
  }

  // Bestehende Noten laden
  const gradesSnap = await getDocs(collection(db, 'boards', boardId, 'grades'));
  const existing   = {};
  gradesSnap.docs.forEach(d => { existing[d.data().member] = d.data(); });

  list.innerHTML = members.map(member => {
    const g = existing[member] || {};
    const gradeVal = g.grade || '';
    const comment  = g.comment || '';
    return `
    <div class="grade-row">
      <div class="grade-row-header">
        <div class="assignee-avatar">${member.slice(0,2).toUpperCase()}</div>
        <span style="font-weight:600; flex:1;">${escHtml(member)}</span>
        <select class="grade-select" id="grade-val-${boardId}-${escHtml(member)}"
          onchange="this.className='grade-select grade-'+this.value">
          <option value="">–</option>
          ${[1,2,3,4,5,6].map(n =>
            `<option value="${n}" ${gradeVal==n?'selected':''}>${n}</option>`
          ).join('')}
        </select>
      </div>
      <textarea class="add-card-textarea" id="grade-comment-${boardId}-${escHtml(member)}"
        placeholder="Kommentar (optional)…" rows="2"
        style="font-size:12px;">${escHtml(comment)}</textarea>
      <button class="btn-sm btn-sm-primary" style="margin-top:8px; width:100%;"
        onclick="saveGrade('${boardId}','${escHtml(member)}')">💾 Speichern</button>
    </div>`;
  }).join('');

  // Farben initial setzen
  members.forEach(member => {
    const sel = document.getElementById(`grade-val-${boardId}-${member}`);
    if (sel && sel.value) sel.className = 'grade-select grade-' + sel.value;
  });
};

window.saveGrade = async (boardId, member) => {
  const grade   = document.getElementById(`grade-val-${boardId}-${member}`)?.value || '';
  const comment = document.getElementById(`grade-comment-${boardId}-${member}`)?.value.trim() || '';
  await setDoc(doc(db, 'boards', boardId, 'grades', member), {
    member, grade, comment, updatedAt: serverTimestamp()
  });
  showToast(`Note für ${member} gespeichert!`);
};

// ── GAST-LOGIN ──────────────────────────────────────
window.loginAsGuest = async () => {
  try {
    showToast('Gast-Zugang wird vorbereitet…');

    // Festes Demo-Konto verwenden – beim allerersten Mal anlegen, danach einloggen
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, GUEST_EMAIL, GUEST_PW);
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        // Konto existiert noch nicht → einmalig anlegen
        cred = await createUserWithEmailAndPassword(auth, GUEST_EMAIL, GUEST_PW);
        await updateProfile(cred.user, { displayName: 'Gast (Demo)' });
      } else {
        throw e;
      }
    }
    const uid = cred.user.uid;

    // Prüfen ob schon ein Demo-Board existiert – nur anlegen wenn keins da ist
    const existingBoards = await getDocs(
      query(collection(db, 'boards'), where('uid', '==', uid))
    );
    if (existingBoards.empty) {
      // Demo-Board erstmalig anlegen
      const boardRef = await addDoc(collection(db, 'boards'), {
        name:      '🎯 Demo-Board',
        uid,
        ownerName: 'Gast',
        ownerEmail: GUEST_EMAIL,
        members:   ['Gast'],
        wipLimit:  3,
        agingDays: 5,
        isGuest:   true,
        createdAt: serverTimestamp()
      });

      const cols = [
        { name: '📋 Offen',         color: '#4d7fff', order: 0 },
        { name: '⚙️ In Bearbeitung', color: '#f59e0b', order: 1 },
        { name: '✅ Fertig',         color: '#10b981', order: 2 },
      ];
      const colRefs = [];
      for (const col of cols) {
        const ref = await addDoc(collection(db, 'boards', boardRef.id, 'columns'), {
          ...col, wipLimit: 3, createdAt: serverTimestamp()
        });
        colRefs.push({ id: ref.id, ...col });
      }

      const cards = [
        { text: 'Willkommen im Demo-Board! 👋', priority: 'hoch',   colIdx: 0 },
        { text: 'Karten per Drag & Drop verschieben', priority: 'mittel', colIdx: 0 },
        { text: 'Neue Karte hinzufügen',  priority: 'niedrig', colIdx: 0 },
        { text: 'Fälligkeitsdatum setzen', priority: 'mittel', colIdx: 1, startedAt: new Date().toISOString() },
        { text: 'Aufgabe abgeschlossen ✓', priority: 'niedrig', colIdx: 2, finishedAt: new Date().toISOString() },
      ];
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        await addDoc(collection(db, 'boards', boardRef.id, 'columns', colRefs[c.colIdx].id, 'cards'), {
          text: c.text, priority: c.priority, order: i,
          assignee: 'Gast', due: '',
          startedAt:  c.startedAt  || null,
          finishedAt: c.finishedAt || null,
          createdAt: serverTimestamp()
        });
      }
    }
    showToast('✅ Gast-Demo bereit!');
  } catch(e) {
    showToast('Fehler: ' + e.message);
  }
};

// Gast-Daten bleiben im festen Demo-Konto erhalten



// ── AGENDA ──────────────────────────────────────────
window.showAgenda = async () => {
  if (!currentBoard) return;
  document.getElementById('modal-agenda').style.display = 'flex';

  // Abgabetermin laden
  const boardSnap = await getDoc(doc(db, 'boards', currentBoard.id));
  const deadline  = boardSnap.data()?.deadline || '';
  const dlEl      = document.getElementById('agenda-deadline');
  const dlDate    = document.getElementById('agenda-deadline-date');
  const dlCountdown = document.getElementById('agenda-deadline-countdown');

  if (deadline) {
    dlEl.style.display = 'block';
    const d    = new Date(deadline);
    const now  = new Date();
    const diff = Math.ceil((d - now) / 86400000);
    dlDate.textContent = d.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    if (diff < 0) {
      dlCountdown.textContent = `Abgabe war vor ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}`;
      dlCountdown.style.color = 'var(--danger)';
      dlEl.style.borderColor  = 'rgba(240,82,82,0.4)';
      dlEl.style.background   = 'rgba(240,82,82,0.08)';
    } else if (diff === 0) {
      dlCountdown.textContent = 'Abgabe heute!';
      dlCountdown.style.color = '#f59e0b';
    } else {
      dlCountdown.textContent = `Noch ${diff} Tag${diff!==1?'e':''}`;
      dlCountdown.style.color = diff <= 3 ? '#f59e0b' : 'var(--success)';
    }
  } else {
    dlEl.style.display = 'none';
  }

  // Spalten + Karten direkt aus Firestore laden
  const list = document.getElementById('agenda-list');
  list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade…</div>';

  const colSnap = await getDocs(
    query(collection(db, 'boards', currentBoard.id, 'columns'), orderBy('order', 'asc'))
  );
  const allCols = colSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const allCards = [];
  for (const col of allCols) {
    const cardSnap = await getDocs(
      query(collection(db, 'boards', currentBoard.id, 'columns', col.id, 'cards'),
      orderBy('order'))
    );
    cardSnap.docs.forEach(d => {
      allCards.push({ id: d.id, colId: col.id, colName: col.name, ...d.data() });
    });
  }

  // Sortieren: mit Datum zuerst (aufsteigend), dann ohne
  const withDue    = allCards.filter(c => c.due).sort((a,b) => new Date(a.due) - new Date(b.due));
  const withoutDue = allCards.filter(c => !c.due);
  const sorted     = [...withDue, ...withoutDue];

  if (!sorted.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px;">Keine Karten vorhanden.</div>';
    return;
  }

  list.innerHTML = sorted.map(card => {
    const now  = new Date(); now.setHours(0,0,0,0);
    const due  = card.due ? new Date(card.due) : null;
    const diff = due ? Math.ceil((due - now) / 86400000) : null;

    let dueLabel = '';
    let dueColor = 'var(--text-muted)';
    let cardBg   = 'rgba(10,20,60,0.4)';
    let cardBorder = 'var(--border)';

    if (due) {
      if (diff < 0) {
        dueLabel  = `Überfällig (${Math.abs(diff)} Tag${Math.abs(diff)!==1?'e':''})`;
        dueColor  = 'var(--danger)';
        cardBorder = 'rgba(240,82,82,0.4)';
      } else if (diff === 0) {
        dueLabel  = 'Fällig heute';
        dueColor  = '#f59e0b';
        cardBorder = 'rgba(245,158,11,0.4)';
      } else if (diff <= 2) {
        dueLabel  = `Fällig in ${diff} Tag${diff!==1?'en':''}`;
        dueColor  = '#f59e0b';
      } else {
        dueLabel  = due.toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric' });
        dueColor  = 'var(--success)';
      }
    }

    const prioColors = { hoch:'var(--danger)', mittel:'#f59e0b', niedrig:'var(--success)' };
    const prioColor  = prioColors[card.priority] || 'transparent';

    return `
    <div style="padding:10px 14px; background:${cardBg}; border:1px solid ${cardBorder};
      border-radius:10px; display:flex; align-items:flex-start; gap:12px;">
      <div style="width:3px; min-height:40px; border-radius:2px; background:${prioColor}; flex-shrink:0; margin-top:2px;"></div>
      <div style="flex:1; min-width:0;">
        <div style="font-weight:500; font-size:13px; margin-bottom:4px;">${escHtml(card.text)}</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:11px; color:var(--text-muted);">
          <span>${escHtml(card.colName)}</span>
          ${card.assignee ? `<span>👤 ${escHtml(card.assignee)}</span>` : ''}
        </div>
      </div>
      <div style="font-size:11px; font-weight:600; color:${dueColor}; flex-shrink:0; text-align:right;">
        ${dueLabel || '<span style="opacity:0.4;">Kein Datum</span>'}
      </div>
    </div>`;
  }).join('');
};

// Abgabetermin speichern
let agendaSelectedBoardId = '';

window.saveDeadline = async (boardId, inputId) => {
  const value = document.getElementById(inputId)?.value || '';
  await updateDoc(doc(db, 'boards', boardId), { deadline: value });
  showToast(value ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

function loadDeadlineTab() {
  showAdminDeadlineUsers();
}

window.showAdminDeadlineUsers = () => {
  document.getElementById('admin-deadline-users').style.display = 'block';
  document.getElementById('admin-deadline-detail').style.display = 'none';
  loadAdminUserList('admin-deadline-users', 'selectDeadlineUser');
};

window.selectDeadlineUser = async (uid, name) => {
  document.getElementById('admin-deadline-users').style.display = 'none';
  document.getElementById('admin-deadline-detail').style.display = 'block';
  const snap = await getDocs(query(collection(db, 'boards'), where('uid','==',uid)));
  const list = document.getElementById('admin-deadline-list');
  if (snap.empty) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Keine Boards gefunden.</div>';
    return;
  }
  list.innerHTML = snap.docs.map(d => {
    const deadline = d.data().deadline || '';
    const inputId  = 'dl-' + d.id;
    return `
    <div class="admin-board-row" style="flex-direction:column; align-items:stretch; gap:8px;">
      <div style="font-weight:600; font-size:13px;">🗂️ ${escHtml(d.data().name)}</div>
      <div style="display:flex; gap:8px; align-items:center;">
        <input type="date" id="${inputId}" value="${deadline}"
          style="flex:1; background:var(--surface2); border:1px solid var(--border); border-radius:8px;
          padding:6px 10px; color:var(--text); font-family:inherit; font-size:13px;"/>
        <button class="btn-sm btn-sm-primary" onclick="saveDeadline('${d.id}','${inputId}')">Speichern</button>
        <button class="btn-sm btn-sm-ghost" onclick="document.getElementById('${inputId}').value=''; saveDeadline('${d.id}','${inputId}')" title="Löschen">✕</button>
      </div>
    </div>`;
  }).join('');
};

// ── KI-ASSISTENT PROMPT ─────────────────────────────
window.showAiPrompt = () => {
  if (!currentBoard) return;

  const boardName = currentBoard.name;

  const prompt = `Du bist ein erfahrener Projektassistent, der Nutzer beim Arbeiten mit einem Kanban-Board unterstützt. Beginne das Gespräch immer mit der folgenden Einstiegsfrage – ohne Vorrede, ohne Begrüßungsfloskeln:

„Womit kann ich dir helfen?
  A) Ein bestehendes Board überarbeiten (Rechtschreibung, Aufgaben aufteilen)
  B) Ein neues Board zu einem bestimmten Thema erstellen"

Warte auf die Antwort und fahre dann mit dem entsprechenden Pfad fort.

════════════════════════════════════════════════════════════
PFAD A: BESTEHENDES BOARD ÜBERARBEITEN
════════════════════════════════════════════════════════════

SCHRITT A1 – BOARD-EXPORT ANFORDERN
Bitte den Nutzer, den Inhalt seines Boards einzufügen:
- In der App auf „Export" klicken
- Den gesamten Text über „In Zwischenablage kopieren" kopieren
- Den Text hier einfügen
Warte auf die Eingabe, bevor du weitermachst.

SCHRITT A2 – ANALYSE UND ÜBERBLICK
Lies den Export sorgfältig. Gib einen kurzen Überblick:
- Wie viele Spalten und Karten hat das Board?
- Gibt es auffällige Probleme (sehr lange Karten, unklare Formulierungen, Aging-Warnungen)?
- Welche Schritte du jetzt durchführen wirst

SCHRITT A3 – RECHTSCHREIBUNG UND GRAMMATIK
Prüfe alle Kartentexte auf Rechtschreib- und Grammatikfehler sowie unklare Formulierungen.
- Liste alle gefundenen Korrekturen übersichtlich auf (Original → Korrektur)
- Frage: „Soll ich diese Korrekturen übernehmen? (ja / nein / nur bestimmte)"
- Warte auf Antwort und merke dir, welche Korrekturen akzeptiert wurden

SCHRITT A4 – KARTEN AUFTEILEN
Gehe jede Karte einzeln durch, die potenziell zu groß oder zu vage ist (vor allem in den Spalten „Offen" und „In Bearbeitung"). Überspringe Karten in der Fertig-Spalte.
Für jede geeignete Karte:
1. Zeige den Kartentext
2. Schlage 2–4 konkrete Teilschritte vor, die die Karte ersetzen würden
3. Frage: „Soll ich diese Karte aufteilen? (ja / nein / andere Aufteilung)"
4. Bei „andere Aufteilung": frage nach dem gewünschten Ergebnis
5. Warte auf Bestätigung, bevor du zur nächsten Karte weitergehst

SCHRITT A5 – ZUSAMMENFASSUNG
Zeige eine kompakte Übersicht aller Änderungen:
- Welche Korrekturen wurden übernommen
- Welche Karten wurden wie aufgeteilt
- Welche Karten blieben unverändert
Frage: „Passt das so? Dann erzeuge ich den fertigen Import-Text."

════════════════════════════════════════════════════════════
PFAD B: NEUES BOARD ERSTELLEN
════════════════════════════════════════════════════════════

SCHRITT B1 – THEMA UND KONTEXT KLÄREN
Stelle dem Nutzer nacheinander folgende Fragen. Stelle immer nur eine Frage auf einmal und warte jeweils auf die Antwort:

1. „Um welches Thema oder Projekt geht es?"
2. „Für wen ist das Board gedacht – Einzelperson oder Team? Falls Team: wie viele Personen?"
3. „Gibt es Teammitglieder, denen Aufgaben zugewiesen werden sollen? Falls ja: wie heißen sie?"
4. „Gibt es einen Abgabetermin oder eine Deadline?"
5. „Sollen die Aufgaben nach Priorität (Hoch / Mittel / Niedrig) eingeteilt werden?"
6. „Hast du bereits konkrete Aufgaben im Kopf, die ins Board sollen? Falls ja: nenne sie kurz."
7. „Sollen neben den drei Standardspalten (Offen / In Bearbeitung / Fertig) weitere Spalten angelegt werden – zum Beispiel 'Warten auf Feedback' oder 'Überarbeitung'?"

SCHRITT B2 – BOARD ENTWERFEN
Entwirf auf Basis der Antworten ein vollständiges Board. Achte dabei auf:
- Sinnvolle, klar formulierte Aufgaben als Karten
- Realistische Aufteilung: nicht zu viele Karten auf einmal „In Bearbeitung"
- Passende Prioritäten
- Zuweisung von Karten an Teammitglieder, falls angegeben
- Fälligkeitsdaten, falls eine Deadline genannt wurde (verteile die Aufgaben gleichmäßig)

Zeige den Entwurf in lesbarer Form und frage:
„Soll ich etwas anpassen, bevor ich den Import-Text erzeuge?"
Nimm gewünschte Änderungen vor und frage erneut, bis der Nutzer zufrieden ist.

════════════════════════════════════════════════════════════
AUSGABE (gilt für beide Pfade)
════════════════════════════════════════════════════════════

Gib das fertige Board in exakt folgendem Format aus – dieses Format wird direkt von der App eingelesen:

${getExportFormatExample(boardName)}

Wichtige Formatregeln:
- Die Kopfzeile muss mit „KANBAN-BOARD:" beginnen
- Spalten werden durch eine Zeile mit mindestens 10 „─"-Zeichen getrennt
- Darunter folgt der Spaltenname in Großbuchstaben gefolgt von (N Karte/n)
- Jede Karte beginnt mit „  N. Kartentext" (2 Leerzeichen Einzug, Nummer, Punkt)
- Metafelder haben 5 Leerzeichen Einzug, dann das Feld, dann mindestens 2 Leerzeichen, dann der Wert
- Mögliche Metafelder: „Priorität:", „Zugewiesen:", „Fällig am:", „In Bearb. seit:", „Fertiggestellt:"
- Priorität-Werte: „HOCH ▲", „MITTEL", „NIEDRIG ▽"
- Daten im Format TT.MM.JJJJ
- Nach jeder Karte eine Leerzeile
- Der Text nach „AGENDA" wird beim Import ignoriert und muss nicht ausgegeben werden

Weise den Nutzer abschließend darauf hin:
„Kopiere den gesamten Text oben und füge ihn in der App unter Import → Textfeld ein, dann auf Vorschau und Jetzt importieren klicken."`;

  document.getElementById('ai-prompt-content').textContent = prompt;
  document.getElementById('modal-ai-prompt').style.display = 'flex';
};
function getExportFormatExample(boardName) {
  return `════════════════════════════════════════════════════════════
  KANBAN-BOARD: ${boardName.toUpperCase()}
  Exportiert am: (wird automatisch gesetzt)
════════════════════════════════════════════════════════════

────────────────────────────────────────────────────────────
  — OFFEN  (2 Karten)
────────────────────────────────────────────────────────────
  1. Erste Aufgabe
     Priorität:   HOCH ▲
     Zugewiesen:  Anna
     Fällig am:   15.04.2026

  2. Zweite Aufgabe
     Priorität:   MITTEL

────────────────────────────────────────────────────────────
  — IN BEARBEITUNG  (1 Karte)
────────────────────────────────────────────────────────────
  1. Aufgabe in Arbeit
     In Bearb. seit: 10.03.2026

────────────────────────────────────────────────────────────
  — FERTIG  (1 Karte)
────────────────────────────────────────────────────────────
  1. Abgeschlossene Aufgabe
     Fertiggestellt: 20.03.2026`;
}

window.copyAiPrompt = async () => {
  const text = document.getElementById('ai-prompt-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('ai-prompt-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => {
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Prompt kopieren';
    }, 2000);
  } catch(e) {
    showToast('Kopieren fehlgeschlagen.', 'error');
  }
};

// ── BOARD EXPORT ────────────────────────────────────
window.showExport = async () => {
  if (!currentBoard) return;
  const pre = document.getElementById('export-content');
  pre.textContent = 'Lade…';
  document.getElementById('modal-export').style.display = 'flex';

  // Deadline laden
  const boardSnap = await getDoc(doc(db, 'boards', currentBoard.id));
  const deadline  = boardSnap.data()?.deadline || '';

  // Spalten + Karten laden
  const colSnap = await getDocs(
    query(collection(db, 'boards', currentBoard.id, 'columns'), orderBy('order', 'asc'))
  );
  const allCols = colSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  const colCards = {};
  for (const col of allCols) {
    const cardSnap = await getDocs(
      query(collection(db, 'boards', currentBoard.id, 'columns', col.id, 'cards'),
      orderBy('order'))
    );
    colCards[col.id] = cardSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`;
  };
  const fmtDateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  };
  const daysSince = (iso) => {
    if (!iso) return null;
    const diff = Math.floor((now - new Date(iso)) / 86400000);
    return diff;
  };
  const dueStatus = (due) => {
    if (!due) return '';
    const d = new Date(due); d.setHours(0,0,0,0);
    const t = new Date(); t.setHours(0,0,0,0);
    const diff = Math.ceil((d - t) / 86400000);
    if (diff < 0)  return ` [ÜBERFÄLLIG seit ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}]`;
    if (diff === 0) return ' [FÄLLIG HEUTE]';
    if (diff <= 2)  return ` [fällig in ${diff} Tag${diff!==1?'en':''}]`;
    return '';
  };

  const sep  = '─'.repeat(60);
  const sep2 = '═'.repeat(60);
  let lines = [];

  // Kopfzeile
  lines.push(sep2);
  lines.push(`  KANBAN-BOARD: ${currentBoard.name.toUpperCase()}`);
  lines.push(`  Exportiert am: ${fmtDateTime(now.toISOString())}`);
  if (deadline) {
    const dl   = new Date(deadline);
    const diff = Math.ceil((dl - now) / 86400000);
    let cdText = '';
    if (diff < 0)       cdText = ` — Abgabe war vor ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}!`;
    else if (diff === 0) cdText = ' — Abgabe heute!';
    else                 cdText = ` — noch ${diff} Tag${diff!==1?'e':''}`;
    lines.push(`  Abgabetermin:  ${fmtDate(deadline)}${cdText}`);
  }
  lines.push(sep2);
  lines.push('');

  // Spalten
  for (const col of allCols) {
    const cCards = colCards[col.id] || [];
    const isProgress = (col.name||'').toLowerCase().match(/bearbeitung|progress|doing/);

    lines.push(sep);
    lines.push(`  ${col.name.toUpperCase()}  (${cCards.length} Karte${cCards.length!==1?'n':''})`);
    lines.push(sep);

    if (!cCards.length) {
      lines.push('  (keine Karten)');
      lines.push('');
      continue;
    }

    cCards.forEach((card, idx) => {
      lines.push(`  ${idx + 1}. ${card.text}`);

      // Priorität
      if (card.priority) {
        const pMap = { hoch: 'HOCH ▲', mittel: 'MITTEL', niedrig: 'NIEDRIG ▽' };
        lines.push(`     Priorität:   ${pMap[card.priority] || card.priority}`);
      }

      // Zuweisung
      if (card.assignee) {
        lines.push(`     Zugewiesen:  ${card.assignee}`);
      }

      // Fälligkeitsdatum
      if (card.due) {
        lines.push(`     Fällig am:   ${fmtDate(card.due)}${dueStatus(card.due)}`);
      }

      // Zeitstempel
      if (card.createdAt?.toDate) {
        lines.push(`     Erstellt:    ${fmtDateTime(card.createdAt.toDate().toISOString())}`);
      }
      if (isProgress && card.startedAt) {
        const days = daysSince(card.startedAt);
        const agingLimit = currentBoard?.agingDays || 5;
        const aging = days !== null && days >= agingLimit ? ` ⚠ AGING (>${agingLimit} Tage)` : '';
        lines.push(`     In Bearb. seit: ${fmtDate(card.startedAt)}  (${days !== null ? days + (days===1?' Tag':' Tage') : '?'}${aging})`);
      }
      if (card.finishedAt) {
        lines.push(`     Fertiggestellt: ${fmtDate(card.finishedAt)}`);
      }

      lines.push('');
    });
  }

  // Agenda-Zusammenfassung
  lines.push(sep2);
  lines.push('  AGENDA – ALLE KARTEN NACH FÄLLIGKEIT');
  lines.push(sep2);
  lines.push('');

  const allCards = [];
  for (const col of allCols) {
    (colCards[col.id] || []).forEach(c => allCards.push({ ...c, colName: col.name }));
  }
  const withDue    = allCards.filter(c => c.due).sort((a,b) => new Date(a.due) - new Date(b.due));
  const withoutDue = allCards.filter(c => !c.due);

  if (withDue.length) {
    withDue.forEach(card => {
      const status = dueStatus(card.due);
      const prio   = card.priority ? ` [${card.priority.toUpperCase()}]` : '';
      lines.push(`  ${fmtDate(card.due)}${status}`);
      lines.push(`    → ${card.text}${prio}`);
      lines.push(`       Spalte: ${card.colName}${card.assignee ? ' | Zugewiesen: ' + card.assignee : ''}`);
      lines.push('');
    });
  }

  if (withoutDue.length) {
    lines.push('  Ohne Fälligkeitsdatum:');
    withoutDue.forEach(card => {
      const prio = card.priority ? ` [${card.priority.toUpperCase()}]` : '';
      lines.push(`    · ${card.text}${prio}  (${card.colName})`);
    });
    lines.push('');
  }

  if (!allCards.length) {
    lines.push('  (keine Karten)');
  }

  lines.push(sep2);

  pre.textContent = lines.join('\n');
};

window.copyExportToClipboard = async () => {
  const text = document.getElementById('export-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('export-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => {
      btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> In Zwischenablage kopieren';
    }, 2000);
  } catch(e) {
    showToast('Kopieren fehlgeschlagen – bitte manuell markieren.', 'error');
  }
};

// ── BOARD IMPORT ────────────────────────────────────
let importParsedData = null;

window.showImport = () => {
  if (!currentBoard) return;
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-preview').style.display = 'none';
  document.getElementById('import-error').style.display   = 'none';
  document.getElementById('import-confirm-btn').style.display = 'none';
  importParsedData = null;
  document.getElementById('modal-import').style.display = 'flex';
};

function parseDateDE(str) {
  // Erwartet DD.MM.YYYY
  if (!str) return '';
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function parseExportText(raw) {
  // Alles ab der Agenda-Trennlinie abschneiden
  const agendaMarker = /^═+\s*$/m;
  const agendaStart  = raw.search(/^═{10,}[\s\S]*AGENDA/m);
  const boardText    = agendaStart > 0 ? raw.slice(0, agendaStart) : raw;

  const lines = boardText.split('\n');

  // Board-Name aus Kopfzeile
  let boardName = '';
  for (const line of lines) {
    const m = line.match(/^\s*KANBAN-BOARD:\s*(.+)$/i);
    if (m) { boardName = m[1].trim(); break; }
  }

  // Spalten und Karten parsen
  const columns = [];
  let currentCol  = null;
  let currentCard = null;
  const SEP_COL   = /^─{10,}/;
  const SEP_MAIN  = /^═{10,}/;

  const flushCard = () => {
    if (currentCard && currentCol) currentCol.cards.push(currentCard);
    currentCard = null;
  };
  const flushCol = () => {
    flushCard();
    if (currentCol) columns.push(currentCol);
    currentCol = null;
  };

  let inHeader = true; // Kopfbereich überspringen bis erste ─-Linie
  let sepCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (SEP_MAIN.test(line.trim())) {
      // Haupttrennlinie → Kopfbereich beendet, oder Ende (Agenda)
      if (!inHeader) flushCol();
      inHeader = false;
      sepCount++;
      continue;
    }

    if (inHeader) continue;

    if (SEP_COL.test(line.trim())) {
      // Nach erster ─-Linie kommt der Spaltenname, nach zweiter ─-Linie kommen die Karten
      continue;
    }

    // Spaltenname erkennen: "  SPALTENNAME  (N Karte/n)"
    const colMatch = line.match(/^\s{2}(.+?)\s{2,}\(\d+ Karten?\)\s*$/);
    if (colMatch) {
      flushCol();
      currentCol = { name: colMatch[1].trim(), cards: [] };
      // Originalnamen rekonstruieren (Export schreibt alles GROSS)
      // Wir behalten den Namen so wie er kommt – Nutzer kann umbenennen
      continue;
    }

    // Karte erkennen: "  N. Kartentext"
    const cardMatch = line.match(/^\s{2}(\d+)\.\s+(.+)$/);
    if (cardMatch) {
      flushCard();
      currentCard = {
        text:        cardMatch[2].trim(),
        priority:    '',
        assignee:    '',
        due:         '',
        startedAt:   '',
        finishedAt:  '',
      };
      continue;
    }

    if (!currentCard) continue;

    // Metafelder parsen
    const meta = line.match(/^\s{5}([\w äöüÄÖÜß .]+?):\s+(.+)$/);
    if (!meta) continue;
    const key = meta[1].trim().toLowerCase();
    const val = meta[2].trim();

    if (key === 'priorität') {
      if (val.startsWith('HOCH'))     currentCard.priority = 'hoch';
      else if (val.startsWith('MIT')) currentCard.priority = 'mittel';
      else if (val.startsWith('NIE')) currentCard.priority = 'niedrig';
    } else if (key === 'zugewiesen') {
      currentCard.assignee = val;
    } else if (key === 'fällig am') {
      // "28.03.2026 [fällig in 5 Tagen]" → nur Datum
      currentCard.due = parseDateDE(val.split(' ')[0]);
    } else if (key === 'in bearb. seit') {
      // "18.03.2026  (5 Tage ⚠ AGING …)"
      currentCard.startedAt = parseDateDE(val.split(' ')[0]);
    } else if (key === 'fertiggestellt') {
      currentCard.finishedAt = parseDateDE(val.split(' ')[0]);
    }
  }
  flushCol();

  return { boardName, columns };
}

window.parseImportPreview = () => {
  const raw = document.getElementById('import-textarea').value.trim();
  const errEl  = document.getElementById('import-error');
  const preEl  = document.getElementById('import-preview');
  const btnEl  = document.getElementById('import-confirm-btn');
  errEl.style.display  = 'none';
  preEl.style.display  = 'none';
  btnEl.style.display  = 'none';
  importParsedData = null;

  if (!raw) {
    errEl.textContent = 'Bitte zuerst einen Export-Text einfügen.';
    errEl.style.display = 'block';
    return;
  }

  let parsed;
  try { parsed = parseExportText(raw); } catch(e) {
    errEl.textContent = 'Fehler beim Parsen: ' + e.message;
    errEl.style.display = 'block';
    return;
  }

  if (!parsed.columns.length) {
    errEl.textContent = 'Keine Spalten erkannt. Bitte prüfe das Format – es muss ein unveränderter Export sein.';
    errEl.style.display = 'block';
    return;
  }

  importParsedData = parsed;

  const totalCards = parsed.columns.reduce((s, c) => s + c.cards.length, 0);
  let html = `<strong style="color:var(--text);">Erkannt:</strong> ${parsed.columns.length} Spalte${parsed.columns.length!==1?'n':''}, ${totalCards} Karte${totalCards!==1?'n':''}<br><br>`;
  parsed.columns.forEach(col => {
    html += `<strong style="color:var(--text);">${escHtml(col.name)}</strong> (${col.cards.length})<br>`;
    col.cards.forEach(c => {
      const prio = c.priority ? ` · ${c.priority}` : '';
      const due  = c.due ? ` · 📅 ${c.due}` : '';
      html += `&nbsp;&nbsp;→ ${escHtml(c.text)}${prio}${due}<br>`;
    });
  });
  html += `<br><em>Die Daten werden in das Board <strong style="color:var(--text);">${escHtml(currentBoard.name)}</strong> importiert. Bestehende Inhalte bleiben erhalten.</em>`;

  preEl.innerHTML = html;
  preEl.style.display = 'block';
  btnEl.style.display = 'inline-flex';
};

window.confirmImport = async () => {
  if (!importParsedData || !currentBoard) return;
  const btn = document.getElementById('import-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Importiere…';

  try {
    // Bestehende Spalten laden um Dopplungen zu vermeiden
    const existingColSnap = await getDocs(
      query(collection(db, 'boards', currentBoard.id, 'columns'), orderBy('order', 'asc'))
    );
    const existingCols = existingColSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let orderOffset = existingCols.length;

    for (const importCol of importParsedData.columns) {
      // Spalte suchen (Namensvergleich case-insensitive, Leerzeichen normalisiert)
      const normName = (s) => s.replace(/^[—–\-\s]+/, '').trim().toLowerCase();
      let colRef = existingCols.find(c => normName(c.name) === normName(importCol.name));

      if (!colRef) {
        // Neue Spalte anlegen
        const colors = ['#5c6ef8','#f59e0b','#10b981','#ec4899','#06b6d4','#8b5cf6'];
        const color  = colors[orderOffset % colors.length];
        const newCol = await addDoc(
          collection(db, 'boards', currentBoard.id, 'columns'),
          { name: importCol.name, color, order: orderOffset++, createdAt: serverTimestamp() }
        );
        colRef = { id: newCol.id, name: importCol.name };
      }

      // Bestehende Karten in der Spalte zählen für die Reihenfolge
      const existingCardSnap = await getDocs(
        collection(db, 'boards', currentBoard.id, 'columns', colRef.id, 'cards')
      );
      let cardOrder = existingCardSnap.size;

      for (const card of importCol.cards) {
        const cardData = {
          text:      card.text,
          priority:  card.priority || '',
          assignee:  card.assignee || '',
          due:       card.due      || '',
          order:     cardOrder++,
          createdAt: serverTimestamp(),
        };
        if (card.startedAt)  cardData.startedAt  = card.startedAt;
        if (card.finishedAt) cardData.finishedAt = card.finishedAt;

        await addDoc(
          collection(db, 'boards', currentBoard.id, 'columns', colRef.id, 'cards'),
          cardData
        );
      }
    }

    const total = importParsedData.columns.reduce((s, c) => s + c.cards.length, 0);
    showToast(`✅ Import abgeschlossen: ${total} Karte${total!==1?'n':''} importiert.`);
    closeModal('modal-import');
  } catch(e) {
    showToast('Fehler beim Import: ' + e.message, 'error');
  }

  btn.disabled = false;
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M20 6 9 17l-5-5"/></svg> Jetzt importieren';
};

// ── SIDEBAR TOGGLE ──────────────────────────────────
// Hilfsfunktion: alle Grip-Elemente positionieren (nur Desktop)
function setAllGrips(leftValue) {
  if (window.innerWidth <= 640) return; // Mobilgeräte: Grip per CSS gesteuert
  document.querySelectorAll('.sidebar-grip').forEach(g => {
    g.style.left = leftValue;
    g.style.transition = 'left 0.3s ease';
  });
}

window.toggleSidebar = () => {
  const sidebar = document.getElementById('sidebar-el');
  if (!sidebar) return;
  if (window.innerWidth <= 640) {
    // Mobilgeräte: open/close als Overlay
    if (sidebar.classList.contains('open')) {
      window.closeSidebar();
    } else {
      window.openSidebar();
    }
    return;
  }
  const isCollapsed = sidebar.classList.toggle('collapsed');
  setAllGrips(isCollapsed ? '0px' : '260px');
};

// Griff beim Laden korrekt positionieren (nur Desktop)
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar-el');
  if (sidebar && window.innerWidth > 640) {
    setAllGrips(sidebar.classList.contains('collapsed') ? '0px' : '260px');
  }
});

// ── LEGAL ────────────────────────────────────────────
// ── SIDEBAR (Handy) ─────────────────────────────────
window.closeSidebar = () => {
  if (window.innerWidth > 640) return;
  const sidebar  = document.getElementById('sidebar-el');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  sidebar.classList.remove('open');
  if (backdrop) backdrop.style.display = 'none';
  document.querySelectorAll('.sidebar-grip').forEach(g => {
    g.style.left = '0px';
    g.style.transition = 'left 0.3s ease';
  });
};

window.openSidebar = () => {
  if (window.innerWidth > 640) return;
  const sidebar  = document.getElementById('sidebar-el');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (!sidebar) return;
  sidebar.classList.add('open');
  if (backdrop) backdrop.style.display = 'block';
  document.querySelectorAll('.sidebar-grip').forEach(g => {
    g.style.left = '260px';
    g.style.transition = 'left 0.3s ease';
  });
};



window.openLegal = () => {
  document.getElementById('modal-legal').style.display = 'flex';
  showLegalTab('impressum');
};

window.showLegalTab = (tab) => {
  document.getElementById('legal-impressum').style.display   = tab === 'impressum'   ? 'block' : 'none';
  document.getElementById('legal-datenschutz').style.display = tab === 'datenschutz' ? 'block' : 'none';
  document.getElementById('tab-impressum').className   = tab === 'impressum'   ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  document.getElementById('tab-datenschutz').className = tab === 'datenschutz' ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
};

window.openHelp = () => {
  document.getElementById('modal-help').style.display = 'flex';
};

// ── UTILS ────────────────────────────────────────────
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function linkify(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, function(url) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;" onclick="event.stopPropagation()">${url}</a>`;
  });
}

// Initial alle Icons zeichnen
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
  
  // Trick: Alle 2 Sekunden prüfen, ob neue Icons (z.B. in neuen Karten) da sind
  setInterval(() => {
    lucide.createIcons();
  }, 2000);
}
