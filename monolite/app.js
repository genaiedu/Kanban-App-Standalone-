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

// ── FIREBASE CONFIG (DYNAMISCH FÜR MEHRERE SCHULEN) ──
import { schoolDatabases } from './config-databases.js';

// --- NEU: URL Parameter für Gruppen-Einladungen sofort abfangen ---
const urlParams = new URLSearchParams(window.location.search);
const inviteGroupId = urlParams.get('group');
if (inviteGroupId) {
  // Wird gespeichert, bevor eventuell umgeleitet wird!
  localStorage.setItem('pending_groupId', inviteGroupId);
}
// ------------------------------------------------------------------

// Ausgewählte Schule aus dem Speicher auslesen
const selectedSchoolId = localStorage.getItem('selected_school_db');

// Prüfen, ob eine gültige Schule gewählt wurde
if (!selectedSchoolId || !schoolDatabases[selectedSchoolId]) {
  window.location.replace('index.html');
  throw new Error("Stoppe Skript: Leite zur Startseite um..."); // WICHTIG: Das rettet das Skript vor dem Crash!
}

// Konfiguration der gewählten Schule laden
const firebaseConfig = schoolDatabases[selectedSchoolId].config;

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

window.showNewBoard = () => {
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

// Enter-Taste in Modals (Sicher verpackt)
const addEnterListener = (id, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') fn(); });
};

addEnterListener('new-board-name', () => wizardNext(2));
addEnterListener('new-column-name', () => createColumn());
addEnterListener('login-password', () => doLogin());
addEnterListener('register-password', () => doRegister());

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
  
  // --- NEU: Lerngruppe aus dem Link ins Feld eintragen (falls vorhanden) ---
  const pendingGroup = localStorage.getItem('pending_groupId');
  const groupInput = document.getElementById('register-group');
  if (pendingGroup && groupInput) {
    groupInput.value = pendingGroup;
  }
};

window.doGoogleLogin = async () => {
  hideError('register-error');
  hideError('login-error');

  const isRegisterScreen = document.getElementById('register-form').style.display === 'block';
  const groupInput = document.getElementById('register-group');
  let group = 'default';

  // Wenn der Schüler auf der Registrieren-Seite ist, MUSS er eine Gruppe angeben
  if (isRegisterScreen && groupInput) {
    group = groupInput.value.trim();
    if (!group) {
      showError('register-error', 'Bitte trage ganz oben deine Lerngruppe ein, bevor du auf "Mit Google registrieren" klickst.');
      return; // Bricht ab, das Google-Popup öffnet sich nicht
    }
  }

  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(auth, provider);

    // Nach dem erfolgreichen Google-Popup schauen wir in der Datenbank nach
    const userRef = doc(db, 'users', cred.user.uid);
    const userSnap = await getDoc(userRef);

    // 1. Fall: Ein komplett neuer Google-Nutzer!
    if (!userSnap.exists()) {
      await setDoc(userRef, {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName || cred.user.email,
        groupId: group, // <--- HIER wird die Lerngruppe aus dem Feld gespeichert!
        createdAt: serverTimestamp()
      });
    } 
    // 2. Fall: Nutzer existiert schon, will aber über das Formular die Gruppe wechseln
    else if (isRegisterScreen && group && group !== 'default') {
      await setDoc(userRef, { groupId: group }, { merge: true });
    }

    // Den Zwischenspeicher aufräumen
    localStorage.removeItem('pending_groupId');

  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user') {
      showError('register-error', 'Fehler beim Google-Login.');
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
  
  // --- NEU: Lerngruppe direkt aus dem Formular auslesen ---
  const group    = document.getElementById('register-group').value.trim();
  
  // Prüfen, ob auch die Lerngruppe ausgefüllt wurde
  if (!name || !email || !password || !group) { 
    showError('register-error', 'Bitte alle Felder (inkl. Lerngruppe) ausfüllen.'); 
    return; 
  }
  if (password.length < 6) { 
    showError('register-error', 'Passwort muss mindestens 6 Zeichen haben.'); 
    return; 
  }
  
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
    
    let userGroupId = group;
    // Superadmin bekommt weiterhin seine feste ID
    if (name === 'Claus Unterberg') {
        userGroupId = 'superadmin';
    }

    // Speichert das Profil in Firestore
    await setDoc(doc(db, 'users', cred.user.uid), {
        uid: cred.user.uid,
        email: email,
        displayName: name,
        groupId: userGroupId, // <--- Der absolut sichere Wert aus dem Formular
        createdAt: serverTimestamp()
    }, { merge: true });
    
    // Den Zwischenspeicher aufräumen
    localStorage.removeItem('pending_groupId');

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

// ── AUTH STATE (DIE ENDGÜLTIGE FIX-VERSION) ──────────────────
onAuthStateChanged(auth, user => {
  document.getElementById('loading-screen').style.display = 'none';
  
  if (user) {
    currentUser = user;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('visible');

    // 1. Name & Gruppe setzen
    const nameDisplay = document.getElementById('user-name-display');
    const groupDisplay = document.getElementById('sidebar-user-group'); // <-- NEU: Das Element in der Sidebar

    if (nameDisplay) {
      nameDisplay.textContent = (user.email === GUEST_EMAIL) ? 'Gast (Demo)' : (user.displayName || user.email);
    }

    // --- NEU: Gruppe aus der Datenbank laden ---
    if (groupDisplay) {
      if (user.email === GUEST_EMAIL) {
        groupDisplay.textContent = 'Demo'; // Der Gast kriegt eine feste Anzeige
      } else {
        // Holen der groupId aus dem 'users' Dokument
        getDoc(doc(db, 'users', user.uid)).then(snap => {
          if (snap.exists()) {
            groupDisplay.textContent = snap.data().groupId || 'default';
          } else {
            groupDisplay.textContent = 'default';
          }
        }).catch(err => {
          console.error("Fehler beim Gruppen-Laden:", err);
          groupDisplay.textContent = 'Fehler';
        });
      }
    }
    // --------------------------------------------

    // 2. Sidebar-Handling
    const sidebar = document.getElementById('sidebar-el');
    if (sidebar) {
      sidebar.classList.remove('collapsed');
      if (typeof setAllGrips === 'function') setAllGrips('260px');
    }

    // 3. Hintergrund-Zuweisung
    if (user.email === GUEST_EMAIL) {
      console.log("Gast-Modus: Erzwinge H24.png");
      applyBg('H24.png');
      localStorage.setItem(BG_KEY + '_' + user.uid, 'H24.png');
    } else {
      loadSavedBg();
    }

    // 4. Restliche Einstellungen
    loadSavedOverlay();
    loadSavedTheme();
    
    // 5. Assets laden
    if (typeof loadImageCount === 'function') loadImageCount();
    if (typeof loadAgingUnit === 'function') loadAgingUnit();
    
    // 6. Admin-Bereich Logik
    const adminBtn = document.getElementById('sidebar-admin-btn');
    if (adminBtn) {
      if (user.email === GUEST_EMAIL) {
        adminBtn.style.display = 'none';
        isAdminMode = false;
      } else {
        getDoc(doc(db, 'app_config', 'admin')).then(snap => {
          const adminEmails = snap.data()?.adminEmails || [];
          const isAdmin = PROTECTED_ADMINS.includes(user.email) || adminEmails.includes(user.email);
          adminBtn.style.display = isAdmin ? '' : 'none';
          isAdminMode = isAdmin;
        }).catch(() => {
          adminBtn.style.display = 'none';
          isAdminMode = false;
        });
      }
    }

    // 7. Daten-Snapshot starten
    loadBoards();

  } else {
    // Logout State
    currentUser = null;
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-screen').classList.remove('visible');
  }
});

// ── GAST-BOARDS MANUELL LÖSCHEN (NUR ADMIN) ─────────────────────────
window.deleteGuestBoards = async () => {
  // Sicherheitscheck: Ist der Ausführende wirklich ein Admin?
  if (!await currentUserIsAdmin()) {
    showToast('⛔ Nur Admins dürfen diese Aktion ausführen.');
    return;
  }

  // Sicherheitsabfrage vor dem Löschen
  if (!confirm('Möchtest du wirklich alle Gast-Boards und deren Inhalte unwiderruflich löschen?')) {
    return;
  }

  try {
    showToast('Gast-Boards werden gesucht und gelöscht...');
    
    // Wir suchen alle Boards, die der Gast-Email gehören
    const q = query(collection(db, 'boards'), where('ownerEmail', '==', 'gast@kanban-demo.de'));
    const guestBoards = await getDocs(q);

    if (guestBoards.empty) {
      showToast('Es gibt aktuell keine aktiven Gast-Boards.');
      return;
    }

    let deletedCount = 0;
    
    for (const boardDoc of guestBoards.docs) {
      const bId = boardDoc.id;
      
      // 1. Spalten und deren Karten löschen
      const colSnap = await getDocs(collection(db, 'boards', bId, 'columns'));
      for (const colDoc of colSnap.docs) {
        const cardSnap = await getDocs(collection(db, 'boards', bId, 'columns', colDoc.id, 'cards'));
        for (const cardDoc of cardSnap.docs) await deleteDoc(cardDoc.ref);
        await deleteDoc(colDoc.ref);
      }
      
      // 2. Eventuelle Noten löschen
      const gradeSnap = await getDocs(collection(db, 'boards', bId, 'grades'));
      for (const g of gradeSnap.docs) await deleteDoc(g.ref);
      
      // 3. Das Board selbst löschen
      await deleteDoc(boardDoc.ref);
      deletedCount++;
    }

    showToast(`✅ ${deletedCount} Gast-Board(s) erfolgreich gelöscht!`);
  } catch (error) {
    console.error('Fehler beim Löschen der Gast-Boards:', error);
    showToast('Fehler beim Löschen: ' + error.message);
  }
};

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
    
    // 1. Wenn das aktuelle Board gelöscht wurde -> zurücksetzen
    if (currentBoard && !boards.find(b => b.id === currentBoard.id)) {
      currentBoard = null;
    }
    
    // 2. ENTSCHEIDUNG: Board laden ODER leeren Bildschirm (Empty State) zeigen
    if (boards.length > 0) {
      // Nutzer hat Boards: Öffne das erste, falls keins aktiv ist
      if (!currentBoard) {
        selectBoard(boards[0].id);
      }
    } else {
      // FIX: Nutzer hat 0 Boards -> Zwingend alles leeren und "Neu"-Hinweis zeigen!
      currentBoard = null;
      showEmptyState();
    }
  });
}

