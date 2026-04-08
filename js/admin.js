// js/admin.js — Admin-Panel (lokal, vereinfacht ohne Firebase/Nutzerverwaltung)
import { S, getBoards, getColumns, getCards, updateBoard, deleteBoard,
  deleteColumn, deleteCard } from './state.js';

// ── ADMIN CHECK ───────────────────────────────────────
// Lokal: immer Admin
window.currentUserIsAdmin = async function() { return true; };

// ── ADMIN ÖFFNEN ──────────────────────────────────────
window.openAdminArea = async () => {
  S.isAdminMode = true;
  const panel = document.getElementById('admin-panel');
  if (panel) panel.style.display = 'block';
  loadAdminBoardList();
  if (typeof showAdminTab === 'function') showAdminTab('group');
};

window.openAdminPanel = () => openAdminArea();
window.closeAdminPanel = () => { document.getElementById('admin-panel').style.display = 'none'; };

// ── ADMIN TABS ────────────────────────────────────────
window.showAdminTab = (tabId) => {
  const tabs = ['group', 'boardtools'];
  tabs.forEach(t => {
    const panel = document.getElementById('admin-tab-' + t);
    const btn   = document.getElementById('admin-tab-' + t + '-btn');
    if (panel) panel.style.display = (t === tabId) ? 'block' : 'none';
    if (btn)   btn.className = (t === tabId) ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  });
  if (tabId === 'group') loadAdminBoardList();
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── BOARDS LADEN (LOKALE ÜBERSICHT) ───────────────────
function loadAdminBoardList() {
  const container = document.getElementById('admin-group-boards-list');
  if (!container) return;
  const boards = getBoards();
  if (!boards.length) {
    container.innerHTML = '<div style="padding:20px; opacity:0.5;">Keine Boards vorhanden.</div>';
    return;
  }
  const boardMap = {};
  boards.forEach(b => {
    const key = b.ownerName || 'Meine Boards';
    if (!boardMap[key]) boardMap[key] = [];
    boardMap[key].push(b);
  });
  renderAdminBoardMap(boardMap, container);
  const groupTitle = document.getElementById('admin-current-group-label');
  if (groupTitle) groupTitle.textContent = 'Alle lokalen Boards';
}

function renderAdminBoardMap(boardMap, container) {
  container.innerHTML = '';
  Object.keys(boardMap).sort().forEach(name => {
    const boards = boardMap[name];
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:15px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:12px;';
    div.innerHTML = `
      <div style="font-weight:700; font-size:14px; color:var(--primary); margin-bottom:10px; display:flex; justify-content:space-between;">
        <span>${escHtml(name)}</span>
        <span style="font-size:10px; opacity:0.5;">${boards.length} Board${boards.length!==1?'s':''}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${boards.map(b => `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--surface2); border-radius:6px;">
            <div style="flex:1; cursor:pointer; font-size:13px;" onclick="adminViewBoard('${b.id}')">🗂️ ${escHtml(b.name)}</div>
            <div style="cursor:pointer; padding:4px 8px; border-left:1px solid var(--border); opacity:0.6;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" onclick="openBoardToolbox('${b.id}', '${escHtml(b.name.replace(/'/g, "\\'"))}', '${escHtml(name.replace(/'/g, "\\'"))}')" title="Einstellungen"><i data-lucide="wrench" style="width:14px;"></i></div>
          </div>
        `).join('')}
      </div>`;
    container.appendChild(div);
  });
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
}

// ── BOARD IN DER APP ANSEHEN ──────────────────────────
window.adminViewBoard = (boardId) => {
  closeAdminPanel();
  const boards = getBoards();
  const board  = boards.find(b => b.id === boardId);
  if (!board) { showToast('Board nicht gefunden', 'error'); return; }
  S.currentBoard = board;
  S.boards = boards;
  renderBoardsList();
  loadColumns();
  document.getElementById('empty-state').style.display  = 'none';
  document.getElementById('board-content').style.display = 'block';
  document.getElementById('board-title-display').innerHTML = escHtml(board.name) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
  setTimeout(reloadIcons, 50);
  showToast('Board wird angezeigt');
};

// ── BOARD TOOLBOX (Aging, Deadline) ───────────────────
window.openBoardToolbox = (boardId, boardName, userName) => {
  const boards  = getBoards();
  const board   = boards.find(b => b.id === boardId);
  if (!board) return;

  const aging    = board.agingDays || 5;
  const deadline = board.deadline  || '';

  const modal = document.getElementById('modal-board-toolbox') || createToolboxModal();
  document.getElementById('toolbox-board-name').textContent = boardName;
  document.getElementById('toolbox-aging-input').value      = aging;
  document.getElementById('toolbox-deadline-input').value   = deadline;
  document.getElementById('toolbox-board-id').value         = boardId;
  modal.style.display = 'flex';
};

