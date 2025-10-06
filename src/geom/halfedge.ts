// ──────────────────────────────────────────────────────────────
// Half-Edge data structures (triangle meshes only for this lab)
// ──────────────────────────────────────────────────────────────

export interface HEVertex {
  // 3D position is stored in your Mesh; here we only keep a pointer to an outgoing half-edge
  halfedge: number; // index into halfedges[] of an outgoing half-edge (or -1)
}

export interface HEHalfEdge {
  // Each half-edge points "from" its previous vertex to its 'vert' (the head)
  vert: number;     // the vertex this half-edge points TO (its head)
  face: number;     // owning face index
  next: number;     // next half-edge in the face cycle (tri => 3-cycle)
  twin: number;     // opposite half-edge across the edge (or -1 on boundary)
}

export interface HEFace {
  halfedge: number; // any half-edge belonging to this face
}

export interface HalfEdgeMesh {
  vertices: HEVertex[];
  halfedges: HEHalfEdge[];
  faces: HEFace[];
}

/**
 * Build a half-edge structure from triangle indices.
 * positions are not required here; we only need connectivity (indices).
 */
export function buildHalfEdge(indices: Uint32Array | Uint16Array, vertexCount: number): HalfEdgeMesh {
  const F = indices.length / 3;

  // Allocate arrays
  const vertices: HEVertex[] = Array.from({ length: vertexCount }, () => ({ halfedge: -1 }));
  const faces: HEFace[]      = Array.from({ length: F }, () => ({ halfedge: -1 }));
  const halfedges: HEHalfEdge[] = Array.from({ length: F * 3 }, () => ({
    vert: -1, face: -1, next: -1, twin: -1
  }));

  // Helper: previous half-edge index inside a face's 3-block
  const prev = (h: number) => {
    const f = Math.floor(h / 3);       // owning face
    const base = f * 3;                // first half-edge of face
    return h === base ? base + 2 : h - 1;
  };

  // 1) Create local (face) connectivity and set "to" vertex for each half-edge
  for (let f = 0; f < F; f++) {
    const i0 = indices[f * 3 + 0];
    const i1 = indices[f * 3 + 1];
    const i2 = indices[f * 3 + 2];

    const h0 = f * 3 + 0;
    const h1 = f * 3 + 1;
    const h2 = f * 3 + 2;

    // Half-edge heads:  (v0->v1), (v1->v2), (v2->v0)
    halfedges[h0].vert = i1;
    halfedges[h1].vert = i2;
    halfedges[h2].vert = i0;

    // Face ownership
    halfedges[h0].face = f;
    halfedges[h1].face = f;
    halfedges[h2].face = f;

    // Face cycle
    halfedges[h0].next = h1;
    halfedges[h1].next = h2;
    halfedges[h2].next = h0;

    // Record one representative half-edge for the face
    faces[f].halfedge = h0;

    // Point each vertex at an outgoing half-edge (any is fine)
    vertices[i0].halfedge = h0;
    vertices[i1].halfedge = h1;
    vertices[i2].halfedge = h2;
  }

  // 2) Build twin links by hashing directed edges
  //    Key is "from_to" where:
  //    from = previous half-edge's head vertex, to = this half-edge's head vertex
  const edgeMap = new Map<string, number>();
  for (let h = 0; h < halfedges.length; h++) {
    const to = halfedges[h].vert;               // head
    const from = halfedges[prev(h)].vert;       // tail (head of previous)
    edgeMap.set(`${from}_${to}`, h);
  }
  for (let h = 0; h < halfedges.length; h++) {
    const to = halfedges[h].vert;
    const from = halfedges[prev(h)].vert;
    const twin = edgeMap.get(`${to}_${from}`);  // look for opposite direction
    if (twin !== undefined) halfedges[h].twin = twin;
  }

  return { vertices, halfedges, faces };
}

/**
 * Compute per-vertex valence (number of incident edges).
 * We walk outgoing half-edges around each vertex via twin/next.
 */
export function computeValences(he: HalfEdgeMesh): Uint16Array {
  const val = new Uint16Array(he.vertices.length);

  for (let v = 0; v < he.vertices.length; v++) {
    const start = he.vertices[v].halfedge;
    if (start === -1) continue;

    // Walk the 1-ring around vertex v
    let h = start;
    let count = 0;
    const guard = 10000; // avoid infinite loops on corrupted topology
    for (let it = 0; it < guard; it++) {
      count++;
      // move to previous edge in the face, then across the twin -> next around vertex
      const fPrev = prevOf(h, he);
      const across = he.halfedges[fPrev].twin;
      if (across === -1) { // boundary: still count, then try to go the other way
        // Try to traverse in the opposite direction around v to count boundary ring
        count = countBoundary(v, he, start);
        break;
      }
      h = he.halfedges[across].next;
      if (h === start) break;
    }
    val[v] = count;
  }
  return val;

  // previous half-edge in the same face
  function prevOf(h: number, he: HalfEdgeMesh) {
    const f = he.halfedges[h].face;
    const base = f * 3;
    return h === base ? base + 2 : h - 1;
  }

  // Count around a boundary vertex going both directions once.
  function countBoundary(v: number, he: HalfEdgeMesh, start: number): number {
    let total = 1; // include start
    // go one way
    let h = start;
    for (let i = 0; i < 10000; i++) {
      const fPrev = prevOf(h, he);
      const across = he.halfedges[fPrev].twin;
      if (across === -1) break;
      h = he.halfedges[across].next;
      if (h === start) break;
      total++;
    }
    // try the other direction from start.prev.twin.next chain
    const prev = prevOf(start, he);
    let twin = he.halfedges[prev].twin;
    if (twin !== -1) {
      h = he.halfedges[twin].next;
      for (let i = 0; i < 10000; i++) {
        const p = prevOf(h, he);
        const t = he.halfedges[p].twin;
        if (t === -1) break;
        h = he.halfedges[t].next;
        if (h === start) break;
        total++;
      }
    }
    return total;
  }
}

/**
 * Build unique wireframe line indices from triangle indices.
 * We de-duplicate undirected edges by sorting the pair (a,b).
 */
export function buildWireframeIndices(tri: Uint32Array | Uint16Array): Uint32Array {
  const key = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const set = new Set<string>();

  // For each triangle, push its 3 edges
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i], b = tri[i + 1], c = tri[i + 2];
    set.add(key(a, b));
    set.add(key(b, c));
    set.add(key(c, a));
  }

  // Flatten into a typed array of pairs
  const lines: number[] = [];
  for (const k of set) {
    const [x, y] = k.split('_').map(Number);
    lines.push(x, y);
  }
  return new Uint32Array(lines);
}

/**
 * Map valence to a color (simple blue→green→red ramp).
 * Returns a Float32Array of length 3*N (RGB per vertex).
 */
export function buildValenceColors(val: Uint16Array): Float32Array {
  let min = Infinity, max = -Infinity;
  for (const v of val) { if (v < min) min = v; if (v > max) max = v; }
  const span = Math.max(1, max - min);

  const col = new Float32Array(val.length * 3);
  for (let i = 0; i < val.length; i++) {
    const t = (val[i] - min) / span; // 0..1
    // simple gradient: blue (low) -> green -> red (high)
    const r = t;
    const g = 1.0 - Math.abs(t - 0.5) * 2.0; // peak at middle valences
    const b = 1.0 - t;
    col[i * 3 + 0] = r;
    col[i * 3 + 1] = Math.max(0, g);
    col[i * 3 + 2] = b;
  }
  return col;
}
