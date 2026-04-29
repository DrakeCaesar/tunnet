import * as THREE from "three";

export function hemisphereAoFactor(normalY: number): number {
  if (normalY > 0.5) return 1;
  if (normalY < -0.5) return 0.72;
  return 0.86;
}

export function hemisphereAoFactorForNormalAttribute(normals: THREE.BufferAttribute, vertexIndex: number): number {
  return hemisphereAoFactor(normals.getY(vertexIndex));
}
