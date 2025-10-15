// src/loaders/ifc_three.ts
// Three-based tessellation path (geometry). We avoid importing the wasm asset
// (Vite export-map issues) and instead point to /wasm/ under your BASE_URL.

import { IFCLoader } from 'web-ifc-three/IFCLoader';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Mesh } from '../types';

function wasmFolder(): string {
  // Served from /public/wasm
  return `${import.meta.env.BASE_URL}wasm/`;
}

export async function loadIFCviaThree(file: File): Promise<Mesh> {
  const loader = new IFCLoader();

  const folder = wasmFolder();
  loader.ifcManager.setWasmPath(folder);
  (loader.ifcManager as any).useWebWorkers?.(false);

  console.info('[IFC3] wasm folder =', folder, 'workers=off');

  // Optional preflight check so you can see the real bytes type/size
  await (async () => {
    try {
      const r = await fetch(`${folder}web-ifc.wasm`);
      console.info('[WASM check] status', r.status, 'ct', r.headers.get('content-type'));
      const buf = await r.arrayBuffer();
      console.info('[WASM check] bytes', buf.byteLength);
    } catch (e) {
      console.warn('[WASM check] fetch failed:', e);
    }
  })();

  // Load IFC using Three's tessellator
  const url = URL.createObjectURL(file);
  const root = (await loader.loadAsync(url)) as THREE.Group;
  URL.revokeObjectURL(url);

  root.updateMatrixWorld(true);

  // Collect world-space geometries
  const geoms: THREE.BufferGeometry[] = [];
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!(mesh as any).isMesh) return;
    const g = mesh.geometry as THREE.BufferGeometry;
    if (!g) return;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    if (!pos || !idx || pos.count === 0 || idx.count === 0) return;

    const clone = g.clone();
    clone.applyMatrix4(mesh.matrixWorld);
    geoms.push(clone);
  });

  if (geoms.length === 0) {
    loader.ifcManager.dispose();
    throw new Error('No renderable geometries found in IFC.');
  }

  // Merge pieces into a single geometry for your WebGL path
  const merged = mergeGeometries(geoms, false);
  geoms.forEach((g) => g.dispose());

  const posAttr = merged.getAttribute('position') as THREE.BufferAttribute | null;
  const idxAttr = merged.getIndex() as THREE.BufferAttribute | null;
  if (!posAttr || !idxAttr) {
    merged.dispose();
    loader.ifcManager.dispose();
    throw new Error('Merged geometry missing position or index buffer.');
  }

  const positions = new Float32Array(posAttr.array as ArrayLike<number>);
  const rawIdx = idxAttr.array as Uint16Array | Uint32Array;
  const indices =
    positions.length / 3 > 65535 || rawIdx instanceof Uint32Array
      ? new Uint32Array(rawIdx as any)
      : new Uint16Array(rawIdx as any);

  // Normals will be recomputed in main.ts; allocate to satisfy Mesh type
  const normals = new Float32Array(positions.length);

  merged.dispose();
  loader.ifcManager.dispose();

  return { positions, normals, indices };
}
