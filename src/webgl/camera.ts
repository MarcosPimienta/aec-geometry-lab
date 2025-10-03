// Minimal matrix helpers (column-major Float32Array for WebGL)

export function perspective(fovy:number, aspect:number, near:number, far:number): Float32Array {
  const f = 1.0 / Math.tan(fovy/2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f/aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far+near)*nf, -1,
    0, 0, (2*far*near)*nf, 0
  ]);
}

export function lookAt(eye:[number,number,number], center:[number,number,number], up:[number,number,number]): Float32Array {
  const [ex,ey,ez] = eye, [cx,cy,cz] = center, [ux,uy,uz] = up;

  // z axis = eye -> center (backward)
  let zx = ex-cx, zy = ey-cy, zz = ez-cz;
  const zl = Math.hypot(zx,zy,zz); zx/=zl; zy/=zl; zz/=zl;

  // x axis = up × z
  let xx = uy*zz - uz*zy, xy = uz*zx - ux*zz, xz = ux*zy - uy*zx;
  const xl = Math.hypot(xx,xy,xz); xx/=xl; xy/=xl; xz/=xl;

  // y axis = z × x
  const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx*ex + xy*ey + xz*ez),
    -(yx*ex + yy*ey + yz*ez),
    -(zx*ex + zy*ey + zz*ez),
    1
  ]);
}

export function identity(): Float32Array {
  return new Float32Array([1,0,0,0,  0,1,0,0,  0,0,1,0,  0,0,0,1]);
}

export function rotateY(out: Float32Array, angle:number): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle);
  // multiply identity by Ry to keep it simple
  out.set([ c,0,-s,0,  0,1,0,0,  s,0,c,0,  0,0,0,1 ]);
  return out;
}