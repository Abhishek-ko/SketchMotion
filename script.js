
// ── 1. GET CANVAS ELEMENTS ───────────────────────────────────

const canvas      = document.getElementById("canvas");
const onionCanvas = document.getElementById("onionCanvas");
const selCanvas   = document.getElementById("selCanvas");
const ctx         = canvas.getContext("2d");
const onionCtx    = onionCanvas.getContext("2d");
const selCtx      = selCanvas.getContext("2d");
const wrapper     = document.getElementById("canvasWrapper");
const frameContainer = document.getElementById("frameContainer");


// ── 2. APP STATE ─────────────────────────────────────────────

let frames       = [null];   // each frame stored as a data URL (null = blank)
let currentFrame = 0;
let tool         = "pencil"; // pencil | eraser | fill | select
let drawing      = false;
let playing      = false;
let playTimer    = null;
let bgColor      = "#ffffff";

let undoStacks = [[]];  // one undo history list per frame
let redoStacks = [[]];

// Selection state
let sel = {
    active: false, dragging: false, moving: false,
    x1: 0, y1: 0, x2: 0, y2: 0,
    data: null, offX: 0, offY: 0
};
let clipboard  = null;
let marchTimer = null;


// ── 3. INIT ──────────────────────────────────────────────────

function init() {
    wrapper.style.backgroundColor = bgColor;
    renderTimeline();
    loadFrame(0);
    setupListeners();
    updateUndoButtons();
}


// ── 4. WIRE UP ALL BUTTONS ───────────────────────────────────

function setupListeners() {
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup",   onMouseUp);

    document.getElementById("pencilBtn").onclick = () => setTool("pencil");
    document.getElementById("eraserBtn").onclick = () => setTool("eraser");
    document.getElementById("fillBtn").onclick   = () => setTool("fill");
    document.getElementById("selectBtn").onclick = () => setTool("select");

    document.getElementById("addFrame").onclick   = addFrame;
    document.getElementById("copyFrame").onclick  = copyFrame;
    document.getElementById("clearFrame").onclick = clearFrame;
    document.getElementById("play").onclick       = togglePlay;
    document.getElementById("undoBtn").onclick    = undo;
    document.getElementById("redoBtn").onclick    = redo;
    document.getElementById("copySelBtn").onclick   = copySelection;
    document.getElementById("pasteSelBtn").onclick  = pasteSelection;
    document.getElementById("deleteSelBtn").onclick = deleteSelection;
    document.getElementById("downloadBtn").onclick  = downloadGIF;

    document.getElementById("sizeSlider").oninput = e =>
        document.getElementById("sizeVal").textContent = e.target.value;
    document.getElementById("speed").oninput = e =>
        document.getElementById("speedVal").textContent = e.target.value;

    document.getElementById("bgColorPicker").oninput = e => {
        bgColor = e.target.value;
        wrapper.style.backgroundColor = bgColor;
        drawOnionSkin();
        frames.forEach((_, i) => updateThumbnail(i));
    };

    window.addEventListener("keydown", e => {
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key === "z") { e.preventDefault(); undo(); }
        if (ctrl && e.key === "y") { e.preventDefault(); redo(); }
        if (ctrl && e.key === "c") { e.preventDefault(); copySelection(); }
        if (ctrl && e.key === "v") { e.preventDefault(); pasteSelection(); }
        if (e.key === "Escape") clearSel();
    });
}


// ── 5. TOOL SWITCHING ────────────────────────────────────────

function setTool(t) {
    if (tool === "select" && t !== "select") clearSel();
    tool = t;
    ["pencilBtn","eraserBtn","fillBtn","selectBtn"].forEach(id =>
        document.getElementById(id).classList.remove("active"));
    const ids = { pencil:"pencilBtn", eraser:"eraserBtn", fill:"fillBtn", select:"selectBtn" };
    document.getElementById(ids[t]).classList.add("active");
    document.getElementById("selectionToolbar").classList.toggle("hidden", t !== "select");
    canvas.style.cursor = "crosshair";
}


// ── 6. MOUSE EVENTS ──────────────────────────────────────────

function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
}

