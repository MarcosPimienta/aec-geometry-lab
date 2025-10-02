export const VS = `
attribute vec2 aPosition;
attribute float aColorIdx;
varying float vColorIdx;
void main() {
  vColorIdx = aColorIdx;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

export const FS = `
precision mediump float;
varying float vColorIdx;
vec3 palette(float i){
  if(i<0.5) return vec3(1.0,0.4,0.3);
  else if(i<1.5) return vec3(0.3,0.8,0.6);
  return vec3(0.3,0.5,1.0);
}
void main(){
  gl_FragColor = vec4(palette(vColorIdx), 1.0);
}
`;