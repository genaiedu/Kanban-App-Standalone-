// js/ubahn.js — U-Bahn Streckennetz (Agenda) - Kausalität & WIP-Wächter
import { S, moveCard, getCards, updateCard } from './state.js';

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
let _lastGrid = null;

function esc(text) {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  return String(text).replace(/[&<>"']/g, m =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

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
  const valRow = document.getElementById('val-row');
  if(valRow) valRow.textContent = val + 'px';
  if (_currentView === 'map') renderUBahnMap(); else renderUBahnPerson(_currentPerson);
};

function prepareBoardData() {
  const peopleSet = new Set(), boardData = [], allCardsFlatRaw = [];
  
  // 1. Karten-Daten extrem robust und fehlerresistent sammeln
  for (const colId in S.cards) {
    const col = S.columns.find(c => c.id === colId);
    const cardsInCol = S.cards[colId] || [];
    
    cardsInCol.forEach(card => {
      if (card && card.assignee) {
        // IDs: Originalschreibweise beibehalten (lowercase), Labels uppercase für Abhängigkeits-Matching
        const safeId = String(card.id || '').trim();
        const safeLabel = String(card.label || '').trim().toUpperCase();
        
        // Dependencies wasserdicht filtern (leere Strings oder Null-Werte entfernen)
        const rawDeps = Array.isArray(card.dependencies) ? card.dependencies : [];
        const safeDeps = rawDeps
          .map(d => String(d || '').trim().toUpperCase())
          .filter(d => d !== '');

        allCardsFlatRaw.push({ 
          id: safeId, 
          label: safeLabel, 
          titel: card.text, 
          wer: String(card.assignee).trim(), 
          prio: card.priority || 'mittel', 
          deps: safeDeps, 
          gruppe: card.groupId || null, 
          colName: col?.name || '',
          description: card.description || '',
          timeEstimate: card.timeEstimate || {},
          startOffset: card.startOffset ?? null
        });
      }
    });
  }

  // 2. Alle Nachfolger-Referenzen aus dem gereinigten Datensatz ermitteln
  const allDependencies = new Set();
  allCardsFlatRaw.forEach(card => {
    card.deps.forEach(dep => allDependencies.add(dep));
  });

  // 3. Der unerbittliche Filter
  const allCardsFlat = allCardsFlatRaw.filter(card => {
    // Bedingung A: Ist die Karte in der Spalte "Voraussetzungen"? -> SOFORT RAUS
    const colNameLower = String(card.colName).toLowerCase();
    if (colNameLower.includes('voraussetzung')) {
      return false; 
    }
    
    // Bedingung B: Hat die Karte weder Nachfolger noch Vorgänger?
    const hasVorganger = card.deps.length > 0;
    const hasNachfolger = (card.label !== '' && allDependencies.has(card.label)) || 
                          (card.id !== '' && allDependencies.has(card.id));
    
    const isIsolated = !hasVorganger && !hasNachfolger;
    
    // Wenn die Karte isoliert ist, fliegt sie raus.
    if (isIsolated) {
      // Eine einzige Ausnahme: Echte Gruppenarbeiten (Umsteigebahnhöfe). 
      // Wenn 2 Leute parallel an der gleichen Sache arbeiten, kreuzen sich ihre Linien, 
      // auch wenn die Aufgabe davor und danach keine Abhängigkeiten hat.
      // Wir prüfen hier, ob die Gruppe wirklich aus mehr als 1 Person besteht.
      const isRealGroup = card.gruppe && allCardsFlatRaw.filter(c => c.gruppe === card.gruppe).length > 1;
      
      if (!isRealGroup) {
        return false; // HARTER BANN: Karte ist isoliert und keine Gruppe -> RAUS
      }
    }

    // Wenn die Karte bis hierhin überlebt hat, darf sie ins Netz!
    return true;
  });

  // 4. Datenstrukturen für U-Bahn/Gantt final aufbauen
  allCardsFlat.forEach(card => peopleSet.add(card.wer));
  
  S.columns.forEach(col => {
    const filteredCardsInCol = allCardsFlat.filter(f => f.colName === col.name);
    if (filteredCardsInCol.length > 0) {
      boardData.push({ 
        spalte: col.name, 
        karten: filteredCardsInCol 
      });
    }
  });

  const people = Array.from(peopleSet);
  const colors = {};
  people.forEach((p, i) => { 
    colors[p] = i < PALETTE.length ? PALETTE[i] : `hsl(${Math.floor(Math.random() * 360)},70%,55%)`; 
  });

  return { boardData, people, lineColors: colors, allCardsFlat };
}

// ── DIE KAUSALITÄTS-MASCHINE MIT DEADLOCK-BREAKER ──
function calculateGrid(boardData, people) {
  const allCards = boardData.flatMap(col => col.karten).filter(Boolean);

  let dissolvedGroups = new Set();
  let ignoredDependencies = [];
  let warningCards = new Set();
  let warningMessages = new Set();
  
  let sortedNodes = [];
  let nodesMap = new Map();
  let graphResolved = false;
  let safeGuardOuter = 0;

  while (!graphResolved && safeGuardOuter < 15) {
      safeGuardOuter++;
      nodesMap.clear();
      const lookup = new Map();

      allCards.forEach(card => {
          const isGroup = card.gruppe && !dissolvedGroups.has(card.gruppe);
          const key = isGroup ? `group_${card.gruppe}` : `card_${card.id}`;
          if (!nodesMap.has(key)) {
              nodesMap.set(key, { key, isGroup, name: card.gruppe, cards: [], rawDeps: new Set(), resolvedDeps: new Set(), involved: new Set() });
          }
          const node = nodesMap.get(key);
          node.cards.push(card);
          if (card.deps) card.deps.forEach(d => { if(typeof d === 'string') node.rawDeps.add(d.trim().toUpperCase()); });
          if (card.wer) node.involved.add(card.wer);

          lookup.set(String(card.id).trim(), key);
          if (card.label) lookup.set(String(card.label).trim().toUpperCase(), key);
      });

      const nodes = Array.from(nodesMap.values());
      nodes.forEach(node => {
          node.rawDeps.forEach(rawDep => {
              const targetKey = lookup.get(rawDep);
              if (targetKey && targetKey !== node.key) {
                  const isIgnored = ignoredDependencies.some(ign => ign.from === targetKey && ign.to === node.key);
                  if (!isIgnored) node.resolvedDeps.add(targetKey);
              }
          });
      });

      sortedNodes = [];
      let inDegree = new Map();
      let adjList = new Map();

      nodes.forEach(n => {
          inDegree.set(n.key, n.resolvedDeps.size);
          adjList.set(n.key, []);
      });

      nodes.forEach(n => {
          n.resolvedDeps.forEach(depKey => {
              if (adjList.has(depKey)) adjList.get(depKey).push(n.key);
          });
      });

      let queue = [];
      nodes.forEach(n => { if (inDegree.get(n.key) === 0) queue.push(n); });

      let safeGuardInner = 0;
      while (queue.length > 0 && safeGuardInner < 5000) {
          safeGuardInner++;
          const current = queue.shift();
          sortedNodes.push(current);

          adjList.get(current.key).forEach(dependentKey => {
              let degree = inDegree.get(dependentKey) - 1;
              inDegree.set(dependentKey, degree);
              if (degree === 0) queue.push(nodesMap.get(dependentKey));
          });
      }

      if (sortedNodes.length === nodes.length) {
          graphResolved = true;
      } else {
          const stuckNodes = nodes.filter(n => inDegree.get(n.key) > 0);
          const groupNode = stuckNodes.find(n => n.isGroup);

          if (groupNode) {
              dissolvedGroups.add(groupNode.name);
              groupNode.cards.forEach(c => warningCards.add(c.id));
              warningMessages.add(`Gruppenarbeit "${groupNode.name}" wurde aufgelöst (Deadlock).`);
          } else {
              let brokeEdge = false;
              for (const n of stuckNodes) {
                  for (const depKey of n.resolvedDeps) {
                      if (inDegree.get(depKey) > 0) {
                          ignoredDependencies.push({ from: depKey, to: n.key });
                          n.cards.forEach(c => warningCards.add(c.id));
                          const depNode = nodesMap.get(depKey);
                          if (depNode) depNode.cards.forEach(c => warningCards.add(c.id));
                          
                          const fromNames = depNode ? depNode.cards.map(c=>c.label||c.id).join(', ') : depKey;
                          const toNames = n.cards.map(c=>c.label||c.id).join(', ');
                          warningMessages.add(`Abhängigkeit [${fromNames}] ➔ [${toNames}] ignoriert (Deadlock).`);
                          brokeEdge = true; break;
                      }
                  }
                  if (brokeEdge) break;
              }
              if (!brokeEdge) {
                  inDegree.set(stuckNodes[0].key, 0); queue.push(stuckNodes[0]);
              }
          }
      }
  }

  let placedCards = [];
  let transferStations = [];
  let maxRow = 0;
  const personNextRow = {};
  people.forEach(p => { personNextRow[p] = 1; });
  const rowEvents = {};
  const nodeRowByKey = new Map();

  sortedNodes.forEach(node => {
      let depMaxRow = 0;
      node.resolvedDeps.forEach(depKey => {
          const r = nodeRowByKey.get(depKey);
          if (r !== undefined && r > depMaxRow) depMaxRow = r;
      });

      let row = depMaxRow + 1;
      const inv = Array.from(node.involved).filter(p => people.includes(p));
      inv.forEach(p => { if (personNextRow[p] > row) row = personNextRow[p]; });

      if (row > maxRow) maxRow = row;
      if (!rowEvents[row]) rowEvents[row] = { groups: [], activePeople: new Set() };

      inv.forEach(p => { personNextRow[p] = row + 1; rowEvents[row].activePeople.add(p); });
      nodeRowByKey.set(node.key, row);

      node.cards.forEach(c => { placedCards.push({ ...c, row }); });

      if (node.isGroup) {
          rowEvents[row].groups.push({ name: node.name, involved: inv });
          transferStations.push({ name: node.name, row, involved: inv });
      }
  });

  const personLastEnd = {};
  people.forEach(p => { personLastEnd[p] = 0; });
  const nodeSimResults = new Map();

  sortedNodes.forEach(node => {
      let maxDepEnd = 0;
      node.resolvedDeps.forEach(depKey => {
          const res = nodeSimResults.get(depKey);
          if (res && res.end > maxDepEnd) maxDepEnd = res.end;
      });

      let maxWorkerReady = 0;
      const inv = Array.from(node.involved).filter(p => people.includes(p));
      inv.forEach(p => { if (personLastEnd[p] > maxWorkerReady) maxWorkerReady = personLastEnd[p]; });

      // startOffset (Tage → Stunden) aus Karten-Override ermitteln
      const offsets = node.cards.map(c => c.startOffset).filter(s => s !== null && s !== undefined);
      const overrideHours = offsets.length > 0 ? Math.max(...offsets) * 8 : null;

      let start = Math.max(maxDepEnd, maxWorkerReady, 0);
      if (overrideHours !== null) start = Math.max(overrideHours, maxDepEnd); // Deps müssen fertig sein
      const transit = start > 0 ? 0.3 : 0;
      start += transit;

      let maxDuration = 1.5;
      node.cards.forEach(pCard => {
          let liveC = pCard;
          try {
              if (typeof S !== 'undefined' && S.cards) {
                  for (const colId in S.cards) {
                      if (Array.isArray(S.cards[colId])) {
                          const found = S.cards[colId].find(c => c.id === pCard.id);
                          if (found) { liveC = found; break; }
                      }
                  }
              }
          } catch(e) {}
          const est = liveC.timeEstimate || {};
          let d = parseFloat(est.d) || 0;
          let h = parseFloat(est.h) || 0;
          let m = parseFloat(est.m) || 0;
          let dur = (d * 8) + h + (m / 60);
          if (dur > 0 && dur > maxDuration) maxDuration = dur;
      });

      const end = start + maxDuration;
      nodeSimResults.set(node.key, { start, end });
      inv.forEach(p => { personLastEnd[p] = end; });

      node.cards.forEach(c => {
          const pc = placedCards.find(placed => placed.id === c.id);
          if (pc) { pc.simStart = start; pc.simEnd = end; }
      });
  });

  const rowLanes = { 0: [...people] };
  let currentLanes = [...people];
  for (let r = 1; r <= maxRow + 1; r++) {
    if (rowEvents[r] && rowEvents[r].groups.length > 0) {
      const personCluster = {};
      const clusterAvg = {};
      currentLanes.forEach(p => { personCluster[p] = p; }); 
      rowEvents[r].groups.forEach(grp => { grp.involved.forEach(p => { personCluster[p] = grp.name; }); });
      currentLanes.forEach(p => {
        const cluster = personCluster[p];
        if (!clusterAvg[cluster]) clusterAvg[cluster] = { sum: 0, count: 0, members: [] };
        clusterAvg[cluster].sum += currentLanes.indexOf(p); clusterAvg[cluster].count++; clusterAvg[cluster].members.push(p);
      });
      const clusters = Object.keys(clusterAvg).map(k => ({ id: k, avg: clusterAvg[k].count > 0 ? clusterAvg[k].sum / clusterAvg[k].count : 0, members: clusterAvg[k].members }));
      clusters.sort((a, b) => a.avg - b.avg);
      currentLanes = clusters.flatMap(c => c.members.sort((a, b) => currentLanes.indexOf(a) - currentLanes.indexOf(b)));
    }
    rowLanes[r] = [...currentLanes];
  }

  const trackPoints = {};
  people.forEach(p => trackPoints[p] = []);
  const personCurrentX = {};
  for (let r = 0; r <= maxRow + 1; r++) {
    if (rowLanes[r]) rowLanes[r].forEach((p, i) => { personCurrentX[p] = MARGIN_H + i * TRACK_SPACING; });
    people.forEach(p => trackPoints[p].push({ x: personCurrentX[p] || MARGIN_H, y: MARGIN_TOP + r * ROW_HEIGHT }));
  }

  return { placedCards, transferStations, maxRows: maxRow + 1, trackPoints, warnings: { cards: warningCards, messages: warningMessages } };
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

// ── RENDERN MIT WARN-SYMBOLEN UND WIP-WÄCHTER ───────────────────────────────────────────────
window.renderUBahnMap = function() {
  try {
      _currentView = 'map'; 
      _currentPerson = null;
      
      ensureControls();
      const backBtn = document.getElementById('ubahn-back-btn');
      if(backBtn) backBtn.style.display = 'none';
      const container = document.getElementById('ubahn-content');
      if(!container) throw new Error("Element 'ubahn-content' wurde im HTML nicht gefunden.");
      
      _data = prepareBoardData();
      const { boardData, people, lineColors, allCardsFlat } = _data;
      if (!people.length) {
          container.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted);">Keine Personen mit Aufgaben gefunden.</div>`;
          return;
      }
      
      _lastGrid = calculateGrid(boardData, people);
      const { placedCards, transferStations, maxRows, trackPoints, warnings } = _lastGrid;

      // --- NEU: WIP-LIMIT WÄCHTER ---
      const activeTasksCount = allCardsFlat.filter(c => c.colName && c.colName.toLowerCase().includes('bearb')).length;
      const wipLimit = Math.floor(people.length * 1.5);
      
      if (activeTasksCount > wipLimit) {
          warnings.messages.add(`WIP-Limit überschritten! Max. ${wipLimit} aktive Aufgaben empfohlen (aktuell ${activeTasksCount}).`);
      }

      // ZENTRALE WARNUNG ANZEIGEN
      if (warnings.messages.size > 0 && typeof window.showToast === 'function') {
          const msgList = Array.from(warnings.messages).map(m => `• ${m}`).join('\n');
          window.showToast(`⚠️ Hinweise zum Plan:\n${msgList}`, 'warning');
      }
      
      const mapW = (people.length - 1) * TRACK_SPACING + MARGIN_H * 2;
      const mapH = maxRows * ROW_HEIGHT + MARGIN_TOP + 100;

      let svg = `<svg id="ubahn-svg-layer" width="${mapW}" height="${mapH}" style="position:absolute;inset:0;pointer-events:none;z-index:1;transition:opacity 0.25s ease;">`;
      people.forEach(p => {
        svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="var(--surface)" stroke-width="26" stroke-linejoin="round" stroke-linecap="round" opacity="1"/>`;
        svg += `<path d="${createTrackPath(trackPoints[p])}" fill="none" stroke="${lineColors[p]}" stroke-width="14" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`;
      });
      svg += `</svg>`;

      const isInProgress = c => c.colName && c.colName.toLowerCase().includes('bearb');

      let html = `<style>
        @keyframes ubahn-pulse { 0% { transform:scale(1); opacity:0.85; } 60% { transform:scale(1.9); opacity:0; } 100% { transform:scale(1.9); opacity:0; } }
        .ubahn-pulse-ring { position:absolute; border-radius:50%; pointer-events:none; animation: ubahn-pulse 1.8s ease-out infinite; }
      </style>`;
      
      people.forEach(p => {
        const sPt = trackPoints[p][0], ePt = trackPoints[p][maxRows], color = lineColors[p];
        html += `<button onclick='window.renderUBahnPerson(${JSON.stringify(p)})' style="position:absolute;left:${sPt.x - 60}px;top:${sPt.y - 70}px;width:120px;text-align:center;background:none;border:none;cursor:pointer;z-index:1005;"><div style="display:inline-block;background:var(--surface);border:4px solid ${color};border-radius:14px;padding:7px 12px;font-weight:900;font-size:12px;color:var(--text);box-shadow:0 4px 16px ${color}44;">${esc(p)}</div></button>`;
        html += `<div style="position:absolute;left:${sPt.x-12}px;top:${sPt.y-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
        html += `<div style="position:absolute;left:${ePt.x-12}px;top:${ePt.y-12}px;width:24px;height:24px;border-radius:50%;background:var(--surface);border:4px solid ${color};z-index:2;"></div>`;
      });

      transferStations.forEach(s => {
        const xs = s.involved.map(p => trackPoints[p][s.row].x);
        const xMin = Math.min(...xs), xMax = Math.max(...xs);
        if (xMax <= xMin) return;
        const y = s.row * ROW_HEIGHT + MARGIN_TOP;
        const width = (xMax - xMin) + 64;
        const lineWidth = (xMax - xMin);

        html += `<div class="ubahn-pill" style="position:absolute; left:${xMin - 32}px; top:${y - 26}px; width:${width}px; height:52px; background:#ffffff; border:2px solid #000; border-radius:26px; box-shadow:0 4px 15px rgba(0,0,0,0.4); z-index:1000; pointer-events:none; transition:background 0.25s ease, border-color 0.25s ease;"></div>`;
        html += `<div style="position:absolute; left:${xMin}px; top:${y - 4}px; width:${lineWidth}px; height:8px; background:#2d3748; z-index:1001; pointer-events:none;"></div>`;
      });

      placedCards.forEach(k => {
        const pt = trackPoints[k.wer][k.row], color = lineColors[k.wer], isHigh = k.prio === 'hoch';
        const active = isInProgress(k);
        
        const hasWarning = warnings.cards.has(k.id) || warnings.cards.has(k.label);
        const warningBadge = hasWarning ? `<div style="position:absolute; top:-8px; left:-8px; background:#facc15; color:#854d0e; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:12px; border:2px solid var(--surface); z-index:20; box-shadow:0 2px 4px rgba(0,0,0,0.3);" title="⚠️ Logik-Konflikt vom System aufgelöst">⚠️</div>` : '';

        if (active) html += `<div class="ubahn-pulse-ring" style="position:absolute;left:${pt.x-30}px;top:${pt.y-30}px;width:60px;height:60px;border:3px solid ${color};z-index:1003;transition:opacity 0.25s ease;"></div>`;
        
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
              ${warningBadge}
            </div>
          </div>`;
      });
      
      container.innerHTML = `<div style="position:relative;width:${mapW}px;height:${mapH}px;margin:0 auto;">${svg}${html}</div>`;
      
  } catch (err) {
      console.error("U-Bahn Crash:", err);
      const container = document.getElementById('ubahn-content');
      if (container) {
          container.innerHTML = `<div style="padding:40px;margin:20px;background:#fee2e2;border:1px solid #ef4444;border-radius:12px;color:#991b1b;"><h2>⚠️ Fehler</h2><p>${err.message}</p></div>`;
      }
  }
};

window.renderUBahnPerson = function(workerName) {
  _currentView = 'person'; _currentPerson = workerName;
  ensureControls();
  const backBtn = document.getElementById('ubahn-back-btn');
  if(backBtn) backBtn.style.display = 'inline-flex';
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

        const hasWarning = _lastGrid?.warnings?.cards?.has(k.id) || _lastGrid?.warnings?.cards?.has(k.label);
        const warningBadge = hasWarning ? `<div style="position:absolute; top:-6px; left:-6px; background:#facc15; color:#854d0e; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; font-size:11px; border:2px solid var(--surface); z-index:20; box-shadow:0 2px 4px rgba(0,0,0,0.3);" title="⚠️ Logik-Konflikt gelöst">⚠️</div>` : '';

        if (active) stationsHtml += `<div class="ubahn-pulse-ring" style="position:absolute;left:${X_LINE-(dotW/2)-8}px;top:${currentY-30}px;width:${dotW+16}px;height:60px;border:3px solid ${color};border-radius:30px;z-index:1001;"></div>`;
        stationsHtml += `
          <div onclick='window.showUBahnCardDetail(${JSON.stringify(k.label)})'
               style="position:absolute; left:${X_LINE-(dotW/2)}px; top:${currentY-22}px; width:${dotW}px; height:44px; border-radius:22px; background:var(--surface); border:4px solid ${color}; display:flex; align-items:center; justify-content:center; font-weight:900; color:var(--text); cursor:pointer; z-index:1002; box-shadow:${active ? `0 0 18px ${color}99` : 'none'};">
            ${esc(k.label)}
            ${isHigh ? `<span style="position:absolute; top:-4px; right:-4px; width:12px; height:12px; background:#ef4444; border-radius:50%; border:2px solid var(--surface); z-index:10;"></span>` : ''}
            ${warningBadge}
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
function _resolveCard(labelOrId) {
  const target = String(labelOrId).trim().toUpperCase();
  for (const [colId, cards] of Object.entries(S.cards)) {
    const c = cards.find(x => (x.label||'').trim().toUpperCase() === target || String(x.id).trim().toUpperCase() === target);
    if (c) return { id: c.id, label: c.label, titel: c.text, wer: c.assignee, colId, colName: S.columns.find(col => col.id === colId)?.name || '' };
  }
  return null;
}

// startOffset einer Karte setzen (aus Gantt-Drag aufrufbar)
window.saveCardStartOffset = function(label, offsetDays) {
  const found = _resolveCard(label);
  if (!found) return;
  const days = offsetDays !== null ? Math.max(0, Math.round(offsetDays * 10) / 10) : null;
  updateCard(S.currentBoard.id, found.colId, found.id, { startOffset: days });
  if (typeof window.loadCards === 'function') window.loadCards(found.colId);
  if (_data) {
    _data = prepareBoardData();
    _lastGrid = calculateGrid(_data.boardData, _data.people);
    window._lastGanttData = { data: _data, grid: _lastGrid };
  }
};

window._ubahnNav = function(label) {
  const overlay = document.getElementById('ubahn-card-overlay');
  if (overlay) {
    const inner = overlay.querySelector('[data-ubahn-popup]');
    if (inner) {
      inner.style.transition = 'opacity 0.15s, transform 0.15s';
      inner.style.opacity = '0';
      inner.style.transform = 'scale(0.95)';
    }
    setTimeout(() => { window.showUBahnCardDetail(label); _ubahnScrollToCard(label); }, 150);
  } else {
    window.showUBahnCardDetail(label);
    _ubahnScrollToCard(label);
  }
};

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

  const currentColId = Object.entries(S.cards).find(([, cards]) => cards.some(c => String(c.id).toUpperCase() === String(card.id).toUpperCase()))?.[0];
  const currentCol   = S.columns.find(c => c.id === currentColId);
  const isLocked     = currentCol && window.isFinishedColumn ? window.isFinishedColumn(currentCol) : false;

  const liveCard = (S.cards[currentColId] || []).find(c => String(c.id).toUpperCase() === String(card.id).toUpperCase());
  const description = liveCard?.description || card.description || '';

  const prereqs  = (card.deps || []).map(_resolveCard).filter(Boolean);
  const enables  = _data.allCardsFlat.filter(c => (c.deps || []).map(d=>String(d).trim().toUpperCase()).includes(String(card.label).trim().toUpperCase())).map(c => _resolveCard(c.label)).filter(Boolean);
  const groupPartners = card.gruppe ? _data.allCardsFlat.filter(c => c.gruppe === card.gruppe && c.wer !== card.wer) : [];

  const prioBadge = {
    hoch:    `<span style="background:#ef444422;color:#ef4444;border:1px solid #ef444466;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">▲ Hoch</span>`,
    niedrig: `<span style="background:#22c55e22;color:#22c55e;border:1px solid #22c55e66;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">▼ Niedrig</span>`,
  }[card.prio] || `<span style="background:var(--surface);color:var(--text-muted);border:1px solid var(--border);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">● Mittel</span>`;

  const colOptions = S.columns.map(col => `<option value="${col.id}" ${col.id === currentColId ? 'selected' : ''}>${esc(col.name)}</option>`).join('');
  const hr = `<div style="border:none;border-top:1px solid var(--border);margin:14px 0;"></div>`;
  const editStyle = isLocked ? 'pointer-events:none;opacity:0.7;' : '';

  document.getElementById('ubahn-card-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'ubahn-card-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);z-index:40000;display:flex;align-items:center;justify-content:center;';
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
        <div style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Geschätzte Bearbeitungszeit</div>
        <div style="display:flex; gap:10px;">
          ${[
            { id:'ubahn-time-d', label:'Tage',    val: liveCard?.timeEstimate?.d ?? '', max: '' },
            { id:'ubahn-time-h', label:'Stunden', val: liveCard?.timeEstimate?.h ?? '', max: 'max="23"' },
            { id:'ubahn-time-m', label:'Minuten', val: liveCard?.timeEstimate?.m ?? '', max: 'max="59"' },
          ].map(f => `
            <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
              <div style="font-size:10px;font-weight:700;color:${isLocked?'var(--text-muted)':color};text-align:center;letter-spacing:0.5px;">${f.label}</div>
              <input type="number" id="${f.id}"
                data-cardid="${card.id}" data-colid="${currentColId}"
                onchange="window.ubahn_saveTime(this)"
                value="${f.val}" min="0" ${f.max} placeholder="0"
                ${isLocked ? 'disabled' : ''}
                style="width:100%;padding:9px 8px;border-radius:10px;border:1px solid ${isLocked?'var(--border)':color};background:rgba(var(--panel-rgb),1);color:${isLocked?'var(--text-muted)':'var(--text)'};font-size:15px;font-weight:700;font-family:inherit;outline:none;text-align:center;box-sizing:border-box;">
            </div>`).join('')}
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

window.ubahn_saveLabel = function(input) {
  const newLabel = input.value.trim().toUpperCase().replace(/\s+/g, '');
  const oldLabel = input.dataset.original;
  const cardId   = input.dataset.cardid;
  const colId    = input.dataset.colid;
  if (!newLabel) { input.value = oldLabel; return; }
  if (newLabel === oldLabel) return;
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

window.ubahn_saveTitle = function(textarea) {
  const text   = textarea.value.trim();
  const cardId = textarea.dataset.cardid;
  const colId  = textarea.dataset.colid;
  if (!text) return;
  updateCard(S.currentBoard.id, colId, cardId, { text });
  if (typeof window.loadCards === 'function') window.loadCards(colId);
  if (_data) { _data = prepareBoardData(); if (_currentView === 'map') window.renderUBahnMap(); else if (_currentView === 'person') window.renderUBahnPerson(_currentPerson); }
};

window.ubahn_saveDescription = function(textarea) {
  const description = textarea.value;
  const cardId = textarea.dataset.cardid;
  const colId  = textarea.dataset.colid;
  updateCard(S.currentBoard.id, colId, cardId, { description });
  if (typeof window.loadCards === 'function') window.loadCards(colId);
  if (_data) _data = prepareBoardData();
};

window.ubahn_saveTime = function(input) {
  const cardId = input.dataset.cardid;
  const colId  = input.dataset.colid;
  const dInput = document.getElementById('ubahn-time-d');
  const hInput = document.getElementById('ubahn-time-h');
  const mInput = document.getElementById('ubahn-time-m');
  const timeEstimate = {
    d: parseFloat(dInput?.value) || 0,
    h: parseFloat(hInput?.value) || 0,
    m: parseFloat(mInput?.value) || 0,
  };
  updateCard(S.currentBoard.id, colId, cardId, { timeEstimate });
  if (typeof window.loadCards === 'function') window.loadCards(colId);
  if (_data) {
    _data = prepareBoardData();
    _lastGrid = calculateGrid(_data.boardData, _data.people);
    window._lastGanttData = { data: _data, grid: _lastGrid };
  }
};

window.openCardDetail = function(cardId, colId) {
  if (!_data) _data = prepareBoardData();
  if (!_lastGrid) _lastGrid = calculateGrid(_data.boardData, _data.people);
  const card = _data.allCardsFlat.find(c => c.id === cardId);
  if (!card) {
    const raw = (S.cards[colId] || []).find(c => c.id === cardId);
    if (!raw) return;
    const col = S.columns.find(c => c.id === colId);
    const tmp = { id: raw.id, label: raw.label || '?', titel: raw.text, wer: raw.assignee || '–', prio: raw.priority || 'mittel', deps: raw.dependencies || [], gruppe: raw.groupId || null, colName: col?.name || '', description: raw.description || '' };
    if (!_data.lineColors[tmp.wer]) _data.lineColors[tmp.wer] = '#6366f1';
    _data.allCardsFlat.push(tmp);
    window.showUBahnCardDetail(tmp.label);
  } else {
    window.showUBahnCardDetail(card.label);
  }
};

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

  const srcCard = (S.cards[fromColId]||[]).find(c => String(c.id).toUpperCase() === String(cardId).toUpperCase());
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

window.ubahnHoverCard = function(label) {
  if (!_data || !_data.allCardsFlat) return;
  const allCards = _data.allCardsFlat;
  const targetLabel = String(label).trim().toUpperCase();
  const hoveredCard = allCards.find(c => (c.label||'').trim().toUpperCase() === targetLabel);
  if (!hoveredCard) return;

  function getGenerations(startLabel, direction) {
    const startTarget = String(startLabel).trim().toUpperCase();
    const generations = new Map();
    const queue = [{ label: startTarget, depth: 0 }];
    const visited = new Set([startTarget]);

    while(queue.length > 0) {
      const { label: currLabel, depth } = queue.shift();
      if (depth > 0) generations.set(currLabel, depth);

      if (direction === 'up') { 
        const card = allCards.find(c => (c.label||'').trim().toUpperCase() === currLabel);
        if (card && card.deps) {
          card.deps.forEach(depLabel => {
            const normDep = String(depLabel).trim().toUpperCase();
            if (!visited.has(normDep)) { visited.add(normDep); queue.push({ label: normDep, depth: depth + 1 }); }
          });
        }
      } else { 
        const successors = allCards.filter(c => {
           const normDeps = (c.deps || []).map(d => String(d).trim().toUpperCase());
           return normDeps.includes(currLabel);
        });
        successors.forEach(succ => {
          const succLabel = (succ.label||'').trim().toUpperCase();
          if (succLabel && !visited.has(succLabel)) { visited.add(succLabel); queue.push({ label: succLabel, depth: depth + 1 }); }
        });
      }
    }
    return generations;
  }

  const preGens = getGenerations(label, 'up');
  const succGens = getGenerations(label, 'down');

  const svgLayer = document.getElementById('ubahn-svg-layer');
  if (svgLayer) svgLayer.style.opacity = '0.15';

  document.querySelectorAll('.ubahn-pill').forEach(p => { p.style.background = '#888'; p.style.borderColor = '#555'; });

  allCards.forEach(c => {
    const node = document.getElementById(`ubahn-node-${c.label}`);
    const ring = document.getElementById(`ubahn-ring-${c.label}`);
    if (!node || !ring) return;

    const normLabel = String(c.label).trim().toUpperCase();

    if (normLabel === targetLabel) {
      node.style.opacity = '1'; ring.style.boxShadow = '0 0 25px rgba(255,255,255,0.7)'; ring.style.transform = 'scale(1.15)';
    } else if (preGens.has(normLabel)) {
      const depth = preGens.get(normLabel);
      const intensity = Math.max(0.25, 1 - (depth - 1) * 0.3); 
      node.style.opacity = intensity.toString(); ring.style.borderColor = '#f59e0b'; ring.style.color = '#f59e0b'; ring.style.boxShadow = `0 0 ${20 * intensity}px rgba(245, 158, 11, ${intensity})`; ring.style.transform = depth === 1 ? 'scale(1.05)' : 'scale(1)';
    } else if (succGens.has(normLabel)) {
      const depth = succGens.get(normLabel);
      const intensity = Math.max(0.25, 1 - (depth - 1) * 0.3); 
      node.style.opacity = intensity.toString(); ring.style.borderColor = '#10b981'; ring.style.color = '#10b981'; ring.style.boxShadow = `0 0 ${20 * intensity}px rgba(16, 185, 129, ${intensity})`; ring.style.transform = depth === 1 ? 'scale(1.05)' : 'scale(1)';
    } else {
      node.style.opacity = '0.15';
    }
  });
};

window.ubahnLeaveCard = function() {
  if (!_data || !_data.allCardsFlat) return;
  const svgLayer = document.getElementById('ubahn-svg-layer');
  if (svgLayer) svgLayer.style.opacity = '1';
  document.querySelectorAll('.ubahn-pill').forEach(p => { p.style.background = '#ffffff'; p.style.borderColor = '#000'; });

  _data.allCardsFlat.forEach(c => {
    const node = document.getElementById(`ubahn-node-${c.label}`);
    const ring = document.getElementById(`ubahn-ring-${c.label}`);
    if (!node || !ring) return;
    const originalColor = ring.getAttribute('data-color');
    const isActive = ring.getAttribute('data-active') === 'true';
    node.style.opacity = '1'; ring.style.transform = 'scale(1)'; ring.style.borderColor = originalColor; ring.style.color = 'var(--text)'; ring.style.boxShadow = isActive ? `0 4px 14px rgba(0,0,0,0.4), 0 0 18px ${originalColor}99` : '0 4px 14px rgba(0,0,0,0.4)';
  });
};

window.openGanttFromUBahn = async function() {
  if (!_lastGrid || !_data) {
    if (typeof window.showToast === 'function') window.showToast("Bitte warten, bis das Netz berechnet wurde.", "error");
    return;
  }
  try {
      const ganttModule = await import('./gantt.js');
      if (ganttModule && ganttModule.showGanttView) { ganttModule.showGanttView(_data, _lastGrid); }
      else { alert("Fehler: 'showGanttView' nicht exportiert in gantt.js."); }
  } catch(error) { alert("KRITISCHER FEHLER:\n" + error.message); }
};