function onMouseDown(e) {
    if (playing) return;
    const pos = getPos(e);

    if (tool === "fill") {
        pushUndo();
        floodFill(pos.x, pos.y, document.getElementById("colorPicker").value);
        save(); updateThumbnail(currentFrame);
        return;
    }

    if (tool === "select") {
        if (sel.active && insideSel(pos.x, pos.y)) {
            sel.moving = true;
            const r = getSelRect();
            sel.offX = pos.x - r.x; sel.offY = pos.y - r.y;
            ctx.clearRect(r.x, r.y, r.w, r.h);
        } else {
            clearSel();
            sel.dragging = true;
            sel.x1 = sel.x2 = pos.x;
            sel.y1 = sel.y2 = pos.y;
        }
        return;
    }

    drawing = true;
    pushUndo();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
}

function onMouseMove(e) {
    if (playing) return;
    const pos = getPos(e);

    if (tool === "select") {
        if (sel.dragging) { sel.x2 = pos.x; sel.y2 = pos.y; drawSelBox(); }
        else if (sel.moving) { moveSel(pos); }
        else canvas.style.cursor = (sel.active && insideSel(pos.x, pos.y)) ? "move" : "crosshair";
        return;
    }

    if (drawing) drawStroke(pos.x, pos.y);
}

function onMouseUp() {
    if (playing) return;
    if (tool === "select") {
        if (sel.dragging) { sel.dragging = false; finalizeSel(); }
        if (sel.moving)   { sel.moving   = false; save(); updateThumbnail(currentFrame); }
        return;
    }
    if (drawing) { drawing = false; save(); updateThumbnail(currentFrame); }
}


// ── 7. DRAWING ───────────────────────────────────────────────

function drawStroke(x, y) {
    ctx.lineWidth = document.getElementById("sizeSlider").value;
    ctx.lineCap   = "round";
    ctx.lineJoin  = "round";
    if (tool === "eraser") {
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = document.getElementById("colorPicker").value;
    }
    ctx.lineTo(x, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y);
}


// ── 8. FLOOD FILL ────────────────────────────────────────────

function floodFill(startX, startY, fillHex) {
    const W = canvas.width, H = canvas.height;
    const tmp = document.createElement("canvas");
    tmp.width = W; tmp.height = H;
    const tCtx = tmp.getContext("2d");
    tCtx.fillStyle = bgColor;
    tCtx.fillRect(0, 0, W, H);
    tCtx.drawImage(canvas, 0, 0);

    const imgData = tCtx.getImageData(0, 0, W, H);
    const px = imgData.data;
    const fill = hexToRgb(fillHex);
    const si = (startY * W + startX) * 4;
    const target = [px[si], px[si+1], px[si+2], px[si+3]];
    if (colorClose(px, si, fill)) return;

    const queue = [[startX, startY]];
    const seen = new Uint8Array(W * H);
    while (queue.length) {
        const [x, y] = queue.pop();
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const i = (y * W + x) * 4;
        if (seen[y*W+x] || !colorClose(px, i, target)) continue;
        seen[y*W+x] = 1;
        px[i] = fill[0]; px[i+1] = fill[1]; px[i+2] = fill[2]; px[i+3] = 255;
        queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
    }
    tCtx.putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tmp, 0, 0);
}

