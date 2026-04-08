// js/tools.js — KI-Assistent, Export, Import, Agenda, INI (lokal, kein Firebase)
import { S, getBoards, getColumns, getCards, createBoard, createColumn,
  createCard, deleteColumn, deleteCard, updateBoard, replaceCards } from './state.js';

// ── LEHRER INI-DATEI ERSTELLEN ────────────────────────────
window.createTeacherIniFile = async () => {
  const name  = document.getElementById('ini-teacher-name')?.value.trim() || '';
  const pw    = document.getElementById('ini-master-pw')?.value || '';
  const pw2   = document.getElementById('ini-master-pw2')?.value || '';
  const errEl = document.getElementById('ini-create-error');
  errEl.textContent = '';

  if (!name)         { errEl.textContent = 'Bitte Namen eingeben.'; return; }
  if (pw.length < 6) { errEl.textContent = 'Masterpasswort muss mindestens 6 Zeichen haben.'; return; }
  if (pw !== pw2)    { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }

  const btn = document.getElementById('ini-create-btn');
  btn.disabled = true; btn.textContent = 'Schlüssel werden generiert…';

  try {
    const iniJson = await window.kfCrypto.createIni(name, pw);
    const suggestedName = `${name.replace(/\s+/g,'_')}.ini`;

    // Speichern-Dialog
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'KanbanFluss Tutor-INI', accept: { 'application/json': ['.ini'] } }],
        });
        const w = await handle.createWritable();
        await w.write(iniJson); await w.close();
      } catch(e) {
        if (e.name === 'AbortError') { btn.disabled = false; btn.textContent = '🔑 INI-Datei erstellen & speichern'; return; }
        throw e;
      }
    } else {
      const blob = new Blob([iniJson], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = suggestedName; a.click();
      URL.revokeObjectURL(url);
    }

    // Masterpasswort für diese Sitzung merken
    _teacherSessionPassword = pw;

    closeModal('modal-create-ini');
    showToast(`✅ INI-Datei "${suggestedName}" erstellt! Bitte in den App-Ordner legen.`);

    // Felder zurücksetzen
    ['ini-teacher-name','ini-master-pw','ini-master-pw2'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = '🔑 INI-Datei erstellen & speichern';
  }
};

// ── KI-PROMPT ─────────────────────────────────────────
window.showAiPrompt = () => {
  if (!S.currentBoard) return;
  const promptEl = document.getElementById('ai-prompt-content');
  document.getElementById('modal-ai-prompt').style.display = 'flex';

  const boardName = S.currentBoard.name;
  const members   = S.currentBoard.members || [];
  const teamInfo  = members.length > 0 ? members.join(', ') : 'Einzelperson';
  const deadline  = S.currentBoard.deadline || 'Keine';

  let currentBoardStateText = '';
  for (const col of S.columns) {
    const colWipLimit = col.wipLimit || 0;
    const limitText   = colWipLimit > 0 ? `(WIP-Limit: ${colWipLimit})` : '';
    currentBoardStateText += `\nSpalte: "${col.name}" ${limitText}\n`;
    const colCards = S.cards[col.id] || [];
    if (!colCards.length) {
      currentBoardStateText += '  (Aktuell leer)\n';
    } else {
      colCards.forEach(c => {
        const lbl     = c.label ? `[${c.label}] ` : '';
        const depsStr = (c.dependencies && c.dependencies.length > 0) ? ` (Braucht: ${c.dependencies.map(d => `[${d}]`).join(', ')})` : '';
        currentBoardStateText += `  - ${lbl}${c.text} [Zuständig: ${c.assignee || 'offen'}]${depsStr}\n`;
      });
    }
    if (colWipLimit > 0 && colCards.length >= colWipLimit) {
      currentBoardStateText += `  ⚠️ ACHTUNG KI: Diese Spalte ist VOLL (${colCards.length}/${colWipLimit}). Hier darf nichts mehr hinzugefügt werden!\n`;
    }
  }

  const prompt = `Du bist ein Projektassistent für das Kanban-Board "${boardName}".

WICHTIGSTE REGELN:
1. WIP-LIMITS NUR FÜR "In Bearbeitung": Die WIP-Limits gelten AUSSCHLIESSLICH für Fortschritts-Spalten. Alle anderen Spalten (wie "Offen", "Voraussetzungen") haben KEIN Limit!
2. ABSOLUT EINDEUTIGE LABELS: Jede Karte MUSS ein absolut eindeutiges Label haben (z.B. A, B, C). Keine Duplikate!
3. FERTIG-SPALTE: Die Spalte für fertige Aufgaben ist TABU.
4. VORAUSSETZUNGEN (Spalte 1): Plane vorbereitende Aufgaben als separate Spalte "Voraussetzungen" ganz links ein.
5. ABHÄNGIGKEITEN VERKNÜPFEN: Nutze das Array-Feld "deps", um exakt auf die Labels der benötigten Karten zu verweisen.

AKTUELLER STAND:
${currentBoardStateText}

RAHMENDATEN:
- Team: ${teamInfo} | Deadline: ${deadline}

DEINE AUFGABE:
1. Berate den Nutzer, frage nach Voraussetzungen und optimiere den Workflow.
2. Wenn der Nutzer "FERTIG" sagt, gib die finale Planung als JSON aus.

REGELN FÜR DAS JSON-FORMAT:
- "spalte" (Name der Spalte)
- "karten" (Liste der Aufgaben)
- "label" (ID der Karte, z.B. "A")
- "titel" (Text der Aufgabe)
- "prio" (hoch, mittel oder niedrig)
- "deadline" (YYYY-MM-DD oder "")
- "wer" (Name der zuständigen Person)
- "deps" (Array der Labels, z.B. ["A", "B"])`;

  promptEl.textContent = prompt;
};

