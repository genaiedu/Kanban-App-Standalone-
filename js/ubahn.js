// js/ubahn.js — U-Bahn Streckennetz (Agenda) - Mit Full-Length Export
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

  // Erstelle ein temporäres Fenster/Tab für den sauberen Druck des gesamten Plans
  const printWindow = window.open('', '_blank');
  
  // Hole das aktuelle Styling der App
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
          body { background: #1a1a1a; margin: 0; padding: 40px; overflow: visible !important; }
          #print-container { width: ${mapWidth}; height: ${mapHeight}; position: relative; }
          .no-print, #ubahn-vertical-slider, #ubahn-back-btn { display: none !important; }
          svg { overflow: visible !important; }
          @media print {
            @page { size: auto; margin: 0mm; }
            body { background: #1a1a1a !important; -webkit-print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        <div id="print-container">
          ${contentHtml}
        </div>
        <script>
          // Warte kurz auf Icons/Fonts, dann Druckdialog
          setTimeout(() => {
            window.print();
            // window.close(); // Optional: Fenster nach Druck schließen
          }, 500);
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
};

// ── 1. VERTIKALER SCHIEBEREGLER ──────────────────────────────
function ensureVerticalSlider() {
  if (document.getElementById('ubahn-vertical-slider')) return;
  const modal = document.getElementById('modal-ubahn-inner');
  if (!modal) return;

  const panel = document.createElement('div');
  panel.id = 'ubahn-vertical-slider';
  panel.className = 'no-print';
  panel.style.cssText = `
    position: absolute; left: 24px; top: 140px;
    background: var(--panel); border: 1px solid var(--border);
    padding: 20px 10px; border-radius: 20px; display: flex; flex-direction: column;
    align-items: center; box-shadow: 0 8px 32px rgba(0,0,0,0.15); z-index: 1000;
  `;
  
  panel.innerHTML = `
    <div style="font-size:10px; font-weight:900; color:var(--text-muted); text-transform:uppercase; writing-mode:vertical-rl; transform:rotate(180deg); letter-spacing:2px; margin-bottom:8px;">Abstand</div>
    <div style="height: 180px; display: flex; align-items: center; justify-content: center;">
        <input type="range" min="60" max="350" value="${ROW_HEIGHT}" oninput="window.updateUBahnRowHeight(this.value)" style="width: 180px; transform: rotate(-90deg); cursor: pointer; accent-color: var(--accent);">
    </div>
    <div id="val-row" style="font-size:12px; font-weight:900; color:var(--text); font-family:'Outfit', 'DM Sans', sans-serif; margin-top:8px;">${ROW_HEIGHT}px</div>
  `;
  modal.appendChild(panel);
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
      const mapped = {
        id: card.id, label: card.label || '?',
        titel: card.text, wer: card.assignee,
        prio: card.priority || 'mittel',
        deps: card.dependencies || [],
        gruppe: card.groupId || null
      };
      colData.karten.push(mapped);
      allCardsFlat.push(mapped);
    });
    if (colData.karten.length) boardData.push(colData);
  });

  const people = Array.from(peopleSet);
  const lineColors = {};
  people.forEach((p, i) => {
    lineColors[p] = i < PALETTE.length ? PALETTE[i] : `hsl(${Math.floor(Math.random() * 360)},70%,55%)`;
  });

  return { boardData, people, lineColors, allCardsFlat };
}

// ── 3. GRID & ROUTING ────────────────────────────────────────
function calculateGrid(boardData, people) {
  let placedCards = [];
  let transferStations = [];
  let processedLabels = new Set();
  let phaseBoundaries = [];
  let currentLanes = [...people];
  let trackPoints = {};
  people.forEach(p => trackPoints[p] = []);
  let currentRow = 0;

  const recordTracks = (r) => {
    currentLanes.forEach((p, i) => {
      trackPoints[p].push({ x: MARGIN_H + i * TRACK_SPACING, y: MARGIN_TOP + r * ROW_HEIGHT });
    });
  };

  recordTracks(currentRow);

  boardData.forEach(col => {
    const phaseStartRow = currentRow;
    col.karten.forEach(card => {
      if (processedLabels.has(card.label)) return;
      let involvedPeople = card.gruppe ? Array.from(new Set(col.karten.filter(c => c.gruppe === card.gruppe).map(c => c.wer))) : [card.wer];
      involvedPeople = involvedPeople.filter(p => people.includes(p));
      if (!involvedPeople.length) return;

      const involved = currentLanes.filter(p => involvedPeople.includes(p));
      const notInvolved = currentLanes.filter(p => !involvedPeople.includes(p));
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
      } else {
        placedCards.push({ ...card, row: currentRow });
        processedLabels.add(card.label);
      }
    });
    if (currentRow === phaseStartRow) currentRow++; 
    phaseBoundaries.push({ name: col.spalte, start: phaseStartRow, end: currentRow });
  });

  currentRow++;
  recordTracks(currentRow);
  return { placedCards, transferStations, maxRows: currentRow, phaseBoundaries, trackPoints };
}

