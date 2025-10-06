import type { Mesh, Vec3 } from '../types';

/** Parse a Wavefront OBJ file and return a Mesh (positions/normals/indices). */
export async function loadOBJ(file: File): Promise<Mesh> {
  const txt = await file.text();
  const vs: number[] = [], vts: number[] = [], vns: number[] = [];

  // final de-indexed (unique triplets) buffers we build via a vertex map
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  const idx: number[] = [];
  const vmap = new Map<string, number>(); // "v/t/n" -> new index

  const add = (key: string) => {
    let i = vmap.get(key);
    if (i !== undefined) return i;
    const [vi, ti, ni] = key.split('/').map(s => s ? parseInt(s,10) : 0);

    // positions
    const px = vs[(vi-1)*3+0], py = vs[(vi-1)*3+1], pz = vs[(vi-1)*3+2];
    pos.push(px, py, pz);

    // normals (may be missing -> push placeholder)
    if (ni) {
      const nx = vns[(ni-1)*3+0], ny = vns[(ni-1)*3+1], nz = vns[(ni-1)*3+2];
      nor.push(nx, ny, nz);
    } else {
      nor.push(0,0,0); // mark to recompute later
    }

    // uvs optional
    if (ti) {
      const tu = vts[(ti-1)*2+0], tv = vts[(ti-1)*2+1];
      uv.push(tu, tv);
    }

    i = (pos.length/3)-1;
    vmap.set(key, i);
    return i;
  };

  const lines = txt.split(/\r?\n/);
  for (const raw of lines) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;

    if (l.startsWith('v ')) {
      const [,x,y,z] = l.split(/\s+/);
      vs.push(+x, +y, +z);
    } else if (l.startsWith('vt ')) {
      const [,u,v] = l.split(/\s+/);
      vts.push(+u, +v);
    } else if (l.startsWith('vn ')) {
      const [,x,y,z] = l.split(/\s+/);
      vns.push(+x, +y, +z);
    } else if (l.startsWith('f ')) {
      const [, ...verts] = l.split(/\s+/);   // supports tri/quad/ngon
      const ids = verts.map(add);
      // fan triangulation: (0, i, i+1)
      for (let i=1; i<ids.length-1; i++) idx.push(ids[0], ids[i], ids[i+1]);
    }
  }

  // Compute normals if missing or zero
  recomputeNormals(pos, idx, nor);

  // Normalize to unit cube (fit to view)
  const { min, max } = computeBounds(pos);
  const center: Vec3 = [
    (min[0]+max[0])/2, (min[1]+max[1])/2, (min[2]+max[2])/2
  ];
  const diag = Math.hypot(max[0]-min[0], max[1]-min[1], max[2]-min[2]) || 1;
  const scale = 2.0 / diag; // scale so diag ~ 2 units

  for (let i=0;i<pos.length;i+=3) {
    pos[i  ] = (pos[i  ] - center[0]) * scale;
    pos[i+1] = (pos[i+1] - center[1]) * scale;
    pos[i+2] = (pos[i+2] - center[2]) * scale;
  }

  return {
    positions: new Float32Array(pos),
    normals:   new Float32Array(nor),
    uvs:       uv.length ? new Float32Array(uv) : undefined,
    indices:   new Uint32Array(idx),
    bbox: { min, max },
    center, scale
  };
}

/* ---------- helpers ---------- */
function computeBounds(pos: number[]) {
  const min: Vec3 = [ Infinity,  Infinity,  Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i=0;i<pos.length;i+=3) {
    const x=pos[i], y=pos[i+1], z=pos[i+2];
    if (x<min[0]) min[0]=x; if (y<min[1]) min[1]=y; if (z<min[2]) min[2]=z;
    if (x>max[0]) max[0]=x; if (y>max[1]) max[1]=y; if (z>max[2]) max[2]=z;
  }
  return { min, max };
}

function recomputeNormals(pos:number[], idx:number[], nor:number[]) {
  // zero out
  for (let i=0;i<nor.length;i++) nor[i]=0;
  // accumulate face normals
  for (let t=0;t<idx.length;t+=3) {
    const i0=idx[t]*3, i1=idx[t+1]*3, i2=idx[t+2]*3;
    const ax=pos[i1]-pos[i0], ay=pos[i1+1]-pos[i0+1], az=pos[i1+2]-pos[i0+2];
    const bx=pos[i2]-pos[i0], by=pos[i2+1]-pos[i0+1], bz=pos[i2+2]-pos[i0+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx; // cross
    nor[i0]+=nx; nor[i0+1]+=ny; nor[i0+2]+=nz;
    nor[i1]+=nx; nor[i1+1]+=ny; nor[i1+2]+=nz;
    nor[i2]+=nx; nor[i2+1]+=ny; nor[i2+2]+=nz;
  }
  // normalize
  for (let i=0;i<nor.length;i+=3) {
    const x=nor[i], y=nor[i+1], z=nor[i+2];
    const l = Math.hypot(x,y,z) || 1;
    nor[i]=x/l; nor[i+1]=y/l; nor[i+2]=z/l;
  }
}