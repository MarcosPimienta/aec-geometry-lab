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

// IFC loader (WASM core)
import { loadIFC, closeIFC } from './loaders/ifc';

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
window.addEventListener('resize', () => { resize(); logCanvasSize('resize'); });
resize();

function logCanvasSize(where: string) {
  console.info(`[canvas] ${where}`, {
    client: [canvas.clientWidth, canvas.clientHeight],
    backing: [canvas.width, canvas.height],
  });
}
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
// App state
// ──────────────────────────────────────────────────────────────
let morph = 0;
let t = 0;
const model = identity();

let gm: GLMesh | null = null; // current GPU mesh
let triMode = true;           // TRIANGLES vs LINES
let colorMode = false;        // per-vertex color heatmap

// ──────────────────────────────────────────────────────────────
// UI
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
// Camera
// ──────────────────────────────────────────────────────────────
function proj() {
  return perspective(Math.PI / 4, canvas.width / canvas.height, 0.01, 100);
}
function view() {
  const r = 6.0;
  return lookAt([Math.cos(t * 0.6) * r, 3.5, Math.sin(t * 0.6) * r], [0, 0, 0], [0, 1, 0]);
}

// ──────────────────────────────────────────────────────────────
// Debug: force a known-good cube (press "D")
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
    }
  }
});

// ──────────────────────────────────────────────────────────────
// Render loop
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
/** OBJ loader (Milestones 2/3) */
// ──────────────────────────────────────────────────────────────
const objInput = document.getElementById('objFile') as HTMLInputElement | null;
objInput?.addEventListener('change', async (e: any) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const mesh: Mesh = await loadOBJ(file); // already normalized in that loader
    gm = uploadMesh(gl, mesh);

    const he = buildHalfEdge(mesh.indices, mesh.positions.length / 3);
    const valences = computeValences(he);
    setColors(gl, gm, buildValenceColors(valences));

    setLines(gl, gm, buildWireframeIndices(mesh.indices));
    console.info('OBJ loaded.', { verts: mesh.positions.length / 3, tris: mesh.indices.length / 3 });
  } catch (err) {
    console.error(err);
    alert('OBJ load failed (see console).');
  }
});

// ──────────────────────────────────────────────────────────────
// IFC ingest (Milestone 5) — sanitize + normalize + recompute normals
// ──────────────────────────────────────────────────────────────
const ifcInput = document.getElementById('ifcFile') as HTMLInputElement | null;
const ifcProps = document.getElementById('ifcProps') as HTMLPreElement | null;
let openIfcModelID: number | null = null;

function placeholderQuad(): Mesh {
  const positions = new Float32Array([-1,-1,0, 1,-1,0, 1,1,0, -1,1,0]);
  const normals   = new Float32Array([ 0, 0,1, 0, 0,1, 0,0,1,  0,0,1]);
  const indices   = new Uint32Array([0,1,2, 0,2,3]);
  return { positions, normals, indices };
}

// Polygon runs (-1 separators) → triangles
function normalizeToTriangles(idx: Int32Array | Uint32Array | Uint16Array): Uint32Array {
  let hasNeg = false;
  for (let i = 0; i < (idx as any).length; i++) if ((idx as any)[i] < 0) { hasNeg = true; break; }
  if (!hasNeg && idx.length % 3 === 0) return idx instanceof Uint32Array ? idx : new Uint32Array(idx as any);
  const out: number[] = []; let face: number[] = [];
  const flush = () => { if (face.length >= 3) { const a0 = face[0]; for (let i=1;i+1<face.length;i++) out.push(a0, face[i], face[i+1]); } face = []; };
  for (let i = 0; i < (idx as any).length; i++) { const v = (idx as any)[i]; if (v < 0) { flush(); continue; } face.push(v); }
  flush(); return new Uint32Array(out);
}
// Drop degenerate/OOB triangles
function sanitizeTriangles(tri: Uint32Array, vertCount: number): Uint32Array {
  const out: number[] = [];
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i+1], c = tri[i+2];
    if (a >= vertCount || b >= vertCount || c >= vertCount) continue;
    if (a === b || b === c || c === a) continue;
    out.push(a, b, c);
  }
  return new Uint32Array(out);
}
// Ensure positions length multiple of 3
function coercePositionsToTriples(P: Float32Array): Float32Array {
  const n = Math.floor(P.length / 3) * 3;
  if (n === P.length) return P;
  console.warn('Truncating positions to multiple of 3:', P.length, '->', n);
  return new Float32Array(P.buffer, P.byteOffset, n);
}
// Center + scale to fit camera
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
// Recompute smooth per-vertex normals
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

ifcInput?.addEventListener('change', async (e: any) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (openIfcModelID !== null) { closeIFC(openIfcModelID); openIfcModelID = null; }

  try {
    const { modelID, elements } = await loadIFC(file);
    openIfcModelID = modelID;

    const chosen = elements.find(el => !!el.mesh);
    const rawMesh: Mesh = chosen?.mesh ?? placeholderQuad();

    const triNorm  = normalizeToTriangles(rawMesh.indices as any);
    const posTriples = coercePositionsToTriples(rawMesh.positions);
    const vertCount  = posTriples.length / 3;
    const triClean   = sanitizeTriangles(triNorm, vertCount);

    if (triClean.length < 3) {
      const ph = placeholderQuad();
      gm = uploadMesh(gl, ph);
      setLines(gl, gm, buildWireframeIndices(ph.indices));
      if (ifcProps) {
        const picked = chosen ?? elements[0];
        ifcProps.textContent = JSON.stringify({
          GlobalId: picked?.globalId, Name: picked?.name, Type: picked?.type,
          Triangles: 0, Note: 'No usable triangles; showing placeholder.'
        }, null, 2);
      }
      console.info('IFC loaded (placeholder):', { elements: elements.length, cleanTris: 0, verts: ph.positions.length/3 });
      return;
    }

    const posNorm  = normalizePositions(posTriples);
    const normals  = recomputeNormalsCPU(posNorm.positions, triClean);

    const safeMesh: Mesh = { positions: posNorm.positions, normals, indices: triClean };

    console.info('SAFE MESH STATS', {
      verts: safeMesh.positions.length/3,
      tris:  safeMesh.indices.length/3,
      posFinite: Number.isFinite(safeMesh.positions[0]),
      idxMax: safeMesh.indices.length ? Math.max(...Array.from(safeMesh.indices as Uint32Array)) : -1
    });

    gm = uploadMesh(gl, safeMesh);
    setLines(gl, gm, buildWireframeIndices(safeMesh.indices));

    const he  = buildHalfEdge(safeMesh.indices, safeMesh.positions.length / 3);
    const val = computeValences(he);
    setColors(gl, gm, buildValenceColors(val));

    if (ifcProps) {
      const picked = chosen ?? elements[0];
      ifcProps.textContent = JSON.stringify({
        GlobalId: picked?.globalId, Name: picked?.name, Type: picked?.type,
        Triangles: triClean.length / 3
      }, null, 2);
    }

    console.info('IFC loaded:', {
      elements: elements.length,
      drawn: chosen ? chosen.type : 'props-only',
      normalizedTris: triNorm.length / 3,
      cleanTris: triClean.length / 3,
      verts: posNorm.positions.length / 3,
    });
  } catch (err) {
    console.error('IFC load failed:', err);
    if (ifcProps) ifcProps.textContent = 'IFC load failed (see console).';
  }
});