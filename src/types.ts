export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Mesh {
  positions: Float32Array;   // 3*N
  normals:   Float32Array;   // 3*N
  uvs?:      Float32Array;   // 2*N
  indices:   Uint32Array | Uint16Array;  // ⬅️ union type here
  bbox?: { min: [number,number,number]; max: [number,number,number] };
  center?: [number,number,number];
  scale?: number;
}

export interface PickInfo {
  triangleIndex: number;
  faceId?: number;
  elementId?: number | string; // IFC GlobalId string maps here
}
