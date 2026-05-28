const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const rc = rough.canvas(canvas);
const container = document.getElementById('canvas-container');
const textEditor = document.getElementById('text-editor');

let state = {
    tool: 'select', strokeColor: '#000000', strokeWidth: 2, fillColor: 'transparent',
    roughness: 1.5, elements: [], history: [], historyIndex: -1,
    offset: { x: 0, y: 0 }, scale: 1, isPanning: false, isDrawing: false,
    isResizing: false, isDragging: false, isMarquee: false, currentElement: null,
    selection: [], startPos: { x: 0, y: 0 }, lastMousePos: { x: 0, y: 0 },
    resizeHandle: null, editingTextId: null
};

function resizeCanvas() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    needsUpdate = true;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function getMousePos(e) {
    return { x: (e.clientX - state.offset.x) / state.scale, y: (e.clientY - state.offset.y) / state.scale };
}

function saveState() {
    const snapshot = JSON.stringify(state.elements);
    if (state.historyIndex < state.history.length - 1) state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    state.historyIndex++;
    localStorage.setItem('novaboard_pro_save', snapshot);
}

function undo() {
    if (state.historyIndex > 0) {
        state.historyIndex--;
        state.elements = JSON.parse(state.history[state.historyIndex]);
        state.selection = [];
        needsUpdate = true;
    }
}

function redo() {
    if (state.historyIndex < state.history.length - 1) {
        state.historyIndex++;
        state.elements = JSON.parse(state.history[state.historyIndex]);
        state.selection = [];
        needsUpdate = true;
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(state.offset.x, state.offset.y);
    ctx.scale(state.scale, state.scale);

    state.elements.forEach(el => drawElement(el));
    if (state.currentElement) drawElement(state.currentElement);
    
    if (state.isMarquee) {
        ctx.strokeStyle = '#3b82f6'; ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'; ctx.lineWidth = 1/state.scale; ctx.setLineDash([5/state.scale, 5/state.scale]);
        ctx.fillRect(state.startPos.x, state.startPos.y, state.lastMousePos.x - state.startPos.x, state.lastMousePos.y - state.startPos.y);
        ctx.strokeRect(state.startPos.x, state.startPos.y, state.lastMousePos.x - state.startPos.x, state.lastMousePos.y - state.startPos.y);
        ctx.setLineDash([]);
    }

    if (state.selection.length > 0) drawSelectionFrame();
    ctx.restore();
}

function drawElement(el) {
    const options = { stroke: el.stroke, strokeWidth: el.strokeWidth / state.scale, fill: el.fill, roughness: state.roughness };

    if (el.type === 'rectangle') rc.rectangle(el.x, el.y, el.width, el.height, options).draw();
    else if (el.type === 'diamond') {
        const w = el.width, h = el.height;
        const pts = [[el.x + w/2, el.y], [el.x + w, el.y + h/2], [el.x + w/2, el.y + h], [el.x, el.y + h/2]];
        rc.polygon(pts, options).draw();
    }
    else if (el.type === 'circle') {
        const rx = el.width / 2;
        const ry = el.height / 2;
        // Approximation of ellipse for rough.js using path if widths differ drastically, otherwise circle
        rc.ellipse(el.x + rx, el.y + ry, Math.abs(el.width), Math.abs(el.height), options).draw();
    } else if (el.type === 'line') rc.line(el.x, el.y, el.x + el.width, el.y + el.height, options).draw();
    else if (el.type === 'arrow') {
        let start = {x: el.x, y: el.y}, end = {x: el.x + el.width, y: el.y + el.height};
        if (el.fromId) {
            const from = state.elements.find(e => e.id === el.fromId);
            if (from) {
                const b = getBBox(from); start = {x: b.x + b.w/2, y: b.y + b.h/2};
            }
        }
        if (el.toId) {
            const to = state.elements.find(e => e.id === el.toId);
            if (to) {
                const b = getBBox(to); end = {x: b.x + b.w/2, y: b.y + b.h/2};
            }
        }
        // Save computed dynamic points for hit testing later
        el.computedStart = start; el.computedEnd = end;
        rc.line(start.x, start.y, end.x, end.y, options).draw();
        drawArrowHead(start, end, el.stroke);
    } else if (el.type === 'pencil') {
        if (el.points.length > 0) {
            rc.curve(el.points.map(p => [p.x, p.y]), options).draw();
        }
    } else if (el.type === 'text') {
        ctx.font = `${20}px Inter`;
        ctx.fillStyle = el.stroke;
        // Text baseline top for easier bounding box math
        ctx.textBaseline = 'top';
        ctx.fillText(el.text, el.x, el.y);
    }
}

function drawArrowHead(start, end, color) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const size = 12 / state.scale;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - size * Math.cos(angle - Math.PI/6), end.y - size * Math.sin(angle - Math.PI/6));
    ctx.lineTo(end.x - size * Math.cos(angle + Math.PI/6), end.y - size * Math.sin(angle + Math.PI/6));
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
}

