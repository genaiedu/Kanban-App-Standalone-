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

// ── LUCIDE INTERVALL ─────────────────────────────────
if (typeof lucide !== 'undefined') {
  lucide.createIcons();
  setInterval(() => { lucide.createIcons(); }, 2000);
}
