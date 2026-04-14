// js/grading.js — Bewertungssystem, Board-Toolbox, Watched Boards (lokal, kein Firebase)
import { S, getBoards, getColumns, getCards, updateCard, updateBoard } from './state.js';

// ── PRODUKTNOTEN (localStorage) ───────────────────────
const GRADES_KEY = 'kanban_grades';

async function getProductGrades(boardId) {
  try {
    const all = JSON.parse(localStorage.getItem(GRADES_KEY) || '{}');
    const entry = all[boardId];
    if (!entry) return {};
    if (entry.encrypted && entry.tchKeyEnc && entry.encData) {
      const privKey = window._tutorSession?.privateKey;
      if (!privKey) return {};
      const keyB64 = await window.kfCrypto.rsaDecryptKey(entry.tchKeyEnc, privKey);
      const key    = await window.kfCrypto.importKey(keyB64);
      const json   = await window.kfCrypto.decryptWithKey(entry.encData, key);
      return JSON.parse(json);
    }
    return entry; // Legacy: unverschlüsselte Einträge
  } catch(e) { return {}; }
}

async function saveProductGrades(boardId, grades) {
  const all = JSON.parse(localStorage.getItem(GRADES_KEY) || '{}');
  const ini = window._loadedIni;
  if (ini && ini.publicKey) {
    try {
      const pubKey     = await window.kfCrypto.importPubJwk(ini.publicKey);
      const dataKey    = await window.kfCrypto.genDataKey();
      const dataKeyB64 = await window.kfCrypto.exportKey(dataKey);
      const encData    = await window.kfCrypto.encryptWithKey(JSON.stringify(grades), dataKey);
      const tchKeyEnc  = await window.kfCrypto.rsaEncryptKey(dataKeyB64, pubKey);
      all[boardId] = { encrypted: true, tchKeyEnc, encData };
    } catch(e) {
      all[boardId] = grades; // Fallback: unverschlüsselt
    }
  } else {
    all[boardId] = grades;
  }
  localStorage.setItem(GRADES_KEY, JSON.stringify(all));
}

// ── HILFSFUNKTION: "Fertig"-Spalte finden ─────────────
function findDoneCol(cols) {
  return cols.find(c => {
    const n = (c.name || '').toLowerCase();
    return n.includes('fertig') || n.includes('done') || n.includes('erledigt') || n.includes('abgeschlossen');
  });
}