function drawSelectionFrame() {
    const frame = getSelectionFrame();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1 / state.scale; ctx.setLineDash([5/state.scale, 5/state.scale]);
    ctx.strokeRect(frame.minX, frame.minY, frame.maxX - frame.minX, frame.maxY - frame.minY);
    ctx.setLineDash([]);
    const s = 8 / state.scale;
    const handles = [{x: frame.minX, y: frame.minY}, {x: (frame.minX+frame.maxX)/2, y: frame.minY}, {x: frame.maxX, y: frame.minY},
                     {x: frame.minX, y: (frame.minY+frame.maxY)/2}, {x: frame.maxX, y: (frame.minY+frame.maxY)/2},
                     {x: frame.minX, y: frame.maxY}, {x: (frame.minX+frame.maxX)/2, y: frame.maxY}, {x: frame.maxX, y: frame.maxY}];
    ctx.fillStyle = 'white'; ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5 / state.scale;
    handles.forEach(h => { ctx.beginPath(); ctx.rect(h.x-s/2, h.y-s/2, s, s); ctx.fill(); ctx.stroke(); });
}

function getBBox(el) {
    if (el.type === 'text') {
        ctx.font = `${20}px Inter`;
        const metrics = ctx.measureText(el.text);
        return {x: el.x, y: el.y, w: metrics.width, h: 24};
    }
    if (el.type === 'pencil') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        el.points.forEach(p => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        return {x: minX, y: minY, w: maxX - minX, h: maxY - minY};
    }
    if (el.type === 'arrow' || el.type === 'line') {
        const start = el.computedStart || {x: el.x, y: el.y};
        const end = el.computedEnd || {x: el.x + el.width, y: el.y + el.height};
        return {x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(start.x - end.x), h: Math.abs(start.y - end.y)};
    }
    
    // Normalize width/height if negative
    const w = el.width || 0; const h = el.height || 0;
    return {
        x: w < 0 ? el.x + w : el.x,
        y: h < 0 ? el.y + h : el.y,
        w: Math.abs(w),
        h: Math.abs(h)
    };
}

function getSelectionFrame() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.selection.forEach(el => {
        const b = getBBox(el);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    });
    return {minX: minX-5, minY: minY-5, maxX: maxX+5, maxY: maxY+5};
}

function hitTest(x, y) {
    // Reverse order to hit top elements first
    for (let i = state.elements.length - 1; i >= 0; i--) {
        const el = state.elements[i];
        const b = getBBox(el);
        // Expand hit area slightly
        const pad = 5 / state.scale;
        if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
            return el;
        }
    }
    return null;
}

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.tool = btn.dataset.tool;
        state.selection = [];
        needsUpdate = true;
    };
});

document.getElementById('undo-btn').onclick = undo;
document.getElementById('redo-btn').onclick = redo;
document.getElementById('clear-btn').onclick = () => { state.elements = []; state.selection = []; saveState(); needsUpdate = true; };
document.querySelectorAll('[data-color]').forEach(btn => btn.onclick = () => {
    state.strokeColor = btn.dataset.color;
    if (state.selection.length) { state.selection.forEach(el => el.stroke = state.strokeColor); saveState(); needsUpdate = true; }
});
document.getElementById('custom-color').oninput = (e) => {
    state.strokeColor = e.target.value;
    if (state.selection.length) { state.selection.forEach(el => el.stroke = state.strokeColor); saveState(); needsUpdate = true; }
};
document.querySelectorAll('[data-fill]').forEach(btn => btn.onclick = () => {
    state.fillColor = btn.dataset.fill;
    if (state.selection.length) { state.selection.forEach(el => el.fill = state.fillColor); saveState(); needsUpdate = true; }
});
document.getElementById('roughness-slider').oninput = (e) => {
    state.roughness = parseFloat(e.target.value);
    needsUpdate = true; // Apply globally for simplicity, rough.js options are tied to global state in this implementation if not saved per element. 
    // Actually we save roughness per element, wait, options in drawElement uses state.roughness. 
    // Let's not mutate existing element roughness unless we update the draw options logic.
};

