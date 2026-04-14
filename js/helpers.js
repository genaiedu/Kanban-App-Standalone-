// js/helpers.js — Hilfsfunktionen (global auf window)

// ── TOAST ────────────────────────────────────────────
window.showToast = function(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = (type==='success' ? '✓' : '✗') + ' ' + msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
};

// ── FEHLER-ANZEIGE ───────────────────────────────────
window.showError = function(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.classList.add('show');
};

window.hideError = function(id) {
  document.getElementById(id).classList.remove('show');
};

// ── MODAL ────────────────────────────────────────────
window.closeModal = (id) => {
  document.getElementById(id).style.display = 'none';
};

// ── CUSTOM CONFIRM (Glasmorphismus statt Browser-Dialog) ──
window.showConfirm = function(message, okText = 'OK', cancelText = 'Abbrechen') {
  return new Promise(resolve => {
    // Overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px; animation: fadeIn 0.15s ease;';

    // Dialog-Box
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(var(--panel-rgb), 0.85); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.12); border-radius:16px; padding:28px 24px 20px; max-width:380px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.4); animation: slideUp 0.2s ease;';

    // Text
    const msgEl = document.createElement('div');
    msgEl.style.cssText = 'font-size:14px; line-height:1.7; color:var(--text); margin-bottom:24px; white-space:pre-line;';
    msgEl.textContent = message;

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex; gap:10px; justify-content:flex-end;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = cancelText;
    btnCancel.className = 'btn-sm btn-sm-ghost';
    btnCancel.style.cssText = 'padding:8px 18px; font-size:13px; border-radius:10px;';

    const btnOk = document.createElement('button');
    btnOk.textContent = okText;
    btnOk.className = 'btn-sm btn-sm-primary';
    btnOk.style.cssText = 'padding:8px 18px; font-size:13px; border-radius:10px;';

    const close = (result) => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.15s ease';
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    };

    btnCancel.onclick = () => close(false);
    btnOk.onclick = () => close(true);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };

    // Escape-Taste
    const onKey = (e) => { if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnOk);
    box.appendChild(msgEl);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Fokus auf OK-Button
    setTimeout(() => btnOk.focus(), 50);
  });
};

// ── TEXT-HELFER ──────────────────────────────────────
window.escHtml = function(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
};

window.linkify = function(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, function(url) {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;" onclick="event.stopPropagation()">${url}</a>`;
  });
};

// ── KARTEN LABEL GENERATOR (A, B, C ... AA, AB) ──────
window.numberToLabel = function(num) {
  let label = '';
  let temp = num;
  while (temp >= 0) {
    label = String.fromCharCode((temp % 26) + 65) + label;
    temp = Math.floor(temp / 26) - 1;
  }
  return label;
};

// ── LUCIDE ICONS ─────────────────────────────────────
window.reloadIcons = function() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

// ── DATUM ────────────────────────────────────────────
window.formatDate = function(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'2-digit' });
};

// ── SIDEBAR-GRIFF ────────────────────────────────────
window.setAllGrips = function(leftValue) {
  if (window.innerWidth <= 640) return;
  document.querySelectorAll('.sidebar-grip').forEach(g => {
    g.style.left = leftValue;
    g.style.transition = 'left 0.3s ease';
  });
};

// ── ENTER-LISTENER ───────────────────────────────────
window.addEnterListener = function(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if(e.key==='Enter') fn(); });
};

// ── TUTOR-PASSWORTDIALOG ──────────────────────────────
// Wird von openAdminArea() aufgerufen, wenn keine gültige Admin-Session vorliegt.
// Prüft das Masterpasswort gegen die geladene INI-Datei und entsperrt den Admin-Bereich.
window.showTutorPasswordPrompt = async function() {
  const ini = window._loadedIni;
  if (!ini || !ini.encryptedPrivateKey) {
    showToast('Bitte zuerst die Tutor-INI-Datei laden (Seitenleiste → "INI laden").', 'error');
    return;
  }

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(26,31,46,0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px 24px 20px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);';

    const teacherHint = ini.teacherName
      ? `<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Tutor: <strong style="color:var(--text);">${ini.teacherName}</strong></div>`
      : '';

    box.innerHTML = `
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:4px;display:flex;align-items:center;gap:8px;">🔑 Tutor-Authentifizierung</div>
      ${teacherHint}
      <div style="font-size:13px;color:var(--text-muted);margin:12px 0 16px;line-height:1.5;">
        Gib dein Masterpasswort ein, um den Admin-Bereich zu entsperren.
      </div>
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Masterpasswort</label>
        <input id="_tpw-i" type="password" placeholder="Masterpasswort eingeben"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:#1e2436;color:#e2e8f0;font-size:14px;outline:none;"/>
      </div>
      <div id="_tpw-e" style="color:#ef4444;font-size:12px;min-height:18px;margin-bottom:12px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="_tpw-cancel" style="padding:8px 18px;font-size:13px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:transparent;color:#e2e8f0;cursor:pointer;">Abbrechen</button>
        <button id="_tpw-ok" style="padding:8px 18px;font-size:13px;border-radius:10px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-weight:600;">🔓 Entsperren</button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const inp     = box.querySelector('#_tpw-i');
    const errEl   = box.querySelector('#_tpw-e');
    const btnOk   = box.querySelector('#_tpw-ok');
    const btnCancel = box.querySelector('#_tpw-cancel');
    setTimeout(() => inp?.focus(), 50);

    const close = () => {
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.15s ease';
      setTimeout(() => overlay.remove(), 150);
      resolve();
    };

    const tryAuth = async () => {
      const pw = inp.value;
      if (!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; return; }
      btnOk.disabled = true; btnOk.textContent = 'Prüfe…';
      errEl.textContent = '';
      try {
        const privKey = await window.kfCrypto.getPrivKeyFromIni(ini, pw);
        window._tutorSession = { privateKey: privKey };
        if (typeof window.setAdminAuthenticated === 'function') window.setAdminAuthenticated();
        close();
        if (typeof window.openAdminArea === 'function') window.openAdminArea();
      } catch(e) {
        errEl.textContent = 'Falsches Passwort.';
        btnOk.disabled = false; btnOk.textContent = '🔓 Entsperren';
        inp.select();
      }
    };

    btnCancel.onclick = close;
    btnOk.onclick = tryAuth;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') tryAuth(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  });
};

// ── LUCIDE INTERVALL ─────────────────────────────────
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
  setInterval(() => { lucide.createIcons(); }, 2000);
}
