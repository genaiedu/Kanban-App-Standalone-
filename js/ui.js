// js/ui.js — Sidebar, Tour, Kommentare, Profil, PWA, Legal, Superadmin
import { S, getCards, updateCard, updateBoard, updateColumn, getUser } from './state.js';

// --- Hilfsfunktionen ---
// Falls escHtml global nicht definiert ist, hier ein sicherer Fallback
const escapeHtml = (text) => {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
};

// --- Sidebar Logik ---
function setAllGrips(leftValue) {
  if (window.innerWidth <= 640) return;
  document.querySelectorAll('.sidebar-grip').forEach(g => {
    g.style.left = leftValue;
    g.style.transition = 'left 0.3s ease';
  });
}

window.toggleSidebar = () => {
  const sidebar = document.getElementById('sidebar-el');
  if (!sidebar) return;

  if (window.innerWidth <= 640) {
    sidebar.classList.contains('open') ? window.closeSidebar() : window.openSidebar();
    return;
  }
  const isCollapsed = sidebar.classList.toggle('collapsed');
  setAllGrips(isCollapsed ? '0px' : '260px');
};

document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar-el');
  if (sidebar && window.innerWidth > 640) {
    setAllGrips(sidebar.classList.contains('collapsed') ? '0px' : '260px');
  }
});

window.closeSidebar = () => {
  if (window.innerWidth > 640) return;
  const sidebar = document.getElementById('sidebar-el');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.style.display = 'none';
  setAllGrips('0px');
};

window.openSidebar = () => {
  if (window.innerWidth > 640) return;
  const sidebar = document.getElementById('sidebar-el');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('open');
  if (backdrop) backdrop.style.display = 'block';
  setAllGrips('260px');
};

// --- Legal & Help ---
window.openLegal = () => {
  document.getElementById('modal-legal').style.display = 'flex';
  window.showLegalTab('impressum');
};

window.showLegalTab = (tab) => {
  const isImprint = tab === 'impressum';
  document.getElementById('legal-impressum').style.display = isImprint ? 'block' : 'none';
  document.getElementById('legal-datenschutz').style.display = isImprint ? 'none' : 'block';
  document.getElementById('tab-impressum').className = isImprint ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  document.getElementById('tab-datenschutz').className = isImprint ? 'btn-sm btn-sm-ghost' : 'btn-sm btn-sm-primary';
};

// HIER IST DIE ANGEPASSTE FUNKTION FÜR DAS HANDBUCH
window.openHelp = async () => {
  const modal = document.getElementById('modal-help');
  const contentContainer = document.getElementById('help-content-container'); 
  
  if (!modal || !contentContainer) {
    console.error("Modal oder Container (help-content-container) für das Handbuch nicht gefunden!");
    if (modal) modal.style.display = 'flex'; // Zeige es zumindest an, falls der Container fehlt
    return;
  }

  // Modal anzeigen
  modal.style.display = 'flex';

  // Datei nur laden, wenn der Container noch leer ist
  if (contentContainer.innerHTML.trim() === '') {
    try {
      contentContainer.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">Lade Handbuch...</div>';
      
      const response = await fetch('manual.html');
      if (!response.ok) throw new Error('Handbuch konnte nicht geladen werden');
      
      const htmlText = await response.text();
      contentContainer.innerHTML = htmlText;
      
      if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);

    } catch (error) {
      console.error("Fehler beim Laden:", error);
      contentContainer.innerHTML = '<div style="color: #ef4444; padding: 20px;">Fehler beim Laden des Handbuchs. Bitte überprüfe, ob die manual.html existiert.</div>';
    }
  }
};