document.getElementById('tidy-btn').onclick = () => {
    if (state.selection.length < 2) return;
    state.selection.sort((a, b) => a.x - b.x);
    state.selection.forEach((el, i) => {
        el.x = 100 + (i % 3) * 300;
        el.y = 100 + Math.floor(i / 3) * 200;
    });
    saveState(); needsUpdate = true;
};

document.getElementById('export-btn').onclick = () => {
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = canvas.width; tmpCanvas.height = canvas.height;
    const tmpCtx = tmpCanvas.getContext('2d');
    const tmpRc = rough.canvas(tmpCanvas);
    
    tmpCtx.translate(state.offset.x, state.offset.y);
    tmpCtx.scale(state.scale, state.scale);
    
    // Simplified export, just reuse drawElement
    state.elements.forEach(el => {
        const options = { stroke: el.stroke, strokeWidth: el.strokeWidth / state.scale, fill: el.fill, roughness: state.roughness };
        if (el.type === 'rectangle') tmpRc.rectangle(el.x, el.y, el.width, el.height, options).draw();
        else if (el.type === 'diamond') {
            const w = el.width, h = el.height;
            tmpRc.polygon([[el.x + w/2, el.y], [el.x + w, el.y + h/2], [el.x + w/2, el.y + h], [el.x, el.y + h/2]], options).draw();
        }
        else if (el.type === 'circle') tmpRc.ellipse(el.x + el.width/2, el.y + el.height/2, Math.abs(el.width), Math.abs(el.height), options).draw();
        else if (el.type === 'line') tmpRc.line(el.x, el.y, el.x + el.width, el.y + el.height, options).draw();
        else if (el.type === 'pencil') tmpRc.curve(el.points.map(p=>[p.x, p.y]), options).draw();
        else if (el.type === 'text') { tmpCtx.font = `20px Inter`; tmpCtx.fillStyle = el.stroke; tmpCtx.textBaseline='top'; tmpCtx.fillText(el.text, el.x, el.y); }
    });
    
    const link = document.createElement('a');
    link.download = 'nova-board-export.png';
    link.href = tmpCanvas.toDataURL();
    link.click();
};

window.addEventListener('keydown', (e) => {
    if (e.target === textEditor) return; // Don't trigger shortcuts when typing
    if (e.code === 'Space') state.isPanning = true;
    if (e.ctrlKey && e.key === 'z') undo();
    if (e.ctrlKey && e.key === 'y') redo();
    
    // Tool shortcuts
    if (e.key === 'v') document.querySelector('[data-tool="select"]').click();
    if (e.key === 'r') document.querySelector('[data-tool="rectangle"]').click();
    if (e.key === 'd') document.querySelector('[data-tool="diamond"]').click();
    if (e.key === 'o') document.querySelector('[data-tool="circle"]').click();
    if (e.key === 'l') document.querySelector('[data-tool="line"]').click();
    if (e.key === 'a') document.querySelector('[data-tool="arrow"]').click();
    if (e.key === 'p') document.querySelector('[data-tool="pencil"]').click();
    if (e.key === 't') document.querySelector('[data-tool="text"]').click();
    
    // Delete shortcut
    if (e.key === 'Backspace' || e.key === 'Delete') {
        if (state.selection.length > 0) {
            state.elements = state.elements.filter(el => !state.selection.includes(el));
            state.selection = [];
            saveState();
            needsUpdate = true;
        }
    }
});
window.addEventListener('keyup', (e) => { if (e.code === 'Space') state.isPanning = false; });

// Double click to edit text
container.addEventListener('dblclick', (e) => {
    const pos = getMousePos(e);
    const hitEl = hitTest(pos.x, pos.y);
    if (hitEl && hitEl.type === 'text') {
        state.selection = [hitEl];
        startTextEditing(hitEl);
    }
});

