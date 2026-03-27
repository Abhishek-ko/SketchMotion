const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let drawing = false;

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