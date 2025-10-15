// src/main.ts

// ──────────────────────────────────────────────────────────────
// Core imports
// ──────────────────────────────────────────────────────────────
import { getGL, createProgram } from './webgl/gl';
import { VS, FS } from './webgl/shaders';
import { perspective, lookAt, identity, rotateY } from './webgl/camera';
import { uploadMesh, bindMesh, setColors, setLines } from './webgl/mesh';
import type { GLMesh } from './webgl/mesh';
import { loadOBJ } from './loaders/obj';
import type { Mesh } from './types';

// Topology & vis helpers
import {
  buildHalfEdge,
  computeValences,
  buildWireframeIndices,
  buildValenceColors,
} from './geom/halfedge';

// IFC loaders
import { loadIFCviaThree } from './loaders/ifc_three';            // tessellate + merge (geometry)
import { loadIFC as loadIFCcore, closeIFC } from './loaders/ifc'; // properties-only (no geometry)

// ──────────────────────────────────────────────────────────────
// Canvas + GL init
// ──────────────────────────────────────────────────────────────
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = getGL(canvas);

function resize() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  gl.viewport(0, 0, canvas.width, canvas.height);
}
function logCanvasSize(where: string) {
  console.info(`[canvas] ${where}`, {
    client: [canvas.clientWidth, canvas.clientHeight],
    backing: [canvas.width, canvas.height],
  });
}
window.addEventListener('resize', () => { resize(); logCanvasSize('resize'); });
resize();
logCanvasSize('init');

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
gl.clearColor(0.12, 0.13, 0.17, 1);

// ──────────────────────────────────────────────────────────────
/** App state */
// ──────────────────────────────────────────────────────────────
let morph = 0;
let t = 0;
const model = identity();

let gm: GLMesh | null = null; // current GPU mesh
let triMode = true;           // TRIANGLES vs LINES
let colorMode = false;        // per-vertex color heatmap

// ──────────────────────────────────────────────────────────────
/** UI */
// ──────────────────────────────────────────────────────────────
const morphIn  = document.getElementById('morph') as HTMLInputElement | null;
const morphVal = document.getElementById('morphVal') as HTMLElement | null;
const wireCk   = document.getElementById('wire') as HTMLInputElement | null;
const valCk    = document.getElementById('valence') as HTMLInputElement | null;

morphIn?.addEventListener('input', () => {
  morph = parseFloat(morphIn.value);
  if (morphVal) morphVal.textContent = morph.toFixed(2);
});
wireCk?.addEventListener('change', () => { triMode = !wireCk!.checked; });
valCk?.addEventListener('change', () => { colorMode = !!valCk!.checked; });

// ──────────────────────────────────────────────────────────────
/** Camera */
// ──────────────────────────────────────────────────────────────
function proj() {
  return perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, 100);
}
function view() {
  const r = 6.0;
  return lookAt([Math.cos(t * 0.6) * r, 3.5, Math.sin(t * 0.6) * r], [0, 0, 0], [0, 1, 0]);
}

// ──────────────────────────────────────────────────────────────
/** Debug: press "D" for a known-good cube */
// ──────────────────────────────────────────────────────────────
function debugCube(): Mesh {
  const p = new Float32Array([
    -0.5,-0.5,-0.5,  0.5,-0.5,-0.5,  0.5, 0.5,-0.5, -0.5, 0.5,-0.5,
    -0.5,-0.5, 0.5,  0.5,-0.5, 0.5,  0.5, 0.5, 0.5, -0.5, 0.5, 0.5
  ]);
  const idx = new Uint32Array([
    0,1,2, 0,2,3,  4,6,5, 4,7,6,  0,4,5, 0,5,1,
    3,2,6, 3,6,7,  0,3,7, 0,7,4,  1,5,6, 1,6,2
  ]);
  return { positions: p, normals: new Float32Array(p.length), indices: idx };
}
let DEBUG_FORCE_CUBE = false;
window.addEventListener('keydown', (ev) => {
  if (ev.key.toLowerCase() === 'd') {
    DEBUG_FORCE_CUBE = !DEBUG_FORCE_CUBE;
    console.info('DEBUG_FORCE_CUBE =', DEBUG_FORCE_CUBE);
    if (DEBUG_FORCE_CUBE) {
      const cube = debugCube();
      cube.normals = recomputeNormalsCPU(cube.positions, cube.indices as Uint32Array);
      gm = uploadMesh(gl, cube);
      setLines(gl, gm, buildWireframeIndices(cube.indices));
      setColors(gl, gm, new Float32Array(cube.positions.length)); // unused unless Valence on
      console.info('DEBUG cube uploaded:', { tri: (cube.indices.length / 3) | 0 });
    }
  }
});