window.copyAiPrompt = async () => {
  const text = document.getElementById('ai-prompt-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('ai-prompt-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => { btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> Prompt kopieren'; }, 2000);
  } catch(e) {
    showToast('Kopieren fehlgeschlagen.', 'error');
  }
};

// ── TEXT-EXPORT ───────────────────────────────────────
window.showExport = () => {
  if (!S.currentBoard) return;
  const pre = document.getElementById('export-content');
  document.getElementById('modal-export').style.display = 'flex';

  const deadline = S.currentBoard.deadline || '';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmtDate     = iso => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; };
  const fmtDateTime = iso => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`; };
  const daysSince   = iso => { if (!iso) return null; return Math.floor((now - new Date(iso)) / 86400000); };
  const dueStatus   = due => {
    if (!due) return '';
    const d = new Date(due); d.setHours(0,0,0,0); const t = new Date(); t.setHours(0,0,0,0);
    const diff = Math.ceil((d - t) / 86400000);
    if (diff < 0)   return ` [ÜBERFÄLLIG seit ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}]`;
    if (diff === 0) return ' [FÄLLIG HEUTE]';
    if (diff <= 2)  return ` [fällig in ${diff} Tag${diff!==1?'en':''}]`;
    return '';
  };

  const sep  = '─'.repeat(60);
  const sep2 = '═'.repeat(60);
  let lines  = [];

  lines.push(sep2);
  lines.push(`  KANBAN-BOARD: ${S.currentBoard.name.toUpperCase()}`);
  lines.push(`  Exportiert am: ${fmtDateTime(now.toISOString())}`);
  if (deadline) {
    const dl   = new Date(deadline);
    const diff = Math.ceil((dl - now) / 86400000);
    const cdText = diff < 0 ? ` — Abgabe war vor ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}!` : diff === 0 ? ' — Abgabe heute!' : ` — noch ${diff} Tag${diff!==1?'e':''}`;
    lines.push(`  Abgabetermin:  ${fmtDate(deadline)}${cdText}`);
  }
  lines.push(sep2); lines.push('');

  for (const col of S.columns) {
    const cCards = S.cards[col.id] || [];
    const isProgress = (col.name||'').toLowerCase().match(/bearbeitung|progress|doing/);
    lines.push(sep);
    lines.push(`  ${col.name.toUpperCase()}  (${cCards.length} Karte${cCards.length!==1?'n':''})`);
    lines.push(sep);
    if (!cCards.length) { lines.push('  (keine Karten)'); lines.push(''); continue; }
    cCards.forEach((card, idx) => {
      const lbl = card.label ? `[${card.label}] ` : '';
      lines.push(`  ${idx + 1}. ${lbl}${card.text}`);
      if (card.priority) { const pMap = { hoch:'HOCH ▲', mittel:'MITTEL', niedrig:'NIEDRIG ▽' }; lines.push(`     Priorität:   ${pMap[card.priority] || card.priority}`); }
      if (card.assignee) lines.push(`     Zugewiesen:  ${card.assignee}`);
      if (card.due) lines.push(`     Fällig am:   ${fmtDate(card.due)}${dueStatus(card.due)}`);
      if (card.dependencies && card.dependencies.length > 0) lines.push(`     Voraussetz.: ${card.dependencies.map(d => `[${d}]`).join(', ')}`);
      if (card.comments && card.comments.length > 0) { lines.push(`     Kommentare:`); card.comments.forEach(c => { const role = c.role === 'teacher' ? 'Tutor' : 'SchülerIn'; lines.push(`       - [${role}] ${c.text}`); }); }
      if (card.createdAt) lines.push(`     Erstellt:    ${fmtDateTime(card.createdAt)}`);
      if (isProgress && card.startedAt) {
        const days = daysSince(card.startedAt);
        const agingLimit = S.currentBoard?.agingDays || 5;
        const aging = days !== null && days >= agingLimit ? ` ⚠ AGING (>${agingLimit} Tage)` : '';
        lines.push(`     In Bearb. seit: ${fmtDate(card.startedAt)}  (${days !== null ? days + (days===1?' Tag':' Tage') : '?'}${aging})`);
      }
      if (card.finishedAt) lines.push(`     Fertiggestellt: ${fmtDate(card.finishedAt)}`);
      lines.push('');
    });
  }

  // Agenda
  lines.push(sep2); lines.push('  AGENDA – ALLE KARTEN NACH FÄLLIGKEIT'); lines.push(sep2); lines.push('');
  const allCards = [];
  S.columns.forEach(col => (S.cards[col.id] || []).forEach(c => allCards.push({ ...c, colName: col.name })));
  const withDue    = allCards.filter(c => c.due).sort((a,b) => new Date(a.due) - new Date(b.due));
  const withoutDue = allCards.filter(c => !c.due);
  if (withDue.length) {
    withDue.forEach(card => {
      const lbl = card.label ? `[${card.label}] ` : '';
      lines.push(`  ${fmtDate(card.due)}${dueStatus(card.due)}`);
      lines.push(`    → ${lbl}${card.text}${card.priority ? ` [${card.priority.toUpperCase()}]` : ''}`);
      lines.push(`       Spalte: ${card.colName}${card.assignee ? ' | Zugewiesen: ' + card.assignee : ''}`);
      lines.push('');
    });
  }
  if (withoutDue.length) {
    lines.push('  Ohne Fälligkeitsdatum:');
    withoutDue.forEach(card => { const lbl = card.label ? `[${card.label}] ` : ''; lines.push(`    · ${lbl}${card.text}${card.priority ? ` [${card.priority.toUpperCase()}]` : ''}  (${card.colName})`); });
    lines.push('');
  }
  if (!allCards.length) lines.push('  (keine Karten)');

  // System-Backup
  const backupData = {
    isBackup: true, boardName: S.currentBoard.name, cardCounter: S.currentBoard.cardCounter || 0,
    columns: S.columns.map(col => ({
      name: col.name, color: col.color, order: col.order, wipLimit: col.wipLimit,
      cards: (S.cards[col.id] || []).map(c => ({
        text: c.text, priority: c.priority, assignee: c.assignee, due: c.due, label: c.label,
        dependencies: c.dependencies || [], comments: c.comments || [],
        startedAt: c.startedAt || '', finishedAt: c.finishedAt || '', order: c.order
      }))
    }))
  };
  lines.push(sep2); lines.push(''); lines.push('  === SYSTEM-BACKUP (FÜR IMPORT) ===');
  lines.push('  ' + JSON.stringify(backupData));

  pre.textContent = lines.join('\n');
};

window.copyExportToClipboard = async () => {
  const text = document.getElementById('export-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('export-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => { btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> In Zwischenablage kopieren'; }, 2000);
  } catch(e) { showToast('Kopieren fehlgeschlagen – bitte manuell markieren.', 'error'); }
};

// ── IMPORT ────────────────────────────────────────────
window.showImport = () => {
  if (!S.currentBoard) return;
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-preview').style.display   = 'none';
  document.getElementById('import-error').style.display     = 'none';
  document.getElementById('import-confirm-btn').style.display = 'none';
  S.importParsedData = null;
  document.getElementById('modal-import').style.display = 'flex';
};

function parseExportText(raw) {
  try {
    const backupMarker = '=== SYSTEM-BACKUP';
    const backupIndex  = raw.indexOf(backupMarker);
    if (backupIndex !== -1) {
      const jsonStart = raw.indexOf('{', backupIndex);
      const jsonEnd   = raw.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd > jsonStart) return JSON.parse(raw.slice(jsonStart, jsonEnd));
    }
    const start = raw.indexOf('['); const end = raw.lastIndexOf(']') + 1;
    if (start === -1 || end === 0) throw new Error('Kein gültiger JSON-Code oder System-Backup gefunden.');
    const data = JSON.parse(raw.slice(start, end));
    const columns = data.map(col => ({
      name: col.spalte || col.name || 'Neue Spalte', wipLimit: col.wipLimit || 0,
      cards: (col.karten || col.cards || []).map(card => ({
        label: card.label || '', text: card.titel || card.text || 'Aufgabe',
        priority: (card.prio || card.priority || '').toLowerCase(),
        due: card.deadline || card.due || '', assignee: card.wer || card.assignee || '',
        dependencies: Array.isArray(card.deps || card.dependencies) ? (card.deps || card.dependencies) : [],
        comments: card.comments || [], startedAt: card.startedAt || '', finishedAt: card.finishedAt || ''
      }))
    }));
    return { isBackup: false, boardName: 'KI Planung', columns };
  } catch (e) { throw new Error('Das Format war nicht korrekt. Bitte kopiere den gesamten Text inkl. JSON.'); }
}

window.parseImportPreview = () => {
  const raw    = document.getElementById('import-textarea').value.trim();
  const errEl  = document.getElementById('import-error');
  const preEl  = document.getElementById('import-preview');
  const btnEl  = document.getElementById('import-confirm-btn');
  errEl.style.display = preEl.style.display = btnEl.style.display = 'none';
  S.importParsedData = null;
  if (!raw) { errEl.textContent = 'Bitte zuerst den Text oder JSON-Code einfügen.'; errEl.style.display = 'block'; return; }
  let parsed;
  try { parsed = parseExportText(raw); } catch(e) { errEl.textContent = 'Fehler beim Lesen: ' + e.message; errEl.style.display = 'block'; return; }
  S.importParsedData = parsed;
  const totalCards = parsed.columns.reduce((s, c) => s + c.cards.length, 0);
  let html = `<strong>${parsed.isBackup ? 'Sicherungskopie' : 'KI-Planung'} erkannt:</strong> ${parsed.columns.length} Spalte(n), ${totalCards} Karte(n)<br><br>`;
  if (parsed.isBackup) html += `<div style="color:var(--accent); font-weight:bold; margin-bottom:10px;">⚠️ Dies ist ein Backup. Es wird als komplett neues Board wiederhergestellt!</div>`;
  parsed.columns.forEach(col => {
    html += `<div style="margin-bottom:8px;"><strong style="color:var(--accent);">${escHtml(col.name)}</strong> (${col.cards.length})<br>`;
    col.cards.forEach(c => {
      const prio = c.priority ? ` <span class="card-priority priority-${c.priority}" style="font-size:9px;">${c.priority}</span>` : '';
      const lbl  = c.label ? `<strong>[${c.label}]</strong> ` : '<strong style="color:var(--accent);">[NEU]</strong> ';
      html += `<div style="font-size:12px; margin-left:10px; opacity:0.9;">→ ${lbl}${escHtml(c.text)}${prio}${c.due ? ` · 📅 ${c.due}` : ''}${c.assignee ? ` · 👤 ${escHtml(c.assignee)}` : ''}</div>`;
    });
    html += '</div>';
  });
  preEl.innerHTML = html; preEl.style.display = 'block'; btnEl.style.display = 'inline-flex';
};

window.confirmImport = () => {
  if (!S.importParsedData || !S.currentBoard) return;
  const btn = document.getElementById('import-confirm-btn');
  btn.disabled = true;
  const isBackup = S.importParsedData.isBackup;
  const columnsToImport = S.importParsedData.columns || [];
  let importedCardsCount = 0;

  try {
    if (isBackup) {
      btn.textContent = 'Erstelle neues Board aus Backup…';
      const newBoard = createBoard({
        name: S.importParsedData.boardName + ' (Backup)',
        members: S.currentBoard.members || [], wipLimit: S.currentBoard.wipLimit || 3,
        cardCounter: S.importParsedData.cardCounter || 0,
        ownerName: S.currentUser?.displayName || '', groupId: S.currentUser?.groupId || ''
      });
      let colOrder = 0;
      for (const importCol of columnsToImport) {
        const newCol = createColumn(newBoard.id, { name: importCol.name, color: importCol.color || '#5c6ef8', order: importCol.order ?? colOrder++, wipLimit: importCol.wipLimit || 0 });
        let cardOrder = 0;
        for (const card of (importCol.cards || [])) {
          createCard(newBoard.id, newCol.id, { text: card.text || 'Ohne Titel', priority: card.priority || '', assignee: card.assignee || '', due: card.due || '', label: card.label || '', dependencies: card.dependencies || [], comments: card.comments || [], order: card.order ?? cardOrder++, startedAt: card.startedAt || '', finishedAt: card.finishedAt || '' });
          importedCardsCount++;
        }
      }
      closeModal('modal-import');
      showToast(`✅ Backup als neues Board wiederhergestellt!`);
      S.boards = getBoards();
      renderBoardsList();
      setTimeout(() => selectBoard(newBoard.id), 300);

    } else {
      btn.textContent = 'Lösche alte Daten & speichere neu…';
      let currentCounter = S.currentBoard.cardCounter || 0;

      // Nicht-Fertig-Spalten löschen
      for (const col of S.columns) {
        if (window.isFinishedColumn && window.isFinishedColumn(col)) continue;
        deleteColumn(S.currentBoard.id, col.id);
      }

      let orderOffset = 0;
      for (const importCol of columnsToImport) {
        if (!importCol || !importCol.name) continue;
        if (window.isFinishedColumn && window.isFinishedColumn({ name: importCol.name })) continue;

        let color = '#5c6ef8';
        const nameLower = importCol.name.toLowerCase();
        if (nameLower.includes('offen') || nameLower.includes('todo')) color = '#ef4444';
        else if (nameLower.includes('bearbeitung') || nameLower.includes('progress')) color = '#10b981';

        const newCol = createColumn(S.currentBoard.id, { name: importCol.name, color, order: orderOffset++, wipLimit: importCol.wipLimit || 0 });
        let cardOrder = 0;
        for (const card of (importCol.cards || [])) {
          if (!card || !card.text) continue;
          let cardLabel = card.label;
          if (!cardLabel) { cardLabel = window.numberToLabel ? window.numberToLabel(currentCounter) : `K${currentCounter}`; currentCounter++; }
          createCard(S.currentBoard.id, newCol.id, { text: card.text, priority: card.priority || '', assignee: card.assignee || '', due: card.due || '', label: cardLabel, dependencies: card.dependencies || [], order: cardOrder++, startedAt: card.startedAt || '', finishedAt: card.finishedAt || '' });
          importedCardsCount++;
        }
      }

      // Fertig-Spalten ans Ende schieben
      const updatedCols = getColumns(S.currentBoard.id);
      for (const col of updatedCols) {
        if (window.isFinishedColumn && window.isFinishedColumn(col)) {
          // updateColumn nicht direkt verfügbar über state, nutze import
          import('./storage.js').then(({ updateColumn }) => updateColumn(S.currentBoard.id, col.id, { order: orderOffset++ }));
        }
      }
      updateBoard(S.currentBoard.id, { cardCounter: currentCounter });
      S.currentBoard.cardCounter = currentCounter;
      closeModal('modal-import');
      showToast(`✅ KI-Planung erfolgreich! ${importedCardsCount} Karte(n) importiert.`);
      setTimeout(() => loadColumns(), 200);
    }
  } catch(e) {
    console.error('Fehler beim Importieren:', e);
    showToast('Fehler beim Import: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M20 6 9 17l-5-5"/></svg> Jetzt importieren';
};

// ── AGENDA ────────────────────────────────────────────
window.showAgenda = () => {
  if (!S.currentBoard) return;
  document.getElementById('modal-agenda').style.display = 'flex';

  const deadline = S.currentBoard.deadline || '';
  const dlEl     = document.getElementById('agenda-deadline');
  const dlDate   = document.getElementById('agenda-deadline-date');
  const dlCountdown = document.getElementById('agenda-deadline-countdown');

  if (deadline) {
    dlEl.style.display = 'block';
    const d = new Date(deadline); const now = new Date();
    const diff = Math.ceil((d - now) / 86400000);
    dlDate.textContent = d.toLocaleDateString('de-DE', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    if (diff < 0) { dlCountdown.textContent = `Abgabe war vor ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}`; dlCountdown.style.color = 'var(--danger)'; }
    else if (diff === 0) { dlCountdown.textContent = 'Abgabe heute!'; dlCountdown.style.color = '#f59e0b'; }
    else { dlCountdown.textContent = `Noch ${diff} Tag${diff!==1?'e':''}`; dlCountdown.style.color = diff <= 3 ? '#f59e0b' : 'var(--success)'; }
  } else {
    dlEl.style.display = 'none';
  }

  const list = document.getElementById('agenda-list');
  const allCards = [];
  S.columns.forEach(col => (S.cards[col.id] || []).forEach(c => allCards.push({ ...c, colName: col.name })));
  const withDue    = allCards.filter(c => c.due).sort((a,b) => new Date(a.due) - new Date(b.due));
  const withoutDue = allCards.filter(c => !c.due);
  const sorted     = [...withDue, ...withoutDue];

  if (!sorted.length) { list.innerHTML = '<div style="font-size:13px;color:var(--text-muted);text-align:center;padding:20px;">Keine Karten vorhanden.</div>'; return; }

  list.innerHTML = sorted.map(card => {
    const now = new Date(); now.setHours(0,0,0,0);
    const due = card.due ? new Date(card.due) : null;
    const diff = due ? Math.ceil((due - now) / 86400000) : null;
    let dueLabel = ''; let dueColor = 'var(--text-muted)'; let cardBorder = 'var(--border)';
    if (due) {
      if (diff < 0) { dueLabel = `Überfällig (${Math.abs(diff)} Tag${Math.abs(diff)!==1?'e':''})`; dueColor = 'var(--danger)'; cardBorder = 'rgba(240,82,82,0.4)'; }
      else if (diff === 0) { dueLabel = 'Fällig heute'; dueColor = '#f59e0b'; cardBorder = 'rgba(245,158,11,0.4)'; }
      else if (diff <= 2) { dueLabel = `Fällig in ${diff} Tag${diff!==1?'en':''}`; dueColor = '#f59e0b'; }
      else { dueLabel = due.toLocaleDateString('de-DE', { day:'numeric', month:'short', year:'numeric' }); dueColor = 'var(--success)'; }
    }
    const prioColors = { hoch:'var(--danger)', mittel:'#f59e0b', niedrig:'var(--success)' };
    const lbl = card.label ? `[${card.label}] ` : '';
    return `<div style="padding:10px 14px; background:rgba(10,20,60,0.4); border:1px solid ${cardBorder}; border-radius:10px; display:flex; align-items:flex-start; gap:12px;">
      <div style="width:3px; min-height:40px; border-radius:2px; background:${prioColors[card.priority]||'transparent'}; flex-shrink:0; margin-top:2px;"></div>
      <div style="flex:1; min-width:0;"><div style="font-weight:500; font-size:13px; margin-bottom:4px;">${lbl}${escHtml(card.text)}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; font-size:11px; color:var(--text-muted);"><span>${escHtml(card.colName)}</span>${card.assignee ? `<span>👤 ${escHtml(card.assignee)}</span>` : ''}</div></div>
      <div style="font-size:11px; font-weight:600; color:${dueColor}; flex-shrink:0; text-align:right;">${dueLabel || '<span style="opacity:0.4;">Kein Datum</span>'}</div>
    </div>`;
  }).join('');
};

// ── PASSWORT-DIALOG (Tutor-Exporte) ─────────────────────
let _teacherSessionPassword = null;

// Einfacher Passwort-Dialog für SchülerInnen (bei zurückgegebener Datei mit anderem Passwort)
function _showStudentPasswordDialog(teacherName) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(var(--panel-rgb),0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px 24px 20px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
    box.innerHTML = `
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;">🔐 Datei entschlüsseln</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.5;">
        Diese Datei wurde mit einem anderen Passwort exportiert.<br>
        Gib das Passwort ein, das du beim Export verwendet hast${teacherName ? ` (Tutor: <strong>${teacherName}</strong>)` : ''}.
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Dein Export-Passwort</label>
        <input id="_stu-pw-i" type="password" placeholder="Passwort eingeben"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:14px;outline:none;"/>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="_stu-pw-cancel" style="padding:8px 18px;font-size:13px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;">Abbrechen</button>
        <button id="_stu-pw-ok" style="padding:8px 18px;font-size:13px;border-radius:10px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;">🔓 Entschlüsseln</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const inp = box.querySelector('#_stu-pw-i');
    setTimeout(() => inp?.focus(), 50);
    const done = (val) => { document.body.removeChild(overlay); resolve(val); };
    box.querySelector('#_stu-pw-cancel').onclick = () => done(null);
    box.querySelector('#_stu-pw-ok').onclick = () => done(inp.value || null);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value || null); });
  });
}

