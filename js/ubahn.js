// js/ubahn.js — U-Bahn Streckennetz (Agenda) - PRO Edition mit Snapshot & Rollback
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
let _cardSnapshots = []; // Speichert den DOM-Zustand des Boards

function esc(text) {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  return String(text).replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

// ── 0. FULL-LENGTH EXPORT ───────────────────────────────────
window.exportUBahnAsImage = function() {
  const originalContent = document.getElementById('ubahn-content');
  if (!originalContent) return;
  const mapWrapper = originalContent.querySelector('div');
  const fullHeight = mapWrapper ? mapWrapper.scrollHeight : 3000;
  const fullWidth  = mapWrapper ? mapWrapper.scrollWidth : 1400;
  const printWindow = window.open('', '_blank');
  const styles = Array.from(document.styleSheets).map(s => { try { return Array.from(s.cssRules).map(r => r.cssText).join(''); } catch(e) { return ''; }}).join('');
  printWindow.document.write(`<html><head><title>U-Bahn Plan Export</title><style>${styles}body { background: #1a1a1a !important; margin: 0; padding: 40px; overflow: visible !important; width: ${fullWidth}px; }#print-area { width: ${fullWidth}px; height: ${fullHeight}px; position: relative; }.no-print, #ubahn-controls-panel, #anim-controls, #ubahn-back-btn { display: none !important; }svg { overflow: visible !important; }@media print { @page { size: ${fullWidth}px ${fullHeight}px; margin: 0; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style></head><body><div id="print-area">${originalContent.innerHTML}</div><script>window.onload=()=>{setTimeout(()=>{window.print();window.close();},1200);};</script></body></html>`);
  printWindow.document.close();
};

// ── 1. KONTROLL-PANEL ────────────────────────────────────────
function ensureControls() {
  if (document.getElementById('ubahn-controls-panel')) return;
  const modal = document.getElementById('modal-ubahn-inner');
  if (!modal) return;
  const panel = document.createElement('div');
  panel.id = 'ubahn-controls-panel';
  panel.className = 'no-print';
  panel.style.cssText = `position: absolute; left: 20px; top: 100px; background: var(--panel); border: 1px solid var(--border); width: 56px; padding: 22px 0; border-radius: 30px; display: flex; flex-direction: column; align-items: center; gap: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); z-index: 10001;`;
  panel.innerHTML = `<button onclick="window.exportUBahnAsImage()" style="background:var(--surface2); border:1px solid var(--border); width:38px; height:38px; border-radius:50%; color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center;"><i data-lucide="download" style="width:20px; height:20px;"></i></button><div style="height:1px; width:24px; background:var(--border);"></div><div style="font-size:9px; font-weight:900; color:var(--text-muted); text-transform:uppercase; writing-mode:vertical-rl; transform:rotate(180deg); letter-spacing:1px;">Abstand</div><div style="height: 140px; display: flex; align-items: center;"><input type="range" min="60" max="450" value="${ROW_HEIGHT}" oninput="window.updateUBahnRowHeight(this.value)" style="width: 130px; transform: rotate(-90deg); cursor: pointer; accent-color: var(--accent); margin: 0; background:transparent;"></div><div id="val-row" style="font-size:10px; font-weight:900; color:var(--text);">${ROW_HEIGHT}px</div>`;
  modal.appendChild(panel);
  if (typeof reloadIcons === 'function') reloadIcons();
}

window.updateUBahnRowHeight = function(val) {
  ROW_HEIGHT = parseInt(val);
  document.getElementById('val-row').textContent = val + 'px';
  if (_currentView === 'map') renderUBahnMap(); else renderUBahnPerson(_currentPerson);
};

// ── 2. GRID LOGIK ────────────────────────────────────────────
function prepareBoardData() {
  const peopleSet = new Set(), boardData = [], allCardsFlat = [];
  S.columns.forEach(col => {
    const colCards = (S.cards[col.id] || []).filter(c => c.assignee);
    colCards.forEach(card => {
      peopleSet.add(card.assignee);
      allCardsFlat.push({ id: card.id, label: card.label || '?', titel: card.text, wer: card.assignee, prio: card.priority || 'mittel', deps: card.dependencies || [], gruppe: card.groupId || null });
    });
    if (colCards.length) boardData.push({ spalte: col.name, karten: colCards.map(c => allCardsFlat.find(f => f.id === c.id)) });
  });
  const people = Array.from(peopleSet), colors = {};
  people.forEach((p, i) => { colors[p] = i < PALETTE.length ? PALETTE[i] : `hsl(${Math.floor(Math.random() * 360)},70%,55%)`; });
  return { boardData, people, lineColors: colors, allCardsFlat };
}

function calculateGrid(boardData, people) {
  let placedCards = [], transferStations = [], processed = new Set(), lanes = [...people], trackPoints = {};
  people.forEach(p => trackPoints[p] = []);
  let currentRow = 0;
  const record = (r) => { lanes.forEach((p, i) => { trackPoints[p].push({ x: MARGIN_H + i * TRACK_SPACING, y: MARGIN_TOP + r * ROW_HEIGHT }); }); };
  record(currentRow);
  boardData.forEach(col => {
    const pStart = currentRow;
    col.karten.forEach(card => {
      if (processed.has(card.label)) return;
      let inv = card.gruppe ? Array.from(new Set(col.karten.filter(c => c.gruppe === card.gruppe).map(c => c.wer))) : [card.wer];
      inv = inv.filter(p => people.includes(p)); if (!inv.length) return;
      const involved = lanes.filter(p => inv.includes(p)), others = lanes.filter(p => !inv.includes(p));
      involved.sort((a,b) => lanes.indexOf(a) - lanes.indexOf(b));
      let avg = involved.reduce((s, p) => s + lanes.indexOf(p), 0) / involved.length;
      let target = Math.max(0, Math.min(others.length, Math.round(avg - (involved.length / 2))));
      currentRow++; lanes = [...others.slice(0, target), ...involved, ...others.slice(target)]; record(currentRow);
      if (card.gruppe) {
        transferStations.push({ name: card.gruppe, row: currentRow, minCol: target, maxCol: target + involved.length - 1 });
        col.karten.filter(c => c.gruppe === card.gruppe).forEach(gc => { placedCards.push({ ...gc, row: currentRow }); processed.add(gc.label); });
      } else { placedCards.push({ ...card, row: currentRow }); processed.add(card.label); }
    });
    if (currentRow === pStart) currentRow++;
  });
  currentRow++; record(currentRow);
  return { placedCards, transferStations, maxRows: currentRow, trackPoints };
}

function createTrackPath(pts) {
  if (!pts.length) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i-1], c = pts[i];
    if (p.x !== c.x) { const mY = (p.y + c.y) / 2; d += ` C ${p.x} ${mY}, ${c.x} ${mY}, ${c.x} ${c.y}`; }
    else d += ` L ${c.x} ${c.y}`;
  }
  return d;
}