// ── ADMIN BOARD-TOOLS LADEN ────────────────────────────
window.loadAdminBoardTools = async () => {
  if (typeof window.currentUserIsAdmin === 'function' && !(await window.currentUserIsAdmin())) {
    showToast('Sitzung abgelaufen. Bitte Admin-Bereich erneut öffnen.', 'error');
    return;
  }
  const boardId = document.getElementById('admin-bt-board-select').value;
  const container = document.getElementById('admin-bt-tools-container');

  if (!boardId) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'flex';

  const board = getBoards().find(b => b.id === boardId);
  if (!board) { showToast('Board nicht gefunden', 'error'); return; }

  S.currentBoard = board;
  if (typeof renderBoardsList === 'function') renderBoardsList();
  if (typeof loadColumns === 'function') loadColumns();

  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('board-content').style.display = 'block';
  document.getElementById('board-title-display').innerHTML = escHtml(board.name) + ' <i data-lucide="eye" style="width:20px;height:20px;vertical-align:-4px;margin-left:8px;opacity:0.7;"></i> <span style="font-size:16px;opacity:0.7;font-weight:500;">(Admin)</span>';
  setTimeout(reloadIcons, 50);
  if (typeof syncBackgroundToUser === 'function') syncBackgroundToUser();

  document.getElementById('admin-bt-deadline').value = board.deadline || '';
  document.getElementById('admin-bt-aging').value = board.agingDays || 5;

  const isWatched = !!board.isWatched;
  document.getElementById('admin-bt-watch-toggle').checked = isWatched;
  updateWatchToggleVisual(isWatched);

  const list = document.getElementById('admin-bt-grades-list');
  list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Lade Bewertungsdaten...</div>';

  const cols = getColumns(boardId);
  const doneCol = findDoneCol(cols);

  if (!doneCol) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Keine "Fertig"-Spalte gefunden.</div>';
    return;
  }

  const finishedCards = getCards(boardId, doneCol.id);

  let boardTotalEffort = 0;
  finishedCards.forEach(c => boardTotalEffort += parseInt(c.effort || '1'));

  const productGrades = await getProductGrades(boardId);

  const members = board.members || [];
  const historicalAssignees = [...new Set(finishedCards.map(c => c.assignee).filter(a => a && !members.includes(a)))];
  const allMembers = [...members, ...historicalAssignees];
  if (!allMembers.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);">Dieses Board hat keine Mitglieder definiert.</div>';
    return;
  }

  let html = `
    <div style="font-size:12px; color:var(--text-muted); margin-bottom:20px; padding:12px 16px; background:rgba(77,127,255,0.06); border:1px solid rgba(77,127,255,0.2); border-radius:8px; line-height:1.6;">
      <strong style="color:var(--text); font-size:13px;">ℹ️ Benotungssystem: Prozess (50%) + Produkt (50%)</strong><br>
      Die Noten an den einzelnen Karten dienen rein der <strong>Benotung des Prozesses</strong>. Um aufwendige Aufgaben stärker in die Prozessnote einfließen zu lassen, wird zusätzlich zur Note ein Aufwandswert (1x, 2x, 4x, 8x, 16x) vergeben. Der prozentuale Anteil der Person am Gesamtprojekt wird automatisch berechnet. Noch nicht benotete Prozess-Karten sind <span style="color:#ef4444; font-weight:600;">rot</span> markiert.<br>
      Nach Abschluss des Projektes wird unten die <strong>Produktnote</strong> eingetragen. Diese beinhaltet das Endprodukt sowie die Präsentation des Produktes. Beide Anteile werden anschließend zu 50% für die Gesamtnote zusammengerechnet.
    </div>
    <div style="display:flex; gap:8px; margin-bottom:20px;">
      <button class="btn-sm btn-sm-primary" onclick="exportBoardGrades()" style="display:flex; align-items:center; gap:6px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Noten exportieren
      </button>
    </div>
  `;

  allMembers.forEach(member => {
    const isHistorical = historicalAssignees.includes(member);
    const memberCards = finishedCards.filter(c => c.assignee === member);

    let totalEffort = 0;
    let weightedGradeSum = 0;

    let cardsHtml = '';
    if (memberCards.length === 0) {
      cardsHtml = '<div style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Keine Aufgaben in der Fertig-Spalte.</div>';
    } else {
      cardsHtml = memberCards.map(c => {
        const gradeVal = c.grade || '';
        const effortVal = c.effort || '1';
        const comment  = c.gradeComment || '';

        if (gradeVal && effortVal) {
          totalEffort += parseInt(effortVal);
          weightedGradeSum += (parseFloat(gradeVal) * parseInt(effortVal));
        }

        const isUngraded = !gradeVal;
        const borderColor = isUngraded ? '#ef4444' : 'var(--success)';
        const bgColor = isUngraded ? 'rgba(239,68,68,0.04)' : 'var(--surface2)';

        let dateStr = 'Unbekannt';
        if (c.finishedAt) {
          const d = new Date(c.finishedAt);
          dateStr = d.toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric'});
        }

        return `
        <div style="border-left: 3px solid ${borderColor}; margin-bottom:10px; background:${bgColor}; border-radius:0 8px 8px 0; padding:10px 14px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px; align-items:flex-start;">
            <span style="font-weight:600; font-size:13px; color:var(--text); cursor:pointer; padding:2px 6px; background:rgba(255,255,255,0.05); border-radius:4px; border:1px solid var(--border); display:flex; align-items:center; gap:6px;" onclick="openCardJourney('${boardId}', '${doneCol.id}', '${c.id}')" title="Karten-Reise ansehen">
              <i data-lucide="search" style="width:14px;height:14px;"></i> ${escHtml(c.text)}
            </span>
            <span style="font-size:11px; color:var(--text-muted); padding-top:4px;">📅 Beendet: ${dateStr}</span>
          </div>
          <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:var(--text-muted); font-weight:600;">NOTE:</span>
              <select class="grade-select ${gradeVal ? 'grade-'+gradeVal : ''}" id="grade-val-${boardId}-${c.id}" style="width:50px; padding:4px 2px;" onchange="this.className='grade-select grade-'+this.value; saveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                <option value="">-</option>
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${gradeVal==n?'selected':''}>${n}</option>`).join('')}
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:11px; color:var(--text-muted); font-weight:600;">AUFWAND:</span>
              <select class="settings-input" id="effort-val-${boardId}-${c.id}" style="width:55px; padding:4px 2px; font-size:12px;" onchange="saveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                ${[1,2,4,8,16].map(n => `<option value="${n}" ${effortVal==n?'selected':''}>${n}x</option>`).join('')}
              </select>
            </div>
            <input type="text" id="grade-comment-${boardId}-${c.id}" value="${escHtml(comment)}" placeholder="Kommentar zur Aufgabe..." class="settings-input" style="flex:1; min-width:120px; padding:4px 8px; font-size:12px;" onblur="saveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
          </div>
        </div>`;
      }).join('');
    }

    let processGrade = totalEffort > 0 ? (weightedGradeSum / totalEffort).toFixed(1) : '-';
    let sharePct = boardTotalEffort > 0 ? Math.round((totalEffort / boardTotalEffort) * 100) : 0;

    const pData = productGrades[member] || {};
    const prodGrade = pData.grade || '';
    const prodComment = pData.comment || '';

    let finalGrade = '-';
    if (processGrade !== '-' && prodGrade) {
      finalGrade = ((parseFloat(processGrade) + parseFloat(prodGrade)) / 2).toFixed(1);
    }

    html += `
    <div style="margin-bottom:32px; border:1px solid var(--border); border-radius:12px; overflow:hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
      <div style="background:var(--surface2); padding:12px 16px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:12px;">
        <div class="assignee-avatar">${member.slice(0,2).toUpperCase()}</div>
        <span style="font-weight:700; font-size:14px; flex:1;">${escHtml(member)}${isHistorical ? ' <span style="font-size:10px; font-weight:400; color:var(--text-muted); background:rgba(245,158,11,0.15); padding:1px 6px; border-radius:4px; margin-left:6px;">ehem.</span>' : ''}</span>
        <div style="text-align:right; font-size:12px; display:flex; gap:16px; background:rgba(0,0,0,0.1); padding:6px 12px; border-radius:8px;">
          <div><span style="color:var(--text-muted); margin-right:4px;">Prozess:</span> <strong style="color:var(--text); font-size:14px;">${processGrade}</strong></div>
          <div style="border-left:1px solid var(--border); padding-left:12px;"><span style="color:var(--text-muted); margin-right:4px;">Anteil:</span> <strong style="color:var(--text); font-size:14px;">${sharePct}%</strong></div>
          <div style="border-left:1px solid var(--border); padding-left:12px;"><span style="color:var(--text-muted); margin-right:4px;">Gesamtnote:</span> <strong style="color:var(--success); font-size:14px;">${finalGrade}</strong></div>
        </div>
      </div>

      <div style="padding:16px;">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
          Karten im Prozess
        </div>
        ${cardsHtml}

        <div style="margin-top:20px; padding-top:16px; border-top:1px dashed var(--border);">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:12px; display:flex; align-items:center; gap:6px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
            Produkt & Präsentation
          </div>
          <div style="display:flex; gap:10px; align-items:center; background:var(--surface2); padding:10px 14px; border-radius:8px; border:1px solid var(--border);">
            <span style="font-size:11px; color:var(--text-muted); font-weight:600;">NOTE:</span>
            <select class="grade-select ${prodGrade ? 'grade-'+prodGrade : ''}" id="prod-val-${boardId}-${escHtml(member)}" style="width:55px; padding:4px 2px;" onchange="this.className='grade-select grade-'+this.value; saveProductGrade('${boardId}', '${escHtml(member)}')">
              <option value="">-</option>
              ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${prodGrade==n?'selected':''}>${n}</option>`).join('')}
            </select>
            <input type="text" id="prod-comment-${boardId}-${escHtml(member)}" value="${escHtml(prodComment)}" placeholder="Fazit / Kommentar zum Endprodukt..." class="settings-input" style="flex:1; padding:6px 10px; font-size:12px;" onblur="saveProductGrade('${boardId}', '${escHtml(member)}')">
          </div>
        </div>

        <div style="margin-top:16px; padding-top:12px; border-top:1px dashed var(--border);">
          <button class="btn-sm btn-sm-ghost" onclick="generateGutachtenPrompt('${escHtml(member)}')" style="display:flex; align-items:center; gap:6px; width:100%;">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
            Gutachten-Prompt erzeugen
          </button>
        </div>
      </div>
    </div>`;
  });

  list.innerHTML = html;
};

