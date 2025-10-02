export const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform mat4 uProj, uView, uModel;
uniform float uMorph;

varying vec3 vNormal;
varying float vShade;

void main() {
  vec3 pos = mix(aPosition, normalize(aPosition) * length(aPosition) * 1.05, uMorph);
  vec4 worldPos = uModel * vec4(pos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vec3 lightDir = normalize(vec3(0.4, 0.8, 0.6));
  vShade = max(dot(normalize(vNormal), lightDir), 0.2);
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