// ── 3. RENDERN ───────────────────────────────────────────────
window.renderUBahnMap = function() {
  _currentView = 'map'; _currentPerson = null;
  ensureControls();
  document.getElementById('ubahn-back-btn').style.display = 'none';
  const container = document.getElementById('ubahn-content');
  _data = prepareBoardData();
  const { boardData, people, lineColors, allCardsFlat } = _data;
  if (!people.length) return;
  const { placedCards, transferStations, maxRows, trackPoints } = calculateGrid(boardData, people);
  const mapW = (people.length - 1) * TRACK_SPACING + MARGIN_H * 2, mapH = maxRows * ROW_HEIGHT + MARGIN_TOP + 100;

  let svg = `<svg width="${mapW}" height="${mapH}" style="position:absolute;inset:0;pointer-events:none;z-index:1;">`;
  people.forEach(p => svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" opacity="1"/>`);
  people.forEach(p => svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="${lineColors[p]}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`);
  transferStations.forEach(s => {
    const x1 = MARGIN_H + s.minCol * TRACK_SPACING, x2 = MARGIN_H + s.maxCol * TRACK_SPACING, y = s.row * ROW_HEIGHT + MARGIN_TOP;
    svg += `<rect x="${x1-24}" y="${y-24}" width="${(x2-x1)+48}" height="48" rx="24" fill="#ffffff15" stroke="var(--border)" stroke-width="3"/><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="var(--text-muted)" stroke-width="8" stroke-linecap="round" opacity="0.6"/>`;
  });
  svg += `</svg>`;

  let html = ``;
  people.forEach(p => {
    const sPt = trackPoints[p][0], ePt = trackPoints[p][maxRows], color = lineColors[p];
    html += `<button onclick='window.renderUBahnPerson(${JSON.stringify(p)})' style="position:absolute;left:${sPt.x - 60}px;top:${sPt.y - 70}px;width:120px;text-align:center;background:none;border:none;cursor:pointer;z-index:1001;"><div style="display:inline-block;background:var(--surface);border:4px solid ${color};border-radius:14px;padding:7px 12px;font-weight:900;font-size:12px;color:var(--text);box-shadow:0 4px 16px ${color}44;">${esc(p)}</div></button>`;
    html += `<div style="position:absolute;left:${sPt.x-12}px;top:${sPt.y-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
    html += `<div style="position:absolute;left:${ePt.x-12}px;top:${ePt.y-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
  });

  placedCards.forEach(k => {
    const pt = trackPoints[k.wer][k.row], color = lineColors[k.wer], isHigh = k.prio === 'hoch';
    html += `
      <div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' 
           style="position:absolute;left:${pt.x-90}px;top:${pt.y-22}px;width:180px;display:flex;justify-content:center;align-items:center;cursor:pointer;z-index:1002;" class="ubahn-station">
        <div style="position:relative; width:44px; height:44px; border-radius:50%; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; color:var(--text); box-shadow:0 4px 14px rgba(0,0,0,0.4);">
          ${esc(k.label)}
          ${isHigh ? `<span style="position:absolute; top:-4px; right:-4px; width:12px; height:12px; background:#ef4444; border-radius:50%; border:2px solid var(--surface); z-index:10;"></span>` : ''}
        </div>
      </div>`;
  });
  container.innerHTML = `<div style="position:relative;width:${mapW}px;height:${mapH}px;margin:0 auto;">${svg}${html}</div>`;
};

// ── 4. PERSONEN ANSICHT ──────────────────────────────────────
window.renderUBahnPerson = function(workerName) {
  _currentView = 'person'; _currentPerson = workerName;
  ensureControls();
  document.getElementById('ubahn-back-btn').style.display = 'inline-flex';
  const container = document.getElementById('ubahn-content');
  const { boardData, allCardsFlat, lineColors } = _data;
  const color = lineColors[workerName], myCards = allCardsFlat.filter(c => c.wer === workerName);
  let stationsHtml = ``; const X_LINE = 120; let currentY = MARGIN_TOP; const firstY = currentY;
  
  boardData.forEach(col => {
    const colCards = myCards.filter(c => col.karten.some(kc => kc.id === c.id));
    if (colCards.length > 0) {
      stationsHtml += `<div style="position:absolute; left:${X_LINE+60}px; top:${currentY-20}px; font-size:10px; font-weight:900; color:var(--text-muted); text-transform:uppercase; letter-spacing:3px;">${esc(col.spalte)}</div>`;
      colCards.forEach(k => {
        let members = k.gruppe ? Array.from(new Set(allCardsFlat.filter(c => c.gruppe === k.gruppe && c.wer !== workerName).map(c => c.wer))) : [];
        let dotW = members.length ? 64 : 44;
        let isHigh = k.prio === 'hoch';
        stationsHtml += `
          <div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' 
               style="position:absolute; left:${X_LINE-(dotW/2)}px; top:${currentY-22}px; width:${dotW}px; height:44px; border-radius:22px; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-weight:900; color:var(--text); cursor:pointer; z-index:1002; position:relative;">
            ${esc(k.label)}
            ${isHigh ? `<span style="position:absolute; top:-4px; right:-4px; width:12px; height:12px; background:#ef4444; border-radius:50%; border:2px solid var(--surface); z-index:10;"></span>` : ''}
          </div>`;
        stationsHtml += `<div style="position:absolute; left:${X_LINE+50}px; top:${currentY-26}px; width:340px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; z-index:1001;"><div style="font-size:14px; font-weight:700;">${esc(k.titel)}</div>${members.length ? `<div style="margin-top:10px; display:flex; gap:5px;">${members.map(m => `<span style="width:10px; height:10px; border-radius:50%; background:${lineColors[m]}; border:1px solid #fff;" title="${esc(m)}"></span>`).join('')}</div>` : ''}</div>`;
        currentY += ROW_HEIGHT + (members.length ? 40 : 0);
      });
      currentY += 40;
    }
  });
  stationsHtml += `<div style="position:absolute;left:${X_LINE-12}px;top:${firstY-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div><div style="position:absolute;left:${X_LINE-12}px;top:${currentY-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
  const svg = `<svg width="100%" height="${currentY+50}" style="position:absolute;inset:0;pointer-events:none;z-index:1;"><path d="M ${X_LINE} ${firstY} L ${X_LINE} ${currentY}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linecap="round"/><path d="M ${X_LINE} ${firstY} L ${X_LINE} ${currentY}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" opacity="0.85"/></svg>`;
  container.innerHTML = `<div style="position:relative; padding:24px; min-height:${currentY+100}px;">${svg}${stationsHtml}</div>`;
};

// ── 5. ANIMATION MIT FULL SNAPSHOT & AUTO-HIDE ──────────────
window.startBoardAnimation = function() {
  if (!_data) _data = prepareBoardData();
  
  // 1. SNAPSHOT DES BOARDS ERSTELLEN (Für echtes Rollback)
  _cardSnapshots = [];
  S.columns.forEach(col => {
    const parent = document.querySelector(`.column[data-id="${col.id}"] .column-content`);
    if (parent) {
      const cards = Array.from(parent.querySelectorAll('[id^="card-"]'));
      cards.forEach(el => {
        _cardSnapshots.push({ 
          el, 
          parent, 
          nextSibling: el.nextSibling, // Sichert die exakte Position in der Liste
          opacity: el.style.opacity, 
          transform: el.style.transform, 
          boxShadow: el.style.boxShadow 
        });
      });
    }
  });

  // 2. MODAL SCHLIESSEN (Freie Sicht auf das Board)
  document.getElementById('modal-ubahn').style.display = 'none';

  setTimeout(() => {
    const queue = [];
    S.columns.forEach(col => {
      (S.cards[col.id] || []).forEach(card => {
        const el = document.getElementById('card-' + card.id);
        if (el) {
          el.style.opacity = '0';
          el.style.transform = 'scale(0.8) translateY(20px)';
          queue.push({ el, color: _data.lineColors[card.assignee] || '#6366f1' });
        }
      });
    });

    if (!queue.length) return;
    _anim = { queue, index: 0, paused: false, speed: 400 };
    _showAnimControls(queue.length); 
    _animStep();
  }, 300);
};

function _animStep() {
  if (!_anim || _anim.paused) return;
  
  // PRÜFUNG: Wenn Index >= Queue, dann fertig
  if (_anim.index >= _anim.queue.length) { 
    _animFinished(); 
    return; 
  }
  
  const { el, color } = _anim.queue[_anim.index++];
  el.style.transition = 'all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  el.style.opacity = '1';
  el.style.transform = 'scale(1) translateY(0)';
  el.style.boxShadow = `0 0 0 3px ${color}, 0 10px 40px ${color}55`;
  
  setTimeout(() => { if (el) el.style.boxShadow = ''; }, 700);
  
  const bar = document.getElementById('anim-bar-inner');
  if (bar) bar.style.width = `${(_anim.index / _anim.queue.length) * 100}%`;
  
  _anim.timer = setTimeout(_animStep, _anim.speed);
}

function _showAnimControls(total) {
  document.getElementById('anim-controls')?.remove();
  const panel = document.createElement('div'); panel.id = 'anim-controls';
  panel.style.cssText = `position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--border);border-radius:100px;padding:12px 24px;display:flex;align-items:center;gap:16px;box-shadow:0 15px 50px rgba(0,0,0,0.5);z-index:20001;`;
  panel.innerHTML = `<div style="height:4px;background:var(--surface);border-radius:2px;width:120px;overflow:hidden;"><div id="anim-bar-inner" style="height:100%;width:0%;background:var(--accent);transition:width 0.3s;"></div></div><button id="anim-pause-btn" onclick="window.toggleAnimPause()" class="btn-sm btn-sm-primary">Pause</button><button onclick="window.cancelBoardAnimation()" class="btn-sm btn-sm-ghost">✕ Abbrechen</button>`;
  document.body.appendChild(panel);
}

window.cancelBoardAnimation = function() {
  if (_anim) clearTimeout(_anim.timer); _anim = null;
  document.getElementById('anim-controls')?.remove();
  
  // SNAPSHOT WIEDERHERSTELLEN (Original DOM-Struktur & Styles)
  _cardSnapshots.forEach(snap => {
    snap.el.style.opacity = snap.opacity;
    snap.el.style.transform = snap.transform;
    snap.el.style.boxShadow = snap.boxShadow;
    snap.el.style.transition = '';
    // Sicherstellen, dass die Karte wieder am exakt richtigen Platz im Baum landet
    if (snap.nextSibling) {
      snap.parent.insertBefore(snap.el, snap.nextSibling);
    } else {
      snap.parent.appendChild(snap.el);
    }
  });
};

function _animFinished() {
  const panel = document.getElementById('anim-controls'); if (!panel) return;
  panel.innerHTML = `<span style="font-size:13px;font-weight:900;color:var(--text);">✓ Board vollständig</span><button onclick="window.cancelBoardAnimation()" class="btn-sm btn-sm-primary" style="margin-left:10px;">Board wiederherstellen</button>`;
}

window.toggleAnimPause = function() {
  _anim.paused = !_anim.paused;
  document.getElementById('anim-pause-btn').textContent = _anim.paused ? 'Play' : 'Pause';
  if (!_anim.paused) _animStep();
};

// ── 6. DETAIL POPUP & ÖFFNEN ────────────────────────────────
window.showUBahnCardDetail = function(label) {
  const card = _data.allCardsFlat.find(c => c.label === label); if (!card) return;
  document.getElementById('ubahn-card-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ubahn-card-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:20005;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `<div style="background:var(--panel);border-radius:24px;width:92%;max-width:420px;border:1px solid var(--border);padding:35px;position:relative;box-shadow: 0 30px 90px rgba(0,0,0,0.5);"><button onclick="this.parentElement.parentElement.remove()" style="position:absolute;right:25px;top:25px;background:none;border:none;color:var(--text-muted);font-size:24px;cursor:pointer;">✕</button><div style="width:54px;height:54px;border-radius:50%;background:${_data.lineColors[card.wer]};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;margin-bottom:25px;color:#fff;border:3px solid var(--surface);">${esc(card.label)}</div><div style="font-size:11px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Linie ${esc(card.wer)}</div><div style="font-size:22px;font-weight:700;line-height:1.4;">${esc(card.titel)}</div></div>`;
  document.body.appendChild(overlay);
};

window.openUBahnModal = function() {
  document.getElementById('modal-ubahn').style.display = 'flex';
  ensureControls();
  renderUBahnMap();
};
