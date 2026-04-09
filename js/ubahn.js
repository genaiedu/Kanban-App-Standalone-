// js/ubahn.js — U-Bahn Streckennetz (Agenda) - Live-Tuning Edition
import { S } from './state.js';

const PALETTE = [
  "#ef4444","#3b82f6","#10b981","#f59e0b",
  "#a855f7","#06b6d4","#d946ef","#ec4899",
  "#f97316","#84cc16","#14b8a6","#6366f1"
];

// ── Layout-Variablen (durch Schieberegler manipulierbar) ──
let TRACK_SPACING = 50;  // Horizontaler Spuren-Abstand
let ROW_HEIGHT    = 200; // Vertikaler Bahnhof-Abstand
const MARGIN_TOP  = 120; 
const MARGIN_H    = 220; 

let _data = null; 
let _anim = null; 

// ── XSS-Schutz ───────────────────────────────────────────────
function esc(text) {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  return String(text).replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

// ── 0. SCHIEBEREGLER UI ──────────────────────────────────────
function ensureSliders() {
  if (document.getElementById('ubahn-sliders-panel')) return;
  const modal = document.getElementById('modal-ubahn-inner');
  if (!modal) return;

  const panel = document.createElement('div');
  panel.id = 'ubahn-sliders-panel';
  panel.style.cssText = `
    position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
    background: var(--panel); border: 1px solid var(--border);
    padding: 10px 24px; border-radius: 100px; display: flex; gap: 32px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 1000; align-items: center;
  `;
  panel.innerHTML = `
    <div style="display:flex; align-items:center; gap:12px;">
      <span style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-family:'Outfit', 'DM Sans', sans-serif;">Spur <span id="val-track" style="color:var(--text);">${TRACK_SPACING}</span>px</span>
      <input type="range" min="30" max="150" value="${TRACK_SPACING}" oninput="window.updateUBahnParams('track', this.value)" style="width:100px; cursor:pointer;">
    </div>
    <div style="display:flex; align-items:center; gap:12px;">
      <span style="font-size:11px; font-weight:800; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-family:'Outfit', 'DM Sans', sans-serif;">Reihe <span id="val-row" style="color:var(--text);">${ROW_HEIGHT}</span>px</span>
      <input type="range" min="80" max="500" value="${ROW_HEIGHT}" oninput="window.updateUBahnParams('row', this.value)" style="width:100px; cursor:pointer;">
    </div>
  `;
  modal.appendChild(panel);
}

window.updateUBahnParams = function(type, val) {
  if (type === 'track') {
    TRACK_SPACING = parseInt(val);
    document.getElementById('val-track').textContent = val;
  } else {
    ROW_HEIGHT = parseInt(val);
    document.getElementById('val-row').textContent = val;
  }
  renderUBahnMap(); // Board in Echtzeit neu zeichnen
};

// ── 1. DATEN AUFBEREITEN ─────────────────────────────────────
function prepareBoardData() {
  const peopleSet   = new Set();
  const boardData   = [];
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
    lineColors[p] = i < PALETTE.length
      ? PALETTE[i]
      : `hsl(${Math.floor(Math.random() * 360)},70%,55%)`;
  });

  return { boardData, people, lineColors, allCardsFlat };
}

