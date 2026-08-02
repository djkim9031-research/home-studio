import * as THREE from 'three';
import { setupLighting } from './lighting';

export interface SceneHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  /** parent for the current house's shell meshes */
  houseGroup: THREE.Group;
  invalidate(): void;
  invalidateShadows(): void;
  onFrame(cb: (dt: number) => boolean | void): void;
  start(camera: THREE.PerspectiveCamera, update: (dt: number) => boolean): void;
}

/** Renderer + dirty-flag rAF loop (renders only when something changed). */
export function createSceneHost(container: HTMLElement): SceneHost {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);
  renderer.domElement.className = 'gl-canvas';

  const scene = new THREE.Scene();
  const lighting = setupLighting(scene, renderer);

  const houseGroup = new THREE.Group();
  scene.add(houseGroup);

  let dirty = true;
  const frameCbs: Array<(dt: number) => boolean | void> = [];

  const resize = () => {
    renderer.setSize(container.clientWidth, container.clientHeight);
    dirty = true;
  };
  new ResizeObserver(resize).observe(container);

  return {
    renderer,
    scene,
    canvas: renderer.domElement,
    houseGroup,
    invalidate() {
      dirty = true;
    },
    invalidateShadows() {
      lighting.invalidateShadows();
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
          renderer.render(scene, camera);
          dirty = false;
        }
      };
      requestAnimationFrame(tick);
    },
  };
}
