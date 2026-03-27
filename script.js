const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const frameContainer = document.getElementById("frameContainer");
const addFrameBtn = document.getElementById("addFrame");

let drawing = false;

let frames = [];
let currentFrame = 0;

canvas.addEventListener("mousedown", startDrawing);
canvas.addEventListener("mouseup", stopDrawing);
canvas.addEventListener("mousemove", draw);

function startDrawing(e){
drawing = true;
draw(e);
}

function stopDrawing(){
drawing = false;
ctx.beginPath();

saveFrame();
}

function draw(e){

if(!drawing) return;

ctx.lineWidth = 2;
ctx.lineCap = "round";
ctx.strokeStyle = "black";

ctx.lineTo(e.offsetX, e.offsetY);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(e.offsetX, e.offsetY);

}

function saveFrame(){

frames[currentFrame] = canvas.toDataURL();

}

function loadFrame(index){

ctx.clearRect(0,0,canvas.width,canvas.height);

if(index > 0 && frames[index-1]){

let prevImg = new Image();
prevImg.src = frames[index-1];

prevImg.onload = function(){

ctx.globalAlpha = 0.2;   // faint previous frame
ctx.drawImage(prevImg,0,0);

ctx.globalAlpha = 1.0;

if(frames[index]){
let img = new Image();
img.src = frames[index];

img.onload = function(){
ctx.drawImage(img,0,0);
};
}

};

}else{

if(frames[index]){
let img = new Image();
img.src = frames[index];

img.onload = function(){
ctx.drawImage(img,0,0);
};
}

}

}

function createFrameButton(index){

const btn = document.createElement("button");

btn.innerText = index + 1;

btn.onclick = function(){

saveFrame();

currentFrame = index;

loadFrame(index);

};

frameContainer.appendChild(btn);

}

addFrameBtn.onclick = function(){

saveFrame();

frames.push(null);

createFrameButton(frames.length - 1);

};

frames.push(null);
createFrameButton(0);
const playBtn = document.getElementById("play");

let playing = false;
let animationInterval;

playBtn.onclick = function(){

if(!playing){

playing = true;

let frameIndex = 0;

animationInterval = setInterval(function(){

if(frames.length === 0) return;

ctx.clearRect(0,0,canvas.width,canvas.height);

let img = new Image();
img.src = frames[frameIndex];

img.onload = function(){
ctx.drawImage(img,0,0);
};

frameIndex++;

if(frameIndex >= frames.length){
frameIndex = 0;
}

},150);

playBtn.innerText = "⏹ Stop";

}else{

playing = false;

clearInterval(animationInterval);

playBtn.innerText = "▶ Play";

loadFrame(currentFrame);

}

};