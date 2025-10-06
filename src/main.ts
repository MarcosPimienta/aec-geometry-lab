import { getGL, createProgram } from './webgl/gl';
import { VS, FS } from './webgl/shaders';
import { perspective, lookAt, identity, rotateY } from './webgl/camera';
import { createPicking, encID, decID } from './picking';
import { edgeFlip, edgeSplit, recomputeNormals } from './geom/ops';
import type { MutableMesh } from './geom/ops';
import { uploadMesh, bindMesh, setColors, setLines } from './webgl/mesh';
import type { GLMesh } from './webgl/mesh';
import { loadOBJ } from './loaders/obj';
import type { Mesh } from './types';
import { buildHalfEdge, computeValences, buildWireframeIndices, approxValences, buildValenceColors } from './geom/halfedge';

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

// ---------- state for editable mesh ----------
// We'll keep a mutable CPU copy so we can rewrite indices/positions on ops.
let editable: MutableMesh | null = null;

// ---------- build edge buffers with IDs ----------
// For picking we need: (1) GL_LINES index buffer, (2) a parallel "edgeId per line vertex" attribute OR flat draw per edge.
// Simpler: we reuse your single line index buffer (pairs) and draw *per edge* during picking with a solid color per draw call.
// We'll also keep a mapping from undirected edge "a_b" -> representative half-edge index, so we can run ops on the right edge.

let edgePairs: Uint32Array | null = null; // LINES indices (a,b,a,b,...) length = 2*E
let edgeToHalfedge = new Map<string, number>(); // "min_max" -> halfedge index
let selectedEdge = -1; // current selection (index into edgePairs/2)
const selInfo = document.getElementById('selInfo')!;

// Helper to produce undirected key
const ekey = (a:number,b:number)=> a<b?`${a}_${b}`:`${b}_${a}`;

// After you load OBJ (or rebuild mesh), call this to rebuild edge data
function rebuildEdgesAndMap(mesh: { indices: Uint32Array|Uint16Array, positions: Float32Array }) {
  // Build unique wireframe pairs (like in M3)
  const lines = buildWireframeIndices(mesh.indices);
  edgePairs = lines;

  // Build half-edge to get mapping from undirected edge -> some half-edge index
  const he = buildHalfEdge(mesh.indices, mesh.positions.length/3);
  edgeToHalfedge.clear();
  for (let h=0; h<he.halfedges.length; h++){
    const hh = he.halfedges[h];
    const f = Math.floor(h/3);
    // tail = prev(h).vert ; head = h.vert
    const base = f*3; const prev = (h===base?base+2:h-1);
    const tail = he.halfedges[prev].vert;
    const head = hh.vert;
    edgeToHalfedge.set(ekey(tail, head), h);
  }
}

// ---------- picking setup ----------
let pick: ReturnType<typeof createPicking> | null = null;

// call whenever canvas resizes
function ensurePickingSized() {
  pick = createPicking(gl, canvas.width, canvas.height);
}

// ---------- on OBJ load: keep a mutable copy ----------
objInput?.addEventListener('change', async (e:any)=>{
  const file = e.target.files?.[0]; if (!file) return;
  const mesh = await loadOBJ(file);

  // Save editable CPU mesh (arrays) — copy from typed arrays
  editable = {
    positions: Array.from(mesh.positions),
    normals:   Array.from(mesh.normals),
    indices:   Array.from(mesh.indices)
  };

  // Upload as usual
  gm = uploadMesh(gl, mesh);

  // Build lines + valence colors, as in M3
  const lines = buildWireframeIndices(mesh.indices);
  setLines(gl, gm, lines);

  const val = approxValences(mesh.indices, mesh.positions.length/3);
  const colors = buildValenceColors(val);
  setColors(gl, gm, colors);

  // Build picking maps
  rebuildEdgesAndMap(mesh);

  // Ensure picking FBO matches current canvas size
  ensurePickingSized();

  console.info('Editable mesh ready. Edges:', (edgePairs?.length??0)/2);
});

