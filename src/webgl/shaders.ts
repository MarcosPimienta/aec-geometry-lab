export const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;     // optional; will be disabled if not used

uniform mat4 uProj, uView, uModel;
uniform float uMorph;

varying vec3 vNormal;
varying float vShade;
varying vec3 vColor;

void main() {
  vec3 dir = normalize(aPosition);
  vec3 morphed = mix(aPosition, aPosition + dir * 0.2, uMorph);

  vec4 worldPos = uModel * vec4(morphed, 1.0);

  vColor = aColor; // pass through (ignored if attrib disabled)
  vNormal = mat3(uModel) * aNormal;

  vec3 lightDir = normalize(vec3(0.4, 0.8, 0.6));
  vShade = max(dot(normalize(vNormal), lightDir), 0.15);

  gl_Position = uProj * uView * worldPos;
}
`;

export const FS = `
precision mediump float;
varying float vShade;
varying vec3 vColor;

uniform bool uUseVertexColor; // toggle between heatmap and grayscale

void main() {
  vec3 base = uUseVertexColor ? vColor : vec3(vShade);
  gl_FragColor = vec4(base, 1.0);
}
`;