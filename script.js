// ============================================================
//  SketchMotion Pro — script.js
//  Beginner-friendly version with comments on every section
// ============================================================


// ── 1. GET ELEMENTS FROM THE PAGE ────────────────────────────
// We grab all the HTML elements we need to work with

const canvas          = document.getElementById("canvas");          // main drawing surface
const onionCanvas     = document.getElementById("onionCanvas");     // ghost of previous frame
const selectionCanvas = document.getElementById("selectionCanvas"); // selection box overlay
const ctx             = canvas.getContext("2d");                    // 2D drawing API
const onionCtx        = onionCanvas.getContext("2d");
const selCtx          = selectionCanvas.getContext("2d");

const frameContainer = document.getElementById("frameContainer");
const canvasWrapper  = document.querySelector(".canvas-wrapper");
const colorPicker    = document.getElementById("colorPicker");
const bgColorPicker  = document.getElementById("bgColorPicker");
const sizeSlider     = document.getElementById("sizeSlider");
const speedSlider    = document.getElementById("speed");
const selToolbar     = document.getElementById("selectionToolbar");


// ── 2. APP STATE (variables that track what's happening) ─────

let frames       = [];       // all frame images stored as data URLs
let currentFrame = 0;        // which frame we're on
let drawing      = false;    // is the mouse held down drawing?
let tool         = 'pencil'; // current tool: pencil | eraser | fill | select
let playing      = false;    // is the animation playing?
let playTimer    = null;     // stores the setInterval for playback
let bgColor      = '#ffffff';// canvas background color

// Undo/redo: each frame has its own history list
let undoStacks = [[]]; // undoStacks[0] = history for frame 0, etc.
let redoStacks = [[]];

// Selection tool state
let sel = {
    active:   false,   // is there a selection box on screen?
    dragging: false,   // are we currently drawing the selection box?
    moving:   false,   // are we dragging the selection contents?
    x1: 0, y1: 0,     // start corner of selection
    x2: 0, y2: 0,     // end corner of selection
    data:     null,    // the image pixels inside the selection
    offX: 0, offY: 0  // mouse offset when we started moving
};

let clipboard  = null; // stores copied selection for pasting
let marchTimer = null; // timer for the animated dashed border


// ── 3. START THE APP ─────────────────────────────────────────

function init() {
    frames     = [null]; // start with one blank frame
    undoStacks = [[]];
    redoStacks = [[]];
    canvasWrapper.style.backgroundColor = bgColor;
    renderTimeline();
    loadFrame(0);
    setupListeners();
    updateUndoButtons();
}


// ── 4. CONNECT BUTTONS TO FUNCTIONS ──────────────────────────

function setupListeners() {

    // Drawing events on the canvas
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);

    // Tool buttons
    document.getElementById("pencilBtn").onclick = () => setTool('pencil');
    document.getElementById("eraserBtn").onclick = () => setTool('eraser');
    document.getElementById("fillBtn").onclick   = () => setTool('fill');
    document.getElementById("selectBtn").onclick = () => setTool('select');

    // Frame buttons
    document.getElementById("addFrame").onclick   = addFrame;
    document.getElementById("copyFrame").onclick  = copyFrame;
    document.getElementById("clearFrame").onclick = clearFrame;

    // Playback
    document.getElementById("play").onclick = togglePlay;

    // Undo / Redo
    document.getElementById("undoBtn").onclick = undo;
    document.getElementById("redoBtn").onclick = redo;

    // Selection actions
    document.getElementById("copySelectionBtn").onclick   = copySelection;
    document.getElementById("pasteSelectionBtn").onclick  = pasteSelection;
    document.getElementById("deleteSelectionBtn").onclick = deleteSelection;

    // Download button
    document.getElementById("downloadBtn").onclick = downloadGIF;

    // Show brush size number next to slider
    sizeSlider.oninput  = () => document.getElementById("sizeVal").textContent  = sizeSlider.value;
    speedSlider.oninput = () => document.getElementById("speedVal").textContent = speedSlider.value;

    // Change canvas background color
    bgColorPicker.oninput = (e) => {
        bgColor = e.target.value;
        canvasWrapper.style.backgroundColor = bgColor;
        drawOnionSkin();
        frames.forEach((_, i) => updateThumbnail(i));
    };

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key === 'z') { e.preventDefault(); undo(); }
        if (ctrl && e.key === 'y') { e.preventDefault(); redo(); }
        if (ctrl && e.key === 'c') { e.preventDefault(); copySelection(); }
        if (ctrl && e.key === 'v') { e.preventDefault(); pasteSelection(); }
        if (e.key === 'Escape')    clearSel();
    });
}