// ── NOTEN-EXPORT ─────────────────────────────────────
window.exportBoardGrades = async () => {
  const boardId = document.getElementById('admin-bt-board-select')?.value || S.currentBoard?.id;
  if (!boardId) { showToast('Kein Board ausgewählt.', 'error'); return; }

  try {
    const board = getBoards().find(b => b.id === boardId);
    if (!board) { showToast('Board nicht gefunden.', 'error'); return; }
    const boardName = board.name || 'Unbenannt';
    const members = board.members || [];

    const cols = getColumns(boardId);
    const doneCol = findDoneCol(cols);

    let finishedCards = [];
    if (doneCol) {
      finishedCards = getCards(boardId, doneCol.id);
    }

    let boardTotalEffort = 0;
    finishedCards.forEach(c => boardTotalEffort += parseInt(c.effort || '1'));

    const historicalAssignees = [...new Set(finishedCards.map(c => c.assignee).filter(a => a && !members.includes(a)))];
    const allMembers = [...members, ...historicalAssignees];

    const productGrades = await getProductGrades(boardId);

    const sep = '═'.repeat(60);
    const sep2 = '─'.repeat(60);
    const now = new Date();
    const datum = now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    let lines = [];
    lines.push(sep);
    lines.push(`  NOTENÜBERSICHT: ${boardName.toUpperCase()}`);
    lines.push(`  Exportiert am: ${datum}`);
    lines.push(`  Gruppe: ${board.groupId || 'keine'}`);
    lines.push(sep);
    lines.push('');

    if (!allMembers.length) {
      lines.push('  Keine Mitglieder in diesem Board definiert.');
    } else {
      allMembers.forEach(member => {
        const isHistorical = historicalAssignees.includes(member);
        const memberCards = finishedCards.filter(c => c.assignee === member);
        let totalEffort = 0;
        let weightedGradeSum = 0;

        lines.push(sep2);
        lines.push(`  ${member.toUpperCase()}${isHistorical ? ' (ehem.)' : ''}`);
        lines.push(sep2);

        if (memberCards.length === 0) {
          lines.push('  Keine abgeschlossenen Aufgaben.');
        } else {
          lines.push('');
          lines.push('  PROZESS-KARTEN:');
          memberCards.forEach((c, idx) => {
            const gradeVal = c.grade || '';
            const effortVal = c.effort || '1';
            const comment = c.gradeComment || '';

            if (gradeVal && effortVal) {
              totalEffort += parseInt(effortVal);
              weightedGradeSum += (parseFloat(gradeVal) * parseInt(effortVal));
            }

            const noteText = gradeVal ? `Note ${gradeVal}` : 'OFFEN';
            const effortText = `Aufwand ${effortVal}x`;
            const finDate = c.finishedAt ? new Date(c.finishedAt).toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', year:'numeric'}) : '';
            lines.push(`    ${idx + 1}. ${c.text}`);
            lines.push(`       ${noteText} | ${effortText}${comment ? ' | ' + comment : ''}${finDate ? ' | Fertig: ' + finDate : ''}`);

            const comments = c.comments || [];
            if (comments.length > 0) {
              comments.forEach(cm => {
                const rolle = cm.role === 'teacher' ? 'Tutor' : 'SchülerIn';
                const zeit = cm.createdAt ? new Date(cm.createdAt).toLocaleDateString('de-DE', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'}) : '';
                lines.push(`       💬 [${rolle}] ${cm.author || '?'} (${zeit}): ${cm.text}`);
              });
            }
          });
        }

        const processGrade = totalEffort > 0 ? (weightedGradeSum / totalEffort).toFixed(1) : '-';
        let sharePct = boardTotalEffort > 0 ? Math.round((totalEffort / boardTotalEffort) * 100) : 0;
        const pData = productGrades[member] || {};
        const prodGrade = pData.grade || '';
        const prodComment = pData.comment || '';
        let finalGrade = '-';
        if (processGrade !== '-' && prodGrade) {
          finalGrade = ((parseFloat(processGrade) + parseFloat(prodGrade)) / 2).toFixed(1);
        }

        lines.push('');
        lines.push(`  PROJEKTANTEIL (Aufwand): ${sharePct}% des Gesamtprojekts`);
        lines.push(`  PROZESSNOTE (gewichtet): ${processGrade}`);
        lines.push(`  PRODUKTNOTE:             ${prodGrade || '-'}${prodComment ? '  (' + prodComment + ')' : ''}`);
        lines.push(`  ──────────────────────────────`);
        lines.push(`  GESAMTNOTE:              ${finalGrade}`);
        lines.push('');
      });
    }

    lines.push(sep);

    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      showToast('✅ Notenübersicht in die Zwischenablage kopiert!');
    } catch (e) {
      const pre = document.createElement('pre');
      pre.textContent = text;
      pre.style.cssText = 'white-space:pre-wrap; font-size:11px; background:rgba(0,0,0,0.3); padding:12px; border-radius:8px; max-height:60vh; overflow:auto; user-select:all;';
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';
      wrapper.onclick = () => wrapper.remove();
      const inner = document.createElement('div');
      inner.style.cssText = 'background:var(--bg-card); padding:20px; border-radius:12px; max-width:700px; width:100%;';
      inner.innerHTML = '<div style="font-weight:700; margin-bottom:12px;">Notenübersicht (bitte manuell kopieren):</div>';
      inner.appendChild(pre);
      inner.onclick = (e) => e.stopPropagation();
      wrapper.appendChild(inner);
      document.body.appendChild(wrapper);
    }
  } catch (err) {
    console.error('Export-Fehler:', err);
    showToast('Fehler beim Exportieren: ' + err.message, 'error');
  }
};