// ──────────────────────────────────────────────────────────────
/** Render loop */
// ──────────────────────────────────────────────────────────────
function frame() {
  t += 0.016;
  rotateY(model, t * 0.3);

  const P = proj(), V = view();
  if (!isFinite(P[0]) || !isFinite(V[0])) console.error('Matrix NaN/Inf', { P, V });

  gl.useProgram(program);
  gl.uniformMatrix4fv(loc.uProj, false, P);
  gl.uniformMatrix4fv(loc.uView, false, V);
  gl.uniformMatrix4fv(loc.uModel, false, model);
  gl.uniform1f(loc.uMorph, morph);
  gl.uniform1i(loc.uUseVertexColor, colorMode ? 1 : 0);

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const err = gl.getError();
  if (err) console.warn('gl.getError() =', err);

  if (gm) {
    bindMesh(gl, program, gm);
    if (triMode) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.ebo);
      if (gm.triCount === 0) console.warn('triCount=0');
      gl.drawElements(gl.TRIANGLES, gm.triCount, gm.indexType, 0);
    } else if (gm.lbo) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.lbo);
      if (gm.lineCount === 0) console.warn('lineCount=0');
      gl.drawElements(gl.LINES, gm.lineCount, gm.indexType, 0);
    }
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ──────────────────────────────────────────────────────────────
/** Utilities (visibility + safety) */
// ──────────────────────────────────────────────────────────────
function placeholderQuad(): Mesh {
  const positions = new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]);
  const normals   = new Float32Array([ 0, 0,1, 0, 0,1, 0,0,1,  0,0,1]);
  const indices   = new Uint32Array([0,1,2, 0,2,3]);
  return { positions, normals, indices };
}
function coercePositionsToTriples(P: Float32Array): Float32Array {
  const n = Math.floor(P.length / 3) * 3;
  if (n === P.length) return P;
  console.warn('Truncating positions to multiple of 3:', P.length, '->', n);
  return new Float32Array(P.buffer, P.byteOffset, n);
}
function normalizePositions(positions: Float32Array): { positions: Float32Array; center:[number,number,number]; scale:number } {
  const n = positions.length / 3; if (!n) return { positions, center:[0,0,0], scale:1 };
  let minX=+Infinity,minY=+Infinity,minZ=+Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i=0;i<positions.length;i+=3){ const x=positions[i],y=positions[i+1],z=positions[i+2];
    if (x<minX)minX=x; if (y<minY)minY=y; if (z<minZ)minZ=z;
    if (x>maxX)maxX=x; if (y>maxY)maxY=y; if (z>maxZ)maxZ=z;
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  const diag=Math.hypot(maxX-minX,maxY-minY,maxZ-minZ)||1; const scale=2.0/diag;
  const out=new Float32Array(positions.length);
  for (let i=0;i<positions.length;i+=3){ out[i]=(positions[i]-cx)*scale; out[i+1]=(positions[i+1]-cy)*scale; out[i+2]=(positions[i+2]-cz)*scale; }
  return { positions: out, center:[cx,cy,cz], scale };
}
function recomputeNormalsCPU(positions: Float32Array, indices: Uint32Array): Float32Array {
  const N = new Float32Array(positions.length);
  for (let i=0;i<indices.length;i+=3){
    const i0=indices[i]*3, i1=indices[i+1]*3, i2=indices[i+2]*3;
    const ax=positions[i1]-positions[i0], ay=positions[i1+1]-positions[i0+1], az=positions[i1+2]-positions[i0+2];
    const bx=positions[i2]-positions[i0], by=positions[i2+1]-positions[i0+1], bz=positions[i2+2]-positions[i0+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    N[i0]+=nx; N[i0+1]+=ny; N[i0+2]+=nz;
    N[i1]+=nx; N[i1+1]+=ny; N[i1+2]+=nz;
    N[i2]+=nx; N[i2+1]+=ny; N[i2+2]+=nz;
  }
  for (let i=0;i<N.length;i+=3){ const x=N[i],y=N[i+1],z=N[i+2]; const L=Math.hypot(x,y,z)||1; N[i]=x/L; N[i+1]=y/L; N[i+2]=z/L; }
  return N;
}

// ──────────────────────────────────────────────────────────────
/** OBJ loader */
// ──────────────────────────────────────────────────────────────
const objInput = document.getElementById('objFile') as HTMLInputElement | null;
objInput?.addEventListener('change', async (e: any) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const mesh: Mesh = await loadOBJ(file);
    const posNorm = normalizePositions(mesh.positions);
    const tri     = mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
    const N       = recomputeNormalsCPU(posNorm.positions, tri);

    gm = uploadMesh(gl, { positions: posNorm.positions, normals: N, indices: tri });

    const he  = buildHalfEdge(tri, posNorm.positions.length / 3);
    const val = computeValences(he);
    setColors(gl, gm, buildValenceColors(val));
    setLines(gl, gm, buildWireframeIndices(tri));

    console.info('OBJ loaded.', { verts: posNorm.positions.length / 3, tris: tri.length / 3 });
  } catch (err) {
    console.error('OBJ load failed:', err);
    alert('OBJ load failed (see console).');
  }
});

