// js/gantt.js — Projekt-Timeline mit Drag-to-Schedule
export function showGanttView(data, grid) {
    const people = data.people || [];
    const placed = grid.placedCards || [];
    const colors = data.lineColors || {};

    // Scroll-Position retten, bevor altes Overlay entfernt wird
    const existingScroll = document.getElementById('gantt-scroll-area');
    const savedScrollLeft = existingScroll ? existingScroll.scrollLeft : 0;
    const savedScrollTop  = existingScroll ? existingScroll.scrollTop  : 0;

    // Globale Referenz für Refresh nach Drag
    window._lastGanttData = { data, grid };

    // Altes Overlay entfernen
    document.getElementById('gantt-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gantt-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        z-index: 30000; display: flex; align-items: center;
        justify-content: center; padding: 2vw;
    `;
    overlay.onclick = e => { if(e.target === overlay) overlay.remove(); };

    let rawMaxTime = placed.length > 0 ? Math.max(...placed.map(c => c.simEnd || 0)) : 0;
    if (isNaN(rawMaxTime) || !isFinite(rawMaxTime) || rawMaxTime < 0) rawMaxTime = 10;
    const maxTime = Math.max(rawMaxTime + 4, 8);

    const hourWidth  = 56;
    const laneHeight = 64;   // Höhe einer Sub-Lane
    const labelWidth = 150;
    const totalCols  = Math.ceil(maxTime) + 2;

    // ── Constraint-Berechnung ──────────────────────────
    function getConstraints(task) {
        const ownDur = Math.max((task.simEnd || 0) - (task.simStart || 0), 0.1);
        const depEnds = (task.deps || []).map(depLabel => {
            const dep = placed.find(p => (p.label||'').toUpperCase() === String(depLabel).toUpperCase());
            return dep ? (dep.simEnd || 0) : 0;
        });
        const earliest = depEnds.length ? Math.max(...depEnds) : 0;
        const dependents = placed.filter(p =>
            (p.deps || []).some(d => String(d).toUpperCase() === (task.label||'').toUpperCase())
        );
        const depStarts = dependents.map(p => p.simStart || 0);
        const latest = depStarts.length ? Math.min(...depStarts) - ownDur : Infinity;
        return { earliest, latest: isFinite(latest) ? Math.max(earliest, latest) : null, ownDur };
    }

    // ── Stunden → Tage-Label ──────────────────────────
    function fmtH(h) {
        const d = Math.floor(h / 8);
        const rem = h - d * 8;
        if (d > 0 && rem >= 0.5) return `T${d}+${rem.toFixed(1)}h`;
        if (d > 0) return `Tag ${d}`;
        return `${h.toFixed(1)}h`;
    }

    // ── Sub-Lane-Zuweisung (verhindert Überlappung in einer Zeile) ────
    function assignLanes(tasks) {
        // Jeder Task bekommt eine Lane-Nummer; überlappende Tasks in verschiedene Lanes
        tasks.forEach(t => { t._lane = 0; });
        for (let i = 0; i < tasks.length; i++) {
            const ti = tasks[i];
            const tiS = ti.simStart || 0, tiE = ti.simEnd || tiS + 0.01;
            let lane = 0;
            let conflict = true;
            while (conflict) {
                conflict = false;
                for (let j = 0; j < i; j++) {
                    const tj = tasks[j];
                    if (tj._lane !== lane) continue;
                    const tjS = tj.simStart || 0, tjE = tj.simEnd || tjS + 0.01;
                    if (tiS < tjE && tiE > tjS) { conflict = true; lane++; break; }
                }
            }
            ti._lane = lane;
        }
    }

    // ── Header ────────────────────────────────────────
    const headerCells = Array.from({length: totalCols}).map((_, i) => {
        const label = i % 8 === 0 ? `Tag ${i/8}` : '';
        const isDay  = i % 8 === 0;
        return `<div style="width:${hourWidth}px;flex-shrink:0;font-size:9px;color:${isDay?'var(--text)':'var(--text-muted)'};
            padding:8px 4px;font-weight:${isDay?'900':'400'};border-left:${isDay?'2px solid var(--accent)':'1px solid var(--border)'};
            text-align:center;box-sizing:border-box;">${label}</div>`;
    }).join('');

    // ── Zeilen ────────────────────────────────────────
    const rows = people.map(p => {
        const myTasks = placed.filter(c => c.wer === p);
        const taskColor = colors[p] || '#666';

        assignLanes(myTasks);
        const maxLane  = myTasks.reduce((m, t) => Math.max(m, t._lane), 0);
        const rowH     = (maxLane + 1) * laneHeight;

        const bars = myTasks.map(task => {
            const { earliest, latest, ownDur } = getConstraints(task);
            const left     = (task.simStart || 0) * hourWidth;
            const width    = Math.max(ownDur * hourWidth, 28);
            const isGroup  = !!task.gruppe;
            const hasOffset = task.startOffset !== null && task.startOffset !== undefined;
            const laneTop  = task._lane * laneHeight;

            const cMin = earliest * hourWidth;
            const cMax = latest !== null ? (latest + ownDur) * hourWidth : totalCols * hourWidth;
            const cW   = Math.max(cMax - cMin, 0);
            const constraintZone = `<div style="position:absolute;left:${cMin}px;top:${laneTop+8}px;width:${cW}px;height:48px;
                background:rgba(16,185,129,0.06);border-left:2px dashed rgba(16,185,129,0.4);
                border-right:${latest !== null ? '2px dashed rgba(239,68,68,0.4)' : 'none'};
                border-radius:4px;pointer-events:none;z-index:1;"></div>`;

            return `
                ${constraintZone}
                <div class="gantt-task-bar"
                     data-label="${escHtml(task.label)}"
                     data-gruppe="${escHtml(task.gruppe || '')}"
                     data-earliest="${earliest}"
                     data-latest="${latest !== null ? latest : ''}"
                     data-dur="${ownDur}"
                     title="${escHtml(task.label)}: ${escHtml(task.titel||'')} | ${fmtH(task.simStart||0)} – ${fmtH(task.simEnd||0)}"
                     onclick="if(!window._ganttDragged && window.showUBahnCardDetail) window.showUBahnCardDetail('${escHtml(task.label)}')"
                     style="position:absolute;left:${left}px;top:${laneTop+14}px;width:${width}px;height:36px;
                            background:${taskColor}22;border:2px solid ${taskColor};border-radius:10px;
                            display:flex;align-items:center;padding:0 10px;font-size:11px;color:var(--text);
                            white-space:nowrap;overflow:hidden;box-sizing:border-box;z-index:3;
                            cursor:grab;user-select:none;transition:box-shadow 0.15s;
                            ${isGroup ? 'border-style:dashed;' : ''}
                            ${hasOffset ? 'box-shadow:0 0 0 2px '+taskColor+';' : ''}">
                    <b style="color:${taskColor};margin-right:6px;font-size:12px;flex-shrink:0;">${escHtml(task.label)}</b>
                    <span style="font-weight:600;opacity:0.9;overflow:hidden;text-overflow:ellipsis;">${escHtml(task.titel||'')}</span>
                    ${hasOffset ? '<span style="margin-left:4px;font-size:9px;opacity:0.6;flex-shrink:0;">📌</span>' : ''}
                </div>`;
        }).join('');

        return `
            <div style="display:flex;align-items:flex-start;border-bottom:1px dotted var(--border);
                        min-height:${rowH}px;position:relative;">
                <div style="width:${labelWidth}px;flex-shrink:0;font-size:11px;font-weight:900;
                            color:${taskColor};position:sticky;left:0;background:var(--bg-panel);z-index:6;
                            padding-right:16px;padding-top:${laneHeight/2 - 8}px;text-align:right;
                            text-transform:uppercase;letter-spacing:1.5px;
                            border-right:1px solid var(--border);height:${rowH}px;box-sizing:border-box;">
                    ${escHtml(p)}
                </div>
                <div style="position:relative;flex:1;height:${rowH}px;overflow:visible;">${bars}</div>
            </div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="gantt-modal" style="width:100%;max-width:1400px;max-height:90vh;overflow:hidden;
                display:flex;flex-direction:column;color:var(--text);
                box-shadow:0 30px 90px rgba(0,0,0,0.4);background:var(--bg-app);">
            <div style="padding:20px 24px;border-bottom:1px solid var(--border);display:flex;
                        justify-content:space-between;align-items:center;background:rgba(var(--panel-rgb),0.3);">
                <div>
                    <h2 style="margin:0;font-size:20px;letter-spacing:1px;text-transform:uppercase;font-weight:900;">Projekt-Timeline</h2>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
                        Balken ziehen zum Verschieben · 📌 = manuell gesetzt · Gesamtdauer: <strong>${maxTime.toFixed(1)}h</strong>
                    </div>
                </div>
                <div style="display:flex;gap:10px;align-items:center;">
                    <button onclick="window.ganttOptimize(window._lastGanttData?.grid?.placedCards || [])"
                            title="Berechnet den schnellstmöglichen Ablaufplan — alle starten so früh wie möglich"
                            style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;
                                   padding:10px 20px;border-radius:12px;cursor:pointer;font-weight:bold;
                                   font-size:13px;letter-spacing:0.3px;">⚡ Optimieren</button>
                    <button onclick="document.getElementById('gantt-overlay').remove()"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 24px;border-radius:12px;cursor:pointer;font-weight:bold;">Schließen</button>
                </div>
            </div>
            <div id="gantt-scroll-area" style="flex:1;overflow:auto;padding:16px 20px;position:relative;">
                <div style="display:flex;margin-left:${labelWidth}px;position:sticky;top:0;
                            background:var(--bg-panel);z-index:10;border-bottom:1px solid var(--border);">
                    ${headerCells}
                </div>
                <div style="min-width:fit-content;background-image:linear-gradient(90deg,transparent ${hourWidth*8-1}px,rgba(99,102,241,0.15) ${hourWidth*8-1}px,rgba(99,102,241,0.15) ${hourWidth*8}px,transparent ${hourWidth*8}px);background-size:${hourWidth*8}px 100%;">
                    ${rows}
                </div>
            </div>
            <div style="padding:12px 24px;background:rgba(var(--panel-rgb),0.2);border-top:1px solid var(--border);
                        display:flex;gap:24px;font-size:10px;color:var(--text-muted);font-weight:bold;letter-spacing:0.5px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:16px;height:10px;border:1px solid var(--text-muted);border-radius:2px;"></div> Einzelaufgabe
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:16px;height:10px;border:1px dashed var(--text-muted);border-radius:2px;"></div> Gruppenarbeit
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:20px;height:10px;background:rgba(16,185,129,0.12);border-left:2px dashed rgba(16,185,129,0.5);"></div> Möglicher Bereich
                </div>
                <div style="display:flex;align-items:center;gap:6px;">📌 Manuell festgelegt</div>
                <div style="flex:1;text-align:right;opacity:0.6;">1 Tag = 8 Arbeitsstunden · Rechtsklick auf Balken → Fixierung aufheben</div>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // Scroll-Position wiederherstellen
    const newScrollArea = document.getElementById('gantt-scroll-area');
    if (newScrollArea && (savedScrollLeft || savedScrollTop)) {
        newScrollArea.scrollLeft = savedScrollLeft;
        newScrollArea.scrollTop  = savedScrollTop;
    }

    // ── Drag-Logik ────────────────────────────────────
    let dragState = null;
    window._ganttDragged = false;

    overlay.querySelectorAll('.gantt-task-bar').forEach(bar => {
        bar.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const scrollArea  = document.getElementById('gantt-scroll-area');
            const earliest    = parseFloat(bar.dataset.earliest) || 0;
            const latestRaw   = bar.dataset.latest;
            const latest      = latestRaw !== '' ? parseFloat(latestRaw) : null;
            const dur         = parseFloat(bar.dataset.dur) || 1;
            dragState = {
                bar,
                label:       bar.dataset.label,
                gruppe:      bar.dataset.gruppe || '',
                startClientX: e.clientX,
                originalLeft: parseFloat(bar.style.left) || 0,
                earliest, latest, dur,
                moved: false,
                scrollArea,
            };
            bar.style.cursor  = 'grabbing';
            bar.style.zIndex  = '20';
            bar.style.opacity = '0.85';
            window._ganttDragged = false;
        });

        // Rechtsklick → Fixierung aufheben (alle Gruppen-Members)
        bar.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (!window.saveCardStartOffset) return;
            const gruppe = bar.dataset.gruppe;
            if (gruppe) {
                placed.filter(t => t.gruppe === gruppe).forEach(t => {
                    window.saveCardStartOffset(t.label, null);
                });
                window.showToast && window.showToast(`Gruppe: Zeitfixierung aufgehoben`);
            } else {
                window.saveCardStartOffset(bar.dataset.label, null);
                window.showToast && window.showToast(`${bar.dataset.label}: Zeitfixierung aufgehoben`);
            }
            if (window._lastGanttData) window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
        });
    });

    const onMouseMove = e => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startClientX;
        if (Math.abs(dx) < 3 && !dragState.moved) return;
        dragState.moved = true;
        window._ganttDragged = true;

        const newLeft    = dragState.originalLeft + dx;
        const minLeft    = dragState.earliest * hourWidth;
        const maxLeft    = dragState.latest !== null ? dragState.latest * hourWidth : Infinity;
        const clampedLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));

        // Gezogenen Balken verschieben
        dragState.bar.style.left = clampedLeft + 'px';

        // Alle Balken der gleichen Gruppe mitverschieben
        if (dragState.gruppe) {
            const delta = clampedLeft - dragState.originalLeft;
            overlay.querySelectorAll('.gantt-task-bar').forEach(b => {
                if (b !== dragState.bar && b.dataset.gruppe === dragState.gruppe) {
                    const orig = parseFloat(b.dataset.origLeft ?? b.style.left) || 0;
                    if (!b.dataset.origLeft) b.dataset.origLeft = orig;
                    b.style.left = Math.max(0, orig + delta) + 'px';
                }
            });
        }

        // Tooltip
        let tip = document.getElementById('gantt-drag-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'gantt-drag-tip';
            tip.style.cssText = 'position:fixed;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;font-weight:700;padding:5px 10px;border-radius:8px;pointer-events:none;z-index:40000;';
            document.body.appendChild(tip);
        }
        const newDays = clampedLeft / hourWidth / 8;
        const label = dragState.gruppe
            ? `Gruppe (${placed.filter(t => t.gruppe === dragState.gruppe).map(t => t.label).join(', ')})`
            : dragState.label;
        tip.textContent = `${label} → Tag ${newDays.toFixed(1)}`;
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top  = (e.clientY - 10) + 'px';

        const outOfRange = dragState.latest !== null && newLeft > dragState.latest * hourWidth + 2;
        dragState.bar.style.borderColor = outOfRange ? '#ef4444' : '';
    };

    const onMouseUp = e => {
        document.getElementById('gantt-drag-tip')?.remove();
        if (!dragState) return;
        const { bar, label, gruppe, moved } = dragState;
        bar.style.cursor  = 'grab';
        bar.style.zIndex  = '3';
        bar.style.opacity = '1';
        bar.style.borderColor = '';

        if (moved && window.saveCardStartOffset) {
            const newDays = parseFloat(bar.style.left) / hourWidth / 8;

            if (gruppe) {
                // Alle Gruppen-Members auf denselben Starttag setzen
                const groupTasks = placed.filter(t => t.gruppe === gruppe);
                groupTasks.forEach(t => window.saveCardStartOffset(t.label, newDays));
                window.showToast && window.showToast(`Gruppe: ${groupTasks.length} Tasks → Tag ${newDays.toFixed(1)}`);
            } else {
                window.saveCardStartOffset(label, newDays);
                window.showToast && window.showToast(`${label}: Start → Tag ${newDays.toFixed(1)}`);
            }

            // Sofort neu zeichnen (saveCardStartOffset ist synchron und aktualisiert _lastGanttData)
            if (window._lastGanttData) {
                window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
            }
        }

        dragState = null;
        setTimeout(() => { window._ganttDragged = false; }, 50);
    };

    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup',   onMouseUp);
    overlay.addEventListener('mouseleave', onMouseUp);
}

function escHtml(t) {
    return String(t).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

window.ganttOptimize = function(placed) {
    if (!placed || placed.length === 0) {
        window.showToast && window.showToast('Keine Tasks zum Optimieren.', 'error');
        return;
    }
    // Lokale computeOptimized ist nicht zugänglich — deshalb inline-Aufruf über showGanttView-Closure.
    // Stattdessen: direkt über _lastGanttData neu aufrufen, nachdem Offsets gesetzt wurden.
    // Wir starten showGanttView einmal mit einer speziellen Flag, die computeOptimized auslöst.
    // Einfachere Lösung: computeOptimized in globale Funktion extrahieren.
    window.showToast && window.showToast('Zeitplan wird optimiert…');
    // Offsets berechnen (Funktion ist via Closure in letzter showGanttView-Instanz nicht direkt zugänglich)
    // Deshalb: Algorithmus hier nochmals inlinen.
    const byLabel = {};
    placed.forEach(t => { byLabel[(t.label||'').toUpperCase()] = t; });
    const taskDur = t => Math.max((t.simEnd||0) - (t.simStart||0), 0.25);
    const visited = new Set();
    const order   = [];
    function visit(t) {
        if (visited.has(t.label)) return;
        visited.add(t.label);
        (t.deps||[]).forEach(d => { const dep = byLabel[String(d).toUpperCase()]; if (dep) visit(dep); });
        order.push(t);
    }
    placed.forEach(t => visit(t));

    const endTime    = {};
    const personAvail = {};
    const groupStart  = {};
    order.forEach(t => {
        const d = taskDur(t);
        let depEarliest = 0;
        (t.deps||[]).forEach(dep => {
            const depT = byLabel[String(dep).toUpperCase()];
            if (depT) depEarliest = Math.max(depEarliest, endTime[depT.label] || 0);
        });
        if (t.gruppe && groupStart[t.gruppe] !== undefined) {
            const start = groupStart[t.gruppe];
            endTime[t.label] = start + d;
            personAvail[t.wer] = Math.max(personAvail[t.wer] || 0, start + d);
        } else if (t.gruppe) {
            const groupMembers = placed.filter(gt => gt.gruppe === t.gruppe);
            let gs = depEarliest;
            groupMembers.forEach(gt => {
                (gt.deps||[]).forEach(dep => {
                    const depT = byLabel[String(dep).toUpperCase()];
                    if (depT) gs = Math.max(gs, endTime[depT.label] || 0);
                });
                gs = Math.max(gs, personAvail[gt.wer] || 0);
            });
            groupStart[t.gruppe] = gs;
            endTime[t.label] = gs + d;
            personAvail[t.wer] = Math.max(personAvail[t.wer] || 0, gs + d);
        } else {
            const start = Math.max(depEarliest, personAvail[t.wer] || 0);
            endTime[t.label] = start + d;
            personAvail[t.wer] = start + d;
        }
    });

    // Offsets speichern (in Tagen)
    placed.forEach(t => {
        const start = (endTime[t.label] || 0) - taskDur(t);
        const days  = start / 8;
        if (window.saveCardStartOffset) window.saveCardStartOffset(t.label, days);
    });

    const totalH = Math.max(...placed.map(t => endTime[t.label] || 0));
    const totalD = (totalH / 8).toFixed(1);
    window.showToast && window.showToast(`⚡ Optimiert! Gesamtdauer: ${totalD} Tage`);

    if (window._lastGanttData) {
        window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
    }
};

window.showGanttView = showGanttView;
