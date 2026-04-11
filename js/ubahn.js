// js/ubahn.js — U-Bahn Streckennetz (Agenda) - PRO Edition mit Snapshot & Rollback
import { S, moveCard, getCards, updateCard } from './state.js';
import { showGanttView } from './gantt.js';

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
let _cardSnapshots = [];
let _lastGrid = null; // Grid-Ergebnis für Scroll-to-card // Speichert den DOM-Zustand des Boards

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
  panel.style.cssText = `position: absolute; left: 20px; top: 100px; background: rgba(var(--panel-rgb),1); border: 1px solid var(--border); width: 56px; padding: 22px 0; border-radius: 30px; display: flex; flex-direction: column; align-items: center; gap: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.4); z-index: 10001;`;
panel.innerHTML = `
    <button onclick="window.exportUBahnAsImage()" style="background:var(--surface2); border:1px solid var(--border); width:38px; height:38px; border-radius:50%; color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center;" title="Plan exportieren">
      <i data-lucide="download" style="width:20px; height:20px;"></i>
    </button>
    
    <button onclick="window.openGanttFromUBahn()" style="background:var(--surface2); border:1px solid var(--border); width:38px; height:38px; border-radius:50%; color:var(--text); cursor:pointer; display:flex; align-items:center; justify-content:center; margin-top:10px;" title="Projekt-Analyse (Gantt)">
      <i data-lucide="layout-dashboard" style="width:20px; height:20px; color:var(--accent);"></i>
    </button>

    <div style="height:1px; width:24px; background:var(--border); margin:15px 0;"></div>
    
    <div style="font-size:9px; font-weight:900; color:var(--text-muted); text-transform:uppercase; writing-mode:vertical-rl; transform:rotate(180deg); letter-spacing:1px;">Abstand</div>
    <div style="height: 140px; display: flex; align-items: center;">
      <input type="range" min="60" max="450" value="${ROW_HEIGHT}" oninput="window.updateUBahnRowHeight(this.value)" style="width: 130px; transform: rotate(-90deg); cursor: pointer; accent-color: var(--accent); margin: 0; background:transparent;">
    </div>
    <div id="val-row" style="font-size:10px; font-weight:900; color:var(--text);">${ROW_HEIGHT}px</div>
  `;
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
      allCardsFlat.push({ id: card.id, label: card.label || '?', titel: card.text, wer: card.assignee, prio: card.priority || 'mittel', deps: card.dependencies || [], gruppe: card.groupId || null, colName: col.name, description: card.description || '' });
    });
    if (colCards.length) boardData.push({ spalte: col.name, karten: colCards.map(c => allCardsFlat.find(f => f.id === c.id)) });
  });
  const people = Array.from(peopleSet), colors = {};
  people.forEach((p, i) => { colors[p] = i < PALETTE.length ? PALETTE[i] : `hsl(${Math.floor(Math.random() * 360)},70%,55%)`; });
  return { boardData, people, lineColors: colors, allCardsFlat };
}

// Topologische Sortierung: Abhängigkeiten strikt auflösen (mit Pfad-Tracking für Warnungen)
function topoSortCards(cards) {
  // Map aufbauen: Erlaubt Suche nach ID UND Label!
  const byKey = new Map();
  cards.forEach(c => {
    if (c.id) byKey.set(c.id, c);
    if (c.label) byKey.set(c.label, c);
  });

  const visited = new Set();
  const visiting = new Set(); 
  const result = [];

  // Rekursive Suchfunktion (gibt den aktuellen "Pfad" mit, um Zirkel zu protokollieren)
  function visit(card, path = []) {
    // Wenn schon final verarbeitet, überspringen
    if (visited.has(card.id)) return;
    
    // Zirkuläre Abhängigkeit entdeckt (A -> B -> A)! 
    if (visiting.has(card.id)) {
      // Den kompletten Kreis-Pfad als Text zusammenbauen
      const cyclePath = [...path, card.label || card.id].join(' ➔ ');
      
      console.warn("Zirkuläre Abhängigkeit ignoriert:", cyclePath);
      // Rotes Toast-Popup auf dem Bildschirm für den Nutzer
      if (typeof window.showToast === 'function') {
        window.showToast(`⚠️ Logik-Fehler: Zirkel ignoriert (${cyclePath})`, 'error');
      }
      return; 
    }
    
    visiting.add(card.id); // Karte wird gerade untersucht
    
    // Aktuelle Karte an den Pfad anhängen für die nächste Ebene
    const currentPath = [...path, card.label || card.id];

    // 1. Abhängigkeiten der Karte sammeln
    let allDeps = [...(card.deps || [])];

    // 2. Gruppen-Partner prüfen: Die Karte muss auch auf die Abhängigkeiten der Gruppe warten
    if (card.gruppe) {
      const groupPartners = cards.filter(c => c.gruppe === card.gruppe && c.id !== card.id);
      groupPartners.forEach(partner => {
        if (partner.deps) allDeps.push(...partner.deps);
      });
    }

    // Abhängigkeiten besuchen und den Pfad weiterreichen
    allDeps.forEach(depKey => { 
      const d = byKey.get(depKey); 
      if (d) visit(d, currentPath); 
    });

    visiting.delete(card.id);
    visited.add(card.id);
    result.push(card);
  }

  // Rekursion für alle Karten starten
  cards.forEach(c => visit(c));
  return result;
}

