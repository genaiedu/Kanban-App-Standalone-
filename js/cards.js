// js/cards.js — Karten-Management, Drag & Drop, Aging, Undo (lokal, kein Firebase)
import { S, getCards, createCard, updateCard, deleteCard, moveCard,
  replaceCards, updateBoard, getBoards } from './state.js';

// ── UNDO-SYSTEM ──────────────────────────────────────
const MAX_UNDO = 6;

window.pushUndo = function(label) {
  if (!S.currentBoard) return;
  if (!S.undoStack) S.undoStack = [];
  const snapshot = { label, boardId: S.currentBoard.id, timestamp: Date.now(), columns: {} };
  for (const col of S.columns) {
    snapshot.columns[col.id] = (S.cards[col.id] || []).map(c => ({ 
      ...c, 
      dependencies: c.dependencies ? [...c.dependencies] : [], 
      comments: c.comments ? [...c.comments] : [] 
    }));
  }
  S.undoStack.push(snapshot);
  if (S.undoStack.length > MAX_UNDO) S.undoStack.shift();
  if (typeof window.updateUndoButton === 'function') window.updateUndoButton();
};

window.updateUndoButton = function() {
  const btn = document.getElementById('btn-undo');
  if (!btn) return;
  if (!S.undoStack) S.undoStack = [];
  const count = S.undoStack.length;
  if (count > 0) {
    btn.classList.add('undo-active');
    btn.title = `Rückgängig (${count}/${MAX_UNDO}): ${S.undoStack[count - 1].label}`;
  } else {
    btn.classList.remove('undo-active');
    btn.title = 'Nichts zum Rückgängigmachen';
  }
};

window.undoLastAction = async () => {
  if (!S.undoStack || !S.undoStack.length || !S.currentBoard) {
    showToast('Nichts zum Rückgängigmachen.', 'error'); return;
  }
  const snapshot = S.undoStack.pop();
  if (snapshot.boardId !== S.currentBoard.id) {
    showToast('Undo nur für das aktuelle Board möglich.', 'error');
    S.undoStack.push(snapshot); return;
  }
  if (!await showConfirm(`„${snapshot.label}" rückgängig machen?`, 'Rückgängig', 'Abbrechen')) {
    S.undoStack.push(snapshot); return;
  }
  showToast('⏳ Wird wiederhergestellt…');
  try {
    for (const col of S.columns) {
      const savedCards = snapshot.columns[col.id] || [];
      replaceCards(S.currentBoard.id, col.id, savedCards);
    }
    loadAllCards();
    showToast(`✅ „${snapshot.label}" rückgängig gemacht`);
  } catch (e) {
    showToast('Fehler beim Wiederherstellen: ' + e.message, 'error');
  }
  window.updateUndoButton();
};

// ── KARTEN LADEN ─────────────────────────────────────
window.loadCards = function(colId) {
  if (!S.cards) S.cards = {};
  S.cards[colId] = getCards(S.currentBoard.id, colId);
  window.renderCards(colId);
  S.columns.forEach(c => {
    if (c.id !== colId && document.getElementById('cards-' + c.id)) window.renderCards(c.id);
  });
};

function loadAllCards() {
  S.columns.forEach(col => window.loadCards(col.id));
}

// Für Snapshot-Wiederherstellung exportieren
window.loadAllCards = loadAllCards;

// ── EFFEKTIVE AGING-ZEIT ──────────────────────────────
function getEffectiveAgingMs(card) {
  if (!card.startedAt) return 0;
  const elapsed = Date.now() - new Date(card.startedAt).getTime();
  const board = S.currentBoard;
  if (!board) return elapsed;
  const totalPaused = board.totalPausedMs || 0;
  const currentPauseMs = (board.agingPaused && board.agingPausedAt)
    ? (Date.now() - new Date(board.agingPausedAt).getTime()) : 0;
  return Math.max(0, elapsed - totalPaused - currentPauseMs);
}

function isAgingCard(card, colId) {
  const col = S.columns.find(c => c.id === colId);
  if (!col) return false;
  const colName = (col.name||'').toLowerCase();
  const isInProgress = colName.includes('bearbeitung') || colName.includes('progress') || colName.includes('doing');
  if (!isInProgress || !card.startedAt) return false;
  const limit = S.currentBoard?.agingDays || 5;
  return getEffectiveAgingMs(card) / 86400000 >= limit;
}

