// js/storage.js — Lokale Datenspeicherung (ersetzt Firebase komplett)
// Alle Daten liegen als JSON in localStorage unter dem Schlüssel 'kanban_data'
// Struktur: { version, user, settings, boards: [{ id, name, ..., columns: [{ id, ..., cards: [] }] }] }

const STORAGE_KEY = 'kanban_data';
const SETTINGS_KEY = 'kanban_settings';

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
