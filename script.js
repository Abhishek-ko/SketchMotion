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

let img = new Image();

img.src = frames[index];

img.onload = function(){
ctx.drawImage(img,0,0);
};

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