// ── 5. TOOL SWITCHING ────────────────────────────────────────

function setTool(t) {
    if (tool === 'select' && t !== 'select') clearSel();
    tool = t;

    // Map tool name -> button id
    const map = { pencil:'pencilBtn', eraser:'eraserBtn', fill:'fillBtn', select:'selectBtn' };

    // Highlight the active tool button, un-highlight the rest
    Object.values(map).forEach(id => document.getElementById(id).classList.remove('active'));
    document.getElementById(map[t]).classList.add('active');

    // Show/hide the selection options bar
    selToolbar.classList.toggle('hidden', t !== 'select');
    canvas.style.cursor = 'crosshair';
}


// ── 6. MOUSE INPUT ───────────────────────────────────────────

// Helper: get mouse position relative to the canvas (not the whole page)
function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
}

function onMouseDown(e) {
    if (playing) return; // can't draw while animation is running
    const pos = getPos(e);

    if (tool === 'fill') {
        pushUndo();
        floodFill(pos.x, pos.y, colorPicker.value);
        save(); updateThumbnail(currentFrame);
        return;
    }

    if (tool === 'select') {
        if (sel.active && insideSel(pos.x, pos.y)) {
            // Click inside selection = start moving it
            sel.moving = true;
            const r = getSelRect();
            sel.offX = pos.x - r.x;
            sel.offY = pos.y - r.y;
            ctx.clearRect(r.x, r.y, r.w, r.h); // erase from original spot
        } else {
            // Click outside = start a new selection
            clearSel();
            sel.dragging = true;
            sel.x1 = sel.x2 = pos.x;
            sel.y1 = sel.y2 = pos.y;
        }
        return;
    }

    // Pencil or Eraser
    drawing = true;
    pushUndo();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
}

function onMouseMove(e) {
    if (playing) return;
    const pos = getPos(e);

    if (tool === 'select') {
        if (sel.dragging) {
            sel.x2 = pos.x; sel.y2 = pos.y;
            drawSelBox(); // update the dashed rectangle as we drag
        } else if (sel.moving) {
            moveSel(pos);
        } else {
            // Change cursor to show whether we're inside or outside selection
            canvas.style.cursor = (sel.active && insideSel(pos.x, pos.y)) ? 'move' : 'crosshair';
        }
        return;
    }

    if (!drawing) return;
    drawStroke(pos.x, pos.y);
}

function onMouseUp() {
    if (playing) return;

    if (tool === 'select') {
        if (sel.dragging) { sel.dragging = false; finalizeSel(); }
        if (sel.moving)   { sel.moving   = false; save(); updateThumbnail(currentFrame); }
        return;
    }

    if (drawing) {
        drawing = false;
        save(); updateThumbnail(currentFrame);
    }
}


// ── 7. DRAWING (pencil / eraser) ─────────────────────────────

function drawStroke(x, y) {
    ctx.lineWidth = sizeSlider.value;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';

    if (tool === 'eraser') {
        // destination-out makes pixels transparent (erases them)
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = colorPicker.value;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
}


// ── 8. FLOOD FILL (paint bucket) ─────────────────────────────
// Fills a connected area with the chosen color

function floodFill(startX, startY, fillHex) {
    const W = canvas.width, H = canvas.height;

    // Merge background color + canvas pixels into one flat image to read from
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const tCtx = tmp.getContext('2d');
    tCtx.fillStyle = bgColor;
    tCtx.fillRect(0, 0, W, H);
    tCtx.drawImage(canvas, 0, 0);

    const imgData = tCtx.getImageData(0, 0, W, H);
    const px      = imgData.data;
    const fill    = hexToRgb(fillHex);

    // Color we clicked on — this is what we want to replace
    const si     = (startY * W + startX) * 4;
    const target = [px[si], px[si+1], px[si+2], px[si+3]];

    if (colorClose(px, si, fill)) return; // already that color, skip

    // BFS flood — spread from click point to all adjacent matching pixels
    const queue = [[startX, startY]];
    const seen  = new Uint8Array(W * H); // track visited pixels

    while (queue.length) {
        const [x, y] = queue.pop();
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const i = (y * W + x) * 4;
        if (seen[y * W + x] || !colorClose(px, i, target)) continue;
        seen[y * W + x] = 1;
        // Paint this pixel with fill color
        px[i] = fill[0]; px[i+1] = fill[1]; px[i+2] = fill[2]; px[i+3] = 255;
        // Add 4 neighbors
        queue.push([x+1,y], [x-1,y], [x,y+1], [x,y-1]);
    }

    tCtx.putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tmp, 0, 0);
}

