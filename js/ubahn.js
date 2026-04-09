// js/ubahn.js — U-Bahn Streckennetz (Agenda)
import { S } from './state.js';

const PALETTE = [
  "#ef4444","#3b82f6","#10b981","#f59e0b",
  "#a855f7","#06b6d4","#d946ef","#ec4899",
  "#f97316","#84cc16","#14b8a6","#6366f1"
];

const TRACK_SPACING = 100; 
let   ROW_HEIGHT    = 100; 
const MARGIN_TOP    = 140; 
const MARGIN_H      = 220; 

let _data = null; 
let _anim = null; 
let _currentView = 'map'; 
let _currentPerson = null;

function esc(text) {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  return String(text).replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

// ── 0. FULL-LENGTH EXPORT LOGIK ─────────────────────────────
window.exportUBahnAsImage = function() {
  const originalContent = document.getElementById('ubahn-content');
  if (!originalContent) return;

  const printWindow = window.open('', '_blank');
  const styles = Array.from(document.styleSheets)
    .map(styleSheet => {
      try { return Array.from(styleSheet.cssRules).map(rule => rule.cssText).join(''); } 
      catch (e) { return ''; }
    }).join('');

  const contentHtml = originalContent.innerHTML;
  const mapWidth = originalContent.querySelector('div')?.style.width || '100%';
  const mapHeight = originalContent.querySelector('div')?.style.height || 'auto';

  printWindow.document.write(`
    <html>
      <head>
        <title>U-Bahn Plan Export</title>
        <style>
          ${styles}
          body { background: #1a1a1a; margin: 0; padding: 60px; overflow: visible !important; }
          #print-container { width: ${mapWidth}; height: ${mapHeight}; position: relative; margin: 0 auto; }
          .no-print, #ubahn-controls-panel, #ubahn-back-btn { display: none !important; }
          svg { overflow: visible !important; }
          @media print {
            @page { size: auto; margin: 10mm; }
            body { background: #1a1a1a !important; -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div id="print-container">${contentHtml}</div>
        <script>
          setTimeout(() => { window.print(); }, 800);
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};

// ── 1. KOMPAKTES KONTROLL-PANEL (SLIDER & DOWNLOAD) ──────────
function ensureControls() {
  if (document.getElementById('ubahn-controls-panel')) return;
  const modal = document.getElementById('modal-ubahn-inner');
  if (!modal) return;

  const panel = document.createElement('div');
  panel.id = 'ubahn-controls-panel';
  panel.className = 'no-print';
  panel.style.cssText = `
    position: absolute; left: 20px; top: 100px;
    background: var(--panel); border: 1px solid var(--border);
    width: 54px; padding: 20px 0; border-radius: 30px; display: flex; flex-direction: column;
    align-items: center; gap: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); z-index: 10000;
  `;
  
  panel.innerHTML = `
    <button onclick="window.exportUBahnAsImage()" title="Plan speichern" 
            style="background:var(--surface2); border:1px solid var(--border); width:36px; height:36px; border-radius:50%; color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center;">
      <i data-lucide="download" style="width:18px; height:18px;"></i>
    </button>
    <div style="height:1px; width:20px; background:var(--border);"></div>
    <div style="font-size:9px; font-weight:900; color:var(--text-muted); text-transform:uppercase; writing-mode:vertical-rl; transform:rotate(180deg); letter-spacing:1px;">Abstand</div>
    <div style="height: 140px; display: flex; align-items: center;">
        <input type="range" min="60" max="400" value="${ROW_HEIGHT}" oninput="window.updateUBahnRowHeight(this.value)" 
               style="width: 130px; transform: rotate(-90deg); cursor: pointer; accent-color: var(--accent); margin: 0;">
    </div>
    <div id="val-row" style="font-size:10px; font-weight:900; color:var(--text); font-family:sans-serif;">${ROW_HEIGHT}px</div>
  `;
  modal.appendChild(panel);
  if (typeof reloadIcons === 'function') reloadIcons();
}

window.updateUBahnRowHeight = function(val) {
  ROW_HEIGHT = parseInt(val);
  const valLabel = document.getElementById('val-row');
  if (valLabel) valLabel.textContent = val + 'px';
  if (_currentView === 'map') renderUBahnMap();
  else if (_currentView === 'person' && _currentPerson) renderUBahnPerson(_currentPerson);
};

// ── 2. DATEN AUFBEREITEN ─────────────────────────────────────
function prepareBoardData() {
  const peopleSet = new Set();
  const boardData = [];
  const allCardsFlat = [];
  S.columns.forEach(col => {
    const colData = { spalte: col.name, karten: [] };
    (S.cards[col.id] || []).forEach(card => {
      if (!card.assignee) return;
      peopleSet.add(card.assignee);
      const mapped = { id: card.id, label: card.label || '?', titel: card.text, wer: card.assignee, prio: card.priority || 'mittel', deps: card.dependencies || [], gruppe: card.groupId || null };
      colData.karten.push(mapped);
      allCardsFlat.push(mapped);
    });
    if (colData.karten.length) boardData.push(colData);
  });
  const people = Array.from(peopleSet);
  const lineColors = {};
  people.forEach((p, i) => { lineColors[p] = i < PALETTE.length ? PALETTE[i] : `hsl(${Math.floor(Math.random() * 360)},70%,55%)`; });
  return { boardData, people, lineColors, allCardsFlat };
}

// ── 3. GRID & ROUTING ────────────────────────────────────────
function calculateGrid(boardData, people) {
  let placedCards = [], transferStations = [], processedLabels = new Set(), phaseBoundaries = [], currentLanes = [...people], trackPoints = {};
  people.forEach(p => trackPoints[p] = []);
  let currentRow = 0;
  const recordTracks = (r) => { currentLanes.forEach((p, i) => { trackPoints[p].push({ x: MARGIN_H + i * TRACK_SPACING, y: MARGIN_TOP + r * ROW_HEIGHT }); }); };
  recordTracks(currentRow);
  boardData.forEach(col => {
    const phaseStartRow = currentRow;
    col.karten.forEach(card => {
      if (processedLabels.has(card.label)) return;
      let involvedPeople = card.gruppe ? Array.from(new Set(col.karten.filter(c => c.gruppe === card.gruppe).map(c => c.wer))) : [card.wer];
      involvedPeople = involvedPeople.filter(p => people.includes(p));
      if (!involvedPeople.length) return;
      const involved = currentLanes.filter(p => involvedPeople.includes(p)), notInvolved = currentLanes.filter(p => !involvedPeople.includes(p));
      involved.sort((a, b) => currentLanes.indexOf(a) - currentLanes.indexOf(b));
      notInvolved.sort((a, b) => currentLanes.indexOf(a) - currentLanes.indexOf(b));
      let avgPos = involved.reduce((sum, p) => sum + currentLanes.indexOf(p), 0) / involved.length;
      let targetIndex = Math.max(0, Math.min(notInvolved.length, Math.round(avgPos - (involved.length / 2))));
      currentRow++;
      currentLanes = [...notInvolved.slice(0, targetIndex), ...involved, ...notInvolved.slice(targetIndex)];
      recordTracks(currentRow);
      if (card.gruppe) {
        transferStations.push({ name: card.gruppe, row: currentRow, minCol: targetIndex, maxCol: targetIndex + involved.length - 1 });
        col.karten.filter(c => c.gruppe === card.gruppe).forEach(gc => { placedCards.push({ ...gc, row: currentRow }); processedLabels.add(gc.label); });
      } else { placedCards.push({ ...card, row: currentRow }); processedLabels.add(card.label); }
    });
    if (currentRow === phaseStartRow) currentRow++; 
    phaseBoundaries.push({ name: col.spalte, start: phaseStartRow, end: currentRow });
  });
  currentRow++; recordTracks(currentRow);
  return { placedCards, transferStations, maxRows: currentRow, phaseBoundaries, trackPoints };
}

function createTrackPath(points) {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i-1], curr = points[i];
    if (prev.x !== curr.x) { const midY = (prev.y + curr.y) / 2; d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`; }
    else d += ` L ${curr.x} ${curr.y}`;
  }
  return d;
}

