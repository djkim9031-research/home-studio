import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Load a building-scale scan mesh (GLB/GLTF) — an HM3D research scene, a
 * Matterport MatterPak export, or any LiDAR scan — into the viewer. Meshes
 * are session-only (far too large for browser storage). */
export interface LoadedScan {
  group: THREE.Group;
  center: THREE.Vector3;
  halfSpanM: number;
  dispose(): void;
}

export async function loadScanMesh(file: File): Promise<LoadedScan> {
  const buffer = await file.arrayBuffer();
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, '');
  const group = new THREE.Group();
  group.add(gltf.scene);

  // normalize: rest the mesh on the ground plane, centered at the origin
  const bbox = new THREE.Box3().setFromObject(gltf.scene);
  const center = bbox.getCenter(new THREE.Vector3());
  gltf.scene.position.set(-center.x, -bbox.min.y, -center.z);
  const size = bbox.getSize(new THREE.Vector3());

  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  return {
    group,
    center: new THREE.Vector3(0, size.y / 2, 0),
    halfSpanM: Math.max(size.x, size.z) / 2,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            for (const v of Object.values(mat)) {
              if (v instanceof THREE.Texture) v.dispose();
            }
            mat.dispose();
          }
        }
      });
    },
  };
}
