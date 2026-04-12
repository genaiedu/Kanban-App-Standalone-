// js/storage.js — Lokale Datenspeicherung (ersetzt Firebase komplett)
// Alle Daten liegen als JSON in localStorage unter dem Schlüssel 'kanban_data'
// Struktur: { version, user, settings, boards: [{ id, name, ..., columns: [{ id, ..., cards: [] }] }] }
// Snapshots werden unter 'kanban_snapshots' gespeichert: Array von { timestamp, data }

const STORAGE_KEY = 'kanban_data';
const SETTINGS_KEY = 'kanban_settings';
const SNAPSHOTS_KEY = 'kanban_snapshots';
const MAX_SNAPSHOTS = 50; // Maximale Anzahl an Snapshots die behalten werden

// ── UUID-GENERATOR ────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── KERN-LADE/SPEICHER-FUNKTIONEN ─────────────────────
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { version: 1, user: { displayName: '', groupId: '' }, boards: [] };
}

function saveData(data) {
  try {
    // Vor dem Speichern einen Snapshot erstellen
    createSnapshot(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Speichern fehlgeschlagen:', e);
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { bg: '', overlayOpacity: '72', theme: 'dark' };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

// ── SNAPSHOT-FUNKTIONEN FÜR VERSIONIERUNG ──────────────
function createSnapshot(data) {
  try {
    let snapshots = [];
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (raw) {
      try { snapshots = JSON.parse(raw); } catch (e) { snapshots = []; }
    }
    
    // Neuen Snapshot mit Zeitstempel erstellen
    const snapshot = {
      timestamp: new Date().toISOString(),
      data: JSON.parse(JSON.stringify(data)) // Deep copy
    };
    
    snapshots.push(snapshot);
    
    // Alte Snapshots entfernen wenn Maximum erreicht
    while (snapshots.length > MAX_SNAPSHOTS) {
      snapshots.shift();
    }
    
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch (e) {
    console.error('Snapshot erstellen fehlgeschlagen:', e);
  }
}

export function getSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return [];
}

export function loadSnapshot(timestamp) {
  try {
    const snapshots = getSnapshots();
    const snapshot = snapshots.find(s => s.timestamp === timestamp);
    if (snapshot) {
      saveData(snapshot.data);
      return true;
    }
  } catch (e) {
    console.error('Snapshot laden fehlgeschlagen:', e);
  }
  return false;
}

export function deleteSnapshot(timestamp) {
  try {
    let snapshots = getSnapshots();
    snapshots = snapshots.filter(s => s.timestamp !== timestamp);
    localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch (e) {
    console.error('Snapshot löschen fehlgeschlagen:', e);
  }
}

export function clearAllSnapshots() {
  try {
    localStorage.removeItem(SNAPSHOTS_KEY);
  } catch (e) {
    console.error('Alle Snapshots löschen fehlgeschlagen:', e);
  }
}

// ── BENUTZER ──────────────────────────────────────────
export function getUser() {
  return loadData().user;
}

export function saveUser(user) {
  const data = loadData();
  data.user = { ...data.user, ...user };
  saveData(data);
}

// ── EINSTELLUNGEN ─────────────────────────────────────
export function getSetting(key) {
  return loadSettings()[key];
}

export function setSetting(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

// ── BOARDS ────────────────────────────────────────────
export function getBoards() {
  return loadData().boards.map(b => ({
    id: b.id,
    name: b.name,
    members: b.members || [],
    wipLimit: b.wipLimit ?? 3,
    agingDays: b.agingDays ?? 5,
    cardCounter: b.cardCounter ?? 0,
    groupId: b.groupId || '',
    ownerName: b.ownerName || '',
    agingPaused: b.agingPaused || false,
    agingPausedAt: b.agingPausedAt || '',
    totalPausedMs: b.totalPausedMs || 0,
    createdAt: b.createdAt || new Date().toISOString(),
  }));
}

export function createBoard(fields) {
  const data = loadData();
  const board = {
    id: generateId(),
    name: fields.name || 'Neues Board',
    members: fields.members || [],
    wipLimit: fields.wipLimit ?? 3,
    agingDays: fields.agingDays ?? 5,
    cardCounter: fields.cardCounter ?? 0,
    groupId: fields.groupId || '',
    ownerName: fields.ownerName || '',
    agingPaused: false,
    agingPausedAt: '',
    totalPausedMs: 0,
    createdAt: new Date().toISOString(),
    columns: [],
  };
  data.boards.push(board);
  saveData(data);
  return board;
}

export function updateBoard(boardId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  Object.assign(board, fields);
  saveData(data);
}

export function deleteBoard(boardId) {
  const data = loadData();
  data.boards = data.boards.filter(b => b.id !== boardId);
  saveData(data);
}

// ── SPALTEN ───────────────────────────────────────────
export function getColumns(boardId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return [];
  return (board.columns || [])
    .map(c => ({
      id: c.id,
      name: c.name,
      color: c.color || '#5c6ef8',
      order: c.order ?? 0,
      wipLimit: c.wipLimit ?? 0,
      createdAt: c.createdAt || new Date().toISOString(),
    }))
    .sort((a, b) => a.order - b.order);
}

export function createColumn(boardId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return null;
  const col = {
    id: generateId(),
    name: fields.name || 'Neue Spalte',
    color: fields.color || '#5c6ef8',
    order: fields.order ?? (board.columns.length),
    wipLimit: fields.wipLimit ?? 0,
    createdAt: new Date().toISOString(),
    cards: [],
  };
  board.columns.push(col);
  saveData(data);
  return col;
}

export function updateColumn(boardId, colId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  Object.assign(col, fields);
  saveData(data);
}

export function deleteColumn(boardId, colId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  board.columns = board.columns.filter(c => c.id !== colId);
  saveData(data);
}

// ── KARTEN ────────────────────────────────────────────
export function getCards(boardId, colId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return [];
  const col = board.columns.find(c => c.id === colId);
  if (!col) return [];
  return (col.cards || [])
    .map(c => ({ ...c }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function createCard(boardId, colId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return null;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return null;
  const card = {
    id: generateId(),
    text: fields.text || '',
    priority: fields.priority || '',
    assignee: fields.assignee || '',
    due: fields.due || '',
    description: fields.description || '',
    timeEstimate: fields.timeEstimate || { d: 0, h: 0, m: 0 },
    label: fields.label || '',
    order: fields.order ?? (col.cards ? col.cards.length : 0),
    startedAt: fields.startedAt || '',
    finishedAt: fields.finishedAt || '',
    dependencies: fields.dependencies || [],
    groupId: fields.groupId || '',
    comments: fields.comments || [],
    description: fields.description || '',
    createdAt: new Date().toISOString(),
  };
  if (!col.cards) col.cards = [];
  col.cards.push(card);
  saveData(data);
  return card;
}

export function updateCard(boardId, colId, cardId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  const card = col.cards.find(c => c.id === cardId);
  if (!card) return;
  Object.assign(card, fields);
  saveData(data);
}

export function deleteCard(boardId, colId, cardId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  col.cards = col.cards.filter(c => c.id !== cardId);
  saveData(data);
}

// Karte von einer Spalte in eine andere verschieben
export function moveCard(boardId, fromColId, toColId, cardId, newOrder) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const fromCol = board.columns.find(c => c.id === fromColId);
  const toCol = board.columns.find(c => c.id === toColId);
  if (!fromCol || !toCol) return;
  const cardIdx = fromCol.cards.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return;
  const [card] = fromCol.cards.splice(cardIdx, 1);
  card.order = newOrder ?? (toCol.cards ? toCol.cards.length : 0);
  if (!toCol.cards) toCol.cards = [];
  toCol.cards.push(card);
  saveData(data);
  return card;
}

// Alle Karten einer Spalte auf einmal ersetzen (für Undo/Reorder)
export function replaceCards(boardId, colId, cards) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  col.cards = cards.map(c => ({ ...c }));
  saveData(data);
}

// ── EXPORT / IMPORT ───────────────────────────────────
export function exportAllData() {
  const data = loadData();
  const settings = loadSettings();
  return JSON.stringify({ ...data, settings, exportedAt: new Date().toISOString() }, null, 2);
}

export function importAllData(jsonString) {
  const parsed = JSON.parse(jsonString);
  // Sicherheitsprüfung: muss boards-Array haben
  if (!Array.isArray(parsed.boards)) throw new Error('Ungültiges Dateiformat: boards fehlt.');
  const { settings, exportedAt, ...data } = parsed;
  data.version = 1;
  saveData(data);
  if (settings) saveSettings(settings);
}

// ── BOARD DUPLIZIEREN ─────────────────────────────────
export function duplicateBoardData(boardId, newName) {
  const data = loadData();
  const src = data.boards.find(b => b.id === boardId);
  if (!src) return null;
  const newBoard = {
    ...src,
    id: generateId(),
    name: newName || src.name + ' – Kopie',
    createdAt: new Date().toISOString(),
    columns: (src.columns || []).map(col => ({
      ...col,
      id: generateId(),
      createdAt: new Date().toISOString(),
      cards: (col.cards || []).map(card => ({
        ...card,
        id: generateId(),
        createdAt: new Date().toISOString(),
      })),
    })),
  };
  data.boards.push(newBoard);
  saveData(data);
  return newBoard;
}

// ── DATUM/UHRZEIT FORMATIERUNG ────────────────────────
export function formatTimestamp(isoString) {
  try {
    const d = new Date(isoString);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
  } catch (e) {
    return isoString;
  }
}

// ── BOARD-VERSIONEN FÜR DATEIVERWALTUNG ────────────────
export function getBoardVersionsForCurrentBoard(boardId) {
  try {
    const snapshots = getSnapshots();
    if (!boardId || snapshots.length === 0) return [];
    
    // Filtere Snapshots die das aktuelle Board enthalten
    const versions = snapshots.filter(s => {
      return s.data && s.data.boards && s.data.boards.some(b => b.id === boardId);
    }).map(s => {
      const board = s.data.boards.find(b => b.id === boardId);
      return {
        timestamp: s.timestamp,
        boardName: board ? board.name : 'Unbekannt',
        totalBoards: s.data.boards.length,
        totalCards: s.data.boards.reduce((sum, b) => sum + (b.columns?.reduce((cSum, c) => cSum + (c.cards?.length || 0), 0) || 0), 0) || 0
      };
    });
    
    // Nach Zeitstempel absteigend sortieren (neueste zuerst)
    return versions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  } catch (e) {
    console.error('Board-Versionen laden fehlgeschlagen:', e);
    return [];
  }
}

export function restoreBoardVersion(timestamp, boardId) {
  try {
    const snapshots = getSnapshots();
    const snapshot = snapshots.find(s => s.timestamp === timestamp);
    if (!snapshot) return false;
    
    // Lade nur das spezifische Board aus dem Snapshot
    const currentData = loadData();
    const versionBoard = snapshot.data.boards.find(b => b.id === boardId);
    if (!versionBoard) return false;
    
    // Ersetze das aktuelle Board mit der Version
    const boardIndex = currentData.boards.findIndex(b => b.id === boardId);
    if (boardIndex === -1) {
      // Board existiert nicht mehr, füge es hinzu
      currentData.boards.push(JSON.parse(JSON.stringify(versionBoard)));
    } else {
      currentData.boards[boardIndex] = JSON.parse(JSON.stringify(versionBoard));
    }
    
    saveData(currentData);
    return true;
  } catch (e) {
    console.error('Board-Version wiederherstellen fehlgeschlagen:', e);
    return false;
  }
}