function calculateGrid(boardData, people) {
  let placedCards = [], transferStations = [], processed = new Set();
  const personNextRow = {};
  people.forEach(p => personNextRow[p] = 1);
  let maxRow = 0;
  const cardRowById = {};
  const rowEvents = {};

  const allCards = boardData.flatMap(col => col.karten);
  const sortedCards = topoSortCards(allCards);

  // --- PASS 1: REIHENFOLGE & GRUPPEN (KORRIGIERT) ---
  sortedCards.forEach(card => {
    if (processed.has(card.label)) return;

    // 1. Alle Mitglieder der Gruppe finden
    const groupMembers = card.gruppe 
      ? allCards.filter(c => c.gruppe === card.gruppe)
      : [card];

    // 2. PRÜFUNG: Sind wirklich ALLE Abhängigkeiten ALLER Gruppenmitglieder bereits platziert?
    // Falls nicht, überspringen wir diese Karte vorerst (sie kommt später in sortedCards nochmal dran)
    const allGroupDeps = groupMembers.flatMap(m => m.deps || []);
    const allDepsReady = allGroupDeps.every(depId => cardRowById[depId] !== undefined);
    
    if (!allDepsReady && card.gruppe) {
       // Wenn die Gruppe noch nicht bereit ist, warten wir auf das nächste Mitglied in sortedCards
       return; 
    }

    // 3. Wenn wir hier sind, wird die Karte (oder die ganze Gruppe) platziert
    let inv = card.gruppe
      ? Array.from(new Set(groupMembers.map(c => c.wer)))
      : [card.wer];
    inv = inv.filter(p => people.includes(p));

    // 4. Die frühestmögliche Reihe für die gesamte Gruppe berechnen
    const depMinRow = allGroupDeps.reduce((m, depId) => {
      const r = cardRowById[depId];
      return r !== undefined ? Math.max(m, r + 1) : m;
    }, 1); 

    const row = Math.max(depMinRow, ...inv.map(p => personNextRow[p]));
    if (row > maxRow) maxRow = row;

    if (!rowEvents[row]) rowEvents[row] = { groups: [], activePeople: new Set() };
    inv.forEach(p => {
       personNextRow[p] = row + 1;
       rowEvents[row].activePeople.add(p);
    });

    if (card.gruppe) {
      groupMembers.forEach(gc => { 
        cardRowById[gc.id] = row; 
        cardRowById[gc.label] = row; 
        placedCards.push({ ...gc, row }); 
        processed.add(gc.label); 
      });
      if (!rowEvents[row].groups.find(g => g.name === card.gruppe)) {
          rowEvents[row].groups.push({ name: card.gruppe, involved: [...inv] });
          transferStations.push({ name: card.gruppe, row, involved: [...inv] });
      }
    } else {
      cardRowById[card.id] = row;
      cardRowById[card.label] = row;
      placedCards.push({ ...card, row });
      processed.add(card.label);
    }
  });

  // --- PASS 2: ZEITPLAN-OPTIMIERUNG (Das neue Gehirn) ---
  const personLastEnd = {};
  people.forEach(p => personLastEnd[p] = 0);
  const cardSimResults = {};

  sortedCards.forEach(card => {
    // Finde die bereits platzierte Karte (um Zugriff auf row zu haben)
    const pCard = placedCards.find(c => c.id === card.id);
    if (!pCard) return;

    // 1. Dauer ermitteln (1 Tag = 8h)
    // Wir holen uns die Live-Daten aus S.cards, falls vorhanden
    const liveC = (Object.values(S.cards).flat()).find(x => x.id === card.id) || card;
    const est = liveC.timeEstimate || { d: 0, h: 0, m: 0 };
    let duration = (est.d * 8) + est.h + (est.m / 60);
    if (duration <= 0) duration = 1.5; // Standard: 90 Min

    // 2. Wann sind die logischen Voraussetzungen (deps) fertig?
    let maxDepEnd = 0;
    const deps = card.deps || [];
    deps.forEach(depId => {
      if (cardSimResults[depId]) maxDepEnd = Math.max(maxDepEnd, cardSimResults[depId].end);
    });

    // 3. Gruppen-Check: Wer muss GLEICHZEITIG anwesend sein?
    const groupMembers = card.gruppe 
      ? Array.from(new Set(allCards.filter(c => c.gruppe === card.gruppe).map(c => c.wer)))
      : [card.wer];

    // 4. Ressourcen-Check: Wann sind ALLE beteiligten Personen frei?
    let maxWorkerReady = 0;
    groupMembers.forEach(m => {
      if ((personLastEnd[m] || 0) > maxWorkerReady) maxWorkerReady = personLastEnd[m];
    });

    // 5. Start berechnen (Logik + Team-Bereitschaft)
    const start = Math.max(maxDepEnd, maxWorkerReady);
    const transitTime = start > 0 ? 0.3 : 0; // 18 Min "Fahrtzeit" zur nächsten Station
    
    pCard.simStart = start + transitTime;
    pCard.simEnd = pCard.simStart + duration;

    // Zeit für Abhängigkeiten speichern
    cardSimResults[card.id] = { start: pCard.simStart, end: pCard.simEnd };
    cardSimResults[card.label] = { start: pCard.simStart, end: pCard.simEnd };

    // Alle Teammitglieder dieser Aufgabe/Gruppe bis zum Ende blockieren
    groupMembers.forEach(m => personLastEnd[m] = pCard.simEnd);
  });

  // --- PASS 3: GLEIS-LAYOUT (Cluster sortieren) ---
  // (Dieser Teil bleibt für das optische Zeichnen der Kurven identisch...)
  const rowLanes = { 0: [...people] };
  let currentLanes = [...people];
  for (let r = 1; r <= maxRow + 1; r++) {
    if (rowEvents[r] && rowEvents[r].groups.length > 0) {
      const personCluster = {};
      const clusterAvg = {};
      currentLanes.forEach(p => { personCluster[p] = p; }); 
      rowEvents[r].groups.forEach(grp => {
        grp.involved.forEach(p => { personCluster[p] = grp.name; });
      });
      currentLanes.forEach(p => {
        const cluster = personCluster[p];
        if (!clusterAvg[cluster]) clusterAvg[cluster] = { sum: 0, count: 0, members: [] };
        clusterAvg[cluster].sum += currentLanes.indexOf(p);
        clusterAvg[cluster].count++;
        clusterAvg[cluster].members.push(p);
      });
      const clusters = Object.keys(clusterAvg).map(k => ({
        id: k, avg: clusterAvg[k].sum / clusterAvg[k].count, members: clusterAvg[k].members
      }));
      clusters.sort((a, b) => a.avg - b.avg);
      currentLanes = clusters.flatMap(c => {
        return c.members.sort((a, b) => currentLanes.indexOf(a) - currentLanes.indexOf(b));
      });
    }
    rowLanes[r] = [...currentLanes];
  }

  // --- PASS 4: KOORDINATEN ---
  const trackPoints = {};
  people.forEach(p => trackPoints[p] = []);
  const personCurrentX = {};
  for (let r = 0; r <= maxRow + 1; r++) {
    if (rowLanes[r]) {
      rowLanes[r].forEach((p, i) => {
        personCurrentX[p] = MARGIN_H + i * TRACK_SPACING;
      });
    }
    people.forEach(p => {
      trackPoints[p].push({ x: personCurrentX[p], y: MARGIN_TOP + r * ROW_HEIGHT });
    });
  }

  return { placedCards, transferStations, maxRows: maxRow + 1, trackPoints };
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
// ── GEWÜNSCHTE RENDER-FUNKTION FÜR DIE U-BAHN KARTE ──
window.renderUBahnMap = function() {
  _currentView = 'map'; 
  _currentPerson = null;
  
  ensureControls(); // Stellt sicher, dass Regler etc. da sind
  document.getElementById('ubahn-back-btn').style.display = 'none';
  const container = document.getElementById('ubahn-content');
  
  // Daten sammeln und Grid berechnen
  _data = prepareBoardData();
  const { boardData, people, lineColors, allCardsFlat } = _data;
  if (!people.length) return;
  
  _lastGrid = calculateGrid(boardData, people);
  const { placedCards, transferStations, maxRows, trackPoints } = _lastGrid;
  
  // Maße für die Canvas-Fläche
  const mapW = (people.length - 1) * TRACK_SPACING + MARGIN_H * 2;
  const mapH = maxRows * ROW_HEIGHT + MARGIN_TOP + 100;

  // 1. SVG LAYER (Hintergrund-Schienen)
  let svg = `<svg id="ubahn-svg-layer" width="${mapW}" height="${mapH}" style="position:absolute;inset:0;pointer-events:none;z-index:1;transition:opacity 0.25s ease;">`;
  
  // Zeichnet die dicken grauen Betonschienen und die farbigen Linien darauf
  people.forEach(p => {
    svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" opacity="1"/>`;
    svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="${lineColors[p]}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
  });
  svg += `</svg>`;

  // Helper für den Status-Check
  const isInProgress = c => c.colName && c.colName.toLowerCase().includes('bearb');

  // 2. HTML LAYER VORBEREITEN (Animationen & Namen)
  let html = `<style>
    @keyframes ubahn-pulse {
      0%   { transform:scale(1);   opacity:0.85; }
      60%  { transform:scale(1.9); opacity:0; }
      100% { transform:scale(1.9); opacity:0; }
    }
    .ubahn-pulse-ring {
      position:absolute; border-radius:50%; pointer-events:none;
      animation: ubahn-pulse 1.8s ease-out infinite;
    }
  </style>`;
  
  // Namen der Personen an Start- und Endpunkten platzieren
  people.forEach(p => {
    const sPt = trackPoints[p][0], ePt = trackPoints[p][maxRows], color = lineColors[p];
    html += `<button onclick='window.renderUBahnPerson(${JSON.stringify(p)})' style="position:absolute;left:${sPt.x - 60}px;top:${sPt.y - 70}px;width:120px;text-align:center;background:none;border:none;cursor:pointer;z-index:1005;"><div style="display:inline-block;background:var(--surface);border:4px solid ${color};border-radius:14px;padding:7px 12px;font-weight:900;font-size:12px;color:var(--text);box-shadow:0 4px 16px ${color}44;">${esc(p)}</div></button>`;
    html += `<div style="position:absolute;left:${sPt.x-12}px;top:${sPt.y-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
    html += `<div style="position:absolute;left:${ePt.x-12}px;top:${ePt.y-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
  });

  // 3. GRUPPEN-PILLEN (nur bei echten Umsteigebahnhöfen mit mehreren Personen auf verschiedenen Gleisen)
  transferStations.forEach(s => {
    const xs = s.involved.map(p => trackPoints[p][s.row].x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);

    // Nur zeichnen wenn mindestens 2 Personen auf unterschiedlichen Gleisen
    if (xMax <= xMin) return;

    const y = s.row * ROW_HEIGHT + MARGIN_TOP;
    const width = (xMax - xMin) + 64;
    const lineWidth = (xMax - xMin);

    // Die Kapsel (Hintergrund): Fest auf Weiß für den "Plan-Look"
    html += `
      <div class="ubahn-pill" style="position:absolute; left:${xMin - 32}px; top:${y - 26}px; width:${width}px; height:52px; background:#ffffff; border:2px solid #000; border-radius:26px; box-shadow:0 4px 15px rgba(0,0,0,0.4); z-index:1000; pointer-events:none; transition:background 0.25s ease, border-color 0.25s ease;"></div>
    `;

    // Die dunkle Verbindungsschiene (Liegt ÜBER dem Weiß der Pille)
    html += `
      <div style="position:absolute; left:${xMin}px; top:${y - 4}px; width:${lineWidth}px; height:8px; background:#2d3748; z-index:1001; pointer-events:none;"></div>
    `;
  });

  // 4. EINZELNE STATIONEN (Bahnhöfe)
  placedCards.forEach(k => {
    const pt = trackPoints[k.wer][k.row], color = lineColors[k.wer], isHigh = k.prio === 'hoch';
    const active = isInProgress(k);
    
    // Pulsierender Ring für Karten in Bearbeitung
    if (active) html += `<div class="ubahn-pulse-ring" style="position:absolute;left:${pt.x-30}px;top:${pt.y-30}px;width:60px;height:60px;border:3px solid ${color};z-index:1003;transition:opacity 0.25s ease;"></div>`;
    
    // Der klickbare Bahnhofs-Ring (originale Darstellung)
    html += `
      <div id="ubahn-node-${k.label}" class="ubahn-station"
           onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})'
           onmouseenter='window.ubahnHoverCard(${JSON.stringify(k.label)})'
           onmouseleave='window.ubahnLeaveCard()'
           style="position:absolute;left:${pt.x-90}px;top:${pt.y-22}px;width:180px;display:flex;justify-content:center;align-items:center;cursor:pointer;z-index:1004;transition:opacity 0.25s ease;">
        <div id="ubahn-ring-${k.label}" data-color="${color}" data-active="${active}"
             style="position:relative; width:44px; height:44px; border-radius:50%; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; color:var(--text); box-shadow:0 4px 14px rgba(0,0,0,0.4)${active ? `,0 0 18px ${color}99` : ''}; transition:all 0.25s ease;">
          ${esc(k.label)}
          ${isHigh ? `<span style="position:absolute; top:-4px; right:-4px; width:12px; height:12px; background:#ef4444; border-radius:50%; border:2px solid var(--surface); z-index:10;"></span>` : ''}
        </div>
      </div>`;
  });
  
  // 5. FINALES RENDERING IN DEN CONTAINER
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
        const active = k.colName && k.colName.toLowerCase().includes('bearb');
        if (active) stationsHtml += `<div class="ubahn-pulse-ring" style="position:absolute;left:${X_LINE-(dotW/2)-8}px;top:${currentY-30}px;width:${dotW+16}px;height:60px;border:3px solid ${color};border-radius:30px;z-index:1001;"></div>`;
        stationsHtml += `
          <div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})'
               style="position:absolute; left:${X_LINE-(dotW/2)}px; top:${currentY-22}px; width:${dotW}px; height:44px; border-radius:22px; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-weight:900; color:var(--text); cursor:pointer; z-index:1002; box-shadow:${active ? `0 0 18px ${color}99` : 'none'};">
            ${esc(k.label)}
            ${isHigh ? `<span style="position:absolute; top:-4px; right:-4px; width:12px; height:12px; background:#ef4444; border-radius:50%; border:2px solid var(--surface); z-index:10;"></span>` : ''}
          </div>`;
        stationsHtml += `<div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})' onmouseenter="this.style.borderColor='${color}';this.style.boxShadow='0 4px 20px ${color}33'" onmouseleave="this.style.borderColor='var(--border)';this.style.boxShadow='none'" style="position:absolute; left:${X_LINE+50}px; top:${currentY-26}px; width:340px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px; z-index:1001; cursor:pointer; transition:border-color 0.2s, box-shadow 0.2s;"><div style="font-size:14px; font-weight:700;">${esc(k.titel)}</div>${members.length ? `<div style="margin-top:10px; display:flex; gap:5px;">${members.map(m => `<span style="width:10px; height:10px; border-radius:50%; background:${lineColors[m]}; border:1px solid #fff;" title="${esc(m)}"></span>`).join('')}</div>` : ''}</div>`;
        currentY += ROW_HEIGHT + (members.length ? 40 : 0);
      });
      currentY += 40;
    }
  });
  stationsHtml += `<div style="position:absolute;left:${X_LINE-12}px;top:${firstY-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div><div style="position:absolute;left:${X_LINE-12}px;top:${currentY-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
  const svg = `<svg width="100%" height="${currentY+50}" style="position:absolute;inset:0;pointer-events:none;z-index:1;"><path d="M ${X_LINE} ${firstY} L ${X_LINE} ${currentY}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linecap="round"/><path d="M ${X_LINE} ${firstY} L ${X_LINE} ${currentY}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" opacity="0.85"/></svg>`;
  container.innerHTML = `<div style="position:relative; padding:24px; min-height:${currentY+100}px;">${svg}${stationsHtml}</div>`;
};