function hexToRgb(hex) {
    return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function colorClose(px, i, color, tol = 15) {
    return Math.abs(px[i]-color[0]) <= tol && Math.abs(px[i+1]-color[1]) <= tol && Math.abs(px[i+2]-color[2]) <= tol;
}


// ── 9. SELECTION ─────────────────────────────────────────────

function getSelRect() {
    return { x: Math.min(sel.x1,sel.x2), y: Math.min(sel.y1,sel.y2),
             w: Math.abs(sel.x2-sel.x1), h: Math.abs(sel.y2-sel.y1) };
}

function insideSel(x, y) {
    if (!sel.active) return false;
    const r = getSelRect();
    return x >= r.x && x <= r.x+r.w && y >= r.y && y <= r.y+r.h;
}

function drawSelBox() {
    selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
    const r = getSelRect();
    if (r.w < 2 || r.h < 2) return;
    selCtx.save();
    selCtx.strokeStyle = "#5865f2"; selCtx.lineWidth = 1.5;
    selCtx.setLineDash([5,3]); selCtx.lineDashOffset = -(Date.now()/60 % 8);
    selCtx.strokeRect(r.x+0.5, r.y+0.5, r.w, r.h);
    selCtx.fillStyle = "rgba(88,101,242,0.07)"; selCtx.fillRect(r.x, r.y, r.w, r.h);
    selCtx.restore();
}

function finalizeSel() {
    const r = getSelRect();
    if (r.w < 4 || r.h < 4) { clearSel(); return; }
    sel.active = true;
    sel.data = ctx.getImageData(r.x, r.y, r.w, r.h);
    clearInterval(marchTimer);
    marchTimer = setInterval(() => { if (sel.active) drawSelBox(); }, 60);
}

function moveSel(pos) {
    if (!sel.data) return;
    const r = getSelRect();
    const nx = pos.x - sel.offX, ny = pos.y - sel.offY;
    ctx.clearRect(r.x, r.y, r.w, r.h);
    const tmp = document.createElement("canvas");
    tmp.width = r.w; tmp.height = r.h;
    tmp.getContext("2d").putImageData(sel.data, 0, 0);
    ctx.drawImage(tmp, nx, ny);
    sel.x1=nx; sel.y1=ny; sel.x2=nx+r.w; sel.y2=ny+r.h;
    drawSelBox();
}

function clearSel() {
    sel.active = sel.dragging = sel.moving = false; sel.data = null;
    clearInterval(marchTimer);
    selCtx.clearRect(0, 0, selCanvas.width, selCanvas.height);
}

function copySelection() {
    if (!sel.active || !sel.data) return;
    clipboard = { data: sel.data, w: sel.data.width, h: sel.data.height };
    toast("Copied!");
}

function pasteSelection() {
    if (!clipboard) return;
    pushUndo(); clearSel();
    const px = Math.round((canvas.width  - clipboard.w) / 2);
    const py = Math.round((canvas.height - clipboard.h) / 2);
    const tmp = document.createElement("canvas");
    tmp.width = clipboard.w; tmp.height = clipboard.h;
    tmp.getContext("2d").putImageData(clipboard.data, 0, 0);
    ctx.drawImage(tmp, px, py);
    sel.x1=px; sel.y1=py; sel.x2=px+clipboard.w; sel.y2=py+clipboard.h;
    sel.active=true; sel.data=clipboard.data;
    setTool("select"); drawSelBox();
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
    undoStacks[currentFrame].push(canvas.toDataURL());
    if (undoStacks[currentFrame].length > 30) undoStacks[currentFrame].shift();
    redoStacks[currentFrame] = [];
    updateUndoButtons();
}

function undo() {
    const stack = undoStacks[currentFrame];
    if (!stack.length) return;
    redoStacks[currentFrame].push(canvas.toDataURL());
    restoreCanvas(stack.pop());
}

function redo() {
    const stack = redoStacks[currentFrame];
    if (!stack.length) return;
    undoStacks[currentFrame].push(canvas.toDataURL());
    restoreCanvas(stack.pop());
}

function restoreCanvas(dataURL) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0); frames[currentFrame] = canvas.toDataURL(); updateThumbnail(currentFrame); };
    img.src = dataURL;
    updateUndoButtons();
}

function updateUndoButtons() {
    document.getElementById("undoBtn").disabled = !undoStacks[currentFrame]?.length;
    document.getElementById("redoBtn").disabled = !redoStacks[currentFrame]?.length;
}


// ── 11. FRAMES ───────────────────────────────────────────────

function save() { frames[currentFrame] = canvas.toDataURL(); }

function loadFrame(index) {
    if (index !== currentFrame) save();
    currentFrame = index;
    if (!undoStacks[index]) undoStacks[index] = [];
    if (!redoStacks[index]) redoStacks[index] = [];
    clearSel();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    drawOnionSkin();
    if (frames[index]) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0);
        img.src = frames[index];
    }
    updateUndoButtons();
    updateTimelineHighlight();
}

function drawOnionSkin() {
    onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
    if (!playing && currentFrame > 0 && frames[currentFrame-1]) {
        const img = new Image();
        img.onload = () => { onionCtx.globalAlpha=0.2; onionCtx.drawImage(img,0,0); onionCtx.globalAlpha=1; };
        img.src = frames[currentFrame-1];
    }
}

function addFrame() {
    save(); frames.push(null); undoStacks.push([]); redoStacks.push([]);
    renderTimeline(); loadFrame(frames.length - 1);
    setTimeout(() => frameContainer.scrollLeft = frameContainer.scrollWidth, 10);
}

function copyFrame() {
    save(); frames.push(frames[currentFrame]); undoStacks.push([]); redoStacks.push([]);
    renderTimeline(); loadFrame(frames.length - 1);
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
    save(); playing = true;
    document.getElementById("play").textContent = "⏹ Stop";
    onionCtx.clearRect(0, 0, onionCanvas.width, onionCanvas.height);
    let i = 0;
    playTimer = setInterval(() => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (frames[i]) {
            const img = new Image();
            img.onload = () => ctx.drawImage(img, 0, 0);
            img.src = frames[i];
        }
        i = (i + 1) % frames.length;
    }, 1000 / document.getElementById("speed").value);
}