// --- Tour Logik ---
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
      Object.assign(info.style, {
        display: 'block', position: 'fixed', width: '90%', left: '50%',
        bottom: '30px', top: 'auto', transform: 'translateX(-50%)', zIndex: '9999'
      });
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

      Object.assign(spotlight.style, {
        width: `${width}px`, height: `${height}px`,
        left: `${left}px`, top: `${top}px`
      });

      let infoTop = rect.bottom + 25;
      let infoLeft = rect.left;
      
      if (step.infoPos === 'left') infoLeft = left - 300;
      else if (step.infoPos === 'right') infoLeft = rect.right + 25;
      else if (step.infoPos === 'board-right') { infoTop = 150; infoLeft = window.innerWidth - 320; }

      if (infoTop + 200 > window.innerHeight) infoTop = window.innerHeight - 220;
      if (infoLeft + 300 > window.innerWidth) infoLeft = window.innerWidth - 320;
      if (infoLeft < 10) infoLeft = 10;

      Object.assign(info.style, {
        top: `${infoTop}px`, left: `${infoLeft}px`,
        bottom: 'auto', transform: 'none'
      });
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

// --- Kommentare ---
window.openComments = (cardId, colId) => {
  const card = (S.cards[colId] || []).find(c => c.id === cardId);
  if (!card) return;
  
  document.getElementById('comments-card-id').value = cardId;
  document.getElementById('comments-col-id').value = colId;
  
  const shortText = card.text.length > 30 ? card.text.slice(0, 30) + '...' : card.text;
  document.getElementById('comments-card-title').innerHTML = `<i data-lucide="message-square"></i> ${escapeHtml(shortText)}`;
  
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
    const authorName = S.currentUser?.displayName || S.currentUser?.email;
    const canDelete = S.isAdminMode || (!isTeacher && c.author === authorName);
    const icon = isTeacher ? 'graduation-cap' : 'user';
    const dateStr = new Date(c.createdAt).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    
    return `
    <div class="chat-bubble">
      <div style="display:flex; justify-content:space-between; font-size:10px; color:#4b5563; margin-bottom:4px; font-weight:700; align-items:center;">
        <span style="display:flex; align-items:center; gap:4px;"><i data-lucide="${icon}" style="width:12px;height:12px;"></i> ${escapeHtml(c.author)}</span>
        <span>${dateStr}</span>
      </div>
      <div>${escapeHtml(c.text)}</div>
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
  const card = (S.cards[colId] || []).find(c => c.id === cardId);
  if (!card || !S.currentBoard) return;

  const authorName = S.currentUser?.displayName || S.currentUser?.email || 'Unbekannt';
  const newComment = {
    id: Date.now().toString(),
    text: text,
    author: authorName,
    role: S.isAdminMode ? 'teacher' : 'student',
    createdAt: new Date().toISOString()
  };

  const updatedComments = [...(card.comments || []), newComment];
  
  updateCard(S.currentBoard.id, colId, cardId, { comments: updatedComments });
  input.value = '';
  card.comments = updatedComments;
  renderCommentsList(card);
  if (typeof closeModal === 'function') closeModal('modal-comments');
};

window.deleteComment = async (cardId, colId, commentId) => {
  if (!await showConfirm('Diesen Kommentar wirklich löschen?', 'Löschen', 'Abbrechen')) return;
  const card = (S.cards[colId] || []).find(c => c.id === cardId);
  if (!card || !S.currentBoard) return;

  const updatedComments = (card.comments || []).filter(c => c.id !== commentId);
  updateCard(S.currentBoard.id, colId, cardId, { comments: updatedComments });
  card.comments = updatedComments;
  renderCommentsList(card);
};

document.getElementById('new-comment-input')?.addEventListener('keydown', e => { 
  if(e.key === 'Enter') window.addComment(); 
});

// --- Card Journey ---
window.openCardJourney = (boardId, colId, cardId) => {
  document.getElementById('modal-journey').style.display = 'flex';
  const timeline = document.getElementById('journey-timeline');

  const cards = getCards(boardId, colId);
  const card = cards.find(c => c.id === cardId);
  if (!card) {
    timeline.innerHTML = '<div style="font-size:12px; color:var(--danger);">Karte nicht gefunden.</div>';
    return;
  }

  document.getElementById('journey-card-title').textContent = card.text;

  let events = [];
  const normTime = (t) => t ? new Date(t) : new Date();

  if (card.createdAt) events.push({ time: normTime(card.createdAt), type: 'status', text: 'Aufgabe erstellt', icon: 'file-text', color: 'var(--text-muted)' });
  if (card.startedAt) events.push({ time: normTime(card.startedAt), type: 'status', text: 'In Bearbeitung genommen', icon: 'play', color: '#f59e0b' });
  if (card.finishedAt) events.push({ time: normTime(card.finishedAt), type: 'status', text: 'Aufgabe abgeschlossen', icon: 'check-circle', color: 'var(--success)' });

  (card.comments || []).forEach(c => {
    events.push({
      time: normTime(c.createdAt), type: 'comment', author: c.author, role: c.role,
      text: c.text, icon: c.role === 'teacher' ? 'graduation-cap' : 'message-square',
      color: c.role === 'teacher' ? '#a855f7' : '#22c55e'
    });
  });

  events.sort((a,b) => a.time - b.time);

  timeline.innerHTML = events.map(e => {
    const dateStr = e.time.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

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
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">${dateStr} – <strong>${escapeHtml(e.author)}</strong></div>
        <div class="chat-bubble" style="display:inline-block; margin:0;">${escapeHtml(e.text)}</div>
      </div>`;
    }
  }).join('');

  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// --- PWA Installation ---