// ── 6. DETAIL POPUP & ÖFFNEN ────────────────────────────────
// Hilfsfunktion: Karten-Info aus S.cards nachschlagen (per Label, so wie deps gespeichert sind)
function _resolveCard(labelOrId) {
  for (const [colId, cards] of Object.entries(S.cards)) {
    const c = cards.find(x => x.label === labelOrId || x.id === labelOrId);
    if (c) return { id: c.id, label: c.label, titel: c.text, wer: c.assignee, colName: S.columns.find(col => col.id === colId)?.name || '' };
  }
  return null;
}

// Navigation zu einer anderen Karte (mit Übergangsanimation)
window._ubahnNav = function(label) {
  const overlay = document.getElementById('ubahn-card-overlay');
  if (overlay) {
    const inner = overlay.querySelector('[data-ubahn-popup]');
    if (inner) {
      inner.style.transition = 'opacity 0.15s, transform 0.15s';
      inner.style.opacity = '0';
      inner.style.transform = 'scale(0.95)';
    }
    setTimeout(() => {
      window.showUBahnCardDetail(label);
      _ubahnScrollToCard(label);
    }, 150);
  } else {
    window.showUBahnCardDetail(label);
    _ubahnScrollToCard(label);
  }
};

// Karte im Hintergrund ins Zentrum scrollen
function _ubahnScrollToCard(label) {
  if (!_lastGrid || !_data) return;
  const placed = _lastGrid.placedCards.find(c => c.label === label);
  if (!placed) return;
  const pt = _lastGrid.trackPoints[placed.wer]?.[placed.row];
  if (!pt) return;
  const container = document.getElementById('ubahn-content');
  if (!container) return;
  container.scrollTo({ left: pt.x - container.clientWidth / 2, top: pt.y - container.clientHeight / 2, behavior: 'smooth' });
}