function _showPasswordDialog(mode) {
  return new Promise(resolve => {
    const isSave = mode === 'save';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(var(--panel-rgb),0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px 24px 20px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
    box.innerHTML = `
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:12px;">
        🔐 ${isSave ? 'Export verschlüsseln' : 'Import entschlüsseln'}
      </div>
      ${isSave ? `<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:10px 12px;font-size:12px;color:#ef4444;margin-bottom:16px;line-height:1.5;">
        ⚠️ <strong>Achtung:</strong> Ohne dieses Passwort kann die Datei <strong>nicht importiert</strong> werden!
      </div>` : `<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">Gib das Passwort ein, mit dem diese Datei exportiert wurde.</div>`}
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Passwort</label>
        <input id="_pw-i" type="password" placeholder="Passwort eingeben"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:14px;outline:none;"/>
      </div>
      ${isSave ? `<div style="margin-bottom:16px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Passwort bestätigen</label>
        <input id="_pw-c" type="password" placeholder="Passwort wiederholen"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:14px;outline:none;"/>
      </div>` : '<div style="margin-bottom:16px;"></div>'}
      <div id="_pw-e" style="color:#ef4444;font-size:12px;min-height:18px;margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="_pw-cancel" style="padding:8px 18px;font-size:13px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;">Abbrechen</button>
        <button id="_pw-ok" style="padding:8px 18px;font-size:13px;border-radius:10px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;">
          ${isSave ? '🔒 Verschlüsselt speichern' : '🔓 Entschlüsseln'}
        </button>
      </div>`;
    overlay.appendChild(box); document.body.appendChild(overlay);
    const pwI = box.querySelector('#_pw-i'), pwC = box.querySelector('#_pw-c'), errEl = box.querySelector('#_pw-e');
    setTimeout(() => pwI.focus(), 50);
    const close = v => { overlay.remove(); resolve(v); };
    const submit = () => {
      const pw = pwI.value; errEl.textContent = '';
      if (!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; return; }
      if (isSave && pw.length < 4) { errEl.textContent = 'Mindestens 4 Zeichen.'; return; }
      if (isSave && pw !== (pwC?.value||'')) { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }
      close(pw);
    };
    box.querySelector('#_pw-ok').onclick = submit;
    box.querySelector('#_pw-cancel').onclick = () => close(null);
    pwI.addEventListener('keydown', e => { if (e.key==='Enter') { isSave && pwC ? pwC.focus() : submit(); } });
    if (pwC) pwC.addEventListener('keydown', e => { if (e.key==='Enter') submit(); });
    overlay.addEventListener('click', e => { if (e.target===overlay) close(null); });
    const onEsc = e => { if (e.key==='Escape') { document.removeEventListener('keydown', onEsc); close(null); } };
    document.addEventListener('keydown', onEsc);
  });
}

// ── JSON-DATEI EXPORT ─────────────────────────────────────
window.exportDataAsFile = async () => {
  // Session holen — Schüler-Config aus localStorage als Fallback wenn Session fehlt
  let session = window._kfSession;
  if (!session) {
    try {
      const cfg = JSON.parse(localStorage.getItem('kf_student_config') || 'null');
      if (cfg?.publicKeyJwk) {
        // Schüler-Modus: Passwort erneut abfragen
        const pw = await _showPasswordDialog('load');
        if (!pw) return;
        const ok = await window.kfCrypto.checkToken(cfg.verifyToken, pw);
        if (!ok) { showToast('Falsches Passwort.', 'error'); return; }
        session = { isStudent: true, studentPassword: pw, teacherPublicKeyJwk: cfg.publicKeyJwk, teacherName: cfg.teacherName };
        window._kfSession = session;
      }
    } catch(e) { /* kein Student-Config → Tutor-Modus */ }
  }

  const raw = localStorage.getItem('kanban_data') || '{}';
  const settings = localStorage.getItem('kanban_settings') || '{}';
  const gradesRaw = localStorage.getItem('kanban_grades') || '{}';
  let data, settingsObj, gradesObj;
  try { data = JSON.parse(raw); } catch(e) { data = {}; }
  try { settingsObj = JSON.parse(settings); } catch(e) { settingsObj = {}; }
  try { gradesObj = JSON.parse(gradesRaw); } catch(e) { gradesObj = {}; }
  const exportObj = { ...data, settings: settingsObj, grades: gradesObj, exportedAt: new Date().toISOString(), appVersion: 'standalone-1.0' };

  let json;

  if (session?.isStudent && session.teacherPublicKeyJwk) {
    // ── SCHÜLER: doppelt verschlüsselt (Schüler-PW + Tutor-RSA) ──
    try {
      const teacherPubKey = await window.kfCrypto.importPubJwk(session.teacherPublicKeyJwk);
      json = await window.kfCrypto.encryptDual(
        JSON.stringify(exportObj), session.studentPassword, teacherPubKey, session.teacherName
      );
    } catch(e) { showToast('Verschlüsselungsfehler: ' + e.message, 'error'); return; }
  } else {
    // ── LEHRER: einfach verschlüsselt mit Masterpasswort ──
    let pw = _teacherSessionPassword;
    if (!pw) {
      pw = await _showPasswordDialog('save');
      if (!pw) return;
      _teacherSessionPassword = pw;
    }
    try {
      const enc = await window.kfCrypto.encryptStr(JSON.stringify(exportObj), pw);
      json = JSON.stringify({ kanbanfluss: true, encrypted: true, version: 1, ...enc, exportedAt: new Date().toISOString() });
    } catch(e) { showToast('Verschlüsselungsfehler: ' + e.message, 'error'); return; }
  }

  const date = new Date().toISOString().slice(0, 10);
  const who  = session?.isStudent ? (session.teacherName ? `${session.teacherName}-` : '') : '';
  const name = (S.currentUser?.displayName || '').replace(/\s+/g,'_') || 'nutzer';
  const suggestedName = `kanbanfluss-${who}${name}-${date}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'KanbanFluss Datei', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      showToast('🔒 Datei verschlüsselt exportiert!');
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
  showToast('🔒 Datei verschlüsselt exportiert!');
};

// ── JSON-DATEI IMPORT ─────────────────────────────────────
window.importDataFromFile = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  let text;
  try { text = await file.text(); } catch(e) { showToast('Datei konnte nicht gelesen werden.', 'error'); return; }
  let parsed;
  try { parsed = JSON.parse(text); } catch(e) { showToast('Ungültige JSON-Datei.', 'error'); return; }

  if (parsed.encrypted === true) {
    if (parsed.version === 2) {
      let decrypted = null;
      const session = window._kfSession;
      const isStudentSession = session?.isStudent === true;

      if (isStudentSession) {
        // ── SCHÜLER importiert zurückgegebene Datei ──
        // Erst mit Sitzungs-Passwort versuchen
        if (session.studentPassword) {
          try { decrypted = await window.kfCrypto.decryptDualStudent(parsed, session.studentPassword); } catch(e) { /* weiter */ }
        }
        // Scheitert das (z.B. anderes Gerät / Passwort vergessen): explizit nach Passwort fragen
        if (!decrypted) {
          const pw = await _showStudentPasswordDialog(parsed.teacherName);
          if (!pw) return;
          try { decrypted = await window.kfCrypto.decryptDualStudent(parsed, pw); }
          catch(e) { showToast('❌ Falsches Passwort – diese Datei wurde mit einem anderen Passwort exportiert.', 'error'); return; }
        }

      } else {
        // ── TUTOR öffnet Schüler-Image mit INI + Masterpasswort ──
        let iniObj = window._loadedIni || null;

        if (!iniObj) {
          iniObj = await new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.ini,.json';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.onchange = async (e) => {
              const f = e.target.files[0];
              document.body.removeChild(input);
              if (!f) { resolve(null); return; }
              try {
                const obj = JSON.parse(await f.text());
                resolve(obj.kanbanfluss_ini ? obj : null);
              } catch(e) { resolve(null); }
            };
            showToast(`Bitte INI-Datei von "${parsed.teacherName || 'Tutor'}" auswählen`);
            input.click();
          });
        }

        if (!iniObj) { showToast('INI-Datei ungültig oder abgebrochen.', 'error'); return; }

        const pw = _teacherSessionPassword || await _showPasswordDialog('load');
        if (!pw) return;
        try {
          const privKey = await window.kfCrypto.getPrivKeyFromIni(iniObj, pw);
          const result  = await window.kfCrypto.decryptDualTeacherFull(parsed, privKey);
          decrypted = result.data;
          window._studentReturnKeys = {
            dataKeyB64:  result.dataKeyB64,
            stuKeyEnc:   result.stuKeyEnc,
            teacherName: parsed.teacherName,
          };
          window._loadedIni = iniObj;
          _teacherSessionPassword = pw;
        } catch(e) {
          showToast('❌ Falsches Masterpasswort oder falsche INI-Datei.', 'error'); return;
        }
      }
      try { parsed = JSON.parse(decrypted); } catch(e) { showToast('Entschlüsselung fehlgeschlagen.', 'error'); return; }

    } else {
      // ── Version 1: einfach mit Passwort verschlüsselt (Tutor-Backup) ──
      let pw = _teacherSessionPassword;
      if (!pw) { pw = await _showPasswordDialog('load'); if (!pw) return; }
      try {
        const decrypted = await window.kfCrypto.decryptStr(parsed, pw);
        parsed = JSON.parse(decrypted);
        _teacherSessionPassword = pw;
      } catch(e) { showToast('❌ Falsches Passwort oder beschädigte Datei.', 'error'); return; }
    }
  }

  if (!Array.isArray(parsed.boards)) { showToast('Keine gültige KanbanFluss-Datei.', 'error'); return; }

  const ok = await showConfirm(
    `Export vom ${parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('de-DE') : 'unbekanntem Datum'} importieren?\n\nDies ersetzt ALLE aktuellen Daten!`,
    'Importieren', 'Abbrechen'
  );
  if (!ok) return;

  const { settings, grades, exportedAt, appVersion, ...data } = parsed;
  localStorage.setItem('kanban_data', JSON.stringify({ ...data, version: 1 }));
  if (settings) localStorage.setItem('kanban_settings', JSON.stringify(settings));
  if (grades && Object.keys(grades).length > 0) localStorage.setItem('kanban_grades', JSON.stringify(grades));

  // Vor Reload: Sitzungsdaten in sessionStorage retten (überleben den Reload)
  if (window._studentReturnKeys) {
    sessionStorage.setItem('kf_return_keys', JSON.stringify(window._studentReturnKeys));
  }
  if (window._loadedIni) {
    sessionStorage.setItem('kf_loaded_ini', JSON.stringify(window._loadedIni));
  }
  // SchülerIn-Passwort retten → nach Reload automatisch einloggen (kein erneutes Eingeben nötig)
  if (window._kfSession?.isStudent && window._kfSession.studentPassword) {
    sessionStorage.setItem('kf_auto_login', window._kfSession.studentPassword);
  }

  showToast('Import erfolgreich! Seite wird neu geladen…');
  setTimeout(() => location.reload(), 1200);
};