// ── 4. GESAMTNETZ RENDERN ────────────────────────────────────
window.renderUBahnMap = function() {
  _currentView = 'map'; _currentPerson = null;
  ensureControls();
  document.getElementById('ubahn-back-btn').style.display = 'none';
  const container = document.getElementById('ubahn-content');
  _data = prepareBoardData();
  const { boardData, people, lineColors, allCardsFlat } = _data;
  if (!people.length) return;
  const { placedCards, transferStations, maxRows, phaseBoundaries, trackPoints } = calculateGrid(boardData, people);
  const mapW = (people.length - 1) * TRACK_SPACING + MARGIN_H * 2, mapH = maxRows * ROW_HEIGHT + MARGIN_TOP + 100;
  let svg = `<svg width="${mapW}" height="${mapH}" style="position:absolute;inset:0;pointer-events:none;">`;
  phaseBoundaries.forEach(p => {
    const y = p.start * ROW_HEIGHT + MARGIN_TOP - (ROW_HEIGHT / 2);
    if (p.start > 0) svg += `<line x1="0" y1="${y}" x2="${mapW}" y2="${y}" stroke="var(--border)" stroke-width="3" stroke-dasharray="10 10"/><text x="20" y="${y+22}" fill="var(--text-muted)" font-size="11" font-weight="900" font-family="sans-serif" letter-spacing="5">${esc(p.name.toUpperCase())}</text>`;
  });
  people.forEach(p => svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" opacity="1"/>`);
  people.forEach(p => svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="${lineColors[p]}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`);
  transferStations.forEach(s => {
    const x1 = MARGIN_H + s.minCol * TRACK_SPACING, x2 = MARGIN_H + s.maxCol * TRACK_SPACING, y = s.row * ROW_HEIGHT + MARGIN_TOP;
    svg += `<rect x="${x1-24}" y="${y-24}" width="${(x2-x1)+48}" height="48" rx="24" fill="#ffffff22" stroke="var(--border)" stroke-width="3"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--text-muted)" stroke-width="8" stroke-linecap="round" opacity="0.6"/>`;
  });
  svg += `</svg>`;
  let html = ``;
  people.forEach(p => {
    const startPt = trackPoints[p][0], color = lineColors[p];
    html += `<button onclick='window.renderUBahnPerson(${JSON.stringify(p)})' style="position:absolute;left:${startPt.x - 60}px;top:${startPt.y - 70}px;width:120px;text-align:center;background:none;border:none;cursor:pointer;z-index:10;"><div style="display:inline-block;background:var(--surface);border:4px solid ${color};border-radius:14px;padding:7px 12px;font-family:sans-serif;font-weight:900;font-size:12px;color:var(--text);box-shadow:0 4px 16px ${color}44;">${esc(p)}</div></button>`;
    html += `<div style="position:absolute;left:${startPt.x - 12}px;top:${startPt.y - 12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:1;"></div>`;
    const endPt = trackPoints[p][maxRows];
    html += `<div style="position:absolute;left:${endPt.x - 12}px;top:${endPt.y - 12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:1;"></div>`;
  });
  placedCards.forEach(k => {
    const pt = trackPoints[k.wer][k.row], color = lineColors[k.wer], isHigh = k.prio === 'hoch';
    html += `<div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' style="position:absolute;left:${pt.x-90}px;top:${pt.y-22}px;width:180px;display:flex;flex-direction:column;align-items:center;cursor:pointer;" class="ubahn-station"><div style="width:44px;height:44px;border-radius:50%;background:var(--surface);border:4px solid ${color};display:flex;align-items:center;justify-content:center;font-family:sans-serif;font-weight:900;font-size:13px;color:var(--text);box-shadow:0 4px 14px rgba(0,0,0,0.4);">${esc(k.label)}${isHigh ? `<span style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:var(--danger);border-radius:50%;border:2px solid var(--surface);"></span>` : ''}</div></div>`;
  });
  container.innerHTML = `<div style="position:relative;width:${mapW}px;height:${mapH}px;margin:0 auto;">${svg}${html}</div>`;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── 5. EINZELPERSON-ANSICHT & ANIMATION (Unverändert) ──────────
window.renderUBahnPerson = function(workerName) {
  _currentView = 'person'; _currentPerson = workerName;
  ensureControls();
  document.getElementById('ubahn-back-btn').style.display = 'inline-flex';
  const container = document.getElementById('ubahn-content');
  const { boardData, allCardsFlat, lineColors } = _data;
  const color = lineColors[workerName] || '#6366f1';
  const myCards = allCardsFlat.filter(c => c.wer === workerName);
  let stationsHtml = ``; const X_LINE = 120; let currentY = MARGIN_TOP; const firstY = currentY;
  boardData.forEach(col => {
    const colCards = myCards.filter(c => col.karten.some(kc => kc.id === c.id));
    if (colCards.length > 0) {
      stationsHtml += `<div style="position:absolute; left:${X_LINE + 60}px; top:${currentY - 20}px; font-size:10px; font-weight:900; color:var(--text-muted); text-transform:uppercase; letter-spacing:3px;">${esc(col.spalte)}</div>`;
      colCards.forEach(k => {
        let members = k.gruppe ? Array.from(new Set(allCardsFlat.filter(c => c.gruppe === k.gruppe && c.wer !== workerName).map(c => c.wer))) : [];
        let dotW = members.length ? 64 : 44;
        stationsHtml += `<div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' style="position:absolute; left:${X_LINE-(dotW/2)}px; top:${currentY-22}px; width:${dotW}px; height:44px; border-radius:22px; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-family:sans-serif; font-weight:900; font-size:13px; color:var(--text); box-shadow:0 4px 14px rgba(0,0,0,0.4); cursor:pointer; z-index:2;">${esc(k.label)}${k.prio === 'hoch' ? `<span style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:var(--danger);border-radius:50%;border:2px solid var(--surface);"></span>` : ''}</div>`;
        stationsHtml += `<div style="position:absolute; left:${X_LINE + 50}px; top:${currentY - 26}px; width:340px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; box-shadow:var(--shadow);"><div style="font-size:15px; font-weight:700; color:var(--text); line-height:1.3;">${esc(k.titel)}</div>${members.length ? `<div style="margin-top:12px; display:flex; flex-wrap:wrap; gap:6px;">${members.map(m => `<span style="display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:12px; font-size:10px; font-weight:800; color:#fff; background:${lineColors[m]};"><div style="width:6px; height:6px; border-radius:50%; background:#fff;"></div> ${esc(m)}</span>`).join('')}</div>` : ''}</div>`;
        currentY += ROW_HEIGHT + (members.length ? 60 : 0);
      });
      currentY += 40;
    }
  });
  stationsHtml += `<div style="position:absolute;left:${X_LINE-12}px;top:${firstY-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:1;"></div><div style="position:absolute;left:${X_LINE-12}px;top:${currentY-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:1;"></div>`;
  const svg = `<svg width="100%" height="${currentY+50}" style="position:absolute;inset:0;pointer-events:none;"><path d="M ${X_LINE} ${firstY} L ${X_LINE} ${currentY}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linecap="round"/><path d="M ${X_LINE} ${firstY} L ${X_LINE} ${currentY}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" opacity="0.85"/></svg>`;
  container.innerHTML = `<div style="max-width:800px; margin:0 auto; padding:24px; position:relative; min-height:${currentY+50}px;">${svg}${stationsHtml}</div>`;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.showUBahnCardDetail = function(label) {
  const card = _data.allCardsFlat.find(c => c.label === label); if (!card) return;
  const color = _data.lineColors[card.wer];
  let members = card.gruppe ? Array.from(new Set(_data.allCardsFlat.filter(c => c.gruppe === card.gruppe).map(c => c.wer))) : [];
  document.getElementById('ubahn-card-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ubahn-card-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div style="background:var(--panel);border-radius:20px;max-width:480px;width:100%;border:1px solid var(--border);box-shadow:0 20px 60px rgba(0,0,0,0.6);overflow:hidden;"><div style="height:5px;background:${color};"></div><div style="padding:28px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;"><div style="width:48px;height:48px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#fff;border:3px solid var(--surface);">${esc(card.label)}</div><button onclick="document.getElementById('ubahn-card-overlay').remove()" style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:22px;">✕</button></div><div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Linie ${esc(card.wer)}</div><div style="font-size:20px;font-weight:700;color:var(--text);">${esc(card.titel)}</div>${members.length > 1 ? `<div style="margin-top:20px;padding-top:15px;border-top:1px solid var(--border);"><div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;margin-bottom:10px;">Zusammenarbeit:</div><div style="display:flex;flex-wrap:wrap;gap:8px;">${members.map(m => `<span style="padding:5px 12px;border-radius:15px;font-size:11px;font-weight:800;color:#fff;background:${_data.lineColors[m]};">${esc(m)}</span>`).join('')}</div></div>` : ''}</div></div>`;
  document.body.appendChild(overlay);
};

window.openUBahnModal = function() {
  document.getElementById('modal-ubahn').style.display = 'flex';
  ensureControls();
  renderUBahnMap();
};