function stopPlay() {
    playing = false; clearInterval(playTimer);
    document.getElementById("play").textContent = "▶ Play";
    loadFrame(currentFrame);
}


// ── 13. TIMELINE ─────────────────────────────────────────────

function renderTimeline() {
    frameContainer.innerHTML = "";
    frames.forEach((_, i) => {
        const btn = document.createElement("div");
        btn.className = `frame-btn ${i === currentFrame ? "selected" : ""}`;
        btn.onclick = () => { if (!playing) loadFrame(i); };

        const thumb = document.createElement("canvas");
        thumb.width = 90; thumb.height = 60;
        btn.appendChild(thumb);

        const num = document.createElement("span");
        num.className = "frame-number";
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
    tCtx.fillStyle = bgColor; tCtx.fillRect(0, 0, 90, 60);
    if (frames[i]) {
        const img = new Image();
        img.onload = () => tCtx.drawImage(img, 0, 0, 90, 60);
        img.src = frames[i];
    }
}

function updateTimelineHighlight() {
    Array.from(frameContainer.children).forEach((btn, i) =>
        btn.classList.toggle("selected", i === currentFrame));
}


// ── 14. TOAST ────────────────────────────────────────────────

const toastEl = document.createElement("div");
toastEl.id = "toast";
document.body.appendChild(toastEl);

function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.opacity = "1";
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.style.opacity = "0", 2500);
}


// ── 15. GIF ENCODER (100% built-in, zero dependencies) ───────
//
// This encodes a real animated GIF89a file entirely in JavaScript.
// No CDN, no Web Workers, no internet needed — it all runs right here.
//
// How it works in plain English:
//   1. We collect all the colors used across every frame
//   2. We pick the 256 most common colors to form a "palette"
//   3. For each frame, every pixel gets replaced with its palette index number
//   4. We compress those numbers using LZW compression (the same method ZIP uses)
//   5. We pack everything into a GIF file and offer it as a download

async function downloadGIF() {
    save();
    const btn = document.getElementById("downloadBtn");
    btn.disabled = true;
    btn.textContent = "⏳ Building...";
    toast("Exporting GIF…");

    const W = canvas.width, H = canvas.height;
    const delayCs = Math.round(100 / document.getElementById("speed").value); // centiseconds

    try {
        // Step 1: Render every frame onto a flat canvas (bg color + drawing)
        const pixelFrames = await Promise.all(frames.map(frameData =>
            new Promise(resolve => {
                const tmp = document.createElement("canvas");
                tmp.width = W; tmp.height = H;
                const tCtx = tmp.getContext("2d");
                tCtx.fillStyle = bgColor;
                tCtx.fillRect(0, 0, W, H);
                if (frameData) {
                    const img = new Image();
                    img.onload = () => { tCtx.drawImage(img, 0, 0); resolve(tCtx.getImageData(0,0,W,H).data); };
                    img.src = frameData;
                } else {
                    resolve(tCtx.getImageData(0, 0, W, H).data);
                }
            })
        ));

        // Step 2: Build a 256-color palette from all frames
        // We quantize each color to 5 bits per channel (32 levels) to group similar colors
        const colorFreq = new Map();
        for (const px of pixelFrames) {
            for (let i = 0; i < px.length; i += 4) {
                const key = ((px[i] >> 3) << 10) | ((px[i+1] >> 3) << 5) | (px[i+2] >> 3);
                colorFreq.set(key, (colorFreq.get(key) || 0) + 1);
            }
        }

        // Sort by frequency, take top 256
        const palette = [...colorFreq.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 256)
            .map(([key]) => [(key >> 10) << 3, ((key >> 5) & 31) << 3, (key & 31) << 3]);

        while (palette.length < 256) palette.push([0, 0, 0]);

        // Step 3: Build the GIF binary data
        const gifBytes = encodeGIF(pixelFrames, palette, W, H, delayCs);

        // Step 4: Download it
        const blob = new Blob([gifBytes], { type: "image/gif" });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href = url; a.download = "sketchmotion.gif"; a.click();
        URL.revokeObjectURL(url);
        toast("GIF saved! 🎉");
    } catch (err) {
        console.error("GIF export error:", err);
        toast("Export failed: " + err.message);
    }

    btn.disabled = false;
    btn.textContent = "⬇ Download GIF";
}