let kanbanPromptEvent;
const pwaInstallBtn = document.getElementById('installApp');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('PWA: Service Worker bereit'))
      .catch(err => console.error('PWA: Service Worker Fehler', err));
  });
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  kanbanPromptEvent = e;
  if (pwaInstallBtn) pwaInstallBtn.style.display = 'block';
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener('click', async () => {
    if (!kanbanPromptEvent) return;
    kanbanPromptEvent.prompt();
    const { outcome } = await kanbanPromptEvent.userChoice;
    if (outcome === 'accepted') {
      console.log('PWA: Installation akzeptiert');
      pwaInstallBtn.style.display = 'none';
    }
    kanbanPromptEvent = null;
  });
}

window.addEventListener('appinstalled', () => {
  if (pwaInstallBtn) pwaInstallBtn.style.display = 'none';
  console.log('PWA: App erfolgreich installiert');
});

// --- Profil Modal --- (wird von auth.js übernommen: openProfileEdit / saveProfileEdit)

// --- Board Meta Modal (mit Mitgliederverwaltung) ---
window.openBoardMetaModal = (boardId, currentName, currentGroup) => {
  document.getElementById('edit-board-id').value = boardId;
  document.getElementById('edit-board-name').value = currentName || '';
  document.getElementById('edit-board-group').value = currentGroup || 'default';
  
  const errorDiv = document.getElementById('board-edit-error');
  if (errorDiv) errorDiv.textContent = '';

  // Mitglieder-Liste rendern
  renderMemberList();

  document.getElementById('modal-edit-board-meta').style.display = 'block';
};

window.renderMemberList = function() {
  const container = document.getElementById('board-members-list');
  if (!container) return;
  const members = S.currentBoard?.members || [];
  const wipLimit = Math.max(2, Math.ceil(members.length * 1.5));
  container.innerHTML = `
    <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px;">
      ${members.length} Mitglied${members.length !== 1 ? 'er' : ''} · WIP-Limit: <strong style="color:var(--accent);">${wipLimit}</strong>
    </div>
    ${members.map((m, i) => `
      <div style="display:flex; align-items:center; gap:8px; padding:4px 0;">
        <div class="assignee-avatar" style="width:22px; height:22px; font-size:9px;">${m.slice(0,2).toUpperCase()}</div>
        <span style="flex:1; font-size:12px;">${escapeHtml(m)}</span>
        <button class="btn-sm btn-sm-ghost" style="padding:2px 6px; font-size:10px; color:var(--danger);" onclick="removeBoardMember(${i})" title="Entfernen">✕</button>
      </div>
    `).join('')}
    <div style="display:flex; gap:6px; margin-top:8px;">
      <input type="text" id="new-member-name" class="settings-input" placeholder="Neues Mitglied..." style="flex:1; font-size:12px; padding:4px 8px;" onkeydown="if(event.key==='Enter') addBoardMember()"/>
      <button class="btn-sm btn-sm-primary" style="padding:4px 10px; font-size:11px;" onclick="addBoardMember()">＋</button>
    </div>
  `;
};