function createTrackPath(points) {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i-1];
    const curr = points[i];
    if (prev.x !== curr.x) {
      const midY = (prev.y + curr.y) / 2;
      d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`;
    } else d += ` L ${curr.x} ${curr.y}`;
  }
  return d;
}

// ── 4. GESAMTNETZ RENDERN ────────────────────────────────────
window.renderUBahnMap = function() {
  _currentView = 'map'; _currentPerson = null;
  ensureVerticalSlider();
  document.getElementById('ubahn-back-btn').style.display = 'none';
  const container = document.getElementById('ubahn-content');

  _data = prepareBoardData();
  const { boardData, people, lineColors, allCardsFlat } = _data;
  if (!people.length) return;

  const { placedCards, transferStations, maxRows, phaseBoundaries, trackPoints } = calculateGrid(boardData, people);
  const mapW = (people.length - 1) * TRACK_SPACING + MARGIN_H * 2;
  const mapH = maxRows * ROW_HEIGHT + MARGIN_TOP + 100;

  let svg = `<svg width="${mapW}" height="${mapH}" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;pointer-events:none;">`;
  phaseBoundaries.forEach(p => {
    const y = p.start * ROW_HEIGHT + MARGIN_TOP - (ROW_HEIGHT / 2);
    if (p.start > 0) svg += `<line x1="0" y1="${y}" x2="${mapW}" y2="${y}" stroke="var(--border)" stroke-width="3" stroke-dasharray="10 10"/><text x="20" y="${y+22}" fill="var(--text-muted)" font-size="11" font-weight="900" font-family="Outfit, sans-serif" letter-spacing="5">${esc(p.name.toUpperCase())}</text>`;
  });

  people.forEach(p => svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" opacity="1"/>`);
  people.forEach(p => svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="${lineColors[p]}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`);
  transferStations.forEach(s => {
    const x1 = MARGIN_H + s.minCol * TRACK_SPACING, x2 = MARGIN_H + s.maxCol * TRACK_SPACING, y = s.row * ROW_HEIGHT + MARGIN_TOP;
    svg += `<rect x="${x1-24}" y="${y-24}" width="${(x2-x1)+48}" height="48" rx="24" fill="var(--surface)" fill-opacity="0.8" stroke="var(--border)" stroke-width="4"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--text-muted)" stroke-width="8" stroke-linecap="round" opacity="0.6"/>`;
  });
  svg += `</svg>`;

  let html = ``;
  people.forEach(p => {
    const startPt = trackPoints[p][0], color = lineColors[p];
    html += `<button onclick='window.renderUBahnPerson(${JSON.stringify(p)})' style="position:absolute;left:${startPt.x - 60}px;top:${startPt.y - 70}px;width:120px;text-align:center;background:none;border:none;cursor:pointer;z-index:10;"><div style="display:inline-block;background:var(--surface);border:4px solid ${color};border-radius:14px;padding:7px 12px;font-family:'Outfit',sans-serif;font-weight:900;font-size:12px;color:var(--text);box-shadow:0 4px 16px ${color}44;">${esc(p)}</div></button>`;
    html += `<div style="position:absolute;left:${startPt.x - 12}px;top:${startPt.y - 12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:1;"></div>`;
    const endPt = trackPoints[p][maxRows];
    html += `<div style="position:absolute;left:${endPt.x - 12}px;top:${endPt.y - 12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:1;"></div>`;
  });

  placedCards.forEach(k => {
    const pt = trackPoints[k.wer][k.row], color = lineColors[k.wer], isHigh = k.prio === 'hoch';
    let transfer = k.gruppe ? Array.from(new Set(allCardsFlat.filter(c => c.gruppe === k.gruppe && c.wer !== k.wer).map(c => c.wer))) : [];
    html += `<div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' style="position:absolute;left:${pt.x-90}px;top:${pt.y-22}px;width:180px;display:flex;flex-direction:column;align-items:center;cursor:pointer;" class="ubahn-station"><div style="width:44px;height:44px;border-radius:50%;background:var(--surface);border:4px solid ${color};display:flex;align-items:center;justify-content:center;font-family:'Outfit',sans-serif;font-weight:900;font-size:13px;color:var(--text);box-shadow:0 4px 14px rgba(0,0,0,0.4);">${esc(k.label)}${isHigh ? `<span style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:var(--danger);border-radius:50%;border:2px solid var(--surface);"></span>` : ''}</div><div class="ubahn-tooltip" style="margin-top:8px;text-align:center;padding:6px 10px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-family:'Outfit',sans-serif;font-size:10px;font-weight:600;color:var(--text);max-width:140%;opacity:0;transition:opacity 0.15s;box-shadow:0 4px 12px rgba(0,0,0,0.15);">${esc(k.titel)}${transfer.length ? `<div style="margin-top:6px;border-top:1px solid var(--border);font-size:9px;color:var(--text-muted);">+ Umstieg: ${esc(transfer.join(', '))}</div>` : ''}</div></div>`;
  });

  container.innerHTML = `<div style="position:relative;width:${mapW}px;height:${mapH}px;margin:0 auto;">${svg}${html}</div>`;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── 5. EINZELPERSON-ANSICHT ───────────────────────────────────
window.renderUBahnPerson = function(workerName) {
  _currentView = 'person'; _currentPerson = workerName;
  ensureVerticalSlider();
  document.getElementById('ubahn-back-btn').style.display = 'inline-flex';
  const container = document.getElementById('ubahn-content');
  const { boardData, allCardsFlat, lineColors } = _data;
  const color = lineColors[workerName] || '#6366f1';
  const myCards = allCardsFlat.filter(c => c.wer === workerName);

  let stationsHtml = ``;
  const X_LINE = 120; let currentY = MARGIN_TOP; const firstY = currentY;

  boardData.forEach(col => {
    const colCards = myCards.filter(c => col.karten.some(kc => kc.id === c.id));
    if (colCards.length > 0) {
      stationsHtml += `<div style="position:absolute; left:${X_LINE + 60}px; top:${currentY - 20}px; font-size:10px; font-weight:900; color:var(--text-muted); text-transform:uppercase; letter-spacing:3px;">${esc(col.spalte)}</div>`;
      colCards.forEach(k => {
        let members = k.gruppe ? Array.from(new Set(allCardsFlat.filter(c => c.gruppe === k.gruppe && c.wer !== workerName).map(c => c.wer))) : [];
        let dotW = members.length ? 64 : 44;
        stationsHtml += `<div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' style="position:absolute; left:${X_LINE-(dotW/2)}px; top:${currentY-22}px; width:${dotW}px; height:44px; border-radius:22px; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-family:'Outfit',sans-serif; font-weight:900; font-size:13px; color:var(--text); box-shadow:0 4px 14px rgba(0,0,0,0.4); cursor:pointer; z-index:2;">${esc(k.label)}${k.prio === 'hoch' ? `<span style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:var(--danger);border-radius:50%;border:2px solid var(--surface);"></span>` : ''}</div>`;
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

// ── 6. DETAIL POPUP & ANIMATION ──────────────────────────────
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

// ── 7. ANIMATION (Unverändert) ──────────────────────────
window.startBoardAnimation = function() {
  if (!_data) _data = prepareBoardData();
  closeModal('modal-ubahn');
  setTimeout(() => {
    const queue = [];
    S.columns.forEach(col => { (S.cards[col.id] || []).forEach(card => {
      const el = document.getElementById('card-' + card.id);
      if (el) queue.push({ el, color: _data.lineColors[card.assignee] || '#6366f1' });
    }); });
    if (!queue.length) return;
    queue.forEach(({ el }) => { el.style.transition = 'none'; el.style.opacity = '0'; el.style.transform = 'scale(0.6) translateY(-8px)'; });
    _anim = { queue, index: 0, paused: false, speed: 400 };
    _showAnimControls(queue.length); _animStep();
  }, 350);
};

function _animStep() {
  if (!_anim || _anim.paused || _anim.index >= _anim.queue.length) { if (_anim?.index >= _anim?.queue.length) _animFinished(); return; }
  const { el, color } = _anim.queue[_anim.index++];
  el.style.transition = 'opacity 0.25s, transform 0.25s, box-shadow 0.25s';
  el.style.opacity = '1'; el.style.transform = 'scale(1) translateY(0)';
  el.style.boxShadow = `0 0 0 3px ${color}, 0 0 20px ${color}88`;
  setTimeout(() => { if (el) el.style.boxShadow = ''; }, 500);
  const bar = document.getElementById('anim-bar-inner'); if (bar) bar.style.width = `${(_anim.index / _anim.queue.length) * 100}%`;
  _anim.timer = setTimeout(_animStep, _anim.speed);
}

function _showAnimControls(total) {
  document.getElementById('anim-controls')?.remove();
  const panel = document.createElement('div'); panel.id = 'anim-controls';
  panel.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:14px 20px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:9000;`;
  panel.innerHTML = `<div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden;width:120px;"><div id="anim-bar-inner" style="height:100%;width:0%;background:var(--accent);transition:width 0.3s;"></div></div><button id="anim-pause-btn" onclick="window.toggleAnimPause()" class="btn-sm btn-sm-primary">Pause</button><button onclick="window.cancelBoardAnimation()" class="btn-sm btn-sm-ghost">✕</button>`;
  document.body.appendChild(panel);
}

function _animFinished() {
  const panel = document.getElementById('anim-controls'); if (!panel) return;
  panel.innerHTML = `<span style="font-size:13px;font-weight:700;color:var(--text);">✓ Fertig</span><button onclick="window.resetBoardAnimation()" class="btn-sm btn-sm-primary">Reset</button><button onclick="document.getElementById('anim-controls').remove()" class="btn-sm btn-sm-ghost">✕</button>`;
}

window.toggleAnimPause = function() { _anim.paused = !_anim.paused; document.getElementById('anim-pause-btn').textContent = _anim.paused ? 'Play' : 'Pause'; if (!_anim.paused) _animStep(); };
window.cancelBoardAnimation = function() { if (_anim) clearTimeout(_anim.timer); _anim = null; document.getElementById('anim-controls')?.remove(); document.querySelectorAll('[id^="card-"]').forEach(el => { el.style.opacity = ''; el.style.transform = ''; }); };
window.resetBoardAnimation = function() { window.cancelBoardAnimation(); setTimeout(window.startBoardAnimation, 200); };

// ── 8. MODAL CONTROLS ────────────────────────────────────────
window.toggleUBahnWide = function() {
  const modal = document.getElementById('modal-ubahn-inner');
  if (modal) modal.classList.toggle('ubahn-wide');
};

function initModalResize() {
  const modal = document.getElementById('modal-ubahn-inner');
  if (!modal) return;
  modal.querySelectorAll('.ubahn-resize-handle').forEach(h => h.remove());
  ['left', 'right'].forEach(side => {
    const h = document.createElement('div');
    h.className = 'ubahn-resize-handle no-print';
    h.style.cssText = `position:absolute; top:0; ${side}:-14px; width:14px; height:100%; cursor:ew-resize; z-index:20;`;
    h.addEventListener('mousedown', e => {
      const startX = e.clientX, startW = modal.offsetWidth;
      const onMove = e => {
        const dx = side === 'right' ? e.clientX - startX : startX - e.clientX;
        modal.style.width = Math.max(420, startW + dx * 2) + 'px';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    modal.appendChild(h);
  });
}

// ── 9. MODAL ÖFFNEN ──────────────────────────────────────────
window.openUBahnModal = function() {
  document.getElementById('modal-ubahn').style.display = 'flex';
  const header = document.querySelector('#modal-ubahn .modal-header-btns');
  if (header && !document.getElementById('ubahn-export-btn')) {
    const btn = document.createElement('button');
    btn.id = 'ubahn-export-btn';
    btn.className = 'btn-icon no-print';
    btn.title = 'Plan exportieren';
    btn.onclick = window.exportUBahnAsImage;
    btn.innerHTML = '<i data-lucide="download"></i>';
    header.prepend(btn);
  }
  initModalResize();
  renderUBahnMap();
};
