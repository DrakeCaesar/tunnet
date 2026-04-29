import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

export type WorldGridLines = LineSegments2;

export function createWorldGridLines(
  edges: Float32Array,
  width: number,
  height: number,
  clipPlane: THREE.Plane,
): { lines: WorldGridLines; material: LineMaterial } {
  const lineGeom = new LineSegmentsGeometry();
  lineGeom.setPositions(edges);
  const lineMat = new LineMaterial({
    color: 0x000000,
    linewidth: 1,
    transparent: true,
    opacity: 0.5,
    depthTest: true,
    depthWrite: false,
    alphaToCoverage: true,
  });
  lineMat.resolution.set(width, height);
  lineMat.clippingPlanes = [clipPlane];
  lineMat.clipIntersection = false;

  const lines = new LineSegments2(lineGeom, lineMat);
  lines.renderOrder = 2;
  return { lines, material: lineMat };
}

export function setWorldGridLineResolution(lines: WorldGridLines, width: number, height: number): void {
  const material = lines.material;
  if (material instanceof LineMaterial) {
    material.resolution.set(width, height);
  }
}
