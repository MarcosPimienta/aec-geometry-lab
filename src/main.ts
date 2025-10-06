import { getGL, createProgram } from './webgl/gl';
import { VS, FS } from './webgl/shaders';
import { perspective, lookAt, identity, rotateY } from './webgl/camera';
import { uploadMesh, bindMesh, setColors, setLines } from './webgl/mesh';
import type { GLMesh } from './webgl/mesh';
import { loadOBJ } from './loaders/obj';
import type { Mesh } from './types';
import { buildHalfEdge, computeValences, buildWireframeIndices, buildValenceColors } from './geom/halfedge';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = getGL(canvas);

function resize(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; gl.viewport(0,0,canvas.width,canvas.height); }
window.addEventListener('resize', resize); resize();

const program = createProgram(gl, VS, FS);
gl.useProgram(program);

const loc = {
  uProj: gl.getUniformLocation(program, 'uProj'),
  uView: gl.getUniformLocation(program, 'uView'),
  uModel: gl.getUniformLocation(program, 'uModel'),
  uMorph: gl.getUniformLocation(program, 'uMorph'),
  uUseVertexColor: gl.getUniformLocation(program, 'uUseVertexColor'),
} as const;

gl.enable(gl.DEPTH_TEST);
gl.clearColor(0.12,0.13,0.17,1);

// ---- state ----
let morph = 0;
let t = 0;
const model = identity();

let gm: GLMesh | null = null;     // GPU mesh
let triMode = true;               // true => draw TRIANGLES, false => draw LINES
let colorMode = false;            // true => use per-vertex colors (valence)

// UI hooks already exist in your sidebar HTML:
const morphIn  = document.getElementById('morph') as HTMLInputElement | null;
const morphVal = document.getElementById('morphVal') as HTMLElement | null;
const wireCk   = document.getElementById('wire') as HTMLInputElement | null;
const valCk    = document.getElementById('valence') as HTMLInputElement | null;

morphIn?.addEventListener('input', () => {
  morph = parseFloat(morphIn.value);
  if (morphVal) morphVal.textContent = morph.toFixed(2);
});

wireCk?.addEventListener('change', () => {
  triMode = !wireCk!.checked ? true : false; // checked -> show wireframe (LINES)
});

valCk?.addEventListener('change', () => {
  colorMode = !!valCk!.checked;
});

// Camera fns
function proj(){ return perspective(Math.PI/4, canvas.width / canvas.height, 0.01, 100); }
function view(){
  const r=6.0; return lookAt([Math.cos(t*0.6)*r, 3.5, Math.sin(t*0.6)*r], [0,0,0], [0,1,0]);
}

// Draw loop
function frame(){
  t += 0.016;
  rotateY(model, t*0.3);

  gl.useProgram(program);
  gl.uniformMatrix4fv(loc.uProj, false, proj());
  gl.uniformMatrix4fv(loc.uView, false, view());
  gl.uniformMatrix4fv(loc.uModel, false, model);
  gl.uniform1f(loc.uMorph, morph);
  gl.uniform1i(loc.uUseVertexColor, colorMode ? 1 : 0);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  if (gm) {
    bindMesh(gl, program, gm);

    if (triMode) {
      // Fill triangles (default)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.ebo);
      gl.drawElements(gl.TRIANGLES, gm.triCount, gm.indexType, 0);
    } else {
      // Wireframe overlay: draw unique edges as GL_LINES
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.lbo!);
      gl.drawElements(gl.LINES, gm.lineCount, gm.indexType, 0);
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- OBJ loader ----------
const objInput = document.getElementById('objFile') as HTMLInputElement | null;
objInput?.addEventListener('change', async (e:any) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    // 1) Load mesh (positions, normals, indices, already normalized)
    const mesh: Mesh = await loadOBJ(file);

    // 2) Upload to GPU
    gm = uploadMesh(gl, mesh);

    // 3) Build half-edge from indices + compute valences
    const he = buildHalfEdge(mesh.indices, mesh.positions.length / 3);
    const valences = computeValences(he);

    // 4) Build and upload valence colors (RGB per vertex)
    const colors = buildValenceColors(valences);
    setColors(gl, gm, colors);        // this enables aColor attribute when colorMode=true

    // 5) Build and upload unique wireframe indices
    const lines = buildWireframeIndices(mesh.indices);
    setLines(gl, gm, lines);

    console.info('OBJ loaded. Verts:', mesh.positions.length/3, 'Tris:', mesh.indices.length/3);
  } catch (err) {
    console.error(err);
    alert('OBJ load failed (see console).');
  }
});