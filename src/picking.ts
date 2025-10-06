// src/picking.ts
// Color-ID line picking: render edges into an off-screen RGBA8 texture using a flat color = encode(edgeId).
// Then readPixels at the mouse position and decode back the edgeId.

export interface Picking {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  rbo: WebGLRenderbuffer;
  prog: WebGLProgram;
  loc: {
    uProj: WebGLUniformLocation | null;
    uView: WebGLUniformLocation | null;
    uModel: WebGLUniformLocation | null;
    uColor: WebGLUniformLocation | null;
    aPosition: number;
  };
}

const VSP = `
attribute vec3 aPosition;
uniform mat4 uProj, uView, uModel;
void main(){
  gl_Position = uProj * uView * uModel * vec4(aPosition, 1.0);
}
`;

const FSP = `
precision mediump float;
uniform vec3 uColor; // encoded ID (0..1 range)
void main(){
  gl_FragColor = vec4(uColor, 1.0);
}
`;

// Create FBO + simple program for lines
export function createPicking(gl: WebGLRenderingContext, width: number, height: number): Picking {
  // Program
  const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, VSP); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, FSP); gl.compileShader(fs);
  const prog = gl.createProgram()!; gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);

  // Texture
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Depth renderbuffer
  const rbo = gl.createRenderbuffer()!;
  gl.bindRenderbuffer(gl.RENDERBUFFER, rbo);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);

  // FBO
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rbo);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return {
    fbo, tex, rbo, prog,
    loc: {
      uProj:  gl.getUniformLocation(prog, 'uProj'),
      uView:  gl.getUniformLocation(prog, 'uView'),
      uModel: gl.getUniformLocation(prog, 'uModel'),
      uColor: gl.getUniformLocation(prog, 'uColor'),
      aPosition: gl.getAttribLocation(prog, 'aPosition')
    }
  };
}

// Encode integer id -> RGB in [0..1]
export function encID(id: number): [number, number, number] {
  const r = (id & 255) / 255;
  const g = ((id >> 8) & 255) / 255;
  const b = ((id >> 16) & 255) / 255;
  return [r, g, b];
}

// Decode back to integer id
export function decID(r: number, g: number, b: number): number {
  return (r) | (g << 8) | (b << 16);
}