function showEmptyState() {
  // Zeigt den Hinweis "Neues Board erstellen"
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'flex';
  
  // Versteckt die fremden/alten Board-Inhalte komplett
  const boardContent = document.getElementById('board-content');
  if (boardContent) boardContent.style.display = 'none';
  
  // Löscht auch den Titel oben, damit da nicht noch ein alter Name steht
  const titleDisplay = document.getElementById('board-title-display');
  if (titleDisplay) titleDisplay.innerHTML = 'Willkommen bei KanbanFluss'; 
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

  // --- 1. NEU: Zuerst deine Gruppe aus der Datenbank abrufen ---
  const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
  const myGroupId = userSnap.exists() ? userSnap.data().groupId || 'default' : 'default';

  // --- 2. NEU: Board mit Gruppen-Stempel anlegen ---
  const ref = await addDoc(collection(db, 'boards'), {
    name,
    uid: currentUser.uid,
    ownerName: currentUser.displayName || currentUser.email || '',
    groupId: myGroupId, // <--- HIER IST DER FEHLENDE STEMPEL!
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
  if (!src) {
    showToast('Fehler: Quell-Board nicht gefunden.', 'error');
    return;
  }

  showToast('Board wird dupliziert...');

  try {
    // 1. Deine aktuelle Gruppe aus der Datenbank abrufen
    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const myGroupId = userSnap.exists() ? userSnap.data().groupId || 'default' : 'default';

    // 2. Das neue Board-Dokument erstellen (mit Gruppen-Stempel)
    const newBoardRef = await addDoc(collection(db, 'boards'), {
      name:       src.name + ' – Kopie',
      uid:        currentUser.uid,
      ownerName:  currentUser.displayName || currentUser.email || 'Admin',
      groupId:    myGroupId, // <-- Hier wird die Klasse festgeschrieben
      members:    src.members  || [],
      wipLimit:   src.wipLimit || 3,
      agingDays:  src.agingDays || 5,
      createdAt:  serverTimestamp()
    });

    // 3. Spalten des alten Boards laden
    const colSnap = await getDocs(
      query(collection(db, 'boards', boardId, 'columns'), orderBy('order', 'asc'))
    );

    // 4. Jede Spalte einzeln kopieren
    for (const colDoc of colSnap.docs) {
      const colData = colDoc.data();
      const newColRef = await addDoc(
        collection(db, 'boards', newBoardRef.id, 'columns'),
        { 
          name: colData.name, 
          color: colData.color, 
          order: colData.order,
          wipLimit: colData.wipLimit || 0, 
          createdAt: serverTimestamp() 
        }
      );

      // 5. Karten innerhalb dieser Spalte kopieren
      const cardSnap = await getDocs(
        query(collection(db, 'boards', boardId, 'columns', colDoc.id, 'cards'), orderBy('order'))
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

    showToast('✅ Board erfolgreich für Gruppe ' + myGroupId + ' dupliziert!');
    
    // 6. Das neue Board sofort öffnen
    if (typeof selectBoard === 'function') {
      selectBoard(newBoardRef.id);
    }

  } catch (err) {
    console.error("Fehler beim Duplizieren:", err);
    showToast('Fehler beim Duplizieren: ' + err.message, 'error');
  }
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
  document.getElementById('board-title-display').innerHTML = escHtml(currentBoard.name) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
  setTimeout(reloadIcons, 50);
  
  // Lädt deinen eigenen Hintergrund wieder
  if (currentUser) syncBackgroundToUser(currentUser.uid);
};



// ── BOARD-EINSTELLUNGEN ÖFFNEN ──────────────────────────────────────

window.editBoardName = () => {
  // Wir rufen einfach die neue Funktion auf, die du ganz unten eingefügt hast
  if (typeof openBoardMetaModal === 'function') {
    openBoardMetaModal(currentBoard.id, currentBoard.name, currentBoard.groupId || 'default');
  }
};



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

  const colIdx = columns.findIndex(c => c.id === colId);
  const isFirstCol = colIdx === 0;
  const isLastCol = colIdx === columns.length - 1;

  const col = columns.find(c => c.id === colId);
  if (col) {
    const colEl = document.getElementById('col-' + colId);
    if (colEl) {
      colEl.classList.remove('wip-warning','wip-exceeded');
      const wip = getWipStatus({...col, id: colId});
      if (wip.colCls) colEl.classList.add(wip.colCls);
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
      ? '<div class="aging-badge"><i data-lucide="clock" style="width:11px;height:11px;margin-right:4px;"></i> Seit ' + agingDays + ' in Bearbeitung</div>'
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
    
    // -- NEU: GETRENNTE KOMMENTAR-FLAGS (Container-System mit Lucide Icons) --
    const allComments = card.comments || [];
    const teacherCount = allComments.filter(c => c.role === 'teacher').length;
    const studentCount = allComments.filter(c => c.role !== 'teacher').length;

    let flagsHtml = '<div class="card-flags">'; 
    if (allComments.length === 0) {
      flagsHtml += `<button class="comment-flag empty-flag" onclick="event.stopPropagation(); window.openComments('${card.id}', '${colId}')" title="Kommentar hinzufügen"><i data-lucide="message-square-plus" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
    } else {
      if (teacherCount > 0) {
        flagsHtml += `<button class="comment-flag teacher-flag" onclick="event.stopPropagation(); window.openComments('${card.id}', '${colId}')" title="Lehrer-Feedback">${teacherCount} <i data-lucide="graduation-cap" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
      }
      if (studentCount > 0) {
        flagsHtml += `<button class="comment-flag student-flag" onclick="event.stopPropagation(); window.openComments('${card.id}', '${colId}')" title="Schüler-Fragen">${studentCount} <i data-lucide="message-square" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
      }
    }
    flagsHtml += '</div>';
    
    const btnLeft = !isFirstCol ? `
      <button class="card-btn" onclick="event.stopPropagation(); moveCardStep('${card.id}', '${colId}', -1)" title="Nach links verschieben">
        <i data-lucide="chevron-left" style="width:14px;height:14px;pointer-events:none;"></i>
      </button>` : '';
      
    const btnRight = !isLastCol ? `
      <button class="card-btn" onclick="event.stopPropagation(); moveCardStep('${card.id}', '${colId}', 1)" title="Nach rechts verschieben">
        <i data-lucide="chevron-right" style="width:14px;height:14px;pointer-events:none;"></i>
      </button>` : '';

    return `
    <div class="card ${myCard?'my-card':''} ${agingClass}" id="card-${card.id}"
      draggable="true"
      ondragstart="onDragStart(event,'${card.id}','${colId}')"
      ondragend="onDragEnd(event)"
      ondblclick="openEditCard('${card.id}','${colId}')">
      ${flagsHtml}
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
          ${btnLeft}
          ${btnRight}
          <button class="card-btn" onclick="event.stopPropagation(); openEditCard('${card.id}','${colId}')" title="Bearbeiten">
            <i data-lucide="edit-2" style="width:12px;height:12px;"></i>
          </button>
          <button class="card-btn delete" onclick="event.stopPropagation(); deleteCard('${card.id}','${colId}')" title="Löschen">
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── KARTEN PER KNOPFDRUCK VERSCHIEBEN (INKL. ANIMATION) ──
window.moveCardStep = async (cardId, fromColId, direction) => {
  const fromColIdx = columns.findIndex(c => c.id === fromColId);
  const toColIdx = fromColIdx + direction;
  
  if (toColIdx < 0 || toColIdx >= columns.length) return; 
  
  const toCol = columns[toColIdx];
  const toColId = toCol.id;

  const toCount = (cards[toColId]||[]).length;
  if (toCol?.wipLimit && !isFinishedColumn(toCol) && toCount >= toCol.wipLimit) {
    showToast(`⚠️ WIP-Limit (${toCol.wipLimit}) erreicht! Karte kann nicht verschoben werden.`, 'error');
    return;
  }

  const srcCard = (cards[fromColId]||[]).find(c => c.id === cardId);
  if (!srcCard) return;

  const cardEl = document.getElementById('card-' + cardId);
  if (cardEl) {
    cardEl.style.transition = "transform 0.3s ease, opacity 0.3s ease";
    cardEl.style.transform = direction === 1 ? "translateX(60px)" : "translateX(-60px)";
    cardEl.style.opacity = "0";
  }

  // Korrekter Zeitstempel mit Sekunden
  const now = new Date().toISOString();
  const isNowFinished = isFinishedColumn(toCol);
  const fromColObj = columns[fromColIdx];
  
  const startedAt = srcCard.startedAt || (!isFinishedColumn(fromColObj||{}) ? now : '');
  const finishedAt = isNowFinished ? now : '';
  const toCards = cards[toColId] || [];

  setTimeout(async () => {
    try {
      await addDoc(collection(db, 'boards', currentBoard.id, 'columns', toColId, 'cards'), {
        text:       srcCard.text,
        priority:   srcCard.priority  || '',
        due:        srcCard.due       || '',
        assignee:   srcCard.assignee  || '',
        startedAt:  startedAt,
        finishedAt: finishedAt,
        order:      toCards.length,
        createdAt:  srcCard.createdAt || serverTimestamp(), // Wichtig: Ursprüngliches Datum behalten!
        comments:   srcCard.comments || [] // Wichtig: Kommentare beim Verschieben mitnehmen!
      });

      await deleteDoc(doc(db, 'boards', currentBoard.id, 'columns', fromColId, 'cards', cardId));
      showToast(isNowFinished ? '✅ Erledigt!' : '↔ Karte verschoben');
    } catch(e) {
      showToast('Fehler beim Verschieben', 'error');
      if (cardEl) {
        cardEl.style.transform = "none";
        cardEl.style.opacity = "1";
      }
    }
  }, 250); 
};

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
  if (!confirm('Möchtest du diese Aufgabe wirklich löschen?')) return;
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
  const now = new Date().toISOString();
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

  // 3. Berechtigung prüfen
  const isMaster = (userEmail === 'claus.unterberg@thomaeum.de' || userEmail === 'claus.unterberg67@gmail.com');
  const isListedAdmin = adminEmails.map(e => e.toLowerCase()).includes(userEmail.toLowerCase());

  if (!isMaster && !isListedAdmin) {
    console.warn(`Sicherheitswarnung: Unbefugter Admin-Zugriffsversuch von ${userEmail}`);
    showToast('⛔ Zugriff verweigert: Du hast keine Administrator-Rechte.', 'error');
    return;
  }

  // 4. Falls alles okay ist:
  isAdminMode = true;
  
  // Erst das Panel öffnen...
  await openAdminPanel(); 
  
  // ...und SOFORT den Gruppen-Tab als Start-Tab setzen:
  if (typeof showAdminTab === 'function') {
    showAdminTab('group');
  }
};

window.openAdminPanel = async () => {
  const user = auth.currentUser;
  if (!user) return;

  const myEmail = user.email.toLowerCase();
  const isClaus = (myEmail === 'claus.unterberg@thomaeum.de' || myEmail === 'claus.unterberg67@gmail.com');

  const toggleWrapper = document.getElementById('superadmin-toggle-wrapper');
  if (toggleWrapper) toggleWrapper.style.display = isClaus ? 'flex' : 'none';

  const isModeActive = document.getElementById('superadmin-mode-checkbox')?.checked || false;
  const panel = document.getElementById('admin-panel');
  if (panel) panel.style.display = 'block';

  const userGroup = window.currentUserGroup || localStorage.getItem('userGroup') || '10B';
  await loadAdminData(isClaus && isModeActive, userGroup);
  
  showAdminTab('group');
};

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
      ${PROTECTED_ADMINS.includes(email.toLowerCase())
        ? '<span style="font-size:11px;color:var(--text-muted);">(Geschützt)</span>'
        : email.toLowerCase() === currentUser?.email?.toLowerCase()
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
  if (el) el.textContent = `→ Es werden ${count} Thumbnails angezeigt: H24.png bis H${count}.png`;
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
  // Festes Limit auf 60 Hintergründe gesetzt
  return 60;
}

// ── NUTZERVERWALTUNG ─────────────────────────────────
window.loadAdminUsers = async () => {
  const list = document.getElementById('admin-users-list');
  if (!list) return;
  list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade Profile & Boards...</div>';

  try {
    // 1. Identität & Rechte
    const amISuper = (currentUser && (currentUser.displayName === 'Claus Unterberg' || PROTECTED_ADMINS.includes(currentUser.email)));
    const adminSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const adminData = adminSnap.exists() ? adminSnap.data() : {};
    const myGroupId = adminData.groupId || 'default';

    // 2. Profile laden (mit Sichtschutz)
    let q = amISuper ? query(collection(db, 'users'), orderBy('email')) : query(collection(db, 'users'), where('groupId', '==', myGroupId), orderBy('email'));
    const querySnapshot = await getDocs(q);
    const userMap = {};

    querySnapshot.forEach(docSnap => {
        const data = docSnap.data();
        userMap[data.uid] = { uid: data.uid, name: data.displayName || data.email, groupId: data.groupId || 'default', boards: [] };
    });

    // 3. Boards scannen (GEFIXTE VERSION)
const boardsSnap = await getDocs(collection(db, 'boards'));
boardsSnap.docs.forEach(d => {
    const data = d.data();
    const uid = data.uid || 'unbekannt';
    
    // Wenn der Nutzer schon in der Liste ist (aus der 'users'-Kollektion)...
    if (userMap[uid]) {
        // ...dann lassen wir seine groupId GENAU SO, wie sie in der Datenbank steht!
        userMap[uid].boards.push({ id: d.id, name: data.name });
    } else if (amISuper || data.groupId === myGroupId) {
        // Nur wenn der Nutzer VÖLLIG UNBEKANNT ist, legen wir ihn als Geist an
        userMap[uid] = { 
            uid: uid, 
            name: data.ownerName || 'Unbekannt', 
            groupId: data.groupId || 'default', // Hier greift der Fallback auf default
            boards: [{ id: d.id, name: data.name }] 
        };
    }
});

    const users = Object.values(userMap);
    
    // 4. HTML Generierung mit DEINER festen URL
    list.innerHTML = users.map(u => {
      const isMe = u.uid === currentUser?.uid;
      const userName = (u.name || '').trim();
      const isProtected = userName.toLowerCase() === "claus unterberg";
      
      // DEINE FESTE URL (Direkt zur Index-Seite)
      const fullInviteUrl = `https://genaiedu.github.io/kanban-app/?group=${u.groupId}`;

      let statusHtml = isProtected ? 
        '<span style="font-size:11px; color:var(--accent); font-weight:700; margin-left:8px;">[GESCHÜTZT]</span>' : 
        (isMe ? '<span style="font-size:11px; color:var(--text-muted); margin-left:8px;">(du)</span>' : 
        `<button class="btn-delete-admin" style="margin-left:8px;" onclick="event.stopPropagation(); adminDeleteUser('${u.uid}', '${escHtml(userName)}')">🗑 Löschen</button>`);

      let adminTools = '';
      // Link anzeigen für Superadmins ODER wenn es der eigene Account des Admins ist
      if (amISuper || isMe) {
          adminTools += `
            <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;" onclick="event.stopPropagation();">
                <div style="display:flex; gap:5px; align-items:center;">
                    <span style="font-size:11px; color:var(--text-muted);">Gruppe:</span>
                    <input type="text" id="grp-change-${u.uid}" class="settings-input" 
                           style="font-size:11px; padding:2px 4px; width:80px;" value="${u.groupId || ''}">
                    <button class="btn-sm btn-sm-primary" style="padding:2px 6px;" onclick="changeUserGroup('${u.uid}')">OK</button>
                </div>
                <div style="display:flex; align-items:center; gap:8px; background: rgba(0,0,0,0.04); padding:6px; border-radius:4px; border: 1px solid var(--border-color);">
                    <span style="font-size:10px; font-family:monospace; color:var(--text-main); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:160px;">
                        ?group=${u.groupId}
                    </span>
                    <button class="btn-icon" onclick="copyInvite('${fullInviteUrl}')" title="Einladungs-Link kopieren">
                        <i data-lucide="copy" style="width:14px; height:14px;"></i>
                    </button>
                </div>
            </div>`;
      }

      return `
      <div class="user-row">
        <div class="user-row-header" onclick="toggleUserBoards('${u.uid}')">
          <div class="assignee-avatar">${userName.slice(0, 2).toUpperCase()}</div>
          <div style="flex:1;">
            <div style="font-weight:600; font-size:13px;">${escHtml(userName)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${u.boards.length} Boards</div>
            ${adminTools}
          </div>
          ${statusHtml} 
        </div>
        <div class="user-row-boards" id="user-boards-${u.uid}">
          ${u.boards.length === 0 ? '<div style="padding:5px; font-size:12px;">Keine Boards.</div>' : u.boards.map(b => `<div class="user-board-item">🗂️ ${escHtml(b.name)}</div>`).join('')}
        </div>
      </div>`;
    }).join('');
    
    // WICHTIG: Lokale Lucide-Icons für GitHub Pages initialisieren
    if (typeof lucide !== 'undefined') lucide.createIcons();
    
  } catch (err) {
    console.error("Fehler:", err);
    list.innerHTML = '<div style="font-size:13px;color:red;">Fehler beim Laden.</div>';
  }
};


window.changeUserGroup = async (uid) => {
  const input = document.getElementById(`grp-change-${uid}`);
  if (!input) return;
  
  const newGroup = input.value.trim() || 'default';

  try {
    const userRef = doc(db, 'users', uid);

    // setDoc erstellt den User, falls er noch nicht in der Tabelle ist!
    await setDoc(userRef, { 
      groupId: newGroup,
      uid: uid,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    console.log("Gruppe erfolgreich gespeichert für:", uid);
    
    // Benutze Toast falls vorhanden, sonst Alert
    if (typeof showToast === 'function') {
        showToast('Gruppe erfolgreich gespeichert');
    } else {
        alert(`Gespeichert! Gruppe ist jetzt: ${newGroup}`);
    }
    
    // Liste neu laden
    if (typeof loadAdminUsers === 'function') {
        loadAdminUsers();
    }
    
  } catch (err) {
    console.error("Fehler beim Ändern der Gruppe:", err);
    alert("Fehler: " + err.message);
  }
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
    document.getElementById('board-title-display').innerHTML = escHtml(currentBoard.name) + ' <i data-lucide="eye" style="width:20px;height:20px;vertical-align:-4px;margin-left:8px;opacity:0.7;"></i> <span style="font-size:16px;opacity:0.7;font-weight:500;">(Admin-Ansicht)</span>';
    setTimeout(reloadIcons, 50);
    showToast('Board wird angezeigt (Admin-Ansicht)');
    
    // ── NEU: Hintergrund und Transparenz des Schülers laden ──
    if (currentBoard.uid) {
      getDoc(doc(db, 'user_settings', currentBoard.uid)).then(uSnap => {
        if (uSnap.exists()) {
          applyBg(uSnap.data().bg !== undefined ? uSnap.data().bg : '');
          const opacity = uSnap.data().overlayOpacity !== undefined ? uSnap.data().overlayOpacity : 72;
          document.documentElement.style.setProperty('--panel-opacity', (opacity / 100).toFixed(2));
        } else {
          applyBg('');
          document.documentElement.style.setProperty('--panel-opacity', '0.72');
        }
      }).catch(()=>{});
    }
  });
};

window.adminDeleteUser = async (uid, userName) => {
  // Hardcoded Namensschutz
  const protectedName = "Claus Unterberg";
  if (userName.trim().toLowerCase() === protectedName.toLowerCase()) {
    showToast(`⛔ SYSTEM-SCHUTZ: "${protectedName}" kann nicht gelöscht werden!`, 'error');
    return;
  }

  if (!confirm(`Nutzer „${userName}" und ALLE seine Boards löschen?\n\nDiese Aktion kann nicht rückgängig gemacht werden!`)) return;

  try {
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
    showToast(`Nutzer ${userName} gelöscht`);
    loadAdminUsers();
  } catch (e) {
    showToast("Fehler beim Löschen.", "error");
  }
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
  if (PROTECTED_ADMINS.includes(email.toLowerCase())) {
    showToast('⛔ Diese E-Mail-Adresse ist geschützt und kann nicht entfernt werden!', 'error');
    return;
  }
  if (!confirm(`${email} aus Admin-Liste entfernen?`)) return;
  const snap   = await getDoc(doc(db, 'app_config', 'admin'));
  const emails = (snap.data()?.adminEmails || []).filter(e => e.toLowerCase() !== email.toLowerCase());
  await updateDoc(doc(db, 'app_config', 'admin'), { adminEmails: emails });
  showToast('E-Mail entfernt');
  loadAdminEmails();
};

window.closeAdminPanel = () => {
  document.getElementById('admin-panel').style.display = 'none';
  // BUGFIX: isAdminMode = false; wurde hier gezielt entfernt!
  // Wenn das Panel geschlossen wird (z.B. beim Wechsel auf ein Schüler-Board), 
  // bleibst du ab sofort im Hintergrund weiterhin als Admin (Lehrer) autorisiert.
};

async function loadAdminData(isEffectiveSuper, groupName) {
  const boardContainer = document.getElementById('admin-group-boards-list');
  const userListContainer = document.getElementById('admin-all-users-list');
  
  if (boardContainer) boardContainer.innerHTML = '<div style="padding:15px; opacity:0.5;">Lade Boards...</div>';

  try {
    const boardsRef = collection(db, 'boards');
    const boardSnap = await getDocs(query(boardsRef));
    let allBoards = boardSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    console.log(`[Admin] Hole alle Daten. Anzahl Boards in DB: ${allBoards.length}`);

    // --- DER RADIKALE FILTER ---
    if (!isEffectiveSuper) {
      // Alles in Kleinbuchstaben umwandeln und Leerzeichen abschneiden
      const target = String(groupName || '10B').trim().toLowerCase();
      console.log(`[Admin] Lehrer-Modus aktiv. Sperre alles außer Gruppe: "${target}"`);
      
      allBoards = allBoards.filter(b => {
        // Wir prüfen vorsichtshalber beide Feldnamen, falls sie in Firebase abweichen
        const bGroup = String(b.groupId || b.group || '').trim().toLowerCase();
        return bGroup === target;
      });
      console.log(`[Admin] Filter abgeschlossen. Boards übrig: ${allBoards.length}`);
    }

    allBoards.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    const boardMap = {};
    allBoards.forEach(board => {
      const name = (board.ownerName || board.displayName || "Unbekannter Schüler") + " [DB-Gruppe: " + (board.groupId || "keine") + "]";
      if (!boardMap[name]) boardMap[name] = [];
      boardMap[name].push(board);
    });

    if (boardContainer) {
      if (allBoards.length === 0) {
        boardContainer.innerHTML = `<div style="padding:20px; opacity:0.5;">Keine Boards für Gruppe "${groupName}" gefunden.</div>`;
      } else {
        renderAdminUserList(boardMap, boardContainer);
      }
    }

    if (isEffectiveSuper && userListContainer) {
      userListContainer.innerHTML = '<div style="padding:15px; opacity:0.5;">Lade Nutzer...</div>';
      const userSnap = await getDocs(collection(db, 'users'));
      let html = '<div style="padding:10px;">';
      userSnap.forEach(doc => {
        const u = doc.data();
        html += `<div style="padding:10px; border-bottom:1px solid rgba(255,255,255,0.05);">
          <div style="font-weight:bold;">${u.displayName || 'Unbekannt'}</div>
          <div style="font-size:11px; opacity:0.6;">${u.email} | Gruppe: ${u.groupId || '---'}</div>
        </div>`;
      });
      userListContainer.innerHTML = html + '</div>';
    }

    const groupTitle = document.getElementById('admin-current-group-label');
    if (groupTitle) {
      groupTitle.textContent = isEffectiveSuper ? "Alle Boards der Schule" : `Boards der Gruppe: ${groupName}`;
    }

  } catch (err) {
    console.error("Admin-Fehler:", err);
  }
}

function renderAdminUserList(userMap, container) {
  container.innerHTML = '';
  // Wir sortieren die Schülernamen alphabetisch
  const sortedNames = Object.keys(userMap).sort();

  if (sortedNames.length === 0) {
    container.innerHTML = '<div style="padding:20px; opacity:0.5; text-align:center;">Keine Boards in dieser Gruppe gefunden.</div>';
    return;
  }

  sortedNames.forEach(name => {
    const boards = userMap[name];
    const userDiv = document.createElement('div');
    userDiv.style.cssText = "margin-bottom:15px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:12px;";

    userDiv.innerHTML = `
      <div style="font-weight:700; font-size:14px; color:var(--primary); margin-bottom:10px; display:flex; justify-content:space-between;">
        <span>${escHtml(name)}</span>
        <span style="font-size:10px; opacity:0.5;">${boards.length} Boards</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${boards.map(b => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--surface2); border-radius:6px; border:1px solid transparent;" onmouseover="this.style.borderColor='var(--border)'" onmouseout="this.style.borderColor='transparent'">
            
            <div style="flex:1; cursor:pointer; font-size:13px;" onclick="adminViewBoard('${b.id}')" title="Board ansehen">
              🗂️ ${escHtml(b.name)}
            </div>
            
            <div style="cursor:pointer; padding:4px 8px; border-left:1px solid var(--border); opacity:0.6;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" onclick="openBoardToolbox('${b.id}', '${escHtml(b.name.replace(/'/g, "\\'"))}', '${escHtml(name.replace(/'/g, "\\'"))}')" title="Noten & Einstellungen">
              <i data-lucide="wrench" style="width:14px;"></i>
            </div>
            
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(userDiv);
  });

  // Wichtig für deine lokalen Lucide-Icons bei GitHub
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
}




// WICHTIG: Hier fehlte das "async" vor (tabId)
window.showAdminTab = async (tabId) => {
  // 1. Liste aller Tabs, die in deinem neuen HTML vorkommen
  const tabs = ['group', 'users', 'emails', 'boardtools'];

  tabs.forEach(t => {
    const panel = document.getElementById('admin-tab-' + t);
    const btn = document.getElementById('admin-tab-' + t + '-btn');

    // Panel umschalten (Anzeigen/Verstecken)
    if (panel) {
      panel.style.display = (t === tabId) ? 'block' : 'none';
    }

    // Button-Design umschalten
    if (btn) {
      btn.className = (t === tabId) ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
    }
  });

  // 2. Spezifische Lade-Logik für die Tabs
  const userEmail = typeof currentUser !== 'undefined' && currentUser ? currentUser.email : '';
  const isSuperAdmin = typeof PROTECTED_ADMINS !== 'undefined' ? PROTECTED_ADMINS.includes(userEmail) : false;

  // --- DER NEUE FIX FÜR DEN SCHALTER ---
  // Wir prüfen jetzt zwingend, ob der Schalter auf "AN" steht!
  const modeCheckbox = document.getElementById('superadmin-mode-checkbox');
  const isModeActive = modeCheckbox ? modeCheckbox.checked : false;
  // Nur wenn du Claus bist UND der Schalter AN ist, gibt es die Super-Rechte bei den Boards
  const isEffectiveSuper = isSuperAdmin && isModeActive;

  if (tabId === 'group' && typeof currentUser !== 'undefined' && currentUser) { 
    // Gruppe des Admins aus Firestore laden
    const userDocSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const userGroup = userDocSnap.exists()
      ? (userDocSnap.data().groupId || '').trim()
      : (document.getElementById('sidebar-user-group')?.textContent || '').trim();
      
    if (!userGroup) {
      const c = document.getElementById('admin-group-boards-list');
      if (c) c.innerHTML = '<div style="padding:20px; opacity:0.5; font-size:13px;">Keine Gruppe zugewiesen.</div>';
      return;
    }
    
    // --- DIE KORRIGIERTE LADE-ZEILE ---
    // Hier wird jetzt isEffectiveSuper übergeben, NICHT mehr nur isSuperAdmin!
    loadAdminData(isEffectiveSuper, userGroup);
  }

  if (tabId === 'users' && isSuperAdmin) {
    if (typeof loadAdminUsers === 'function') loadAdminUsers();
  }

  if (tabId === 'emails' && isSuperAdmin) {
    if (typeof loadAdminEmails === 'function') loadAdminEmails();
  }

  // Wichtig für deine lokalen Lucide-Icons:
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
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

// ── GAST-LOGIN (Mit intelligentem Sandkasten-Reset & Live-Kooperation) ─────────────────
window.loginAsGuest = async () => {
  try {
    showToast('Gast-Zugang wird vorbereitet…');
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, GUEST_EMAIL, GUEST_PW);
    } catch (e) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        cred = await createUserWithEmailAndPassword(auth, GUEST_EMAIL, GUEST_PW);
        await updateProfile(cred.user, { displayName: 'Gast (Demo)' });
      } else { throw e; }
    }
    const uid = cred.user.uid;

    // --- NEU: Standard-Hintergrund H24 für Gäste festlegen ---
await setDoc(doc(db, 'user_settings', uid), { 
  bg: 'H24.png',
  overlayOpacity: '72' // Optional: Direkt die passende Deckkraft mitgeben
}, { merge: true });
// ---------------------------------------------------------

    // 1. ALTE GAST-BOARDS PRÜFEN (Zeitsperre auf 20 Minuten erhöht)
    const existingBoards = await getDocs(query(collection(db, 'boards'), where('uid', '==', uid)));
    let activeBoardExists = false;
    const now = Date.now();

    for (const boardDoc of existingBoards.docs) {
      const bId = boardDoc.id;
      const bData = boardDoc.data();
      
      // Alter des Boards in Minuten berechnen
      const createdAt = bData.createdAt ? bData.createdAt.toMillis() : 0;
      const ageInMinutes = (now - createdAt) / (1000 * 60);

      if (ageInMinutes < 20) { // <-- HIER auf 20 Minuten geändert!
        // Board ist jünger als 20 Minuten -> Jemand testet gerade aktiv!
        activeBoardExists = true;
      } else {
        // Board ist alt -> Gnadenlos löschen
        const colSnap = await getDocs(collection(db, 'boards', bId, 'columns'));
        for (const colDoc of colSnap.docs) {
          const cardSnap = await getDocs(collection(db, 'boards', bId, 'columns', colDoc.id, 'cards'));
          for (const cardDoc of cardSnap.docs) await deleteDoc(cardDoc.ref);
          await deleteDoc(colDoc.ref);
        }
        const gradeSnap = await getDocs(collection(db, 'boards', bId, 'grades'));
        for (const g of gradeSnap.docs) await deleteDoc(g.ref);
        await deleteDoc(boardDoc.ref);
      }
    }

    // 2. HINTERGRUND FÜR DEN GAST FESTLEGEN
    const guestBg = 'H24.png'; 
    const guestOpacity = 70;  
    await setDoc(doc(db, 'user_settings', uid), {
      bg: guestBg,
      overlayOpacity: guestOpacity
    }, { merge: true });
    
    if (typeof applyBg === 'function') applyBg(guestBg);
    document.documentElement.style.setProperty('--panel-opacity', (guestOpacity / 100).toFixed(2));

    // 3. ENTSCHEIDUNG: KOOPERATION ODER NEUSTART?
    if (activeBoardExists) {
      // Es ist gerade jemand online! Wir laden das Board UND STARTEN DIE TOUR TROTZDEM.
      showToast('Ein anderer Gast testet gerade! Live-Kooperation aktiv 🤝');
      setTimeout(() => { if (window.startTour) window.startTour(); }, 2000); // <--- DIESE ZEILE IST NEU
    } else {
      // Niemand ist online. Wir bauen ein komplett frisches Board auf.
      const boardRef = await addDoc(collection(db, 'boards'), {
        name: '🎯 Demo-Board', uid, ownerName: 'Gast', ownerEmail: GUEST_EMAIL,
        members: ['Gast'], wipLimit: 3, agingDays: 5, isGuest: true, createdAt: serverTimestamp()
      });

      const cols = [
        { name: '📋 Offen', color: '#4d7fff', order: 0 },
        { name: '⚙️ In Bearbeitung', color: '#f59e0b', order: 1 },
        { name: '✅ Fertig', color: '#10b981', order: 2 },
      ];
      const colRefs = [];
      for (const col of cols) {
        const ref = await addDoc(collection(db, 'boards', boardRef.id, 'columns'), { ...col, wipLimit: 3, createdAt: serverTimestamp() });
        colRefs.push({ id: ref.id, ...col });
      }

      const cards = [
        { text: 'Willkommen im Demo-Board! 👋', priority: 'hoch', colIdx: 0 },
        { text: 'Karten per Drag & Drop verschieben', priority: 'mittel', colIdx: 0 },
        { text: 'Neue Karte hinzufügen', priority: 'niedrig', colIdx: 0 },
        { text: 'Fälligkeitsdatum setzen', priority: 'mittel', colIdx: 1, startedAt: new Date().toISOString() },
        { text: 'Aufgabe abgeschlossen ✓', priority: 'niedrig', colIdx: 2, finishedAt: new Date().toISOString() },
      ];
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        await addDoc(collection(db, 'boards', boardRef.id, 'columns', colRefs[c.colIdx].id, 'cards'), {
          text: c.text, priority: c.priority, order: i, assignee: 'Gast', due: '',
          startedAt: c.startedAt || null, finishedAt: c.finishedAt || null, createdAt: serverTimestamp()
        });
      }

      // Spotlight-Tour nur starten, wenn das Board wirklich frisch gebaut wurde
      setTimeout(() => { if (window.startTour) window.startTour(); }, 2000);
      showToast('✅ Gast-Demo bereit!');
    } // schließt das 'else'
  } catch(e) { // <--- HIER darf nur EINE Klammer vor dem catch stehen!
    showToast('Fehler: ' + e.message);
  }
};


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
window.showAiPrompt = async () => {
  if (!currentBoard) return;

  const promptEl = document.getElementById('ai-prompt-content');
  promptEl.textContent = 'Board-Inhalt und WIP-Limits werden analysiert...';
  document.getElementById('modal-ai-prompt').style.display = 'flex';

  const boardName = currentBoard.name;
  const members = currentBoard.members || [];
  const teamInfo = members.length > 0 ? members.join(', ') : 'Einzelperson';
  const deadline = currentBoard.deadline ? currentBoard.deadline : 'Keine';
  
  // Board-weites WIP-Limit (falls gesetzt)
  const globalWip = currentBoard.wipLimit || "Kein festes Limit";

  // ── SNAPSHOT & WIP-CHECK ──
  const colSnap = await getDocs(query(collection(db, 'boards', currentBoard.id, 'columns'), orderBy('order', 'asc')));
  let currentBoardStateText = "";

  for (const colDoc of colSnap.docs) {
    const colData = colDoc.data();
    const colWipLimit = colData.wipLimit || 0;
    const limitText = colWipLimit > 0 ? `(WIP-Limit: ${colWipLimit})` : "";
    
    currentBoardStateText += `\nSpalte: "${colData.name}" ${limitText}\n`;
    
    const cardSnap = await getDocs(query(collection(db, 'boards', currentBoard.id, 'columns', colDoc.id, 'cards'), orderBy('order')));
    const currentCount = cardSnap.size;

    if (cardSnap.empty) {
      currentBoardStateText += "  (Aktuell leer)\n";
    } else {
      cardSnap.docs.forEach((cardDoc, index) => {
        const c = cardDoc.data();
        currentBoardStateText += `  - ${c.text} [Zuständig: ${c.assignee || 'offen'}]\n`;
      });
    }
    
    // Warnung für die KI, falls das Limit schon fast voll ist
    if (colWipLimit > 0 && currentCount >= colWipLimit) {
      currentBoardStateText += `  ⚠️ ACHTUNG KI: Diese Spalte ist VOLL (${currentCount}/${colWipLimit}). Hier darf nichts mehr hinzugefügt werden!\n`;
    }
  }

  let prompt = `Du bist ein Projektassistent für das Kanban-Board "${boardName}".

WICHTIGSTE REGEL: WIP-LIMITS BEACHTEN
Das Board nutzt WIP-Limits (Work-in-Progress), um Überlastung zu vermeiden.
${globalWip !== "Kein festes Limit" ? `- Globales Board-Limit: ${globalWip} Karten.` : ""}
- Beachte die Limits der einzelnen Spalten (siehe unten).
- Schlage NIEMALS vor, mehr Karten in eine Spalte zu legen, als das Limit erlaubt. 
- Wenn eine Spalte voll ist, muss erst eine Aufgabe fertiggestellt werden, bevor eine neue nachrücken darf.

AKTUELLER STAND:
${currentBoardStateText}

RAHMENDATEN:
- Team: ${teamInfo} | Deadline: ${deadline}

DEINE AUFGABE:
1. Berate den Nutzer. Achte dabei streng darauf, dass der Workflow nicht durch zu viele gleichzeitige Aufgaben stockt (WIP-Limit!).
2. Wenn der Nutzer "FERTIG" sagt, gib die Planung als JSON aus.

STRENGES JSON-FORMAT FÜR EXPORT:
[
  {
    "spalte": "NAME",
    "karten": [
      { "titel": "Text", "prio": "hoch/mittel/niedrig", "deadline": "YYYY-MM-DD", "wer": "Name" }
    ]
  }
]`;

  promptEl.textContent = prompt;
};

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
  if (!str) return '';
  const m = str.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ── 1. DER INTELLIGENTE PARSER (JSON-MODUS) ──
function parseExportText(raw) {
  try {
    // Wir suchen den Bereich zwischen der ersten [ und der letzten ]
    // So ignorieren wir jegliches "Gerede" der KI davor oder danach.
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']') + 1;
    
    if (start === -1 || end === 0) {
      throw new Error("Kein gültiger JSON-Code gefunden. Hast du den Block komplett kopiert?");
    }

    const jsonString = raw.slice(start, end);
    const data = JSON.parse(jsonString); // Verwandelt den Text-Code in echte Daten
    
    // Umwandlung in das interne Format deiner App
    const columns = data.map(col => ({
      name: col.spalte || "Neue Spalte",
      cards: (col.karten || []).map(card => ({
        text: card.titel || "Aufgabe",
        priority: (card.prio || "").toLowerCase(),
        due: card.deadline || "",
        assignee: card.wer || "",
        startedAt: "",
        finishedAt: ""
      }))
    }));

    return { boardName: "KI Planung", columns };
  } catch (e) {
    console.error("JSON Parser Fehler:", e);
    throw new Error("Das Format war nicht korrekt. Bitte kopiere den gesamten JSON-Block der KI.");
  }
}

// ── 2. DIE AKTUALISIERTE VORSCHAU-FUNKTION ──
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
    errEl.textContent = 'Bitte zuerst den JSON-Code der KI einfügen.';
    errEl.style.display = 'block';
    return;
  }

  let parsed;
  try { 
    parsed = parseExportText(raw); 
  } catch(e) {
    errEl.textContent = 'Fehler beim Lesen der Daten: ' + e.message;
    errEl.style.display = 'block';
    return;
  }

  importParsedData = parsed;

  const totalCards = parsed.columns.reduce((s, c) => s + c.cards.length, 0);
  let html = `<strong style="color:var(--text);">KI-Planung erkannt:</strong> ${parsed.columns.length} Spalte(n), ${totalCards} Karte(n)<br><br>`;
  
  parsed.columns.forEach(col => {
    html += `<div style="margin-bottom:8px;"><strong style="color:var(--accent);">${escHtml(col.name)}</strong> (${col.cards.length})<br>`;
    col.cards.forEach(c => {
      const prio = c.priority ? ` <span class="card-priority priority-${c.priority}" style="font-size:9px;">${c.priority}</span>` : '';
      const due  = c.due ? ` · 📅 ${c.due}` : '';
      const wer  = c.assignee ? ` · 👤 ${escHtml(c.assignee)}` : '';
      html += `<div style="font-size:12px; margin-left:10px; opacity:0.9;">→ ${escHtml(c.text)}${prio}${due}${wer}</div>`;
    });
    html += `</div>`;
  });
  
  html += `<br><em style="font-size:11px;">Klicke auf 'Jetzt importieren', um diese ${totalCards} Aufgaben in dein Board zu schreiben.</em>`;

  preEl.innerHTML = html;
  preEl.style.display = 'block';
  btnEl.style.display = 'inline-flex';
};

window.confirmImport = async () => {
  if (!importParsedData || !currentBoard) return;
  const btn = document.getElementById('import-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Speichere in Datenbank…'; 

  try {
    const columnsToImport = importParsedData.columns || [];
    let importedCardsCount = 0;

    const existingColSnap = await getDocs(
      query(collection(db, 'boards', currentBoard.id, 'columns'), orderBy('order', 'asc'))
    );
    const existingCols = existingColSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    let orderOffset = existingCols.length;

    for (const importCol of columnsToImport) {
      if (!importCol || !importCol.name) continue;

      const normName = (s) => (s || '').replace(/^[—–\-\s]+/, '').trim().toLowerCase();
      let colRef = existingCols.find(c => normName(c.name) === normName(importCol.name));

      if (!colRef) {
        const colors = ['#5c6ef8','#f59e0b','#10b981','#ec4899','#06b6d4','#8b5cf6'];
        const color  = colors[orderOffset % colors.length];
        const newCol = await addDoc(
          collection(db, 'boards', currentBoard.id, 'columns'),
          { name: importCol.name, color, order: orderOffset++, createdAt: serverTimestamp() }
        );
        colRef = { id: newCol.id, name: importCol.name };
      }

      const existingCardSnap = await getDocs(
        collection(db, 'boards', currentBoard.id, 'columns', colRef.id, 'cards')
      );
      let cardOrder = existingCardSnap.size;

      const cardsToImport = importCol.cards || [];
      for (const card of cardsToImport) {
        if (!card || !card.text) continue;

        const cardData = {
          text:      card.text || 'Ohne Titel',
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
        importedCardsCount++;
      }
    }

    closeModal('modal-import');
    showToast(`✅ Import abgeschlossen: ${importedCardsCount} Karte(n) importiert.`);
    
    // ── DER FIX: Eine winzige Verzögerung, damit Firebase Zeit zum Durchatmen hat ──
    setTimeout(() => {
      loadColumns();
    }, 300);

  } catch(e) {
    console.error("Fehler beim Importieren:", e);
    showToast('Fehler beim Import: ' + e.message, 'error');
  }

  // Button wieder freigeben
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

// ── BOARD-TOOLS (Kombiniert Noten, Abgabe, Aging) ──
window.showAdminBoardToolsUsers = () => {
  document.getElementById('admin-bt-users-view').style.display = 'block';
  document.getElementById('admin-bt-tools-view').style.display = 'none';
  loadAdminUserList('admin-bt-users-list', 'selectBoardToolsUser');
};

window.selectBoardToolsUser = async (uid, name) => {
  document.getElementById('admin-bt-users-view').style.display = 'none';
  document.getElementById('admin-bt-tools-view').style.display = 'block';
  document.getElementById('admin-bt-tools-container').style.display = 'none';

  const snap = await getDocs(query(collection(db, 'boards'), where('uid','==',uid)));
  const sel = document.getElementById('admin-bt-board-select');
  sel.innerHTML = '<option value="">– Board wählen –</option>' +
    snap.docs.map(d => `<option value="${d.id}">${escHtml(d.data().name)}</option>`).join('');
};

window.loadAdminBoardTools = async () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  const container = document.getElementById('admin-bt-tools-container');
  
  if (!boardId) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'flex';
  
  const boardSnap = await getDoc(doc(db, 'boards', boardId));
  const boardData = boardSnap.data() || {};

  // ── Das Board sofort im Hintergrund laden & Hintergrund synchronisieren ──
  if (boardSnap.exists()) {
    currentBoard = { id: boardId, ...boardData };
    if (typeof renderBoardsList === 'function') renderBoardsList();
    if (typeof loadColumns === 'function') loadColumns();
    
    document.getElementById('empty-state').style.display = 'none';
    document.getElementById('board-content').style.display = 'block';
    document.getElementById('board-title-display').innerHTML = escHtml(currentBoard.name) + ' <i data-lucide="eye" style="width:20px;height:20px;vertical-align:-4px;margin-left:8px;opacity:0.7;"></i> <span style="font-size:16px;opacity:0.7;font-weight:500;">(Admin)</span>';
    setTimeout(reloadIcons, 50);
    
    // NEU: Ruft die Hilfsfunktion für den Schüler-Hintergrund auf
    if (boardData.uid) syncBackgroundToUser(boardData.uid);
  }
  // ───────────────────────────────────────────────────────────
  
  document.getElementById('admin-bt-deadline').value = boardData.deadline || '';
  document.getElementById('admin-bt-aging').value = boardData.agingDays || 5;
  
  // Schalter für Beobachtung setzen
  const isWatched = !!boardData.isWatched;
  document.getElementById('admin-bt-watch-toggle').checked = isWatched;
  updateWatchToggleVisual(isWatched);
  
  // Noten laden
  const list = document.getElementById('admin-bt-grades-list');
  list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade Bewertungsdaten...</div>';

  const colSnap = await getDocs(query(collection(db, 'boards', boardId, 'columns')));
  const cols = colSnap.docs.map(d => ({id: d.id, ...d.data()}));
  
  const doneCol = cols.find(c => {
    const n = (c.name||'').toLowerCase();
    return n.includes('fertig') || n.includes('done') || n.includes('erledigt') || n.includes('abgeschlossen');
  });

  if (!doneCol) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Keine "Fertig"-Spalte gefunden.</div>';
    return;
  }

  // Alle fertigen Karten laden
  const cardsSnap = await getDocs(query(collection(db, 'boards', boardId, 'columns', doneCol.id, 'cards'), orderBy('order')));
  const finishedCards = cardsSnap.docs.map(d => ({id: d.id, ...d.data()}));

  // Produktnoten laden
  const gradesSnap = await getDocs(collection(db, 'boards', boardId, 'grades'));
  const productGrades = {};
  gradesSnap.docs.forEach(d => { productGrades[d.id] = d.data(); });

  const members = boardData.members || [];
  if (!members.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Dieses Board hat keine Mitglieder definiert.</div>';
    return;
  }

  let html = `
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:20px; padding:12px 16px; background:rgba(77,127,255,0.06); border:1px solid rgba(77,127,255,0.2); border-radius:8px; line-height:1.6;">
      <strong style="color:var(--text); font-size:13px;">ℹ️ Benotungssystem: Prozess (50%) + Produkt (50%)</strong><br>
      Die Noten an den einzelnen Karten dienen rein der <strong>Benotung des Prozesses</strong>. Um aufwendige Aufgaben stärker in die Prozessnote einfließen zu lassen, wird zusätzlich zur Note ein Aufwandswert (1-4) vergeben. Noch nicht benotete Prozess-Karten sind <span style="color:#ef4444; font-weight:600;">rot</span> markiert.<br>
      Nach Abschluss des Projektes wird unten die <strong>Produktnote</strong> eingetragen. Diese beinhaltet das Endprodukt sowie die Präsentation des Produktes. Beide Anteile werden anschließend zu 50% für die Gesamtnote zusammengerechnet.
    </div>
  `;

  members.forEach(member => {
    // Karten filtern, die diesem Mitglied zugewiesen sind
    const memberCards = finishedCards.filter(c => c.assignee === member);
    
    let totalEffort = 0;
    let weightedGradeSum = 0;
    
    let cardsHtml = '';
    if (memberCards.length === 0) {
      cardsHtml = '<div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Keine Aufgaben in der Fertig-Spalte.</div>';
    } else {
      cardsHtml = memberCards.map(c => {
        const gradeVal = c.grade || '';
        const effortVal = c.effort || '1';
        const comment  = c.gradeComment || '';
        
        if (gradeVal && effortVal) {
          totalEffort += parseInt(effortVal);
          weightedGradeSum += (parseFloat(gradeVal) * parseInt(effortVal));
        }

        const isUngraded = !gradeVal;
        const borderColor = isUngraded ? '#ef4444' : 'var(--success)';
        const bgColor = isUngraded ? 'rgba(239,68,68,0.04)' : 'var(--surface2)';
        
        let dateStr = 'Unbekannt';
        if (c.finishedAt) {
          const d = new Date(c.finishedAt);
          dateStr = d.toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric'});
        }

        return `
        <div style="border-left: 3px solid ${borderColor}; margin-bottom:10px; background:${bgColor}; border-radius:0 8px 8px 0; padding:10px 14px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px; align-items:flex-start;">
            <span style="font-weight:600; font-size:13px; color:var(--text); cursor:pointer; padding:2px 6px; background:rgba(255,255,255,0.05); border-radius:4px; border:1px solid var(--border); display:flex; align-items:center; gap:6px;" onclick="openCardJourney('${boardId}', '${doneCol.id}', '${c.id}')" title="Karten-Reise ansehen">
              <i data-lucide="search" style="width:14px;height:14px;"></i> ${escHtml(c.text)}
            </span>
            <span style="font-size:11px; color:var(--text-muted); padding-top:4px;">📅 Beendet: ${dateStr}</span>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:var(--text-muted); font-weight:600;">NOTE:</span>
              <select class="grade-select ${gradeVal ? 'grade-'+gradeVal : ''}" id="grade-val-${boardId}-${c.id}" style="width:50px; padding:4px 2px;" onchange="this.className='grade-select grade-'+this.value; saveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                <option value="">-</option>
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${gradeVal==n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:var(--text-muted); font-weight:600;">AUFWAND:</span>
              <select class="settings-input" id="effort-val-${boardId}-${c.id}" style="width:45px; padding:4px 2px; font-size:12px;" onchange="saveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                ${[1,2,3,4].map(n => `<option value="${n}" ${effortVal==n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
            <input type="text" id="grade-comment-${boardId}-${c.id}" value="${escHtml(comment)}" placeholder="Kommentar zur Aufgabe..." class="settings-input" style="flex:1; min-width:120px; padding:4px 8px; font-size:12px;" onblur="saveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
          </div>
        </div>`;
      }).join('');
    }

    let processGrade = totalEffort > 0 ? (weightedGradeSum / totalEffort).toFixed(1) : '-';
    
    const pData = productGrades[member] || {};
    const prodGrade = pData.grade || '';
    const prodComment = pData.comment || '';
    
    let finalGrade = '-';
    if (processGrade !== '-' && prodGrade) {
      finalGrade = ((parseFloat(processGrade) + parseFloat(prodGrade)) / 2).toFixed(1);
    }

    html += `
    <div style="margin-bottom:32px; border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="background:var(--surface2); padding:12px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px;">
        <div class="assignee-avatar">${member.slice(0,2).toUpperCase()}</div>
        <span style="font-weight:700; font-size:14px; flex:1;">${escHtml(member)}</span>
        <div style="text-align:right; font-size:12px; display:flex; gap:16px; background:rgba(0,0,0,0.1); padding:6px 12px; border-radius:8px;">
          <div><span style="color:var(--text-muted); margin-right:4px;">Prozess:</span> <strong style="color:var(--text); font-size:14px;">${processGrade}</strong></div>
          <div style="border-left:1px solid var(--border); padding-left:12px;"><span style="color:var(--text-muted); margin-right:4px;">Gesamtnote:</span> <strong style="color:var(--success); font-size:14px;">${finalGrade}</strong></div>
        </div>
      </div>
      
      <div style="padding:16px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg> 
          Karten im Prozess
        </div>
        ${cardsHtml}
        
        <div style="margin-top:20px; padding-top:16px; border-top:1px dashed var(--border);">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            Produkt & Präsentation
          </div>
          <div style="display:flex; gap:10px; align-items:center; background:var(--surface2); padding:10px 14px; border-radius:8px; border:1px solid var(--border);">
            <span style="font-size:11px; color:var(--text-muted); font-weight:600;">NOTE:</span>
            <select class="grade-select ${prodGrade ? 'grade-'+prodGrade : ''}" id="prod-val-${boardId}-${escHtml(member)}" style="width:55px; padding:4px 2px;" onchange="this.className='grade-select grade-'+this.value; saveProductGrade('${boardId}', '${escHtml(member)}')">
              <option value="">-</option>
              ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${prodGrade==n?'selected':''}>${n}</option>`).join('')}
            </select>
            <input type="text" id="prod-comment-${boardId}-${escHtml(member)}" value="${escHtml(prodComment)}" placeholder="Fazit / Kommentar zum Endprodukt..." class="settings-input" style="flex:1; padding:6px 10px; font-size:12px;" onblur="saveProductGrade('${boardId}', '${escHtml(member)}')">
          </div>
        </div>
      </div>
    </div>`;
  });

  list.innerHTML = html;
};

window.saveAdminBoardDeadline = async () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  if (!boardId) return;
  const value = document.getElementById('admin-bt-deadline').value || '';
  await updateDoc(doc(db, 'boards', boardId), { deadline: value });
  showToast(value ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

window.clearAdminBoardDeadline = async () => {
  document.getElementById('admin-bt-deadline').value = '';
  await saveAdminBoardDeadline();
};

window.saveAdminBoardAging = async () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  if (!boardId) return;
  const val = parseInt(document.getElementById('admin-bt-aging').value) || 5;
  await updateDoc(doc(db, 'boards', boardId), { agingDays: val });
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

window.updateWatchToggleVisual = (isChecked) => {
  const bg = document.getElementById('admin-bt-watch-bg');
  const knob = document.getElementById('admin-bt-watch-knob');
  if (!bg || !knob) return;
  if (isChecked) {
    bg.style.backgroundColor = 'rgba(77,127,255,0.2)';
    bg.style.borderColor = 'var(--accent)';
    knob.style.backgroundColor = 'var(--accent)';
    knob.style.transform = 'translateX(18px)';
  } else {
    bg.style.backgroundColor = 'var(--surface2)';
    bg.style.borderColor = 'var(--border)';
    knob.style.backgroundColor = 'var(--text-muted)';
    knob.style.transform = 'translateX(0)';
  }
};

window.toggleAdminBoardWatch = async () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  if (!boardId) return;
  const isChecked = document.getElementById('admin-bt-watch-toggle').checked;
  updateWatchToggleVisual(isChecked);
  await updateDoc(doc(db, 'boards', boardId), { isWatched: isChecked });
  showToast(isChecked ? 'Board wird nun beobachtet 👀' : 'Beobachtung beendet');
  checkWatchedBoards();
};

// ── SCROLL-POSITION MERKEN & WIEDERHERSTELLEN ──
window.safeReloadAdminTools = async () => {
  const adminPanel = document.getElementById('admin-panel');
  const scrollStates = [];
  
  // Merke dir von JEDEM scrollbaren Element im Admin-Bereich die Position
  if (adminPanel) {
    adminPanel.querySelectorAll('*').forEach(el => {
      if (el.scrollTop > 0) scrollStates.push({ el: el, top: el.scrollTop });
    });
  }

  // Lade das Menü neu (Datenbank-Update für Gesamtnote)
  await loadAdminBoardTools();

  // WICHTIG: Damit die lokal eingebundenen Lucide Icons nicht verschwinden,
  // müssen sie nach dem Neuzeichnen des HTMLs sofort wieder generiert werden!
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Setze im Hintergrund alle Scrollbalken exakt dorthin zurück!
  setTimeout(() => {
    scrollStates.forEach(state => {
      if (state.el) state.el.scrollTop = state.top;
    });
  }, 50);
};

window.saveCardGrade = async (boardId, colId, cardId) => {
  const grade   = document.getElementById(`grade-val-${boardId}-${cardId}`)?.value || '';
  const effort  = document.getElementById(`effort-val-${boardId}-${cardId}`)?.value || '1';
  const comment = document.getElementById(`grade-comment-${boardId}-${cardId}`)?.value.trim() || '';
  
  await updateDoc(doc(db, 'boards', boardId, 'columns', colId, 'cards', cardId), {
    grade, effort, gradeComment: comment, gradedAt: serverTimestamp()
  });
  
  // Emoji entfernt, da deine App ohnehin selbst ein "✓" setzt
  showToast('Bewertung automatisch gespeichert!');
  
  // Neu laden, ohne dass das Bild springt!
  await safeReloadAdminTools();
  checkWatchedBoards();
};

window.saveProductGrade = async (boardId, member) => {
  const grade   = document.getElementById(`prod-val-${boardId}-${member}`)?.value || '';
  const comment = document.getElementById(`prod-comment-${boardId}-${member}`)?.value.trim() || '';
  
  await setDoc(doc(db, 'boards', boardId, 'grades', member), {
    member, grade, comment, updatedAt: serverTimestamp()
  });
  
  showToast(`Produktnote für ${member} gespeichert!`);
  
  await safeReloadAdminTools();
};

window.checkWatchedBoards = async () => {
  const warningBox = document.getElementById('admin-global-warning');
  const warningText = document.getElementById('admin-global-warning-text');
  if (!warningBox || !warningText) return;
  
  try {
    const boardsSnap = await getDocs(query(collection(db, 'boards'), where('isWatched', '==', true)));
    if (boardsSnap.empty) {
      warningBox.style.display = 'none';
      return;
    }

    let ungradedCount = 0;
    let boardsWithUngraded = [];

    for (const bDoc of boardsSnap.docs) {
      const boardId = bDoc.id;
      const boardName = bDoc.data().name;
      
      const colSnap = await getDocs(query(collection(db, 'boards', boardId, 'columns')));
      const doneCol = colSnap.docs.find(c => {
        const n = (c.data().name||'').toLowerCase();
        return n.includes('fertig') || n.includes('done') || n.includes('erledigt') || n.includes('abgeschlossen');
      });

      if (doneCol) {
        const cardsSnap = await getDocs(collection(db, 'boards', boardId, 'columns', doneCol.id, 'cards'));
        let countInBoard = 0;
        cardsSnap.forEach(cardDoc => {
          if (!cardDoc.data().grade) countInBoard++;
        });
        if (countInBoard > 0) {
          ungradedCount += countInBoard;
          boardsWithUngraded.push(`${escHtml(boardName)} (${countInBoard})`);
        }
      }
    }

    if (ungradedCount > 0) {
      warningText.innerHTML = `Es gibt <strong>${ungradedCount} unbenotete Aufgaben</strong> in deinen beobachteten Boards:<br>${boardsWithUngraded.join(', ')}`;
      warningBox.style.display = 'block';
    } else {
      warningBox.style.display = 'none';
    }
  } catch(e) {
    console.error("Fehler beim Prüfen:", e);
  }
};

// Hilfsfunktion: Hintergrund eines bestimmten Nutzers laden (oder Standard)
async function syncBackgroundToUser(uid) {
  if (!uid) return;
  try {
    const uSnap = await getDoc(doc(db, 'user_settings', uid));
    if (uSnap.exists()) {
      const data = uSnap.data();
      // Hintergrundbild setzen
      applyBg(data.bg !== undefined ? data.bg : '');
      // Transparenz setzen
      const opacity = data.overlayOpacity !== undefined ? data.overlayOpacity : 72;
      document.documentElement.style.setProperty('--panel-opacity', (opacity / 100).toFixed(2));
    } else {
      // Falls der Nutzer noch nichts eingestellt hat: Standard
      applyBg('');
      document.documentElement.style.setProperty('--panel-opacity', '0.72');
    }
  } catch (e) {
    console.error("Hintergrund-Sync Fehler:", e);
  }
}

// ── SPOTLIGHT TOUR LOGIK (BEREINIGTE & MOBILE-VERSION) ────────────────

let tourStep = 0;

const tourSteps = [
  { selector: '#sidebar-el', infoPos: 'right', text: 'Willkommen bei KanbanFluss! In dieser Seitenleiste findest du alle deine Boards.' },
  { selector: '.sidebar-grip', shape: 'circle', infoPos: 'right', text: 'Mit diesem Griff kannst du die Seitenleiste jederzeit ein- und ausklappen.' },
  { selector: '.board-header', infoPos: 'board-right', text: 'Das hier ist das Herzstück: Dein Kanban-Board.' },
  { selector: '#columns-container', infoPos: 'board-right', text: 'Standardmäßig gibt es drei Spalten. Du kannst Aufgaben per Drag & Drop verschieben.' },
  { selector: '#columns-container', infoPos: 'board-right', text: 'Ein zentrales Prinzip ist das WIP-Limit (Work in Progress).' },
  { selector: '#columns-container', infoPos: 'board-right', text: 'Zusätzlich gibt es die Aging-Funktion für unbearbeitete Karten.' },
  { selector: 'button[onclick="toggleSettingsPanel()"]', infoPos: 'right', text: 'Ich öffne jetzt die Einstellungen automatisch für dich.' },
  { selector: '.settings-drawer', infoPos: 'left', onEnter: () => { document.getElementById('settings-panel').style.display = 'block'; }, text: 'Hier ist dein persönliches Menü!' },
  { selector: '#btn-theme-dark', infoPos: 'left', text: 'Wechsle hier zwischen Dark und Light Mode.' },
  { selector: '#overlay-slider', infoPos: 'left', text: 'Bestimme hier die Transparenz des Hintergrunds.' },
  { selector: '#bg-presets', infoPos: 'left', onLeave: () => { document.getElementById('settings-panel').style.display = 'none'; }, text: 'Wähle hier deine Farben oder Bilder aus.' },
  { selector: 'button[onclick="showAgenda()"]', shape: 'circle', text: 'In der Agenda siehst du alle Aufgaben nach Datum sortiert.' },
  { selector: 'button[onclick="showExport()"]', shape: 'circle', text: 'Exportiere dein Board als Text für Protokolle.' },
  { selector: 'button[onclick="showImport()"]', shape: 'circle', text: 'Füge hier zuvor exportierte oder KI-Boards wieder ein.' },
  { selector: 'button[onclick="showAiPrompt()"]', shape: 'circle', infoPos: 'left', text: 'Der KI-Assistent! Er generiert Prompts für ChatGPT/Claude.' }
];

window.startTour = () => {
  tourStep = 0;
  tourSteps.forEach(s => s._hasEntered = false);
  ['tour-overlay', 'tour-spotlight', 'tour-info'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });
  renderTourStep();
  window.addEventListener('resize', renderTourStep);
};

window.nextTourStep = () => {
  if (tourSteps[tourStep]?.onLeave) tourSteps[tourStep].onLeave();
  tourStep++;
  if (tourStep < tourSteps.length) {
    renderTourStep();
  } else {
    window.endTour();
  }
};

function renderTourStep() {
  const step = tourSteps[tourStep];
  const spotlight = document.getElementById('tour-spotlight');
  const info = document.getElementById('tour-info');
  const text = document.getElementById('tour-text');
  const nextBtn = document.getElementById('tour-next-btn');

  if (!spotlight || !info || !text) return;
  if (step.onEnter && !step._hasEntered) { step.onEnter(); step._hasEntered = true; }

  const isMobile = window.innerWidth <= 640;

  setTimeout(() => {
    const target = document.querySelector(step.selector);
    if (isMobile) {
      spotlight.style.display = 'none';
      info.style.display = 'block';
      info.style.position = 'fixed';
      info.style.width = '90%';
      info.style.left = '50%';
      info.style.bottom = '30px';
      info.style.top = 'auto';
      info.style.transform = 'translateX(-50%)';
      info.style.zIndex = '9999';
    } else {
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const padding = 12;
      spotlight.style.display = 'block';
      
      let width = rect.width + padding * 2;
      let height = rect.height + padding * 2;
      let left = rect.left - padding;
      let top = rect.top - padding;

      if (step.selector === '.settings-drawer') {
        width = 320 + padding * 2; height = window.innerHeight + padding * 2;
        left = window.innerWidth - 320 - padding; top = -padding;
        spotlight.style.borderRadius = '0';
      } else if (step.shape === 'circle') {
        const size = Math.max(width, height, 80);
        left = (rect.left + rect.width / 2) - size / 2;
        top = (rect.top + rect.height / 2) - size / 2;
        width = size; height = size;
        spotlight.style.borderRadius = '50%';
      } else {
        spotlight.style.borderRadius = '12px';
      }

      spotlight.style.width = `${width}px`;
      spotlight.style.height = `${height}px`;
      spotlight.style.left = `${left}px`;
      spotlight.style.top = `${top}px`;

      let infoTop = rect.bottom + 25;
      let infoLeft = rect.left;
      if (step.infoPos === 'left') infoLeft = left - 300;
      else if (step.infoPos === 'right') infoLeft = rect.right + 25;
      else if (step.infoPos === 'board-right') { infoTop = 150; infoLeft = window.innerWidth - 320; }

      if (infoTop + 200 > window.innerHeight) infoTop = window.innerHeight - 220;
      if (infoLeft + 300 > window.innerWidth) infoLeft = window.innerWidth - 320;
      if (infoLeft < 10) infoLeft = 10;

      info.style.top = `${infoTop}px`;
      info.style.left = `${infoLeft}px`;
      info.style.bottom = 'auto';
      info.style.transform = 'none';
    }
    text.textContent = step.text;
    if (nextBtn) nextBtn.textContent = (tourStep === tourSteps.length - 1) ? 'Tour beenden ✓' : 'Weiter →';
  }, 300);
}

window.endTour = () => {
  if (tourSteps[tourStep]?.onLeave) tourSteps[tourStep].onLeave();
  ['tour-overlay', 'tour-spotlight', 'tour-info'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  window.removeEventListener('resize', renderTourStep);
};

// ── KOMMENTAR-SYSTEM ──
window.openComments = (cardId, colId) => {
  const card = (cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  
  document.getElementById('comments-card-id').value = cardId;
  document.getElementById('comments-col-id').value = colId;
  document.getElementById('comments-card-title').innerHTML = `<i data-lucide="message-square"></i> ` + escHtml(card.text.slice(0, 30) + (card.text.length > 30 ? '...' : ''));
  
  renderCommentsList(card);
  document.getElementById('modal-comments').style.display = 'flex';
  setTimeout(() => {
    document.getElementById('new-comment-input').focus();
    if (typeof reloadIcons === 'function') reloadIcons();
  }, 100);
};

function renderCommentsList(card) {
  const list = document.getElementById('comments-list');
  const comments = card.comments || [];
  
  if (comments.length === 0) {
    list.innerHTML = '<div style="font-size:12px; color:var(--text-muted); text-align:center;">Noch keine Kommentare.</div>';
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
    return;
  }

  list.innerHTML = comments.map(c => {
    const isTeacher = c.role === 'teacher';
    const canDelete = isAdminMode || (!isTeacher && c.author === (currentUser?.displayName || currentUser?.email));
    const icon = isTeacher ? 'graduation-cap' : 'user';
    
    return `
    <div class="chat-bubble">
      <div style="display:flex; justify-content:space-between; font-size:10px; color:#4b5563; margin-bottom:4px; font-weight:700; align-items:center;">
        <span style="display:flex; align-items:center; gap:4px;"><i data-lucide="${icon}" style="width:12px;height:12px;"></i> ${escHtml(c.author)}</span>
        <span>${new Date(c.createdAt).toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'})}</span>
      </div>
      <div>${escHtml(c.text)}</div>
      ${canDelete ? `<button onclick="deleteComment('${card.id}', '${document.getElementById('comments-col-id').value}', '${c.id}')" style="position:absolute; top:4px; right:4px; background:none; border:none; color:#ef4444; cursor:pointer;" title="Löschen"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>` : ''}
    </div>`;
  }).join('');
  
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
}

window.addComment = async () => {
  const input = document.getElementById('new-comment-input');
  const text = input.value.trim();
  if (!text) return;

  const cardId = document.getElementById('comments-card-id').value;
  const colId = document.getElementById('comments-col-id').value;
  const card = (cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;

  const authorName = currentUser?.displayName || currentUser?.email || 'Unbekannt';
  const newComment = {
    id: Date.now().toString(),
    text: text,
    author: authorName,
    role: isAdminMode ? 'teacher' : 'student',
    createdAt: new Date().toISOString()
  };

  const updatedComments = [...(card.comments || []), newComment];
  await updateDoc(doc(db, 'boards', currentBoard.id, 'columns', colId, 'cards', cardId), { comments: updatedComments });
  
  input.value = '';
  card.comments = updatedComments; 
  renderCommentsList(card);

  // NEU: Schließt das Fenster direkt nach dem Senden
  closeModal('modal-comments');
};

window.deleteComment = async (cardId, colId, commentId) => {
  if (!confirm('Diesen Kommentar wirklich löschen?')) return;
  const card = (cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;

  const updatedComments = (card.comments || []).filter(c => c.id !== commentId);
  await updateDoc(doc(db, 'boards', currentBoard.id, 'columns', colId, 'cards', cardId), { comments: updatedComments });
  
  card.comments = updatedComments; 
  renderCommentsList(card);
};

document.getElementById('new-comment-input').addEventListener('keydown', e => { if(e.key === 'Enter') addComment(); });

// ── DIE KARTEN-REISE (LEHRER-ANSICHT) ──
window.openCardJourney = async (boardId, colId, cardId) => {
  document.getElementById('modal-journey').style.display = 'flex';
  const timeline = document.getElementById('journey-timeline');
  timeline.innerHTML = '<div style="font-size:12px; color:var(--text-muted);">Lade Daten...</div>';

  try {
    const snap = await getDoc(doc(db, 'boards', boardId, 'columns', colId, 'cards', cardId));
    if (!snap.exists()) throw new Error('Karte nicht gefunden');
    const card = snap.data();
    
    document.getElementById('journey-card-title').textContent = card.text;

    let events = [];
    const normTime = (t) => t && typeof t.toDate === 'function' ? t.toDate() : (t ? new Date(t) : new Date());

    if (card.createdAt) events.push({ time: normTime(card.createdAt), type: 'status', text: 'Aufgabe erstellt', icon: 'file-text', color: 'var(--text-muted)' });
    if (card.startedAt) events.push({ time: normTime(card.startedAt), type: 'status', text: 'In Bearbeitung genommen', icon: 'play', color: '#f59e0b' });
    if (card.finishedAt) events.push({ time: normTime(card.finishedAt), type: 'status', text: 'Aufgabe abgeschlossen', icon: 'check-circle', color: 'var(--success)' });

    (card.comments || []).forEach(c => {
      events.push({ 
        time: normTime(c.createdAt), type: 'comment', author: c.author, role: c.role, 
        text: c.text, icon: c.role==='teacher'?'graduation-cap':'message-square', color: c.role==='teacher'?'#a855f7':'#22c55e' 
      });
    });

    events.sort((a,b) => a.time - b.time);

    timeline.innerHTML = events.map(e => {
      const dateStr = e.time.toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'});
      
      if (e.type === 'status') {
        return `
        <div class="timeline-event">
          <div class="timeline-dot" style="border-color:${e.color}"><i data-lucide="${e.icon}" style="width:10px;height:10px;color:${e.color};"></i></div>
          <div style="font-size:11px; color:var(--text-muted);">${dateStr}</div>
          <div style="font-size:13px; font-weight:600; color:${e.color};">${e.text}</div>
        </div>`;
      } else {
        return `
        <div class="timeline-event">
          <div class="timeline-dot" style="border-color:${e.color}"><i data-lucide="${e.icon}" style="width:10px;height:10px;color:${e.color};"></i></div>
          <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${dateStr} – <strong>${escHtml(e.author)}</strong></div>
          <div class="chat-bubble" style="display:inline-block; margin:0;">${escHtml(e.text)}</div>
        </div>`;
      }
    }).join('');

    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);

  } catch (error) {
    timeline.innerHTML = '<div style="font-size:12px; color:var(--danger);">Fehler beim Laden der Historie.</div>';
  }
};

// ── WERKZEUGKASTEN PRO BOARD ────────────────────────
// ── WERKZEUGKASTEN PRO BOARD (MIT KOMPLEXEM NOTENMODUL) ────────────────────────
window.openBoardToolbox = async (boardId, boardName, ownerName) => {
  // 1. Werkzeugkasten-Container suchen oder erstellen
  let toolbox = document.getElementById('admin-board-toolbox');
  if (!toolbox) {
    toolbox = document.createElement('div');
    toolbox.id = 'admin-board-toolbox';
    toolbox.style.cssText = 'margin-top:16px; padding:16px; background:var(--bg-card); border:2px solid var(--border); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.2);';
    const container = document.getElementById('admin-group-boards-list');
    if (container) container.after(toolbox);
  }

  toolbox.innerHTML = '<div style="opacity:0.5; font-size:12px;">Lade komplexes Notenmodul...</div>';

  // 2. Daten laden (Board, Deadline, Aging)
  const boardSnap = await getDoc(doc(db, 'boards', boardId));
  if (!boardSnap.exists()) { showToast('Board nicht gefunden', 'error'); return; }
  const board = { id: boardId, ...boardSnap.data() };
  const deadline = board.deadline || '';
  const agingDays = board.agingDays || 5;
  const members = board.members || [];

  // 3. Spalten laden und "Fertig"-Spalte finden
  const colSnap = await getDocs(query(collection(db, 'boards', boardId, 'columns')));
  const cols = colSnap.docs.map(d => ({id: d.id, ...d.data()}));
  const doneCol = cols.find(c => {
    const n = (c.name||'').toLowerCase();
    return n.includes('fertig') || n.includes('done') || n.includes('erledigt') || n.includes('abgeschlossen');
  });

  // 4. Fertige Karten und Produktnoten laden
  let finishedCards = [];
  if (doneCol) {
    const cardsSnap = await getDocs(query(collection(db, 'boards', boardId, 'columns', doneCol.id, 'cards'), orderBy('order')));
    finishedCards = cardsSnap.docs.map(d => ({id: d.id, ...d.data()}));
  }
  const gradesSnap = await getDocs(collection(db, 'boards', boardId, 'grades'));
  const productGrades = {};
  gradesSnap.docs.forEach(d => { productGrades[d.id] = d.data(); });

  // 5. Header & Einstellungen HTML
  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <div style="font-weight:800; font-size:16px; color:var(--primary);">${escHtml(boardName)}</div>
        <div style="font-size:11px; color:var(--text-muted);">${escHtml(ownerName)}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-sm btn-sm-primary" onclick="adminViewBoard('${boardId}')" title="Board live ansehen">
          <i data-lucide="eye" style="width:14px;"></i> Ansehen
        </button>
        <button class="btn-sm btn-sm-ghost" onclick="document.getElementById('admin-board-toolbox').remove()" title="Schließen">✕</button>
      </div>
    </div>

    <div style="display:flex; gap:20px; margin-bottom:20px; flex-wrap:wrap; background:var(--surface2); padding:10px; border-radius:8px;">
      <div>
        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase;">Abgabetermin</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="date" id="toolbox-deadline-${boardId}" value="${deadline}" class="settings-input" style="padding:4px 8px; font-size:12px; border:1px solid var(--border);"/>
          <button class="btn-sm btn-sm-primary" onclick="toolboxSaveDeadline('${boardId}')"><i data-lucide="save" style="width:12px;"></i></button>
        </div>
      </div>
      <div>
        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase;">Aging-Warnung</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="number" id="toolbox-aging-${boardId}" value="${agingDays}" min="1" max="99" class="settings-input" style="width:60px; padding:4px 8px; font-size:12px; border:1px solid var(--border);"/>
          <button class="btn-sm btn-sm-primary" onclick="toolboxSaveAging('${boardId}')"><i data-lucide="save" style="width:12px;"></i></button>
        </div>
      </div>
    </div>
    
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:16px; padding:10px; background:rgba(77,127,255,0.06); border-radius:8px;">
      <strong style="color:var(--text);">🎓 Benotung: Prozess (50%) + Produkt (50%)</strong><br>
      Jede Aufgabe erhält eine Note und Aufwands-Gewichtung (Prozess). Unten wird die finale Produktnote ergänzt.
    </div>
  `;

  // 6. DAS KOMPLEXE NOTENMODUL EINFÜGEN
  if (!members.length) {
    html += '<div style="font-size:12px; opacity:0.5;">Keine Mitglieder in diesem Board.</div>';
  } else if (!doneCol) {
    html += '<div style="font-size:12px; color:var(--danger);">Keine "Fertig"-Spalte im Board gefunden! Karten können nicht bewertet werden.</div>';
  } else {
    members.forEach(member => {
      const memberCards = finishedCards.filter(c => c.assignee === member);
      let totalEffort = 0;
      let weightedGradeSum = 0;
      
      let cardsHtml = '';
      if (memberCards.length === 0) {
        cardsHtml = '<div style="font-size:11px; color:var(--text-muted); padding:8px;">Keine abgeschlossenen Aufgaben.</div>';
      } else {
        cardsHtml = memberCards.map(c => {
          const gradeVal = c.grade || '';
          const effortVal = c.effort || '1';
          const comment  = c.gradeComment || '';
          
          if (gradeVal && effortVal) {
            totalEffort += parseInt(effortVal);
            weightedGradeSum += (parseFloat(gradeVal) * parseInt(effortVal));
          }

          const isUngraded = !gradeVal;
          const borderColor = isUngraded ? '#ef4444' : 'var(--success)';
          
          return `
          <div style="border-left: 3px solid ${borderColor}; margin-bottom:8px; background:var(--surface2); border-radius:0 6px 6px 0; padding:8px;">
            <div style="font-weight:600; font-size:12px; margin-bottom:6px; color:var(--text); display:flex; justify-content:space-between;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70%;">${escHtml(c.text)}</span>
              ${isUngraded ? '<span style="color:#ef4444; font-size:10px;">Fehlt!</span>' : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <select class="grade-select ${gradeVal ? 'grade-'+gradeVal : ''}" id="grade-val-${boardId}-${c.id}" style="width:45px; padding:2px; font-size:11px;" onchange="this.className='grade-select grade-'+this.value; toolboxSaveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                <option value="">Note</option>
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${gradeVal==n?'selected':''}>${n}</option>`).join('')}
              </select>
              <select class="settings-input" id="effort-val-${boardId}-${c.id}" style="width:65px; padding:2px; font-size:11px; border:1px solid var(--border);" onchange="toolboxSaveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                <option value="1" ${effortVal=='1'?'selected':''}>Aufw: 1</option>
                <option value="2" ${effortVal=='2'?'selected':''}>Aufw: 2</option>
                <option value="3" ${effortVal=='3'?'selected':''}>Aufw: 3</option>
                <option value="4" ${effortVal=='4'?'selected':''}>Aufw: 4</option>
              </select>
              <input type="text" id="grade-comment-${boardId}-${c.id}" value="${escHtml(comment)}" placeholder="Kommentar zur Karte..." class="settings-input" style="flex:1; min-width:100px; padding:2px 6px; font-size:11px; border:1px solid var(--border);" onblur="toolboxSaveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
            </div>
          </div>`;
        }).join('');
      }

      let processGrade = totalEffort > 0 ? (weightedGradeSum / totalEffort).toFixed(1) : '-';
      const pData = productGrades[member] || {};
      const prodGrade = pData.grade || '';
      const prodComment = pData.comment || '';
      
      let finalGrade = '-';
      if (processGrade !== '-' && prodGrade) {
        finalGrade = ((parseFloat(processGrade) + parseFloat(prodGrade)) / 2).toFixed(1);
      }

      html += `
      <div style="margin-bottom:20px; border:1px solid var(--border); border-radius:8px; overflow:hidden;">
        <div style="background:rgba(0,0,0,0.2); padding:8px 12px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;">
          <div style="font-weight:700; font-size:14px; display:flex; align-items:center; gap:8px;">
            <div class="assignee-avatar" style="width:20px; height:20px; font-size:10px;">${member.slice(0,2).toUpperCase()}</div>
            ${escHtml(member)}
          </div>
          <div style="font-size:11px; display:flex; gap:12px; background:var(--surface2); padding:4px 8px; border-radius:4px;">
            <span>Prozess: <strong style="color:var(--text);">${processGrade}</strong></span>
            <span style="border-left:1px solid var(--border); padding-left:12px;">Gesamt: <strong style="color:var(--success); font-size:13px;">${finalGrade}</strong></span>
          </div>
        </div>
        
        <div style="padding:10px;">
          <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Aufgaben im Prozess</div>
          ${cardsHtml}
          
          <div style="margin-top:12px; padding-top:12px; border-top:1px dashed var(--border);">
            <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Produkt & Präsentation</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <select class="grade-select ${prodGrade ? 'grade-'+prodGrade : ''}" id="prod-val-${boardId}-${escHtml(member)}" style="width:50px; padding:4px; font-size:11px;" onchange="this.className='grade-select grade-'+this.value; toolboxSaveProductGrade('${boardId}', '${escHtml(member)}')">
                <option value="">-</option>
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${prodGrade==n?'selected':''}>${n}</option>`).join('')}
              </select>
              <input type="text" id="prod-comment-${boardId}-${escHtml(member)}" value="${escHtml(prodComment)}" placeholder="Fazit Endprodukt..." class="settings-input" style="flex:1; padding:4px 8px; font-size:11px; border:1px solid var(--border);" onblur="toolboxSaveProductGrade('${boardId}', '${escHtml(member)}')">
            </div>
          </div>
        </div>
      </div>`;
    });
  }

  toolbox.innerHTML = html;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── SPEICHER-FUNKTIONEN FÜR DIE TOOLBOX ──
window.toolboxSaveDeadline = async (boardId) => {
  const val = document.getElementById('toolbox-deadline-' + boardId)?.value || '';
  await updateDoc(doc(db, 'boards', boardId), { deadline: val });
  showToast(val ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

window.toolboxSaveAging = async (boardId) => {
  const val = parseInt(document.getElementById('toolbox-aging-' + boardId)?.value) || 5;
  await updateDoc(doc(db, 'boards', boardId), { agingDays: val });
  showToast('Aging-Limit gespeichert');
};

// ── DER ANTI-SPRING-TRICK (Merkt sich das Scrollen) ──
window.safeReloadToolbox = async (boardId) => {
  // 1. Scroll-Position des Admin-Panels merken (das ist das Fenster, das scrollt)
  const adminPanel = document.getElementById('admin-panel');
  const savedScrollTop = adminPanel ? adminPanel.scrollTop : 0;

  // 2. Die Namen oben aus der Toolbox auslesen, damit wir sie gleich wieder haben
  const boardName = document.querySelector('#admin-board-toolbox > div > div > div:nth-child(1)')?.textContent || 'Board';
  const ownerName = document.querySelector('#admin-board-toolbox > div > div > div:nth-child(2)')?.textContent || '';

  // 3. Toolbox stumm neu zeichnen (das rechnet die 50/50 Note neu aus)
  await openBoardToolbox(boardId, boardName, ownerName);

  // 4. Scroll-Position exakt wiederherstellen, BEVOR der Nutzer es merkt
  setTimeout(() => {
    if (adminPanel) {
      adminPanel.scrollTop = savedScrollTop;
    }
  }, 10); // 10 Millisekunden reichen, damit das Auge kein Flackern sieht
};

// ── SPEICHER-FUNKTIONEN FÜR DIE TOOLBOX ──
window.toolboxSaveCardGrade = async (boardId, colId, cardId) => {
  const grade   = document.getElementById(`grade-val-${boardId}-${cardId}`)?.value || '';
  const effort  = document.getElementById(`effort-val-${boardId}-${cardId}`)?.value || '1';
  const comment = document.getElementById(`grade-comment-${boardId}-${cardId}`)?.value.trim() || '';
  
  await updateDoc(doc(db, 'boards', boardId, 'columns', colId, 'cards', cardId), {
    grade, effort, gradeComment: comment, gradedAt: serverTimestamp()
  });
  
  showToast('Prozessnote gespeichert!');
  
  // Nutzt jetzt unseren Anti-Spring-Trick!
  await safeReloadToolbox(boardId);
};

window.toolboxSaveProductGrade = async (boardId, member) => {
  const grade   = document.getElementById(`prod-val-${boardId}-${member}`)?.value || '';
  const comment = document.getElementById(`prod-comment-${boardId}-${member}`)?.value.trim() || '';
  
  await setDoc(doc(db, 'boards', boardId, 'grades', member), {
    member, grade, comment, updatedAt: serverTimestamp()
  });
  
  showToast('Produktnote gespeichert!');
  
  // Nutzt jetzt unseren Anti-Spring-Trick!
  await safeReloadToolbox(boardId);
};


// --- NEUE SUPERADMIN FUNKTIONEN ---
window.copyInvite = (url) => {
    navigator.clipboard.writeText(url).then(() => {
        if (typeof showToast === 'function') showToast('Einladungs-Link kopiert!');
    });
};



/* --- PWA INSTALLATION LOGIC --- */

// Initialisierung der Variablen außerhalb der Events
let kanbanPromptEvent;
const pwaInstallBtn = document.getElementById('installApp');

// 1. Service Worker Registrierung
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Pfad './sw.js' setzt voraus, dass die Datei im Hauptordner liegt
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('PWA: Service Worker bereit'))
            .catch(err => console.error('PWA: Service Worker Fehler', err));
    });
}

// 2. Das Installations-Event abfangen (nur Android & Desktop Chrome)
window.addEventListener('beforeinstallprompt', (e) => {
    // Verhindert den automatischen Chrome-Banner
    e.preventDefault();
    // Speichert das Event
    kanbanPromptEvent = e;
    
    // Zeigt deinen Button an (falls vorhanden)
    if (pwaInstallBtn) {
        pwaInstallBtn.style.display = 'block';
    }
});

// 3. Klick-Logik für den Button
if (pwaInstallBtn) {
    pwaInstallBtn.addEventListener('click', async () => {
        if (!kanbanPromptEvent) return;
        
        // Zeigt den nativen Install-Dialog
        kanbanPromptEvent.prompt();
        
        const { outcome } = await kanbanPromptEvent.userChoice;
        if (outcome === 'accepted') {
            console.log('PWA: Installation akzeptiert');
            pwaInstallBtn.style.display = 'none';
        }
        kanbanPromptEvent = null;
    });
}

// 4. Button verstecken, wenn App bereits installiert wurde
window.addEventListener('appinstalled', () => {
    if (pwaInstallBtn) {
        pwaInstallBtn.style.display = 'none';
    }
    console.log('PWA: App erfolgreich installiert');
});

/* --- USER PROFILE MANAGEMENT --- */

// 1. Das Bearbeitungs-Fenster öffnen
window.openProfileModal = async () => {
    if (!currentUser) return;
    
    // Bestehende Fehlertexte löschen
    const errorDiv = document.getElementById('profile-error');
    if (errorDiv) errorDiv.textContent = '';

    // Felder im Modal mit aktuellen User-Daten füllen
    document.getElementById('profile-name').value = currentUser.displayName || '';
    document.getElementById('profile-email').value = currentUser.email || '';
    
    // Die Gruppe aus der Sidebar-Anzeige in das Input-Feld übertragen
    const currentGroup = document.getElementById('sidebar-user-group').textContent;
    document.getElementById('profile-group').value = (currentGroup === '...' || currentGroup === 'default') ? '' : currentGroup;

    // Modal anzeigen
    document.getElementById('modal-edit-profile').style.display = 'block';
};

// 2. Änderungen in Firebase Auth und Firestore speichern
window.saveProfile = async () => {
    if (!currentUser) return;

    const newName = document.getElementById('profile-name').value.trim();
    const newGroup = document.getElementById('profile-group').value.trim();
    const errorDiv = document.getElementById('profile-error');

    if (!newName || !newGroup) {
        if (errorDiv) errorDiv.textContent = "Bitte Name und Gruppe ausfüllen.";
        return;
    }

    try {
        // A. Name im Firebase Login-System (Auth) aktualisieren
        if (newName !== currentUser.displayName) {
            await updateProfile(currentUser, { displayName: newName });
        }

        // B. Name und Gruppe in der Firestore Datenbank (users-Collection) speichern
        const userRef = doc(db, 'users', currentUser.uid);
        await setDoc(userRef, {
            displayName: newName,
            groupId: newGroup
        }, { merge: true });

        // C. Die Anzeige in der Sidebar sofort aktualisieren
        document.getElementById('user-name-display').textContent = newName;
        document.getElementById('sidebar-user-group').textContent = newGroup;

        // Modal schließen
        closeModal('modal-edit-profile');
        console.log("Profil erfolgreich aktualisiert");
        
    } catch (error) {
        console.error("Fehler beim Profil-Update:", error);
        if (errorDiv) errorDiv.textContent = "Fehler beim Speichern. Bitte erneut versuchen.";
    }
};

/* --- BOARD META MANAGEMENT --- */

// 1. Modal öffnen und mit aktuellen Board-Daten füllen
window.openBoardMetaModal = (boardId, currentName, currentGroup) => {
    // ID zwischenspeichern
    document.getElementById('edit-board-id').value = boardId;
    
    // Felder füllen (Wir nutzen jetzt konsequent 'Name')
    document.getElementById('edit-board-name').value = currentName || '';
    document.getElementById('edit-board-group').value = currentGroup || 'default';
    
    // Alte Fehlermeldungen löschen
    const errorDiv = document.getElementById('board-edit-error');
    if (errorDiv) errorDiv.textContent = '';

    // Modal anzeigen
    document.getElementById('modal-edit-board-meta').style.display = 'block';
};

// 2. Änderungen in Firestore speichern
window.saveBoardMeta = async () => {
    const boardId = document.getElementById('edit-board-id').value;
    const newName = document.getElementById('edit-board-name').value.trim();
    const newGroup = document.getElementById('edit-board-group').value.trim();
    const errorDiv = document.getElementById('board-edit-error');

    if (!newName || !newGroup) {
        if (errorDiv) errorDiv.textContent = "Bitte alle Felder ausfüllen.";
        return;
    }

    try {
        const boardRef = doc(db, 'boards', boardId);
        
        // WICHTIG: Hier muss 'name' stehen, nicht 'title'!
        await setDoc(boardRef, {
            name: newName,
            groupId: newGroup
        }, { merge: true });

        // Lokales Objekt aktualisieren, damit die App sofort Bescheid weiß
        if (currentBoard && currentBoard.id === boardId) {
            currentBoard.name = newName;
            currentBoard.groupId = newGroup;
            
            // Titel oben im Board sofort ohne Reload ändern
            const display = document.getElementById('board-title-display');
            if (display) {
                display.innerHTML = escHtml(newName) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
                // Lucide Icons (lokal aus /fonts) neu laden
                if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
            }
        }

        // Die linke Sidebar aktualisieren
        if (typeof loadBoards === 'function') loadBoards();
        
        closeModal('modal-edit-board-meta');
        console.log("Board erfolgreich aktualisiert");
        
        // Falls du ein Toast-System hast:
        if (typeof showToast === 'function') showToast('Board-Einstellungen gespeichert!');

    } catch (error) {
        console.error("Fehler beim Board-Update:", error);
        if (errorDiv) errorDiv.textContent = "Fehler beim Speichern (Berechtigung?).";
    }
};

// Öffnet/Schließt die Link-Box und generiert die passende URL
window.toggleInviteBox = () => {
  const box = document.getElementById('admin-invite-box');
  const field = document.getElementById('admin-invite-url-field');
  if (!box || !field) return;

  if (box.style.display === 'none') {
    // Holt die Gruppe aus dem Label (z.B. "Boards der Gruppe: STEMPEL")
    const labelText = document.getElementById('admin-current-group-label').textContent;
    const groupName = labelText.includes(': ') ? labelText.split(': ')[1] : 'default';
    
    // Baut die URL für dein GitHub-Hosting zusammen
    const baseUrl = window.location.origin + window.location.pathname;
    field.value = `${baseUrl}?group=${encodeURIComponent(groupName.trim())}`;
    
    box.style.display = 'block';
    
    // WICHTIG: Lucide Icons lokal neu laden
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 10);
  } else {
    box.style.display = 'none';
  }
};

// Nutzt deine vorhandene showToast-Funktion
window.copyAdminInvite = () => {
  const field = document.getElementById('admin-invite-url-field');
  if (!field) return;
  
  navigator.clipboard.writeText(field.value).then(() => {
    if (typeof showToast === 'function') showToast('Einladungs-Link kopiert! 📋');
  });
};


window.updateSuperadminMode = () => {
  const checkbox = document.getElementById('superadmin-mode-checkbox');
  const knob = document.getElementById('superadmin-knob');
  const switchBg = document.getElementById('superadmin-switch-bg');
  const statusText = document.getElementById('superadmin-status-text');
  
  if (!checkbox || !knob || !switchBg) return;

  const isActive = checkbox.checked;

  knob.style.left = isActive ? '22px' : '2px';
  switchBg.style.background = isActive ? 'var(--primary)' : '#333';
  if (statusText) statusText.textContent = isActive ? "Superadmin-Modus: AN" : "Superadmin-Modus: AUS";

  const usersBtn = document.getElementById('admin-tab-users-btn');
  const emailsBtn = document.getElementById('admin-tab-emails-btn');
  if (usersBtn) usersBtn.style.display = isActive ? 'inline-block' : 'none';
  if (emailsBtn) emailsBtn.style.display = isActive ? 'inline-block' : 'none';

  const user = auth.currentUser;
  if (user) {
    const isClaus = (user.email.toLowerCase() === 'claus.unterberg@thomaeum.de' || user.email.toLowerCase() === 'claus.unterberg67@gmail.com');
    // Fallback auf LocalStorage eingebaut, damit die Gruppe niemals leer ist
    const userGroup = window.currentUserGroup || localStorage.getItem('userGroup') || '10B';
    
    console.log(`[System] Schalter geklickt. Neuer Status: ${isActive ? 'SUPERADMIN' : 'LEHRER'}`);
    loadAdminData(isClaus && isActive, userGroup);
  }
};


window.toggleInviteBox = () => {
  const box = document.getElementById('admin-invite-box');
  const field = document.getElementById('admin-invite-url-field');
  if (!box || !field) return;

  if (box.style.display === 'none') {
    // Gruppe finden: Wir schauen ins Label oder nehmen deine Standardgruppe
    const labelText = document.getElementById('admin-current-group-label')?.textContent || '';
    let groupName = labelText.includes(': ') ? labelText.split(': ')[1].trim() : (window.currentUserGroup || 'default');

    // URL zusammenbauen (GitHub Pages kompatibel)
    const baseUrl = window.location.origin + window.location.pathname;
    field.value = `${baseUrl}?group=${encodeURIComponent(groupName)}`;
    
    box.style.display = 'block';
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 10);
  } else {
    box.style.display = 'none';
  }
};

window.copyAdminInvite = () => {
  const field = document.getElementById('admin-invite-url-field');
  if (field) {
    navigator.clipboard.writeText(field.value).then(() => {
      if (typeof showToast === 'function') showToast('Einladungs-Link kopiert! 📋');
    });
  }
};