function getAgingDays(card) {
  if (!card.startedAt) return 0;
  const val = Math.floor(getEffectiveAgingMs(card) / 86400000);
  return `${val} ${val === 1 ? 'Tag' : 'Tagen'}`;
}

function getDueClass(due) {
  if (!due) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(due);
  const diff = Math.ceil((d - today) / 86400000);
  if (diff < 0) return 'due-overdue';
  if (diff <= 2) return 'due-soon';
  return 'due-ok';
}

// ── ABHÄNGIGKEITS-PRÜFUNG ─────────────────────────────
window.getDependencyStatus = function(card) {
  if (!card.dependencies || card.dependencies.length === 0) return { has: false, allMet: true, details: [] };
  let allMet = true;
  const details = [];
  for (const depLabel of card.dependencies) {
    let foundCard = null; let isDone = false;
    for (const col of S.columns) {
      const c = (S.cards[col.id] || []).find(x => x.label === depLabel);
      if (c) {
        foundCard = c;
        const finished = window.isFinishedColumn ? window.isFinishedColumn(col) : false;
        const isVoraussetzung = (col.name || '').toLowerCase().includes('voraussetzung');
        isDone = finished || isVoraussetzung;
        break;
      }
    }
    if (!foundCard || !isDone) allMet = false;
    details.push({ label: depLabel, met: isDone, text: foundCard ? foundCard.text : 'Gelöschte Karte' });
  }
  return { has: true, allMet, details };
};

