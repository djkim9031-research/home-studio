import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface Lighting {
  invalidateShadows(): void;
}

/** Bright, neutral daylight rig: warm key sun + cool sky hemisphere. */
export function setupLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Lighting {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(2048);
  const cam = sun.shadow.camera;
  cam.left = cam.bottom = -22;
  cam.right = cam.top = 22;
  cam.near = 2;
  cam.far = 60;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  // aim the shadow box at the origin explicitly — an unattached target can
  // leave the ortho box astray and paint its footprint on the ground
  sun.target.position.set(0, 0, 0);
  sun.target.updateMatrixWorld();
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xcfdff2, 0x8a7a62, 0.65);
  scene.add(hemi);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  const sceneEnv = scene as THREE.Scene & { environmentIntensity?: number };
  if ('environmentIntensity' in scene) sceneEnv.environmentIntensity = 0.35;

  scene.background = new THREE.Color(0xdfe5ea);
  scene.fog = new THREE.Fog(0xdfe5ea, 60, 220);

  return {
    invalidateShadows() {
      renderer.shadowMap.needsUpdate = true;
    },
  };
}