// ---------- mouse click -> pick edge ----------
canvas.addEventListener('click', (ev)=>{
  if (!gm || !edgePairs || !pick) return;
  // Convert client coords -> framebuffer coords (origin bottom-left for readPixels)
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((ev.clientX - rect.left) * (canvas.width / rect.width));
  const y = Math.floor((rect.bottom - ev.clientY) * (canvas.height / rect.height)); // flip Y

  // Render all edges into pick FBO, one draw per edge with a unique color
  gl.bindFramebuffer(gl.FRAMEBUFFER, pick.fbo);
  gl.viewport(0,0,canvas.width, canvas.height);
  gl.clearColor(0,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(pick.prog);
  // set transforms
  gl.uniformMatrix4fv(pick.loc.uProj, false, proj());
  gl.uniformMatrix4fv(pick.loc.uView, false, view());
  gl.uniformMatrix4fv(pick.loc.uModel, false, model);

  // Bind position buffer once (we draw lines by indexing into the same VBO as triangles)
  gl.bindBuffer(gl.ARRAY_BUFFER, gm.vboPos);
  gl.enableVertexAttribArray(pick.loc.aPosition);
  gl.vertexAttribPointer(pick.loc.aPosition, 3, gl.FLOAT, false, 0, 0);

  // We'll bind a small EBO per-edge by reusing gm.lbo + drawElements with offset/count
  // BUT WebGL1 drawElements offset is bytes; we can't do per-edge easily without changing indices.
  // Simpler approach: create a temp EBO per edge via bufferSubData OR draw each edge with drawArrays + vertex attrib "index".
  // To keep it straightforward, we re-upload a tiny 2-index buffer per edge (fast enough for picking).
  const tempLBO = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tempLBO);

  const pair = new Uint16Array(2); // use 16-bit for small demos; upgrade to Uint32 with extension if needed
  const useUint32 = !!gl.getExtension('OES_element_index_uint');
  const indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  for (let eid = 0; eid < edgePairs.length!/2; eid++) {
    const a = edgePairs![eid*2+0], b = edgePairs![eid*2+1];

    // upload just this pair
    if (useUint32) {
      const buf = new Uint32Array([a, b]);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buf, gl.STREAM_DRAW);
    } else {
      pair[0] = a; pair[1] = b;
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pair, gl.STREAM_DRAW);
    }

    // set unique color for this edge ID
    const [r,g,b_] = encID(eid);
    gl.uniform3f(pick.loc.uColor, r, g, b_);

    // draw the two-vertex line
    gl.drawElements(gl.LINES, 2, indexType, 0);
  }

  // Read pixel under the mouse
  const px = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); // back to default

  const id = decID(px[0], px[1], px[2]);

  if (id >= 0 && id < (edgePairs.length/2)) {
    selectedEdge = id;
    const a = edgePairs[id*2+0], b = edgePairs[id*2+1];
    selInfo.textContent = `Selected edge #${id} (v${a}–v${b})`;
  } else {
    selectedEdge = -1;
    selInfo.textContent = 'No edge selected';
  }
});

// ---------- wire buttons to ops ----------
document.getElementById('edgeFlip')?.addEventListener('click', ()=>{
  if (!editable || !edgePairs) return;
  if (selectedEdge < 0) { alert('Click an edge in the canvas first.'); return; }

  // Map selected line (a,b) -> representative half-edge index
  const a = edgePairs[selectedEdge*2+0], b = edgePairs[selectedEdge*2+1];
  const h = edgeToHalfedge.get(ekey(a,b));
  if (h === undefined) { alert('Selected edge has no half-edge (unexpected)'); return; }

  // Apply flip
  const ok = edgeFlip(editable, h);
  if (!ok) { alert('Flip rejected (boundary or degenerate).'); return; }

  // Rebuild GPU buffers & edge maps from the edited CPU mesh
  reuploadFromEditable();
});

document.getElementById('edgeSplit')?.addEventListener('click', ()=>{
  if (!editable || !edgePairs) return;
  if (selectedEdge < 0) { alert('Click an edge in the canvas first.'); return; }

  const a = edgePairs[selectedEdge*2+0], b = edgePairs[selectedEdge*2+1];
  const h = edgeToHalfedge.get(ekey(a,b));
  if (h === undefined) { alert('Selected edge has no half-edge (unexpected)'); return; }

  const vnew = edgeSplit(editable, h);
  if (vnew < 0) { alert('Split failed.'); return; }

  reuploadFromEditable();
});

// ---------- helper: upload from editable CPU mesh ----------
function reuploadFromEditable() {
  if (!editable) return;

  // Recompute normals (edge ops already do this, but safe to ensure)
  recomputeNormals(editable);

  // Convert to typed arrays for GL
  const positions = new Float32Array(editable.positions);
  const normals   = new Float32Array(editable.normals);
  const indices   = new Uint32Array(editable.indices);

  // Recreate GPU mesh (simplest path for demo)
  gm = uploadMesh(gl, { positions, normals, indices });

  // Rebuild visuals: lines + colors
  const lines = buildWireframeIndices(indices);
  setLines(gl, gm, lines);

  // Simple valence coloring (reuse approx or your real valence)
  const val = approxValences(indices, positions.length/3);
  const colors = buildValenceColors(val);
  setColors(gl, gm, colors);

  // Rebuild picking maps
  rebuildEdgesAndMap({ indices, positions });

  selInfo.textContent = 'Topology updated.';
}

// ---------- keep picking target in sync with canvas size ----------
window.addEventListener('resize', ()=> {
  ensurePickingSized();
});