// ── DEADLINE SPEICHERN ────────────────────────────────
window.saveDeadline = (boardId, inputId) => {
  const value = document.getElementById(inputId)?.value || '';
  updateBoard(boardId, { deadline: value });
  if (S.currentBoard?.id === boardId) S.currentBoard.deadline = value;
  showToast(value ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

// ── SESSION ZURÜCKSETZEN (wird von logoutUser in auth.js aufgerufen) ──
window.resetToolsSession = function() {
  _teacherSessionPassword = null;
  window._loadedIni = null;
  window._studentReturnKeys = null;
};

// ── RÜCKGABE-EXPORT AN SCHÜLER (Tutor-only) ──────────────
window.exportForStudent = async function() {
  const keys = window._studentReturnKeys;
  if (!keys) {
    showToast('Bitte zuerst ein Image einer Schülerin oder eines Schülers importieren.', 'error'); return;
  }
  const ini = window._loadedIni;
  if (!ini) {
    showToast('Bitte zuerst die Tutor-INI laden (📂 INI laden).', 'error'); return;
  }

  let teacherPubKey;
  try { teacherPubKey = await window.kfCrypto.importPubJwk(ini.publicKey); }
  catch(e) { showToast('Fehler beim Laden des Tutorschlüssels.', 'error'); return; }

  const raw = localStorage.getItem('kanban_data') || '{}';
  const settings = localStorage.getItem('kanban_settings') || '{}';
  const gradesRaw = localStorage.getItem('kanban_grades') || '{}';
  let data, settingsObj, gradesObj;
  try { data = JSON.parse(raw); } catch(e) { data = {}; }
  try { settingsObj = JSON.parse(settings); } catch(e) { settingsObj = {}; }
  try { gradesObj = JSON.parse(gradesRaw); } catch(e) { gradesObj = {}; }
  const exportObj = { ...data, settings: settingsObj, grades: gradesObj, exportedAt: new Date().toISOString(), appVersion: 'standalone-1.0' };

  let json;
  try {
    json = await window.kfCrypto.encryptDualReturn(
      JSON.stringify(exportObj), keys.dataKeyB64, keys.stuKeyEnc,
      teacherPubKey, keys.teacherName || ini.teacherName
    );
  } catch(e) { showToast('Verschlüsselungsfehler: ' + e.message, 'error'); return; }

  const date = new Date().toISOString().slice(0, 10);
  const name = (S.currentUser?.displayName || '').replace(/\s+/g,'_') || 'tutor';
  const suggestedName = `kanbanfluss-rueckgabe-${name}-${date}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'KanbanFluss Datei', accept: { 'application/json': ['.json'] } }],
      });
      const w = await handle.createWritable();
      await w.write(json); await w.close();
      showToast('📤 Datei gespeichert! Die Schülerin oder der Schüler kann sie mit dem eigenen Passwort öffnen.');
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
  showToast('📤 Datei gespeichert! Die Schülerin oder der Schüler kann sie mit dem eigenen Passwort öffnen.');
};