// ── GUTACHTEN-PROMPT ─────────────────────────────────
window.generateGutachtenPrompt = async (member) => {
  const boardId = document.getElementById('admin-bt-board-select')?.value || S.currentBoard?.id;
  if (!boardId) { showToast('Kein Board ausgewählt.', 'error'); return; }

  try {
    const board = getBoards().find(b => b.id === boardId);
    if (!board) { showToast('Board nicht gefunden.', 'error'); return; }
    const boardName = board.name || 'Unbenannt';

    const cols = getColumns(boardId);
    const doneCol = findDoneCol(cols);

    let finishedCards = [];
    if (doneCol) {
      finishedCards = getCards(boardId, doneCol.id);
    }

    let boardTotalEffort = 0;
    finishedCards.forEach(c => boardTotalEffort += parseInt(c.effort || '1'));

    const memberCards = finishedCards.filter(c => c.assignee === member);
    const productGrades = await getProductGrades(boardId);

    let totalEffort = 0, weightedGradeSum = 0;
    memberCards.forEach(c => {
      const g = c.grade || '', e = c.effort || '1';
      if (g && e) { totalEffort += parseInt(e); weightedGradeSum += (parseFloat(g) * parseInt(e)); }
    });

    const processGrade = totalEffort > 0 ? (weightedGradeSum / totalEffort).toFixed(1) : 'not graded yet';
    let sharePct = boardTotalEffort > 0 ? Math.round((totalEffort / boardTotalEffort) * 100) : 0;

    const pData = productGrades[member] || {};
    const prodGrade = pData.grade || 'not graded yet';
    const prodComment = pData.comment || '';
    let finalGrade = 'still pending';
    if (processGrade !== 'not graded yet' && prodGrade !== 'not graded yet') {
      finalGrade = ((parseFloat(processGrade) + parseFloat(prodGrade)) / 2).toFixed(1);
    }

    let kartenText = '';
    if (memberCards.length === 0) {
      kartenText = '  (No completed tasks available.)\n';
    } else {
      memberCards.forEach((c, idx) => {
        const note = c.grade ? `Grade ${c.grade}` : 'not yet graded';
        const aufwand = c.effort || '1';
        const kommentar = c.gradeComment || '';
        const fertig = c.finishedAt ? new Date(c.finishedAt).toLocaleDateString('de-DE') : '';

        kartenText += `  ${idx + 1}. "${c.text}"\n`;
        kartenText += `     Evaluation: ${note}, Effort Weight: ${aufwand}x${kommentar ? ', Teacher Comment: ' + kommentar : ''}${fertig ? ', Completed: ' + fertig : ''}\n`;

        const comments = c.comments || [];
        if (comments.length > 0) {
          kartenText += '     Comment History:\n';
          comments.forEach(cm => {
            const rolle = cm.role === 'teacher' ? 'Teacher' : 'Student';
            kartenText += `       – ${rolle} (${cm.author || '?'}): "${cm.text}"\n`;
          });
        }
        kartenText += '\n';
      });
    }

    const prompt = `You are an experienced teacher. Your task is to write a short, professional evaluation report about a student's project work.

STUDENT NAME: ${member}
PROJECT: ${boardName}

DATA BASIS – COMPLETED TASKS:
${kartenText}
GRADES AND METRICS:
  Process Grade (weighted by effort): ${processGrade}
  Product Grade: ${prodGrade}${prodComment ? ' (' + prodComment + ')' : ''}
  Overall Grade (50/50): ${finalGrade}
  Project Contribution: ${sharePct}% of the total team effort.

INSTRUCTIONS:
1. Write an evaluation of about 8–12 sentences.
2. Address the specific tasks – what was solved well, where were the difficulties?
3. Consider the comment history between teacher and student as an indicator of the work process.
4. Mention the effort weighting: Tasks with higher effort should be appreciated accordingly.
5. Consider the project contribution percentage (${sharePct}%).
6. Conclude with a brief contextualization of the overall grade.
7. Do not use empty buzzwords. Write suitably for a school report card or project report.
8. Write the evaluation in the third person ("The student...").
9. CRITICAL: The tone must ALWAYS be appreciative and respectful. If the grades are poor, the evaluation must be highly encouraging and constructive.
10. Generate the final output in German.`;

    try {
      await navigator.clipboard.writeText(prompt);
      showToast('✅ Gutachten-Prompt für ' + member + ' kopiert!');
    } catch (e) {
      const pre = document.createElement('pre');
      pre.textContent = prompt;
      pre.style.cssText = 'white-space:pre-wrap; font-size:11px; background:rgba(0,0,0,0.3); padding:12px; border-radius:8px; max-height:60vh; overflow:auto; user-select:all;';
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';
      wrapper.onclick = () => wrapper.remove();
      const inner = document.createElement('div');
      inner.style.cssText = 'background:var(--bg-card); padding:20px; border-radius:12px; max-width:700px; width:100%;';
      inner.innerHTML = '<div style="font-weight:700; margin-bottom:12px;">Gutachten-Prompt (bitte manuell kopieren):</div>';
      inner.appendChild(pre);
      inner.onclick = (e2) => e2.stopPropagation();
      wrapper.appendChild(inner);
      document.body.appendChild(wrapper);
    }
  } catch (err) {
    console.error('Gutachten-Fehler:', err);
    showToast('Fehler: ' + err.message, 'error');
  }
};

