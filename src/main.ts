import { getGL, createProgram } from './webgl/gl';
import { VS, FS } from './webgl/shaders';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = getGL(canvas);

// 1) match pixel buffer to CSS size, and set viewport
function resize(){
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0,0,canvas.width,canvas.height);
}
window.addEventListener('resize', resize);
resize();

// 2) compile/link and use the program
const program = createProgram(gl, VS, FS);
gl.useProgram(program);

// 3) vertex data
const positions = new Float32Array([
  0.0,  0.8,
  -0.8, -0.6,
  0.8, -0.6
]);
const colorIdx = new Float32Array([0,1,2]);

// 4) create buffers and upload
const posBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

const colBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
gl.bufferData(gl.ARRAY_BUFFER, colorIdx, gl.STATIC_DRAW);

// 5) locate and enable attributes
const locPos = gl.getAttribLocation(program, 'aPosition');
const locCol = gl.getAttribLocation(program, 'aColorIdx');

gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
gl.enableVertexAttribArray(locPos);
gl.vertexAttribPointer(locPos, 2, gl.FLOAT, false, 0, 0);

gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
gl.enableVertexAttribArray(locCol);
gl.vertexAttribPointer(locCol, 1, gl.FLOAT, false, 0, 0);

// 6) clear & draw
gl.clearColor(0.12,0.13,0.17,1.0);
gl.clear(gl.COLOR_BUFFER_BIT);
gl.drawArrays(gl.TRIANGLES, 0, 3);

// 7) sanity: surface errors early
const err = gl.getError();
if(err !== gl.NO_ERROR) console.error('WebGL error code:', err);