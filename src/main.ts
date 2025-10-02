import { getGL, createProgram } from './webgl/gl';
import { VS, FS } from './webgl/shaders';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = getGL(canvas);

// Ensure the canvas' internal pixel size matches its CSS size
function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// Compile + link shaders into a program and start using it
const program = createProgram(gl, VS, FS);
gl.useProgram(program);

// -------- Vertex Data (a triangle) --------
// Clip-space positions for 3 vertices (x, y)
const positions = new Float32Array([
  0.0,  0.8,   // top
 -0.8, -0.6,   // bottom-left
  0.8, -0.6    // bottom-right
]);

// One float "color index" per vertex (0, 1, 2)
const colorIdx = new Float32Array([0, 1, 2]);

// Create & fill GPU buffers
const posBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const colBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
gl.bufferData(gl.ARRAY_BUFFER, colorIdx, gl.STATIC_DRAW);

// Look up attribute locations in the linked program
const locPos = gl.getAttribLocation(program, 'aPosition');
const locCol = gl.getAttribLocation(program, 'aColorIdx');

// Enable and describe how to read each attribute
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.enableVertexAttribArray(locPos);
gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
gl.enableVertexAttribArray(locCol);
gl.vertexAttribPointer(locCol, 1, gl.FLOAT, false, 0, 0);

// Some niceties: background color and clearing
gl.clearColor(0.12, 0.13, 0.17, 1.0);

// Draw once (no loop needed for a static triangle)
gl.clear(gl.COLOR_BUFFER_BIT);
gl.drawArrays(gl.TRIANGLES, 0, 3);