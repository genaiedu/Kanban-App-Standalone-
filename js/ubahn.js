// js/ubahn.js — Dynamisches U-Bahn Streckennetz (Agenda)
import { S } from './state.js';

const PALETTE = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b",
  "#a855f7", "#06b6d4", "#d946ef", "#ec4899",
  "#f97316", "#84cc16", "#14b8a6", "#6366f1"
];

const CELL_W = 180;
const CELL_H = 120;
const MARGIN_TOP = 60;

let currentUBahnData = null;

// ── Hilfsfunktion: XSS-Schutz ────────────────────────────────
function escapeHtml(text) {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// ── 1. DATEN AUFBEREITEN ─────────────────────────────────────
function prepareBoardData() {
  const peopleSet = new Set();
  const boardData = [];
  const allCardsFlat = [];
  let labelCounter = 0;

  S.columns.forEach(col => {
    const colData = { spalte: col.name, karten: [] };
    const cardsInCol = S.cards[col.id] || [];

    cardsInCol.forEach(card => {
      if (!card.assignee) return;
      peopleSet.add(card.assignee);

      const stationLabel = typeof window.numberToLabel === 'function'
                           ? window.numberToLabel(labelCounter++)
                           : `S${labelCounter++}`;

      const mappedCard = {
        id: card.id,
        label: stationLabel,
        titel: card.text,
        wer: card.assignee,
        prio: card.priority || 'mittel',
        deps: card.dependencies || [],
        gruppe: card.groupId || null   // fix: war card.group
      };

      colData.karten.push(mappedCard);
      allCardsFlat.push(mappedCard);
    });

    if (colData.karten.length > 0) boardData.push(colData);
  });

  const people = Array.from(peopleSet);
  const lineColors = {};
  people.forEach((p, idx) => {
    lineColors[p] = idx < PALETTE.length
      ? PALETTE[idx]
      : `hsl(${Math.floor(Math.random() * 360)}, 70%, 55%)`;
  });

  return { boardData, people, lineColors, allCardsFlat };
}

// ── 2. GRID BERECHNEN ────────────────────────────────────────
function calculateGrid(boardData, people) {
  let grid = [];
  let placedCards = [];
  let maxGlobalRow = 0;
  let phaseBoundaries = [];

  const getFreeRow = (colIdx, startRow = 0) => {
    let r = startRow;
    while (grid[r] && grid[r][colIdx] !== undefined) r++;
    return r;
  };

  const markGrid = (r, colIdx, value) => {
    if (!grid[r]) grid[r] = new Array(people.length).fill(undefined);
    grid[r][colIdx] = value;
  };

  boardData.forEach(col => {
    let phaseStartRow = maxGlobalRow;

    col.karten.forEach(card => {
      const colIdx = people.indexOf(card.wer);
      const row = getFreeRow(colIdx, phaseStartRow);
      markGrid(row, colIdx, card.label);
      placedCards.push({ ...card, row, col: colIdx });
      if (row >= maxGlobalRow) maxGlobalRow = row + 1;
    });

    phaseBoundaries.push({ name: col.spalte, start: phaseStartRow, end: maxGlobalRow });
  });

  return { placedCards, maxRows: maxGlobalRow, phaseBoundaries };
}

// ── 3. RENDERING: GESAMTES NETZ ──────────────────────────────
window.renderUBahnMap = function() {
  document.getElementById('ubahn-back-btn').style.display = 'none';
  const container = document.getElementById('ubahn-content');

  if (!S.columns || S.columns.length === 0) {
    container.innerHTML = `<div class="empty-state">Kein aktives Board geladen.</div>`;
    return;
  }

  currentUBahnData = prepareBoardData();
  const { boardData, people, lineColors } = currentUBahnData;

  if (people.length === 0) {
    container.innerHTML = `<div class="empty-state" style="text-align:center; padding:40px;">
      <i data-lucide="users" style="width:48px;height:48px;opacity:0.5;margin-bottom:16px;"></i><br>
      Das Streckennetz braucht Fahrgäste!<br>
      Bitte weise zunächst Personen zu deinen Karten zu.
    </div>`;
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
    return;
  }

  const gridData = calculateGrid(boardData, people);

  const mapWidth  = Math.max(people.length * CELL_W + 100, 600);
  const mapHeight = gridData.maxRows * CELL_H + MARGIN_TOP + 100;

  // SVG Layer
  let svgHtml = `<svg width="${mapWidth}" height="${mapHeight}" style="position:absolute;inset:0;pointer-events:none;">`;

  gridData.phaseBoundaries.forEach(phase => {
    if (phase.start >= phase.end) return;
    const startY = phase.start * CELL_H + MARGIN_TOP;
    svgHtml += `
      <line x1="0" y1="${startY}" x2="${mapWidth}" y2="${startY}" stroke="var(--border)" stroke-width="2" stroke-dasharray="6 6"/>
      <text x="20" y="${startY + 20}" fill="var(--text-muted)" font-size="12" font-weight="bold" letter-spacing="2">${escapeHtml(phase.name)}</text>
    `;
  });

  people.forEach((person, idx) => {
    const x = idx * CELL_W + (CELL_W / 2) + 50;
    svgHtml += `<line x1="${x}" y1="0" x2="${x}" y2="${mapHeight}" stroke="${lineColors[person]}" stroke-width="8" stroke-linecap="round" opacity="0.8"/>`;
  });
  svgHtml += `</svg>`;

  // HTML Layer
  let htmlLayer = ``;

  people.forEach((person, idx) => {
    const x = idx * CELL_W + 50;
    const color = lineColors[person];
    htmlLayer += `
      <div style="position:absolute;left:${x}px;top:10px;width:${CELL_W}px;text-align:center;cursor:pointer;" onclick="renderUBahnPerson(${JSON.stringify(person)})">
        <div style="display:inline-block;background:var(--surface);border:3px solid ${color};border-radius:12px;padding:6px 16px;font-weight:bold;color:var(--text);box-shadow:var(--card-3d);transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
          ${escapeHtml(person)}
        </div>
      </div>
    `;
  });

  gridData.placedCards.forEach(card => {
    const cx = card.col * CELL_W + (CELL_W / 2) + 50;
    const cy = card.row * CELL_H + MARGIN_TOP + (CELL_H / 2);
    const color = lineColors[card.wer];
    const isHighPrio = card.prio === 'hoch';

    htmlLayer += `
      <div style="position:absolute;left:${cx - CELL_W/2}px;top:${cy - CELL_H/2}px;width:${CELL_W}px;height:${CELL_H}px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:20px;">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--surface);border:4px solid ${color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:var(--text);box-shadow:0 4px 10px rgba(0,0,0,0.3);position:relative;z-index:2;">
          ${card.label}
          ${isHighPrio ? `<span style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:var(--danger);border-radius:50%;border:2px solid var(--surface);"></span>` : ''}
        </div>
        <div style="margin-top:8px;text-align:center;padding:4px 8px;background:rgba(var(--panel-rgb),0.8);backdrop-filter:blur(8px);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--text);max-width:90%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${escapeHtml(card.titel)}
        </div>
      </div>
    `;
  });

  container.innerHTML = `<div style="position:relative;width:${mapWidth}px;height:${mapHeight}px;">${svgHtml}${htmlLayer}</div>`;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── 4. RENDERING: EINZELPERSON ───────────────────────────────
window.renderUBahnPerson = function(workerName) {
  document.getElementById('ubahn-back-btn').style.display = 'inline-flex';
  const container = document.getElementById('ubahn-content');

  if (!currentUBahnData) return;
  const { boardData, allCardsFlat, lineColors } = currentUBahnData;
  const color = lineColors[workerName] || '#6366f1';
  const myCards = allCardsFlat.filter(c => c.wer === workerName);

  let html = `
    <div style="max-width:800px;margin:0 auto;padding:20px;">
      <div style="display:flex;align-items:center;margin-bottom:30px;">
        <div style="width:48px;height:48px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:4px solid var(--surface);box-shadow:var(--shadow);margin-right:16px;">
          <div style="width:16px;height:16px;background:#fff;border-radius:50%;"></div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);">Fahrplan / Linie</div>
          <h2 style="margin:0;font-size:28px;color:${color};">${escapeHtml(workerName)}</h2>
        </div>
      </div>
      <div style="position:relative;padding-left:30px;">
        <div style="position:absolute;left:12px;top:0;bottom:0;width:6px;border-radius:3px;background:${color};"></div>
  `;

  boardData.forEach(col => {
    const colCards = myCards.filter(c => col.karten.some(kc => kc.id === c.id));
    if (!colCards.length) return;

    html += `
      <div style="margin-bottom:30px;">
        <h3 style="font-size:14px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:16px;margin-left:20px;">
          ${escapeHtml(col.spalte)}
        </h3>
        <div style="display:flex;flex-direction:column;gap:20px;">
    `;

    colCards.forEach(karte => {
      html += `
        <div style="position:relative;margin-left:20px;">
          <div style="position:absolute;left:-42px;top:12px;width:18px;height:18px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>
          <div class="card" style="cursor:default;">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span style="font-size:11px;font-weight:800;background:var(--surface2);border:1px solid var(--border);padding:2px 8px;border-radius:4px;">
                Station ${karte.label}
              </span>
            </div>
            <div style="font-size:15px;font-weight:500;">${escapeHtml(karte.titel)}</div>
          </div>
        </div>
      `;
    });

    html += `</div></div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;
};

// ── 5. MODAL ÖFFNEN ──────────────────────────────────────────
window.openUBahnModal = function() {
  document.getElementById('modal-ubahn').style.display = 'flex';
  renderUBahnMap();
};
