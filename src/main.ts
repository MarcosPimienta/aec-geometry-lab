import { getGL, createProgram } from './webgl/gl';
import { VS, FS } from './webgl/shaders';
import { perspective, lookAt, identity, rotateY } from './webgl/camera';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = getGL(canvas);

// ---------- Resize & viewport ----------
function resize() {
  canvas.width  = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// ---------- Program & locations ----------
const program = createProgram(gl, VS, FS);
gl.useProgram(program);

const loc = {
  aPosition: gl.getAttribLocation(program, 'aPosition'),
  aNormal:   gl.getAttribLocation(program, 'aNormal'),
  uProj:     gl.getUniformLocation(program, 'uProj'),
  uView:     gl.getUniformLocation(program, 'uView'),
  uModel:    gl.getUniformLocation(program, 'uModel'),
  uMorph:    gl.getUniformLocation(program, 'uMorph'),
} as const;

// ---------- A simple indexed mesh: a unit cube ----------
const P = new Float32Array([
  // 8 vertices of a cube
  -1,-1,-1,   1,-1,-1,   1, 1,-1,  -1, 1,-1,   // back
  -1,-1, 1,   1,-1, 1,   1, 1, 1,  -1, 1, 1    // front
]);
const N = new Float32Array([
  // crude per-vertex normals (not perfect but fine for lambert demo)
  -1,-1,-1,   1,-1,-1,   1, 1,-1,  -1, 1,-1,
  -1,-1, 1,   1,-1, 1,   1, 1, 1,  -1, 1, 1
]);
const I = new Uint16Array([
  // 12 triangles (two per face)
  0,1,2,  0,2,3,  // back
  4,6,5,  4,7,6,  // front
  0,4,5,  0,5,1,  // bottom
  3,2,6,  3,6,7,  // top
  0,3,7,  0,7,4,  // left
  1,5,6,  1,6,2   // right
]);

// Buffers
const vboPos = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
gl.bufferData(gl.ARRAY_BUFFER, P, gl.STATIC_DRAW);

const vboNor = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vboNor);
gl.bufferData(gl.ARRAY_BUFFER, N, gl.STATIC_DRAW);

const ebo = gl.createBuffer()!;
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, I, gl.STATIC_DRAW);

// Attribute setup
gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
gl.enableVertexAttribArray(loc.aPosition);
gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);

gl.bindBuffer(gl.ARRAY_BUFFER, vboNor);
gl.enableVertexAttribArray(loc.aNormal);
gl.vertexAttribPointer(loc.aNormal, 3, gl.FLOAT, false, 0, 0);

// ---------- Camera & uniforms ----------
let morph = 0.0;
const morphInput = document.getElementById('morph') as HTMLInputElement;
const morphVal   = document.getElementById('morphVal')!;
morphInput.addEventListener('input', () => {
  morph = parseFloat(morphInput.value);
  morphVal.textContent = morph.toFixed(2);
});

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.12, 0.13, 0.17, 1);

// Projection & View (set once per frame)
function computeProj() {
  const aspect = canvas.width / canvas.height;
  return perspective(Math.PI/4, aspect, 0.01, 100);
}

function computeView(t:number) {
  // orbit camera around the origin
  const radius = 6.0;
  const eyeX = Math.cos(t*0.6) * radius;
  const eyeZ = Math.sin(t*0.6) * radius;
  return lookAt([eyeX, 3.5, eyeZ], [0,0,0], [0,1,0]);
}

// ---------- Animation loop ----------
const model = identity();
let t = 0;

function frame() {
  t += 0.016; // ~60 FPS step; you could use real deltaTime if you like

  const proj = computeProj();
  const view = computeView(t);

  // Optional: slowly spin model too
  rotateY(model, t * 0.5);

  gl.useProgram(program);
  gl.uniformMatrix4fv(loc.uProj,  false, proj);
  gl.uniformMatrix4fv(loc.uView,  false, view);
  gl.uniformMatrix4fv(loc.uModel, false, model);
  gl.uniform1f(loc.uMorph, morph);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.drawElements(gl.TRIANGLES, I.length, gl.UNSIGNED_SHORT, 0);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);