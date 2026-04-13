// js/auth.js — Authentifizierung (Tutor normal, Schüler mit INI + Passwort)
import { S, getUser, saveUser } from './state.js';

const STUDENT_CFG_KEY = 'kf_student_config';

function getStudentConfig() {
  try { return JSON.parse(localStorage.getItem(STUDENT_CFG_KEY) || 'null'); } catch(e) { return null; }
}
function saveStudentConfig(cfg) {
  localStorage.setItem(STUDENT_CFG_KEY, JSON.stringify(cfg));
}

// ── APP STARTEN ──────────────────────────────────────────
window.initApp = function() {
  document.getElementById('loading-screen').style.display = 'none';

  // Nach Seiten-Reload: Rückgabe-Keys und INI aus sessionStorage wiederherstellen
  try {
    const savedKeys = sessionStorage.getItem('kf_return_keys');
    if (savedKeys) {
      window._studentReturnKeys = JSON.parse(savedKeys);
      sessionStorage.removeItem('kf_return_keys');
    }
    const savedIni = sessionStorage.getItem('kf_loaded_ini');
    if (savedIni) {
      window._loadedIni = JSON.parse(savedIni);
      sessionStorage.removeItem('kf_loaded_ini');
    }
  } catch(e) { /* ignorieren */ }

  const isStudent = sessionStorage.getItem('kf_role') === 'schueler';

  if (isStudent) {
    initStudentAuth();
  } else {
    const user = getUser();
    if (user.displayName) {
      enterApp(user, false);
    } else {
      document.getElementById('auth-screen').style.display = 'flex';
      // Ersteinrichtungs-Assistent für neue Tutoren anzeigen
      showFirstRunSetupIfNeeded();
      setTimeout(() => { const el = document.getElementById('profile-name'); if (el) el.focus(); }, 100);
    }
  }
};

// ── SCHÜLER-AUTHENTIFIZIERUNG ────────────────────────────
async function initStudentAuth() {
  document.getElementById('student-auth-screen').style.display = 'flex';
  const config = getStudentConfig();
  if (!config) {
    await showTeacherSelection();
    return;
  }

  // Nach Import-Reload: gespeichertes Passwort → Auto-Login, kein erneutes Eingeben nötig
  const autoPw = sessionStorage.getItem('kf_auto_login');
  if (autoPw) {
    sessionStorage.removeItem('kf_auto_login');
    try {
      const ok = await window.kfCrypto.checkToken(config.verifyToken, autoPw);
      if (ok) {
        window._kfSession = {
          studentPassword: autoPw,
          teacherPublicKeyJwk: config.publicKeyJwk,
          teacherName: config.teacherName,
          isStudent: true
        };
        enterApp(getUser(), true);
        return;
      }
    } catch(e) { /* Auto-Login fehlgeschlagen → normalen Login zeigen */ }
  }

  showStudentLogin(config);
}

// Gespeichertes INI-Objekt während der Registrierung
let _pendingIni = null;

async function showTeacherSelection() {
  _setStudentStep('teacher');
  _pendingIni = null;
  const errEl = document.getElementById('ini-load-error');
  if (errEl) errEl.textContent = '';
  const input = document.getElementById('ini-file-input');
  if (input) input.value = '';
}

// Wird vom <input type="file"> aufgerufen
window.loadIniFromFile = async function(event) {
  const file  = event.target.files[0];
  const errEl = document.getElementById('ini-load-error');
  errEl.textContent = '';
  if (!file) return;

  try {
    const text   = await file.text();
    const iniObj = JSON.parse(text);
    if (!iniObj.kanbanfluss_ini) throw new Error('Keine gültige EDUBAN-INI-Datei.');

    _pendingIni = iniObj;
    _setStudentStep('register');
    document.getElementById('student-teacher-label').textContent = iniObj.teacherName || file.name.replace(/\.ini$/i,'');
    document.getElementById('student-reg-error').textContent     = '';
    setTimeout(() => document.getElementById('student-reg-name').focus(), 100);
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    event.target.value = '';
  }
};

