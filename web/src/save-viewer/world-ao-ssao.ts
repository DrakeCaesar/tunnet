import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";

const SSAO_KERNEL_SIZE = 64;
const SSAO_KERNEL_RADIUS = 24;
const SSAO_MIN_DISTANCE = 0.001;
const SSAO_MAX_DISTANCE = 0.75;

export type WorldSsao = {
  composer: EffectComposer;
  ssaoPass: SSAOPass;
  outputPass: OutputPass;
};

export function createWorldSsao(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): WorldSsao {
  const composerTarget = new THREE.WebGLRenderTarget(width, height, { samples: 8 });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.setSize(width, height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const ssaoPass = new SSAOPass(scene, camera, width, height, SSAO_KERNEL_SIZE);
  ssaoPass.kernelRadius = SSAO_KERNEL_RADIUS;
  ssaoPass.minDistance = SSAO_MIN_DISTANCE;
  ssaoPass.maxDistance = SSAO_MAX_DISTANCE;
  ssaoPass.output = SSAOPass.OUTPUT.Default;
  composer.addPass(ssaoPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return { composer, ssaoPass, outputPass };
}

export function setWorldSsaoEnabled(ssaoPass: SSAOPass | null, enabled: boolean, cullHeightT: number): void {
  if (!ssaoPass) return;
  // When top-cut culling is active, disable SSAO to avoid ghosted shading from clipped-away geometry.
  ssaoPass.enabled = enabled && cullHeightT >= 0.999;
}