// ── 2. DYNAMISCHES GRID MIT ROUTING & KREUZUNGSMINIMIERUNG ───
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
      trackPoints[p].push({
        x: MARGIN_H + i * TRACK_SPACING,
        y: MARGIN_TOP + r * ROW_HEIGHT
      });
    });
  };

  recordTracks(currentRow);

  boardData.forEach(col => {
    const phaseStartRow = currentRow;

    col.karten.forEach(card => {
      if (processedLabels.has(card.label)) return;

      let involvedPeople = [];
      let groupCards = [];

      if (card.gruppe) {
        groupCards = col.karten.filter(c => c.gruppe === card.gruppe);
        involvedPeople = Array.from(new Set(groupCards.map(c => c.wer)));
      } else {
        groupCards = [card];
        involvedPeople = [card.wer];
      }

      involvedPeople = involvedPeople.filter(p => people.includes(p));
      if (!involvedPeople.length) return;

      const involved = currentLanes.filter(p => involvedPeople.includes(p));
      const notInvolved = currentLanes.filter(p => !involvedPeople.includes(p));
      
      involved.sort((a, b) => currentLanes.indexOf(a) - currentLanes.indexOf(b));
      notInvolved.sort((a, b) => currentLanes.indexOf(a) - currentLanes.indexOf(b));

      let avgPos = 0;
      if (involved.length > 0) {
        avgPos = involved.reduce((sum, p) => sum + currentLanes.indexOf(p), 0) / involved.length;
      } else {
        avgPos = currentLanes.length / 2;
      }

      let targetIndex = Math.round(avgPos - (involved.length / 2));
      targetIndex = Math.max(0, Math.min(notInvolved.length, targetIndex));

      currentRow++;

      currentLanes = [
        ...notInvolved.slice(0, targetIndex), 
        ...involved, 
        ...notInvolved.slice(targetIndex)
      ];

      recordTracks(currentRow);

      const minCol = targetIndex;
      const maxCol = targetIndex + involved.length - 1;

      if (card.gruppe) {
        transferStations.push({
          name: card.gruppe,
          row: currentRow,
          minCol: minCol,
          maxCol: maxCol
        });
        groupCards.forEach(gc => {
          placedCards.push({ ...gc, row: currentRow });
          processedLabels.add(gc.label);
        });
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

// ── 3. SVG PFAD GENERATOR ────────────────────────────────────
function createTrackPath(points) {
  if (points.length === 0) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i-1];
    const curr = points[i];
    
    if (prev.x !== curr.x) {
      const midY = (prev.y + curr.y) / 2;
      d += ` C ${prev.x} ${midY}, ${curr.x} ${midY}, ${curr.x} ${curr.y}`;
    } else {
      d += ` L ${curr.x} ${curr.y}`;
    }
  }
  return d;
}

// ── 4. GESAMTNETZ RENDERN ────────────────────────────────────
window.renderUBahnMap = function() {
  document.getElementById('ubahn-back-btn').style.display = 'none';
  const container = document.getElementById('ubahn-content');
  ensureSliders();

  if (!S.columns?.length) {
    container.innerHTML = `<div class="empty-state">Kein aktives Board geladen.</div>`;
    return;
  }

  _data = prepareBoardData();
  const { boardData, people, lineColors } = _data;

  if (!people.length) {
    container.innerHTML = `<div class="empty-state" style="text-align:center;padding:40px;">
      <i data-lucide="users" style="width:48px;height:48px;opacity:0.5;margin-bottom:16px;"></i><br>
      Das Streckennetz braucht Fahrgäste!<br>Bitte weise zunächst Personen zu Karten zu.
    </div>`;
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
    return;
  }

  const { placedCards, transferStations, maxRows, phaseBoundaries, trackPoints } = calculateGrid(boardData, people);
  
  const mapW = (people.length - 1) * TRACK_SPACING + MARGIN_H * 2;
  const mapH = maxRows * ROW_HEIGHT + MARGIN_TOP + 100;

  let svg = `<svg width="${mapW}" height="${mapH}" style="position:absolute;inset:0;pointer-events:none;">`;
  
  phaseBoundaries.forEach(p => {
    const y = p.start * ROW_HEIGHT + MARGIN_TOP - (ROW_HEIGHT / 2);
    if (p.start > 0) {
      svg += `
        <line x1="0" y1="${y}" x2="${mapW}" y2="${y}" stroke="var(--border)" stroke-width="3" stroke-dasharray="10 10"/>
        <text x="20" y="${y+22}" fill="var(--text-muted)" font-size="11" font-weight="900"
              font-family="Outfit, DM Sans, sans-serif" letter-spacing="5">${esc(p.name.toUpperCase())}</text>
      `;
    }
  });

  // Halo Effekt für das Radieren der Kreuzungen
  people.forEach((p) => {
    const pathData = createTrackPath(trackPoints[p]);
    svg += `<path d="${pathData}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" opacity="1"/>`;
  });

  // Farbige Linien
  people.forEach((p) => {
    const pathData = createTrackPath(trackPoints[p]);
    svg += `<path d="${pathData}" fill="none" stroke="${lineColors[p]}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
  });

  // Korrigierte Transfer-Pillen (halbtransparent gefüllt)
  transferStations.forEach(s => {
    const x1 = MARGIN_H + s.minCol * TRACK_SPACING;
    const x2 = MARGIN_H + s.maxCol * TRACK_SPACING;
    const y  = s.row * ROW_HEIGHT + MARGIN_TOP;
    
    // fill-opacity erzeugt den milchigen Glas-Effekt
    svg += `
      <rect x="${x1-24}" y="${y-24}" width="${(x2-x1)+48}" height="48" rx="24"
            fill="var(--surface)" fill-opacity="0.8" stroke="var(--border)" stroke-width="4"/>
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"
            stroke="var(--text-muted)" stroke-width="8" stroke-linecap="round" opacity="0.6"/>
    `;
  });
  svg += `</svg>`;

  let html = ``;
  
  people.forEach((p) => {
    const startPos = trackPoints[p][0];
    const color = lineColors[p];
    html += `
      <button onclick="renderUBahnPerson(${JSON.stringify(p)})"
              style="position:absolute;left:${startPos.x - 60}px;top:20px;width:120px;text-align:center;background:none;border:none;cursor:pointer;">
        <div style="display:inline-block;background:var(--surface);border:4px solid ${color};border-radius:14px;padding:7px 12px;
                    font-family:'Outfit','DM Sans',sans-serif;font-weight:900;font-size:12px;
                    letter-spacing:0.5px;text-transform:uppercase;color:var(--text);
                    box-shadow:0 4px 16px ${color}44;transition:transform 0.15s,box-shadow 0.15s;"
             onmouseover="this.style.transform='scale(1.08)';this.style.boxShadow='0 6px 24px ${color}88'"
             onmouseout="this.style.transform='scale(1)';this.style.boxShadow='0 4px 16px ${color}44'">
          ${esc(p)}
        </div>
      </button>
    `;
  });

  placedCards.forEach(k => {
    const pt = trackPoints[k.wer][k.row];
    const color = lineColors[k.wer];
    const isHigh = k.prio === 'hoch';
    
    // Korrektur: pt.y - 22 zentriert den 44px Kreis PERFEKT auf der Linie
    html += `
      <div onclick="showUBahnCardDetail(${JSON.stringify(k.label)})"
           style="position:absolute;left:${pt.x-90}px;top:${pt.y-22}px;width:180px;display:flex;flex-direction:column;align-items:center;cursor:pointer;" class="ubahn-station">
        <div style="width:44px;height:44px;border-radius:50%;background:var(--surface);border:4px solid ${color};
                    display:flex;align-items:center;justify-content:center;
                    font-family:'Outfit','DM Sans',sans-serif;font-weight:900;font-size:13px;
                    color:var(--text);box-shadow:0 4px 14px rgba(0,0,0,0.4);
                    position:relative;z-index:2;transition:transform 0.15s;">
          ${esc(k.label)}
          ${isHigh ? `<span style="position:absolute;top:-4px;right:-4px;width:12px;height:12px;background:var(--danger);border-radius:50%;border:2px solid var(--surface);"></span>` : ''}
        </div>
        <div class="ubahn-tooltip" style="margin-top:8px;text-align:center;padding:4px 10px;
                    background:var(--surface);border:1px solid var(--border);border-radius:6px;
                    font-family:'Outfit','DM Sans',sans-serif;font-size:10px;font-weight:600;
                    letter-spacing:0.3px;color:var(--text);max-width:90%;
                    opacity:0;transition:opacity 0.15s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          ${esc(k.titel)}
        </div>
      </div>
    `;
  });

  container.innerHTML = `
    <div style="position:relative;width:${mapW}px;height:${mapH}px;margin:0 auto;">${svg}${html}</div>
    <style>
      .ubahn-station:hover .ubahn-tooltip { opacity:1 !important; }
      .ubahn-station:hover > div:first-child { transform:scale(1.2); }
    </style>
  `;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── 5. EINZELPERSON-ANSICHT ───────────────────────────────────
window.renderUBahnPerson = function(workerName) {
  document.getElementById('ubahn-back-btn').style.display = 'inline-flex';
  const container = document.getElementById('ubahn-content');
  if (!_data) return;

  const { boardData, allCardsFlat, lineColors } = _data;
  const color = lineColors[workerName] || '#6366f1';
  const myCards = allCardsFlat.filter(c => c.wer === workerName);

  let html = `
    <div style="max-width:800px;margin:0 auto;padding:24px;">
      <div style="display:flex;align-items:center;margin-bottom:32px;border-bottom:1px solid var(--border);padding-bottom:24px;">
        <div style="width:52px;height:52px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;border:4px solid var(--surface);box-shadow:var(--shadow);margin-right:18px;flex-shrink:0;">
          <div style="width:14px;height:14px;background:#fff;border-radius:50%;"></div>
        </div>
        <div>
          <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:var(--text-muted);">Fahrplan / Linie</div>
          <div style="font-size:30px;font-weight:900;color:${color};letter-spacing:-1px;">${esc(workerName.toUpperCase())}</div>
        </div>
      </div>
      <div style="position:relative;padding-left:32px;border-left:6px solid ${color};border-radius:3px;">
  `;

  boardData.forEach(col => {
    const colCards = myCards.filter(c => col.karten.some(kc => kc.id === c.id));
    if (!colCards.length) return;
    html += `
      <div style="margin-bottom:28px;">
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:3px;border-bottom:1px solid var(--border);padding-bottom:8px;margin-bottom:18px;margin-left:20px;">
          ${esc(col.spalte)}
        </div>
        <div style="display:flex;flex-direction:column;gap:18px;">
    `;
    colCards.forEach(k => {
      const depsHtml = k.deps.length
        ? `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;">
            ${k.deps.map(d => `<span style="font-size:10px;font-weight:700;background:var(--surface2);color:var(--text-muted);padding:2px 8px;border-radius:4px;border:1px solid var(--border);">Abhängig von: ${esc(d)}</span>`).join('')}
           </div>` : '';
      html += `
        <div style="position:relative;margin-left:20px;">
          <div style="position:absolute;left:-44px;top:14px;width:18px;height:18px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>
          <div class="card" style="cursor:default;">
            <div style="margin-bottom:8px;">
              <span style="font-size:10px;font-weight:900;background:var(--surface2);color:var(--text-muted);padding:2px 8px;border-radius:4px;border:1px solid var(--border);">Station ${esc(k.label)}</span>
            </div>
            <div style="font-size:15px;font-weight:600;line-height:1.4;">${esc(k.titel)}</div>
            ${depsHtml}
          </div>
        </div>
      `;
    });
    html += `</div></div>`;
  });

  html += `</div></div>`;
  container.innerHTML = html;
};

// ── 6. STATIONS-DETAIL-POPUP ─────────────────────────────────
window.showUBahnCardDetail = function(label) {
  if (!_data) return;
  const card = _data.allCardsFlat.find(c => c.label === label);
  if (!card) return;
  const color = _data.lineColors[card.wer] || '#6366f1';
  const depsHtml = card.deps.length
    ? `<div style="background:var(--surface);padding:14px;border-radius:12px;border:1px solid var(--border);margin-top:16px;">
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">Wartet auf Signal von:</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${card.deps.map(d => `<span style="background:var(--surface2);color:var(--text);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid var(--border);">${esc(d)}</span>`).join('')}
        </div>
       </div>` : '';

  document.getElementById('ubahn-card-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ubahn-card-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--panel);border-radius:20px;max-width:480px;width:100%;border:1px solid var(--border);box-shadow:0 20px 60px rgba(0,0,0,0.6);overflow:hidden;">
      <div style="height:5px;background:${color};"></div>
      <div style="padding:28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <div style="width:48px;height:48px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:16px;color:#fff;border:3px solid var(--surface);">
            ${esc(card.label)}
          </div>
          <button onclick="document.getElementById('ubahn-card-overlay').remove()"
                  style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:22px;line-height:1;padding:4px;">✕</button>
        </div>
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Linie ${esc(card.wer)}</div>
        <div style="font-size:20px;font-weight:700;line-height:1.4;color:var(--text);">${esc(card.titel)}</div>
        ${depsHtml}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
};

// ── 7. BOARD-ANIMATION (Unverändert) ──────────────────────────
window.startBoardAnimation = function() {
  if (!_data) _data = prepareBoardData();
  closeModal('modal-ubahn');

  setTimeout(() => {
    const queue = [];
    S.columns.forEach(col => {
      (S.cards[col.id] || []).forEach(card => {
        const el = document.getElementById('card-' + card.id);
        if (!el) return;
        const color = _data.lineColors[card.assignee] || '#6366f1';
        queue.push({ el, color });
      });
    });

    if (!queue.length) return;

    queue.forEach(({ el }) => {
      el.style.transition = 'none';
      el.style.opacity    = '0';
      el.style.transform  = 'scale(0.6) translateY(-8px)';
    });

    _anim = { queue, index: 0, paused: false, timer: null, speed: 400 };
    _showAnimControls(queue.length);
    _animStep();
  }, 350);
};

function _animStep() {
  if (!_anim || _anim.paused) return;
  if (_anim.index >= _anim.queue.length) {
    _animFinished();
    return;
  }

  const { el, color } = _anim.queue[_anim.index];
  _anim.index++;

  el.style.transition = 'opacity 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease';
  el.style.opacity    = '1';
  el.style.transform  = 'scale(1) translateY(0)';
  el.style.boxShadow  = `0 0 0 3px ${color}, 0 0 20px ${color}88`;

  setTimeout(() => {
    if (el) el.style.boxShadow = '';
  }, 500);

  const prog = document.getElementById('anim-progress');
  if (prog) prog.textContent = `${_anim.index} / ${_anim.queue.length}`;
  const bar = document.getElementById('anim-bar-inner');
  if (bar) bar.style.width = `${(_anim.index / _anim.queue.length) * 100}%`;

  _anim.timer = setTimeout(_animStep, _anim.speed);
}

function _showAnimControls(total) {
  document.getElementById('anim-controls')?.remove();
  const panel = document.createElement('div');
  panel.id = 'anim-controls';
  panel.style.cssText = `
    position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    background:var(--panel);border:1px solid var(--border);border-radius:16px;
    padding:14px 20px;display:flex;align-items:center;gap:14px;
    box-shadow:0 8px 32px rgba(0,0,0,0.5);z-index:9000;min-width:320px;flex-wrap:wrap;
  `;
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:160px;">
      <div style="flex:1;height:6px;background:var(--surface);border-radius:3px;overflow:hidden;">
        <div id="anim-bar-inner" style="height:100%;width:0%;background:var(--accent);border-radius:3px;transition:width 0.3s;"></div>
      </div>
      <span id="anim-progress" style="font-size:12px;font-weight:700;color:var(--text-muted);white-space:nowrap;">0 / ${total}</span>
    </div>
    <button id="anim-pause-btn" onclick="window.toggleAnimPause()"
            class="btn-sm btn-sm-primary" style="display:flex;align-items:center;gap:6px;">
      <i data-lucide="pause" style="width:13px;height:13px;"></i> Pause
    </button>
    <button onclick="window.cancelBoardAnimation()"
            class="btn-sm btn-sm-ghost">✕ Abbrechen</button>
  `;
  document.body.appendChild(panel);
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
}

function _animFinished() {
  clearTimeout(_anim?.timer);
  const panel = document.getElementById('anim-controls');
  if (!panel) return;
  panel.innerHTML = `
    <span style="font-size:13px;font-weight:700;color:var(--text);">✓ Alle Karten platziert</span>
    <button onclick="window.resetBoardAnimation()" class="btn-sm btn-sm-primary" style="display:flex;align-items:center;gap:6px;">
      <i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i> Board zurücksetzen
    </button>
    <button onclick="document.getElementById('anim-controls').remove()" class="btn-sm btn-sm-ghost">✕</button>
  `;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
}

window.toggleAnimPause = function() {
  if (!_anim) return;
  _anim.paused = !_anim.paused;
  const btn = document.getElementById('anim-pause-btn');
  if (!btn) return;
  if (_anim.paused) {
    btn.innerHTML = '<i data-lucide="play" style="width:13px;height:13px;"></i> Weiter';
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 30);
  } else {
    btn.innerHTML = '<i data-lucide="pause" style="width:13px;height:13px;"></i> Pause';
    if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 30);
    _animStep();
  }
};

window.cancelBoardAnimation = function() {
  if (_anim) { clearTimeout(_anim.timer); _anim = null; }
  document.getElementById('anim-controls')?.remove();
  document.querySelectorAll('[id^="card-"]').forEach(el => {
    el.style.transition = '';
    el.style.opacity    = '';
    el.style.transform  = '';
    el.style.boxShadow  = '';
  });
};

window.resetBoardAnimation = function() {
  if (_anim) { clearTimeout(_anim.timer); _anim = null; }
  document.getElementById('anim-controls')?.remove();
  document.querySelectorAll('[id^="card-"]').forEach(el => {
    el.style.transition = 'none';
    el.style.opacity    = '0';
    el.style.transform  = 'scale(0.6) translateY(-8px)';
    el.style.boxShadow  = '';
  });
  setTimeout(() => {
    if (!_data) _data = prepareBoardData();
    const queue = [];
    S.columns.forEach(col => {
      (S.cards[col.id] || []).forEach(card => {
        const el = document.getElementById('card-' + card.id);
        if (!el) return;
        const color = _data.lineColors[card.assignee] || '#6366f1';
        queue.push({ el, color });
      });
    });
    if (!queue.length) return;
    _anim = { queue, index: 0, paused: false, timer: null, speed: 400 };
    _showAnimControls(queue.length);
    _animStep();
  }, 200);
};

// ── 8. BREIT/SCHMAL TOGGLE ───────────────────────────────────
window.toggleUBahnWide = function() {
  const modal = document.getElementById('modal-ubahn-inner');
  const btn   = document.getElementById('ubahn-wide-btn');
  if (!modal) return;
  const isWide = modal.classList.toggle('ubahn-wide');
  btn.innerHTML = isWide
    ? '<i data-lucide="minimize-2" style="width:13px;height:13px;"></i>'
    : '<i data-lucide="maximize-2" style="width:13px;height:13px;"></i>';
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 30);
};

// ── 9. RESIZE-HANDLES ────────────────────────────────────────
function initModalResize() {
  const modal = document.getElementById('modal-ubahn-inner');
  if (!modal) return;

  modal.querySelectorAll('.ubahn-resize-handle').forEach(h => h.remove());

  const grip = `
    <svg width="4" height="40" viewBox="0 0 4 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      ${[6,14,22,30,38].map(y => `<circle cx="2" cy="${y}" r="1.5" fill="currentColor"/>`).join('')}
    </svg>
  `;

  ['left', 'right'].forEach(side => {
    const h = document.createElement('div');
    h.className = 'ubahn-resize-handle';
    h.title = 'Breite ändern';
    h.style.cssText = `
      position:absolute; top:0; ${side}:-14px;
      width:14px; height:100%;
      cursor:ew-resize; z-index:20;
      display:flex; align-items:center; justify-content:center;
      color:var(--border); opacity:0.5;
      transition:opacity 0.15s, color 0.15s;
      user-select:none;
    `;
    h.innerHTML = grip;
    h.addEventListener('mouseenter', () => { h.style.opacity='1'; h.style.color='var(--accent)'; });
    h.addEventListener('mouseleave', () => { h.style.opacity='0.5'; h.style.color='var(--border)'; });

    h.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = modal.offsetWidth;

      const onMove = e => {
        const dx = side === 'right' ? e.clientX - startX : startX - e.clientX;
        const newW = Math.min(
          Math.max(420, startW + dx * 2), 
          window.innerWidth - 40
        );
        modal.style.width    = newW + 'px';
        modal.style.maxWidth = '95vw';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      };

      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    modal.appendChild(h);
  });
}

// ── 10. MODAL ÖFFNEN ──────────────────────────────────────────
window.openUBahnModal = function() {
  document.getElementById('modal-ubahn').style.display = 'flex';
  initModalResize();
  renderUBahnMap();
};