function createToolboxModal() {
  const modal = document.createElement('div');
  modal.id    = 'modal-board-toolbox';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <span id="toolbox-board-name" style="font-weight:700;"></span>
        <button class="modal-close-btn" onclick="closeModal('modal-board-toolbox')">✕</button>
      </div>
      <input type="hidden" id="toolbox-board-id"/>
      <div style="display:flex; flex-direction:column; gap:16px; padding:16px 0;">
        <div>
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Aging-Limit (Tage)</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="number" id="toolbox-aging-input" min="1" max="999" style="width:70px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:6px 8px; color:var(--text); font-size:13px;"/>
            <button class="btn-sm btn-sm-primary" onclick="saveAgingLimitToolbox()">Speichern</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Abgabetermin</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="date" id="toolbox-deadline-input" style="flex:1; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:6px 8px; color:var(--text); font-size:13px;"/>
            <button class="btn-sm btn-sm-primary" onclick="saveDeadlineToolbox()">Speichern</button>
            <button class="btn-sm btn-sm-ghost" onclick="document.getElementById('toolbox-deadline-input').value=''; saveDeadlineToolbox()">✕</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Noten</label>
          <div id="toolbox-grades-list"></div>
          <button class="btn-sm btn-sm-ghost" onclick="loadToolboxGrades()" style="width:100%; margin-top:6px;">Noten laden</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

window.saveAgingLimitToolbox = () => {
  const boardId = document.getElementById('toolbox-board-id').value;
  const val     = parseInt(document.getElementById('toolbox-aging-input').value) || 5;
  updateBoard(boardId, { agingDays: val });
  if (S.currentBoard?.id === boardId) S.currentBoard.agingDays = val;
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

window.saveDeadlineToolbox = () => {
  const boardId = document.getElementById('toolbox-board-id').value;
  const inputId = 'toolbox-deadline-input';
  saveDeadline(boardId, inputId);
};

// ── NOTEN (lokal in localStorage) ────────────────────
const GRADES_KEY = 'kanban_grades';

function getGrades(boardId) {
  try { return JSON.parse(localStorage.getItem(GRADES_KEY) || '{}')[boardId] || {}; } catch(e) { return {}; }
}

function saveGrades(boardId, grades) {
  const all = JSON.parse(localStorage.getItem(GRADES_KEY) || '{}');
  all[boardId] = grades;
  localStorage.setItem(GRADES_KEY, JSON.stringify(all));
}

window.loadToolboxGrades = () => {
  const boardId = document.getElementById('toolbox-board-id').value;
  const boards  = getBoards();
  const board   = boards.find(b => b.id === boardId);
  if (!board) return;
  const members  = board.members || [];
  const existing = getGrades(boardId);
  const list     = document.getElementById('toolbox-grades-list');
  if (!members.length) { list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Keine Mitglieder.</div>'; return; }
  list.innerHTML = members.map(member => {
    const g = existing[member] || {};
    const safeId = member.replace(/[^a-zA-Z0-9]/g, '_');
    return `<div style="margin-bottom:8px; background:var(--surface2); border-radius:8px; padding:10px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <div class="assignee-avatar">${member.slice(0,2).toUpperCase()}</div>
        <span style="font-weight:600; flex:1;">${escHtml(member)}</span>
        <select class="grade-select" id="grade-val-${safeId}" style="width:60px;">
          <option value="">–</option>${[1,2,3,4,5,6].map(n => `<option value="${n}" ${(g.grade||'')==n?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <textarea id="grade-comment-${safeId}" placeholder="Kommentar…" rows="2" style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-size:12px;box-sizing:border-box;">${escHtml(g.comment||'')}</textarea>
      <button class="btn-sm btn-sm-primary" style="margin-top:6px;width:100%;" onclick="saveGradeLocal('${boardId}','${safeId}','${escHtml(member)}')">💾 Speichern</button>
    </div>`;
  }).join('');
};

window.saveGradeLocal = (boardId, safeId, member) => {
  const grade   = document.getElementById(`grade-val-${safeId}`)?.value || '';
  const comment = document.getElementById(`grade-comment-${safeId}`)?.value.trim() || '';
  const grades  = getGrades(boardId);
  grades[member] = { grade, comment, updatedAt: new Date().toISOString() };
  saveGrades(boardId, grades);
  showToast(`Note für ${member} gespeichert!`);
};

// ── AGING SPEICHERN (Alias für tools.js Kompatibilität) ─
window.saveAgingLimit = (boardId) => {
  const val = parseInt(document.getElementById('aging-' + boardId)?.value) || 5;
  updateBoard(boardId, { agingDays: val });
  if (S.currentBoard?.id === boardId) S.currentBoard.agingDays = val;
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

// ── BOARD META MODAL ──────────────────────────────────
window.openBoardMetaModal = (boardId, boardName, groupId) => {
  const modal = document.getElementById('modal-board-meta');
  if (!modal) return;
  document.getElementById('board-meta-id').value    = boardId;
  document.getElementById('board-meta-name').value  = boardName || '';
  document.getElementById('board-meta-group').value = groupId || '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('board-meta-name').focus(), 100);
};

window.saveBoardMeta = () => {
  const boardId = document.getElementById('board-meta-id').value;
  const name    = document.getElementById('board-meta-name').value.trim();
  const groupId = document.getElementById('board-meta-group')?.value.trim() || '';
  if (!name) return;
  updateBoard(boardId, { name, groupId });
  if (S.currentBoard?.id === boardId) { S.currentBoard.name = name; S.currentBoard.groupId = groupId; }
  S.boards = getBoards();
  renderBoardsList();
  document.getElementById('board-title-display').innerHTML = escHtml(name) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
  setTimeout(reloadIcons, 50);
  closeModal('modal-board-meta');
  showToast('Board gespeichert');
};
