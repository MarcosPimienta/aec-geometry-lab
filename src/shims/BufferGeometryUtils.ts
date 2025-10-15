// src/shims/BufferGeometryUtils.ts
// Compatibility wrapper for different Three versions.

export * from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import * as U from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BufferGeometry } from 'three';

/** Always available — forwards to whichever exists at runtime. */
export function mergeGeometries(geoms: BufferGeometry[], useGroups = false): BufferGeometry {
  const fn = (U as any).mergeGeometries ?? (U as any).mergeBufferGeometries;
  if (!fn) throw new Error('BufferGeometryUtils: neither mergeGeometries nor mergeBufferGeometries is exported');
  return fn(geoms, useGroups);
}

/** Back-compat alias so imports of either name succeed. */
export const mergeBufferGeometries = mergeGeometries;
