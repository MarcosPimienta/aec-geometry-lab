// Type-safe, defensive IFC loader for metadata + (optional) triangles.
// Works even when web-ifc omits geometry or uses different shapes.

import * as WebIFC from 'web-ifc';
import type { Mesh } from '../types';

// Keep a single WASM instance
let ifcApi: WebIFC.IfcAPI | null = null;

/** Initialize the WASM API and ensure the WASM is fetched (public/web-ifc.wasm). */
export async function initIFC(): Promise<WebIFC.IfcAPI> {
  if (ifcApi) return ifcApi;
  ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init(); // looks for /web-ifc.wasm
  return ifcApi;
}

export interface IfcElement {
  expressID: number;
  globalId: string;
  type: string;
  name?: string;
  mesh?: Mesh; // present only if triangles were obtained
}

/** Open an IFC model from a File. */
async function openModelFromFile(file: File): Promise<number> {
  const api = await initIFC();
  const data = new Uint8Array(await file.arrayBuffer());
  return api.OpenModel(data);
}

/** Close the model to free memory. */
export function closeIFC(modelID: number) {
  if (!ifcApi) return;
  try { ifcApi.CloseModel(modelID); } catch {}
}

/* ────────────────────────────────────────────────────────────
  Helpers: robust coercion + normals recompute
──────────────────────────────────────────────────────────── */

/** Coerce unknown input into a Float32Array or null. */
function toF32(input: unknown): Float32Array | null {
  if (!input) return null;
  if (input instanceof Float32Array) return input;
  if (Array.isArray(input)) return new Float32Array(input as number[]);
  // Some builds return ArrayBuffer/TypedArray-likes
  try { return new Float32Array(input as ArrayBufferLike); } catch { return null; }
}

/** Coerce unknown input into a Uint32Array or null. */
function toU32(input: unknown): Uint32Array | null {
  if (!input) return null;
  if (input instanceof Uint32Array) return input;
  if (Array.isArray(input)) return new Uint32Array(input as number[]);
  try { return new Uint32Array(input as ArrayBufferLike); } catch { return null; }
}

/** Recompute smooth per-vertex normals (area-weighted). */
function recomputeNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    n[i0] += nx; n[i0 + 1] += ny; n[i0 + 2] += nz;
    n[i1] += nx; n[i1 + 1] += ny; n[i1 + 2] += nz;
    n[i2] += nx; n[i2 + 1] += ny; n[i2 + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const x = n[i], y = n[i + 1], z = n[i + 2];
    const L = Math.hypot(x, y, z) || 1;
    n[i] = x / L; n[i + 1] = y / L; n[i + 2] = z / L;
  }
  return n;
}

/* ────────────────────────────────────────────────────────────
  Geometry extraction (defensive)
──────────────────────────────────────────────────────────── */

/**
 * Attempt to extract triangles for an element using several possible core APIs.
 * Returns a Mesh or undefined (when geometry isn't available in this build/IFC).
 */
function tryGetMeshForElement(api: WebIFC.IfcAPI, modelID: number, expressID: number): Mesh | undefined {
  // Cast to any — web-ifc’s geometry surface area isn’t consistently typed across builds.
  const core: any = api;

  // Strategy 1: a monolithic object with .vertices/.indices/.normals
  const maybeGeom: any = core.GetGeometry?.(modelID, expressID, true);
  let vertices = toF32(maybeGeom?.vertices);
  let indices  = toU32(maybeGeom?.indices);
  let normals  = toF32(maybeGeom?.normals);

  // Strategy 2: separate accessors (older/different builds)
  if (!vertices && core.GetVertexArray) {
    vertices = toF32(core.GetVertexArray(modelID, expressID));
  }
  if (!indices && core.GetIndexArray) {
    indices = toU32(core.GetIndexArray(modelID, expressID));
  }
  if (!normals && core.GetNormalArray) {
    normals = toF32(core.GetNormalArray(modelID, expressID));
  }

  // If we still don't have the essentials, bail (metadata-only is fine).
  if (!vertices || !indices) return;

  // If normals missing/zero-length, recompute on the fly.
  if (!normals || normals.length !== vertices.length) {
    normals = recomputeNormals(vertices, indices);
  }

  return { positions: vertices, indices, normals };
}

/* ────────────────────────────────────────────────────────────
  Basic property helpers
──────────────────────────────────────────────────────────── */

function basicProps(api: WebIFC.IfcAPI, modelID: number, id: number) {
  const line: any = api.GetLine(modelID, id);
  const globalId = line?.GlobalId?.value ?? String(id);
  const name = line?.Name?.value ?? undefined;
  const typeName = (api as any).GetNameFromTypeCode
    ? (api as any).GetNameFromTypeCode(line?.type)
    : String(line?.type);
  return { globalId, name, typeName };
}

/* ────────────────────────────────────────────────────────────
  Public loader
──────────────────────────────────────────────────────────── */

/**
 * Load an IFC file; return a list of elements (Walls/Slabs/Windows/Doors),
 * each with metadata and (when available) a Mesh.
 */
export async function loadIFC(file: File): Promise<{ modelID: number; elements: IfcElement[] }> {
  const api = await initIFC();
  const modelID = await openModelFromFile(file);

  const types = [WebIFC.IFCWALL, WebIFC.IFCSLAB, WebIFC.IFCWINDOW, WebIFC.IFCDOOR];
  const elements: IfcElement[] = [];

  for (const t of types) {
    const ids = api.GetLineIDsWithType(modelID, t);
    const size = ids.size();
    for (let i = 0; i < size; i++) {
      const id = ids.get(i);
      const { globalId, name, typeName } = basicProps(api, modelID, id);
      const mesh = tryGetMeshForElement(api, modelID, id); // may be undefined
      elements.push({ expressID: id, globalId, name, type: typeName, mesh });
    }
  }

  // keep model open; caller can closeIFC(modelID) later
  return { modelID, elements };
}