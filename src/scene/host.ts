import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { setupLighting, type SunInput } from './lighting';

export interface SceneHost {
  renderer: THREE.WebGLRenderer;
  css2d: CSS2DRenderer;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  /** parent for placed-element meshes */
  elementsGroup: THREE.Group;
  /** parent for ghosts, dim chips, highlights */
  overlayGroup: THREE.Group;
  invalidate(): void;
  invalidateShadows(): void;
  applySun(input: SunInput | null): void;
  setSunWorld(centerIn: { x: number; z: number }, halfSpanIn: number): void;
  onFrame(cb: (dt: number) => boolean | void): void;
  start(camera: THREE.PerspectiveCamera, update: (dt: number) => boolean): void;
}

/** Renderer + dirty-flag rAF loop (renders only when something changed). */
export function createSceneHost(container: HTMLElement): SceneHost {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true; // Sims-style wall cutaway
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'gl-canvas';

  const css2d = new CSS2DRenderer();
  css2d.domElement.className = 'css2d-layer';
  container.appendChild(css2d.domElement);

  const scene = new THREE.Scene();
  const lighting = setupLighting(scene, renderer);

  const elementsGroup = new THREE.Group();
  const overlayGroup = new THREE.Group();
  scene.add(elementsGroup, overlayGroup);

  let dirty = true;
  const frameCbs: Array<(dt: number) => boolean | void> = [];

  const resize = () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    css2d.setSize(container.clientWidth, container.clientHeight);
    dirty = true;
  };
  new ResizeObserver(resize).observe(container);

  return {
    renderer,
    css2d,
    scene,
    canvas: renderer.domElement,
    elementsGroup,
    overlayGroup,
    invalidate() {
      dirty = true;
    },
    invalidateShadows() {
      lighting.invalidateShadows();
      dirty = true;
    },
    applySun(input) {
      lighting.applySun(input);
      dirty = true;
    },
    setSunWorld(centerIn, halfSpanIn) {
      lighting.setSunWorld(centerIn, halfSpanIn);
      dirty = true;
    },
    onFrame(cb) {
      frameCbs.push(cb);
    },
    start(camera, update) {
      resize();
      let last = performance.now();
      const tick = (now: number) => {
        requestAnimationFrame(tick);
        const dt = Math.min((now - last) / 1000, 0.1);
        last = now;
        const camMoved = update(dt);
        let active = false;
        for (const cb of frameCbs) {
          if (cb(dt)) active = true;
        }
        if (dirty || camMoved || active) {
          if (active) renderer.shadowMap.needsUpdate = true;
          renderer.render(scene, camera);
          css2d.render(scene, camera);
          dirty = false;
        }
      };
      requestAnimationFrame(tick);
    },
  };
}
