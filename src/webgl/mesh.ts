import type { Mesh } from '../types';

export interface GLMesh {
  vboPos: WebGLBuffer;
  vboNor: WebGLBuffer;
  vboCol?: WebGLBuffer;     // optional color buffer (valence heatmap)
  ebo:    WebGLBuffer;      // triangle indices
  lbo?:   WebGLBuffer;      // line indices (wireframe)
  triCount:  number;
  lineCount: number;
  indexType: number;        // gl.UNSIGNED_SHORT or gl.UNSIGNED_INT
}

// Upload base mesh (positions/normals/indices). Colors/lines can be set later.
export function uploadMesh(gl: WebGLRenderingContext, m: Mesh): GLMesh {
  const useUint32 = (m.indices instanceof Uint32Array) && !!gl.getExtension('OES_element_index_uint');
  const indexType = useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

  const vboPos = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
  gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);

  const vboNor = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vboNor);
  gl.bufferData(gl.ARRAY_BUFFER, m.normals, gl.STATIC_DRAW);

  const ebo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, useUint32 ? m.indices : new Uint16Array(m.indices), gl.STATIC_DRAW);

  return { vboPos, vboNor, ebo, triCount: m.indices.length, lineCount: 0, indexType };
}

// Optional: set/update per-vertex colors
export function setColors(gl: WebGLRenderingContext, gm: GLMesh, colors: Float32Array) {
  gm.vboCol = gm.vboCol ?? gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, gm.vboCol);
  gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);
}

// Optional: upload wireframe line indices
export function setLines(gl: WebGLRenderingContext, gm: GLMesh, lines: Uint32Array) {
  const useUint32 = (lines instanceof Uint32Array) && !!gl.getExtension('OES_element_index_uint');
  gm.lbo = gm.lbo ?? gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gm.lbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, useUint32 ? lines : new Uint16Array(lines), gl.STATIC_DRAW);
  gm.lineCount = lines.length;
}

// Bind attributes for draw (positions, normals, optional colors)
export function bindMesh(gl: WebGLRenderingContext, prog: WebGLProgram, gm: GLMesh) {
  const locPos = gl.getAttribLocation(prog, 'aPosition');
  const locNor = gl.getAttribLocation(prog, 'aNormal');
  const locCol = gl.getAttribLocation(prog, 'aColor');

  gl.bindBuffer(gl.ARRAY_BUFFER, gm.vboPos);
  gl.enableVertexAttribArray(locPos);
  gl.vertexAttribPointer(locPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, gm.vboNor);
  gl.enableVertexAttribArray(locNor);
  gl.vertexAttribPointer(locNor, 3, gl.FLOAT, false, 0, 0);

  if (gm.vboCol) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gm.vboCol);
    gl.enableVertexAttribArray(locCol);
    gl.vertexAttribPointer(locCol, 3, gl.FLOAT, false, 0, 0);
  } else {
    // If no colors, disable attribute to avoid reading garbage
    if (locCol >= 0) gl.disableVertexAttribArray(locCol);
  }
}