// ──────────────────────────────────────────────────────────────
/** IFC ingest (web-ifc-three geometry, core props as fallback) */
// ──────────────────────────────────────────────────────────────
const ifcInput = document.getElementById('ifcFile') as HTMLInputElement | null;
const ifcProps = document.getElementById('ifcProps') as HTMLPreElement | null;
let openIfcModelID: number | null = null;

ifcInput?.addEventListener('change', async (e: any) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // Close previous WASM model (if any)
  if (openIfcModelID !== null) { closeIFC(openIfcModelID); openIfcModelID = null; }

  try {
    // 1) Try tessellating via web-ifc-three (geometry path)
    let mesh: Mesh | null = null;
    try {
      mesh = await loadIFCviaThree(file);
      console.info('IFC via web-ifc-three:', {
        verts: mesh.positions.length / 3,
        tris:  (mesh.indices as Uint32Array | Uint16Array).length / 3
      });
    } catch (e2) {
      console.warn('web-ifc-three tessellation failed, falling back to core loader:', e2);
    }

    // 2) If geometry failed, load PROPERTIES ONLY via core loader and bail (no geometry read here)
    if (!mesh) {

      // quick visual placeholder to prove the GL pipeline is alive:
      const ph = placeholderQuad();
      gm = uploadMesh(gl, ph);
      setLines(gl, gm, buildWireframeIndices(ph.indices));

      const { modelID, elements } = await loadIFCcore(file);
      openIfcModelID = modelID;

      const first = elements[0];
      if (ifcProps && first) {
        ifcProps.textContent = JSON.stringify({
          GlobalId: first.globalId,
          Name: first.name,
          Type: first.type,
          Triangles: 0,
          Note: 'Core loader is props-only (no geometry).',
        }, null, 2);
      } else if (ifcProps) {
        ifcProps.textContent = 'Loaded IFC properties (no elements found).';
      }

      console.info('IFC core had no geometry (by design). Render path skipped.');
      return; // ← important: don’t touch geometry here
    }

    // 3) Normalize for camera + recompute normals (Three path)
    const posTriples = coercePositionsToTriples(mesh.positions);
    const posNorm    = normalizePositions(posTriples);
    const tri        = mesh.indices instanceof Uint32Array ? mesh.indices : new Uint32Array(mesh.indices);
    const N          = recomputeNormalsCPU(posNorm.positions, tri);

    // 4) Upload + overlays
    gm = uploadMesh(gl, { positions: posNorm.positions, normals: N, indices: tri });
    setLines(gl, gm, buildWireframeIndices(tri));

    const he  = buildHalfEdge(tri, posNorm.positions.length / 3);
    const val = computeValences(he);
    setColors(gl, gm, buildValenceColors(val));

    // 5) Sidebar stats
    if (ifcProps) {
      ifcProps.textContent = JSON.stringify({
        GlobalId: '(merged)',
        Name: '(IFC)',
        Type: 'Model',
        Triangles: tri.length / 3
      }, null, 2);
    }

    // 6) Log counts actually uploaded
    if (gm) {
      console.info('GPU mesh uploaded:', { triCount: gm.triCount, lineCount: gm.lineCount || 0 });
    }
  } catch (err) {
    console.error('IFC load failed:', err);
    if (ifcProps) ifcProps.textContent = 'IFC load failed (see console).';
  }
});
