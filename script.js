const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const frameContainer = document.getElementById("frameContainer");
const bgColorPicker = document.getElementById("bgColorPicker");

let frames = [];
let currentFrame = 0;
let drawing = false;
let tool = 'pencil';
let playing = false;
let animationInterval;

// Initialize
function init() {
    frames.push(null);
    renderTimeline();
    loadFrame(0);
    setupListeners();
}

function setupListeners() {
    canvas.onmousedown = (e) => { if(!playing) { drawing = true; ctx.beginPath(); draw(e); } };
    canvas.onmousemove = draw;
    window.onmouseup = stopDrawing;

    document.getElementById("pencilBtn").onclick = () => setTool('pencil');
    document.getElementById("eraserBtn").onclick = () => setTool('eraser');
    document.getElementById("addFrame").onclick = addFrame;
    document.getElementById("play").onclick = togglePlay;
    document.getElementById("clearFrame").onclick = clearFrame;
    
    // Background Color Update
    bgColorPicker.oninput = (e) => {
        canvas.style.backgroundColor = e.target.value;
    };
    
    document.getElementById("speed").oninput = (e) => {
        document.getElementById("speedVal").innerText = e.target.value;
    };
}

function setTool(t) {
    tool = t;
    document.getElementById("pencilBtn").classList.toggle('active', t === 'pencil');
    document.getElementById("eraserBtn").classList.toggle('active', t === 'eraser');
}

function draw(e) {
    if (!drawing || playing) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.lineWidth = document.getElementById("sizeSlider").value;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = document.getElementById("colorPicker").value;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
}

function stopDrawing() {
    if (drawing) {
        drawing = false;
        saveFrame();
        updateThumbnail(currentFrame);
    }
}

function saveFrame() {
    frames[currentFrame] = canvas.toDataURL();
}

function loadFrame(index) {
    currentFrame = index;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Onion Skin
    if (index > 0 && frames[index - 1]) {
        const img = new Image();
        img.src = frames[index - 1];
        img.onload = () => {
            ctx.globalAlpha = 0.2;
            ctx.drawImage(img, 0, 0);
            ctx.globalAlpha = 1.0;
            drawActualContent(index);
        };
    } else {
        drawActualContent(index);
    }
    updateTimelineUI();
}

function drawActualContent(index) {
    if (frames[index]) {
        const img = new Image();
        img.src = frames[index];
        img.onload = () => ctx.drawImage(img, 0, 0);
    }
}

function addFrame() {
    saveFrame();
    frames.push(null);
    renderTimeline();
    loadFrame(frames.length - 1);
    frameContainer.scrollLeft = frameContainer.scrollWidth;
}

function renderTimeline() {
    frameContainer.innerHTML = '';
    frames.forEach((_, i) => {
        const btn = document.createElement("div");
        btn.className = `frame-btn ${i === currentFrame ? 'selected' : ''}`;
        const thumb = document.createElement("canvas");
        thumb.width = 90; thumb.height = 60;
        btn.appendChild(thumb);
        btn.onclick = () => loadFrame(i);
        frameContainer.appendChild(btn);
        updateThumbnail(i);
    });
}

function updateThumbnail(i) {
    const btn = frameContainer.children[i];
    if (!btn || !frames[i]) return;
    const thumbCtx = btn.querySelector("canvas").getContext("2d");
    const img = new Image();
    img.src = frames[i];
    img.onload = () => {
        thumbCtx.clearRect(0, 0, 90, 60);
        thumbCtx.fillStyle = bgColorPicker.value; // Preview the background color
        thumbCtx.fillRect(0,0,90,60);
        thumbCtx.drawImage(img, 0, 0, 90, 60);
    };
}

function updateTimelineUI() {
    Array.from(frameContainer.children).forEach((btn, i) => {
        btn.classList.toggle('selected', i === currentFrame);
    });
}

function clearFrame() {
    if(confirm("Wipe this frame?")) {
        ctx.clearRect(0,0,canvas.width, canvas.height);
        saveFrame();
        updateThumbnail(currentFrame);
    }
}

function togglePlay() {
    if (playing) {
        playing = false;
        clearInterval(animationInterval);
        document.getElementById("play").innerText = "▶ Play";
        loadFrame(currentFrame);
    } else {
        playing = true;
        document.getElementById("play").innerText = "⏹ Stop";
        let i = 0;
        const fps = document.getElementById("speed").value;
        animationInterval = setInterval(() => {
            ctx.clearRect(0,0,canvas.width, canvas.height);
            if (frames[i]) {
                const img = new Image();
                img.src = frames[i];
                img.onload = () => ctx.drawImage(img, 0, 0);
            }
            i = (i + 1) % frames.length;
        }, 1000 / fps);
    }
}

init();

function loadFrame(index) {
    saveFrame(); 
    currentFrame = index;
    
    // Clear the drawing surface
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Handle Onion Skin (Ghosting)
    if (index > 0 && frames[index - 1]) {
        // We use a linear gradient overlay to "wash out" the background image
        // The 'rgba(255,255,255,0.9)' acts like a piece of tracing paper over the ghost
        canvas.style.backgroundImage = `linear-gradient(rgba(255,255,255,0.85), rgba(255,255,255,0.85)), url(${frames[index - 1]})`;
        canvas.style.backgroundSize = 'cover';
    } else {
        canvas.style.backgroundImage = 'none';
    }

    // 2. Load the actual frame content
    if (frames[index]) {
        const img = new Image();
        img.src = frames[index];
        img.onload = () => {
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, 0, 0);
        };
    }
    
    updateTimelineUI();
}

function startAnimation() {
    playing = true;
    canvas.style.backgroundImage = 'none'; // Turn off onion skin during play
    // ... rest of your play logic
}