// ── ABHÄNGIGKEITEN MODAL ──────────────────────────────
window.openDependencies = (cardId, colId) => {
  document.getElementById('dep-card-id').value = cardId;
  document.getElementById('dep-col-id').value = colId;
  window.renderDependenciesList();
  document.getElementById('modal-dependencies').style.display = 'flex';
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.renderDependenciesList = () => {
  const cardId = document.getElementById('dep-card-id').value;
  const colId  = document.getElementById('dep-col-id').value;
  const card = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  const status = window.getDependencyStatus(card);
  const listEl = document.getElementById('dependencies-list');
  if (status.details.length === 0) {
    listEl.innerHTML = '<div style="font-size:13px; color:var(--text-muted); text-align:center; padding:10px 0;">Keine Voraussetzungen definiert.</div>';
  } else {
    listEl.innerHTML = status.details.map(d => `
      <div style="display:flex; align-items:center; justify-content:space-between; background:var(--surface2); padding:8px 12px; border-radius:8px; border:1px solid ${d.met ? 'rgba(16,185,129,0.4)' : 'rgba(240,82,82,0.4)'};">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:10px; height:10px; border-radius:50%; background:${d.met ? '#10b981' : '#f87171'}; flex-shrink:0;"></div>
          <strong style="color:var(--text); font-size:14px;">[${d.label}]</strong>
          <span style="font-size:12px; color:var(--text-muted);">${typeof escHtml === 'function' ? escHtml(d.text) : d.text}</span>
        </div>
        <button class="card-btn delete" onclick="window.removeDependency('${d.label}')" title="Entfernen"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
      </div>
    `).join('');
  }
  const selectEl = document.getElementById('new-dependency-select');
  let options = '<option value="">-- Voraussetzung wählen --</option>';
  for (const col of S.columns || []) {
    for (const c of (S.cards[col.id] || [])) {
      if (c.id !== cardId && c.label && !(card.dependencies||[]).includes(c.label)) {
        options += `<option value="${c.label}">[${c.label}] ${typeof escHtml === 'function' ? escHtml(c.text).slice(0,40) : c.text.slice(0,40)}…</option>`;
      }
    }
  }
  selectEl.innerHTML = options;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.addDependency = () => {
  const cardId = document.getElementById('dep-card-id').value;
  const colId  = document.getElementById('dep-col-id').value;
  const label  = document.getElementById('new-dependency-select').value;
  if (!label) return;
  const card = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  window.pushUndo('Voraussetzung hinzugefügt');
  const deps = [...(card.dependencies || [])];
  if (!deps.includes(label)) deps.push(label);
  updateCard(S.currentBoard.id, colId, cardId, { dependencies: deps });
  window.loadCards(colId);
  window.renderDependenciesList();
};

window.removeDependency = (label) => {
  const cardId = document.getElementById('dep-card-id').value;
  const colId  = document.getElementById('dep-col-id').value;
  const card = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  window.pushUndo('Voraussetzung entfernt');
  const deps = (card.dependencies || []).filter(l => l !== label);
  updateCard(S.currentBoard.id, colId, cardId, { dependencies: deps });
  window.loadCards(colId);
  window.renderDependenciesList();
};

// ── KARTEN ANZEIGEN ──────────────────────────────────
window.renderCards = function(colId) {
  const list = document.getElementById('cards-' + colId);
  if (!list) return;
  const colCards = S.cards[colId] || [];
  const count = document.getElementById('count-' + colId);
  if (count) count.textContent = colCards.length;
  const colIdx = S.columns.findIndex(c => c.id === colId);
  const isFirstCol = colIdx === 0;
  const isLastCol  = colIdx === S.columns.length - 1;
  const colObj = S.columns.find(c => c.id === colId);

  if (colObj) {
    const colEl = document.getElementById('col-' + colId);
    if (colEl) {
      colEl.classList.remove('wip-warning','wip-exceeded');
      const wip = window.getWipStatus ? window.getWipStatus({...colObj, id: colId}) : {colCls:''};
      if (wip.colCls) colEl.classList.add(wip.colCls);
      const badge = colEl.querySelector('.wip-badge');
      if (badge) badge.textContent = wip.badge;
    }
  }

  const isFinished = colObj && window.isFinishedColumn ? window.isFinishedColumn(colObj) : false;
  const isVoraussetzungen = colObj && (colObj.name || '').toLowerCase().includes('voraussetzung');
  const isLockedCol = isFinished || isVoraussetzungen;

  list.innerHTML = colCards.map((card, cardIdx) => {
    const dueClass = getDueClass(card.due);
    const safeFormatDate = (typeof formatDate === 'function') ? formatDate : (d => d);
    const safeEscHtml    = (typeof escHtml   === 'function') ? escHtml   : (t => t);
    const safeLinkify    = (typeof linkify   === 'function') ? linkify   : (t => t);

    const dueLabel   = card.due ? `<span class="card-due ${dueClass}">📅 ${safeFormatDate(card.due)}</span>` : '';
    const myCard     = card.assignee && S.currentUser && (card.assignee === S.currentUser.displayName);
    const aging      = isAgingCard(card, colId);
    const agingDays  = getAgingDays(card);
    const agingHtml  = aging ? `<div class="aging-badge"><i data-lucide="clock" style="width:11px;height:11px;margin-right:4px;"></i> Seit ${agingDays} in Bearbeitung</div>` : '';
    const assigneeHtml = card.assignee ? `<div class="card-assignee"><div class="assignee-avatar">${card.assignee.slice(0,2).toUpperCase()}</div><span>${safeEscHtml(card.assignee)}</span></div>` : '';
    
    // Zeitelemente wie im Original (Start/Ende)
    const tsHtml     = (card.startedAt || card.finishedAt) ? `<div class="card-timestamps">${card.startedAt ? `<span class="ts-item">▶ ${safeFormatDate(card.startedAt)}</span>` : ''}${card.finishedAt ? `<span class="ts-item">✓ ${safeFormatDate(card.finishedAt)}</span>` : ''}</div>` : '';
    
    const agingClass = aging ? 'aging-warn' : '';
    const labelHtml  = card.label ? `<div class="card-label">${card.label}</div>` : '';

    const isLinkedPrev = cardIdx > 0 && card.groupId && colCards[cardIdx - 1].groupId === card.groupId;
    const isLinkedNext = cardIdx < colCards.length - 1 && card.groupId && colCards[cardIdx + 1].groupId === card.groupId;
    let groupClasses = '';
    if (card.groupId) {
      if (isLinkedNext && !isLinkedPrev) groupClasses = 'group-top';
      else if (isLinkedNext && isLinkedPrev) groupClasses = 'group-middle';
      else if (!isLinkedNext && isLinkedPrev) groupClasses = 'group-bottom';
    }

    const depStatus = window.getDependencyStatus(card);
    let depHtml = '';
    if (depStatus.has) {
      const cl = depStatus.allMet ? 'met' : 'unmet';
      depHtml = `<button class="comment-flag dep-flag ${cl}" onclick="event.stopPropagation(); window.openDependencies('${card.id}', '${colId}')" title="Voraussetzungen"><i data-lucide="link" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
    } else {
      depHtml = `<button class="comment-flag empty-flag" onclick="event.stopPropagation(); window.openDependencies('${card.id}', '${colId}')" title="Voraussetzung hinzufügen"><i data-lucide="link" style="width:12px;height:12px;pointer-events:none;opacity:0.6;"></i></button>`;
    }

    const allComments   = card.comments || [];
    const teacherCount  = allComments.filter(c => c.role === 'teacher').length;
    const studentCount  = allComments.filter(c => c.role !== 'teacher').length;
    let flagsHtml = '<div class="card-flags">' + depHtml;
    if (allComments.length === 0) {
      flagsHtml += `<button class="comment-flag empty-flag" onclick="event.stopPropagation(); window.openComments('${card.id}', '${colId}')" title="Kommentar hinzufügen"><i data-lucide="message-square-plus" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
    } else {
      if (teacherCount > 0) flagsHtml += `<button class="comment-flag teacher-flag" onclick="event.stopPropagation(); window.openComments('${card.id}', '${colId}')" title="Tutor-Feedback">${teacherCount} <i data-lucide="graduation-cap" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
      if (studentCount > 0) flagsHtml += `<button class="comment-flag student-flag" onclick="event.stopPropagation(); window.openComments('${card.id}', '${colId}')" title="Kommentare">${studentCount} <i data-lucide="message-square" style="width:12px;height:12px;pointer-events:none;"></i></button>`;
    }
    flagsHtml += '</div>';

    const isFirstCard = cardIdx === 0;
    const isLastCard  = cardIdx === colCards.length - 1;
    const btnUp    = (!isFirstCard && !isLockedCol) ? `<button class="card-btn" onclick="event.stopPropagation(); window.moveCardVertical('${card.id}', '${colId}', -1)" title="Nach oben"><i data-lucide="chevron-up" style="width:14px;height:14px;pointer-events:none;"></i></button>` : '';
    const btnDown  = (!isLastCard  && !isLockedCol) ? `<button class="card-btn" onclick="event.stopPropagation(); window.moveCardVertical('${card.id}', '${colId}', 1)" title="Nach unten"><i data-lucide="chevron-down" style="width:14px;height:14px;pointer-events:none;"></i></button>` : '';
    const btnLeft  = (!isFirstCol  && !isLockedCol) ? `<button class="card-btn" onclick="event.stopPropagation(); window.moveCardStep('${card.id}', '${colId}', -1)" title="Nach links"><i data-lucide="chevron-left" style="width:14px;height:14px;pointer-events:none;"></i></button>` : '';
    const btnRight = (!isLastCol   && !isLockedCol) ? `<button class="card-btn" onclick="event.stopPropagation(); window.moveCardStep('${card.id}', '${colId}', 1)" title="Nach rechts"><i data-lucide="chevron-right" style="width:14px;height:14px;pointer-events:none;"></i></button>` : '';
    const canLink  = colCards[cardIdx + 1] && (!card.groupId || card.groupId !== colCards[cardIdx + 1].groupId);
    const linkBtn  = (canLink && !isLockedCol) ? `<button class="card-btn" onclick="event.stopPropagation(); window.toggleLink('${card.id}', '${colId}')" title="Mit nächster verketten"><i data-lucide="link-2" style="width:14px;height:14px;color:var(--accent);"></i></button>` : '';
    const unlinkBtn = (card.groupId && !isLockedCol) ? `<button class="card-btn" onclick="event.stopPropagation(); window.unlinkCard('${card.id}', '${colId}')" title="Verkettung lösen"><i data-lucide="unlink" style="width:14px;height:14px;color:#f87171;"></i></button>` : '';

    const separator = (!isLockedCol) ? `<span style="width:1px; height:14px; background:var(--border); opacity:0.3; margin:0 2px;"></span>` : '';
    const actionGroups = [];
    if (btnUp || btnDown) actionGroups.push(btnUp + btnDown);
    if (linkBtn || unlinkBtn) actionGroups.push(linkBtn + unlinkBtn);
    if (btnLeft || btnRight) actionGroups.push(btnLeft + btnRight);
    const bottomActionsHtml = actionGroups.join(separator);

    const lockHtml   = isFinished ? '<span style="font-size:10px; color:var(--text-muted); opacity:0.6; display:flex; align-items:center; gap:3px;"><i data-lucide="lock" style="width:10px;height:10px;pointer-events:none;"></i></span>' : '';
    const deleteBtn  = isFinished ? '' : `<button class="card-btn delete" onclick="event.stopPropagation(); window.deleteCardLocal('${card.id}','${colId}')" title="Löschen"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>`;
    
    // ZURÜCK AUF window.openEditCard
    const editBtn    = `<button class="card-btn" onclick="event.stopPropagation(); window.openEditCard('${card.id}','${colId}')" title="Bearbeiten"><i data-lucide="edit-2" style="width:12px;height:12px;"></i></button>`;

    // Beschreibung rendern (anklickbar)
    const descHtml = card.description 
      ? `<div class="card-description" onclick="event.stopPropagation(); window.openEditCard('${card.id}','${colId}')" style="cursor:pointer; font-size: 0.9em; color: var(--text-muted); margin-top: 6px; border-left: 2px solid var(--border); padding-left: 8px;">
          ${safeLinkify(safeEscHtml(card.description))}
         </div>` 
      : '';

    return `
    <div class="card ${myCard?'my-card':''} ${agingClass} ${groupClasses}" id="card-${card.id}" ${isLockedCol ? '' : `draggable="true" ondragstart="window.onDragStart(event,'${card.id}','${colId}')" ondragend="window.onDragEnd(event)"`} ondblclick="window.openEditCard('${card.id}','${colId}')">
      ${flagsHtml}
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-top:14px; margin-bottom:6px; min-height:20px;">
        <div style="flex:1;">${labelHtml}</div>
        <div style="display:flex; gap:6px; flex-shrink:0;">${editBtn}${deleteBtn}</div>
      </div>
      <div class="card-text">${safeLinkify(safeEscHtml(card.text))}</div>
      
      ${descHtml}
      
      ${assigneeHtml}${agingHtml}${tsHtml}
      <div class="card-footer">
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${card.priority ? `<span class="card-priority priority-${card.priority}">${card.priority.toUpperCase()}</span>` : ''}
          ${dueLabel}${lockHtml}
        </div>
        <div class="card-actions">${bottomActionsHtml}</div>
      </div>
    </div>`;
  }).join('');

  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── GRUPPEN-LOGIK ─────────────────────────────────────
window.toggleLink = (cardId, colId) => {
  const cards = S.cards[colId] || [];
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx < 0 || idx >= cards.length - 1) return;
  const cardA = cards[idx]; const cardB = cards[idx + 1];
  const groupId = cardA.groupId || cardB.groupId || 'grp_' + Date.now();
  updateCard(S.currentBoard.id, colId, cardA.id, { groupId });
  updateCard(S.currentBoard.id, colId, cardB.id, { groupId });
  window.loadCards(colId);
};

window.unlinkCard = (cardId, colId) => {
  updateCard(S.currentBoard.id, colId, cardId, { groupId: null });
  window.loadCards(colId);
};

// ── VERTIKALES UMSORTIEREN ────────────────────────────
window.moveCardVertical = (cardId, colId, direction) => {
  let cards = [...(S.cards[colId] || [])];
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx < 0) return;
  const card = cards[idx];
  const groupIds = card.groupId ? cards.filter(c => c.groupId === card.groupId).map(c => c.id) : [card.id];
  const firstIdx = cards.findIndex(c => groupIds.includes(c.id));
  const lastIdx  = cards.findLastIndex(c => groupIds.includes(c.id));

  if (direction === -1 && firstIdx > 0) {
    const prevCard = cards[firstIdx - 1];
    const prevGroupIds = prevCard.groupId ? cards.filter(c => c.groupId === prevCard.groupId).map(c => c.id) : [prevCard.id];
    const prevFirstIdx = cards.findIndex(c => prevGroupIds.includes(c.id));
    const blockA = cards.splice(firstIdx, lastIdx - firstIdx + 1);
    const blockB = cards.splice(prevFirstIdx, prevGroupIds.length);
    cards.splice(prevFirstIdx, 0, ...blockA, ...blockB);
  } else if (direction === 1 && lastIdx < cards.length - 1) {
    const nextCard = cards[lastIdx + 1];
    const nextGroupIds = nextCard.groupId ? cards.filter(c => c.groupId === nextCard.groupId).map(c => c.id) : [nextCard.id];
    const blockB = cards.splice(lastIdx + 1, nextGroupIds.length);
    const blockA = cards.splice(firstIdx, lastIdx - firstIdx + 1);
    cards.splice(firstIdx, 0, ...blockB, ...blockA);
  } else { return; }

  cards.forEach((c, i) => { c.order = i; });
  replaceCards(S.currentBoard.id, colId, cards);
  window.loadCards(colId);
};

// ── KARTEN VERSCHIEBEN ────────────────────────────────
window.moveCardStep = async (cardId, fromColId, direction) => {
  const fromColIdx = S.columns.findIndex(c => c.id === fromColId);
  const fromColObj = S.columns[fromColIdx];
  if (fromColObj && window.isFinishedColumn && window.isFinishedColumn(fromColObj)) {
    showToast('🔒 Karten in der Fertig-Spalte können nicht mehr verschoben werden.', 'error'); return;
  }
  const toColIdx = fromColIdx + direction;
  if (toColIdx < 0 || toColIdx >= S.columns.length) return;
  const srcCard = (S.cards[fromColId]||[]).find(c => c.id === cardId);
  if (!srcCard) return;

  const depStatus = window.getDependencyStatus(srcCard);
  if (depStatus.has && !depStatus.allMet && direction > 0) {
    showToast('⛔ Voraussetzungen (rote Kette) noch nicht erfüllt!', 'error'); return;
  }

  const toCol = S.columns[toColIdx];
  const cardsToMove = srcCard.groupId ? (S.cards[fromColId]||[]).filter(c => c.groupId === srcCard.groupId) : [srcCard];

  if (toCol?.wipLimit && window.isFinishedColumn && !window.isFinishedColumn(toCol) && ((S.cards[toCol.id]||[]).length + cardsToMove.length) > toCol.wipLimit) {
    showToast('⚠️ WIP-Limit erreicht! Block ist zu groß.', 'error'); return;
  }

  const isNowFinished = window.isFinishedColumn ? window.isFinishedColumn(toCol) : false;
  if (isNowFinished) {
    if (!await window.showConfirm('Diese Karte(n) wird/werden in die Fertig-Spalte verschoben.\n\nDies kann nicht rückgängig gemacht werden.\n\nFortfahren?', 'Verschieben', 'Abbrechen')) return;
  }

  window.pushUndo('Karten verschoben');
  const now = new Date().toISOString();
  let orderBase = (S.cards[toCol.id]||[]).length;

  for (const c of cardsToMove) {
    const startedAt  = c.startedAt || (!window.isFinishedColumn(fromColObj||{}) ? now : '');
    const finishedAt = isNowFinished ? now : '';
    moveCard(S.currentBoard.id, fromColId, toCol.id, c.id, orderBase++);
    const movedCard = (getCards(S.currentBoard.id, toCol.id)).find(x => x.id === c.id);
    if (movedCard) {
      updateCard(S.currentBoard.id, toCol.id, c.id, { startedAt, finishedAt });
    }
  }

  window.loadCards(fromColId);
  window.loadCards(toCol.id);
  showToast(isNowFinished ? '✅ Erledigt! (Gesperrt)' : '↔ Verschoben');
};

// ── KARTEN CRUD ───────────────────────────────────────
window.showAddCard = (colId) => { 
  document.getElementById('add-form-' + colId).style.display = 'block'; 
  document.getElementById('card-text-' + colId).focus(); 
};
window.hideAddCard = (colId) => { 
  document.getElementById('add-form-' + colId).style.display = 'none'; 
  document.getElementById('card-text-' + colId).value = ''; 
};

window.addCard = (colId) => {
  const text = document.getElementById('card-text-' + colId).value.trim();
  const prio = document.getElementById('card-prio-' + colId).value;
  if (!text) return;
  window.pushUndo('Karte hinzugefügt: ' + text.slice(0, 30));

  const board = getBoards().find(b => b.id === S.currentBoard.id);
  const currentCounter = board?.cardCounter ?? 0;
  const cardLabel = typeof window.numberToLabel === 'function' ? window.numberToLabel(currentCounter) : `K${currentCounter}`;
  updateBoard(S.currentBoard.id, { cardCounter: currentCounter + 1 });
  S.currentBoard.cardCounter = currentCounter + 1;

  const colCards = S.cards[colId] || [];
  createCard(S.currentBoard.id, colId, { 
    text, priority: prio, order: colCards.length, 
    label: cardLabel, dependencies: [], comments: [] 
  });
  window.hideAddCard(colId);
  window.loadCards(colId);
  showToast('Karte hinzugefügt!');
};

window.deleteCardLocal = async (cardId, colId) => {
  const col = S.columns.find(c => c.id === colId);
  if (col && window.isFinishedColumn && window.isFinishedColumn(col)) {
    showToast('🔒 Fertige Karten können nicht gelöscht werden.', 'error'); return;
  }
  if (!await showConfirm('Möchtest du diese Aufgabe wirklich löschen?', 'Löschen', 'Abbrechen')) return;
  const card = (S.cards[colId]||[]).find(c => c.id === cardId);
  window.pushUndo('Karte gelöscht: ' + (card?.text||'').slice(0, 30));
  deleteCard(S.currentBoard.id, colId, cardId);
  window.loadCards(colId);
  showToast('Karte gelöscht');
};

window.deleteCard = window.deleteCardLocal;

window.openEditCard = (cardId, colId) => {
  const card = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  document.getElementById('edit-card-id').value  = cardId;
  document.getElementById('edit-card-col').value = colId;
  document.getElementById('edit-card-text').value     = card.text;
  
  const descField = document.getElementById('edit-card-description');
  if (descField) descField.value = card.description || '';

  const timeD = document.getElementById('edit-card-time-d');
  const timeH = document.getElementById('edit-card-time-h');
  const timeM = document.getElementById('edit-card-time-m');
  if (timeD) timeD.value = card.timeEstimate?.d || '';
  if (timeH) timeH.value = card.timeEstimate?.h || '';
  if (timeM) timeM.value = card.timeEstimate?.m || '';

  document.getElementById('edit-card-priority').value = card.priority || '';
  document.getElementById('edit-card-due').value      = card.due || '';
  const sel     = document.getElementById('edit-card-assignee');
  const members = S.currentBoard?.members || [];
  const col     = S.columns.find(c => c.id === colId);
  const inFinished = col && window.isFinishedColumn && window.isFinishedColumn(col);
  const safeEscHtml = (typeof escHtml === 'function') ? escHtml : (t => t);
  
  if (inFinished) {
    sel.innerHTML = `<option value="${safeEscHtml(card.assignee||'')}" selected>${safeEscHtml(card.assignee || '– Niemand –')}</option>`;
    sel.disabled = true;
    document.getElementById('edit-card-text').disabled = true;
    if (descField) descField.disabled = true;
    if (timeD) timeD.disabled = true;
    if (timeH) timeH.disabled = true;
    if (timeM) timeM.disabled = true;
    document.getElementById('edit-card-priority').disabled = true;
    document.getElementById('edit-card-due').disabled = true;
  } else {
    sel.innerHTML = '<option value="">– Niemand –</option>' + members.map(m => `<option value="${safeEscHtml(m)}" ${card.assignee===m?'selected':''}>${safeEscHtml(m)}</option>`).join('');
    if (!members.length) sel.innerHTML = '<option value="">Keine Mitglieder definiert</option>';
    sel.disabled = false;
    document.getElementById('edit-card-text').disabled = false;
    if (descField) descField.disabled = false;
    if (timeD) timeD.disabled = false;
    if (timeH) timeH.disabled = false;
    if (timeM) timeM.disabled = false;
    document.getElementById('edit-card-priority').disabled = false;
    document.getElementById('edit-card-due').disabled = false;
  }
  document.getElementById('modal-edit-card').style.display = 'flex';
};

window.saveEditCard = () => {
  const cardId   = document.getElementById('edit-card-id').value;
  const colId    = document.getElementById('edit-card-col').value;
  const text     = document.getElementById('edit-card-text').value.trim();
  
  const descField = document.getElementById('edit-card-description');
  const description = descField ? descField.value.trim() : '';
  
  const d = parseInt(document.getElementById('edit-card-time-d')?.value || 0, 10) || 0;
  const h = parseInt(document.getElementById('edit-card-time-h')?.value || 0, 10) || 0;
  const m = parseInt(document.getElementById('edit-card-time-m')?.value || 0, 10) || 0;
  const timeEstimate = { d, h, m };

  const prio     = document.getElementById('edit-card-priority').value;
  const due      = document.getElementById('edit-card-due').value;
  const assignee = document.getElementById('edit-card-assignee').value.trim();
  if (!text) return;
  
  window.pushUndo('Karte bearbeitet: ' + text.slice(0, 30));
  
  updateCard(S.currentBoard.id, colId, cardId, { 
    text, 
    description, 
    timeEstimate, 
    priority: prio, 
    due: due || '', 
    assignee: assignee || '' 
  });
  
  window.loadCards(colId);
  window.closeModal('modal-edit-card');
  showToast('Karte gespeichert!');
};

// ── DRAG & DROP ───────────────────────────────────────
window.onDragStart = (e, cardId, colId) => { 
  S.dragCard = cardId; S.dragFromCol = colId; 
  setTimeout(() => document.getElementById('card-'+cardId)?.classList.add('dragging'), 0); 
};
window.onDragEnd = () => { 
  document.querySelectorAll('.card').forEach(c => c.classList.remove('dragging')); 
};
window.onDragOver = (e, colId) => { 
  e.preventDefault(); 
  document.getElementById('cards-'+colId)?.classList.add('drag-over'); 
};
window.onDragLeave = (e, colId) => { 
  document.getElementById('cards-'+colId)?.classList.remove('drag-over'); 
};

window.onDrop = (e, toColId) => {
  e.preventDefault();
  document.getElementById('cards-'+toColId)?.classList.remove('drag-over');
  if (!S.dragCard || toColId === S.dragFromCol) return;
  const fromColId = S.dragFromCol; const cardId = S.dragCard;
  S.dragCard = null; S.dragFromCol = null;
  const fromColIdx = S.columns.findIndex(c => c.id === fromColId);
  const toColIdx   = S.columns.findIndex(c => c.id === toColId);
  window.moveCardStep(cardId, fromColId, toColIdx - fromColIdx);
};

// ── KOMMENTARE ────────────────────────────────────────
window.openComments = (cardId, colId) => {
  document.getElementById('comments-card-id').value = cardId;
  document.getElementById('comments-col-id').value  = colId;
  window.renderCommentsList();
  document.getElementById('modal-comments').style.display = 'flex';
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.renderCommentsList = () => {
  const cardId = document.getElementById('comments-card-id').value;
  const colId  = document.getElementById('comments-col-id').value;
  const card   = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  const listEl = document.getElementById('comments-list');
  const comments = card.comments || [];
  if (comments.length === 0) {
    listEl.innerHTML = '<div style="font-size:13px; color:var(--text-muted); text-align:center; padding:10px 0;">Noch keine Kommentare.</div>';
  } else {
    listEl.innerHTML = comments.map((c, i) => `
      <div style="background:var(--surface2); border-radius:8px; padding:10px 12px; border-left:3px solid ${c.role === 'teacher' ? '#f59e0b' : 'var(--accent)'}; margin-bottom:6px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="font-size:12px; color:${c.role === 'teacher' ? '#f59e0b' : 'var(--accent)'};">${c.role === 'teacher' ? '<i data-lucide="graduation-cap" style="width:12px;height:12px;vertical-align:-1px;"></i> Tutor' : '<i data-lucide="user" style="width:12px;height:12px;vertical-align:-1px;"></i> SchülerIn'}</strong>
          <button class="card-btn delete" onclick="window.removeComment(${i})" title="Löschen"><i data-lucide="trash-2" style="width:12px;height:12px;"></i></button>
        </div>
        <div style="font-size:13px; color:var(--text);">${typeof escHtml === 'function' ? escHtml(c.text) : c.text}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${c.createdAt ? new Date(c.createdAt).toLocaleString('de-DE') : ''}</div>
      </div>
    `).join('');
  }
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.addComment = () => {
  const cardId = document.getElementById('comments-card-id').value;
  const colId  = document.getElementById('comments-col-id').value;
  const input  = document.getElementById('new-comment-input');
  const text   = input?.value.trim();
  if (!text) return;
  const role = window._kfSession?.isStudent ? 'student' : 'teacher';
  const card = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  const comments = [...(card.comments || []), { text, role, createdAt: new Date().toISOString() }];
  card.comments = comments;
  updateCard(S.currentBoard.id, colId, cardId, { comments });
  if (input) input.value = '';
  if (typeof window.renderCards === 'function') window.renderCards(colId);
  window.renderCommentsList();
};

window.removeComment = (idx) => {
  const cardId = document.getElementById('comments-card-id').value;
  const colId  = document.getElementById('comments-col-id').value;
  const card   = (S.cards[colId]||[]).find(c => c.id === cardId);
  if (!card) return;
  const comments = (card.comments || []).filter((_, i) => i !== idx);
  card.comments = comments;
  updateCard(S.currentBoard.id, colId, cardId, { comments });
  if (typeof window.renderCards === 'function') window.renderCards(colId);
  window.renderCommentsList();
};