window.addBoardMember = () => {
  const input = document.getElementById('new-member-name');
  const name = input?.value.trim();
  if (!name) return;
  if (!S.currentBoard) return;
  const members = S.currentBoard.members || [];
  if (members.includes(name)) { showToast('Dieses Mitglied existiert bereits.', 'error'); return; }
  members.push(name);
  const wipLimit = Math.max(2, Math.ceil(members.length * 1.5));
  updateBoard(S.currentBoard.id, { members, wipLimit });
  S.currentBoard.members = members;
  S.currentBoard.wipLimit = wipLimit;
  updateWipForBoard(wipLimit);
  input.value = '';
  renderMemberList();
  showToast(`${name} hinzugefügt (WIP: ${wipLimit})`);
};

window.removeBoardMember = async (index) => {
  if (!S.currentBoard) return;
  const members = S.currentBoard.members || [];
  const removed = members[index];
  if (!await showConfirm(`${removed} aus dem Team entfernen?\n\nBereits benotete Karten bleiben erhalten.`, 'Entfernen', 'Abbrechen')) return;
  members.splice(index, 1);
  const wipLimit = Math.max(2, Math.ceil(members.length * 1.5));
  updateBoard(S.currentBoard.id, { members, wipLimit });
  S.currentBoard.members = members;
  S.currentBoard.wipLimit = wipLimit;
  updateWipForBoard(wipLimit);
  renderMemberList();
  showToast(`${removed} entfernt (WIP: ${wipLimit})`);
};

// WIP-Limit der In-Bearbeitung-Spalte anpassen
function updateWipForBoard(newLimit) {
  for (const col of S.columns) {
    const name = (col.name||'').toLowerCase();
    if (name.includes('bearbeitung') || name.includes('progress') || name.includes('doing')) {
      updateColumn(S.currentBoard.id, col.id, { wipLimit: newLimit });
    }
  }
}

window.saveBoardMeta = () => {
  const boardId = document.getElementById('edit-board-id').value;
  const newName = document.getElementById('edit-board-name').value.trim();
  const newGroup = document.getElementById('edit-board-group').value.trim();
  const errorDiv = document.getElementById('board-edit-error');

  if (!newName || !newGroup) {
    if (errorDiv) errorDiv.textContent = "Bitte alle Felder ausfüllen.";
    return;
  }

  updateBoard(boardId, { name: newName, groupId: newGroup });

  if (S.currentBoard && S.currentBoard.id === boardId) {
    S.currentBoard.name = newName;
    S.currentBoard.groupId = newGroup;

    const display = document.getElementById('board-title-display');
    if (display) {
      display.innerHTML = escapeHtml(newName) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
      if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
    }
  }

  if (typeof loadBoards === 'function') loadBoards();
  if (typeof closeModal === 'function') closeModal('modal-edit-board-meta');
  if (typeof showToast === 'function') showToast('Board-Einstellungen gespeichert!');
};

// --- Superadmin Logik ---
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

  console.log(`[System] Schalter geklickt. Neuer Status: ${isActive ? 'SUPERADMIN' : 'LEHRER'}`);
  if (typeof loadAdminData === 'function') {
    const userGroup = window.currentUserGroup || localStorage.getItem('userGroup') || '';
    loadAdminData(isActive, userGroup);
  }
};

window.toggleInviteBox = () => {
  const box = document.getElementById('admin-invite-box');
  const field = document.getElementById('admin-invite-url-field');
  if (!box || !field) return;

  if (box.style.display === 'none') {
    const labelText = document.getElementById('admin-current-group-label')?.textContent || '';
    const groupName = labelText.includes(': ') ? labelText.split(': ')[1].trim() : (window.currentUserGroup || 'default');

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
  if (field && navigator.clipboard) {
    navigator.clipboard.writeText(field.value)
      .then(() => { if (typeof showToast === 'function') showToast('Einladungs-Link kopiert! 📋'); })
      .catch(err => console.error("Kopieren fehlgeschlagen", err));
  }
};
