export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

export interface Mesh {
  positions: Float32Array; // 3 * n
  normals: Float32Array;   // 3 * n
  uvs?: Float32Array;      // 2 * n
  indices: Uint32Array;    // 3 * m
  // optional helpers
  bbox?: { min: Vec3; max: Vec3 };
  center?: Vec3;
  scale?: number; // uniform scale applied after normalization (if any)
}

export interface PickInfo {
  triangleIndex: number;
  faceId?: number;
  elementId?: number | string; // IFC GlobalId string maps here
}
