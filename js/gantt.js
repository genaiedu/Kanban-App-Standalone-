// js/gantt.js — Professionelles Analyse-Modul (Anklickbare Karten & Glassmorphismus)
export function showGanttView(data, grid) {
    const people = data.people;
    const placed = grid.placedCards;
    const colors = data.lineColors;

    // 1. Overlay mit dynamischem Blur
    const overlay = document.createElement('div');
    overlay.id = 'gantt-overlay';
    overlay.style.cssText = `
        position: fixed; 
        inset: 0; 
        background: rgba(0,0,0,0.4); 
        backdrop-filter: blur(10px); 
        -webkit-backdrop-filter: blur(10px); 
        z-index: 30000; 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        padding: 2vw;
    `;
    
    // Schließen beim Klick auf den Hintergrund
    overlay.onclick = e => { if(e.target === overlay) overlay.remove(); };

    const maxTime = Math.max(...placed.map(c => c.simEnd || 0));
    const hourWidth = 60; // Skalierung: 60px pro Stunde
    const rowHeight = 64;

    let html = `
        <div class="gantt-modal" style="width:100%; max-width:1400px; max-height:90vh; overflow:hidden; display:flex; flex-direction:column; color:var(--text); box-shadow: 0 30px 90px rgba(0,0,0,0.4);">
            
            <div style="padding:24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; background:rgba(var(--panel-rgb),0.3);">
                <div>
                    <h2 style="margin:0; font-size:20px; letter-spacing:1px; text-transform:uppercase; font-weight:900;">Projekt-Timeline & Analyse</h2>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">
                        Klicken zum Bearbeiten • Gesamtdauer: <strong>${maxTime.toFixed(1)}h</strong> (${Math.ceil(maxTime/8)} Arbeitstage)
                    </div>
                </div>
                <button onclick="document.getElementById('gantt-overlay').remove()" 
                        style="background:var(--surface); border:1px solid var(--border); color:var(--text); padding:10px 24px; border-radius:12px; cursor:pointer; font-weight:bold; transition:all 0.2s;">
                    Schließen
                </button>
            </div>
            
            <div id="gantt-scroll-area" style="flex:1; overflow:auto; padding:20px; position:relative;">
                
                <div style="display:flex; margin-left:140px; position:sticky; top:0; background:var(--bg-panel); z-index:10; border-bottom:1px solid var(--border); box-shadow:0 4px 15px rgba(0,0,0,0.1);">
                    ${Array.from({length: Math.ceil(maxTime) + 1}).map((_, i) => `
                        <div style="width:${hourWidth}px; flex-shrink:0; font-size:10px; color:var(--text-muted); padding:12px 4px; font-weight:bold; border-left:1px solid var(--border);">${i}h</div>
                    `).join('')}
                </div>

                <div class="gantt-grid-lines" style="min-width:fit-content; background-image: linear-gradient(90deg, var(--border) 1px, transparent 1px); background-size: ${hourWidth}px 100%;">
                    ${people.map(p => {
                        // Alle Tasks dieser Person filtern
                        const myTasks = placed.filter(c => {
                            const members = c.gruppe ? Array.from(new Set(placed.filter(pc => pc.gruppe === c.gruppe).map(pc => pc.wer))) : [c.wer];
                            return members.includes(p);
                        });

                        return `
                            <div style="display:flex; align-items:center; border-bottom:1px dotted var(--border); min-height:${rowHeight}px; position:relative;">
                                
                                <div style="width:140px; flex-shrink:0; font-size:11px; font-weight:900; color:${colors[p]}; position:sticky; left:0; background:var(--bg-panel); z-index:5; padding-right:20px; text-align:right; text-transform:uppercase; letter-spacing:1.5px; border-right:1px solid var(--border);">
                                    ${p}
                                </div>
                                
                                <div style="position:relative; flex:1; height:${rowHeight}px;">
                                    ${myTasks.map(task => {
                                        const left = task.simStart * hourWidth;
                                        const width = (task.simEnd - task.simStart) * hourWidth;
                                        const isGroup = !!task.gruppe;
                                        const taskColor = colors[task.wer];
                                        
                                        return `
                                            <div class="gantt-task-bar" 
                                                 onclick="window.showUBahnCardDetail('${task.label}')"
                                                 title="${task.label}: ${task.titel} (${(task.simEnd-task.simStart).toFixed(1)}h)" 
                                                 style="position:absolute; left:${left}px; top:14px; width:${width}px; height:36px; 
                                                        background:${taskColor}25; border:2px solid ${taskColor}; border-radius:10px; 
                                                        display:flex; align-items:center; padding:0 12px; font-size:11px; color:var(--text); 
                                                        white-space:nowrap; overflow:hidden; box-sizing:border-box; z-index:2;
                                                        transition: transform 0.2s, box-shadow 0.2s; cursor:pointer;
                                                        ${isGroup ? 'border-style: dashed;' : ''}">
                                                <b style="color:${taskColor}; margin-right:8px; font-size:12px; text-shadow:0 0 10px ${taskColor}44;">${task.label}</b> 
                                                <span style="font-weight:600; opacity:0.9;">${task.titel}</span>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <div style="padding:14px 24px; background:rgba(var(--panel-rgb),0.2); border-top:1px solid var(--border); display:flex; gap:25px; font-size:10px; color:var(--text-muted); font-weight:bold; letter-spacing:0.5px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:16px; height:10px; border:1px solid var(--text-muted); border-radius:2px;"></div> Einzelaufgabe
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <div style="width:16px; height:10px; border:1px dashed var(--text-muted); border-radius:2px;"></div> Gruppenarbeit (Synchron)
                </div>
                <div style="flex:1; text-align:right; opacity:0.6;">
                    * 1 Tag = 8 Arbeitsstunden
                </div>
            </div>
        </div>
    `;

    overlay.innerHTML = html;
    document.body.appendChild(overlay);
}

// Global für das U-Bahn-Modul registrieren
window.showGanttView = showGanttView;