window.submitStudentRegister = async function() {
  const name  = document.getElementById('student-reg-name').value.trim();
  const pw    = document.getElementById('student-reg-pw').value;
  const pw2   = document.getElementById('student-reg-pw2').value;
  const errEl = document.getElementById('student-reg-error');
  errEl.textContent = '';

  if (!_pendingIni)  { errEl.textContent = 'Bitte zuerst die INI-Datei auswählen.'; return; }
  if (!name)         { errEl.textContent = 'Bitte Namen eingeben.'; return; }
  if (pw.length < 4) { errEl.textContent = 'Passwort muss mindestens 4 Zeichen haben.'; return; }
  if (pw !== pw2)    { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }

  const btn = document.getElementById('student-reg-submit');
  btn.disabled = true; btn.textContent = 'Wird eingerichtet…';

  try {
    const iniObj      = _pendingIni;
    const teacherName = iniObj.teacherName;
    const verifyToken = await window.kfCrypto.createToken(pw);

    saveStudentConfig({ teacherName, publicKeyJwk: iniObj.publicKey, verifyToken });
    saveUser({ displayName: name, groupId: '' });

    window._kfSession = {
      studentPassword: pw, teacherPublicKeyJwk: iniObj.publicKey,
      teacherName, isStudent: true
    };
    enterApp(getUser(), true);
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    btn.disabled = false; btn.textContent = 'Anmelden';
  }
};

function showStudentLogin(config) {
  _setStudentStep('login');
  const user = getUser();
  document.getElementById('student-login-username').textContent = user.displayName || '–';
  document.getElementById('student-login-teacher').textContent  = config.teacherName;
  document.getElementById('student-login-error').textContent    = '';
  setTimeout(() => document.getElementById('student-login-pw').focus(), 100);
}

window.submitStudentLogin = async function() {
  const config = getStudentConfig();
  const pw     = document.getElementById('student-login-pw').value;
  const errEl  = document.getElementById('student-login-error');
  errEl.textContent = '';
  if (!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; return; }

  const btn = document.getElementById('student-login-submit');
  btn.disabled = true; btn.textContent = 'Prüfe…';

  const ok = await window.kfCrypto.checkToken(config.verifyToken, pw);
  if (!ok) {
    errEl.textContent = 'Falsches Passwort.';
    btn.disabled = false; btn.textContent = 'Anmelden';
    return;
  }
  window._kfSession = {
    studentPassword: pw, teacherPublicKeyJwk: config.publicKeyJwk,
    teacherName: config.teacherName, isStudent: true
  };
  enterApp(getUser(), true);
};

window.resetStudentAuth = async function() {
  const ok = await showConfirm(
    'Neu anmelden?\n\nDeine Boards bleiben gespeichert, aber du musst einen neuen Tutor auswählen und ein neues Passwort setzen.',
    'Ja, neu anmelden', 'Abbrechen'
  );
  if (!ok) return;
  localStorage.removeItem(STUDENT_CFG_KEY);
  window._kfSession = null;
  await showTeacherSelection();
};