// Assembles the full GIF89a binary from pixel data
function encodeGIF(pixelFrames, palette, W, H, delayCs) {
    const out = []; // output bytes
    const b  = v  => out.push(v & 0xFF);
    const w  = v  => { b(v); b(v >> 8); };               // little-endian 2-byte word
    const str = s => { for (let i=0; i<s.length; i++) b(s.charCodeAt(i)); };

    // ── GIF Header ──
    str("GIF89a");
    w(W); w(H);
    b(0xF7); // flags: global color table present, 8bpp = 256 colors
    b(0);    // background color index
    b(0);    // pixel aspect ratio (0 = square)

    // Global color table (256 × 3 bytes)
    for (const [r, g, bb] of palette) { b(r); b(g); b(bb); }

    // Netscape extension — makes the GIF loop forever
    str("\x21\xFF\x0B"); str("NETSCAPE2.0");
    b(3); b(1); w(0); b(0);

    // ── One block per frame ──
    for (const px of pixelFrames) {
        // Map each pixel to the index of its closest palette color
        const indices = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) {
            const r = px[i*4] >> 3, g = px[i*4+1] >> 3, bb = px[i*4+2] >> 3;
            let best = 0, bestDist = Infinity;
            for (let j = 0; j < palette.length; j++) {
                const d = (r - (palette[j][0]>>3))**2 +
                          (g - (palette[j][1]>>3))**2 +
                          (bb- (palette[j][2]>>3))**2;
                if (d < bestDist) { bestDist = d; best = j; if (d === 0) break; }
            }
            indices[i] = best;
        }

        // Graphic Control Extension (sets delay between frames)
        str("\x21\xF9\x04"); b(0); w(delayCs); b(0); b(0);

        // Image Descriptor (position and size of this frame)
        b(0x2C); w(0); w(0); w(W); w(H); b(0);

        // Compressed pixel data (LZW)
        b(8); // minimum LZW code size
        const compressed = lzwCompress(indices, 8);
        // Write in chunks of max 255 bytes (GIF sub-block format)
        for (let pos = 0; pos < compressed.length; pos += 255) {
            const chunk = compressed.slice(pos, pos + 255);
            b(chunk.length);
            for (const byte of chunk) b(byte);
        }
        b(0); // end of sub-blocks
    }

    b(0x3B); // GIF trailer — marks end of file
    return new Uint8Array(out);
}


// LZW compression — packs repeated sequences of palette indices into fewer bytes
// This is the same compression method used in GIF since 1987
function lzwCompress(pixels, minCodeSize) {
    const clearCode = 1 << minCodeSize; // special "reset" signal
    const eofCode   = clearCode + 1;    // special "end of data" signal
    let codeSize    = minCodeSize + 1;
    let nextCode    = eofCode + 1;

    const bits = []; // output as individual bits (we'll pack into bytes at the end)

    function writeBits(code) {
        for (let i = 0; i < codeSize; i++) bits.push((code >> i) & 1);
    }

    // The LZW dictionary maps pixel sequences → code numbers
    let dict = new Map();
    function resetDict() {
        dict.clear();
        for (let i = 0; i < clearCode; i++) dict.set("" + i, i);
        codeSize = minCodeSize + 1;
        nextCode = eofCode + 1;
    }

    resetDict();
    writeBits(clearCode); // GIF always starts with a clear code

    let seq = "" + pixels[0]; // current sequence we're building up

    for (let i = 1; i < pixels.length; i++) {
        const next = seq + "," + pixels[i];
        if (dict.has(next)) {
            seq = next; // sequence is in dictionary, keep growing it
        } else {
            writeBits(dict.get(seq)); // output code for current sequence
            if (nextCode < 4096) {
                dict.set(next, nextCode++);           // add new sequence to dict
                if (nextCode > (1 << codeSize)) codeSize++; // grow code size when needed
            } else {
                writeBits(clearCode); resetDict();    // dict full, reset it
            }
            seq = "" + pixels[i];
        }
    }
    writeBits(dict.get(seq)); // output final sequence
    writeBits(eofCode);       // signal end of data

    // Pack bits into bytes (8 bits per byte, LSB first)
    const bytes = [];
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8 && i+j < bits.length; j++) byte |= bits[i+j] << j;
        bytes.push(byte);
    }
    return bytes;
}


// ── GO! ───────────────────────────────────────────────────────
init();