function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

// Returns true if a pixel at index i is close in color to 'color' array
function colorClose(px, i, color, tol = 15) {
    return Math.abs(px[i]  -color[0]) <= tol &&
           Math.abs(px[i+1]-color[1]) <= tol &&
           Math.abs(px[i+2]-color[2]) <= tol;
}


// ── 9. SELECTION TOOL ────────────────────────────────────────

// Normalize the selection into a proper top-left + size rect
function getSelRect() {
    return {
        x: Math.min(sel.x1, sel.x2),
        y: Math.min(sel.y1, sel.y2),
        w: Math.abs(sel.x2 - sel.x1),
        h: Math.abs(sel.y2 - sel.y1)
    };
}

function insideSel(x, y) {
    if (!sel.active) return false;
    const r = getSelRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

// Draw the animated dashed border around the selection
function drawSelBox() {
    selCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    const r = getSelRect();
    if (r.w < 2 || r.h < 2) return;
    selCtx.save();
    selCtx.strokeStyle    = '#5865f2';
    selCtx.lineWidth      = 1.5;
    selCtx.setLineDash([5, 3]);
    selCtx.lineDashOffset = -(Date.now() / 60 % 8); // makes dashes march
    selCtx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    selCtx.fillStyle = 'rgba(88,101,242,0.07)';
    selCtx.fillRect(r.x, r.y, r.w, r.h);
    selCtx.restore();
}

function finalizeSel() {
    const r = getSelRect();
    if (r.w < 4 || r.h < 4) { clearSel(); return; }
    sel.active = true;
    sel.data   = ctx.getImageData(r.x, r.y, r.w, r.h); // grab the pixels
    clearInterval(marchTimer);
    marchTimer = setInterval(() => { if (sel.active) drawSelBox(); }, 60); // animate
}

function moveSel(pos) {
    if (!sel.data) return;
    const r  = getSelRect();
    const nx = pos.x - sel.offX; // new top-left x
    const ny = pos.y - sel.offY; // new top-left y
    ctx.clearRect(r.x, r.y, r.w, r.h); // clear old position
    // Draw pixels at new position
    const tmp = document.createElement('canvas');
    tmp.width = r.w; tmp.height = r.h;
    tmp.getContext('2d').putImageData(sel.data, 0, 0);
    ctx.drawImage(tmp, nx, ny);
    // Update selection rectangle coordinates
    sel.x1 = nx; sel.y1 = ny;
    sel.x2 = nx + r.w; sel.y2 = ny + r.h;
    drawSelBox();
}

function clearSel() {
    sel.active = sel.dragging = sel.moving = false;
    sel.data   = null;
    clearInterval(marchTimer);
    selCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
}

function copySelection() {
    if (!sel.active || !sel.data) return;
    clipboard = { data: sel.data, w: sel.data.width, h: sel.data.height };
    toast("Selection copied!");
}

function pasteSelection() {
    if (!clipboard) return;
    pushUndo(); clearSel();
    // Paste in the center of the canvas
    const px = Math.round((canvas.width  - clipboard.w) / 2);
    const py = Math.round((canvas.height - clipboard.h) / 2);
    const tmp = document.createElement('canvas');
    tmp.width = clipboard.w; tmp.height = clipboard.h;
    tmp.getContext('2d').putImageData(clipboard.data, 0, 0);
    ctx.drawImage(tmp, px, py);
    // Show selection around the pasted content
    sel.x1 = px; sel.y1 = py;
    sel.x2 = px + clipboard.w; sel.y2 = py + clipboard.h;
    sel.active = true; sel.data = clipboard.data;
    setTool('select'); drawSelBox();
    save(); updateThumbnail(currentFrame);
}

function deleteSelection() {
    if (!sel.active) return;
    pushUndo();
    const r = getSelRect();
    ctx.clearRect(r.x, r.y, r.w, r.h);
    clearSel(); save(); updateThumbnail(currentFrame);
}


// ── 10. UNDO / REDO ──────────────────────────────────────────

function pushUndo() {
    // Take a snapshot of the canvas and add it to this frame's history
    undoStacks[currentFrame].push(canvas.toDataURL());
    if (undoStacks[currentFrame].length > 30) undoStacks[currentFrame].shift();
    redoStacks[currentFrame] = []; // making a new change clears redo history
    updateUndoButtons();
}

function undo() {
    const stack = undoStacks[currentFrame];
    if (!stack.length) return;
    redoStacks[currentFrame].push(canvas.toDataURL()); // save current to redo
    restoreCanvas(stack.pop()); // go back one step
    updateUndoButtons();
}

function redo() {
    const stack = redoStacks[currentFrame];
    if (!stack.length) return;
    undoStacks[currentFrame].push(canvas.toDataURL());
    restoreCanvas(stack.pop());
    updateUndoButtons();
}

function restoreCanvas(dataURL) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
        ctx.drawImage(img, 0, 0);
        frames[currentFrame] = canvas.toDataURL();
        updateThumbnail(currentFrame);
    };
    img.src = dataURL;
}