// ── ADMIN BOARD-TOOLS SPEICHERN ───────────────────────
window.saveAdminBoardDeadline = () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  if (!boardId) return;
  const value = document.getElementById('admin-bt-deadline').value || '';
  updateBoard(boardId, { deadline: value });
  showToast(value ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

window.clearAdminBoardDeadline = () => {
  document.getElementById('admin-bt-deadline').value = '';
  saveAdminBoardDeadline();
};

window.saveAdminBoardAging = () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  if (!boardId) return;
  const val = parseInt(document.getElementById('admin-bt-aging').value) || 5;
  updateBoard(boardId, { agingDays: val });
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

// ── WATCH-TOGGLE ──────────────────────────────────────
window.updateWatchToggleVisual = (isChecked) => {
  const bg = document.getElementById('admin-bt-watch-bg');
  const knob = document.getElementById('admin-bt-watch-knob');
  if (!bg || !knob) return;
  if (isChecked) {
    bg.style.backgroundColor = 'rgba(77,127,255,0.2)';
    bg.style.borderColor = 'var(--accent)';
    knob.style.backgroundColor = 'var(--accent)';
    knob.style.transform = 'translateX(18px)';
  } else {
    bg.style.backgroundColor = 'var(--surface2)';
    bg.style.borderColor = 'var(--border)';
    knob.style.backgroundColor = 'var(--text-muted)';
    knob.style.transform = 'translateX(0)';
  }
};

window.toggleAdminBoardWatch = () => {
  const boardId = document.getElementById('admin-bt-board-select').value;
  if (!boardId) return;
  const isChecked = document.getElementById('admin-bt-watch-toggle').checked;
  updateWatchToggleVisual(isChecked);
  updateBoard(boardId, { isWatched: isChecked });
  showToast(isChecked ? 'Board wird nun beobachtet 👀' : 'Beobachtung beendet');
  checkWatchedBoards();
};

// ── SCROLL-POSITION MERKEN & WIEDERHERSTELLEN ──────────
window.safeReloadAdminTools = async () => {
  const adminPanel = document.getElementById('admin-panel');
  const scrollStates = [];

  if (adminPanel) {
    adminPanel.querySelectorAll('*').forEach(el => {
      if (el.scrollTop > 0) scrollStates.push({ el: el, top: el.scrollTop });
    });
  }

  await loadAdminBoardTools();

  if (typeof lucide !== 'undefined') lucide.createIcons();

  setTimeout(() => {
    scrollStates.forEach(state => {
      if (state.el) state.el.scrollTop = state.top;
    });
  }, 50);
};

// ── KARTEN-NOTE SPEICHERN ─────────────────────────────
window.saveCardGrade = async (boardId, colId, cardId) => {
  const grade   = document.getElementById(`grade-val-${boardId}-${cardId}`)?.value || '';
  const effort  = document.getElementById(`effort-val-${boardId}-${cardId}`)?.value || '1';
  const comment = document.getElementById(`grade-comment-${boardId}-${cardId}`)?.value.trim() || '';

  updateCard(boardId, colId, cardId, { grade, effort, gradeComment: comment, gradedAt: new Date().toISOString() });

  showToast('Bewertung automatisch gespeichert!');
  await safeReloadAdminTools();
  checkWatchedBoards();
};

// ── PRODUKTNOTE SPEICHERN ─────────────────────────────
window.saveProductGrade = async (boardId, member) => {
  const grade   = document.getElementById(`prod-val-${boardId}-${member}`)?.value || '';
  const comment = document.getElementById(`prod-comment-${boardId}-${member}`)?.value.trim() || '';

  const grades = await getProductGrades(boardId);
  grades[member] = { member, grade, comment, updatedAt: new Date().toISOString() };
  await saveProductGrades(boardId, grades);

  showToast(`Produktnote für ${member} gespeichert!`);
  await safeReloadAdminTools();
};

// ── WATCHED BOARDS PRÜFEN ─────────────────────────────
window.checkWatchedBoards = () => {
  const warningBox = document.getElementById('admin-global-warning');
  const warningText = document.getElementById('admin-global-warning-text');
  if (!warningBox || !warningText) return;

  try {
    const watchedBoards = getBoards().filter(b => b.isWatched);
    if (!watchedBoards.length) {
      warningBox.style.display = 'none';
      return;
    }

    let ungradedCount = 0;
    let boardsWithUngraded = [];

    for (const board of watchedBoards) {
      const cols = getColumns(board.id);
      const doneCol = findDoneCol(cols);
      if (doneCol) {
        const cards = getCards(board.id, doneCol.id);
        const countInBoard = cards.filter(c => !c.grade).length;
        if (countInBoard > 0) {
          ungradedCount += countInBoard;
          boardsWithUngraded.push(`${escHtml(board.name)} (${countInBoard})`);
        }
      }
    }

    if (ungradedCount > 0) {
      warningText.innerHTML = `Es gibt <strong>${ungradedCount} unbenotete Aufgaben</strong> in deinen beobachteten Boards:<br>${boardsWithUngraded.join(', ')}`;
      warningBox.style.display = 'block';
    } else {
      warningBox.style.display = 'none';
    }
  } catch(e) {
    console.error("Fehler beim Prüfen:", e);
  }
};

// ── TOOLBOX (INLINE IM ADMIN-PANEL) ──────────────────
window.toolboxSaveDeadline = (boardId) => {
  const val = document.getElementById('toolbox-deadline-' + boardId)?.value || '';
  updateBoard(boardId, { deadline: val });
  showToast(val ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

window.toolboxSaveAging = (boardId) => {
  const val = parseInt(document.getElementById('toolbox-aging-' + boardId)?.value) || 5;
  updateBoard(boardId, { agingDays: val });
  showToast('Aging-Limit gespeichert');
};

window.safeReloadToolbox = async (boardId) => {
  const adminPanel = document.getElementById('admin-panel');
  const savedScrollTop = adminPanel ? adminPanel.scrollTop : 0;

  const boardName = document.querySelector('#admin-board-toolbox > div > div > div:nth-child(1)')?.textContent || 'Board';
  const ownerName = document.querySelector('#admin-board-toolbox > div > div > div:nth-child(2)')?.textContent || '';

  await openBoardToolbox(boardId, boardName, ownerName);

  setTimeout(() => {
    if (adminPanel) adminPanel.scrollTop = savedScrollTop;
  }, 10);
};

window.openBoardToolbox = async (boardId, boardName, ownerName) => {
  let toolbox = document.getElementById('admin-board-toolbox');
  if (!toolbox) {
    toolbox = document.createElement('div');
    toolbox.id = 'admin-board-toolbox';
    toolbox.style.cssText = 'margin-top:16px; padding:16px; background:var(--bg-card); border:2px solid var(--border); border-radius:12px; box-shadow:0 8px 24px rgba(0,0,0,0.2);';
    const container = document.getElementById('admin-group-boards-list');
    if (container) container.after(toolbox);
  }

  toolbox.innerHTML = '<div style="opacity:0.5; font-size:12px;">Lade Notenmodul...</div>';

  const board = getBoards().find(b => b.id === boardId);
  if (!board) { showToast('Board nicht gefunden', 'error'); return; }

  const deadline = board.deadline || '';
  const agingDays = board.agingDays || 5;
  const members = board.members || [];

  const cols = getColumns(boardId);
  const doneCol = findDoneCol(cols);

  let finishedCards = [];
  if (doneCol) {
    finishedCards = getCards(boardId, doneCol.id);
  }

  let boardTotalEffort = 0;
  finishedCards.forEach(c => boardTotalEffort += parseInt(c.effort || '1'));

  const historicalAssignees = [...new Set(finishedCards.map(c => c.assignee).filter(a => a && !members.includes(a)))];
  const allMembers = [...members, ...historicalAssignees];
  const productGrades = await getProductGrades(boardId);

  let html = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <div style="font-weight:800; font-size:16px; color:var(--primary);">${escHtml(boardName)}</div>
        <div style="font-size:11px; color:var(--text-muted);">${escHtml(ownerName)}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-sm btn-sm-primary" onclick="adminViewBoard('${boardId}')" title="Board live ansehen">
          <i data-lucide="eye" style="width:14px;"></i> Ansehen
        </button>
        <button class="btn-sm btn-sm-ghost" onclick="document.getElementById('admin-board-toolbox').remove()" title="Schließen">✕</button>
      </div>
    </div>

    <div style="display:flex; gap:20px; margin-bottom:20px; flex-wrap:wrap; background:var(--surface2); padding:10px; border-radius:8px;">
      <div>
        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase;">Abgabetermin</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="date" id="toolbox-deadline-${boardId}" value="${deadline}" class="settings-input" style="padding:4px 8px; font-size:12px; border:1px solid var(--border);"/>
          <button class="btn-sm btn-sm-primary" onclick="toolboxSaveDeadline('${boardId}')"><i data-lucide="save" style="width:12px;"></i></button>
        </div>
      </div>
      <div>
        <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase;">Aging-Warnung</div>
        <div style="display:flex; gap:6px; align-items:center;">
          <input type="number" id="toolbox-aging-${boardId}" value="${agingDays}" min="1" max="99" class="settings-input" style="width:60px; padding:4px 8px; font-size:12px; border:1px solid var(--border);"/>
          <button class="btn-sm btn-sm-primary" onclick="toolboxSaveAging('${boardId}')"><i data-lucide="save" style="width:12px;"></i></button>
        </div>
      </div>
    </div>

    <div style="font-size:12px; color:var(--text-muted); margin-bottom:16px; padding:10px; background:rgba(77,127,255,0.06); border-radius:8px;">
      <strong style="color:var(--text);">🎓 Benotung: Prozess (50%) + Produkt (50%)</strong><br>
      Jede Aufgabe erhält eine Note und Aufwands-Gewichtung (1x, 2x, 4x, 8x, 16x). Unten wird die finale Produktnote ergänzt.
    </div>
    <div style="margin-bottom:16px;">
      <button class="btn-sm btn-sm-primary" onclick="exportBoardGrades()" style="display:flex; align-items:center; gap:6px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Noten exportieren
      </button>
    </div>
  `;

  if (!allMembers.length) {
    html += '<div style="font-size:12px; opacity:0.5;">Keine Mitglieder in diesem Board.</div>';
  } else if (!doneCol) {
    html += '<div style="font-size:12px; color:var(--danger);">Keine "Fertig"-Spalte im Board gefunden! Karten können nicht bewertet werden.</div>';
  } else {
    allMembers.forEach(member => {
      const isHistorical = historicalAssignees.includes(member);
      const memberCards = finishedCards.filter(c => c.assignee === member);
      let totalEffort = 0;
      let weightedGradeSum = 0;

      let cardsHtml = '';
      if (memberCards.length === 0) {
        cardsHtml = '<div style="font-size:11px; color:var(--text-muted); padding:8px;">Keine abgeschlossenen Aufgaben.</div>';
      } else {
        cardsHtml = memberCards.map(c => {
          const gradeVal = c.grade || '';
          const effortVal = c.effort || '1';
          const comment  = c.gradeComment || '';

          if (gradeVal && effortVal) {
            totalEffort += parseInt(effortVal);
            weightedGradeSum += (parseFloat(gradeVal) * parseInt(effortVal));
          }

          const isUngraded = !gradeVal;
          const borderColor = isUngraded ? '#ef4444' : 'var(--success)';

          return `
          <div style="border-left: 3px solid ${borderColor}; margin-bottom:8px; background:var(--surface2); border-radius:0 6px 6px 0; padding:8px;">
            <div style="font-weight:600; font-size:12px; margin-bottom:6px; color:var(--text); display:flex; justify-content:space-between;">
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:70%;">${escHtml(c.text)}</span>
              ${isUngraded ? '<span style="color:#ef4444; font-size:10px;">Fehlt!</span>' : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
              <select class="grade-select ${gradeVal ? 'grade-'+gradeVal : ''}" id="grade-val-${boardId}-${c.id}" style="width:45px; padding:2px; font-size:11px;" onchange="this.className='grade-select grade-'+this.value; toolboxSaveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                <option value="">Note</option>
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${gradeVal==n?'selected':''}>${n}</option>`).join('')}
              </select>
              <select class="settings-input" id="effort-val-${boardId}-${c.id}" style="width:65px; padding:2px; font-size:11px; border:1px solid var(--border);" onchange="toolboxSaveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
                ${[1,2,4,8,16].map(n => `<option value="${n}" ${effortVal==n?'selected':''}>Aufw: ${n}x</option>`).join('')}
              </select>
              <input type="text" id="grade-comment-${boardId}-${c.id}" value="${escHtml(comment)}" placeholder="Kommentar zur Karte..." class="settings-input" style="flex:1; min-width:100px; padding:2px 6px; font-size:11px; border:1px solid var(--border);" onblur="toolboxSaveCardGrade('${boardId}', '${doneCol.id}', '${c.id}')">
            </div>
          </div>`;
        }).join('');
      }

      let processGrade = totalEffort > 0 ? (weightedGradeSum / totalEffort).toFixed(1) : '-';
      let sharePct = boardTotalEffort > 0 ? Math.round((totalEffort / boardTotalEffort) * 100) : 0;

      const pData = productGrades[member] || {};
      const prodGrade = pData.grade || '';
      const prodComment = pData.comment || '';

      let finalGrade = '-';
      if (processGrade !== '-' && prodGrade) {
        finalGrade = ((parseFloat(processGrade) + parseFloat(prodGrade)) / 2).toFixed(1);
      }

      html += `
      <div style="margin-bottom:20px; border:1px solid var(--border); border-radius:8px; overflow:hidden;">
        <div style="background:rgba(0,0,0,0.2); padding:8px 12px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;">
          <div style="font-weight:700; font-size:14px; display:flex; align-items:center; gap:8px;">
            <div class="assignee-avatar" style="width:20px; height:20px; font-size:10px;">${member.slice(0,2).toUpperCase()}</div>
            ${escHtml(member)}${isHistorical ? ' <span style="font-size:9px; color:var(--text-muted); background:rgba(245,158,11,0.15); padding:1px 4px; border-radius:3px;">ehem.</span>' : ''}
          </div>
          <div style="font-size:11px; display:flex; gap:12px; background:var(--surface2); padding:4px 8px; border-radius:4px;">
            <span>Prozess: <strong style="color:var(--text);">${processGrade}</strong></span>
            <span style="border-left:1px solid var(--border); padding-left:12px;">Anteil: <strong style="color:var(--text);">${sharePct}%</strong></span>
            <span style="border-left:1px solid var(--border); padding-left:12px;">Gesamt: <strong style="color:var(--success); font-size:13px;">${finalGrade}</strong></span>
          </div>
        </div>

        <div style="padding:10px;">
          <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Aufgaben im Prozess</div>
          ${cardsHtml}

          <div style="margin-top:12px; padding-top:12px; border-top:1px dashed var(--border);">
            <div style="font-size:10px; font-weight:700; color:var(--text-muted); margin-bottom:8px; text-transform:uppercase;">Produkt & Präsentation</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <select class="grade-select ${prodGrade ? 'grade-'+prodGrade : ''}" id="prod-val-${boardId}-${escHtml(member)}" style="width:50px; padding:4px; font-size:11px;" onchange="this.className='grade-select grade-'+this.value; toolboxSaveProductGrade('${boardId}', '${escHtml(member)}')">
                <option value="">-</option>
                ${[1,2,3,4,5,6].map(n => `<option value="${n}" ${prodGrade==n?'selected':''}>${n}</option>`).join('')}
              </select>
              <input type="text" id="prod-comment-${boardId}-${escHtml(member)}" value="${escHtml(prodComment)}" placeholder="Fazit Endprodukt..." class="settings-input" style="flex:1; padding:4px 8px; font-size:11px; border:1px solid var(--border);" onblur="toolboxSaveProductGrade('${boardId}', '${escHtml(member)}')">
            </div>
          </div>

          <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--border);">
            <button class="btn-sm btn-sm-ghost" onclick="generateGutachtenPrompt('${escHtml(member)}')" style="display:flex; align-items:center; gap:6px; width:100%; font-size:11px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
              Gutachten-Prompt
            </button>
          </div>
        </div>
      </div>`;
    });
  }

  toolbox.innerHTML = html;
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
  setTimeout(() => toolbox.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
};