function _setStudentStep(step) {
  ['teacher','register','login'].forEach(s => {
    const el = document.getElementById(`student-step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
}

// ── TUTOR: NEU ANMELDEN (Profil zurücksetzen, Boards bleiben) ──
window.resetTutorProfile = async function() {
  const ok = await showConfirm(
    'Neu anmelden?\n\nDein Profil (Name) wird zurückgesetzt. Deine Boards und Daten bleiben erhalten.',
    'Ja, neu anmelden', 'Abbrechen'
  );
  if (!ok) return;
  saveUser({ displayName: '', groupId: '' });
  document.getElementById('app-screen').classList.remove('visible');
  const nameEl = document.getElementById('profile-name');
  const groupEl = document.getElementById('profile-group');
  if (nameEl) nameEl.value = '';
  if (groupEl) groupEl.value = '';
  // "Zurück"-Hinweis anzeigen damit man zurückkommt
  const hint = document.getElementById('tutor-relogin-hint');
  if (hint) hint.style.display = 'block';
  document.getElementById('auth-screen').style.display = 'flex';
  setTimeout(() => { document.getElementById('profile-name')?.focus(); }, 100);
};

// ── TUTOR: ZURÜCK ZUR APP (nach ungewolltem Neuanmelden) ──
window.resumeTutorSession = function() {
  const user = getUser();
  if (user.displayName) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('visible');
  }
};

// ── TUTOR: PROFIL SPEICHERN ──────────────────────────────
window.saveProfile = function() {
  const name  = document.getElementById('profile-name')?.value.trim()  || '';
  const group = document.getElementById('profile-group')?.value.trim() || '';
  if (!name) { showError('profile-error', 'Bitte gib deinen Namen ein.'); return; }
  
  // Prüfen ob INI-Datei vorhanden ist (für Tutoren wichtig!)
  const hasIni = window._loadedIni && window._loadedIni.encryptedPrivateKey;
  if (!hasIni) {
    // Ersteinrichtung anzeigen wenn noch keine INI
    const firstRunSetup = document.getElementById('first-run-setup');
    if (firstRunSetup) {
      firstRunSetup.style.display = 'block';
      showError('profile-error', '⚠️ Als Tutor bitte zuerst INI-Datei mit admin.html erstellen und hier laden!');
      setTimeout(() => document.getElementById('first-run-setup').scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      return;
    }
  }
  
  const user = { displayName: name, groupId: group || 'default' };
  saveUser(user);
  enterApp(user, false);
};

// ── ERSTEINRICHTUNG ANZEIGEN ────────────────────────────
window.showFirstRunSetupIfNeeded = function() {
  // Nur für Tutoren relevant (nicht für Schüler)
  if (sessionStorage.getItem('kf_role') === 'schueler') return;
  
  const user = getUser();
  if (!user.displayName) {
    // Neuer Tutor → Ersteinrichtungs-Assistent anzeigen
    const firstRunSetup = document.getElementById('first-run-setup');
    if (firstRunSetup) {
      firstRunSetup.style.display = 'block';
    }
  }
};

// ── IN DIE APP WECHSELN ──────────────────────────────────
function enterApp(user, isStudent) {
  S.currentUser = user;

  const ss = document.getElementById('student-auth-screen');
  if (ss) ss.style.display = 'none';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');

  const nameDisplay  = document.getElementById('user-name-display');
  const groupDisplay = document.getElementById('sidebar-user-group');
  if (nameDisplay)  nameDisplay.textContent  = user.displayName || 'Nutzer';
  if (groupDisplay) groupDisplay.textContent = user.groupId || '';

  const adminBtn     = document.getElementById('sidebar-admin-btn');
  const snapshotsBtn = document.getElementById('sidebar-snapshots-btn');
  const versionsBtn  = document.getElementById('sidebar-versions-btn');
  const iniBtn       = document.getElementById('sidebar-ini-btn');
  const returnBtn    = document.getElementById('sidebar-return-to-student-btn');
  const fmIniLabel   = document.getElementById('fm-ini-label');
  const badge        = document.getElementById('sidebar-role-badge');
  if (isStudent) {
    if (adminBtn)      adminBtn.style.display   = 'none';
    if (snapshotsBtn)  snapshotsBtn.style.display = 'none';
    if (versionsBtn)   versionsBtn.style.display = 'none';
    if (iniBtn)        iniBtn.style.display     = 'none';
    if (returnBtn)     returnBtn.style.display  = 'none';
    if (fmIniLabel)    fmIniLabel.style.display = 'none';
    if (badge) {
      badge.textContent = 'SchülerIn';
      badge.style.background = 'rgba(34,197,94,0.15)';
      badge.style.color = '#4ade80';
      badge.style.borderColor = 'rgba(34,197,94,0.35)';
    }
    S.isAdminMode = false;
  } else {
    if (adminBtn)      adminBtn.style.display   = '';
    if (snapshotsBtn)  snapshotsBtn.style.display = '';
    if (versionsBtn)   versionsBtn.style.display = '';
    if (iniBtn)        iniBtn.style.display     = '';
    if (returnBtn)     returnBtn.style.display  = '';
    if (fmIniLabel)    fmIniLabel.style.display = '';
    if (badge) {
      badge.textContent = 'Tutor';
      badge.style.background = 'rgba(99,102,241,0.2)';
      badge.style.color = '#818cf8';
      badge.style.borderColor = 'rgba(99,102,241,0.35)';
    }
    S.isAdminMode = true;
  }

  const sidebar = document.getElementById('sidebar-el');
  if (sidebar) {
    sidebar.classList.remove('collapsed');
    if (typeof setAllGrips === 'function') setAllGrips('260px');
  }

  // Board-State komplett zurücksetzen – kein fremdes Board darf sichtbar sein
  S.currentBoard = null;
  if (typeof showEmptyState === 'function') showEmptyState();

  if (typeof loadSavedBg      === 'function') loadSavedBg();
  if (typeof loadSavedOverlay === 'function') loadSavedOverlay();
  if (typeof loadSavedTheme   === 'function') loadSavedTheme();
  if (typeof loadImageCount   === 'function') loadImageCount();
  if (typeof loadAgingUnit    === 'function') loadAgingUnit();
  if (typeof loadBoards       === 'function') loadBoards(true);
}

// ── PROFIL BEARBEITEN (Tutor) ────────────────────────────
window.openProfileEdit = function() {
  const user  = getUser();
  const modal = document.getElementById('modal-profile-edit');
  if (!modal) return;
  document.getElementById('edit-profile-name').value  = user.displayName || '';
  document.getElementById('edit-profile-group').value = user.groupId || '';
  modal.style.display = 'flex';
};

window.saveProfileEdit = function() {
  const name  = document.getElementById('edit-profile-name')?.value.trim()  || '';
  const group = document.getElementById('edit-profile-group')?.value.trim() || '';
  if (!name) return;
  const user = { displayName: name, groupId: group || 'default' };
  saveUser(user);
  S.currentUser = user;
  const nd = document.getElementById('user-name-display');
  const gd = document.getElementById('sidebar-user-group');
  if (nd) nd.textContent = name;
  if (gd) gd.textContent = group;
  closeModal('modal-profile-edit');
  showToast('Profil gespeichert');
};

// ── INI-DATEI LADEN (jederzeit zugänglich) ────────────────
window.loadTeacherIni = async function() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.ini,.json';
  input.style.display = 'none';
  document.body.appendChild(input);

  const iniObj = await new Promise(resolve => {
    input.onchange = async (e) => {
      const f = e.target.files[0];
      document.body.removeChild(input);
      if (!f) { resolve(null); return; }
      try {
        const obj = JSON.parse(await f.text());
        resolve(obj.kanbanfluss_ini ? obj : null);
      } catch(e) { resolve(null); }
    };
    input.click();
  });

  if (!iniObj) { showToast('Keine gültige INI-Datei.', 'error'); return; }

  // Für Tutor: für nächsten Import merken (kein erneuter Upload nötig)
  window._loadedIni = iniObj;

  const session = window._kfSession;
  if (session?.isStudent) {
    // Für Schüler: Tutor-Schlüssel aktualisieren (z.B. anderer Tutor)
    session.teacherPublicKeyJwk = iniObj.publicKey;
    session.teacherName = iniObj.teacherName;
    const cfg = getStudentConfig() || {};
    cfg.publicKeyJwk = iniObj.publicKey;
    cfg.teacherName = iniObj.teacherName;
    saveStudentConfig(cfg);
  }

  showToast(`INI von "${iniObj.teacherName || 'Tutor'}" geladen`);
};

// ── ABMELDEN (zurück zum Begrüßungsbildschirm, alle Daten löschen) ──
window.logoutUser = async function() {
  const isStudent = window._kfSession?.isStudent;
  const ok = await showConfirm(
    '⚠️ Abmelden?\n\nAlle Boards und Daten werden von diesem Gerät gelöscht.\nVorher exportieren falls nötig!',
    'Ja, abmelden & löschen', 'Abbrechen'
  );
  if (!ok) return;

  // Alle Daten löschen
  localStorage.removeItem('kf_user');
  localStorage.removeItem('kanban_data');
  localStorage.removeItem('kanban_settings');
  localStorage.removeItem(STUDENT_CFG_KEY);
  window._kfSession = null;
  window._tutorSession = null;  // Tutor-Session löschen
  if (typeof window.resetToolsSession === 'function') window.resetToolsSession();
  if (typeof window.resetAdminSession === 'function') window.resetAdminSession();  // Admin-Session zurücksetzen

  // Board-Inhalt sofort aus dem DOM entfernen
  S.currentBoard = null;
  S.currentUser  = null;
  if (typeof showEmptyState === 'function') showEmptyState();

  document.getElementById('app-screen').classList.remove('visible');

  if (isStudent) {
    const ss = document.getElementById('student-auth-screen');
    ss.style.display = 'flex';
    _setStudentStep('teacher');
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
    const el = document.getElementById('profile-name');
    if (el) { el.value = ''; setTimeout(() => el.focus(), 100); }
  }
};

// ── ENTER-TASTEN ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  [
    ['profile-name',      () => saveProfile()],
    ['edit-profile-name', () => saveProfileEdit()],
    ['student-login-pw',  () => submitStudentLogin()],
    ['student-reg-pw2',   () => submitStudentRegister()],
  ].forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') fn(); });
  });
});