// Pointer events for Touch/Mouse
container.addEventListener('pointerdown', (e) => {
    if (state.isPanning || (e.button === 1 || e.button === 2)) {
        state.isPanning = true; // Middle/right click pans
        state.lastMousePos = { x: e.clientX, y: e.clientY };
        return;
    }
    const pos = getMousePos(e);
    state.startPos = pos; state.lastMousePos = pos;

    if (state.tool === 'select') {
        if (state.selection.length > 0) {
            const frame = getSelectionFrame();
            const s = 10 / state.scale;
            const handles = [{i: 0, x: frame.minX, y: frame.minY}, {i: 1, x: (frame.minX+frame.maxX)/2, y: frame.minY}, {i: 2, x: frame.maxX, y: frame.minY},
                           {i: 3, x: frame.minX, y: (frame.minY+frame.maxY)/2}, {i: 4, x: frame.maxX, y: (frame.minY+frame.maxY)/2},
                           {i: 5, x: frame.minX, y: frame.maxY}, {i: 6, x: (frame.minX+frame.maxX)/2, y: frame.maxY}, {i: 7, x: frame.maxX, y: frame.maxY}];
            const hit = handles.find(h => Math.abs(pos.x - h.x) < s && Math.abs(pos.y - h.y) < s);
            if (hit) { state.isResizing = true; state.resizeHandle = hit.i; return; }
        }
        
        const hitEl = hitTest(pos.x, pos.y);
        
        if (hitEl) {
            if (e.shiftKey) {
                if (state.selection.includes(hitEl)) state.selection = state.selection.filter(el => el !== hitEl);
                else state.selection.push(hitEl);
            } else {
                if (!state.selection.includes(hitEl)) state.selection = [hitEl];
            }
            state.isDragging = true;
        } else {
            state.selection = []; state.isMarquee = true; 
        }
    } else if (state.tool === 'text') {
        const textEl = { id: Date.now(), type: 'text', x: pos.x, y: pos.y, text: 'Text', stroke: state.strokeColor, strokeWidth: state.strokeWidth, fill: state.fillColor };
        state.elements.push(textEl);
        
        // Switch back to select tool manually to avoid focus issues
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-tool="select"]').classList.add('active');
        state.tool = 'select';
        
        state.selection = [textEl];
        startTextEditing(textEl);
    } else {
        state.isDrawing = true;
        state.currentElement = { id: Date.now(), type: state.tool, x: pos.x, y: pos.y, width: 0, height: 0, stroke: state.strokeColor, strokeWidth: state.strokeWidth, fill: state.fillColor, points: [pos] };
        
        // Arrow snapping on start
        if (state.tool === 'arrow') {
            const hitEl = hitTest(pos.x, pos.y);
            if (hitEl && hitEl !== state.currentElement) {
                state.currentElement.fromId = hitEl.id;
            }
        }
    }
    needsUpdate = true;
});

window.addEventListener('pointermove', (e) => {
    if (state.isPanning) {
        state.offset.x += e.clientX - state.lastMousePos.x; state.offset.y += e.clientY - state.lastMousePos.y;
        state.lastMousePos = { x: e.clientX, y: e.clientY }; needsUpdate = true; return;
    }
    const pos = getMousePos(e);
    const dx = pos.x - state.lastMousePos.x; 
    const dy = pos.y - state.lastMousePos.y;

    if (state.isDrawing && state.currentElement) {
        if (state.tool === 'pencil') state.currentElement.points.push(pos); 
        else { 
            state.currentElement.width = pos.x - state.startPos.x; 
            state.currentElement.height = pos.y - state.startPos.y; 
            
            // Arrow snapping on hover during draw
            if (state.tool === 'arrow') {
                const hitEl = hitTest(pos.x, pos.y);
                state.currentElement.toId = (hitEl && hitEl !== state.currentElement) ? hitEl.id : null;
            }
        }
        needsUpdate = true;
    } else if (state.isDragging) {
        state.selection.forEach(el => {
            if (el.type === 'pencil') {
                el.points.forEach(p => { p.x += dx; p.y += dy; });
            } else {
                el.x += dx; el.y += dy;
            }
        });
        needsUpdate = true;
    } else if (state.isResizing) {
        const h = state.resizeHandle;
        state.selection.forEach(el => {
            if (el.type !== 'pencil') {
                if (h===0) { el.x+=dx; el.y+=dy; el.width-=dx; el.height-=dy; } // NW
                if (h===1) { el.y+=dy; el.height-=dy; } // N
                if (h===2) { el.y+=dy; el.width+=dx; el.height-=dy; } // NE
                if (h===3) { el.x+=dx; el.width-=dx; } // W
                if (h===4) { el.width+=dx; } // E
                if (h===5) { el.x+=dx; el.width-=dx; el.height+=dy; } // SW
                if (h===6) { el.height+=dy; } // S
                if (h===7) { el.width+=dx; el.height+=dy; } // SE
            }
        });
        needsUpdate = true;
    } else if (state.isMarquee) {
        needsUpdate = true;
    }
    state.lastMousePos = pos;
});

