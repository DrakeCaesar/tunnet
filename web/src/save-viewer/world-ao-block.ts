import * as THREE from "three";
import { hemisphereAoFactorForNormalAttribute } from "./world-ao-hemisphere";

export type WorldAoColorSet = {
  geometry: THREE.BufferGeometry;
  blockAoColors: Float32Array;
  flatColors: Float32Array;
};

export function applyWorldVertexAo(
  colorSets: WorldAoColorSet[],
  opts: {
    blockAoEnabled: boolean;
    hemisphereAoEnabled: boolean;
  },
): void {
  for (const entry of colorSets) {
    const normals = entry.geometry.getAttribute("normal");
    const sourceColors = opts.blockAoEnabled ? entry.blockAoColors : entry.flatColors;
    const nextColors = new Float32Array(sourceColors.length);

    for (let i = 0; i < sourceColors.length; i += 3) {
      const vertexIndex = i / 3;
      const hemi = opts.hemisphereAoEnabled && normals instanceof THREE.BufferAttribute
        ? hemisphereAoFactorForNormalAttribute(normals, vertexIndex)
        : 1;
      nextColors[i] = (sourceColors[i] ?? 0) * hemi;
      nextColors[i + 1] = (sourceColors[i + 1] ?? 0) * hemi;
      nextColors[i + 2] = (sourceColors[i + 2] ?? 0) * hemi;
    }

    entry.geometry.setAttribute("color", new THREE.BufferAttribute(nextColors, 3));
    entry.geometry.getAttribute("color").needsUpdate = true;
  }
}