// Mini-Karte (anklickbar, navigiert zu dieser Karte)
function _miniCard(info) {
  const c = _data.lineColors[info.wer] || 'var(--border)';
  return `<div onclick='window._ubahnNav(${JSON.stringify(info.label)})'
    style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--surface);border:1.5px solid ${c};border-radius:12px;cursor:pointer;margin-bottom:6px;transition:opacity .15s;user-select:none;" onmouseenter="this.style.opacity='.75'" onmouseleave="this.style.opacity='1'">
    <span style="width:28px;height:28px;border-radius:50%;background:${c};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:#fff;flex-shrink:0;">${esc(info.label)}</span>
    <div style="flex:1;min-width:0;">
      <div style="font-size:12px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(info.titel)}</div>
      <div style="font-size:10px;color:var(--text-muted);">${esc(info.wer)} · ${esc(info.colName)}</div>
    </div>
    <span style="color:var(--text-muted);font-size:14px;">›</span>
  </div>`;
}

window.showUBahnCardDetail = function(label) {
  const card = _data.allCardsFlat.find(c => c.label === label); if (!card) return;
  const color = _data.lineColors[card.wer];

  const currentColId = Object.entries(S.cards).find(([, cards]) => cards.some(c => c.id === card.id))?.[0];
  const currentCol   = S.columns.find(c => c.id === currentColId);
  const isLocked     = currentCol && window.isFinishedColumn ? window.isFinishedColumn(currentCol) : false;

  // Description from live S.cards (most up to date)
  const liveCard = (S.cards[currentColId] || []).find(c => c.id === card.id);
  const description = liveCard?.description || card.description || '';

  const prereqs  = (card.deps || []).map(_resolveCard).filter(Boolean);
  const enables  = _data.allCardsFlat.filter(c => (c.deps || []).includes(card.label)).map(c => _resolveCard(c.label)).filter(Boolean);
  const groupPartners = card.gruppe ? _data.allCardsFlat.filter(c => c.gruppe === card.gruppe && c.wer !== card.wer) : [];

  const prioBadge = {
    hoch:    `<span style="background:#ef444422;color:#ef4444;border:1px solid #ef444466;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">▲ Hoch</span>`,
    niedrig: `<span style="background:#22c55e22;color:#22c55e;border:1px solid #22c55e66;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">▼ Niedrig</span>`,
  }[card.prio] || `<span style="background:var(--surface);color:var(--text-muted);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">● Mittel</span>`;

  const colOptions = S.columns.map(col =>
    `<option value="${col.id}" ${col.id === currentColId ? 'selected' : ''}>${esc(col.name)}</option>`
  ).join('');

  const hr = `<div style="border:none;border-top:1px solid var(--border);margin:14px 0;"></div>`;

  const editStyle = isLocked ? 'pointer-events:none;opacity:0.7;' : '';

  document.getElementById('ubahn-card-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ubahn-card-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:20005;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <style>@keyframes _ubahn_in{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}</style>
    <div data-ubahn-popup style="background:rgba(var(--panel-rgb),1);border-radius:24px;width:92%;max-width:480px;border:1px solid var(--border);padding:28px 28px 24px;position:relative;box-shadow:0 30px 90px rgba(0,0,0,0.5);max-height:88vh;overflow-y:auto;animation:_ubahn_in .18s ease;">
      <button onclick="document.getElementById('ubahn-card-overlay').remove()" style="position:absolute;right:18px;top:18px;background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;line-height:1;">✕</button>

      ${prereqs.length ? `
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">⬆ Muss vorher fertig sein</div>
        ${prereqs.map(_miniCard).join('')}
        ${hr}` : ''}

      <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px;">
        <div style="position:relative;flex-shrink:0;">
          <input id="ubahn-label-input"
            type="text" maxlength="6"
            value="${esc(card.label)}"
            data-original="${esc(card.label)}"
            data-cardid="${card.id}"
            data-colid="${currentColId}"
            ${isLocked ? 'readonly' : ''}
            onblur="window.ubahn_saveLabel(this)"
            onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}"
            style="width:52px;height:52px;border-radius:50%;background:${color};color:#fff;font-weight:900;font-size:15px;text-align:center;border:3px solid transparent;outline:none;cursor:${isLocked?'default':'pointer'};box-shadow:0 4px 14px ${color}66;transition:border-color .2s;${editStyle}"
            onfocus="this.style.borderColor='#fff'" onblur2="this.style.borderColor='transparent'">
        </div>
        <div style="flex:1;">
          <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:4px;">Linie ${esc(card.wer)}</div>
          ${prioBadge}
        </div>
      </div>

      <textarea id="ubahn-title-input"
        data-cardid="${card.id}" data-colid="${currentColId}"
        onblur="window.ubahn_saveTitle(this)"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur();}"
        rows="2" ${isLocked ? 'readonly' : ''}
        placeholder="Aufgabenbeschreibung…"
        style="width:100%;font-size:18px;font-weight:700;line-height:1.4;border:none;border-bottom:2px solid transparent;background:transparent;color:var(--text);resize:none;outline:none;padding:0 0 6px;font-family:inherit;transition:border-color .2s;${editStyle}"
        onfocus="this.style.borderBottomColor='${color}'" onblur2="this.style.borderBottomColor='transparent'"
      >${esc(card.titel)}</textarea>

     <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Beschreibung</div>
        <textarea id="ubahn-desc-input"
          data-cardid="${card.id}" data-colid="${currentColId}"
          onblur="window.ubahn_saveDescription(this)"
          rows="4" ${isLocked ? 'readonly' : ''}
          placeholder="${isLocked ? '' : 'Detaillierte Beschreibung der Aufgabe…'}"
          style="width:100%;font-size:13px;line-height:1.6;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);resize:vertical;outline:none;padding:10px 12px;font-family:inherit;transition:border-color .2s;${editStyle}"
          onfocus="this.style.borderColor='${color}'" onblur2="this.style.borderColor='var(--border)'"
        >${esc(description)}</textarea>
      </div>

      <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Geschätzte Bearbeitungszeit</div>
        <div style="display:flex; gap:10px;">
          <div style="flex:1;">
            <input type="number" id="ubahn-time-d" data-cardid="${card.id}" data-colid="${currentColId}" onchange="window.ubahn_saveTime(this)" value="${liveCard?.timeEstimate?.d || ''}" min="0" placeholder="Tage" ${isLocked ? 'disabled' : ''} style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${isLocked?'var(--border)':color};background:rgba(var(--panel-rgb),1);color:${isLocked?'var(--text-muted)':'var(--text)'};font-size:13px;font-family:inherit;outline:none;">
          </div>
          <div style="flex:1;">
            <input type="number" id="ubahn-time-h" data-cardid="${card.id}" data-colid="${currentColId}" onchange="window.ubahn_saveTime(this)" value="${liveCard?.timeEstimate?.h || ''}" min="0" max="23" placeholder="Std" ${isLocked ? 'disabled' : ''} style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${isLocked?'var(--border)':color};background:rgba(var(--panel-rgb),1);color:${isLocked?'var(--text-muted)':'var(--text)'};font-size:13px;font-family:inherit;outline:none;">
          </div>
          <div style="flex:1;">
            <input type="number" id="ubahn-time-m" data-cardid="${card.id}" data-colid="${currentColId}" onchange="window.ubahn_saveTime(this)" value="${liveCard?.timeEstimate?.m || ''}" min="0" max="59" placeholder="Min" ${isLocked ? 'disabled' : ''} style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${isLocked?'var(--border)':color};background:rgba(var(--panel-rgb),1);color:${isLocked?'var(--text-muted)':'var(--text)'};font-size:13px;font-family:inherit;outline:none;">
          </div>
        </div>
      </div>

      ${groupPartners.length ? `
        <div style="margin-top:14px;">
          <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Gruppenarbeit mit</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${groupPartners.map(p => `<div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--surface);border-radius:20px;border:2px solid ${_data.lineColors[p.wer]||'var(--border)'};">
              <span style="width:14px;height:14px;border-radius:50%;background:${_data.lineColors[p.wer]||'var(--border)'}"></span>
              <span style="font-size:12px;font-weight:700;">${esc(p.wer)}</span>
            </div>`).join('')}
          </div>
        </div>` : ''}

      <div style="margin-top:14px;">
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:6px;">Phase</div>
        <select id="ubahn-col-select" onchange="window.ubahn_moveCard('${card.id}','${currentColId}',this.value)"
          ${isLocked ? 'disabled' : ''}
          style="width:100%;padding:9px 12px;border-radius:10px;border:1px solid ${isLocked?'var(--border)':color};background:rgba(var(--panel-rgb),1);color:${isLocked?'var(--text-muted)':'var(--text)'};font-size:13px;font-weight:600;cursor:${isLocked?'not-allowed':'pointer'};outline:none;">
          ${colOptions}
        </select>
        ${isLocked ? `<div style="font-size:11px;color:var(--text-muted);margin-top:5px;">🔒 Fertig-Spalte – kein Zurück</div>` : ''}
      </div>

      ${enables.length ? `
        ${hr}
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">⬇ Gibt frei</div>
        ${enables.map(_miniCard).join('')}` : ''}
    </div>`;
  document.body.appendChild(overlay);
};

// Label speichern (mit Eindeutigkeitsprüfung + Deps-Update)
window.ubahn_saveLabel = function(input) {
  const newLabel = input.value.trim().toUpperCase().replace(/\s+/g, '');
  const oldLabel = input.dataset.original;
  const cardId   = input.dataset.cardid;
  const colId    = input.dataset.colid;
  if (!newLabel) { input.value = oldLabel; return; }
  if (newLabel === oldLabel) return;
  // Eindeutigkeit prüfen
  for (const [cid, cards] of Object.entries(S.cards)) {
    for (const c of cards) {
      if (c.id !== cardId && c.label === newLabel) {
        if (typeof window.showToast === 'function') window.showToast(`Label "${newLabel}" bereits vergeben!`, 'error');
        input.value = oldLabel; input.style.borderColor = '#ef4444';
        setTimeout(() => { input.style.borderColor = 'transparent'; }, 1500);
        return;
      }
    }
  }
  // Alle Abhängigkeiten in anderen Karten aktualisieren
  for (const [cid, cards] of Object.entries(S.cards)) {
    for (const c of cards) {
      if ((c.dependencies || []).includes(oldLabel)) {
        updateCard(S.currentBoard.id, cid, c.id, { dependencies: c.dependencies.map(d => d === oldLabel ? newLabel : d) });
        if (typeof window.loadCards === 'function') window.loadCards(cid);
      }
    }
  }
  updateCard(S.currentBoard.id, colId, cardId, { label: newLabel });
  if (typeof window.loadCards === 'function') window.loadCards(colId);
  input.dataset.original = newLabel;
  if (_data) { _data = prepareBoardData(); _lastGrid = calculateGrid(_data.boardData, _data.people); if (_currentView === 'map') window.renderUBahnMap(); else if (_currentView === 'person') window.renderUBahnPerson(_currentPerson); }
  if (typeof window.renderBoard === 'function') window.renderBoard();
  if (typeof window.showToast === 'function') window.showToast(`Label: ${oldLabel} → ${newLabel}`);
};

// Titel speichern
window.ubahn_saveTitle = function(textarea) {
  const text   = textarea.value.trim();
  const cardId = textarea.dataset.cardid;
  const colId  = textarea.dataset.colid;
  if (!text) return;
  updateCard(S.currentBoard.id, colId, cardId, { text });
  if (typeof window.loadCards === 'function') window.loadCards(colId);
  if (_data) { _data = prepareBoardData(); if (_currentView === 'map') window.renderUBahnMap(); else if (_currentView === 'person') window.renderUBahnPerson(_currentPerson); }
};

// Beschreibung speichern
window.ubahn_saveDescription = function(textarea) {
  const description = textarea.value;
  const cardId = textarea.dataset.cardid;
  const colId  = textarea.dataset.colid;
  updateCard(S.currentBoard.id, colId, cardId, { description });
  // S.cards im Speicher aktualisieren, damit der Wert beim nächsten Öffnen korrekt angezeigt wird
  if (typeof window.loadCards === 'function') window.loadCards(colId);
  if (_data) _data = prepareBoardData();
};

// Kartendetail von Hauptboard aus öffnen (ohne U-Bahn offen zu haben)
window.openCardDetail = function(cardId, colId) {
  if (!_data) _data = prepareBoardData();
  if (!_lastGrid) _lastGrid = calculateGrid(_data.boardData, _data.people);
  const card = _data.allCardsFlat.find(c => c.id === cardId);
  if (!card) {
    // Karte ist nicht in allCardsFlat (z.B. kein Assignee) — direkt aus S.cards holen
    const raw = (S.cards[colId] || []).find(c => c.id === cardId);
    if (!raw) return;
    const col = S.columns.find(c => c.id === colId);
    // Temporären Eintrag in allCardsFlat hinzufügen
    const tmp = { id: raw.id, label: raw.label || '?', titel: raw.text, wer: raw.assignee || '–', prio: raw.priority || 'mittel', deps: raw.dependencies || [], gruppe: raw.groupId || null, colName: col?.name || '', description: raw.description || '' };
    if (!_data.lineColors[tmp.wer]) _data.lineColors[tmp.wer] = '#6366f1';
    _data.allCardsFlat.push(tmp);
    window.showUBahnCardDetail(tmp.label);
  } else {
    window.showUBahnCardDetail(card.label);
  }
};

// Karte in neue Spalte verschieben (aus U-Bahn-Popup heraus)
window.ubahn_moveCard = async function(cardId, fromColId, toColId) {
  if (fromColId === toColId) return;
  const fromCol = S.columns.find(c => c.id === fromColId);
  const toCol   = S.columns.find(c => c.id === toColId);
  if (!fromCol || !toCol) return;
  if (window.isFinishedColumn && window.isFinishedColumn(fromCol)) {
    document.getElementById('ubahn-col-select').value = fromColId;
    return;
  }
  const isNowFinished = window.isFinishedColumn ? window.isFinishedColumn(toCol) : false;
  if (isNowFinished) {
    if (!await window.showConfirm('Karte in die Fertig-Spalte verschieben?\n\nDies kann nicht rückgängig gemacht werden.', 'Verschieben', 'Abbrechen')) {
      document.getElementById('ubahn-col-select').value = fromColId; return;
    }
  }
  if (typeof window.pushUndo === 'function') window.pushUndo('Karte verschoben (U-Bahn)');
  const now = new Date().toISOString();

  // Alle Karten der Gruppe mitverschieben
  const srcCard = (S.cards[fromColId]||[]).find(c => c.id === cardId);
  const toMove = srcCard?.groupId
    ? (S.cards[fromColId]||[]).filter(c => c.groupId === srcCard.groupId)
    : (srcCard ? [srcCard] : []);
  let orderBase = (S.cards[toColId]||[]).length;
  for (const c of toMove) {
    moveCard(S.currentBoard.id, fromColId, toColId, c.id, orderBase++);
    if (isNowFinished) updateCard(S.currentBoard.id, toColId, c.id, { finishedAt: now });
    else               updateCard(S.currentBoard.id, toColId, c.id, { startedAt: c.startedAt || now });
  }
  if (typeof window.loadCards === 'function') { window.loadCards(fromColId); window.loadCards(toColId); }
  document.getElementById('ubahn-card-overlay')?.remove();
  if (typeof window.renderBoard === 'function') window.renderBoard();
  // U-Bahn neu rendern
  if (_currentView === 'map') window.renderUBahnMap(); else window.renderUBahnPerson(_currentPerson);
};

window.toggleUBahnWide = function() {
  const modal = document.getElementById('modal-ubahn-inner');
  const btn   = document.getElementById('ubahn-wide-btn');
  if (!modal) return;
  const isWide = modal.classList.toggle('ubahn-wide');
  btn.innerHTML = isWide
    ? '<i data-lucide="minimize-2" style="width:13px;height:13px;"></i>'
    : '<i data-lucide="arrow-left-right" style="width:13px;height:13px;"></i>';
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 30);
};

window.openUBahnModal = function() {
  document.getElementById('modal-ubahn').style.display = 'flex';
  ensureControls();
  renderUBahnMap();
};

// ── 7. HOVER RÖNTGEN-BLICK (ABHÄNGIGKEITEN) ──────────────────
window.ubahnHoverCard = function(label) {
  if (!_data || !_data.allCardsFlat) return;

  const allCards = _data.allCardsFlat;
  const hoveredCard = allCards.find(c => c.label === label);
  if (!hoveredCard) return;

  // Hilfsfunktion: Sucht den kompletten Baum ab und berechnet die "Generation" (Tiefe)
  function getGenerations(startLabel, direction) {
    const generations = new Map();
    const queue = [{ label: startLabel, depth: 0 }];
    const visited = new Set([startLabel]);

    while(queue.length > 0) {
      const { label: currLabel, depth } = queue.shift();

      if (depth > 0) generations.set(currLabel, depth);

      if (direction === 'up') { 
        // Rückwärts: Voraussetzungen (Ancestors)
        const card = allCards.find(c => c.label === currLabel);
        if (card && card.deps) {
          card.deps.forEach(depLabel => {
            if (!visited.has(depLabel)) {
              visited.add(depLabel);
              queue.push({ label: depLabel, depth: depth + 1 });
            }
          });
        }
      } else { 
        // Vorwärts: Gibt folgendes frei (Descendants)
        const successors = allCards.filter(c => (c.deps || []).includes(currLabel));
        successors.forEach(succ => {
          if (!visited.has(succ.label)) {
            visited.add(succ.label);
            queue.push({ label: succ.label, depth: depth + 1 });
          }
        });
      }
    }
    return generations;
  }

  // Komplette Stammbäume berechnen
  const preGens = getGenerations(label, 'up');
  const succGens = getGenerations(label, 'down');

  // Hintergrund-Linien stark abdunkeln
  const svgLayer = document.getElementById('ubahn-svg-layer');
  if (svgLayer) svgLayer.style.opacity = '0.15';

  // Alle Gruppenarbeits-Pillen abdunkeln
  document.querySelectorAll('.ubahn-pill').forEach(p => {
    p.style.background = '#888';
    p.style.borderColor = '#555';
  });

  allCards.forEach(c => {
    const node = document.getElementById(`ubahn-node-${c.label}`);
    const ring = document.getElementById(`ubahn-ring-${c.label}`);
    if (!node || !ring) return;

    if (c.label === label) {
      // 0. Die aktuell anvisierte Karte (Zentrum)
      node.style.opacity = '1';
      ring.style.boxShadow = '0 0 25px rgba(255,255,255,0.7)';
      ring.style.transform = 'scale(1.15)';
      
    } else if (preGens.has(c.label)) {
      // 1. Voraussetzungen (ORANGE) - Je weiter weg, desto schwächer
      const depth = preGens.get(c.label);
      const intensity = Math.max(0.25, 1 - (depth - 1) * 0.3); // Gen1: 1.0, Gen2: 0.7, Gen3: 0.4...
      
      node.style.opacity = intensity.toString();
      ring.style.borderColor = '#f59e0b';
      ring.style.color = '#f59e0b';
      ring.style.boxShadow = `0 0 ${20 * intensity}px rgba(245, 158, 11, ${intensity})`;
      ring.style.transform = depth === 1 ? 'scale(1.05)' : 'scale(1)';
      
    } else if (succGens.has(c.label)) {
      // 2. Freigegebene Karten (GRÜN) - Je weiter weg, desto schwächer
      const depth = succGens.get(c.label);
      const intensity = Math.max(0.25, 1 - (depth - 1) * 0.3); 
      
      node.style.opacity = intensity.toString();
      ring.style.borderColor = '#10b981';
      ring.style.color = '#10b981';
      ring.style.boxShadow = `0 0 ${20 * intensity}px rgba(16, 185, 129, ${intensity})`;
      ring.style.transform = depth === 1 ? 'scale(1.05)' : 'scale(1)';
      
    } else {
      // 3. Völlig unbeteiligte Karten stark abdunkeln
      node.style.opacity = '0.15';
    }
  });
};

window.ubahnLeaveCard = function() {
  if (!_data || !_data.allCardsFlat) return;
  
  // Hintergrund-Linien wiederherstellen
  const svgLayer = document.getElementById('ubahn-svg-layer');
  if (svgLayer) svgLayer.style.opacity = '1';

  // Alle Pillen zurücksetzen
  document.querySelectorAll('.ubahn-pill').forEach(p => {
    p.style.background = '#ffffff';
    p.style.borderColor = '#000';
  });

  // Alle Karten auf Normalzustand zurücksetzen
  _data.allCardsFlat.forEach(c => {
    const node = document.getElementById(`ubahn-node-${c.label}`);
    const ring = document.getElementById(`ubahn-ring-${c.label}`);
    if (!node || !ring) return;

    const originalColor = ring.getAttribute('data-color');
    const isActive = ring.getAttribute('data-active') === 'true';

    node.style.opacity = '1';
    ring.style.transform = 'scale(1)';
    ring.style.borderColor = originalColor;
    ring.style.color = 'var(--text)';
    ring.style.boxShadow = isActive ? `0 4px 14px rgba(0,0,0,0.4), 0 0 18px ${originalColor}99` : '0 4px 14px rgba(0,0,0,0.4)';
  });
};

/**
 * Startet die Gantt-Analyse aus der U-Bahn Ansicht
 * Nutzt die bereits berechneten Grid-Daten für höchste Performance
 */
window.openGanttFromUBahn = function() {
  if (!_lastGrid || !_data) {
    if (typeof window.showToast === 'function') {
      window.showToast("Bitte warten, bis das Netz berechnet wurde.", "error");
    }
    return;
  }
  
  // Ruft das überarbeitete Gantt-Modul auf
  showGanttView(_data, _lastGrid);
};