window.addEventListener('pointerup', () => {
    if (state.isPanning) { state.isPanning = false; }
    if (state.isDrawing && state.currentElement) {
        state.elements.push(state.currentElement);
        state.selection = [state.currentElement];
        state.currentElement = null; 
        saveState();
        document.querySelector('[data-tool="select"]').click(); // Auto-switch to select after draw
    } else if (state.isMarquee) {
        const x1 = Math.min(state.startPos.x, state.lastMousePos.x);
        const y1 = Math.min(state.startPos.y, state.lastMousePos.y);
        const x2 = Math.max(state.startPos.x, state.lastMousePos.x);
        const y2 = Math.max(state.startPos.y, state.lastMousePos.y);
        state.selection = state.elements.filter(el => {
            const b = getBBox(el); return b.x >= x1 && b.x+b.w <= x2 && b.y >= y1 && b.y+b.h <= y2;
        });
    } else if (state.isDragging || state.isResizing) {
        saveState();
    }
    state.isDrawing = false; state.isResizing = false; state.isDragging = false; state.isMarquee = false; 
    needsUpdate = true;
});

// Touch pad gesture zooming
container.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const oldS = state.scale; 
        // Pinch zoom
        state.scale = Math.min(Math.max(0.1, state.scale - e.deltaY * 0.01), 5);
        state.offset.x -= (e.clientX - state.offset.x) * (state.scale / oldS - 1);
        state.offset.y -= (e.clientY - state.offset.y) * (state.scale / oldS - 1);
        document.getElementById('zoom-level').innerText = `${Math.round(state.scale * 100)}%`;
        needsUpdate = true;
    } else {
        // Two finger scroll panning
        state.offset.x -= e.deltaX;
        state.offset.y -= e.deltaY;
        needsUpdate = true;
    }
}, { passive: false });

function startTextEditing(el) {
    state.editingTextId = el.id; 
    textEditor.classList.remove('hidden'); 
    textEditor.value = el.text;
    const screenX = el.x * state.scale + state.offset.x;
    const screenY = el.y * state.scale + state.offset.y;
    textEditor.style.left = `${screenX}px`; 
    textEditor.style.top = `${screenY}px`;
    textEditor.style.fontSize = `${20 * state.scale}px`;
    
    // Auto-expand textarea
    textEditor.style.width = 'max-content';
    textEditor.style.minWidth = '50px';
    textEditor.style.height = `${24 * state.scale}px`;
    
    // Select all text
    setTimeout(() => {
        textEditor.focus();
        textEditor.select();
    }, 10);
}

function finishTextEditing() {
    const el = state.elements.find(e => e.id === state.editingTextId);
    if (el) { 
        if (textEditor.value.trim() === '') {
            state.elements = state.elements.filter(e => e.id !== state.editingTextId);
            state.selection = [];
        } else {
            el.text = textEditor.value; 
        }
        saveState(); 
    }
    textEditor.classList.add('hidden'); state.editingTextId = null; needsUpdate = true;
}
textEditor.addEventListener('blur', finishTextEditing);
textEditor.addEventListener('keydown', (e) => {
    // Escape to cancel without saving, Enter to save
    if (e.key === 'Escape') {
        textEditor.classList.add('hidden'); state.editingTextId = null; needsUpdate = true;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        finishTextEditing();
    }
});

let needsUpdate = true;
function loop() {
    if (needsUpdate) { render(); needsUpdate = false; }
    requestAnimationFrame(loop);
}

const saved = localStorage.getItem('novaboard_pro_save');
if (saved) { state.elements = JSON.parse(saved); state.history = [saved]; state.historyIndex = 0; } else saveState();
loop();
