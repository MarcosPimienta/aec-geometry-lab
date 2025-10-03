export const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uProj, uView, uModel;
uniform float uMorph;

varying vec3 vNormal;
varying float vShade;

void main() {
  // Simple "inflate" morph: push vertex outward slightly along its direction
  vec3 dir = normalize(aPosition);
  vec3 morphed = mix(aPosition, aPosition + dir * 0.2, uMorph);

  vec4 worldPos = uModel * vec4(morphed, 1.0);

  // transform normal by model's 3x3 (OK for uniform scale; fine for this milestone)
  vNormal = mat3(uModel) * aNormal;

  // quick lambert-ish shading so normals are visible
  vec3 lightDir = normalize(vec3(0.4, 0.8, 0.6));
  vShade = max(dot(normalize(vNormal), lightDir), 0.15);

  gl_Position = uProj * uView * worldPos;
}
`;

export const FS = `
precision mediump float;
varying float vShade;

void main() {
  gl_FragColor = vec4(vec3(vShade), 1.0);
}
`;