// src/geom/ops.ts
// Implement safe edge operations on a TRIANGULATED mesh by *editing the index list*,
// then fully rebuilding half-edge adjacency (simple & robust for a demo).
// We treat the mesh as a mutable {positions: number[], normals: number[], indices: number[]}
// and convert to typed arrays when uploading to GPU.

import { buildHalfEdge } from './halfedge';

export interface MutableMesh {
  positions: number[]; // 3*N (XYZ interleaved)
  normals:   number[]; // 3*N (will be recomputed after edits)
  indices:   number[]; // 3*M (triangles)
}

/** Recompute smooth per-vertex normals from positions + triangles. */
export function recomputeNormals(mm: MutableMesh) {
  // zero normals
  mm.normals.fill(0);
  // accumulate face normals
  for (let t = 0; t < mm.indices.length; t += 3) {
    const i0 = mm.indices[t] * 3, i1 = mm.indices[t + 1] * 3, i2 = mm.indices[t + 2] * 3;
    const ax = mm.positions[i1] - mm.positions[i0];
    const ay = mm.positions[i1 + 1] - mm.positions[i0 + 1];
    const az = mm.positions[i1 + 2] - mm.positions[i0 + 2];
    const bx = mm.positions[i2] - mm.positions[i0];
    const by = mm.positions[i2 + 1] - mm.positions[i0 + 1];
    const bz = mm.positions[i2 + 2] - mm.positions[i0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; // cross
    mm.normals[i0]     += nx; mm.normals[i0 + 1] += ny; mm.normals[i0 + 2] += nz;
    mm.normals[i1]     += nx; mm.normals[i1 + 1] += ny; mm.normals[i1 + 2] += nz;
    mm.normals[i2]     += nx; mm.normals[i2 + 1] += ny; mm.normals[i2 + 2] += nz;
  }
  // normalize
  for (let i = 0; i < mm.normals.length; i += 3) {
    const x = mm.normals[i], y = mm.normals[i + 1], z = mm.normals[i + 2];
    const L = Math.hypot(x, y, z) || 1;
    mm.normals[i] = x / L; mm.normals[i + 1] = y / L; mm.normals[i + 2] = z / L;
  }
}

/**
 * Flip an interior edge. Returns true if the flip was applied.
 * We:
 *  - Find the two triangles sharing the edge (half-edge h and its twin).
 *  - Identify the opposite vertices c and d.
 *  - Replace the two triangles (a,b,c) and (b,a,d) by (c,d,b) and (d,c,a) (preserving orientation).
 */
export function edgeFlip(mm: MutableMesh, halfedgeIndex: number): boolean {
  // Rebuild HE to make sure indices map to faces correctly.
  const he = buildHalfEdge(new Uint32Array(mm.indices), vertexCount(mm));

  // Guard: must be interior (has twin)
  const H = he.halfedges;
  if (halfedgeIndex < 0 || halfedgeIndex >= H.length) return false;
  const h = H[halfedgeIndex];
  if (h.twin === -1) return false; // boundary edge cannot be flipped safely

  // Helper to get the three vertex indices of a face
  const faceVerts = (f: number) => {
    const h0 = he.faces[f].halfedge;
    const h1 = H[h0].next, h2 = H[h1].next;
    const a = H[h2].vert;     // tail of h0
    const b = H[h0].vert;     // head of h0
    const c = H[h1].vert;     // head of h1
    return [a, b, c] as [number, number, number];
  };

  const f0 = h.face;               // face on one side
  const f1 = H[h.twin].face;       // face on the other side

  // Current oriented vertices around the edge
  // For h: ... -> a -> b
  const hPrev = prev(h, he);
  const a = H[hPrev].vert;         // tail (from) vertex of h
  const b = h.vert;                // head (to) vertex of h

  // Opposite vertices in each face (not on the edge)
  // Face f0 has verts (a,b,c), face f1 has (b,a,d)
  const [A0, B0, C0] = faceVerts(f0);
  const c = (A0 !== a && A0 !== b) ? A0 : (B0 !== a && B0 !== b) ? B0 : C0;

  const [A1, B1, D1] = faceVerts(f1);
  const d = (A1 !== a && A1 !== b) ? A1 : (B1 !== a && B1 !== b) ? B1 : D1;

  // Extra guard: avoid degenerate flip if c==d or if new triangles would be degenerate
  if (c === d || c === a || c === b || d === a || d === b) return false;

  // Overwrite the two faces' indices with the flipped configuration.
  // We must locate the exact 3 indices for each face in the index buffer.
  const f0i = f0 * 3, f1i = f1 * 3;

  // Preserve consistent winding (counter-clockwise in view). A simple pattern:
  //  new faces: (c, d, b) and (d, c, a)
  mm.indices[f0i + 0] = c; mm.indices[f0i + 1] = d; mm.indices[f0i + 2] = b;
  mm.indices[f1i + 0] = d; mm.indices[f1i + 1] = c; mm.indices[f1i + 2] = a;

  // Recompute normals (positions unchanged)
  recomputeNormals(mm);
  return true;

  // previous half-edge inside its face block
  function prev(hh: any, hemesh: any) {
    const f = hh.face;
    const base = f * 3;
    const h0 = base + 0, h1 = base + 1, h2 = base + 2;
    // hh is one of {h0,h1,h2}; prev is the one before it
    if (hh === hemesh.halfedges[h0]) return hemesh.halfedges[h2];
    if (hh === hemesh.halfedges[h1]) return hemesh.halfedges[h0];
    return hemesh.halfedges[h1];
  }
}

/**
 * Split an edge by inserting a midpoint vertex. Returns the new vertex index or -1 if failed.
 * We:
 *  - Insert v_mid = (a+b)/2 (positions), normal initially average of neighbors (recomputed later).
 *  - Replace each adjacent triangle with two triangles.
 *  - Rebuild connectivity & normals.
 */
export function edgeSplit(mm: MutableMesh, halfedgeIndex: number): number {
  const he = buildHalfEdge(new Uint32Array(mm.indices), vertexCount(mm));

  const H = he.halfedges;
  if (halfedgeIndex < 0 || halfedgeIndex >= H.length) return -1;
  const h = H[halfedgeIndex];

  // Identify edge (a -> b)
  const hPrev = prevIndex(halfedgeIndex);
  const a = H[hPrev].vert;  // tail
  const b = h.vert;         // head

  // Create midpoint vertex position (average of endpoints)
  const ax = mm.positions[a * 3 + 0], ay = mm.positions[a * 3 + 1], az = mm.positions[a * 3 + 2];
  const bx = mm.positions[b * 3 + 0], by = mm.positions[b * 3 + 1], bz = mm.positions[b * 3 + 2];
  const mx = 0.5 * (ax + bx), my = 0.5 * (ay + by), mz = 0.5 * (az + bz);

  const newVi = mm.positions.length / 3;
  mm.positions.push(mx, my, mz);
  mm.normals.push(0, 0, 0); // temporary; we recompute after topology changes

  // Helper: replace one face (f) which currently contains (a,b,c) with (a,mid,c) and (mid,b,c) or similar.
  const splitFace = (f: number, a_: number, b_: number) => {
    const base = f * 3;
    const i0 = mm.indices[base + 0], i1 = mm.indices[base + 1], i2 = mm.indices[base + 2];
    // find the third vertex c in face f that is neither a_ nor b_
    const c = (i0 !== a_ && i0 !== b_) ? i0 : (i1 !== a_ && i1 !== b_) ? i1 : i2;

    // Remove original triangle (we'll overwrite it with first child tri)
    // and push a new triangle for the second child.
    // We'll create two triangles that share the new vertex:
    //   (a_, mid, c) and (mid, b_, c)
    mm.indices[base + 0] = a_;
    mm.indices[base + 1] = newVi;
    mm.indices[base + 2] = c;

    mm.indices.push(newVi, b_, c);
  };

  // Split face on one side
  splitFace(h.face, a, b);

  // If interior, split the opposite face too
  if (h.twin !== -1) {
    const opp = H[h.twin];
    // opp edge is (b -> a) in its face
    splitFace(opp.face, b, a);
  }

  // Recompute normals after index/vertex change
  recomputeNormals(mm);
  return newVi;

  function prevIndex(hIndex: number) {
    const f = Math.floor(hIndex / 3);
    const base = f * 3;
    return base + ((hIndex - base + 2) % 3);
  }
}

function vertexCount(mm: MutableMesh) {
  return mm.positions.length / 3;
}