function updateUndoButtons() {
    document.getElementById("undoBtn").disabled = !undoStacks[currentFrame]?.length;
    document.getElementById("redoBtn").disabled = !redoStacks[currentFrame]?.length;
}


// ── 11. FRAMES ───────────────────────────────────────────────

// Save current canvas drawing as a data URL in the frames array
function save() {
    frames[currentFrame] = canvas.toDataURL();
}

// Load a specific frame onto the canvas
function loadFrame(index) {
    if (index !== currentFrame) save(); // save before leaving current frame
    currentFrame = index;

    if (!undoStacks[index]) undoStacks[index] = [];
    if (!redoStacks[index]) redoStacks[index] = [];

    clearSel();
    canvasWrapper.style.backgroundColor = bgColor;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    drawOnionSkin(); // show faint ghost of previous frame

    if (frames[index]) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src    = frames[index];
    }

    updateUndoButtons();
    updateTimelineHighlight();
}

// Show a faint ghost of the previous frame so you can trace over it
function drawOnionSkin() {
    onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
    if (!playing && currentFrame > 0 && frames[currentFrame - 1]) {
        const img = new Image();
        img.onload = () => {
            onionCtx.globalAlpha = 0.2; // very faint
            onionCtx.drawImage(img, 0, 0);
            onionCtx.globalAlpha = 1;
        };
        img.src = frames[currentFrame - 1];
    }
}

function addFrame() {
    save();
    frames.push(null);
    undoStacks.push([]); redoStacks.push([]);
    renderTimeline();
    loadFrame(frames.length - 1);
    setTimeout(() => frameContainer.scrollLeft = frameContainer.scrollWidth, 10);
}

function copyFrame() {
    save();
    frames.push(frames[currentFrame]); // duplicate the current frame's image
    undoStacks.push([]); redoStacks.push([]);
    renderTimeline();
    loadFrame(frames.length - 1);
    setTimeout(() => frameContainer.scrollLeft = frameContainer.scrollWidth, 10);
    toast("Frame duplicated!");
}

function clearFrame() {
    if (!confirm("Wipe this frame?")) return;
    pushUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    save(); updateThumbnail(currentFrame);
}


// ── 12. PLAYBACK ─────────────────────────────────────────────

function togglePlay() { playing ? stopPlay() : startPlay(); }

function startPlay() {
    if (frames.length < 2) { toast("Add more frames first!"); return; }
    save();
    playing = true;
    document.getElementById("play").textContent = "⏹ Stop";
    onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);

    let i = 0;
    playTimer = setInterval(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (frames[i]) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            img.src    = frames[i];
        }
        i = (i + 1) % frames.length; // loop back to first frame
    }, 1000 / speedSlider.value);
}

function stopPlay() {
    playing = false;
    clearInterval(playTimer);
    document.getElementById("play").textContent = "▶ Play";
    loadFrame(currentFrame);
}


// ── 13. DOWNLOAD AS GIF ──────────────────────────────────────
// Uses gif.js library (loaded via CDN in index.html) to encode a real GIF