// ── SPEICHER-FUNKTIONEN FÜR DIE TOOLBOX ──────────────
window.toolboxSaveCardGrade = async (boardId, colId, cardId) => {
  const grade   = document.getElementById(`grade-val-${boardId}-${cardId}`)?.value || '';
  const effort  = document.getElementById(`effort-val-${boardId}-${cardId}`)?.value || '1';
  const comment = document.getElementById(`grade-comment-${boardId}-${cardId}`)?.value.trim() || '';

  updateCard(boardId, colId, cardId, { grade, effort, gradeComment: comment, gradedAt: new Date().toISOString() });

  showToast('Prozessnote gespeichert!');
  await safeReloadToolbox(boardId);
};

window.toolboxSaveProductGrade = async (boardId, member) => {
  const grade   = document.getElementById(`prod-val-${boardId}-${member}`)?.value || '';
  const comment = document.getElementById(`prod-comment-${boardId}-${member}`)?.value.trim() || '';

  const grades = await getProductGrades(boardId);
  grades[member] = { member, grade, comment, updatedAt: new Date().toISOString() };
  await saveProductGrades(boardId, grades);

  showToast('Produktnote gespeichert!');
  await safeReloadToolbox(boardId);
};

window.copyInvite = (url) => {
  navigator.clipboard.writeText(url).then(() => {
    if (typeof showToast === 'function') showToast('Einladungs-Link kopiert!');
  });
};
