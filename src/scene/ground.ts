import * as THREE from 'three';

/** A soft green lot for the home to sit on. */
export function buildGround(scene: THREE.Scene): void {
  const lawn = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshStandardMaterial({ color: 0xa9b78d, roughness: 0.95, metalness: 0 }),
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  scene.add(lawn);
}