function loadGifLibrary(src) {
    return new Promise((resolve, reject) => {
        if (typeof GIF !== 'undefined') return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.crossOrigin = 'anonymous';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load GIF library'));
        document.head.appendChild(script);
    });
}

function downloadGIF() {
    save(); // make sure last frame is saved first

    const btn = document.getElementById("downloadBtn");
    if (typeof GIF === 'undefined') {
        btn.disabled = true;
        btn.textContent = "⏳ Loading GIF lib...";
        loadGifLibrary('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js')
            .then(() => downloadGIF())
            .catch((err) => {
                btn.disabled = false;
                btn.textContent = "⬇ Download GIF";
                toast("Unable to load GIF exporter. Check your internet connection.");
                console.error(err);
            });
        return;
    }

    if (!frames.length) {
        toast("No frames available to export.");
        return;
    }

    btn.disabled    = true;
    btn.textContent = "⏳ Building...";
    toast("Exporting GIF, please wait...");

    const gif = new GIF({
        workers:      2,
        quality:      10,
        width:        canvas.width,
        height:       canvas.height,
        // The worker script does the heavy GIF encoding work in the background
        workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
    });

    const delay   = Math.round(1000 / speedSlider.value); // ms per frame
    let   loaded  = 0;

    // Add each frame to the GIF (with background color baked in)
    frames.forEach((frameData) => {
        const tmp  = document.createElement('canvas');
        tmp.width  = canvas.width;
        tmp.height = canvas.height;
        const tCtx = tmp.getContext('2d');

        // Draw background color first, then the frame drawing on top
        tCtx.fillStyle = bgColor;
        tCtx.fillRect(0, 0, tmp.width, tmp.height);

        const addAndCheck = () => {
            gif.addFrame(tmp, { delay, copy: true });
            loaded++;
            if (loaded === frames.length) gif.render(); // start encoding once all are added
        };

        if (frameData) {
            const img = new Image();
            img.onload = () => { tCtx.drawImage(img, 0, 0); addAndCheck(); };
            img.src    = frameData;
        } else {
            addAndCheck(); // blank frame — just background
        }
    });

    // When encoding is done, auto-download the GIF file
    gif.on('finished', (blob) => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href     = url;
        link.download = 'sketchmotion-animation.gif';
        link.click();
        URL.revokeObjectURL(url);

        btn.disabled    = false;
        btn.textContent = "⬇ Download GIF";
        toast("GIF saved!");
    });
}


// ── 14. TIMELINE ─────────────────────────────────────────────

function renderTimeline() {
    frameContainer.innerHTML = '';
    frames.forEach((_, i) => {
        const btn = document.createElement("div");
        btn.className = `frame-btn ${i === currentFrame ? 'selected' : ''}`;
        btn.title   = `Frame ${i + 1}`;
        btn.onclick = () => { if (!playing) loadFrame(i); };

        const thumb = document.createElement("canvas");
        thumb.width = 90; thumb.height = 60;
        btn.appendChild(thumb);

        const num = document.createElement("span");
        num.className   = 'frame-number';
        num.textContent = i + 1;
        btn.appendChild(num);

        frameContainer.appendChild(btn);
        updateThumbnail(i);
    });
}

function updateThumbnail(i) {
    const btn = frameContainer.children[i];
    if (!btn) return;
    const tCtx = btn.querySelector("canvas").getContext("2d");
    tCtx.fillStyle = bgColor;
    tCtx.fillRect(0, 0, 90, 60);
    if (frames[i]) {
        const img = new Image();
        img.onload = () => tCtx.drawImage(img, 0, 0, 90, 60);
        img.src    = frames[i];
    }
}

function updateTimelineHighlight() {
    Array.from(frameContainer.children).forEach((btn, i) => {
        btn.classList.toggle('selected', i === currentFrame);
    });
}


// ── 15. TOAST (small popup message) ──────────────────────────

function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.cssText = [
            'position:fixed','bottom:80px','left:50%','transform:translateX(-50%)',
            'background:#5865f2','color:#fff','padding:8px 18px','border-radius:6px',
            "font-family:'Syne',sans-serif",'font-size:13px','font-weight:600',
            'pointer-events:none','z-index:9999','transition:opacity 0.3s'
        ].join(';');
        document.body.appendChild(el);
    }
    el.textContent   = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => el.style.opacity = '0', 2500);
}


// ── GO! ───────────────────────────────────────────────────────
init();